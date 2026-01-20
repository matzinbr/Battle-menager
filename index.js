require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const cron = require('node-cron');

/*
  PROFESSIONAL ARENA CONTROLLER
  Env required: TOKEN, GUILD_ID, CHANNEL_ID
  Optional: LOG_CHANNEL_ID, ADMIN_ROLE_ID, TZ
*/

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;
const TIMEZONE = process.env.TZ || 'America/Sao_Paulo';

if (!TOKEN || !GUILD_ID || !CHANNEL_ID) {
  console.error('Missing required environment variables. Ensure TOKEN, GUILD_ID and CHANNEL_ID are set.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// --- State ---
let workLiberado = false;

// --- Helper: logging to console + log channel (if set) ---
async function log(message) {
  console.log(message);
  if (!LOG_CHANNEL_ID) return;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel && logChannel.send) {
      await logChannel.send(`📝 ${message}`);
    }
  } catch (err) {
    console.error('Falha ao enviar log para canal:', err);
  }
}

// --- Helper: set channel permission (allow or deny Use Application Commands for @everyone) ---
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

// --- Helper: read current channel state for UseApplicationCommands ---
async function getChannelCommandsAllowed(guildId, channelId) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    const everyonePerms = channel.permissionsFor(guild.roles.everyone);
    if (!everyonePerms) return false;
    return everyonePerms.has(PermissionFlagsBits.UseApplicationCommands);
  } catch (err) {
    console.error('Erro ao ler permissões do canal:', err);
    return false;
  }
}

// --- Commands definition (guild-scoped for instantaneous registration) ---
const commands = [
  new SlashCommandBuilder()
    .setName('status-work')
    .setDescription('Mostra se o WORK está liberado ou bloqueado'),

  new SlashCommandBuilder()
    .setName('forcar-work')
    .setDescription('Força a liberação do /work (apenas staff)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // fallback for admins
    .addBooleanOption(opt =>
      opt.setName('open')
         .setDescription('true para abrir, false para fechar')
         .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('fechar-work')
    .setDescription('Fecha o /work imediatamente (apenas staff)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('announce-duel')
    .setDescription('Anuncia um duelo na arena (staff)')
    .addUserOption(o => o.setName('challenger').setDescription('Desafiante').setRequired(true))
    .addUserOption(o => o.setName('opponent').setDescription('Oponente').setRequired(true))
    .addStringOption(o => o.setName('note').setDescription('Observação / odds (opcional)')),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

// --- READY: register commands, sync initial state, start crons ---
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await log(`Bot online: ${client.user.tag}`);

  // Register guild commands
  try {
    console.log('🔄 Registrando comandos de guild...');
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('✅ Comandos registrados!');
    await log('Comandos registrados no guild.');
  } catch (err) {
    console.error('Erro ao registrar comandos:', err);
    await log('Erro ao registrar comandos: ' + (err.message || err));
  }

  // Initialize workLiberado according to current channel permissions
  try {
    workLiberado = await getChannelCommandsAllowed(GUILD_ID, CHANNEL_ID);
    console.log('Estado inicial workLiberado =', workLiberado);
    await log(`Estado inicial: workLiberado = ${workLiberado}`);
  } catch (err) {
    console.error('Erro ao inicializar estado do canal:', err);
  }

  // Cron jobs (professional schedule)
  // Domingo 09:00 - abre
  cron.schedule('0 9 * * 0', async () => {
    try {
      const channel = await setChannelCommandsAllowed(GUILD_ID, CHANNEL_ID, true);
      if (channel) {
        workLiberado = true;
        const embed = new EmbedBuilder()
          .setTitle('💰 WORK LIBERADO')
          .setDescription('Hoje, até 00:00, o comando `/work` foi liberado exclusivamente para apostas.\nUse `/work` e receba 270 yens para participar.')
          .setColor(0x00FF7F)
          .setTimestamp();
        await channel.send({ embeds: [embed] });
        await log('WORK liberado automaticamente (cron).');
      } else {
        await log('Falha ao liberar WORK (cron).');
      }
    } catch (err) {
      console.error('Erro no cron de liberação:', err);
      await log('Erro no cron de liberação: ' + (err.message || err));
    }
  }, { timezone: TIMEZONE });

  // Domingo 21:00 - aviso (3 horas para fechamento)
  cron.schedule('0 21 * * 0', async () => {
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const channel = await guild.channels.fetch(CHANNEL_ID);
      const embed = new EmbedBuilder()
        .setTitle('⏳ Aviso de fechamento')
        .setDescription('Faltam 3 horas para o fechamento das apostas. Use `/work` se ainda não usou.')
        .setColor(0xFFD700)
        .setTimestamp();
      await channel.send({ embeds: [embed] });
      await log('Aviso: 3 horas para fechamento enviado.');
    } catch (err) {
      console.error('Erro no cron de aviso 3h:', err);
      await log('Erro no cron de aviso 3h: ' + (err.message || err));
    }
  }, { timezone: TIMEZONE });

  // Domingo 23:00 - aviso final (1 hora)
  cron.schedule('0 23 * * 0', async () => {
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const channel = await guild.channels.fetch(CHANNEL_ID);
      const embed = new EmbedBuilder()
        .setTitle('⚠️ Última chamada')
        .setDescription('Falta 1 hora para o fechamento das apostas. Última chance para usar `/work` e apostar.')
        .setColor(0xFF4500)
        .setTimestamp();
      await channel.send({ embeds: [embed] });
      await log('Aviso final: 1 hora para fechamento enviado.');
    } catch (err) {
      console.error('Erro no cron de aviso 1h:', err);
      await log('Erro no cron de aviso 1h: ' + (err.message || err));
    }
  }, { timezone: TIMEZONE });

  // Segunda 00:00 - fecha
  cron.schedule('0 0 * * 1', async () => {
    try {
      const channel = await setChannelCommandsAllowed(GUILD_ID, CHANNEL_ID, false);
      if (channel) {
        workLiberado = false;
        const embed = new EmbedBuilder()
          .setTitle('⛔ WORK ENCERRADO')
          .setDescription('As apostas foram encerradas. Boa semana!')
          .setColor(0x808080)
          .setTimestamp();
        await channel.send({ embeds: [embed] });
        await log('WORK encerrado automaticamente (cron).');
      } else {
        await log('Falha ao encerrar WORK (cron).');
      }
    } catch (err) {
      console.error('Erro no cron de encerramento:', err);
      await log('Erro no cron de encerramento: ' + (err.message || err));
    }
  }, { timezone: TIMEZONE });
});

