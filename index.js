/**
 * Arena Controller - Professional Edition
 * - Auto schedule (cron) to open/close /work
 * - Manual overrides persisted to disk (state.json)
 * - Reconciliation loop to keep channel permissions consistent
 * - Slash commands: /status-work, /forcar-work, /clear-override
 *
 * ENV required: TOKEN, GUILD_ID, CHANNEL_ID
 * Optional: LOG_CHANNEL_ID, ADMIN_ROLE_ID, TZ, WORK_OPEN_HOUR, WORK_CLOSE_HOUR
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { DateTime } = require('luxon');
const cron = require('node-cron');

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;
const TIMEZONE = process.env.TZ || 'America/Sao_Paulo';
const WORK_OPEN_HOUR = parseInt(process.env.WORK_OPEN_HOUR || '9', 10);  // default 09:00
const WORK_CLOSE_HOUR = parseInt(process.env.WORK_CLOSE_HOUR || '24', 10); // default up to 23:59

const STATE_FILE = path.join(__dirname, 'arena_state.json');

if (!TOKEN || !GUILD_ID || !CHANNEL_ID) {
  console.error('Missing required environment variables: TOKEN, GUILD_ID, CHANNEL_ID');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

// ---------- Utilities ----------
async function readState() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return { manualOverride: null }; // default state
  }
}

async function writeState(state) {
  try {
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write state file:', err);
  }
}

async function logToChannel(msg) {
  console.log(msg);
  if (!LOG_CHANNEL_ID) return;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const ch = await guild.channels.fetch(LOG_CHANNEL_ID);
    if (ch && ch.send) await ch.send(`📝 ${msg}`);
  } catch (err) {
    console.error('Failed to send log to channel:', err);
  }
}

/**
 * Compute whether work should be open by schedule (ignores manual override)
 * Rule: Sunday (Luxon weekday===7) and hour in [WORK_OPEN_HOUR, WORK_CLOSE_HOUR)
 */
function scheduledWorkOpen() {
  const now = DateTime.now().setZone(TIMEZONE);
  const weekday = now.weekday; // 1=Mon ... 7=Sun
  const hour = now.hour;
  return (weekday === 7) && (hour >= WORK_OPEN_HOUR && hour < WORK_CLOSE_HOUR);
}

/**
 * Determine effective work open state:
 * - manualOverride if present (object { open: bool, by: 'user#discrim', at: ISO })
 * - otherwise scheduledWorkOpen
 */
function effectiveWorkOpen(state) {
  if (state && state.manualOverride && typeof state.manualOverride.open === 'boolean') {
    return state.manualOverride.open;
  }
  return scheduledWorkOpen();
}

/**
 * Set channel permission UseApplicationCommands for @everyone
 */
async function setChannelCommandsAllowed(allow) {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(CHANNEL_ID);
    const everyoneRole = guild.roles.everyone;
    await channel.permissionOverwrites.edit(everyoneRole, {
      UseApplicationCommands: allow
    });
    return channel;
  } catch (err) {
    console.error('Error editing channel permissions:', err);
    return null;
  }
}

/**
 * Reconcile channel permissions according to effective state.
 * Returns true if changed/applied, false otherwise.
 */
async function reconcileAndApply(state) {
  try {
    const shouldBeOpen = effectiveWorkOpen(state);
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(CHANNEL_ID);
    const perms = channel.permissionsFor(guild.roles.everyone);
    const currentlyAllowed = perms ? perms.has(PermissionFlagsBits.UseApplicationCommands) : false;
    if (currentlyAllowed !== shouldBeOpen) {
      await setChannelCommandsAllowed(shouldBeOpen);
      const embed = new EmbedBuilder()
        .setTitle(shouldBeOpen ? '💰 WORK LIBERADO' : '⛔ WORK ENCERRADO')
        .setDescription(shouldBeOpen ? `Com base na programação/override, /work está aberto.` : `Com base na programação/override, /work está fechado.`)
        .setTimestamp()
        .setColor(shouldBeOpen ? 0x00FF7F : 0x808080);
      try { await channel.send({ embeds: [embed] }); } catch (e) { /* ignore */ }
      await logToChannel(`Reconciled: work set to ${shouldBeOpen ? 'OPEN' : 'CLOSED'}`);
      return true;
    }
    return false;
  } catch (err) {
    console.error('Reconcile failed:', err);
    return false;
  }
}

