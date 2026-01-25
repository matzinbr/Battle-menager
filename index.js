// index.js — Polyfill robusto para ReadableStream (COLOQUE ISTO NO TOPO, antes de qualquer outro import)
// Requisitos: package.json com "type":"module" e dependência web-streams-polyfill (fallback).
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { ReadableStream as PolyReadableStream } from 'web-streams-polyfill/ponyfill';

// define globalThis.ReadableStream de forma segura (prioriza implementacao nativa)
globalThis.ReadableStream = globalThis.ReadableStream || NodeReadableStream || PolyReadableStream;

// debug (remove depois): deve imprimir "function" nos logs do container
console.log('[startup] ReadableStream ok?', typeof globalThis.ReadableStream);

/**// === Robust ReadableStream polyfill (place this at the VERY TOP of index.js) ===
// 1) prefer native stream/web (Node 18+)
// 2) fallback imediato para ponyfill (se por algum motivo stream/web não expuser ReadableStream global)
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { ReadableStream as PolyReadableStream } from 'web-streams-polyfill/ponyfill';

// Apply the available implementation to globalThis (guarantee before undici loads)
globalThis.ReadableStream ??= (NodeReadableStream || PolyReadableStream);

// debug log — remove depois de verificar nos logs do host
console.log('[startup] ReadableStream ok?', typeof globalThis.ReadableStream);

 * index.perfect.js — versão final "perfeita"
 * - Node.js (ESM). Defina { "type": "module" } no package.json
 * - Recursos implementados:
 *   • /ping /balance /deposit /withdraw /profile /inventory /trade
 *   • /shenanigans_bet (corrigido, Sunday window, once per calendar Sunday)
 *   • /x1_result (staff) /rank /history /backup_restore (admin)
 *   • Persistência segura com escrita enfileirada (avoid race conditions)
 *   • Backups automáticos e on-demand
 *   • Logs de ações (trade, bet, deposit, withdraw, x1)
 *   • Cooldown visível com tempo restante
 *   • Mensagens e embeds estilizados (tema Jujutsu)
 * - ENV VARS (obrigatório):
 *   TOKEN, GUILD_ID, FOUNDER_ROLE_ID (opcional), SUKUNA_ROLE_ID, GOKU_ROLE_ID
 *
 * Use com: node index.perfect.js
 */

// ===== ReadableStream polyfill (SAFE for undici / discord.js) =====
// Use stream/web (Node 18+) synchronously to avoid top-level await issues.
import { ReadableStream as WebReadableStream } from 'stream/web';
if (!globalThis.ReadableStream) {
  globalThis.ReadableStream = WebReadableStream;
}

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
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

/* ================= CONFIG ================== */
const TOKEN = process.env.TOKEN;
if (!TOKEN) throw new Error('TOKEN missing in environment variables.');

const GUILD_ID = process.env.GUILD_ID || '1461942839331127520';
const DATA_PATH = path.join(process.cwd(), 'data.json');
const BACKUP_DIR = path.join(process.cwd(), 'backups');
if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

const TZ = 'America/Sao_Paulo';

const START_YENS = 600;
const MAX_MONEY = 5000;
const SHEN_BASE = 270;
const DISASTER_CHANCE = 0.05;

const FOUNDER_ROLE_ID = process.env.FOUNDER_ROLE_ID || '1463413721970769973';
const SUKUNA_ROLE_ID = process.env.SUKUNA_ROLE_ID || '1463413152824819753';
const GOKU_ROLE_ID = process.env.GOKU_ROLE_ID || '1463413249734086860';

const SUKUNA_EMOJI = '<:sukuna_finger:1463407933449572352>';
const GOKU_EMOJI = '<:Gokumonkyo:1463408847556444233>';

const MAX_LOGS = 500; // cap logs size

/* ============= SAFETY / ERRORS ============= */
process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION', err);
});
process.on('unhandledRejection', err => {
  console.error('UNHANDLED REJECTION', err);
});

