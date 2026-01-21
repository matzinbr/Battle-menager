/**
 * Battle Manager — index.js (refatorado)
 * - Registra comandos apenas no GUILD (evita duplicação)
 * - Persiste users.json / state.json
 * - /shenanigans_bet com regras completas
 * - /balance, /withdraw, /inventory, /trade, /ranking, /x1_result
 *
 * Antes de rodar: verifique .env com TOKEN definido.
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
const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1463220420818763787'; // seu bot id
const GUILD_ID = '1461942839331127520';  // seu guild id
const TZ = 'America/Sao_Paulo';

const USERS_FILE = path.join(__dirname, 'users.json');
const STATE_FILE = path.join(__dirname, 'state.json');

const START_YENS = 600;
const MAX_MONEY = 5000;
const SHEN_BASE = 270;
const DISASTER_CHANCE = 0.05; // 5% chance
const SUKUNA_EMOJI = '<:sukuna_finger:1463407933449572352>';
const GOKU_EMOJI = '<:Gokumonkyo:1463408847556444233>';
const SUKUNA_ROLE_ID = '1463413152824819753'; // Disgraceful King
const GOKU_ROLE_ID = '1463413249734086860';   // The Honored One
const FOUNDER_ROLE_ID = '1463413721970769973'; // fundador

/* ========== HELPERS ========== */
async function loadJsonSafe(p, def) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    await fs.writeFile(p, JSON.stringify(def, null, 2));
    return def;
  }
}
async function saveJson(p, obj) {
  await fs.writeFile(p, JSON.stringify(obj, null, 2));
}
function clampMoney(v) { return Math.min(v, MAX_MONEY); }

function isoDate(dt) { // returns YYYY-MM-DD in TZ
  return DateTime.fromJSDate(dt, { zone: TZ }).toISODate();
}
function isSundayAndHourOK(now) {
  const d = DateTime.fromJSDate(now, { zone: TZ });
  return d.weekday === 7 && d.hour >= 9 && d.hour <= 23;
}
function daysBetweenISO(aIso, bIso) {
  if (!aIso || !bIso) return null;
  const a = DateTime.fromISO(aIso, { zone: TZ }).startOf('day');
  const b = DateTime.fromISO(bIso, { zone: TZ }).startOf('day');
  return Math.round(b.diff(a, 'days').days);
}

/* ========== BOT CLIENT ========== */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ========== COMMAND DEFINITIONS ========== */
const commands = [
  new SlashCommandBuilder().setName('balance').setDescription('Ver sua carteira e banco (yens)'),
  new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Sacar yens do banco para a carteira')
    .addIntegerOption(o => o.setName('valor').setDescription('Valor para sacar').setRequired(true)),
  new SlashCommandBuilder().setName('inventory').setDescription('Ver seu inventário'),
  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Trocar item com outro usuário (direto)')
    .addUserOption(o => o.setName('user').setDescription('Usuário alvo').setRequired(true))
    .addStringOption(o =>
      o.setName('item')
       .setDescription('Item a enviar')
       .setRequired(true)
       .addChoices(
         { name: 'Sukuna Finger', value: 'sukuna_finger' },
         { name: 'Gokumonkyo', value: 'gokumonkyo' }
       ))
    .addIntegerOption(o => o.setName('qtd').setDescription('Quantidade').setRequired(true)),
  new SlashCommandBuilder()
    .setName('shenanigans_bet')
    .setDescription('Use seu Shenanigans Bet (domingo 09:00–23:59; 1x por domingo)')
    .addBooleanOption(o => o.setName('force') .setDescription('Staff only: forçar abrir/fechar (opcional)')),
  new SlashCommandBuilder()
    .setName('x1_result')
    .setDescription('Registrar resultado X1 (staff)')
    .addUserOption(o => o.setName('vencedor').setDescription('Vencedor').setRequired(true))
    .addUserOption(o => o.setName('perdedor').setDescription('Perdedor').setRequired(true))
    .addIntegerOption(o => o.setName('valor').setDescription('Valor apostado').setRequired(true)),
  new SlashCommandBuilder().setName('rank').setDescription('Mostrar ranking top 10 por vitórias')
].map(c => c.toJSON());

