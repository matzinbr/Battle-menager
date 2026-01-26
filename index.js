// ======================================================
// Battle Manager — MONSTRUOSO INDEX.JS (PARTE 1/3) CONFIGURADO
// Node.js 20 LTS | Discord.js v14 | ESM | Vetra Cloud Ready
// ======================================================

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { DateTime } from 'luxon';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} from 'discord.js';

// ===================================================
// CONFIG FIXA (IDs fornecidos)
// ===================================================
import dotenv from 'dotenv';
dotenv.config();

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TZ = process.env.TZ || 'America/Sao_Paulo';

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error('TOKEN, CLIENT_ID e GUILD_ID são obrigatórios no .env');
}

const TZ = 'America/Sao_Paulo';

// ===================================================
// PATHS
// ===================================================
const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, 'data.json');
const BACKUP_DIR = path.join(ROOT, 'backups');
const APOSTAS_CONFIG = path.join(ROOT, 'apostasConfig.json');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ===================================================
// TIME UTILITIES
// ===================================================
const now = () => DateTime.now().setZone(TZ);
const todayISO = () => now().toISODate();

// ===================================================
// SAFE DB
// ===================================================
let writeQueue = Promise.resolve();
async function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}
function queueWrite(db) { writeQueue = writeQueue.then(() => atomicWrite(DATA_PATH, db)); return writeQueue; }
async function loadDB() {
  if (!fs.existsSync(DATA_PATH)) {
    const base = { players: {}, logs: [], meta: { createdAt: now().toISO() } };
    await atomicWrite(DATA_PATH, base);
    return base;
  }
  return JSON.parse(await fsp.readFile(DATA_PATH, 'utf8'));
}
const db = await loadDB();

// ===================================================
// PLAYERS
// ===================================================
function getPlayer(user) {
  if (!db.players[user.id]) {
    db.players[user.id] = {
      id: user.id,
      name: user.username,
      wallet: 600,
      bank: 0,
      inventory: { sukuna_finger: 0, gokumonkyo: 0 },
      wins: 0,
      losses: 0,
      streak: 0,
      shenanigans: { lastSunday: null }
    };
  }
  db.players[user.id].name = user.username;
  return db.players[user.id];
}
function log(type, data) {
  db.logs.unshift({ id: crypto.randomUUID(), at: now().toISO(), type, data });
  if (db.logs.length > 500) db.logs.length = 500;
}

// ===================================================
// LOAD/ SAVE APOSTAS CONFIG
// ===================================================
async function loadApostas() {
  try { const data = await fsp.readFile(APOSTAS_CONFIG, 'utf8'); return JSON.parse(data); } catch { return {}; }
}
async function saveApostas(config) { await fsp.writeFile(APOSTAS_CONFIG, JSON.stringify(config, null, 2)); }

// ===================================================
// CLIENT
// ===================================================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ===================================================
// COMMANDS MAP
// ===================================================
const commands = [];
const commandMap = new Map();

// ===================================================
// /PING COMMAND
// ===================================================
const pingCommand = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Teste de latência'),
  execute: async (interaction) => await interaction.reply(`🏓 Pong ${interaction.client.ws.ping}ms`)
};
commands.push(pingCommand.data.toJSON());
commandMap.set('ping', pingCommand);

// ===================================================
// /BALANCE COMMAND
// ===================================================
const balanceCommand = {
  data: new SlashCommandBuilder().setName('balance').setDescription('Ver saldo'),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    await interaction.reply(`💴 Carteira: ${player.wallet}\n🏦 Banco: ${player.bank}`);
  }
};
commands.push(balanceCommand.data.toJSON());
commandMap.set('balance', balanceCommand);

// ===================================================
// /DEPOSIT COMMAND
// ===================================================
const depositCommand = {
  data: new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Depositar yens')
    .addIntegerOption(o => o.setName('valor').setDescription('Valor').setRequired(true)),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const v = interaction.options.getInteger('valor');
    if (v <= 0 || v > player.wallet) return interaction.reply({ content: 'Valor inválido', ephemeral: true });
    player.wallet -= v;
    player.bank += v;
    log('deposit', { user: player.id, v });
    await queueWrite(db);
    await interaction.reply(`🏦 Depositado ${v}`);
  }
};
commands.push(depositCommand.data.toJSON());
commandMap.set('deposit', depositCommand);

