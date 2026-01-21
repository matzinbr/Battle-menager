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
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;
const TZ = process.env.TZ || 'America/Sao_Paulo';
const STATE_FILE = path.join(__dirname, 'arena_state.json');

/* ================= CLIENT ================= */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ================= STATE ================= */
async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { override: null, workUsed: {} }; }
}
async function saveState(state) { await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2)); }

/* ================= TIME LOGIC ================= */
function isSunday() {
  return DateTime.now().setZone(TZ).weekday === 7;
}
function workIsOpen(state) {
  return state.override !== null ? state.override : isSunday();
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
      .setDescription(
        shouldOpen
          ? 'Use `/work` até 23:59 para ganhar Yens!'
          : '⛔ Work fechado — só funciona aos domingos!'
      )
      .setColor(shouldOpen ? 0x00ff99 : 0xff5555)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    await log(`Sistema ajustado automaticamente → ${shouldOpen ? 'ABERTO' : 'FECHADO'}`);
  }
}

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder().setName('work').setDescription('Ganhe 270 yens uma vez por domingo'),
  new SlashCommandBuilder().setName('rank').setDescription('Mostra o ranking top 10'),
  new SlashCommandBuilder().setName('profile').setDescription('Mostra suas estatísticas de vitórias/derrotas')
].map(c => c.toJSON());

/* ================= READY ================= */
client.once('clientReady', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  await reconcile();

  cron.schedule('0 9 * * 0', reconcile, { timezone: TZ }); // Domingo 09:00
  cron.schedule('0 0 * * 1', reconcile, { timezone: TZ }); // Segunda 00:00 limpa override
  cron.schedule('*/5 * * * *', reconcile, { timezone: TZ }); // Check automático
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const state = await readState();
  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
    (ADMIN_ROLE_ID && interaction.member.roles.cache.has(ADMIN_ROLE_ID));

  try {
    /* ---------- WORK ---------- */
    if (interaction.commandName === 'work') {
      if (!workIsOpen(state) && !isAdmin) {
        return interaction.reply({ content: '⛔ O WORK só funciona aos domingos, das 9:00 às 23:59!', ephemeral: true });
      }

      if (!state.workUsed) state.workUsed = {};
      if (state.workUsed[interaction.user.id] && !isAdmin) {
        return interaction.reply({ content: '⛔ Você já usou o /work hoje!', ephemeral: true });
      }

      // Recompensa base
      let reward = 270;

      // Surpresa Jackpot (~10% chance)
      if (Math.random() < 0.10) reward *= 2;

      // Surpresa secreta (super rara, ~1% chance)
      if (Math.random() < 0.01) reward += Math.floor(Math.random() * 500) + 100;

      // Marca que o usuário usou
      state.workUsed[interaction.user.id] = true;
      await saveState(state);

      const embed = new EmbedBuilder()
        .setTitle('💸 /WORK')
        .setDescription(`<:MoneyPilePNGClipart:1463070061630718177> Você ganhou **${reward} yens!**`)
        .setColor(0x00ff99)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    /* ---------- RANK ---------- */
    if (interaction.commandName === 'rank') {
      const leaderboard = await getLeaderboard();
      const embed = new EmbedBuilder()
        .setTitle('🏆 Ranking Top 10')
        .setColor(0xffcc00)
        .setTimestamp();

      if (!leaderboard || leaderboard.length === 0) embed.setDescription('Nenhum jogador registrado ainda.');
      else {
        let desc = '';
        leaderboard.forEach((p, i) => { desc += `**${i + 1}. ${p.name}** - Vitórias: ${p.wins} - Streak: ${p.streak}\n`; });
        embed.setDescription(desc);
      }

      return interaction.reply({ embeds: [embed] });
    }

    /* ---------- PROFILE ---------- */
    if (interaction.commandName === 'profile') {
      const ranking = await loadRanking();
      const player = ranking.players[interaction.user.id];

      if (!player) return interaction.reply({ content: 'Você ainda não tem nenhuma partida registrada.', ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle(`📊 Perfil de ${player.name}`)
        .setDescription(`Vitórias: ${player.wins}\nDerrotas: ${player.losses}\nStreak: ${player.streak}`)
        .setColor(0x00ccff)
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

  } catch (err) {
    console.error('Erro na interação:', err);
    return interaction.reply({ content: '❌ Ocorreu um erro ao executar o comando.', ephemeral: true });
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);
