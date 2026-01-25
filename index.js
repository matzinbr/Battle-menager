// ======================================================
// Battle Manager — MASTER EDITION
// Node.js 20 LTS | discord.js v14 | ESM
// ======================================================

// ===== Polyfill ReadableStream para compatibilidade cloud =====
import { ReadableStream } from 'stream/web';
globalThis.ReadableStream ??= ReadableStream;

// ===================================================
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import crypto from 'crypto';

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors
} from 'discord.js';

// ================= CONFIG =================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error('TOKEN, CLIENT_ID e GUILD_ID são obrigatórios');
}

// ================= CONSTANTES =================
const TZ = 'America/Sao_Paulo';
const START_YENS = 600;
const MAX_WALLET = 5000;
const SHEN_BASE = 270;
const DISASTER_CHANCE = 0.05;
const MAX_LOGS = 500;
const BACKUP_INTERVAL_MIN = 10;

// ================= PATHS =================
const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, 'data.json');
const BACKUP_DIR = path.join(ROOT, 'backups');

if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

// ================= UTIL =================
const now = () => DateTime.now().setZone(TZ);
const todayISO = () => now().toISODate();

// ================= SAFE DB =================
let writeQueue = Promise.resolve();

async function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

function queueWrite(db) {
  writeQueue = writeQueue.then(() => atomicWrite(DATA_PATH, db));
  return writeQueue;
}

async function loadDB() {
  if (!existsSync(DATA_PATH)) {
    const base = {
      players: {},
      logs: [],
      meta: { createdAt: now().toISO() }
    };
    await atomicWrite(DATA_PATH, base);
    return base;
  }
  return JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
}

const db = await loadDB();

// ================= PLAYERS =================
function getPlayer(user) {
  if (!db.players[user.id]) {
    db.players[user.id] = {
      id: user.id,
      name: user.username,
      wallet: START_YENS,
      bank: 0,
      inventory: {
        sukuna_finger: 0,
        gokumonkyo: 0
      },
      wins: 0,
      losses: 0,
      streak: 0,
      shenanigans: {
        lastSunday: null
      }
    };
  }
  db.players[user.id].name = user.username;
  return db.players[user.id];
}

function log(type, data) {
  db.logs.unshift({
    id: crypto.randomUUID(),
    at: now().toISO(),
    type,
    data
  });
  if (db.logs.length > MAX_LOGS) db.logs.length = MAX_LOGS;
}

// ================= DISCORD CLIENT =================
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ================= COMANDOS =================
const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('🏓 Teste de latência'),

  new SlashCommandBuilder().setName('balance').setDescription('💰 Ver saldo'),

  new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('🏦 Depositar yens')
    .addIntegerOption(o =>
      o.setName('valor')
        .setDescription('Quantidade para depositar')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('💸 Sacar yens')
    .addIntegerOption(o =>
      o.setName('valor')
        .setDescription('Quantidade para sacar')
        .setRequired(true)
    ),

  new SlashCommandBuilder().setName('inventory').setDescription('🎒 Ver inventário'),

  new SlashCommandBuilder().setName('profile').setDescription('👤 Ver perfil'),

  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('🔄 Trocar item com outro jogador')
    .addUserOption(o =>
      o.setName('usuario')
        .setDescription('Usuário para trocar')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('item')
        .setDescription('Item a ser trocado')
        .setRequired(true)
        .addChoices(
          { name: 'Sukuna Finger', value: 'sukuna_finger' },
          { name: 'Gokumonkyo', value: 'gokumonkyo' }
        )
    )
    .addIntegerOption(o =>
      o.setName('quantidade')
        .setDescription('Quantidade do item')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('shenanigans_bet')
    .setDescription('🎲 Aposta semanal (domingo)'),

  new SlashCommandBuilder().setName('rank').setDescription('🏆 Ranking dos jogadores'),

  new SlashCommandBuilder()
    .setName('backup_restore')
    .setDescription('📦 Restaurar último backup')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

// ================= REGISTER COMANDOS =================
const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
  console.log(`🔥 Online como ${client.user.tag}`);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Comandos registrados');
});

