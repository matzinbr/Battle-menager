// ======================================================
// Battle Manager — economia reformulada e mais realista
// Node.js + discord.js v14 + ESM
// ======================================================

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { DateTime } from 'luxon';
import dotenv from 'dotenv';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';

dotenv.config();

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TZ = process.env.TZ || 'America/Sao_Paulo';

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error('TOKEN, CLIENT_ID e GUILD_ID são obrigatórios no .env');
}

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, 'data.json');
const BACKUP_DIR = path.join(ROOT, 'backups');
const APOSTAS_CONFIG = path.join(ROOT, 'apostasConfig.json');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const now = () => DateTime.now().setZone(TZ);
const todayISO = () => now().toISODate();
const fmt = (n) => new Intl.NumberFormat('pt-BR').format(Math.max(0, Math.floor(n)));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

let writeQueue = Promise.resolve();
async function atomicWrite(file, data) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}
function queueWrite(db) {
  writeQueue = writeQueue.then(() => atomicWrite(DATA_PATH, db));
  return writeQueue;
}
async function loadDB() {
  if (!fs.existsSync(DATA_PATH)) {
    const base = { players: {}, logs: [], meta: { createdAt: now().toISO() } };
    await atomicWrite(DATA_PATH, base);
    return base;
  }
  return JSON.parse(await fsp.readFile(DATA_PATH, 'utf8'));
}
const db = await loadDB();

function ensurePlayerShape(player) {
  player.wallet ??= 600;
  player.bank ??= 0;
  player.inventory ??= { sukuna_finger: 0, gokumonkyo: 0 };
  player.wins ??= 0;
  player.losses ??= 0;
  player.streak ??= 0;
  player.economy ??= { lastSundayClaim: null };
  player.gambling ??= { wins: 0, losses: 0, streak: 0 };
  player.shenanigans ??= { lastSunday: null };
  return player;
}

function getPlayer(user) {
  if (!db.players[user.id]) {
    db.players[user.id] = ensurePlayerShape({
      id: user.id,
      name: user.username,
    });
  }
  const player = db.players[user.id];
  player.name = user.username;
  return ensurePlayerShape(player);
}

function log(type, data) {
  db.logs.unshift({ id: crypto.randomUUID(), at: now().toISO(), type, data });
  if (db.logs.length > 500) db.logs.length = 500;
}

async function loadApostas() {
  try {
    const data = await fsp.readFile(APOSTAS_CONFIG, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}
async function saveApostas(config) {
  await fsp.writeFile(APOSTAS_CONFIG, JSON.stringify(config, null, 2));
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commands = [];
const commandMap = new Map();

function registerCommand(command) {
  commands.push(command.data.toJSON());
  commandMap.set(command.data.name, command);
}

function makeMoneyEmbed(title, description, color = 'Blurple') {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}

// ===================================================
// /ping
// ===================================================
registerCommand({
  data: new SlashCommandBuilder().setName('ping').setDescription('Teste de latência'),
  execute: async (interaction) => interaction.reply(`🏓 Pong ${interaction.client.ws.ping}ms`),
});

// ===================================================
// /balance
// ===================================================
registerCommand({
  data: new SlashCommandBuilder().setName('balance').setDescription('Ver saldo'),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    await interaction.reply(
      `💴 Carteira: ${fmt(player.wallet)}\n🏦 Banco: ${fmt(player.bank)}\n💰 Total: ${fmt(player.wallet + player.bank)}`
    );
  },
});

// ===================================================
// /deposit
// ===================================================
registerCommand({
  data: new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Depositar yens')
    .addIntegerOption((o) => o.setName('valor').setDescription('Valor').setRequired(true)),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const v = interaction.options.getInteger('valor');
    if (v <= 0 || v > player.wallet) return interaction.reply({ content: 'Valor inválido', ephemeral: true });
    player.wallet -= v;
    player.bank += v;
    log('deposit', { user: player.id, v });
    await queueWrite(db);
    await interaction.reply(`🏦 Depositado ${fmt(v)} yens`);
  },
});

// ===================================================
// /withdraw
// ===================================================
registerCommand({
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Sacar yens')
    .addIntegerOption((o) => o.setName('valor').setDescription('Valor').setRequired(true)),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const v = interaction.options.getInteger('valor');
    if (v <= 0 || v > player.bank) return interaction.reply({ content: 'Valor inválido', ephemeral: true });
    if (player.wallet + v > 5000) return interaction.reply({ content: 'Limite da carteira excedido', ephemeral: true });
    player.bank -= v;
    player.wallet += v;
    log('withdraw', { user: player.id, v });
    await queueWrite(db);
    await interaction.reply(`💸 Sacado ${fmt(v)} yens`);
  },
});

