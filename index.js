require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Collection
} = require('discord.js');

const fs = require('fs');
const path = require('path');
const { recordMatch, getLeaderboard } = require('./ranking');

// ================= CONFIG =================
const GUILD_ID = '1461942839331127520';

const START_YENS = 600;

const ITEMS = {
  sukuna_finger: {
    name: 'Sukuna Finger',
    emoji: '<:sukuna_finger:1463407933449572352>'
  },
  gokumonkyo: {
    name: 'Gokumonkyō',
    emoji: '<:Gokumonkyo:1463408847556444233>'
  }
};

// ================= DATABASE =================
const DB_FILE = './database.json';

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getUser(db, id) {
  if (!db.users[id]) {
    db.users[id] = {
      wallet: START_YENS,
      bank: 0,
      inventory: {}
    };
  }
  return db.users[id];
}

// ================= CLIENT =================
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ================= COMMANDS =================
const commands = [
  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Ver seu saldo'),

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
    .setName('inventory')
    .setDescription('Ver seu inventário'),

  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Trocar item com outro usuário')
    .addUserOption(o =>
      o.setName('user').setDescription('Usuário').setRequired(true)
    )
    .addStringOption(o =>
      o.setName('item')
        .setDescription('Item')
        .setRequired(true)
        .addChoices(
          { name: 'Sukuna Finger', value: 'sukuna_finger' },
          { name: 'Gokumonkyō', value: 'gokumonkyo' }
        )
    )
    .addIntegerOption(o =>
      o.setName('quantidade').setDescription('Quantidade').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('x1_result')
    .setDescription('Registrar resultado do X1')
    .addUserOption(o =>
      o.setName('vencedor').setDescription('Vencedor').setRequired(true)
    )
    .addUserOption(o =>
      o.setName('perdedor').setDescription('Perdedor').setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('valor').setDescription('Valor apostado').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Ver ranking X1')
];

// ================= READY =================
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.set(commands);
  console.log('✅ Slash commands registrados');
});

// ================= INTERACTIONS =================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const db = loadDB();
  const user = getUser(db, interaction.user.id);

  // ===== BALANCE =====
  if (interaction.commandName === 'balance') {
    return interaction.reply(
      `💰 Carteira: **${user.wallet} yens**\n🏦 Banco: **${user.bank} yens**`
    );
  }

  // ===== DEPOSIT =====
  if (interaction.commandName === 'deposit') {
    const valor = interaction.options.getInteger('valor');
    if (valor <= 0 || valor > user.wallet)
      return interaction.reply({ content: '❌ Valor inválido', ephemeral: true });

    user.wallet -= valor;
    user.bank += valor;
    saveDB(db);
    return interaction.reply(`🏦 Depositado **${valor} yens**`);
  }

  // ===== WITHDRAW =====
  if (interaction.commandName === 'withdraw') {
    const valor = interaction.options.getInteger('valor');
    if (valor <= 0 || valor > user.bank)
      return interaction.reply({ content: '❌ Valor inválido', ephemeral: true });

    user.bank -= valor;
    user.wallet += valor;
    saveDB(db);
    return interaction.reply(`💸 Sacado **${valor} yens**`);
  }

  // ===== INVENTORY =====
  if (interaction.commandName === 'inventory') {
    const items = Object.entries(user.inventory);
    if (!items.length)
      return interaction.reply('🎒 Seu inventário está vazio');

    const text = items
      .map(([k, v]) => `${ITEMS[k].emoji} **${ITEMS[k].name}** x${v}`)
      .join('\n');

    return interaction.reply(`🎒 **Inventário:**\n${text}`);
  }

  // ===== TRADE =====
  if (interaction.commandName === 'trade') {
    const target = interaction.options.getUser('user');
    const item = interaction.options.getString('item');
    const qtd = interaction.options.getInteger('quantidade');

    if (target.id === interaction.user.id)
      return interaction.reply({ content: '❌ Você não pode trocar consigo mesmo', ephemeral: true });

    if (!user.inventory[item] || user.inventory[item] < qtd)
      return interaction.reply({ content: '❌ Você não tem itens suficientes', ephemeral: true });

    const targetUser = getUser(db, target.id);

    user.inventory[item] -= qtd;
    if (user.inventory[item] <= 0) delete user.inventory[item];

    targetUser.inventory[item] = (targetUser.inventory[item] || 0) + qtd;

    saveDB(db);

    return interaction.reply(
      `🔁 ${interaction.user} enviou **${qtd}x ${ITEMS[item].emoji} ${ITEMS[item].name}** para ${target}`
    );
  }

  // ===== X1 RESULT =====
  if (interaction.commandName === 'x1_result') {
    const vencedor = interaction.options.getUser('vencedor');
    const perdedor = interaction.options.getUser('perdedor');
    const valor = interaction.options.getInteger('valor');

    await recordMatch(vencedor, perdedor);

    return interaction.reply(
      `⚔️ **X1 Finalizado**\n🏆 ${vencedor} venceu ${perdedor}\n💰 Aposta: ${valor * 2} yens`
    );
  }

  // ===== RANK =====
  if (interaction.commandName === 'rank') {
    const top = await getLeaderboard();
    if (!top.length) return interaction.reply('🏆 Ranking vazio');

    const text = top
      .map((p, i) => `#${i + 1} **${p.name}** — ${p.wins} wins`)
      .join('\n');

    return interaction.reply(`🏆 **Ranking X1**\n${text}`);
  }
});

// ================= LOGIN =================
client.login(process.env.TOKEN);
