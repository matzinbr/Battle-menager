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
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;
const TZ = process.env.TZ || 'America/Sao_Paulo';
const STATE_FILE = path.join(__dirname, 'arena_state.json');

const WORK_REWARD = 270;           // Yens por /work
const CURRENCY_EMOJI = '<:MoneyPilePNGClipart:1463070061630718177>';
const WORK_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos
const workCooldown = new Map();

/* ================= CLIENT ================= */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ================= STATE ================= */
async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { override: null }; }
}
async function saveState(state) { await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2)); }

/* ================= TIME LOGIC ================= */
function isSundayOpen() { return DateTime.now().setZone(TZ).weekday === 7 && DateTime.now().setZone(TZ).hour >= 9; }
function workIsOpen(state) { return state.override !== null ? state.override : isSundayOpen(); }

/* ================= PERMISSIONS ================= */
async function setWorkPermission(open) {
  if (!CHANNEL_ID) return;
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);
  await channel.permissionOverwrites.edit(guild.roles.everyone, { UseApplicationCommands: open });
  return channel;
}

/* ================= RECONCILE ================= */
async function reconcile() {
  const state = await readState();
  const shouldOpen = state.override !== null ? state.override : (DateTime.now().setZone(TZ).weekday === 7);

  if (CHANNEL_ID) {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(CHANNEL_ID);
    const perms = channel.permissionsFor(guild.roles.everyone);
    const isOpen = perms.has(PermissionFlagsBits.UseApplicationCommands);

    if (isOpen !== shouldOpen) {
      await setWorkPermission(shouldOpen);
      const embed = new EmbedBuilder()
        .setTitle(shouldOpen ? '💰 WORK LIBERADO' : '⛔ WORK ENCERRADO')
        .setDescription(shouldOpen ? 'Use `/work` até 00:00 para ganhar Yens!' : '⛔ Work só funciona aos domingos!')
        .setColor(shouldOpen ? 0x00ff99 : 0xff5555)
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    }
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

  new SlashCommandBuilder().setName('work').setDescription('Receba 270 Yens (só aos domingos)'),

  new SlashCommandBuilder()
    .setName('x1_result')
    .setDescription('Registrar resultado de uma partida X1')
    .addUserOption(o => o.setName('vencedor').setDescription('Quem ganhou').setRequired(true))
    .addUserOption(o => o.setName('perdedor').setDescription('Quem perdeu').setRequired(true)),

  new SlashCommandBuilder().setName('rank').setDescription('Mostra o ranking top 10'),
  new SlashCommandBuilder().setName('profile').setDescription('Mostra suas estatísticas de vitórias/derrotas e Yens')
].map(c => c.toJSON());

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  await saveState(await readState());
  await reconcile();
  cron.schedule('0 9 * * 0', reconcile, { timezone: TZ });
  cron.schedule('0 0 * * 1', reconcile, { timezone: TZ });
  cron.schedule('*/5 * * * *', reconcile, { timezone: TZ });
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const state = await readState();
  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
    (ADMIN_ROLE_ID && interaction.member.roles.cache.has(ADMIN_ROLE_ID));

  // ---------- WORK ----------
  if (interaction.commandName === 'status-work') {
    const open = workIsOpen(state);
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(open ? '✅ WORK LIBERADO' : '⛔ WORK BLOQUEADO')
          .setColor(open ? 0x00ff99 : 0xff5555)
      ],
      ephemeral: true
    });
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

  // ---------- WORK COM YENS ----------
  if (interaction.commandName === 'work') {
    const now = DateTime.now().setZone(TZ);
    if (now.weekday !== 7) {
      return interaction.reply({ content: '⛔ O WORK só funciona aos domingos!', ephemeral: true });
    }

    const lastTime = workCooldown.get(interaction.user.id) || 0;
    if (Date.now() - lastTime < WORK_COOLDOWN_MS) {
      const wait = Math.ceil((WORK_COOLDOWN_MS - (Date.now() - lastTime)) / 60000);
      return interaction.reply({ content: `⏱ Aguarde ${wait} minutos antes de usar /work novamente.`, ephemeral: true });
    }
    workCooldown.set(interaction.user.id, Date.now());

    const ranking = await loadRanking();
    if (!ranking.players[interaction.user.id]) {
      ranking.players[interaction.user.id] = { name: interaction.user.username, wins: 0, losses: 0, streak: 0, yens: 0 };
    }
    ranking.players[interaction.user.id].yens = (ranking.players[interaction.user.id].yens || 0) + WORK_REWARD;
    await fs.writeFile('./ranking.json', JSON.stringify(ranking, null, 2));

    const embed = new EmbedBuilder()
      .setTitle('💼 WORK realizado!')
      .setDescription(`${interaction.user.username} recebeu ${WORK_REWARD} ${CURRENCY_EMOJI}`)
      .setColor(0x00ff99)
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // ---------- X1 RESULT ----------
  if (interaction.commandName === 'x1_result') {
    const vencedor = interaction.options.getUser('vencedor');
    const perdedor = interaction.options.getUser('perdedor');
    if (vencedor.id === perdedor.id) return interaction.reply({ content: '❌ O vencedor e o perdedor não podem ser a mesma pessoa!', ephemeral: true });
    await recordMatch(vencedor, perdedor);

    const embed = new EmbedBuilder()
      .setTitle('🎮 Resultado X1 registrado')
      .setDescription(`${vencedor.username} venceu ${perdedor.username}`)
      .setColor(0x00ff99)
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // ---------- RANK ----------
  if (interaction.commandName === 'rank') {
    const ranking = await loadRanking();
    const leaderboard = Object.values(ranking.players)
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 10);

    const embed = new EmbedBuilder()
      .setTitle('🏆 Ranking Top 10')
      .setColor(0xffcc00)
      .setTimestamp();

    if (!leaderboard.length) {
      embed.setDescription('Nenhum jogador registrado ainda.');
    } else {
      let desc = '';
      leaderboard.forEach((p, i) => {
        const yens = p.yens || 0;
        desc += `**${i + 1}. ${p.name}** - Vitórias: ${p.wins} - Derrotas: ${p.losses} - Streak: ${p.streak} - ${yens} ${CURRENCY_EMOJI}\n`;
      });
      embed.setDescription(desc);
    }

    return interaction.reply({ embeds: [embed] });
  }

  // ---------- PROFILE ----------
  if (interaction.commandName === 'profile') {
    const ranking = await loadRanking();
    const player = ranking.players[interaction.user.id];
    if (!player) return interaction.reply({ content: 'Você ainda não tem nenhuma partida registrada ou não usou /work ainda.', ephemeral: true });

    const yens = player.yens || 0;
    const embed = new EmbedBuilder()
      .setTitle(`📊 Perfil de ${player.name}`)
      .setDescription(
        `Vitórias: ${player.wins}\n` +
        `Derrotas: ${player.losses}\n` +
        `Streak: ${player.streak}\n` +
        `💰 Yens: ${yens} ${CURRENCY_EMOJI}`
      )
      .setColor(0x00ccff)
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);
