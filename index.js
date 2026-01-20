/**
 * Arena Controller - Stable Production Version
 * - Auto schedule with cron
 * - Persistent manual override (arena_state.json)
 * - Reconciliation loop (self-healing)
 * - Slash commands:
 *   /status-work
 *   /forcar-work
 *   /clear-override
 *
 * ENV REQUIRED:
 * TOKEN, GUILD_ID, CHANNEL_ID
 *
 * OPTIONAL:
 * ADMIN_ROLE_ID, LOG_CHANNEL_ID, TZ, WORK_OPEN_HOUR, WORK_CLOSE_HOUR
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

/* ===================== CONFIG ===================== */

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;

const TIMEZONE = process.env.TZ || 'America/Sao_Paulo';
const WORK_OPEN_HOUR = parseInt(process.env.WORK_OPEN_HOUR || '9', 10);   // 09:00
const WORK_CLOSE_HOUR = parseInt(process.env.WORK_CLOSE_HOUR || '23', 10); // 23:59

const STATE_FILE = path.join(__dirname, 'arena_state.json');

if (!TOKEN || !GUILD_ID || !CHANNEL_ID) {
  console.error('❌ Missing ENV variables');
  process.exit(1);
}

/* ===================== CLIENT ===================== */

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ===================== STATE ===================== */

async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return { manualOverride: null };
  }
}

async function writeState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

/* ===================== LOG ===================== */

async function log(msg) {
  console.log(msg);
  if (!LOG_CHANNEL_ID) return;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(LOG_CHANNEL_ID);
    if (channel?.isTextBased()) await channel.send(`📝 ${msg}`);
  } catch {}
}

/* ===================== SCHEDULE ===================== */

function scheduledWorkOpen() {
  const now = DateTime.now().setZone(TIMEZONE);
  return (
    now.weekday === 7 && // Domingo
    now.hour >= WORK_OPEN_HOUR &&
    now.hour <= WORK_CLOSE_HOUR
  );
}

function effectiveWorkOpen(state) {
  if (state.manualOverride !== null) {
    return state.manualOverride.open;
  }
  return scheduledWorkOpen();
}

/* ===================== PERMISSIONS ===================== */

async function setChannelCommandsAllowed(allow) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);

  if (!channel.isTextBased()) return;

  await channel.permissionOverwrites.edit(guild.roles.everyone, {
    UseApplicationCommands: allow
  });
}

async function reconcile() {
  const state = await readState();
  const shouldBeOpen = effectiveWorkOpen(state);

  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);
  const perms = channel.permissionsFor(guild.roles.everyone);

  const isOpen = perms?.has(PermissionFlagsBits.UseApplicationCommands);

  if (isOpen !== shouldBeOpen) {
    await setChannelCommandsAllowed(shouldBeOpen);

    const embed = new EmbedBuilder()
      .setTitle(shouldBeOpen ? '💰 WORK LIBERADO' : '⛔ WORK ENCERRADO')
      .setColor(shouldBeOpen ? 0x00ff7f : 0x808080)
      .setTimestamp();

    try {
      await channel.send({ embeds: [embed] });
    } catch {}

    await log(`Reconciliação: WORK ${shouldBeOpen ? 'ABERTO' : 'FECHADO'}`);
  }
}

/* ===================== COMMANDS ===================== */

const commands = [
  new SlashCommandBuilder()
    .setName('status-work')
    .setDescription('Mostra o status atual do WORK'),

  new SlashCommandBuilder()
    .setName('forcar-work')
    .setDescription('Força abrir ou fechar o WORK')
    .addBooleanOption(o =>
      o.setName('open')
        .setDescription('true = abrir | false = fechar')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('clear-override')
    .setDescription('Remove override manual')
].map(c => c.toJSON());

/* ===================== READY ===================== */

client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await log('Bot iniciado');

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );

  await reconcile();

  // Reconciliação automática (auto-correção)
  cron.schedule('*/5 * * * *', reconcile, { timezone: TIMEZONE });

  // Avisos
  cron.schedule('0 21 * * 0', async () => {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(CHANNEL_ID);
    if (channel?.isTextBased())
      channel.send('⏳ Faltam **3 horas** para o fechamento do WORK');
  }, { timezone: TIMEZONE });

  cron.schedule('0 23 * * 0', async () => {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(CHANNEL_ID);
    if (channel?.isTextBased())
      channel.send('⚠️ **Última hora** para usar /work');
  }, { timezone: TIMEZONE });
});

/* ===================== INTERACTIONS ===================== */

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const state = await readState();
  const isAdmin =
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    (ADMIN_ROLE_ID && interaction.member.roles.cache.has(ADMIN_ROLE_ID));

  if (interaction.commandName === 'status-work') {
    const open = effectiveWorkOpen(state);
    await interaction.reply({
      content: open ? '✅ WORK LIBERADO' : '⛔ WORK BLOQUEADO',
      ephemeral: true
    });
  }

  if (interaction.commandName === 'forcar-work') {
    if (!isAdmin)
      return interaction.reply({ content: '🔒 Sem permissão', ephemeral: true });

    const open = interaction.options.getBoolean('open');
    state.manualOverride = {
      open,
      by: interaction.user.tag,
      at: new Date().toISOString()
    };

    await writeState(state);
    await reconcile();

    await interaction.reply({
      content: `✅ WORK forçado para **${open ? 'ABERTO' : 'FECHADO'}**`,
      ephemeral: true
    });
  }

  if (interaction.commandName === 'clear-override') {
    if (!isAdmin)
      return interaction.reply({ content: '🔒 Sem permissão', ephemeral: true });

    state.manualOverride = null;
    await writeState(state);
    await reconcile();

    await interaction.reply({
      content: '♻️ Override removido, sistema automático ativo',
      ephemeral: true
    });
  }
});

/* ===================== START ===================== */

client.login(TOKEN);