// --- Interaction handling ---
client.on('interactionCreate', async interaction => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;

    // Helper: check admin role or Administrator permission
    const isAdmin = () => {
      if (ADMIN_ROLE_ID && interaction.member && interaction.member.roles) {
        if (interaction.member.roles.cache.has(ADMIN_ROLE_ID)) return true;
      }
      // fallback to server admin permission
      try {
        return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
      } catch {
        return false;
      }
    };

    // /status-work
    if (name === 'status-work') {
      const allowed = await getChannelCommandsAllowed(GUILD_ID, CHANNEL_ID);
      await interaction.reply({
        content: allowed ? '✅ WORK LIBERADO (comandos habilitados no canal)' : '⛔ WORK BLOQUEADO (comandos desabilitados no canal)',
        ephemeral: true
      });
      return;
    }

    // /forcar-work open:true/false
    if (name === 'forcar-work') {
      if (!isAdmin()) {
        await interaction.reply({ content: '🔒 Apenas staff pode usar este comando.', ephemeral: true });
        return;
      }
      const open = interaction.options.getBoolean('open', true);
      const channel = await setChannelCommandsAllowed(GUILD_ID, CHANNEL_ID, open);
      if (channel) {
        workLiberado = open;
        const embed = new EmbedBuilder()
          .setTitle(open ? '💥 WORK ABERTO (FORÇADO)' : '🔒 WORK FECHADO (FORÇADO)')
          .setDescription(open ? 'O /work foi aberto manualmente pela staff.' : 'O /work foi fechado manualmente pela staff.')
          .setColor(open ? 0x00FF7F : 0xFF4500)
          .setTimestamp();
        await channel.send({ embeds: [embed] });
        await interaction.reply({ content: `✅ Operação realizada: work ${open ? 'aberto' : 'fechado'}.`, ephemeral: true });
        await log(`Comando forcar-work: work ${open ? 'aberto' : 'fechado'} por ${interaction.user.tag}`);
      } else {
        await interaction.reply({ content: '❌ Falha ao alterar permissões do canal.', ephemeral: true });
      }
      return;
    }

    // /fechar-work
    if (name === 'fechar-work') {
      if (!isAdmin()) {
        await interaction.reply({ content: '🔒 Apenas staff pode usar este comando.', ephemeral: true });
        return;
      }
      const channel = await setChannelCommandsAllowed(GUILD_ID, CHANNEL_ID, false);
      if (channel) {
        workLiberado = false;
        const embed = new EmbedBuilder()
          .setTitle('⛔ WORK FECHADO (MANUAL)')
          .setDescription('As apostas foram encerradas manualmente pela staff.')
          .setColor(0x808080)
          .setTimestamp();
        await channel.send({ embeds: [embed] });
        await interaction.reply({ content: '✅ WORK fechado manualmente.', ephemeral: true });
        await log(`Comando fechar-work usado por ${interaction.user.tag}`);
      } else {
        await interaction.reply({ content: '❌ Falha ao fechar work.', ephemeral: true });
      }
      return;
    }

    // /announce-duel
    if (name === 'announce-duel') {
      if (!isAdmin()) {
        await interaction.reply({ content: '🔒 Apenas staff pode anunciar duelos.', ephemeral: true });
        return;
      }
      const challenger = interaction.options.getUser('challenger', true);
      const opponent = interaction.options.getUser('opponent', true);
      const note = interaction.options.getString('note') || '';
      // Build embed
      const embed = new EmbedBuilder()
        .setTitle('🏯 CONFRONTO DE FEITICEIROS 🏯')
        .addFields(
          { name: 'Lutadores', value: `${challenger} VS ${opponent}`, inline: false },
          { name: 'Status', value: '🔴 Apostas Abertas!', inline: false },
        )
        .setFooter({ text: note || 'Use u!give @Supervisor <valor> para apostar' })
        .setTimestamp()
        .setColor(0x6A0DAD);
      // send to arena channel
      const guild = await client.guilds.fetch(GUILD_ID);
      const channel = await guild.channels.fetch(CHANNEL_ID);
      await channel.send({ embeds: [embed] });
      await interaction.reply({ content: '✅ Duelo anunciado!', ephemeral: true });
      await log(`Duel announced: ${challenger.tag} vs ${opponent.tag} by ${interaction.user.tag}`);
      return;
    }
  } catch (err) {
    console.error('Erro ao processar interação:', err);
    try {
      if (interaction && !interaction.replied) await interaction.reply({ content: '❌ Ocorreu um erro ao executar o comando.', ephemeral: true });
    } catch { /* ignore */ }
  }
});

// --- Login ---
client.login(TOKEN).catch(err => {
  console.error('Falha ao logar com o token:', err);
  process.exit(1);
});
