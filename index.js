require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
  REST
} = require('discord.js');

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1463220420818763787';
const GUILD_ID = '1461942839331127520';

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================= DATABASE (SIMPLES) ================= */
const users = {}; 
function getUser(id) {
  if (!users[id]) {
    users[id] = {
      wallet: 600,
      bank: 0,
      inventory: {}
    };
  }
  return users[id];
}

/* ================= COMMANDS ================= */
const commands = [

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Teste do bot'),

  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Ver seu dinheiro'),

  new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Depositar no banco')
    .addIntegerOption(o =>
      o.setName('valor').setDescription('Valor').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Sacar do banco')
    .addIntegerOption(o =>
      o.setName('valor').setDescription('Valor').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('work')
    .setDescription('Trabalhar para ganhar yens'),

  new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Ver inventário'),

  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Trocar item com alguém')
    .addUserOption(o =>
      o.setName('usuario').setDescription('Usuário').setRequired(true)
    )
    .addStringOption(o =>
      o.setName('item').setDescription('Item').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('shenanigans_bet')
    .setDescription('Apostar Shenanigans')
    .addIntegerOption(o =>
      o.setName('valor').setDescription('Valor').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Ranking de riqueza')

].map(c => c.toJSON());

/* ================= REGISTER ================= */
const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log('✅ Comandos registrados SEM duplicação');
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const user = getUser(interaction.user.id);

  /* ===== PING ===== */
  if (interaction.commandName === 'ping') {
    return interaction.reply('🏓 Pong!');
  }

  /* ===== BALANCE ===== */
  if (interaction.commandName === 'balance') {
    return interaction.reply(
      `💰 Carteira: ${user.wallet}¥\n🏦 Banco: ${user.bank}¥`
    );
  }

  /* ===== DEPOSIT ===== */
  if (interaction.commandName === 'deposit') {
    const valor = interaction.options.getInteger('valor');
    if (valor <= 0 || valor > user.wallet)
      return interaction.reply({ content: '❌ Valor inválido', ephemeral: true });

    user.wallet -= valor;
    user.bank += valor;
    return interaction.reply(`🏦 Depositado ${valor}¥`);
  }

  /* ===== WITHDRAW ===== */
  if (interaction.commandName === 'withdraw') {
    const valor = interaction.options.getInteger('valor');
    if (valor <= 0 || valor > user.bank)
      return interaction.reply({ content: '❌ Valor inválido', ephemeral: true });

    user.bank -= valor;
    user.wallet += valor;
    return interaction.reply(`💸 Sacado ${valor}¥`);
  }

  /* ===== WORK ===== */
  if (interaction.commandName === 'work') {
    const ganho = Math.floor(Math.random() * 300) + 100;
    user.wallet += ganho;
    return interaction.reply(`🛠️ Você trabalhou e ganhou ${ganho}¥`);
  }

  /* ===== INVENTORY ===== */
  if (interaction.commandName === 'inventory') {
    const items = Object.entries(user.inventory)
      .map(([i, q]) => `${i} x${q}`)
      .join('\n') || 'Vazio';

    return interaction.reply(`🎒 Inventário:\n${items}`);
  }

  /* ===== TRADE ===== */
  if (interaction.commandName === 'trade') {
    const target = interaction.options.getUser('usuario');
    const item = interaction.options.getString('item');

    if (!user.inventory[item])
      return interaction.reply({ content: '❌ Você não tem esse item', ephemeral: true });

    user.inventory[item]--;
    const targetUser = getUser(target.id);
    targetUser.inventory[item] = (targetUser.inventory[item] || 0) + 1;

    return interaction.reply(`🔁 Você deu **${item}** para ${target.username}`);
  }

  /* ===== SHENANIGANS BET ===== */
  if (interaction.commandName === 'shenanigans_bet') {
    const valor = interaction.options.getInteger('valor');
    if (valor <= 0 || valor > user.wallet)
      return interaction.reply({ content: '❌ Valor inválido', ephemeral: true });

    const win = Math.random() < 0.5;
    if (win) {
      user.wallet += valor;
      return interaction.reply(`🎉 Você ganhou ${valor}¥!`);
    } else {
      user.wallet -= valor;
      return interaction.reply(`💀 Você perdeu ${valor}¥`);
    }
  }

  /* ===== RANKING ===== */
  if (interaction.commandName === 'ranking') {
    const top = Object.entries(users)
      .sort((a, b) => (b[1].wallet + b[1].bank) - (a[1].wallet + a[1].bank))
      .slice(0, 5)
      .map(([id, u], i) => `#${i + 1} <@${id}> — ${u.wallet + u.bank}¥`)
      .join('\n');

    return interaction.reply(`🏆 Ranking:\n${top || 'Sem dados'}`);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);