/* ========== STATE / USERS UTIL ========== */
async function ensureState() {
  return await loadJsonSafe(STATE_FILE, { override: null, usedToday: {} });
}
async function ensureUsers() {
  return await loadJsonSafe(USERS_FILE, {});
}
function ensureUserEntry(users, id, username) {
  if (!users[id]) {
    users[id] = {
      name: username || 'Unknown',
      wallet: START_YENS,
      bank: 0,
      wins: 0,
      losses: 0,
      streak: 0, // consecutive sundays used
      lastWorkDate: null, // ISO date
      items: { sukuna_finger: 0, gokumonkyo: 0 },
      titles: []
    };
  }
  return users[id];
}

/* ========== REGISTER COMMANDS (GUILD ONLY) ========== */
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  try {
    console.log('🔁 Registrando comandos no servidor...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Comandos registrados (guild)');
  } catch (err) {
    console.error('❌ Erro registrando comandos:', err);
  }
});

/* ========== INTERACTIONS ========== */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const state = await ensureState();
  const users = await ensureUsers();
  const id = interaction.user.id;
  const username = interaction.user.username;
  const member = interaction.member; // GuildMember

  const isFounder = member && member.roles && member.roles.cache.has(FOUNDER_ROLE_ID);
  const isAdmin = interaction.memberPermissions && interaction.memberPermissions.has && interaction.memberPermissions.has(PermissionFlagsBits.Administrator);

  // ensure user entry
  const user = ensureUserEntry(users, id, username);

  try {
    /* ===== /balance ===== */
    if (interaction.commandName === 'balance') {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${username} — Saldo`)
            .setDescription(`💰 Carteira: **${user.wallet} yens**\n🏦 Banco: **${user.bank} yens**\n🔒 Limite total: **${MAX_MONEY} yens**`)
            .setColor(0x00cc99)
        ],
        ephemeral: true
      });
      await saveJson(USERS_FILE, users);
      return;
    }

    /* ===== /withdraw ===== */
    if (interaction.commandName === 'withdraw') {
      const valor = interaction.options.getInteger('valor');
      if (!Number.isInteger(valor) || valor <= 0) {
        return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });
      }
      if (user.bank < valor) {
        return interaction.reply({ content: '❌ Você não tem esse valor no banco.', ephemeral: true });
      }
      if (user.wallet + valor > MAX_MONEY) {
        return interaction.reply({ content: `🚫 Não pode sacar: isso ultrapassaria o limite total de ${MAX_MONEY} yens.`, ephemeral: true });
      }
      user.bank -= valor;
      user.wallet += valor;
      await saveJson(USERS_FILE, users);
      return interaction.reply({ content: `✅ Você sacou ${valor} yens. Carteira: ${user.wallet} yens` });
    }

    /* ===== /inventory ===== */
    if (interaction.commandName === 'inventory') {
      const inv = user.items;
      const embed = new EmbedBuilder()
        .setTitle(`${username} — Inventário`)
        .setColor(0xffcc66)
        .addFields(
          { name: 'Sukuna Finger', value: `${SUKUNA_EMOJI} x ${inv.sukuna_finger}`, inline: true },
          { name: 'Gokumonkyo', value: `${GOKU_EMOJI} x ${inv.gokumonkyo}`, inline: true },
          { name: 'Títulos', value: (user.titles.length ? user.titles.join(', ') : 'Nenhum'), inline: false }
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    /* ===== /trade ===== */
    if (interaction.commandName === 'trade') {
      const target = interaction.options.getUser('user');
      const item = interaction.options.getString('item');
      const qtd = Math.max(1, Math.floor(interaction.options.getInteger('qtd') || 1));

      if (!target) return interaction.reply({ content: '❌ Usuário inválido.', ephemeral: true });
      if (target.id === id) return interaction.reply({ content: '❌ Não pode trocar consigo mesmo.', ephemeral: true });

      if (!['sukuna_finger', 'gokumonkyo'].includes(item)) {
        return interaction.reply({ content: '❌ Item inválido.', ephemeral: true });
      }

      if ((user.items[item] || 0) < qtd) {
        return interaction.reply({ content: '❌ Você não tem itens suficientes.', ephemeral: true });
      }

      // perform trade
      user.items[item] -= qtd;
      const targetUser = ensureUserEntry(users, target.id, target.username || target.tag);
      targetUser.items[item] = (targetUser.items[item] || 0) + qtd;

      // check role awards for target
      const guild = await client.guilds.fetch(GUILD_ID);
      try {
        const memberTarget = await guild.members.fetch(target.id);
        // assign roles if thresholds met
        if (targetUser.items.sukuna_finger >= 2) {
          await memberTarget.roles.add(SUKUNA_ROLE_ID).catch(() => {});
          if (!targetUser.titles.includes('Disgraceful King')) targetUser.titles.push('Disgraceful King');
        }
        if (targetUser.items.gokumonkyo >= 3) {
          await memberTarget.roles.add(GOKU_ROLE_ID).catch(() => {});
          if (!targetUser.titles.includes('The Honored One')) targetUser.titles.push('The Honored One');
        }
      } catch (err) {
        // ignore role assign errors (bot may lack perms)
      }

      await saveJson(USERS_FILE, users);
      return interaction.reply({ content: `🔁 Trade concluído: você enviou ${qtd}x ${item} para <@${target.id}>.` });
    }

    /* ===== /shenanigans_bet =====
       Rules:
       - Works only Sundays 09:00–23:59 in TZ, unless founder role -> can always use
       - Each user once per Sunday (tracked by ISO date)
       - Base reward SHEN_BASE
       - Streak logic: if previous lastWorkDate is exactly 7 days before, streak +=1; else streak=1
       - If streak % 3 === 0 -> +100 yens
       - Disaster chance: DISASTER_CHANCE -> lose 150 yens (clamped)
       - Secret mission: small chance to drop items
    */
    if (interaction.commandName === 'shenanigans_bet') {
      // founder bypass: founders can use anytime and multiple times (but we still record)
      const now = new Date();
      const open = isSundayAndHourOK(now);
      if (!open && !isFounder && !isAdmin) {
        return interaction.reply({ content: '⛔ Shenanigans Bet só funciona aos domingos (09:00–23:59).', ephemeral: true });
      }

      const todayIso = isoDate(now);
      if (user.lastWorkDate === todayIso && !isFounder && !isAdmin) {
        return interaction.reply({ content: '⏳ Você já usou o Shenanigans Bet hoje (domingo).', ephemeral: true });
      }

      // determine streak
      let streakAward = 0;
      if (user.lastWorkDate) {
        const days = daysBetweenISO(user.lastWorkDate, todayIso);
        if (days === 7) {
          user.streak = (user.streak || 0) + 1;
        } else {
          user.streak = 1;
        }
      } else {
        user.streak = 1;
      }

      let reward = SHEN_BASE;
      // streak bonus
      if (user.streak % 3 === 0) {
        reward += 100;
        streakAward = 100;
      }

      // disaster
      let disasterHappened = false;
      if (Math.random() < DISASTER_CHANCE) {
        // disaster: remove 150 yens from wallet, clamp >=0
        const loss = 150;
        user.wallet = Math.max(0, user.wallet - loss);
        // reset streak
        user.streak = 0;
        user.lastWorkDate = isoDate(now);
        await saveJson(USERS_FILE, users);
        const e = new EmbedBuilder()
          .setTitle('💥 DESASTRE!')
          .setDescription(`Oh não — você sofreu um desastre e perdeu **150 yens**.\nStreak resetado.`)
          .setColor(0xff3333)
          .setTimestamp();
        return interaction.reply({ embeds: [e] });
      }

      // secret mission (small chance to drop items)
      let secretMsg = '';
      const roll = Math.random();
      if (roll < 0.05) { // 5% Sukuna
        user.items.sukuna_finger = (user.items.sukuna_finger || 0) + 1;
        secretMsg += `🎁 Você encontrou um item raro: ${SUKUNA_EMOJI} Sukuna Finger!\n`;
      } else if (roll < 0.10) { // next 5% Goku
        user.items.gokumonkyo = (user.items.gokumonkyo || 0) + 1;
        secretMsg += `🎁 Você encontrou um item raro: ${GOKU_EMOJI} Gokumonkyō!\n`;
      } else if (roll < 0.12) { // 2% special mission multiplier bonus
        reward = Math.floor(reward * 1.5);
        secretMsg += `✨ Missão Secreta: multiplicador x1.5 aplicado!\n`;
      }

      // apply reward to wallet with clamp
      user.wallet = clampMoney(user.wallet + reward);
      user.lastWorkDate = todayIso;

      // auto-assign roles if thresholds met
      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(id);
        if (user.items.sukuna_finger >= 2) {
          await member.roles.add(SUKUNA_ROLE_ID).catch(()=>{});
          if (!user.titles.includes('Disgraceful King')) user.titles.push('Disgraceful King');
        }
        if (user.items.gokumonkyo >= 3) {
          await member.roles.add(GOKU_ROLE_ID).catch(()=>{});
          if (!user.titles.includes('The Honored One')) user.titles.push('The Honored One');
        }
      } catch (err) {
        // ignore role assignment failures (missing perms)
      }

      await saveJson(USERS_FILE, users);

      const embed = new EmbedBuilder()
        .setTitle('💼 Shenanigans Bet')
        .setDescription(`${interaction.user.username} recebeu **${reward} yens**!${secretMsg ? '\n\n' + secretMsg : ''}`)
        .addFields(
          { name: 'Streak', value: `${user.streak}`, inline: true },
          { name: 'Carteira', value: `${user.wallet} yens`, inline: true }
        )
        .setColor(0x00ff99)
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    /* ===== /x1_result ===== (staff only) ===== */
    if (interaction.commandName === 'x1_result') {
      if (!isAdmin) return interaction.reply({ content: '🔒 Apenas staff pode usar este comando.', ephemeral: true });

      const vencedor = interaction.options.getUser('vencedor');
      const perdedor = interaction.options.getUser('perdedor');
      const valor = interaction.options.getInteger('valor');

      if (!vencedor || !perdedor || vencedor.id === perdedor.id) {
        return interaction.reply({ content: '❌ Parâmetros inválidos.', ephemeral: true });
      }

      const usersLocal = await ensureUsers();
      const w = ensureUserEntry(usersLocal, vencedor.id, vencedor.username);
      const l = ensureUserEntry(usersLocal, perdedor.id, perdedor.username);

      w.wins = (w.wins||0) + 1;
      w.wallet = clampMoney((w.wallet||0) + valor * 2);
      l.losses = (l.losses||0) + 1;
      l.wallet = Math.max(0, (l.wallet||0) - valor);

      await saveJson(USERS_FILE, usersLocal);
      return interaction.reply({ content: `🎮 Resultado registrado: ${vencedor.username} venceu ${perdedor.username}. Valor total: ${valor*2} yens.` });
    }

    /* ===== /rank ===== */
    if (interaction.commandName === 'rank') {
      const usersLocal = await ensureUsers();
      const arr = Object.entries(usersLocal)
        .map(([uid,u]) => ({ id: uid, name: u.name, wealth: (u.wallet||0)+(u.bank||0), wins: u.wins||0 }))
        .sort((a,b) => b.wins - a.wins || b.wealth - a.wealth)
        .slice(0,10);
      if (!arr.length) return interaction.reply('🏆 Nenhum jogador registrado ainda.');
      const desc = arr.map((p,i) => `**${i+1}. ${p.name}** — Vitórias: ${p.wins} — Yens: ${p.wealth}`).join('\n');
      return interaction.reply({ embeds: [ new EmbedBuilder().setTitle('🏆 Ranking Top 10').setDescription(desc).setColor(0xffcc00) ] });
    }

  } catch (err) {
    console.error('Erro na interaction:', err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Ocorreu um erro. Tente novamente mais tarde.', ephemeral: true });
    }
  }
});

/* ========== LOGIN ========== */
client.login(TOKEN);
