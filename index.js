require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { DateTime } = require('luxon');

/* ================= CONFIG ================= */

const TOKEN = process.env.TOKEN;
const GUILD_ID = '1461942839331127520';

const FUNDER_ROLE = '1463413721970769973'; // Fundador
const ADMIN_PERMISSION = PermissionFlagsBits.Administrator;

const TZ = 'America/Sao_Paulo';
const DATA_FILE = path.join(__dirname, 'ranking.json');

/* ================= CLIENT ================= */

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ================= DATA ================= */

async function loadData() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  } catch {
    return { players: {}, workUsed: {} };
  }
}

async function saveData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

function ensurePlayer(data, user) {
  if (!data.players[user.id]) {
    data.players[user.id] = {
      name: user.username,
      wins: 0,
      losses: 0,
      streak: 0,
      balance: 600,
      inventory: {
        sukuna_finger: 0,
        gokumonkyo: 0
      }
    };
  }
}

/* ================= TIME ================= */

function isValidSunday() {
  const now = DateTime.now().setZone(TZ);
  return now.weekday === 7 && now.hour >= 9 && now.hour <= 23;
}

/* ================= COMMANDS ================= */

const commands = [
  new SlashCommandBuilder()
    .setName('shenanigans_bet')
    .setDescription('Ganhe yens (somente domingo – staff/fundadores)'),

  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Ver seu perfil'),

  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Ver ranking'),

  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Trocar itens')
    .addUserOption(o => o.setName('usuario').setDescription('Quem recebe').setRequired(true))
    .addStringOption(o =>
      o.setName('item')
        .setDescription('Item')
        .setRequired(true)
        .addChoices(
          { name: 'Sukuna Finger', value: 'sukuna_finger' },
          { name: 'Gokumonkyo', value: 'gokumonkyo' }
        )
    )
    .addIntegerOption(o =>
      o.setName('quantidade')
        .setDescription('Quantidade')
        .setRequired(true)
        .setMinValue(1)
    )
].map(c => c.toJSON());

/* ================= READY ================= */

client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );
});

/* ================= INTERACTIONS ================= */

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const data = await loadData();
  ensurePlayer(data, interaction.user);

  const member = interaction.member;
  const isAdmin = member.permissions.has(ADMIN_PERMISSION) || member.roles.cache.has(FUNDER_ROLE);

  /* ===== SHENANIGANS BET ===== */
  if (interaction.commandName === 'shenanigans_bet') {
    if (!isAdmin) {
      return interaction.reply({ content: '❌ Apenas staff ou fundadores.', ephemeral: true });
    }

    if (!isValidSunday()) {
      return interaction.reply({ content: '⛔ Só funciona domingo (09:00–23:59).', ephemeral: true });
    }

    const today = DateTime.now().setZone(TZ).toISODate();
    if (data.workUsed[interaction.user.id] === today) {
      return interaction.reply({ content: '⚠️ Você já usou hoje.', ephemeral: true });
    }

    const gain = 270;
    data.players[interaction.user.id].balance += gain;
    data.workUsed[interaction.user.id] = today;

    await saveData(data);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🎲 Shenanigans Bet')
          .setDescription(`Você ganhou **${gain} yens** 💴`)
          .setColor(0x00ff99)
      ]
    });
  }

  /* ===== PROFILE ===== */
  if (interaction.commandName === 'profile') {
    const p = data.players[interaction.user.id];

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`📊 ${p.name}`)
          .setDescription(
            `💴 Yens: **${p.balance}**\n` +
            `🏆 Vitórias: **${p.wins}**\n` +
            `📦 Sukuna Finger: **${p.inventory.sukuna_finger}**\n` +
            `📦 Gokumonkyo: **${p.inventory.gokumonkyo}**`
          )
          .setColor(0x0099ff)
      ],
      ephemeral: true
    });
  }

  /* ===== RANK ===== */
  if (interaction.commandName === 'rank') {
    const list = Object.values(data.players)
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 10);

    const desc = list.length
      ? list.map((p, i) => `**${i + 1}. ${p.name}** — ${p.wins} wins`).join('\n')
      : 'Nenhum registro ainda.';

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🏆 Ranking')
          .setDescription(desc)
          .setColor(0xffcc00)
      ]
    });
  }

  /* ===== TRADE ===== */
  if (interaction.commandName === 'trade') {
    const target = interaction.options.getUser('usuario');
    const item = interaction.options.getString('item');
    const qty = interaction.options.getInteger('quantidade');

    ensurePlayer(data, target);

    const sender = data.players[interaction.user.id];
    const receiver = data.players[target.id];

    if (sender.inventory[item] < qty) {
      return interaction.reply({ content: '❌ Itens insuficientes.', ephemeral: true });
    }

    sender.inventory[item] -= qty;
    receiver.inventory[item] += qty;

    await saveData(data);

    return interaction.reply(`🔁 Trade realizado: **${qty}x ${item}** enviado para ${target.username}`);
  }
});

/* ================= LOGIN ================= */

client.login(TOKEN);
