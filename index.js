/**
 * index.js — versão revisada (profile & inventory corrigidos)
 * - Persistência segura em data.json
 * - Comandos guild-only (evita duplicação global)
 * - deferReply/editReply para evitar "aplicativo não respondeu"
 * - Handlers de erro globais
 *
 * IMPORTANT: coloque TOKEN em env vars do Railway (.env not used here)
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

/* ========== CONFIG ========== */
// do NOT hardcode your token here. Put in env var TOKEN on Railway.
const TOKEN = process.env.TOKEN;
if (!TOKEN) throw new Error('TOKEN missing in environment variables.');

const GUILD_ID = '1461942839331127520';
const DATA_PATH = path.join(__dirname, 'data.json');
const TZ = 'America/Sao_Paulo';

const START_YENS = 600;
const MAX_MONEY = 5000;
const SHEN_BASE = 270;
const DISASTER_CHANCE = 0.05;

const FOUNDER_ROLE_ID = '1463413721970769973';
const SUKUNA_ROLE_ID = '1463413152824819753';
const GOKU_ROLE_ID = '1463413249734086860';

const SUKUNA_EMOJI = '<:sukuna_finger:1463407933449572352>';
const GOKU_EMOJI = '<:Gokumonkyo:1463408847556444233>';

/* ========== GLOBAL ERROR HANDLERS ========== */
process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION', err);
});
process.on('unhandledRejection', err => {
  console.error('UNHANDLED REJECTION', err);
});

/* ========== SAFE JSON IO ========== */
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
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

/* ========== TIME HELPERS ========== */
function nowISO() {
  return DateTime.now().setZone(TZ).toISODate(); // YYYY-MM-DD
}
function isSundayWindow() {
  const d = DateTime.now().setZone(TZ);
  return d.weekday === 7 && d.hour >= 9 && d.hour <= 23; // Sunday 9-23
}

/* ========== DB BOOT ================= */
async function ensureDB() {
  return loadJSON(DATA_PATH, { players: {}, workUsed: {} });
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
  }
  return players[id];
}

/* ========== CLIENT & COMMANDS ========== */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* Commands to register (guild only) */
const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Teste do bot'),
  new SlashCommandBuilder().setName('balance').setDescription('Ver carteira e banco'),
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
  new SlashCommandBuilder().setName('rank').setDescription('Ranking top 10 por vitórias')
].map(c => c.toJSON());

/* Register commands on ready (guild-only) */
client.once('ready', async () => {
  console.log('Bot ready:', client.user.tag);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Comandos registrados (guild)');
  } catch (err) {
    console.error('Erro registrando comandos:', err);
  }
});

/* Simple anti-spam (1s/window per user) */
const lastCmd = new Map();
function allowNow(userId) {
  const now = Date.now();
  const last = lastCmd.get(userId) || 0;
  if (now - last < 900) return false;
  lastCmd.set(userId, now);
  return true;
}

