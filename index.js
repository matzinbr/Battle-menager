/**
 * ARENA BETS — WORK CONTROLLER
 * Professional & Stable Edition
 *
 * Features:
 * - Automatic Sunday WORK schedule
 * - Persistent manual override
 * - Auto reconciliation (self-healing)
 * - Slash commands for status & staff control
 *
 * Required ENV:
 * TOKEN, GUILD_ID, CHANNEL_ID
 *
 * Optional ENV:
 * TZ, ADMIN_ROLE_ID, LOG_CHANNEL_ID
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
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;
const TIMEZONE = process.env.TZ || 'America/Sao_Paulo';

const STATE_FILE = path.join(__dirname, 'arena_state.json');

/* ===================== VALIDATION ===================== */

if (!TOKEN || !GUILD_ID || !CHANNEL_ID) {
  console.error('❌ Missing ENV variables.');
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
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { override: null };
  }
}

async function writeState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

/* ===================== TIME LOGIC ===================== */

function isSundayOpen() {
  const now = DateTime.now().setZone(TIMEZONE);
  return now.weekday === 7 && now.hour >= 9 && now.hour < 24;
}

function effectiveState(state) {
  if (state.override !== null) return state.override;
  return isSundayOpen();
}

/* ===================== PERMISSIONS ===================== */

async function setWorkPermission(allow) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);
  await channel.permissionOverwrites.edit(guild.roles.everyone, {
    UseApplicationCommands: allow
  });
  return channel;
}

/* ===================== LOGGING ===================== */

async function log(msg) {
  console.log(msg);
  if (!LOG_CHANNEL_ID) return;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const ch = await guild.channels.fetch(LOG_CHANNEL_ID);
    await ch.send(`📝 ${msg}`);
  } catch {}
}

/* ===================== RECONCILE ===================== */

async function reconcile() {
  const state = await readState();
  const shouldOpen = effectiveState(state);

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
    await log(`Reconciliação automática → ${shouldOpen ? 'ABERTO' : 'FECHADO'}`);
  }
}

/* ===================== COMMANDS ===================== */

const commands = [
  new SlashCommandBuilder()
    .setName('status-work')
    .setDescription('Mostra se o WORK está aberto'),

  new SlashCommandBuilder()
    .setName('forcar-work')
    .setDescription('Força abrir ou fechar o WORK')
    .addBooleanOption(o =>
      o.setName('open').setDescription('Abrir ou fechar').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('clear-override')
    .setDescription('Remove override manual')
].map(c => c.toJSON());

/* ===================== READY ===================== */

client.once('ready', async () => {
  console.log(`✅ Online como ${client.user.tag}`);
  await log(`Bot online: ${client.user.tag}`);

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );

  await writeState(await readState());
  await reconcile();

  // Domingo 09:00
  cron.schedule('0 9 * * 0', reconcile, { timezone: TIMEZONE });

  // Segunda 00:00
  cron.schedule('0 0 * * 1', reconcile, { timezone: TIMEZONE });

  // Auto check a cada 5 min
  cron.schedule('*/5 * * * *', reconcile, { timezone: TIMEZONE });
});

/* ===================== INTERACTIONS ===================== */

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const state = await readState();

  const isAdmin =
    interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
    (ADMIN_ROLE_ID &&
      interaction.member.roles.cache.has(ADMIN_ROLE_ID));

  if (interaction.commandName === 'status-work') {
    const open = effectiveState(state);
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
    state.override = interaction.options.getBoolean('open');
    await writeState(state);
    await reconcile();
    return interaction.reply({ content: '✅ Override aplicado.', ephemeral: true });
  }

  if (interaction.commandName === 'clear-override') {
    state.override = null;
    await writeState(state);
    await reconcile();
    return interaction.reply({ content: '♻ Override removido.', ephemeral: true });
  }
});

/* ===================== LOGIN ===================== */

client.login(TOKEN);