// ===================================================
// /inventory
// ===================================================
registerCommand({
  data: new SlashCommandBuilder().setName('inventory').setDescription('Ver inventário'),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const embed = new EmbedBuilder()
      .setTitle(`${player.name} — Inventário`)
      .setColor('Green')
      .addFields(
        { name: 'Sukuna Finger', value: `${player.inventory.sukuna_finger}`, inline: true },
        { name: 'Gokumonkyo', value: `${player.inventory.gokumonkyo}`, inline: true }
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
});

// ===================================================
// /profile
// ===================================================
registerCommand({
  data: new SlashCommandBuilder().setName('profile').setDescription('Perfil do usuário'),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const sunday = player.economy.lastSundayClaim === todayISO() ? 'Já recebido hoje' : 'Disponível no próximo domingo';
    const embed = new EmbedBuilder()
      .setTitle(`${player.name} — Perfil`)
      .setColor('Blue')
      .addFields(
        { name: 'Carteira', value: fmt(player.wallet), inline: true },
        { name: 'Banco', value: fmt(player.bank), inline: true },
        { name: 'Total', value: fmt(player.wallet + player.bank), inline: true },
        { name: 'Vitórias', value: `${player.wins}`, inline: true },
        { name: 'Derrotas', value: `${player.losses}`, inline: true },
        { name: 'Streak', value: `${player.streak}`, inline: true },
        { name: 'Bet wins', value: `${player.gambling.wins}`, inline: true },
        { name: 'Bet losses', value: `${player.gambling.losses}`, inline: true },
        { name: 'Renda de domingo', value: sunday, inline: false }
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
});

// ===================================================
// /rank
// ===================================================
registerCommand({
  data: new SlashCommandBuilder().setName('rank').setDescription('Ranking dos jogadores'),
  execute: async (interaction) => {
    const top = Object.values(db.players)
      .map((p) => ensurePlayerShape(p))
      .sort((a, b) => b.wallet + b.bank - (a.wallet + a.bank))
      .slice(0, 5)
      .map((p, i) => `#${i + 1} ${p.name} — ${fmt(p.wallet + p.bank)} yens (carteira ${fmt(p.wallet)} / banco ${fmt(p.bank)})`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle('🏆 Ranking Top 5')
      .setDescription(top || 'Nenhum jogador registrado')
      .setColor('Gold')
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
});

// ===================================================
// /backup_restore
// ===================================================
registerCommand({
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
  },
});

// ===================================================
// /shenanigans_bet  -> renda semanal de domingo
// ===================================================
const SUNDAY_BASE_MIN = 350;
const SUNDAY_BASE_MAX = 650;
const BANK_INTEREST_RATE = 0.015;
const WEEKLY_ACTIVITY_BONUS_CAP = 250;

registerCommand({
  data: new SlashCommandBuilder()
    .setName('shenanigans_bet')
    .setDescription('Receber renda de domingo (1x por domingo)'),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);

    if (now().weekday !== 7) {
      return interaction.reply({ content: 'Esse pagamento só libera aos domingos.', ephemeral: true });
    }

    const sunday = todayISO();
    if (player.economy.lastSundayClaim === sunday) {
      return interaction.reply({ content: 'Você já recebeu a renda de domingo hoje.', ephemeral: true });
    }

    const base = SUNDAY_BASE_MIN + Math.floor(Math.random() * (SUNDAY_BASE_MAX - SUNDAY_BASE_MIN + 1));
    const activityBonus = clamp(
      Math.floor(player.wins * 18 + player.streak * 12 + player.gambling.wins * 8),
      0,
      WEEKLY_ACTIVITY_BONUS_CAP
    );
    const interest = clamp(Math.floor(player.bank * BANK_INTEREST_RATE), 0, 1000);
    const totalPayout = base + activityBonus;

    player.wallet = clamp(player.wallet + totalPayout, 0, 5000);
    player.bank += interest;
    player.economy.lastSundayClaim = sunday;

    log('sunday_pay', {
      user: player.id,
      base,
      activityBonus,
      interest,
      totalPayout,
    });
    await queueWrite(db);

    const embed = new EmbedBuilder()
      .setTitle('💴 Renda de domingo liberada')
      .setColor('Green')
      .addFields(
        { name: 'Salário base', value: fmt(base), inline: true },
        { name: 'Bônus de atividade', value: fmt(activityBonus), inline: true },
        { name: 'Juros no banco', value: fmt(interest), inline: true },
        { name: 'Total na carteira', value: fmt(totalPayout), inline: true }
      )
      .setFooter({ text: 'Esse comando só funciona uma vez por domingo.' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
});

// ===================================================
// /bet  -> aposta realista
// ===================================================
const betTable = {
  baixo: { chance: 0.62, multiplier: 1.55, label: 'Baixo risco' },
  medio: { chance: 0.45, multiplier: 2.05, label: 'Risco médio' },
  alto: { chance: 0.28, multiplier: 3.25, label: 'Alto risco' },
};

registerCommand({
  data: new SlashCommandBuilder()
    .setName('bet')
    .setDescription('Fazer uma aposta com risco e retorno realistas')
    .addIntegerOption((o) => o.setName('valor').setDescription('Valor apostado').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('risco')
        .setDescription('Nível de risco')
        .setRequired(true)
        .addChoices(
          { name: 'Baixo', value: 'baixo' },
          { name: 'Médio', value: 'medio' },
          { name: 'Alto', value: 'alto' }
        )
    ),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const value = interaction.options.getInteger('valor');
    const risk = interaction.options.getString('risco');
    const config = betTable[risk];

    if (value <= 0) return interaction.reply({ content: 'Aposta inválida.', ephemeral: true });
    if (value > player.wallet) return interaction.reply({ content: 'Você não tem yens suficientes.', ephemeral: true });

    const roll = Math.random();
    const win = roll < config.chance;
    player.wallet -= value;

    if (win) {
      const payout = Math.floor(value * config.multiplier);
      player.wallet = clamp(player.wallet + payout, 0, 5000);
      player.gambling.wins += 1;
      player.gambling.streak += 1;
      player.streak += 1;
      player.wins += 1;

      log('bet_win', { user: player.id, value, risk, roll, payout });
      await queueWrite(db);

      const embed = makeMoneyEmbed(
        '🎰 Aposta vencedora',
        `Risco: **${config.label}**\nApostado: **${fmt(value)}**\nRecebeu: **${fmt(payout)}**\nLucro líquido: **${fmt(payout - value)}**`,
        'Green'
      );
      return interaction.reply({ embeds: [embed] });
    }

    player.gambling.losses += 1;
    player.gambling.streak = 0;
    player.streak = 0;
    player.losses += 1;

    log('bet_loss', { user: player.id, value, risk, roll });
    await queueWrite(db);

    const embed = makeMoneyEmbed(
      '💥 Aposta perdida',
      `Risco: **${config.label}**\nPerdeu: **${fmt(value)}**\nChance do bilhete: **${Math.round(config.chance * 100)}%**`,
      'Red'
    );
    return interaction.reply({ embeds: [embed] });
  },
});

// ===================================================
// /apostas
// ===================================================
const apostasBaseCommand = new SlashCommandBuilder()
  .setName('apostas')
  .setDescription('Gerenciar apostas do servidor')
  .addSubcommand((sub) => sub.setName('criar').setDescription('Ativar aposta do servidor'))
  .addSubcommand((sub) =>
    sub
      .setName('editar_nome')
      .setDescription('Trocar nome da aposta')
      .addStringOption((o) => o.setName('novo_nome').setDescription('Novo nome').setRequired(true))
  )
  .addSubcommand((sub) => sub.setName('status').setDescription('Ver configuração da aposta'));

registerCommand({
  data: apostasBaseCommand,
  execute: async (interaction) => {
    const serverId = interaction.guildId;
    const apostasConfig = await loadApostas();
    if (!apostasConfig[serverId]) apostasConfig[serverId] = { name: 'shenanigans_bet', enabled: true };

    const sub = interaction.options.getSubcommand();

    if (sub === 'criar') {
      apostasConfig[serverId].enabled = true;
      await saveApostas(apostasConfig);
      return interaction.reply(`✅ Aposta ativada no servidor. Comando: **${apostasConfig[serverId].name}**`);
    }

    if (sub === 'editar_nome') {
      const currentName = apostasConfig[serverId].name;
      const newName = interaction.options.getString('novo_nome');
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
  },
});

// ===================================================
// READY / REGISTER
// ===================================================
const rest = new REST({ version: '10' }).setToken(TOKEN);
client.once('ready', async () => {
  console.log(`🔥 Online como ${client.user.tag}`);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Todos os comandos registrados com sucesso');
});

// ===================================================
// INTERACTIONS
// ===================================================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commandMap.get(interaction.commandName);
  if (!cmd) return;

  try {
    await cmd.execute(interaction);
  } catch (err) {
    console.error(err);
    const payload = { content: 'Erro interno', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
});

// ===================================================
// BACKUP AUTOMÁTICO
// ===================================================
setInterval(async () => {
  const file = path.join(BACKUP_DIR, 'latest.json');
  await atomicWrite(file, db);
}, 1000 * 60 * 10);

await client.login(TOKEN);