/* ========== SAFE JSON IO + WRITE QUEUE ========== */
/* atomic writer: write tmp file then rename */
async function safeWriteJSONAtomic(filePath, obj) {
  const tmp = `${filePath}.tmp`;
  const data = JSON.stringify(obj, null, 2);
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, filePath);
}

/* single writer queue (serialize writes to avoid races) */
let writeLock = Promise.resolve();
function queuedWrite(db) {
  // returns a promise that resolves when write completes
  writeLock = writeLock
    .catch(() => {}) // swallow errors from previous to continue queue
    .then(() => safeWriteJSONAtomic(DATA_PATH, db));
  return writeLock;
}

async function loadJSON(filePath, defaultValue) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    // initialize with default and save
    await safeWriteJSONAtomic(filePath, defaultValue);
    return defaultValue;
  }
}

/* ========== TIME HELPERS ========== */
function nowISODate() {
  return DateTime.now().setZone(TZ).toISODate(); // YYYY-MM-DD
}
function nowISO() {
  return DateTime.now().setZone(TZ).toISO(); // timestamp
}
function isSundayWindowNow() {
  const d = DateTime.now().setZone(TZ);
  // luxon: 1 = Monday ... 7 = Sunday
  if (d.weekday !== 7) return false;
  return d.hour >= 9 && d.hour <= 23; // 09:00 - 23:59 (approx)
}
function currentSundayISO() {
  // return the calendar Sunday date (YYYY-MM-DD) that contains the current moment
  const today = DateTime.now().setZone(TZ).startOf('day');
  const sunday = today.minus({ days: today.weekday % 7 });
  return sunday.toISODate();
}

/* ========== DB BOOT ================= */
async function ensureDB() {
  const base = {
    players: {},
    workUsed: {},
    logs: [],
    meta: { createdAt: nowISO() }
  };
  return loadJSON(DATA_PATH, base);
}
function ensurePlayerShape(players, id, username) {
  if (!players[id]) {
    players[id] = {
      id,
      name: username || 'Unknown',
      wallet: START_YENS,
      bank: 0,
      wins: 0,
      losses: 0,
      streak: 0,
      lastWorkDate: null,
      items: { sukuna_finger: 0, gokumonkyo: 0 },
      titles: []
    };
  } else {
    // keep name updated
    players[id].name = username || players[id].name || 'Unknown';
    players[id].items = players[id].items || { sukuna_finger: 0, gokumonkyo: 0 };
    players[id].titles = players[id].titles || [];
  }
  return players[id];
}