// ================= INTERACTIONS =================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const player = getPlayer(interaction.user);

  try {
    // ================= PING =================
    if (interaction.commandName === 'ping') {
      const embed = new EmbedBuilder()
        .setTitle('🏓 Pong!')
        .setDescription(`Latência: ${client.ws.ping}ms`)
        .setColor(Colors.Green);
      return interaction.reply({ embeds: [embed] });
    }

    // ================= BALANCE =================
    if (interaction.commandName === 'balance') {
      const embed = new EmbedBuilder()
        .setTitle(`💰 Saldo de ${player.name}`)
        .addFields(
          { name: 'Carteira', value: `${player.wallet} Yens`, inline: true },
          { name: 'Banco', value: `${player.bank} Yens`, inline: true }
        )
        .setColor(Colors.Blue);
      return interaction.reply({ embeds: [embed] });
    }

    // ================= DEPOSIT =================
    if (interaction.commandName === 'deposit') {
      const v = interaction.options.getInteger('valor');
      if (v <= 0 || v > player.wallet)
        return interaction.reply({ content: '❌ Valor inválido', ephemeral: true });
      player.wallet -= v;
      player.bank += v;
      log('deposit', { user: player.id, value: v });
      await queueWrite(db);
      const embed = new EmbedBuilder()
        .setTitle('🏦 Depósito')
        .setDescription(`${v} Yens depositados com sucesso!`)
        .setColor(Colors.Green);
      return interaction.reply({ embeds: [embed] });
    }

    // ================= WITHDRAW =================
    if (interaction.commandName === 'withdraw') {
      const v = interaction.options.getInteger('valor');
      if (v <= 0 || v > player.bank)
        return interaction.reply({ content: '❌ Valor inválido', ephemeral: true });
      if (player.wallet + v > MAX_WALLET)
        return interaction.reply({ content: '❌ Limite da carteira excedido', ephemeral: true });
      player.bank -= v;
      player.wallet += v;
      log('withdraw', { user: player.id, value: v });
      await queueWrite(db);
      const embed = new EmbedBuilder()
        .setTitle('💸 Saque')
        .setDescription(`${v} Yens sacados com sucesso!`)
        .setColor(Colors.Gold);
      return interaction.reply({ embeds: [embed] });
    }

    // ================= INVENTORY =================
    if (interaction.commandName === 'inventory') {
      const embed = new EmbedBuilder()
        .setTitle(`🎒 Inventário de ${player.name}`)
        .addFields(
          { name: 'Sukuna Finger', value: `${player.inventory.sukuna_finger}`, inline: true },
          { name: 'Gokumonkyo', value: `${player.inventory.gokumonkyo}`, inline: true }
        )
        .setColor(Colors.Purple);
      return interaction.reply({ embeds: [embed] });
    }

    // ================= PROFILE =================
    if (interaction.commandName === 'profile') {
      const embed = new EmbedBuilder()
        .setTitle(`👤 Perfil de ${player.name}`)
        .addFields(
          { name: 'Carteira', value: `${player.wallet}`, inline: true },
          { name: 'Banco', value: `${player.bank}`, inline: true },
          { name: 'Vitórias', value: `${player.wins}`, inline: true },
          { name: 'Derrotas', value: `${player.losses}`, inline: true },
          { name: 'Streak', value: `${player.streak}`, inline: true }
        )
        .setColor(Colors.Aqua);
      return interaction.reply({ embeds: [embed] });
    }

    // ================= SHENANIGANS BET =================
    if (interaction.commandName === 'shenanigans_bet') {
      if (now().weekday !== 7)
        return interaction.reply({ content: '❌ Só disponível aos domingos', ephemeral: true });

      const sunday = todayISO();
      if (player.shenanigans.lastSunday === sunday)
        return interaction.reply({ content: '❌ Já usado hoje', ephemeral: true });

      player.shenanigans.lastSunday = sunday;
      const loss = Math.random() < DISASTER_CHANCE;
      const value = loss ? -SHEN_BASE : SHEN_BASE;
      player.wallet = Math.max(0, Math.min(MAX_WALLET, player.wallet + value));

      log('shenanigans', { user: player.id, value });
      await queueWrite(db);

      const embed = new EmbedBuilder()
        .setTitle(loss ? '💀 Falha!' : '🎉 Sucesso!')
        .setDescription(loss ? `Perdeu ${SHEN_BASE} Yens` : `Ganhou ${SHEN_BASE} Yens`)
        .setColor(loss ? Colors.Red : Colors.Green);
      return interaction.reply({ embeds: [embed] });
    }

    // ================= RANK =================
    if (interaction.commandName === 'rank') {
      const top = Object.values(db.players)
        .sort((a, b) => b.wallet - a.wallet)
        .slice(0, 10)
        .map((p, i) => `#${i + 1} ${p.name} — ${p.wallet} Yens`)
        .join('\n');
      const embed = new EmbedBuilder()
        .setTitle('🏆 Ranking dos Jogadores')
        .setDescription(top || 'Nenhum jogador registrado')
        .setColor(Colors.Yellow);
      return interaction.reply({ embeds: [embed] });
    }

    // ================= BACKUP RESTORE =================
    if (interaction.commandName === 'backup_restore') {
      const backup = path.join(BACKUP_DIR, 'latest.json');
      if (!existsSync(backup))
        return interaction.reply({ content: '❌ Nenhum backup encontrado' });
      const restored = JSON.parse(await fs.readFile(backup, 'utf8'));
      Object.assign(db, restored);
      await queueWrite(db);
      const embed = new EmbedBuilder()
        .setTitle('📦 Backup Restaurado')
        .setDescription('Último backup restaurado com sucesso')
        .setColor(Colors.Green);
      return interaction.reply({ embeds: [embed] });
    }

  } catch (err) {
    console.error(err);
    return interaction.reply({ content: '❌ Erro interno', ephemeral: true });
  }
});

// ================= BACKUP AUTO =================
setInterval(async () => {
  const file = path.join(BACKUP_DIR, `backup_${DateTime.now().toFormat('yyyyLLdd_HHmmss')}.json`);
  await atomicWrite(file, db);
}, 1000 * 60 * BACKUP_INTERVAL_MIN);

// ================= GLOBAL ERROR HANDLER =================
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

// ================= LOGIN =================
await client.login(TOKEN);