// ===================================================
// /WITHDRAW COMMAND
// ===================================================
const withdrawCommand = {
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Sacar yens')
    .addIntegerOption(o => o.setName('valor').setDescription('Valor').setRequired(true)),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const v = interaction.options.getInteger('valor');
    if (v <= 0 || v > player.bank) return interaction.reply({ content: 'Valor inválido', ephemeral: true });
    if (player.wallet + v > 5000) return interaction.reply({ content: 'Limite excedido', ephemeral: true });
    player.bank -= v;
    player.wallet += v;
    log('withdraw', { user: player.id, v });
    await queueWrite(db);
    await interaction.reply(`💸 Sacado ${v}`);
  }
};
commands.push(withdrawCommand.data.toJSON());
commandMap.set('withdraw', withdrawCommand);
// ======================================================
// Battle Manager — MONSTRUOSO INDEX.JS (PARTE 2/3)
// Inclui: /inventory, /profile, /rank, /backup_restore, /shenanigans_bet
// ======================================================

// ===================================================
// /INVENTORY COMMAND
// ===================================================
const inventoryCommand = {
  data: new SlashCommandBuilder().setName('inventory').setDescription('Ver inventário'),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const embed = new EmbedBuilder()
      .setTitle(`${player.name} - Inventário`)
      .setColor('Green')
      .addFields(
        { name: 'Sukuna Finger', value: `${player.inventory.sukuna_finger}`, inline: true },
        { name: 'Gokumonkyo', value: `${player.inventory.gokumonkyo}`, inline: true }
      ).setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }
};
commands.push(inventoryCommand.data.toJSON());
commandMap.set('inventory', inventoryCommand);

// ===================================================
// /PROFILE COMMAND
// ===================================================
const profileCommand = {
  data: new SlashCommandBuilder().setName('profile').setDescription('Perfil do usuário'),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const embed = new EmbedBuilder()
      .setTitle(`${player.name} - Perfil`) 
      .setColor('Blue')
      .addFields(
        { name: 'Carteira', value: `${player.wallet}`, inline: true },
        { name: 'Banco', value: `${player.bank}`, inline: true },
        { name: 'Vitórias', value: `${player.wins}`, inline: true },
        { name: 'Derrotas', value: `${player.losses}`, inline: true },
        { name: 'Streak', value: `${player.streak}`, inline: true }
      ).setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }
};
commands.push(profileCommand.data.toJSON());
commandMap.set('profile', profileCommand);

// ===================================================
// /RANK COMMAND
// ===================================================
const rankCommand = {
  data: new SlashCommandBuilder().setName('rank').setDescription('Ranking dos jogadores'),
  execute: async (interaction) => {
    const top = Object.values(db.players)
      .sort((a, b) => b.wallet - a.wallet)
      .slice(0, 5)
      .map((p, i) => `#${i+1} ${p.name} — ${p.wallet} yens`)
      .join('\n');
    const embed = new EmbedBuilder()
      .setTitle('🏆 Ranking Top 5')
      .setDescription(top || 'Nenhum jogador registrado')
      .setColor('Gold')
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }
};
commands.push(rankCommand.data.toJSON());
commandMap.set('rank', rankCommand);

// ===================================================
// /BACKUP_RESTORE COMMAND
// ===================================================
const backupRestoreCommand = {
  data: new SlashCommandBuilder()
    .setName('backup_restore')
    .setDescription('Restaurar último backup')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  execute: async (interaction) => {
    const backupFile = path.join(BACKUP_DIR, 'latest.json');
    if (!fs.existsSync(backupFile)) return interaction.reply({ content: 'Nenhum backup encontrado', ephemeral: true });
    const restored = JSON.parse(await fsp.readFile(backupFile, 'utf8'));
    Object.assign(db, restored);
    await queueWrite(db);
    await interaction.reply('✅ Backup restaurado com sucesso');
  }
};
commands.push(backupRestoreCommand.data.toJSON());
commandMap.set('backup_restore', backupRestoreCommand);

