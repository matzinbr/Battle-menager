require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const { DateTime } = require('luxon');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');

const { recordMatch, getLeaderboard, loadRanking, saveRanking } = require('./ranking.js');

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;
const FOUNDER_ROLE_ID = '1463413721970769973';
const TZ = process.env.TZ || 'America/Sao_Paulo';
const STATE_FILE = path.join(__dirname, 'arena_state.json');
const WORK_AMOUNT = 270;

/* ================= CLIENT ================= */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ================= STATE ================= */
async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { override: null, workUsed: {} }; }
}
async function saveState(state) { await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2)); }

/* ================= TIME LOGIC ================= */
function isSundayOpen() {
  const now = DateTime.now().setZone(TZ);
  return now.weekday === 7 && now.hour >= 9 && now.hour < 24;
}
function shenanigansIsOpen(state) {
  return state.override !== null ? state.override : isSundayOpen();
}

/* ================= PERMISSIONS ================= */
async function setWorkPermission(open) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);
  await channel.permissionOverwrites.edit(guild.roles.everyone, { UseApplicationCommands: open });
  return channel;
}

/* ================= LOG ================= */
async function log(msg) {
  console.log(msg);
  if (!LOG_CHANNEL_ID) return;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const ch = await guild.channels.fetch(LOG_CHANNEL_ID);
    await ch.send(`📝 ${msg}`);
  } catch {}
}

