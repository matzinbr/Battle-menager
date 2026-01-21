/**
 * index.js — Versão final, revisada e hardenizada
 * - Discord.js v14
 * - Registra comandos apenas no GUILD (evita duplicação)
 * - Persistência segura em JSON (atomic write)
 * - /shenanigans_bet com regras completas e UI (embeds)
 * - /trade, /inventory, /profile, /rank, /x1_result (staff), /balance, /withdraw
 * - Proteções: deferReply, rate-limit simples, validações
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { DateTime } = require('luxon');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;
if (!TOKEN) throw new Error('TOKEN missing in .env');

const CLIENT_ID = process.env.CLIENT_ID || null; // optional - we will use client.user.id in ready
const GUILD_ID = '1461942839331127520'; // provided by you

const DATA_FILE = path.join(__dirname, 'data.json'); // single file to store everything
const TZ = 'America/Sao_Paulo';

const START_YENS = 600;
const MAX_MONEY = 5000;
const SHEN_BASE = 270;
const DISASTER_CHANCE = 0.05; // 5%

// Role IDs (provided)
const FOUNDER_ROLE_ID = '1463413721970769973';
const SUKUNA_ROLE_ID = '1463413152824819753';
const GOKU_ROLE_ID = '1463413249734086860';

// Item emojis (provided)
const SUKUNA_EMOJI = '<:sukuna_finger:1463407933449572352>';
const GOKU_EMOJI = '<:Gokumonkyo:1463408847556444233>';

const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null; // optional channel for logs

/* ================= HELPERS: FS safe load/save ================= */
async function loadJSON(filePath, defaultValue) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    await safeWriteJSON(filePath, defaultValue);
    return defaultValue;
  }
}

async function safeWriteJSON(filePath, obj) {
  const tmp = `${filePath}.tmp`;
  const data = JSON.stringify(obj, null, 2);
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, filePath);
}

/* ================= HELPERS: time and utils ================= */
function nowISODate() {
  return DateTime.now().setZone(TZ).toISODate(); // YYYY-MM-DD
}
function isSundayWindow() {
  const d = DateTime.now().setZone(TZ);
  return d.weekday === 7 && d.hour >= 9 && d.hour <= 23;
}
function clampMoney(x) {
  return Math.min(x, MAX_MONEY);
}
function recentSeconds() {
  return Math.floor(Date.now() / 1000);
}
function safeString(s) {
  return (s || '').toString().substring(0, 100);
}

/* ================= DB Boot ================= */
async function ensureDB() {
  return await loadJSON(DATA_FILE, {
    players: {},        // keyed by userId
    workUsed: {},       // last used ISO date per user
    cooldowns: {}       // simple cooldowns if needed
  });
}

/* ================= CLIENT ================= */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ================= RATE LIMIT (in-memory) ================= */
const interactionRateLimit = new Map(); // userId -> timestamp last command (seconds)
const RATE_LIMIT_SECONDS = 1; // basic anti-spam across commands

function checkRateLimit(userId) {
  const now = recentSeconds();
  const last = interactionRateLimit.get(userId) || 0;
  if (now - last < RATE_LIMIT_SECONDS) return false;
  interactionRateLimit.set(userId, now);
  return true;
}

/* ================= COMMAND DEFINITIONS ================= */
const commandBuilders = [
  new SlashCommandBuilder().setName('ping').setDescription('Teste rápido do bot'),

  new SlashCommandBuilder().setName('balance').setDescription('Ver carteira e banco'),

  new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Sacar yens do banco para carteira')
    .addIntegerOption(o => o.setName('valor').setDescription('Valor para sacar').setRequired(true)),

  new SlashCommandBuilder().setName('profile').setDescription('Ver seu perfil'),

  new SlashCommandBuilder().setName('inventory').setDescription('Ver seu inventário'),

  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Trocar item com outro usuário (envia direto)')
    .addUserOption(o => o.setName('usuario').setDescription('Quem recebe').setRequired(true))
    .addStringOption(o => o.setName('item').setDescription('Item').setRequired(true)
      .addChoices(
        { name: 'Sukuna Finger', value: 'sukuna_finger' },
        { name: 'Gokumonkyo', value: 'gokumonkyo' }
      ))
    .addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName('shenanigans_bet')
    .setDescription('Shenanigans Bet — domingos 09:00–23:59 (1x por domingo para membros). Admins/fundadores têm prioridade.'),

  new SlashCommandBuilder()
    .setName('x1_result')
    .setDescription('Registrar resultado X1 (staff)')
    .addUserOption(o => o.setName('vencedor').setDescription('Quem ganhou').setRequired(true))
    .addUserOption(o => o.setName('perdedor').setDescription('Quem perdeu').setRequired(true))
    .addIntegerOption(o => o.setName('valor').setDescription('Valor apostado').setRequired(true)),

  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Mostrar ranking top 10 por vitórias')
].map(c => c.toJSON());