// ---------- Slash commands ----------
const commands = [
  new SlashCommandBuilder().setName('status-work').setDescription('Mostra se o WORK está liberado ou bloqueado'),

  new SlashCommandBuilder()
    .setName('forcar-work')
    .setDescription('Força abrir ou fechar o /work (apenas staff)')
    .addBooleanOption(opt => opt.setName('open').setDescription('true para abrir, false para fechar').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clear-override')
    .setDescription('Remove o override manual e volta ao agendamento (apenas staff)')
].map(cmd => cmd.toJSON());

// ---------- Ready ----------
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await logToChannel(`Bot online: ${client.user.tag}`);

  // Register guild commands (so they appear immediately)
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Registered slash commands.');
    await logToChannel('Slash commands registered.');
  } catch (err) {
    console.error('Failed to register commands:', err);
    await logToChannel('Failed to register commands: ' + (err.message || err));
  }

  // Ensure a state file exists
  let state = await readState();
  if (!state) state = { manualOverride: null };
  await writeState(state);

  // Initial reconciliation on startup
  await reconcileAndApply(state);

  // Cron jobs: schedule open/close/announcements
  // Open: Sunday 09:00
  cron.schedule('0 9 * * 0', async () => {
    const stateNow = await readState();
    // Only change if no manual override exists
    if (stateNow.manualOverride === null) {
      await setChannelCommandsAllowed(true);
      await logToChannel('Cron: WORK opened (09:00 Sunday).');
    } else {
      await logToChannel('Cron: WORK open time reached, but manual override present. No automatic change.');
    }
  }, { timezone: TIMEZONE });

  // Warning 3h before: Sunday 21:00
  cron.schedule('0 21 * * 0', async () => {
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const ch = await guild.channels.fetch(CHANNEL_ID);
      const embed = new EmbedBuilder()
        .setTitle('⏳ Aviso: 3 horas para fechamento das apostas')
        .setDescription('Use `/work` se deseja participar desta rodada.')
        .setTimestamp()
        .setColor(0xFFD700);
      await ch.send({ embeds: [embed] });
      await logToChannel('Cron: 3h warning sent.');
    } catch (e) {
      console.error('Warning cron failed:', e);
    }
  }, { timezone: TIMEZONE });

  // Warning 1h before: Sunday 23:00
  cron.schedule('0 23 * * 0', async () => {
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const ch = await guild.channels.fetch(CHANNEL_ID);
      const embed = new EmbedBuilder()
        .setTitle('⚠️ Última chamada: 1 hora para fechamento')
        .setDescription('Última chance para usar `/work` e participar das apostas.')
        .setTimestamp()
        .setColor(0xFF4500);
      await ch.send({ embeds: [embed] });
      await logToChannel('Cron: 1h warning sent.');
    } catch (e) {
      console.error('1h warning failed:', e);
    }
  }, { timezone: TIMEZONE });

  // Close: Monday 00:00
  cron.schedule('0 0 * * 1', async () => {
    const stateNow = await readState();
    if (stateNow.manualOverride === null) {
      await setChannelCommandsAllowed(false);
      await logToChannel('Cron: WORK closed (00:00 Monday).');
    } else {
      await logToChannel('Cron: WORK close time reached, but manual override present. No automatic change.');
    }
  }, { timezone: TIMEZONE });

  // Reconciliation loop: every 5 minutes ensure permission matches effective state
  cron.schedule('*/5 * * * *', async () => {
    const stateNow = await readState();
    await reconcileAndApply(stateNow);
  }, { timezone: TIMEZONE });
});

// ---------- Interaction handling ----------
client.on('interactionCreate', async interaction => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;
    const state = await readState();

    // helper to check admin via ADMIN_ROLE_ID or Administrator perm
    const isAdmin = () => {
      try {
        if (ADMIN_ROLE_ID && interaction.member && interaction.member.roles) {
          if (interaction.member.roles.cache.has(ADMIN_ROLE_ID)) return true;
        }
        return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
      } catch {
        return false;
      }
    };

    if (name === 'status-work') {
      const effective = effectiveWorkOpen(state);
      const embed = new EmbedBuilder()
        .setTitle(effective ? '✅ WORK LIBERADO' : '⛔ WORK BLOQUEADO')
        .setDescription(effective ? 'O /work está disponível agora.' : 'O /work está fechado agora.')
        .addFields(
          { name: 'Scheduling', value: `Aberto: Domingo ${WORK_OPEN_HOUR}:00 → ${WORK_CLOSE_HOUR - 1}:59 (Timezone: ${TIMEZONE})`, inline: false },
          { name: 'Manual override', value: state.manualOverride ? `Sim — ${state.manualOverride.open ? 'ABERTO' : 'FECHADO'} (por ${state.manualOverride.by} em ${state.manualOverride.at})` : 'Não', inline: false }
        )
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (name === 'forcar-work') {
      if (!isAdmin()) {
        await interaction.reply({ content: '🔒 Apenas staff pode usar este comando.', ephemeral: true });
        return;
      }
      const open = interaction.options.getBoolean('open', true);
      const newState = state;
      newState.manualOverride = {
        open,
        by: `${interaction.user.tag}`,
        at: new Date().toISOString()
      };
      await writeState(newState);
      await setChannelCommandsAllowed(open);
      await reconcileAndApply(newState);
      await logToChannel(`Manual override by ${interaction.user.tag}: work ${open ? 'OPEN' : 'CLOSED'}`);
      await interaction.reply({ content: `✅ Override aplicado: work ${open ? 'aberto' : 'fechado'}.`, ephemeral: true });
      return;
    }

    if (name === 'clear-override') {
      if (!isAdmin()) {
        await interaction.reply({ content: '🔒 Apenas staff pode usar este comando.', ephemeral: true });
        return;
      }
      const newState = state;
      newState.manualOverride = null;
      await writeState(newState);
      // Apply scheduled state immediately
      await reconcileAndApply(newState);
      await logToChannel(`Manual override cleared by ${interaction.user.tag}`);
      await interaction.reply({ content: '✅ Override manual removido. Voltando ao agendamento.', ephemeral: true });
      return;
    }

  } catch (err) {
    console.error('Error handling interaction:', err);
    try {
      if (interaction && !interaction.replied) await interaction.reply({ content: '❌ Ocorreu um erro ao executar o comando.', ephemeral: true });
    } catch { /* ignore */ }
  }
});

// ---------- Startup login ----------
client.login(TOKEN)
  .then(() => console.log('Login successful'))
  .catch(err => {
    console.error('Failed to login:', err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});