/* ================= RECONCILE ================= */
async function reconcile() {
  const state = await readState();
  const shouldOpen = shenanigansIsOpen(state);

  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);
  const perms = channel.permissionsFor(guild.roles.everyone);
  const isOpen = perms.has(PermissionFlagsBits.UseApplicationCommands);

  if (isOpen !== shouldOpen) {
    await setWorkPermission(shouldOpen);
    const embed = new EmbedBuilder()
      .setTitle(shouldOpen ? '💰 SHENANIGANS BET LIBERADO' : '⛔ SHENANIGANS BET ENCERRADO')
      .setDescription(
        shouldOpen
          ? 'Use `/shenanigans_bet` **uma vez** hoje para ganhar yens!'
          : '⛔ Somente aos domingos! Aproveite a semana!'
      )
      .setColor(shouldOpen ? 0x00ff99 : 0xff5555)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    await log(`Sistema ajustado automaticamente → ${shouldOpen ? 'ABERTO' : 'FECHADO'}`);
  }
}

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder().setName('status-shenanigans').setDescription('Mostra se o shenanigans bet está disponível'),
  new SlashCommandBuilder()
    .setName('forcar-shenanigans')
    .setDescription('Força abrir ou fechar o shenanigans bet (staff)')
    .addBooleanOption(o => o.setName('abrir').setDescription('true = abrir / false = fechar').setRequired(true)),
  new SlashCommandBuilder().setName('clear-override').setDescription('Remove o controle manual e volta ao automático'),
  new SlashCommandBuilder()
    .setName('x1_result')
    .setDescription('Registrar resultado de uma partida X1')
    .addUserOption(o => o.setName('vencedor').setDescription('Quem ganhou').setRequired(true))
    .addUserOption(o => o.setName('perdedor').setDescription('Quem perdeu').setRequired(true))
    .addNumberOption(o => o.setName('valor').setDescription('Valor apostado em yens').setRequired(true)),
  new SlashCommandBuilder().setName('rank').setDescription('Mostra o ranking top 10'),
  new SlashCommandBuilder().setName('profile').setDescription('Mostra suas estatísticas e itens'),
  new SlashCommandBuilder().setName('trade').setDescription('Troque itens por títulos')
].map(c => c.toJSON());

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await log(`Bot online: ${client.user.tag}`);

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  await saveState(await readState());
  await reconcile();

  cron.schedule('0 9 * * 0', reconcile, { timezone: TZ }); // Domingo 9h
  cron.schedule('0 0 * * 1', reconcile, { timezone: TZ }); // Segunda 0h
  cron.schedule('*/5 * * * *', reconcile, { timezone: TZ }); // Auto check
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const state = await readState();
  const guild = await client.guilds.fetch(GUILD_ID);
  const member = await guild.members.fetch(interaction.user.id);

  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
    (ADMIN_ROLE_ID && interaction.member.roles.cache.has(ADMIN_ROLE_ID));
  const isFounder = member.roles.cache.has(FOUNDER_ROLE_ID);

  /* ---------- SHENANIGANS BET ---------- */
  if (interaction.commandName === 'shenanigans_bet') {
    if (!isFounder && state.workUsed?.[interaction.user.id]) {
      return interaction.reply({ content: 'Você já usou o shenanigans bet hoje!', ephemeral: true });
    }

    if (!shenanigansIsOpen(state)) {
      return interaction.reply({ content: '⛔ Shennanigans bet só funciona aos domingos, 9h-23:59!', ephemeral: true });
    }

    // Marca que o usuário usou
    state.workUsed = state.workUsed || {};
    state.workUsed[interaction.user.id] = true;
    await saveState(state);

    // Adiciona yens
    const ranking = await loadRanking();
    if (!ranking.players[interaction.user.id]) {
      ranking.players[interaction.user.id] = { name: interaction.user.username, wins:0, losses:0, streak:0, yens:0, items:[], titles:[] };
    }
    ranking.players[interaction.user.id].yens = (ranking.players[interaction.user.id].yens || 0) + WORK_AMOUNT;

    // Streak 3 dias → +100 yens
    ranking.players[interaction.user.id].streak = (ranking.players[interaction.user.id].streak || 0) + 1;
    if (ranking.players[interaction.user.id].streak % 3 === 0) {
      ranking.players[interaction.user.id].yens += 100;
    }

    await saveRanking(ranking);

    await interaction.reply({ content: `💰 Você ganhou **${WORK_AMOUNT} yens**! ${ranking.players[interaction.user.id].streak % 3 === 0 ? '🎉 Bônus de streak +100 yens!' : ''}`, ephemeral: true });
    return;
  }

  /* ---------- FORCE / CLEAR ---------- */
  if (!isAdmin) {
    if (['forcar-shenanigans', 'clear-override', 'x1_result', 'trade'].includes(interaction.commandName)) {
      return interaction.reply({ content: '🔒 Apenas a staff pode usar este comando.', ephemeral: true });
    }
  }

  if (interaction.commandName === 'forcar-shenanigans') {
    state.override = interaction.options.getBoolean('abrir');
    await saveState(state);
    await reconcile();
    return interaction.reply({ content: '✅ Override aplicado.', ephemeral: true });
  }

  if (interaction.commandName === 'clear-override') {
    state.override = null;
    await saveState(state);
    await reconcile();
    return interaction.reply({ content: '♻ Sistema voltou ao automático.', ephemeral: true });
  }

  /* ---------- X1 RESULT ---------- */
  if (interaction.commandName === 'x1_result') {
    const vencedor = interaction.options.getUser('vencedor');
    const perdedor = interaction.options.getUser('perdedor');
    const valor = interaction.options.getNumber('valor');

    if (vencedor.id === perdedor.id) return interaction.reply({ content: '❌ O vencedor e o perdedor não podem ser a mesma pessoa!', ephemeral:true });

    const ranking = await loadRanking();
    if (!ranking.players[vencedor.id]) ranking.players[vencedor.id] = { name: vencedor.username, wins:0, losses:0, streak:0, yens:0, items:[], titles:[] };
    if (!ranking.players[perdedor.id]) ranking.players[perdedor.id] = { name: perdedor.username, wins:0, losses:0, streak:0, yens:0, items:[], titles:[] };

    ranking.players[vencedor.id].wins += 1;
    ranking.players[vencedor.id].yens += valor * 2;
    ranking.players[vencedor.id].streak += 1;

    ranking.players[perdedor.id].losses += 1;
    ranking.players[perdedor.id].yens -= valor;
    ranking.players[perdedor.id].streak = 0;

    await saveRanking(ranking);

    const embed = new EmbedBuilder()
      .setTitle('🎮 Resultado X1 registrado')
      .setDescription(`${vencedor.username} venceu ${perdedor.username}\n💰 Valor total ganho: ${valor*2} yens`)
      .setColor(0x00ff99)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
    return;
  }

  /* ---------- RANK ---------- */
  if (interaction.commandName === 'rank') {
    const leaderboard = await getLeaderboard();
    const embed = new EmbedBuilder()
      .setTitle('🏆 Ranking Top 10')
      .setColor(0xffcc00)
      .setTimestamp();

    if (leaderboard.length === 0) {
      embed.setDescription('Nenhum jogador registrado ainda.');
    } else {
      let desc = '';
      leaderboard.forEach((p, i) => {
        desc += `**${i+1}. ${p.name}** - Vitórias: ${p.wins} - Yens: ${p.yens} - Streak: ${p.streak}\n`;
      });
      embed.setDescription(desc);
    }
    await interaction.reply({ embeds: [embed] });
    return;
  }

  /* ---------- PROFILE ---------- */
  if (interaction.commandName === 'profile') {
    const ranking = await loadRanking();
    const player = ranking.players[interaction.user.id];
    if (!player) return interaction.reply({ content: 'Você ainda não tem nenhuma partida registrada.', ephemeral:true });

    const embed = new EmbedBuilder()
      .setTitle(`📊 Perfil de ${player.name}`)
      .setDescription(
        `Vitórias: ${player.wins}\nDerrotas: ${player.losses}\nStreak: ${player.streak}\nYens: ${player.yens || 0}\nItens: ${player.items.join(', ') || 'Nenhum'}\nTítulos: ${player.titles.join(', ') || 'Nenhum'}`
      )
      .setColor(0x00ccff)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral:true });
    return;
  }

  /* ---------- TRADE ---------- */
  if (interaction.commandName === 'trade') {
    const ranking = await loadRanking();
    const player = ranking.players[interaction.user.id];

    if (!player || !player.items.length)
      return interaction.reply({ content: 'Você não possui nenhum item para trocar.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle('🔄 Troca de Itens por Títulos')
      .setDescription(
        'Você pode trocar seus itens por títulos:\n' +
        '- 2 Sukuna Fingers → cargo Disgraceful King\n' +
        '- 3 Gokumonkyo → cargo The Honored One\n\n' +
        'Seus itens atuais: ' + player.items.join(', ')
      )
      .setColor(0xffaa00)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });

    // Trocas automáticas
    const member = await guild.members.fetch(interaction.user.id);

    const sukunaCount = player.items.filter(i => i==='Sukuna Finger').length;
    if (sukunaCount >= 2 && !player.titles.includes('Disgraceful King')) {
      const role = await guild.roles.fetch('1463413152824819753');
      await member.roles.add(role);
      player.titles.push('Disgraceful King');
      let removed = 0;
      player.items = player.items.filter(i => { if(i==='Sukuna Finger'&&removed<2){removed++;return false;}return true;});
      await interaction.followUp({ content: '🎉 Você recebeu o título **Disgraceful King**!', ephemeral: true });
    }

    const gokumCount = player.items.filter(i => i==='Gokumonkyo').length;
    if (gokumCount >= 3 && !player.titles.includes('The Honored One')) {
      const role = await guild.roles.fetch('1463413249734086860');
      await member.roles.add(role);
      player.titles.push('The Honored One');
      let removed = 0;
      player.items = player.items.filter(i => { if(i==='Gokumonkyo'&&removed<3){removed++;return false;}return true;});
      await interaction.followUp({ content: '🎉 Você recebeu o título **The Honored One**!', ephemeral: true });
    }

    await saveRanking(ranking);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);
