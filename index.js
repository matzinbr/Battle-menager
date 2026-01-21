require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const fs = require('fs');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1463220420818763787';
const GUILD_ID = '1461942839331127520';

// ======================
// CLIENT
// ======================
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ======================
// FILES
// ======================
const ECON_FILE = './economy.json';
const INV_FILE = './inventory.json';

function loadJSON(path, def) {
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, JSON.stringify(def, null, 2));
    return def;
  }
  return JSON.parse(fs.readFileSync(path));
}

function saveJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

// ======================
// SLASH COMMANDS
// ======================
const commands = [
  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Ver seu saldo de yens'),

  new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Depositar yens no banco')
    .addIntegerOption(o =>
      o.setName('valor').setDescription('Valor').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Sacar yens do banco')
    .addIntegerOption(o =>
      o.setName('valor').setDescription('Valor').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Ver seu inventário'),

  new SlashCommandBuilder()
    .setName('shenanigans_bet')
    .setDescription('Trabalhos duvidosos (apenas domingo, 1x por dia)')
];

// ======================
// REGISTER COMMANDS
// ======================
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('🔄 Registrando comandos...');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands.map(c => c.toJSON()) }
    );
    console.log('✅ Comandos registrados com sucesso!');
  } catch (e) {
    console.error('❌ Erro ao registrar comandos:', e);
  }
})();

// ======================
// READY
// ======================
client.once('ready', () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
});

// ======================
// INTERACTIONS
// ======================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const econ = loadJSON(ECON_FILE, {});
  const inv = loadJSON(INV_FILE, {});
  const id = interaction.user.id;

  if (!econ[id]) econ[id] = { wallet: 600, bank: 0, lastWork: null };
  if (!inv[id]) inv[id] = { items: {} };

  // ===== BALANCE =====
  if (interaction.commandName === 'balance') {
    return interaction.reply(
      `💴 **Yens**\nCarteira: ${econ[id].wallet}\nBanco: ${econ[id].bank}`
    );
  }

  // ===== DEPOSIT =====
  if (interaction.commandName === 'deposit') {
    const v = interaction.options.getInteger('valor');
    if (v <= 0 || v > econ[id].wallet)
      return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });

    econ[id].wallet -= v;
    econ[id].bank += v;
    saveJSON(ECON_FILE, econ);

    return interaction.reply(`🏦 Depositados ${v} yens.`);
  }

  // ===== WITHDRAW =====
  if (interaction.commandName === 'withdraw') {
    const v = interaction.options.getInteger('valor');
    if (v <= 0 || v > econ[id].bank)
      return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });

    econ[id].bank -= v;
    econ[id].wallet += v;
    saveJSON(ECON_FILE, econ);

    return interaction.reply(`💸 Sacados ${v} yens.`);
  }

  // ===== INVENTORY =====
  if (interaction.commandName === 'inventory') {
    const items = inv[id].items;
    if (Object.keys(items).length === 0)
      return interaction.reply('🎒 Inventário vazio.');

    let txt = '🎒 **Inventário:**\n';
    for (const i in items) txt += `• ${i}: ${items[i]}\n`;
    return interaction.reply(txt);
  }

  // ===== SHENANIGANS BET =====
  if (interaction.commandName === 'shenanigans_bet') {
    const now = new Date();
    const day = now.getDay(); // 0 = domingo
    if (day !== 0)
      return interaction.reply({ content: '❌ Só pode aos domingos.', ephemeral: true });

    const today = now.toDateString();
    if (econ[id].lastWork === today)
      return interaction.reply({ content: '❌ Você já usou hoje.', ephemeral: true });

    const gain = 270;
    econ[id].wallet += gain;
    econ[id].lastWork = today;
    saveJSON(ECON_FILE, econ);

    return interaction.reply(`😈 Você ganhou **${gain} yens** em esquemas duvidosos.`);
  }
});

// ======================
client.login(TOKEN);
