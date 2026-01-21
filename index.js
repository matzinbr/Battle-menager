/**
 * Battle Manager — Full Professional Version
 */

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
const BET_YENS = 270;

/* ================= CLIENT ================= */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ================= STATE ================= */
async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { override: null, workUsed: [] }; }
}
async function saveState(state) { await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2)); }

/* ================= TIME LOGIC ================= */
function isSunday() { return DateTime.now().setZone(TZ).weekday === 7; }
function isWorkOpen() { 
  const now = DateTime.now().setZone(TZ);
  return now.weekday === 7 && now.hour >= 9 && now.hour < 24;
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
  const shouldOpen = state.override !== null ? state.override : isSunday();
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);
  const perms = channel.permissionsFor(guild.roles.everyone);
  const isOpen = perms.has(PermissionFlagsBits.UseApplicationCommands);

  if (isOpen !== shouldOpen) {
    await setWorkPermission(shouldOpen);
    const embed = new EmbedBuilder()
      .setTitle(shouldOpen ? '💰 Shenanigans Bet LIBERADO' : '⛔ Shenanigans Bet ENCERRADO')
      .setDescription(shouldOpen ? 'Use `/shenanigans_bet` até 23:59 para apostas.' : '⛔ Apenas domingos!')
      .setColor(shouldOpen ? 0x00ff99 : 0xff5555)
      .setTimestamp();
    await channel.send({ embeds: [embed] });
    await log(`Sistema ajustado → ${shouldOpen ? 'ABERTO' : 'FECHADO'}`);
  }
}

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder().setName('status-shenanigans').setDescription('Mostra se o Shenanigans Bet está disponível'),
  new SlashCommandBuilder()
    .setName('forcar-shenanigans')
    .setDescription('Força abrir/fechar (staff)')
    .addBooleanOption(o => o.setName('abrir').setDescription('true = abrir / false = fechar').setRequired(true)),
  new SlashCommandBuilder().setName('clear-override').setDescription('Remove controle manual e volta ao automático'),
  new SlashCommandBuilder()
    .setName('shenanigans_bet')
    .setDescription('Use seu Shenanigans Bet do domingo'),

  // X1 commands
  new SlashCommandBuilder()
    .setName('x1_result')
    .setDescription('Registrar resultado de uma partida X1')
    .addUserOption(o => o.setName('vencedor').setDescription('Quem ganhou').setRequired(true))
    .addUserOption(o => o.setName('perdedor').setDescription('Quem perdeu').setRequired(true))
    .addIntegerOption(o => o.setName('valor').setDescription('Valor em yens').setRequired(true)),

  new SlashCommandBuilder().setName('rank').setDescription('Mostra o ranking top 10'),
  new SlashCommandBuilder().setName('profile').setDescription('Mostra suas estatísticas')
].map(c => c.toJSON());

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await log(`Bot online: ${client.user.tag}`);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  await saveState(await readState());
  await reconcile();
  cron.schedule('*/5 * * * *', reconcile, { timezone: TZ });
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const state = await readState();
  const guild = await client.guilds.fetch(GUILD_ID);
  const member = await guild.members.fetch(interaction.user.id);
  const isFounder = member.roles.cache.has(FOUNDER_ROLE_ID);
  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
                  (ADMIN_ROLE_ID && member.roles.cache.has(ADMIN_ROLE_ID));

  /* ---------- STATUS ---------- */
  if (interaction.commandName === 'status-shenanigans') {
    const open = isSunday() && isWorkOpen();
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle(open ? '✅ Shenanigans Bet ABERTO' : '⛔ Shenanigans Bet FECHADO')
        .setColor(open ? 0x00ff99 : 0xff5555)],
      ephemeral: true
    });
  }

  /* ---------- FORÇAR / CLEAR ---------- */
  if (!isAdmin && ['forcar-shenanigans','clear-override'].includes(interaction.commandName))
    return interaction.reply({ content: '🔒 Apenas staff pode usar.', ephemeral: true });

  if (interaction.commandName === 'forcar-shenanigans') {
    state.override = interaction.options.getBoolean('abrir');
    await saveState(state); await reconcile();
    return interaction.reply({ content: '✅ Override aplicado.', ephemeral: true });
  }

  if (interaction.commandName === 'clear-override') {
    state.override = null;
    await saveState(state); await reconcile();
    return interaction.reply({ content: '♻ Voltou ao automático.', ephemeral: true });
  }

  /* ---------- SHENANIGANS BET ---------- */
  if (interaction.commandName === 'shenanigans_bet') {
    if (!isWorkOpen() && !isFounder)
      return interaction.reply({ content: '⛔ Apenas domingos 9h–23:59! Ou fundadores podem usar.', ephemeral: true });

    if (state.workUsed.includes(interaction.user.id) && !isFounder)
      return interaction.reply({ content: '⛔ Você já usou o Shenanigans Bet hoje!', ephemeral: true });

    // Marca como usado
    if (!isFounder) {
      state.workUsed.push(interaction.user.id);
      await saveState(state);
    }

    // Dá yens básicos
    const ranking = await loadRanking();
    if (!ranking.players[interaction.user.id])
      ranking.players[interaction.user.id] = { name: interaction.user.username, wins:0, losses:0, streak:0, yens:0, items:[], titles:[] };

    ranking.players[interaction.user.id].yens += BET_YENS;

    // Checagem de streak (3 domingos seguidos)
    ranking.players[interaction.user.id].streak = (ranking.players[interaction.user.id].streak || 0) + 1;
    if (ranking.players[interaction.user.id].streak % 3 === 0)
      ranking.players[interaction.user.id].yens += 100; // bônus de streak

    await saveRanking(ranking);

    return interaction.reply({ content: `💰 Você ganhou **${BET_YENS} yens**! Sua streak atual: ${ranking.players[interaction.user.id].streak}`, ephemeral: true });
  }

  /* ---------- X1 RESULT ---------- */
  if (interaction.commandName === 'x1_result') {
    const vencedor = interaction.options.getUser('vencedor');
    const perdedor = interaction.options.getUser('perdedor');
    const value = interaction.options.getInteger('valor');

    if (vencedor.id === perdedor.id)
      return interaction.reply({ content: '❌ Vencedor e perdedor não podem ser a mesma pessoa!', ephemeral: true });

    await recordMatch(vencedor, perdedor, value);

    const ranking = await loadRanking();
    const player = ranking.players[vencedor.id];
    let newItem = null;

    // Drop de itens 20% chance
    if (Math.random() < 0.2) {
      newItem = Math.random() < 0.5 ? 'Sukuna Finger' : 'Gokumonkyo';
      player.items.push(newItem);

      // Checa títulos
      const memberWinner = await guild.members.fetch(vencedor.id);
      if (player.items.filter(i=>i==='Sukuna Finger').length >= 2 && !player.titles.includes('Disgraceful King')) {
        const role = await guild.roles.fetch('1463413152824819753');
        await memberWinner.roles.add(role);
        player.titles.push('Disgraceful King');
        newItem += ' 🎉 Ganhou título **Disgraceful King**!';
      }
      if (player.items.filter(i=>i==='Gokumonkyo').length >= 3 && !player.titles.includes('The Honored One')) {
        const role = await guild.roles.fetch('1463413249734086860');
        await memberWinner.roles.add(role);
        player.titles.push('The Honored One');
        newItem += ' 🎉 Ganhou título **The Honored One**!';
      }
    }

    await saveRanking(ranking);

    const embed = new EmbedBuilder()
      .setTitle('🎮 Resultado X1 registrado')
      .setDescription(`${vencedor.username} venceu ${perdedor.username}\n💰 Apostou: ${value} yens\n${newItem ? `Item recebido: ${newItem}` : ''}`)
      .setColor(0x00ff99)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    await log(`X1 registrado → ${vencedor.username} venceu ${perdedor.username}`);
  }

  /* ---------- RANK ---------- */
  if (interaction.commandName === 'rank') {
    const leaderboard = await getLeaderboard();
    const embed = new EmbedBuilder()
      .setTitle('🏆 Ranking Top 10')
      .setColor(0xffcc00)
      .setTimestamp();

    if (!leaderboard.length) embed.setDescription('Nenhum jogador registrado ainda.');
    else {
      embed.setDescription(leaderboard.map((p,i)=>`**${i+1}. ${p.name}** - Vitórias: ${p.wins} - Yens: ${p.yens} - Streak: ${p.streak}`).join('\n'));
    }

    await interaction.reply({ embeds: [embed] });
  }

  /* ---------- PROFILE ---------- */
  if (interaction.commandName === 'profile') {
    const ranking = await loadRanking();
    const player = ranking.players[interaction.user.id];

    if (!player)
      return interaction.reply({ content: 'Você ainda não tem partidas registradas.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(`📊 Perfil de ${player.name}`)
      .setDescription(`Vitórias: ${player.wins}\nDerrotas: ${player.losses}\nYens: ${player.yens}\nStreak: ${player.streak}\nItens: ${player.items.join(', ') || 'Nenhum'}\nTítulos: ${player.titles.join(', ') || 'Nenhum'}`)
      .setColor(0x00ccff)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);
