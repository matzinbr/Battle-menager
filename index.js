// ======================================================
// Battle Manager — economia, work e batalhas mais realistas
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

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
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
const rollInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const strip = (s = '') =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

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
  player.work ??= { lastClaim: null, streak: 0 };
  player.gambling ??= { wins: 0, losses: 0, streak: 0 };
  player.battle ??= { wins: 0, losses: 0, streak: 0 };
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

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const commands = [];
const commandMap = new Map();

function registerCommand(command) {
  commands.push(command.data.toJSON());
  commandMap.set(command.data.name, command);
}

function makeEmbed(title, description, color = 'Blurple') {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}

async function getMember(interaction) {
  return interaction.guild.members.fetch(interaction.user.id);
}

function isStaffLike(member) {
  if (!member) return false;
  const names = new Set([
    'admin',
    'adm',
    'administrator',
    'fundador',
    'fundadores',
    'superior',
    'superiores',
    'owner',
    'owners',
    'staff',
    'moderador',
    'moderadores',
    'mod',
    'dev',
    'developer',
  ].map(strip));

  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some((role) => names.has(strip(role.name)));
}

function weekdayName() {
  return ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][now().weekday % 7];
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
      .setTitle(`🎒 ${player.name} — Inventário`)
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
      .setTitle(`👤 ${player.name} — Perfil`)
      .setColor('Blue')
      .addFields(
        { name: 'Carteira', value: fmt(player.wallet), inline: true },
        { name: 'Banco', value: fmt(player.bank), inline: true },
        { name: 'Total', value: fmt(player.wallet + player.bank), inline: true },
        { name: 'Vitórias', value: `${player.wins}`, inline: true },
        { name: 'Derrotas', value: `${player.losses}`, inline: true },
        { name: 'Streak', value: `${player.streak}`, inline: true },
        { name: 'Apostas ganhas', value: `${player.gambling.wins}`, inline: true },
        { name: 'Apostas perdidas', value: `${player.gambling.losses}`, inline: true },
        { name: 'Batalhas', value: `${player.battle.wins} / ${player.battle.losses}`, inline: true },
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
      .map(
        (p, i) =>
          `#${i + 1} ${p.name} — ${fmt(p.wallet + p.bank)} yens (carteira ${fmt(p.wallet)} / banco ${fmt(p.bank)})`
      )
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
// /work
// - staff / superiores / fundadores só podem usar no domingo
// ===================================================
const STAFF_WORK_MIN = 140;
const STAFF_WORK_MAX = 240;
const WEEKDAY_WORK_MIN = 160;
const WEEKDAY_WORK_MAX = 310;
const SATURDAY_WORK_MIN = 180;
const SATURDAY_WORK_MAX = 340;
const SUNDAY_WORK_MIN = 380;
const SUNDAY_WORK_MAX = 640;

registerCommand({
  data: new SlashCommandBuilder().setName('work').setDescription('Trabalhar e ganhar yens'),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const member = await getMember(interaction);
    const currentDay = now().weekday;
    const today = todayISO();

    if (player.work.lastClaim === today) {
      return interaction.reply({ content: 'Você já trabalhou hoje.', ephemeral: true });
    }

    if (isStaffLike(member) && currentDay !== 7) {
      return interaction.reply({
        content: 'Cargos de staff, adm, superiores e fundadores só podem usar o /work aos domingos.',
        ephemeral: true,
      });
    }

    let base;
    if (currentDay === 7) base = rollInt(SUNDAY_WORK_MIN, SUNDAY_WORK_MAX);
    else if (currentDay === 6) base = rollInt(SATURDAY_WORK_MIN, SATURDAY_WORK_MAX);
    else base = rollInt(WEEKDAY_WORK_MIN, WEEKDAY_WORK_MAX);

    if (isStaffLike(member) && currentDay === 7) {
      base = rollInt(STAFF_WORK_MIN, STAFF_WORK_MAX) + 180;
    }

    const activityBonus = clamp(Math.floor(player.wins * 4 + player.battle.wins * 8 + player.work.streak * 12), 0, 140);
    const payout = clamp(base + activityBonus, 0, 1200);

    player.wallet = clamp(player.wallet + payout, 0, 5000);
    const previousClaim = player.work.lastClaim;
    const yesterday = now().minus({ days: 1 }).toISODate();
    player.work.lastClaim = today;
    player.work.streak = previousClaim === yesterday ? player.work.streak + 1 : 1;

    log('work', { user: player.id, payout, day: weekdayName(), staff: isStaffLike(member) });
    await queueWrite(db);

    const embed = new EmbedBuilder()
      .setTitle('💼 Trabalho concluído')
      .setColor('Green')
      .addFields(
        { name: 'Dia', value: weekdayName(), inline: true },
        { name: 'Base', value: fmt(base), inline: true },
        { name: 'Bônus', value: fmt(activityBonus), inline: true },
        { name: 'Total ganho', value: fmt(payout), inline: true }
      )
      .setFooter({ text: isStaffLike(member) ? 'Staff só trabalha aos domingos.' : 'Você pode trabalhar 1 vez por dia.' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
});

// ===================================================
// /battle
// ===================================================
registerCommand({
  data: new SlashCommandBuilder()
    .setName('battle')
    .setDescription('Desafiar alguém para uma batalha')
    .addUserOption((o) => o.setName('oponente').setDescription('Quem vai lutar').setRequired(true)),
  execute: async (interaction) => {
    const challenger = getPlayer(interaction.user);
    const targetUser = interaction.options.getUser('oponente');

    if (targetUser.bot) return interaction.reply({ content: 'Não dá para batalhar com bots.', ephemeral: true });
    if (targetUser.id === interaction.user.id) return interaction.reply({ content: 'Você não pode lutar contra si mesmo.', ephemeral: true });

    const opponent = getPlayer(targetUser);
    const challengerScore =
      challenger.wins * 2 + challenger.battle.wins * 4 + challenger.streak * 2 + rollInt(1, 100);
    const opponentScore = opponent.wins * 2 + opponent.battle.wins * 4 + opponent.streak * 2 + rollInt(1, 100);
    const total = challengerScore + opponentScore;
    const chance = total === 0 ? 0.5 : challengerScore / total;
    const roll = Math.random();
    const challengerWins = roll < chance;

    const winner = challengerWins ? challenger : opponent;
    const loser = challengerWins ? opponent : challenger;
    const reward = rollInt(80, 220);
    const loserLoss = clamp(rollInt(35, 120), 0, loser.wallet);

    if (challengerWins) {
      winner.wallet = clamp(winner.wallet + reward + loserLoss, 0, 5000);
      loser.wallet = clamp(loser.wallet - loserLoss, 0, 5000);
      challenger.battle.wins += 1;
      challenger.battle.streak += 1;
      challenger.wins += 1;
      challenger.streak += 1;
      opponent.battle.losses += 1;
      opponent.battle.streak = 0;
      opponent.losses += 1;
      opponent.streak = 0;
    } else {
      winner.wallet = clamp(winner.wallet + reward + loserLoss, 0, 5000);
      loser.wallet = clamp(loser.wallet - loserLoss, 0, 5000);
      opponent.battle.wins += 1;
      opponent.battle.streak += 1;
      opponent.wins += 1;
      opponent.streak += 1;
      challenger.battle.losses += 1;
      challenger.battle.streak = 0;
      challenger.losses += 1;
      challenger.streak = 0;
    }

    log('battle', {
      challenger: challenger.id,
      opponent: opponent.id,
      roll,
      chance,
      challengerScore,
      opponentScore,
      winner: winner.id,
    });
    await queueWrite(db);

    const embed = new EmbedBuilder()
      .setTitle('⚔️ Batalha encerrada')
      .setColor(challengerWins ? 'Green' : 'Red')
      .setDescription(
        challengerWins
          ? `**${interaction.user.username}** venceu **${targetUser.username}**.`
          : `**${targetUser.username}** venceu **${interaction.user.username}**.`
      )
      .addFields(
        { name: 'Chance estimada', value: `${Math.round(chance * 100)}%`, inline: true },
        { name: 'Prêmio', value: fmt(reward), inline: true },
        { name: 'Perda do derrotado', value: fmt(loserLoss), inline: true }
      )
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
      Math.floor(player.wins * 18 + player.streak * 12 + player.gambling.wins * 8 + player.battle.wins * 10),
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
  baixo: { chance: 0.49, multiplier: 1.95, label: 'Baixo risco' },
  medio: { chance: 0.31, multiplier: 2.85, label: 'Risco médio' },
  alto: { chance: 0.16, multiplier: 5.1, label: 'Alto risco' },
};

registerCommand({
  data: new SlashCommandBuilder()
    .setName('bet')
    .setDescription('Fazer uma aposta com risco e retorno mais realistas')
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

    if (!config) return interaction.reply({ content: 'Risco inválido.', ephemeral: true });
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

      const embed = makeEmbed(
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

    const embed = makeEmbed(
      '💥 Aposta perdida',
      `Risco: **${config.label}**\nPerdeu: **${fmt(value)}**\nChance de acerto: **${Math.round(config.chance * 100)}%**`,
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
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
