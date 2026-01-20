require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const cron = require('node-cron');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const TIMEZONE = process.env.TZ || 'America/Sao_Paulo';

client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
});

async function setChannelCommandsAllowed(guildId, channelId, allow) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    // edit permission overwrite for @everyone
    const everyoneRole = guild.roles.everyone;
    await channel.permissionOverwrites.edit(everyoneRole, {
      UseApplicationCommands: allow
    });
    return true;
  } catch (err) {
    console.error('Erro ao editar permissões do canal:', err);
    return false;
  }
}
// Domingo 09:00 - libera
cron.schedule('0 9 * * 0', async () => {
  if (!client.isReady()) return;
  const ok = await setChannelCommandsAllowed(GUILD_ID, CHANNEL_ID, true);
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);
  if (ok) {
    channel.send('💰 **WORK LIBERADO**\n\nUse `/work` até 00:00 para receber **270 yens** para apostas.');
    console.log('WORK liberado');
  } else {
    console.log('Falha ao liberar WORK');
  }
}, { timezone: TIMEZONE });

// Segunda 00:00 - bloqueia
cron.schedule('0 0 * * 1', async () => {
  if (!client.isReady()) return;
  const ok = await setChannelCommandsAllowed(GUILD_ID, CHANNEL_ID, false);
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);
  if (ok) {
    channel.send('⛔ **WORK ENCERRADO**\nApostas fechadas. Boa semana!');
    console.log('WORK encerrado');
  } else {
    console.log('Falha ao encerrar WORK');
  }
}, { timezone: TIMEZONE });

client.login(process.env.TOKEN);

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('status-work')
    .setDescription('Mostra se o WORK está liberado ou bloqueado')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('🔄 Registrando comandos...');
    await rest.put(
      Routes.applicationGuildCommands(
        client.user?.id || process.env.CLIENT_ID,
        GUILD_ID
      ),
      { body: commands }
    );
    console.log('✅ Comandos registrados!');
  } catch (error) {
    console.error(error);
  }
})();
let workLiberado = false;

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'status-work') {
    await interaction.reply({
      content: workLiberado ? '✅ WORK LIBERADO' : '⛔ WORK BLOQUEADO',
      ephemeral: true
    });
  }
});
client.login(process.env.TOKEN);