// ===================================================
// /SHENANIGANS_BET COMMAND
// ===================================================
const SHEN_BASE = 270;
const MAX_WALLET = 5000;
const DISASTER_CHANCE = 0.05;
const shenanigansCommand = {
  data: new SlashCommandBuilder()
    .setName('shenanigans_bet')
    .setDescription('Aposta semanal (somente domingo)'),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    if (now().weekday !== 7) return interaction.reply({ content: 'Só pode usar aos domingos!', ephemeral: true });
    const sunday = todayISO();
    if (player.shenanigans.lastSunday === sunday) return interaction.reply({ content: 'Você já usou hoje!', ephemeral: true });

    player.shenanigans.lastSunday = sunday;
    const loss = Math.random() < DISASTER_CHANCE;
    const value = loss ? -SHEN_BASE : SHEN_BASE;
    player.wallet = Math.max(0, Math.min(MAX_WALLET, player.wallet + value));

    log('shenanigans', { user: player.id, value });
    await queueWrite(db);

    const embed = new EmbedBuilder()
      .setTitle(loss ? '💀 Falhou!' : '🎉 Sucesso!')
      .setDescription(loss ? `Perdeu ${SHEN_BASE} yens` : `Ganhou ${SHEN_BASE} yens`)
      .setColor(loss ? 'Red' : 'Green')
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
commands.push(shenanigansCommand.data.toJSON());
commandMap.set('shenanigans_bet', shenanigansCommand);
// ======================================================
// Battle Manager — MONSTRUOSO INDEX.JS (PARTE 3/3)
// Inclui: /apostas criar, /apostas editar_nome, /apostas status, registro e login
// ======================================================

// ===================================================
// /APOSTAS COMMANDS
// ===================================================
const apostasBaseCommand = new SlashCommandBuilder()
  .setName('apostas')
  .setDescription('Gerenciar apostas do servidor')
  .addSubcommand(sub => sub.setName('criar').setDescription('Criar uma aposta'))
  .addSubcommand(sub => sub.setName('editar_nome').setDescription('Trocar nome de aposta'))
  .addSubcommand(sub => sub.setName('status').setDescription('Ver configuração da aposta'));
commands.push(apostasBaseCommand.toJSON());

commandMap.set('apostas', {
  data: apostasBaseCommand,
  execute: async (interaction) => {
    const serverId = interaction.guildId;
    let apostasConfig = await loadApostas();
    if (!apostasConfig[serverId]) apostasConfig[serverId] = { name: 'shenanigans_bet', enabled: true };

    const sub = interaction.options.getSubcommand();

    if (sub === 'criar') {
      apostasConfig[serverId].enabled = true;
      await saveApostas(apostasConfig);
      return interaction.reply(`✅ Aposta ativada no servidor. Comando: **${apostasConfig[serverId].name}**`);
    }

    if (sub === 'editar_nome') {
      const currentName = apostasConfig[serverId].name;
      const newName = interaction.options.getString('nome') || currentName;
      apostasConfig[serverId].name = newName;
      await saveApostas(apostasConfig);
      return interaction.reply(`✅ Nome da aposta alterado: **${newName}** (antes: ${currentName})`);
    }

    if (sub === 'status') {
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Configuração da Aposta')
        .setDescription(`Nome do comando: **${apostasConfig[serverId].name}**\nHabilitado: ${apostasConfig[serverId].enabled}`)
        .setColor('Purple')
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }
  }
});

// ===================================================
// REGISTER COMMANDS WITH DISCORD
// ===================================================
const rest = new REST({ version: '10' }).setToken(TOKEN);
client.once('ready', async () => {
  console.log(`🔥 Online como ${client.user.tag}`);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log('✅ Todos os comandos registrados com sucesso');
});

// ===================================================
// INTERACTION CREATE HANDLER
// ===================================================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commandMap.get(interaction.commandName);
  if (!cmd) return;
  try { await cmd.execute(interaction); } 
  catch (err) { console.error(err); await interaction.reply({ content: 'Erro interno', ephemeral: true }); }
});

// ===================================================
// BACKUP AUTOMÁTICO
// ===================================================
setInterval(async () => {
  const file = path.join(BACKUP_DIR, 'latest.json');
  await atomicWrite(file, db);
}, 1000 * 60 * 10);

// ===================================================
// LOGIN
// ===================================================
await client.login(TOKEN);
