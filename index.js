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

const { recordMatch, getLeaderboard } = require('./ranking.js');

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
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return { override: null };
  }
}

async function saveState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

/* ================= TIME LOGIC ================= */

function isSundayOpen() {
  const now = DateTime.now().setZone(TZ);
  return now.weekday === 7 && now.hour >= 9;
}

function workIsOpen(state) {
  return state.override !== null ? state.override : isSundayOpen();
}

/* ================= PERMISSIONS ================= */

async function setWorkPermission(open) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);
  await channel.permissionOverwrites.edit(guild.roles.everyone, {
    UseApplicationCommands: open
  });
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
      .setDescription(
        shouldOpen
          ? 'Use `/work` até 00:00 para apostas.'
          : 'Apostas encerradas. Boa semana!'
      )
      .setColor(shouldOpen ? 0x00ff99 : 0xff5555)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    await log(`Sistema ajustado automaticamente → ${shouldOpen ? 'ABERTO' : 'FECHADO'}`);
  }
}

/* ================= COMMANDS ================= */

const commands = [
  // WORK commands
  new SlashCommandBuilder()
    .setName('status-work')
    .setDescription('Mostra se o WORK está disponível'),

  new SlashCommandBuilder()
    .setName('forcar-work')
    .setDescription('Força abrir ou fechar o WORK (staff)')
    .addBooleanOption(o =>
      o.setName('abrir')
        .setDescription('true = abrir / false = fechar')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('clear-override')
    .setDescription('Remove o controle manual e volta ao automático'),

  // Ranking / X1 commands
  new SlashCommandBuilder()
    .setName('x1_result')
    .setDescription('Registrar resultado de uma aposta X1')
    .addUserOption(o => o.setName('vencedor').setDescription('Quem ganhou').setRequired(true))
    .addUserOption(o => o.setName('perdedor').setDescription('Quem perdeu').setRequired(true))
    .addIntegerOption(o => o.setName('fichas').setDescription('Quantas fichas').setRequired(true)),

  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Mostra o ranking top 10')
].map(c => c.toJSON());

/* ================= READY ================= */

client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await log(`Bot online: ${client.user.tag}`);

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );

  await saveState(await readState());
  await reconcile();

  cron.schedule('0 9 * * 0', reconcile, { timezone: TZ }); // Domingo
  cron.schedule('0 0 * * 1', reconcile, { timezone: TZ }); // Segunda
  cron.schedule('*/5 * * * *', reconcile, { timezone: TZ }); // Auto check
});

/* ================= INTERACTIONS ================= */

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const state = await readState();
  const isAdmin =
    interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
    (ADMIN_ROLE_ID && interaction.member.roles.cache.has(ADMIN_ROLE_ID));

  // WORK commands
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

  if (!isAdmin) {
    return interaction.reply({
      content: '🔒 Apenas a staff pode usar este comando.',
      ephemeral: true
    });
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

  // X1 / Ranking commands
  if (interaction.commandName === 'x1_result') {
    const vencedor = interaction.options.getUser('vencedor');
    const perdedor = interaction.options.getUser('perdedor');
    const fichas = interaction.options.getInteger('fichas');

    await recordMatch(vencedor, perdedor, fichas);
    await interaction.reply(`${vencedor.username} venceu ${perdedor.username} por ${fichas} fichas! Ranking atualizado.`);
  }

  if (interaction.commandName === 'rank') {
    const leaderboard = await getLeaderboard();
    let msg = "**🏆 Ranking Top 10**\n";
    leaderboard.forEach((p, i) => {
      msg += `${i+1}. ${p.name} - Vitórias: ${p.wins}, Fichas: ${p.chips}\n`;
    });
    await interaction.reply(msg);
  }
});

/* ================= LOGIN ================= */

client.login(TOKEN);
