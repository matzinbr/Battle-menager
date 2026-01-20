require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const cron = require('node-cron');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// --- Config via ENV ---
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const TIMEZONE = process.env.TZ || 'America/Sao_Paulo';

// --- Estado ---
let workLiberado = false;

// --- Helper para editar permissões do canal ---
async function setChannelCommandsAllowed(guildId, channelId, allow) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    const everyoneRole = guild.roles.everyone;
    await channel.permissionOverwrites.edit(everyoneRole, {
      UseApplicationCommands: allow
    });
    return channel;
  } catch (err) {
    console.error('Erro ao editar permissões do canal:', err);
    return null;
  }
}

// --- Definição do(s) comando(s) ---
const commands = [
  new SlashCommandBuilder()
    .setName('status-work')
    .setDescription('Mostra se o WORK está liberado ou bloqueado')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

// --- Ready: registrar comandos e iniciar crons ---
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);

  // Registrar slash commands no guild (garante registro imediato apenas no servidor)
  try {
    console.log('🔄 Registrando comandos de guild...');
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands }
    );
    console.log('✅ Comandos registrados!');
  } catch (err) {
    console.error('Erro ao registrar comandos:', err);
  }

  // Cron: Domingo 09:00 - libera
  cron.schedule('0 9 * * 0', async () => {
    const channel = await setChannelCommandsAllowed(GUILD_ID, CHANNEL_ID, true);
    if (channel) {
      workLiberado = true;
      try { await channel.send('💰 **WORK LIBERADO**\n\nUse `/work` até 00:00 para receber **270 yens** para apostas.'); } catch(e){ console.error(e); }
      console.log('WORK liberado');
    } else {
      console.log('Falha ao liberar WORK');
    }
  }, { timezone: TIMEZONE });

  // Cron: Segunda 00:00 - bloqueia
  cron.schedule('0 0 * * 1', async () => {
    const channel = await setChannelCommandsAllowed(GUILD_ID, CHANNEL_ID, false);
    if (channel) {
      workLiberado = false;
      try { await channel.send('⛔ **WORK ENCERRADO**\nApostas fechadas. Boa semana!'); } catch(e){ console.error(e); }
      console.log('WORK encerrado');
    } else {
      console.log('Falha ao encerrar WORK');
    }
  }, { timezone: TIMEZONE });
});

// --- Interactions (comandos) ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'status-work') {
    await interaction.reply({
      content: workLiberado ? '✅ WORK LIBERADO' : '⛔ WORK BLOQUEADO',
      ephemeral: true
    });
  }
});

// --- Login (apenas 1 vez) ---
client.login(process.env.TOKEN);