/* ========== INTERACTION HANDLER ========== */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!allowNow(interaction.user.id)) {
    return interaction.reply({ content: '⏳ Aguarde um pouco antes de usar comandos novamente.', ephemeral: true });
  }

  // load DB
  const db = await ensureDB();
  db.players = db.players || {};
  db.workUsed = db.workUsed || {};

  // ensure player
  ensurePlayerShape(db.players, interaction.user.id, interaction.user.username);
  const player = db.players[interaction.user.id];

  // permissions
  const member = interaction.member;
  const isAdmin = member && (member.permissions?.has(PermissionFlagsBits.Administrator) || false);
  const isFounder = member && member.roles?.cache?.has(FOUNDER_ROLE_ID);

  try {
    /* ========== PING ========== */
    if (interaction.commandName === 'ping') {
      return interaction.reply({ content: `🏓 Pong — ${client.user.tag}`, ephemeral: true });
    }

    /* ========== BALANCE ========== */
    if (interaction.commandName === 'balance') {
      // quick reply (no heavy work)
      const embed = new EmbedBuilder()
        .setTitle(`${player.name} — Carteira & Banco`)
        .setColor(0x00cc99)
        .setDescription(`💰 Carteira: **${player.wallet} yens**\n🏦 Banco: **${player.bank} yens**\n🔒 Limite total: **${MAX_MONEY} yens**`)
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    /* ========== PROFILE (FIXED) ========== */
    if (interaction.commandName === 'profile') {
      await interaction.deferReply({ ephemeral: true });

      // reload db in case changed
      const db2 = await ensureDB();
      const p = db2.players[interaction.user.id];
      if (!p) {
        return interaction.editReply({ content: 'Você ainda não tem perfil.' });
      }

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

      // inventory summary small
      const inv = p.items || {};
      embed.addFields(
        { name: 'Sukuna Finger', value: `${SUKUNA_EMOJI} x ${inv.sukuna_finger || 0}`, inline: true },
        { name: 'Gokumonkyo', value: `${GOKU_EMOJI} x ${inv.gokumonkyo || 0}`, inline: true }
      );

      return interaction.editReply({ embeds: [embed] });
    }

    /* ========== INVENTORY (FIXED) ========== */
    if (interaction.commandName === 'inventory') {
      await interaction.deferReply({ ephemeral: true });

      const db2 = await ensureDB();
      const p = db2.players[interaction.user.id];
      if (!p) {
        return interaction.editReply({ content: 'Você ainda não tem inventário.' });
      }

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

    /* ========== WITHDRAW ========== */
    if (interaction.commandName === 'withdraw') {
      const val = interaction.options.getInteger('valor');
      if (!Number.isInteger(val) || val <= 0) return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });
      if (player.bank < val) return interaction.reply({ content: '❌ Você não tem esse valor no banco.', ephemeral: true });
      if (player.wallet + val > MAX_MONEY) return interaction.reply({ content: `🚫 Não pode sacar: excede limite ${MAX_MONEY} yens.`, ephemeral: true });

      player.bank -= val;
      player.wallet += val;
      await safeWriteJSON(DATA_PATH, db);
      return interaction.reply({ content: `✅ Sacado ${val} yens. Carteira: ${player.wallet} yens`, ephemeral: true });
    }

    /* ========== TRADE ========== */
    if (interaction.commandName === 'trade') {
      await interaction.deferReply({ ephemeral: true });
      const target = interaction.options.getUser('usuario');
      const item = interaction.options.getString('item');
      const qtd = Math.max(1, Math.floor(interaction.options.getInteger('quantidade') || 1));

      if (!target) return interaction.editReply('❌ Usuário inválido.');
      if (target.id === interaction.user.id) return interaction.editReply('❌ Não pode trocar consigo mesmo.');
      if (!['sukuna_finger', 'gokumonkyo'].includes(item)) return interaction.editReply('❌ Item inválido.');

      if ((player.items[item] || 0) < qtd) return interaction.editReply('❌ Você não tem itens suficientes.');

      // ensure receiver
      ensurePlayerShape(db.players, target.id, target.username || target.tag);
      db.players[interaction.user.id].items[item] -= qtd;
      db.players[target.id].items[item] = (db.players[target.id].items[item] || 0) + qtd;

      // assign roles if thresholds met (best effort)
      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const memberTarget = await guild.members.fetch(target.id);
        if (db.players[target.id].items.sukuna_finger >= 2) {
          await memberTarget.roles.add(SUKUNA_ROLE_ID).catch(()=>{});
          if (!db.players[target.id].titles.includes('Disgraceful King')) db.players[target.id].titles.push('Disgraceful King');
        }
        if (db.players[target.id].items.gokumonkyo >= 3) {
          await memberTarget.roles.add(GOKU_ROLE_ID).catch(()=>{});
          if (!db.players[target.id].titles.includes('The Honored One')) db.players[target.id].titles.push('The Honored One');
        }
      } catch (err) {
        // ignore permission issues
      }

      await safeWriteJSON(DATA_PATH, db);
      return interaction.editReply({ content: `🔁 Trade efetuado: ${qtd}x ${item.replace('_',' ')} enviado para <@${target.id}>.` });
    }

    /* ========== SHENANIGANS_BET ========== */
    if (interaction.commandName === 'shenanigans_bet') {
      // privileged: admins and founders may bypass day restriction (if you want change logic)
      const isPrivileged = isAdmin || isFounder;
      const today = nowISO();

      if (!isPrivileged) {
        if (!isSundayWindow()) return interaction.reply({ content: '⛔ Só domingo 09:00–23:59', ephemeral: true });
        if (db.workUsed[interaction.user.id] === today) return interaction.reply({ content: '⚠️ Já usou hoje.', ephemeral: true });
      }

      await interaction.deferReply();
      // streak logic
      const last = player.lastWorkDate || null;
      if (last) {
        try {
          const lastDT = DateTime.fromISO(last, { zone: TZ }).startOf('day');
          const todayDT = DateTime.fromISO(today, { zone: TZ }).startOf('day');
          const diff = todayDT.diff(lastDT, 'days').days;
          player.streak = diff === 7 ? (player.streak || 0) + 1 : 1;
        } catch { player.streak = 1; }
      } else player.streak = 1;

      // reward
      let reward = SHEN_BASE;
      if (player.streak % 3 === 0) reward += 100;

      // disaster chance (only for non-privileged)
      if (!isPrivileged && Math.random() < DISASTER_CHANCE) {
        const loss = 150;
        player.wallet = Math.max(0, player.wallet - loss);
        player.streak = 0;
        player.lastWorkDate = today;
        db.workUsed[interaction.user.id] = today;
        await safeWriteJSON(DATA_PATH, db);
        const e = new EmbedBuilder()
          .setTitle('💥 DESASTRE!')
          .setDescription(`Você perdeu **${loss} yens**. Streak resetado.`)
          .setColor(0xff3333);
        return interaction.editReply({ embeds: [e] });
      }

      // secret item drops
      let secret = '';
      const r = Math.random();
      if (r < 0.05) { player.items.sukuna_finger = (player.items.sukuna_finger || 0) + 1; secret = `🎁 Encontrou ${SUKUNA_EMOJI} Sukuna Finger!`; }
      else if (r < 0.10) { player.items.gokumonkyo = (player.items.gokumonkyo || 0) + 1; secret = `🎁 Encontrou ${GOKU_EMOJI} Gokumonkyo!`; }
      else if (r < 0.12) { reward = Math.floor(reward * 1.5); secret = `✨ Missão secreta: multiplicador x1.5!`; }

      player.wallet = Math.min(MAX_MONEY, (player.wallet || 0) + reward);
      player.lastWorkDate = today;
      db.workUsed[interaction.user.id] = today;
      await safeWriteJSON(DATA_PATH, db);

      const embed = new EmbedBuilder()
        .setTitle('💼 Shenanigans Bet')
        .setColor(0x00cc99)
        .setDescription(`Você recebeu **${reward} yens**!\n${secret}`)
        .addFields(
          { name: 'Streak', value: `${player.streak}`, inline: true },
          { name: 'Carteira', value: `${player.wallet} yens`, inline: true }
        );
      return interaction.editReply({ embeds: [embed] });
    }

    /* ========== X1_RESULT (staff) ========== */
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

      // transfer: loser pays up to valor; winner gets valor*2 from house (we keep same logic you used)
      const pay = Math.min(valor, l.wallet || 0);
      l.wallet = Math.max(0, (l.wallet || 0) - pay);
      w.wallet = Math.min(MAX_MONEY, (w.wallet || 0) + pay * 2);
      w.wins = (w.wins || 0) + 1;
      l.losses = (l.losses || 0) + 1;

      await safeWriteJSON(DATA_PATH, db);
      return interaction.reply({ content: `🎮 Resultado: ${vencedor.username} venceu ${perdedor.username}. Transferido: ${pay * 2} yens.` });
    }

    /* ========== RANK ========== */
    if (interaction.commandName === 'rank') {
      const arr = Object.values(db.players || {})
        .map(p => ({ name: p.name, wins: p.wins || 0, wealth: (p.wallet||0)+(p.bank||0) }))
        .sort((a,b) => b.wins - a.wins || b.wealth - a.wealth)
        .slice(0,10);

      const embed = new EmbedBuilder()
        .setTitle('🏆 Ranking Top 10')
        .setColor(0xffcc00)
        .setDescription(arr.length ? arr.map((p,i) => `**${i+1}. ${p.name}** — Vitórias: ${p.wins} — Yens: ${p.wealth}`).join('\n') : 'Sem registros ainda.');
      return interaction.reply({ embeds: [embed] });
    }

    // default fallback
    return interaction.reply({ content: 'Comando não implementado (ainda).', ephemeral: true });

  } catch (err) {
    console.error('Erro interaction handler:', err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Erro interno. Tente novamente.', ephemeral: true });
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: '❌ Erro interno. Tente novamente.' });
      }
    } catch (e) { console.error('Erro reply fallback:', e); }
  }
});

/* ========== LOGIN ========== */
client.login(TOKEN).then(() => console.log('Bot logado')).catch(err => {
  console.error('Erro ao logar:', err);
});