/* append a log and cap logs size */
function addLog(db, type, userId, details = {}) {
  const entry = { id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`, ts: nowISO(), type, userId, details };
  db.logs = db.logs || [];
  db.logs.unshift(entry);
  if (db.logs.length > MAX_LOGS) db.logs.length = MAX_LOGS; // truncate oldest
  return entry;
}

/* backup function */
async function createBackup(db) {
  const ts = DateTime.now().setZone(TZ).toFormat('yyyyLLdd_HHmmss');
  const file = path.join(BACKUP_DIR, `backup_${ts}.json`);
  await safeWriteJSONAtomic(file, db);
  return file;
}

/* ========== CLIENT & COMMANDS ========== */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* command definitions */
const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Teste do bot'),
  new SlashCommandBuilder().setName('balance').setDescription('Ver carteira e banco'),
  new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Depositar do bolso pro banco')
    .addIntegerOption(o => o.setName('valor').setDescription('Valor').setRequired(true)),
  new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Sacar do banco')
    .addIntegerOption(o => o.setName('valor').setDescription('Valor').setRequired(true)),
  new SlashCommandBuilder().setName('profile').setDescription('Mostrar seu perfil (ephemeral)'),
  new SlashCommandBuilder().setName('inventory').setDescription('Mostrar seu inventário (ephemeral)'),
  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Trocar item com outro usuário')
    .addUserOption(o => o.setName('usuario').setDescription('Quem recebe').setRequired(true))
    .addStringOption(o => o.setName('item').setDescription('Item').setRequired(true)
      .addChoices(
        { name: 'Sukuna Finger', value: 'sukuna_finger' },
        { name: 'Gokumonkyo', value: 'gokumonkyo' }
      ))
    .addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder()
    .setName('shenanigans_bet')
    .setDescription('Shenanigans Bet — domingo 09:00–23:59 (1x por domingo)'),
  new SlashCommandBuilder()
    .setName('x1_result')
    .setDescription('Registrar resultado X1 (staff)')
    .addUserOption(o => o.setName('vencedor').setDescription('Vencedor').setRequired(true))
    .addUserOption(o => o.setName('perdedor').setDescription('Perdedor').setRequired(true))
    .addIntegerOption(o => o.setName('valor').setDescription('Valor apostado').setRequired(true)),
  new SlashCommandBuilder().setName('rank').setDescription('Ranking top 10 por vitórias'),
  new SlashCommandBuilder().setName('history').setDescription('Ver seu histórico (últimos eventos)').addIntegerOption(o => o.setName('max').setDescription('Quantos mostrar').setRequired(false)),
  new SlashCommandBuilder().setName('backup_restore').setDescription('Restaurar backup (admin)') // expects admin to run and restore manually from backups folder (safety)
].map(c => c.toJSON());

/* register commands when ready */
client.once('ready', async () => {
  console.log('Bot ready:', client.user.tag);
  try {
    const appId = client.application?.id || client.user.id;
    await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: commands });
    console.log('Comandos registrados (guild)');
  } catch (err) {
    console.error('Erro registrando comandos:', err);
  }

  // create an initial backup of DB on startup
  try {
    const db = await ensureDB();
    const file = await createBackup(db);
    console.log('Backup inicial criado:', file);
  } catch (e) {
    console.error('Falha ao criar backup inicial:', e);
  }

  // schedule daily backup at 03:00 São Paulo time
  scheduleDailyBackupAt('03:00');
});

/* schedule daily backup helper */
function scheduleDailyBackupAt(timeHHMM) {
  const [hh, mm] = timeHHMM.split(':').map(Number);
  async function doBackup() {
    try {
      const db = await ensureDB();
      const file = await createBackup(db);
      console.log('Backup agendado criado:', file);
    } catch (e) {
      console.error('Erro no backup agendado:', e);
    }
  }
  // compute initial delay
  const now = DateTime.now().setZone(TZ);
  let next = now.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
  if (next <= now) next = next.plus({ days: 1 });
  const ms = next.diff(now).as('milliseconds');
  setTimeout(() => {
    doBackup();
    setInterval(doBackup, 24 * 60 * 60 * 1000);
  }, Math.max(0, ms));
}

/* ========== ANTI-SPAM COOLDOWN (visible) ========== */
const lastCmd = new Map();
const GLOBAL_MIN_MS = 900;
function allowNow(userId) {
  const now = Date.now();
  const last = lastCmd.get(userId) || 0;
  const diff = now - last;
  if (diff < GLOBAL_MIN_MS) {
    const wait = GLOBAL_MIN_MS - diff;
    return { ok: false, wait };
  }
  lastCmd.set(userId, now);
  return { ok: true };
}

/* ========== INTERACTIONS ========== */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const allow = allowNow(interaction.user.id);
  if (!allow.ok) {
    return interaction.reply({ content: `⏳ Aguarde ${Math.ceil(allow.wait / 1000)}s antes de usar outro comando.`, ephemeral: true });
  }

  // require guild
  if (!interaction.guildId) {
    return interaction.reply({ content: 'Este comando só funciona dentro do servidor.', ephemeral: true });
  }

  // load DB
  const db = await ensureDB();
  db.players = db.players || {};
  db.workUsed = db.workUsed || {};
  db.logs = db.logs || [];

  // ensure player
  ensurePlayerShape(db.players, interaction.user.id, interaction.user.username);
  const player = db.players[interaction.user.id];

  // fetch member for permissions and roles
  let member = null;
  try {
    member = await interaction.guild.members.fetch(interaction.user.id);
  } catch {
    member = interaction.member || null;
  }

  const isAdmin = Boolean(member && member.permissions?.has && member.permissions.has(PermissionFlagsBits.Administrator));
  const isFounder = Boolean(member && member.roles?.cache?.has && member.roles.cache.has(FOUNDER_ROLE_ID));

  try {
    /* ===== PING ===== */
    if (interaction.commandName === 'ping') {
      return interaction.reply({ content: `🏓 Pong — ${client.user.tag}`, ephemeral: true });
    }

    /* ===== BALANCE ===== */
    if (interaction.commandName === 'balance') {
      const embed = new EmbedBuilder()
        .setTitle(`${player.name} — Carteira & Banco`)
        .setColor(0x00cc99)
        .setDescription(`💰 Carteira: **${player.wallet} yens**\n🏦 Banco: **${player.bank} yens**\n🔒 Limite carteira: **${MAX_MONEY} yens**`)
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    /* ===== DEPOSIT ===== */
    if (interaction.commandName === 'deposit') {
      const val = interaction.options.getInteger('valor');
      if (!Number.isInteger(val) || val <= 0) return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });
      if (player.wallet < val) return interaction.reply({ content: '❌ Você não tem esse valor na carteira.', ephemeral: true });

      player.wallet -= val;
      player.bank += val;

      addLog(db, 'deposit', interaction.user.id, { amount: val });
      await queuedWrite(db);

      const e = new EmbedBuilder()
        .setTitle('🏦 Depósito efetuado')
        .setDescription(`Você depositou **${val} yens**.`)
        .addFields(
          { name: 'Carteira', value: `${player.wallet} yens`, inline: true },
          { name: 'Banco', value: `${player.bank} yens`, inline: true }
        )
        .setColor(0x66ccff)
        .setTimestamp();
      return interaction.reply({ embeds: [e], ephemeral: true });
    }

    /* ===== WITHDRAW ===== */
    if (interaction.commandName === 'withdraw') {
      const val = interaction.options.getInteger('valor');
      if (!Number.isInteger(val) || val <= 0) return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });
      if (player.bank < val) return interaction.reply({ content: '❌ Você não tem esse valor no banco.', ephemeral: true });
      if (player.wallet + val > MAX_MONEY) return interaction.reply({ content: `🚫 Não pode sacar: excede limite de carteira ${MAX_MONEY} yens.`, ephemeral: true });

      player.bank -= val;
      player.wallet += val;

      addLog(db, 'withdraw', interaction.user.id, { amount: val });
      await queuedWrite(db);

      return interaction.reply({ content: `✅ Sacado ${val} yens. Carteira: ${player.wallet} yens`, ephemeral: true });
    }

    /* ===== PROFILE ===== */
    if (interaction.commandName === 'profile') {
      await interaction.deferReply({ ephemeral: true });

      const db2 = await ensureDB();
      const p = db2.players[interaction.user.id];
      if (!p) return interaction.editReply({ content: 'Você ainda não tem perfil.' });

      const embed = new EmbedBuilder()
        .setTitle(`${p.name} — Perfil`)
        .setColor(0x0099ff)
        .addFields(
          { name: 'Yens (carteira)', value: `${p.wallet}`, inline: true },
          { name: 'Banco', value: `${p.bank}`, inline: true },
          { name: 'Vitórias', value: `${p.wins || 0}`, inline: true },
          { name: 'Derrotas', value: `${p.losses || 0}`, inline: true },
          { name: 'Streak', value: `${p.streak || 0}`, inline: true }
        )
        .setFooter({ text: 'Perfil — confidencial', iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();

      const inv = p.items || {};
      embed.addFields(
        { name: 'Sukuna Finger', value: `${SUKUNA_EMOJI} x ${inv.sukuna_finger || 0}`, inline: true },
        { name: 'Gokumonkyo', value: `${GOKU_EMOJI} x ${inv.gokumonkyo || 0}`, inline: true }
      );

      return interaction.editReply({ embeds: [embed] });
    }

    /* ===== INVENTORY ===== */
    if (interaction.commandName === 'inventory') {
      await interaction.deferReply({ ephemeral: true });

      const db2 = await ensureDB();
      const p = db2.players[interaction.user.id];
      if (!p) return interaction.editReply({ content: 'Você ainda não tem inventário.' });

      const inv = p.items || {};
      const embed = new EmbedBuilder()
        .setTitle(`${p.name} — Inventário`)
        .setColor(0xffcc66)
        .addFields(
          { name: 'Sukuna Finger', value: `${SUKUNA_EMOJI} x ${inv.sukuna_finger || 0}`, inline: true },
          { name: 'Gokumonkyo', value: `${GOKU_EMOJI} x ${inv.gokumonkyo || 0}`, inline: true }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    /* ===== TRADE ===== */
    if (interaction.commandName === 'trade') {
      await interaction.deferReply({ ephemeral: true });

      const target = interaction.options.getUser('usuario');
      const item = interaction.options.getString('item');
      const qtd = Math.max(1, Math.floor(interaction.options.getInteger('quantidade') || 1));

      if (!target) return interaction.editReply('❌ Usuário inválido.');
      if (target.id === interaction.user.id) return interaction.editReply('❌ Você não pode trocar consigo mesmo.');
      if (!['sukuna_finger', 'gokumonkyo'].includes(item)) return interaction.editReply('❌ Item inválido.');
      if ((player.items[item] || 0) < qtd) return interaction.editReply('❌ Você não tem itens suficientes.');

      ensurePlayerShape(db.players, target.id, target.username || (target.tag && target.tag.split('#')[0]));
      db.players[interaction.user.id].items[item] -= qtd;
      db.players[target.id].items[item] = (db.players[target.id].items[item] || 0) + qtd;

      // assign roles / titles if thresholds met (best-effort)
      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const memberTarget = await guild.members.fetch(target.id);
        if (db.players[target.id].items.sukuna_finger >= 2) {
          await memberTarget.roles.add(SUKUNA_ROLE_ID).catch(() => {});
          if (!db.players[target.id].titles.includes('Disgraceful King')) db.players[target.id].titles.push('Disgraceful King');
        }
        if (db.players[target.id].items.gokumonkyo >= 3) {
          await memberTarget.roles.add(GOKU_ROLE_ID).catch(() => {});
          if (!db.players[target.id].titles.includes('The Honored One')) db.players[target.id].titles.push('The Honored One');
        }
      } catch (err) {
        // ignore role assignment errors (no perms etc)
      }

      addLog(db, 'trade', interaction.user.id, { item, qty: qtd, to: target.id });
      await queuedWrite(db);

      return interaction.editReply({ content: `🔁 Trade efetuado: ${qtd}x ${item.replace(/_/g, ' ')} enviado para <@${target.id}>.` });
    }

    /* ===== SHENANIGANS_BET (FIXED & ROBUST) ===== */
    if (interaction.commandName === 'shenanigans_bet') {
      const isPrivileged = isAdmin || isFounder;
      const sundayKey = currentSundayISO();

      if (!isPrivileged) {
        if (!isSundayWindowNow()) {
          // compute how long until next Sunday 09:00
          const now = DateTime.now().setZone(TZ);
          // find next sunday at 09:00
          let nextSunday = now.plus({ days: (7 - now.weekday) % 7 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
          if (nextSunday <= now) nextSunday = nextSunday.plus({ days: 7 });
          const diff = nextSunday.diff(now).as('hours');
          return interaction.reply({ content: `⛔ Só domingo 09:00–23:59 (America/Sao_Paulo). Próxima janela em ~${Math.ceil(diff)}h.`, ephemeral: true });
        }
        if (db.workUsed[interaction.user.id] === sundayKey) return interaction.reply({ content: '⚠️ Você já usou neste domingo. Volte no próximo domingo.', ephemeral: true });
      }

      await interaction.deferReply();

      // reload db to avoid stale state
      const fresh = await ensureDB();
      ensurePlayerShape(fresh.players, interaction.user.id, interaction.user.username);
      const p = fresh.players[interaction.user.id];

      // streak logic (robust)
      try {
        const last = p.lastWorkDate;
        if (last) {
          const lastDT = DateTime.fromISO(last, { zone: TZ }).startOf('day');
          const todayDT = DateTime.now().setZone(TZ).startOf('day');
          const diffDays = Math.round(todayDT.diff(lastDT, 'days').days);
          p.streak = diffDays === 7 ? (p.streak || 0) + 1 : 1;
        } else p.streak = 1;
      } catch {
        p.streak = 1;
      }

      let reward = SHEN_BASE;
      if (p.streak % 3 === 0) reward += 100;

      // disaster chance
      if (!isPrivileged && Math.random() < DISASTER_CHANCE) {
        const loss = 150;
        p.wallet = Math.max(0, p.wallet - loss);
        p.streak = 0;
        p.lastWorkDate = nowISODate();
        fresh.workUsed[interaction.user.id] = sundayKey;
        addLog(fresh, 'bet_disaster', interaction.user.id, { loss });
        await queuedWrite(fresh);

        const e = new EmbedBuilder()
          .setTitle('💥 DESASTRE!')
          .setDescription(`Uma calamidade te atingiu — perdeu **${loss} yens**. Sua streak foi resetada.`)
          .setColor(0xff3333)
          .setTimestamp();
        return interaction.editReply({ embeds: [e] });
      }

      // secret drops
      let secret = '';
      const r = Math.random();
      if (r < 0.05) { p.items.sukuna_finger = (p.items.sukuna_finger || 0) + 1; secret = `🎁 Encontrou ${SUKUNA_EMOJI} **Sukuna Finger**!`; addLog(fresh, 'item_drop', interaction.user.id, { item: 'sukuna_finger' }); }
      else if (r < 0.10) { p.items.gokumonkyo = (p.items.gokumonkyo || 0) + 1; secret = `🎁 Encontrou ${GOKU_EMOJI} **Gokumonkyo**!`; addLog(fresh, 'item_drop', interaction.user.id, { item: 'gokumonkyo' }); }
      else if (r < 0.12) { reward = Math.floor(reward * 1.5); secret = `✨ Missão secreta: multiplicador x1.5!`; addLog(fresh, 'bet_buff', interaction.user.id, { multiplier: 1.5 }); }

      p.wallet = Math.min(MAX_MONEY, (p.wallet || 0) + reward);
      p.lastWorkDate = nowISODate();
      fresh.workUsed[interaction.user.id] = sundayKey;
      fresh.players[interaction.user.id] = p;

      addLog(fresh, 'bet', interaction.user.id, { reward, streak: p.streak });
      await queuedWrite(fresh);

      const embed = new EmbedBuilder()
        .setTitle('💼 Shenanigans Bet')
        .setColor(0x00cc99)
        .setDescription(`Você recebeu **${reward} yens**!\n${secret}`)
        .addFields(
          { name: 'Streak', value: `${p.streak}`, inline: true },
          { name: 'Carteira', value: `${p.wallet} yens`, inline: true }
        )
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    /* ===== X1_RESULT (staff) ===== */
    if (interaction.commandName === 'x1_result') {
      if (!isAdmin) return interaction.reply({ content: '🔒 Apenas staff.', ephemeral: true });
      const vencedor = interaction.options.getUser('vencedor');
      const perdedor = interaction.options.getUser('perdedor');
      const valor = interaction.options.getInteger('valor');
      if (!vencedor || !perdedor || vencedor.id === perdedor.id) return interaction.reply({ content: '❌ Parâmetros inválidos.', ephemeral: true });
      if (!Number.isInteger(valor) || valor <= 0) return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });

      ensurePlayerShape(db.players, vencedor.id, vencedor.username);
      ensurePlayerShape(db.players, perdedor.id, perdedor.username);
      const w = db.players[vencedor.id], l = db.players[perdedor.id];

      const pay = Math.min(valor, l.wallet || 0);
      l.wallet = Math.max(0, (l.wallet || 0) - pay);
      w.wallet = Math.min(MAX_MONEY, (w.wallet || 0) + pay * 2);
      w.wins = (w.wins || 0) + 1;
      l.losses = (l.losses || 0) + 1;

      addLog(db, 'x1_result', interaction.user.id, { winner: vencedor.id, loser: perdedor.id, value: valor, paid: pay });
      await queuedWrite(db);

      return interaction.reply({ content: `🎮 Resultado registrado: ${vencedor.username} venceu ${perdedor.username}. Transferido: ${pay * 2} yens.` });
    }

    /* ===== RANK ===== */
    if (interaction.commandName === 'rank') {
      const arr = Object.values(db.players || {})
        .map(p => ({ name: p.name, wins: p.wins || 0, wealth: (p.wallet || 0) + (p.bank || 0) }))
        .sort((a, b) => b.wins - a.wins || b.wealth - a.wealth)
        .slice(0, 10);

      const embed = new EmbedBuilder()
        .setTitle('🏆 Ranking Top 10')
        .setColor(0xffcc00)
        .setDescription(arr.length ? arr.map((p, i) => `**${i + 1}. ${p.name}** — Vitórias: ${p.wins} — Yens: ${p.wealth}`).join('\n') : 'Sem registros ainda.')
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    /* ===== HISTORY ===== */
    if (interaction.commandName === 'history') {
      await interaction.deferReply({ ephemeral: true });
      const max = Math.min(50, Math.max(5, interaction.options.getInteger('max') || 10));
      const logs = (db.logs || []).filter(l => l.userId === interaction.user.id).slice(0, max);
      if (!logs.length) return interaction.editReply({ content: 'Nenhum histórico encontrado.' });

      const lines = logs.map(l => `• [${l.ts}] ${l.type} — ${JSON.stringify(l.details)}`).join('\n');
      const embed = new EmbedBuilder()
        .setTitle('📜 Seu histórico recente')
        .setDescription(lines)
        .setColor(0x8888ff)
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    /* ===== BACKUP RESTORE (admin) =====
       For safety this command only writes a msg — actual restore should be done manually by owner:
       we expose the list of backups and path so admin can restore offline if needed.
    */
    if (interaction.commandName === 'backup_restore') {
      if (!isAdmin) return interaction.reply({ content: '🔒 Apenas staff.', ephemeral: true });

      const files = (await fs.readdir(BACKUP_DIR)).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 10);
      if (!files.length) return interaction.reply({ content: 'Nenhum backup disponível.', ephemeral: true });

      const list = files.map((f, i) => `**${i + 1}.** ${f}`).join('\n');
      const embed = new EmbedBuilder()
        .setTitle('📦 Backups (últimos 10)')
        .setDescription(list)
        .setFooter({ text: `Pasta de backups: ${BACKUP_DIR}` })
        .setColor(0xaaaaaa)
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    return interaction.reply({ content: 'Comando não implementado (ainda).', ephemeral: true });
  } catch (err) {
    console.error('Erro interaction handler:', err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Erro interno. Tente novamente.', ephemeral: true });
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: '❌ Erro interno. Tente novamente.' });
      }
    } catch (e) {
      console.error('Erro fallback reply:', e);
    }
  }
});

/* ========== HELPER: load DB & autosave on SIGINT ========== */
async function startupChecks() {
  try {
    const db = await ensureDB();
    // ensure shape for any missing player keys & migrate small things
    db.players = db.players || {};
    for (const id of Object.keys(db.players)) ensurePlayerShape(db.players, id, db.players[id].name);
    await queuedWrite(db);
  } catch (e) {
    console.error('Erro startupChecks:', e);
  }
}
startupChecks();

/* autosave and backup on exit */
async function gracefulExit() {
  console.log('Graceful shutdown: salvando DB e criando backup...');
  try {
    const db = await ensureDB();
    await queuedWrite(db);
    const file = await createBackup(db);
    console.log('Backup final criado:', file);
  } catch (e) {
    console.error('Erro no gracefulExit:', e);
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', gracefulExit);
process.on('SIGTERM', gracefulExit);

/* ========== LOGIN ========== */
client.login(TOKEN).then(() => console.log('Bot logado')).catch(err => {
  console.error('Erro ao logar:', err);
});
