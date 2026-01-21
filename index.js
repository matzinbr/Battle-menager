const { Client, GatewayIntentBits, SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');
const ranking = require('./ranking');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Ver seu perfil e estatísticas'),

  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Trocar itens colecionáveis por títulos')
    .addStringOption(opt =>
      opt
        .setName('item')
        .setDescription('Item para trocar')
        .setRequired(true)
        .addChoices(
          { name: 'Sukuna Finger', value: 'sukuna' },
          { name: 'Gokumonkyō', value: 'gokumonkyo' }
        )
    ),

  new SlashCommandBuilder()
    .setName('shenanigans_bet')
    .setDescription('Apostar yens no evento Shenanigans'),

  new SlashCommandBuilder()
    .setName('bank')
    .setDescription('Ver saldo da carteira e do banco'),

  new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Sacar dinheiro do banco')
    .addIntegerOption(opt =>
      opt
        .setName('valor')
        .setDescription('Valor para sacar')
        .setRequired(true)
    )
];

/* ================= REGISTER ================= */
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('⏳ Registrando comandos...');
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands.map(cmd => cmd.toJSON()) }
    );
    console.log('✅ Comandos registrados!');
  } catch (err) {
    console.error('❌ Erro ao registrar comandos:', err);
  }
})();

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'profile') {
    const profile = await ranking.getProfile(interaction.user.id);
    if (!profile) {
      return interaction.reply('Você ainda não possui perfil.');
    }

    return interaction.reply(
      `👤 **${profile.name}**
🏆 Vitórias: ${profile.wins}
💀 Derrotas: ${profile.losses}
🔥 Streak: ${profile.streak}
💰 Carteira: ${profile.wallet} yens
🏦 Banco: ${profile.bank} yens`
    );
  }

  if (interaction.commandName === 'trade') {
    const item = interaction.options.getString('item');
    const result = await ranking.tradeItem(interaction.user.id, item);

    if (!result.success) {
      return interaction.reply(result.message);
    }

    const role = interaction.guild.roles.cache.get(result.reward.roleId);
    if (role) {
      await interaction.member.roles.add(role);
    }

    return interaction.reply('✅ Troca realizada com sucesso!');
  }

  if (interaction.commandName === 'bank') {
    const profile = await ranking.getProfile(interaction.user.id);
    if (!profile) return interaction.reply('Perfil não encontrado.');

    return interaction.reply(
      `💰 Carteira: ${profile.wallet} yens\n🏦 Banco: ${profile.bank} yens`
    );
  }

  if (interaction.commandName === 'withdraw') {
    const valor = interaction.options.getInteger('valor');
    const profile = await ranking.getProfile(interaction.user.id);

    if (!profile || profile.bank < valor) {
      return interaction.reply('Saldo insuficiente.');
    }

    profile.bank -= valor;
    profile.wallet += valor;
    await ranking.saveRanking({ players: { [interaction.user.id]: profile } });

    return interaction.reply(`✅ Você sacou ${valor} yens.`);
  }

  if (interaction.commandName === 'shenanigans_bet') {
    return interaction.reply('🎲 Aposta registrada!');
  }
});

/* ================= READY ================= */
client.once('ready', () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
});

client.login(TOKEN);
