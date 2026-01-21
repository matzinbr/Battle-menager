const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
  REST
} = require("discord.js");
const fs = require("fs");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const FUNDADOR_ROLE = "1463413721970769973";
const SUKUNA_ROLE = "1463413152824819753";
const HONORED_ROLE = "1463413249734086860";

const SUKUNA_ITEM = "sukuna_finger";
const GOKUMON_ITEM = "gokumonkyo";

const DATA_FILE = "./database.json";

/* ================== DATABASE ================== */

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ users: {} }, null, 2));
}

function loadDB() {
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveDB(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function getUser(db, id) {
  if (!db.users[id]) {
    db.users[id] = {
      wallet: 600,
      bank: 0,
      inventory: {
        sukuna_finger: 0,
        gokumonkyo: 0
      },
      lastWork: 0,
      streak: 0
    };
  }
  return db.users[id];
}

/* ================== CLIENT ================== */

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================== COMMANDS ================== */

const commands = [
  new SlashCommandBuilder()
    .setName("shenanigans_bet")
    .setDescription("Trabalhe e enfrente eventos caóticos"),

  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Veja seu saldo"),

  new SlashCommandBuilder()
    .setName("deposit")
    .setDescription("Depositar dinheiro no banco")
    .addIntegerOption(o =>
      o.setName("valor").setDescription("Valor").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("withdraw")
    .setDescription("Sacar dinheiro do banco")
    .addIntegerOption(o =>
      o.setName("valor").setDescription("Valor").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("Ver seu inventário")
];

/* ================== REGISTER ================== */

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: commands.map(c => c.toJSON())
  });
  console.log("✅ Comandos registrados");
})();

/* ================== EVENTS ================== */

client.once("ready", () => {
  console.log(`🤖 Online como ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const db = loadDB();
  const user = getUser(db, interaction.user.id);

  /* ===== BALANCE ===== */
  if (interaction.commandName === "balance") {
    return interaction.reply(
      `💴 Carteira: **${user.wallet} yens**\n🏦 Banco: **${user.bank} yens**`
    );
  }

  /* ===== DEPOSIT ===== */
  if (interaction.commandName === "deposit") {
    const valor = interaction.options.getInteger("valor");
    if (valor <= 0 || valor > user.wallet)
      return interaction.reply({ content: "❌ Valor inválido.", ephemeral: true });

    user.wallet -= valor;
    user.bank += valor;
    saveDB(db);

    return interaction.reply(`🏦 Depositado **${valor} yens**`);
  }

  /* ===== WITHDRAW ===== */
  if (interaction.commandName === "withdraw") {
    const valor = interaction.options.getInteger("valor");
    if (valor <= 0 || valor > user.bank)
      return interaction.reply({ content: "❌ Valor inválido.", ephemeral: true });

    user.bank -= valor;
    user.wallet += valor;
    saveDB(db);

    return interaction.reply(`💴 Sacado **${valor} yens**`);
  }

  /* ===== INVENTORY ===== */
  if (interaction.commandName === "inventory") {
    return interaction.reply(
      `🎒 **Inventário**\n` +
      `🩸 Sukuna Finger: ${user.inventory.sukuna_finger}\n` +
      `🗝️ Gokumonkyo: ${user.inventory.gokumonkyo}`
    );
  }

  /* ===== SHENANIGANS BET ===== */
  if (interaction.commandName === "shenanigans_bet") {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    if (now - user.lastWork < day)
      return interaction.reply({ content: "⏳ Você já usou hoje.", ephemeral: true });

    user.lastWork = now;
    user.streak++;

    let ganho = Math.floor(Math.random() * 200) + 100;

    // streak bônus
    if (user.streak >= 3) ganho += 100;

    // desastre (20%)
    if (Math.random() < 0.2) {
      user.wallet = Math.max(0, user.wallet - 150);
      user.streak = 0;
      saveDB(db);
      return interaction.reply("💥 **DESASTRE!** Você perdeu 150 yens.");
    }

    // itens
    if (Math.random() < 0.1) user.inventory.sukuna_finger++;
    if (Math.random() < 0.05) user.inventory.gokumonkyo++;

    user.wallet += ganho;

    /* ===== ROLES ===== */
    const member = await interaction.guild.members.fetch(interaction.user.id);

    if (user.inventory.sukuna_finger >= 2)
      await member.roles.add(SUKUNA_ROLE).catch(() => {});

    if (user.inventory.gokumonkyo >= 3)
      await member.roles.add(HONORED_ROLE).catch(() => {});

    if (member.roles.cache.has(FUNDADOR_ROLE))
      ganho += 100;

    saveDB(db);

    return interaction.reply(
      `🎲 Você ganhou **${ganho} yens**!\n🔥 Streak: ${user.streak}`
    );
  }
});

client.login(TOKEN);
