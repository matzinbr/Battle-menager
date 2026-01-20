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

const { recordMatch, getLeaderboard, loadRanking } = require('./ranking.js');

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;
const TZ = process.env.TZ || 'America/Sao_Paulo';
const STATE_FILE = path.join(__dirname, 'arena_state.json');

/* ================= CLIENT ================= */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ================= STATE ================= */
async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { override: null }; }
}
async function saveState(state) { await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2)); }

/* ================= TIME LOGIC ================= */
function workIsOpen(state) {
  const now = DateTime.now().setZone(TZ);
  const isSunday = now.weekday === 7;
  return state.override !== null ? state.override : isSunday;
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
  const shouldOpen = workIsOpen(state);

  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);
  const perms = channel.permissionsFor(guild.roles.everyone);
  const isOpen = perms.has(PermissionFlagsBits.UseApplicationCommands);

  if (isOpen !== shouldOpen) {
    await setWorkPermission(shouldOpen);

    const embed = new EmbedBuilder()
      .setTitle(shouldOpen ? '💰 WORK LIBERADO' : '⛔ WORK ENCERRADO')
      .setDescription(shouldOpen ? 'Use `/work` até 00:00 para apostas.' : '⛔ WORK fechado — só funciona aos domingos!')
      .setColor(shouldOpen ? 0x00ff99 : 0xff5555)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    await log(`Sistema ajustado automaticamente → ${shouldOpen ? 'ABERTO' : 'FECHADO'}`);
  }
}

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder().setName('status-work').setDescription('Mostra se o WORK está disponível'),
  new SlashCommandBuilder()
    .setName('forcar-work')
    .setDescription('Força abrir ou fechar o WORK (staff)')
    .addBooleanOption(o => o.setName('abrir').setDescription('true = abrir / false = fechar').setRequired(true)),
  new SlashCommandBuilder().setName('clear-override').setDescription('Remove o controle manual e volta ao automático'),

  new SlashCommandBuilder()
    .setName('x1_result')
    .setDescription('Registrar resultado de uma partida X1')
    .addUserOption(o => o.setName('vencedor').setDescription('Quem ganhou').setRequired(true))
    .addUserOption(o => o.setName('perdedor').setDescription('Quem perdeu').setRequired(true))
    .addIntegerOption(o => o.setName('valor').setDescription('Valor apostado por jogador').setRequired(true)),

  new SlashCommandBuilder().setName('rank').setDescription('Mostra o ranking top 10'),
  new SlashCommandBuilder().setName('profile').setDescription('Mostra suas estatísticas de vitórias/derrotas')
].map(c => c.toJSON());

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await log(`Bot online: ${client.user.tag}`);

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });

  await saveState(await readState());
  await reconcile();

  cron.schedule('0 9 * * 0', reconcile, { timezone: TZ }); // Domingo às 9h
  cron.schedule('0 0 * * 1', reconcile, { timezone: TZ }); // Segunda às 00h
  cron.schedule('*/5 * * * *', reconcile, { timezone: TZ }); // Auto check a cada 5 min
});

/* ================= INTERACTIONS ================= */
const x1Cooldown = new Set();

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const state = await readState();
  const now = DateTime.now().setZone(TZ);
  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
    (ADMIN_ROLE_ID && interaction.member.roles.cache.has(ADMIN_ROLE_ID));

  /* ---------- WORK ---------- */
  if (interaction.commandName === 'work') {
    const isSunday = now.weekday === 7;

    if (!isSunday && !isAdmin && state.override === null) {
      try {
        await interaction.user.send('⛔ O WORK só funciona aos domingos! Aguarde até o próximo domingo.');
      } catch {
        await interaction.reply({ content: '⛔ O WORK só funciona aos domingos! Aguarde até o próximo domingo.', ephemeral: true });
      }
      return;
    }

    await interaction.reply({ content: `💰 ${interaction.user.username} usou /work com sucesso! (teste)`, ephemeral: true });
  }

  /* ---------- STATUS / FORÇAR / CLEAR ---------- */
  if (interaction.commandName === 'status-work') {
    const open = workIsOpen(state);
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle(open ? '✅ WORK LIBERADO' : '⛔ WORK BLOQUEADO').setColor(open ? 0x00ff99 : 0xff5555)], ephemeral: true });
  }

  if (!isAdmin && ['forcar-work', 'clear-override', 'x1_result'].includes(interaction.commandName)) {
    return interaction.reply({ content: '🔒 Apenas a staff pode usar este comando.', ephemeral: true });
  }

  if (interaction.commandName === 'forcar-work') {
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
    const valor = interaction.options.getInteger('valor');

    if (x1Cooldown.has(interaction.user.id)) {
      return interaction.reply({ content: '⏳ Aguarde 10 segundos antes de registrar outra partida.', ephemeral: true });
    }

    if (!valor || valor <= 0) {
      return interaction.reply({ content: '❌ O valor da aposta deve ser maior que 0!', ephemeral: true });
    }

    if (vencedor.id === perdedor.id) {
      return interaction.reply({ content: '❌ O vencedor e o perdedor não podem ser a mesma pessoa!', ephemeral: true });
    }

    await recordMatch(vencedor, perdedor, valor);

    const embed = new EmbedBuilder()
      .setTitle('🎮 Resultado X1 registrado')
      .setDescription(`${vencedor.username} venceu ${perdedor.username}\n💰 Dinheiro total apostado: ${valor*2} yens`)
      .setColor(0x00ff99)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    await log(`X1 registrado → ${vencedor.username} venceu ${perdedor.username} | Valor: ${valor} yens`);

    x1Cooldown.add(interaction.user.id);
    setTimeout(() => x1Cooldown.delete(interaction.user.id), 10000); // 10 segundos cooldown
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
      leaderboard.forEach((p,i) => {
        const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
        desc += `${medal} **${i+1}. ${p.name}** - Vitórias: ${p.wins} - Streak: ${p.streak}\n`;
      });
      embed.setDescription(desc);
    }

    await interaction.reply({ embeds: [embed] });
  }

  /* ---------- PROFILE ---------- */
  if (interaction.commandName === 'profile') {
    const ranking = await loadRanking();
    const player = ranking.players[interaction.user.id];

    if (!player) {
      return interaction.reply({ content: 'Você ainda não tem nenhuma partida registrada.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle(`📊 Perfil de ${player.name}`)
      .setDescription(`Vitórias: ${player.wins}\nDerrotas: ${player.losses}\nStreak atual: ${player.streak}\nPartidas jogadas: ${player.wins+player.losses}`)
      .setColor(0x00ccff)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);