/* ================= REGISTER COMMANDS (GUILD ONLY) ================= */
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  try {
    // Register guild commands only (fast propagation)
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commandBuilders });
    console.log('✅ Comandos registrados no servidor');
  } catch (err) {
    console.error('Erro ao registrar comandos:', err);
  }
});

/* ================= SAFE REPLY WRAPPER ================= */
async function safeReply(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.editReply(payload);
    } else {
      return await interaction.reply(payload);
    }
  } catch (err) {
    console.error('safeReply err:', err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Erro interno ao responder.', ephemeral: true });
      }
    } catch {}
  }
}

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // basic anti-spam
  if (!checkRateLimit(interaction.user.id)) {
    return interaction.reply({ content: '⏳ Aguarde um pouco antes de usar comandos novamente.', ephemeral: true });
  }

  // load DB fresh per interaction (safe)
  const db = await ensureDB();
  db.players = db.players || {};
  db.workUsed = db.workUsed || {};

  const uid = interaction.user.id;
  const username = interaction.user.username || interaction.user.tag;
  // ensure player
  if (!db.players[uid]) {
    db.players[uid] = {
      id: uid,
      name: username,
      wallet: START_YENS,
      bank: 0,
      wins: 0,
      losses: 0,
      streak: 0,
      lastWorkDate: null,
      items: { sukuna_finger: 0, gokumonkyo: 0 },
      titles: []
    };
    await safeWriteJSON(DATA_FILE, db);
  }
  const player = db.players[uid];

  // permission helpers
  const member = interaction.member; // may be GuildMember
  const isAdmin = member && (member.permissions?.has(PermissionFlagsBits.Administrator) || false);
  const isFounder = member && member.roles?.cache?.has(FOUNDER_ROLE_ID);

  try {
    /* --------------- PING --------------- */
    if (interaction.commandName === 'ping') {
      await interaction.reply({ content: `🏓 Pong! ${client.user.tag}`, ephemeral: true });
      return;
    }

    /* --------------- BALANCE --------------- */
    if (interaction.commandName === 'balance' || interaction.commandName === 'profile') {
      await interaction.deferReply({ ephemeral: true });
      const embed = new EmbedBuilder()
        .setTitle(`${player.name} — Carteira & Banco`)
        .setColor(0x00cc99)
        .setDescription(`💴 Carteira: **${player.wallet} yens**\n🏦 Banco: **${player.bank} yens**\n🔒 Limite total: **${MAX_MONEY} yens**`)
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    /* --------------- WITHDRAW --------------- */
    if (interaction.commandName === 'withdraw') {
      const val = interaction.options.getInteger('valor');
      if (!Number.isInteger(val) || val <= 0) {
        return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });
      }
      if (player.bank < val) {
        return interaction.reply({ content: '❌ Você não tem esse valor no banco.', ephemeral: true });
      }
      if (player.wallet + val > MAX_MONEY) {
        return interaction.reply({ content: `🚫 Não pode sacar: isso ultrapassaria o limite total de ${MAX_MONEY} yens.`, ephemeral: true });
      }
      player.bank -= val;
      player.wallet += val;
      await safeWriteJSON(DATA_FILE, db);
      return interaction.reply({ content: `✅ Você sacou ${val} yens. Carteira: ${player.wallet} yens` });
    }

    /* --------------- INVENTORY --------------- */
    if (interaction.commandName === 'inventory') {
      await interaction.deferReply({ ephemeral: true });
      const inv = player.items || {};
      const embed = new EmbedBuilder()
        .setTitle(`${player.name} — Inventário`)
        .setColor(0xffcc66)
        .addFields(
          { name: 'Sukuna Finger', value: `${SUKUNA_EMOJI} x ${inv.sukuna_finger || 0}`, inline: true },
          { name: 'Gokumonkyo', value: `${GOKU_EMOJI} x ${inv.gokumonkyo || 0}`, inline: true },
          { name: 'Títulos', value: (player.titles.length ? player.titles.join(', ') : 'Nenhum'), inline: false }
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    /* --------------- TRADE --------------- */
    if (interaction.commandName === 'trade') {
      await interaction.deferReply({ ephemeral: true });
      const target = interaction.options.getUser('usuario');
      const item = interaction.options.getString('item');
      const qtd = Math.max(1, Math.floor(interaction.options.getInteger('quantidade') || 1));

      if (!target) return interaction.editReply('❌ Usuário inválido.');
      if (target.id === uid) return interaction.editReply('❌ Você não pode trocar com você mesmo.');

      if (!['sukuna_finger', 'gokumonkyo'].includes(item)) return interaction.editReply('❌ Item inválido.');

      if ((player.items[item] || 0) < qtd) return interaction.editReply('❌ Você não tem itens suficientes.');

      // ensure receiver
      if (!db.players[target.id]) {
        db.players[target.id] = {
          id: target.id,
          name: target.username || target.tag,
          wallet: START_YENS,
          bank: 0,
          wins: 0,
          losses: 0,
          streak: 0,
          lastWorkDate: null,
          items: { sukuna_finger: 0, gokumonkyo: 0 },
          titles: []
        };
      }
      const receiver = db.players[target.id];

      // transfer
      player.items[item] -= qtd;
      receiver.items[item] = (receiver.items[item] || 0) + qtd;

      // award roles if thresholds reached (best effort)
      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const memberTarget = await guild.members.fetch(target.id);
        if (receiver.items.sukuna_finger >= 2) {
          await memberTarget.roles.add(SUKUNA_ROLE_ID).catch(()=>{});
          if (!receiver.titles.includes('Disgraceful King')) receiver.titles.push('Disgraceful King');
        }
        if (receiver.items.gokumonkyo >= 3) {
          await memberTarget.roles.add(GOKU_ROLE_ID).catch(()=>{});
          if (!receiver.titles.includes('The Honored One')) receiver.titles.push('The Honored One');
        }
      } catch (err) {
        // ignore role assign failures (bot may lack perms)
      }

      await safeWriteJSON(DATA_FILE, db);

      const reply = `🔁 Trade concluído: você enviou **${qtd}x ${item.replace('_',' ')}** para <@${target.id}>.`;
      return interaction.editReply({ content: reply });
    }

    /* --------------- SHENANIGANS BET --------------- */
    if (interaction.commandName === 'shenanigans_bet') {
      // Admins and founders: allowed anytime, multiple times
      const isPrivileged = isAdmin || isFounder;

      // if not privileged, must be Sunday window AND once per sunday
      const todayIso = nowISODate();
      if (!isPrivileged) {
        if (!isSundayWindow()) {
          return interaction.reply({ content: '⛔ Shenanigans Bet só funciona aos domingos (09:00–23:59).', ephemeral: true });
        }
        if (db.workUsed[uid] === todayIso) {
          return interaction.reply({ content: '⚠️ Você já usou o Shenanigans Bet hoje (domingo).', ephemeral: true });
        }
      }

      // process
      await interaction.deferReply();

      // streak detection (consecutive sundays)
      const last = player.lastWorkDate || null;
      if (last) {
        // check if last was exactly 7 days before
        try {
          const lastDT = DateTime.fromISO(last, { zone: TZ }).startOf('day');
          const todayDT = DateTime.fromISO(todayIso, { zone: TZ }).startOf('day');
          const diff = todayDT.diff(lastDT, 'days').days;
          if (diff === 7) player.streak = (player.streak || 0) + 1;
          else player.streak = 1;
        } catch {
          player.streak = 1;
        }
      } else {
        player.streak = 1;
      }

      // base reward
      let reward = SHEN_BASE;

      // streak bonus
      let streakBonus = 0;
      if (player.streak % 3 === 0) {
        streakBonus = 100;
        reward += streakBonus;
      }

      // disaster check (small chance to lose)
      if (!isPrivileged && Math.random() < DISASTER_CHANCE) {
        const loss = 150;
        player.wallet = Math.max(0, player.wallet - loss);
        player.streak = 0;
        player.lastWorkDate = todayIso;
        db.workUsed[uid] = todayIso;
        await safeWriteJSON(DATA_FILE, db);

        const e = new EmbedBuilder()
          .setTitle('💥 DESASTRE!')
          .setDescription(`Que azar... você sofreu um desastre e perdeu **${loss} yens**.\nSua streak foi resetada.`)
          .setColor(0xff4444)
          .setTimestamp();
        return interaction.editReply({ embeds: [e] });
      }

      // secret drops
      let secretMsg = '';
      const r = Math.random();
      if (r < 0.05) { // 5% sukuna
        player.items.sukuna_finger = (player.items.sukuna_finger || 0) + 1;
        secretMsg += `🎁 Você encontrou: ${SUKUNA_EMOJI} **Sukuna Finger**!\n`;
      } else if (r < 0.10) { // 5% gokumonkyo
        player.items.gokumonkyo = (player.items.gokumonkyo || 0) + 1;
        secretMsg += `🎁 Você encontrou: ${GOKU_EMOJI} **Gokumonkyo**!\n`;
      } else if (r < 0.12) { // 2% multiplier
        reward = Math.floor(reward * 1.5);
        secretMsg += `✨ Missão secreta: multiplicador x1.5 aplicado!\n`;
      }

      // apply reward and clamp
      player.wallet = clampMoney((player.wallet || 0) + reward);
      player.lastWorkDate = todayIso;
      db.workUsed[uid] = todayIso;

      // auto-assign roles if thresholds reached
      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const memberMe = await guild.members.fetch(uid);
        if ((player.items.sukuna_finger || 0) >= 2) {
          await memberMe.roles.add(SUKUNA_ROLE_ID).catch(()=>{});
          if (!player.titles.includes('Disgraceful King')) player.titles.push('Disgraceful King');
        }
        if ((player.items.gokumonkyo || 0) >= 3) {
          await memberMe.roles.add(GOKU_ROLE_ID).catch(()=>{});
          if (!player.titles.includes('The Honored One')) player.titles.push('The Honored One');
        }
      } catch (err) {
        // ignore permission issues
      }

      await safeWriteJSON(DATA_FILE, db);

      const embed = new EmbedBuilder()
        .setTitle('💼 Shenanigans Bet')
        .setColor(0x00cc99)
        .setDescription(`Você recebeu **${reward} yens**! ${secretMsg ? '\n' + secretMsg : ''}`)
        .addFields(
          { name: 'Streak', value: `${player.streak}`, inline: true },
          { name: 'Carteira', value: `${player.wallet} yens`, inline: true }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    /* --------------- X1_RESULT (staff) --------------- */
    if (interaction.commandName === 'x1_result') {
      if (!isAdmin) return interaction.reply({ content: '🔒 Apenas staff pode usar.', ephemeral: true });

      const vencedor = interaction.options.getUser('vencedor');
      const perdedor = interaction.options.getUser('perdedor');
      const valor = interaction.options.getInteger('valor');

      if (!vencedor || !perdedor || vencedor.id === perdedor.id) {
        return interaction.reply({ content: '❌ Parâmetros inválidos.', ephemeral: true });
      }
      if (typeof valor !== 'number' || valor <= 0) {
        return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });
      }

      // ensure entries
      if (!db.players[vencedor.id]) {
        db.players[vencedor.id] = { id: vencedor.id, name: vencedor.username, wallet: START_YENS, bank: 0, wins: 0, losses: 0, streak: 0, lastWorkDate: null, items: { sukuna_finger: 0, gokumonkyo: 0 }, titles: [] };
      }
      if (!db.players[perdedor.id]) {
        db.players[perdedor.id] = { id: perdedor.id, name: perdedor.username, wallet: START_YENS, bank: 0, wins: 0, losses: 0, streak: 0, lastWorkDate: null, items: { sukuna_finger: 0, gokumonkyo: 0 }, titles: [] };
      }

      const winP = db.players[vencedor.id];
      const loseP = db.players[perdedor.id];

      winP.wins = (winP.wins || 0) + 1;
      loseP.losses = (loseP.losses || 0) + 1;

      // transfer yens: loser pays 'valor', winner gains valor*2 (net +valor)
      // guard against negative
      const pay = Math.min(valor, loseP.wallet || 0);
      loseP.wallet = Math.max(0, (loseP.wallet || 0) - pay);
      winP.wallet = clampMoney((winP.wallet || 0) + pay * 2);

      await safeWriteJSON(DATA_FILE, db);

      return interaction.reply({ content: `🎮 Resultado registrado: ${vencedor.username} venceu ${perdedor.username}. Valor transferido: ${pay * 2} yens.` });
    }

    /* --------------- RANK --------------- */
    if (interaction.commandName === 'rank') {
      const arr = Object.values(db.players || [])
        .map(p => ({ name: p.name, wins: p.wins || 0, wealth: (p.wallet||0)+(p.bank||0) }))
        .sort((a,b) => b.wins - a.wins || b.wealth - a.wealth)
        .slice(0, 10);

      const embed = new EmbedBuilder()
        .setTitle('🏆 Ranking Top 10 (vitórias)')
        .setColor(0xffcc00)
        .setDescription(arr.length ? arr.map((p,i) => `**${i+1}. ${safeString(p.name)}** — Vitórias: ${p.wins} — Yens: ${p.wealth}`).join('\n') : 'Nenhum registro ainda.');

      return interaction.reply({ embeds: [embed] });
    }

    // fallback
    return interaction.reply({ content: 'Comando não implementado ainda.', ephemeral: true });

  } catch (err) {
    console.error('Erro na interaction:', err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Erro interno. Tente novamente.', ephemeral: true });
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: '❌ Erro interno. Tente novamente.' });
      }
    } catch {}
  }
});

/* ================= OPTIONAL LOG CHANNEL SENDER ================= */
async function sendLog(msg) {
  console.log(msg);
  if (!LOG_CHANNEL_ID) return;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const ch = await guild.channels.fetch(LOG_CHANNEL_ID);
    await ch.send(msg);
  } catch (err) {
    console.warn('Failed to send log to channel', err);
  }
}

/* ================= LOGIN ================= */
client.login(TOKEN).then(() => console.log('Logado com sucesso')).catch(err => {
  console.error('Erro ao logar:', err);
});
