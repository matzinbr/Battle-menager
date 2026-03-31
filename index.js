import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { DateTime } from 'luxon';
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
const CONFIG_PATH = path.join(ROOT, 'apostasConfig.json');

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const now = () => DateTime.now().setZone(TZ);
const todayISO = () => now().toISODate();
const isoStamp = () => now().toISO();
const weekdayIndex = () => now().weekday; // 1 = Monday ... 7 = Sunday
const weekdayName = () => ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][weekdayIndex() % 7];
const fmt = (n) => new Intl.NumberFormat('pt-BR').format(Math.max(0, Math.floor(n)));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pct = (n) => `${Math.round(n * 100)}%`;
const strip = (text = '') =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const STAFF_ROLE_HINTS = new Set(
  [
    'admin',
    'adm',
    'administrator',
    'fundador',
    'fundadores',
    'owner',
    'dono',
    'superior',
    'superiores',
    'staff',
    'moderador',
    'moderadores',
    'mod',
    'dev',
    'developer',
    'staff manager',
  ].map(strip)
);

let writeQueue = Promise.resolve();

async function atomicWrite(filePath, data) {
  const tmp = `${filePath}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, filePath);
}

function queueWrite(db) {
  writeQueue = writeQueue.then(() => atomicWrite(DATA_PATH, db));
  return writeQueue;
}

async function loadJson(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function loadDB() {
  const fallback = {
    players: {},
    meta: { createdAt: isoStamp() },
    logs: [],
  };
  const db = await loadJson(DATA_PATH, fallback);
  db.players ||= {};
  db.logs ||= [];
  db.meta ||= { createdAt: isoStamp() };
  return db;
}

async function loadConfig() {
  const fallback = { guilds: {} };
  const cfg = await loadJson(CONFIG_PATH, fallback);
  cfg.guilds ||= {};
  return cfg;
}

async function saveConfig(cfg) {
  await atomicWrite(CONFIG_PATH, cfg);
}

const db = await loadDB();
const config = await loadConfig();

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
  player.createdAt ??= isoStamp();
  return player;
}

function getPlayer(user) {
  if (!db.players[user.id]) {
    db.players[user.id] = ensurePlayerShape({
      id: user.id,
      name: user.username,
      createdAt: isoStamp(),
    });
  }
  const player = db.players[user.id];
  player.name = user.username;
  return ensurePlayerShape(player);
}

function log(type, payload) {
  db.logs.unshift({
    id: crypto.randomUUID(),
    at: isoStamp(),
    type,
    payload,
  });
  if (db.logs.length > 500) db.logs.length = 500;
}

function embedBase(title, description, color = 0x8b5cf6) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setFooter({ text: 'Battle Manager • economia, apostas e batalhas' })
    .setTimestamp();
}

function embedSuccess(title, description) {
  return embedBase(`✅ ${title}`, description, 0x22c55e);
}

function embedWarn(title, description) {
  return embedBase(`⚠️ ${title}`, description, 0xf59e0b);
}

function embedError(title, description) {
  return embedBase(`❌ ${title}`, description, 0xef4444);
}

function isStaffLike(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles?.cache?.some((role) => STAFF_ROLE_HINTS.has(strip(role.name))) ?? false;
}

function getGuildConfig(guildId) {
  if (!config.guilds[guildId]) {
    config.guilds[guildId] = {
      enabled: true,
      commandName: 'shenanigans_bet',
      sundayBonusBoost: 1,
      workEnabled: true,
      battleEnabled: true,
      betEnabled: true,
    };
  }
  return config.guilds[guildId];
}

function toSundayLabel(lastClaim) {
  return lastClaim === todayISO() ? 'Recebido hoje' : 'Disponível no próximo domingo';
}

function workRewardForDay(isStaff, player) {
  const day = weekdayIndex();
  const profileWeight = clamp(Math.floor(player.wins * 4 + player.battle.wins * 7 + player.work.streak * 10), 0, 150);

  if (day === 7) {
    const base = isStaff ? randInt(220, 360) : randInt(420, 720);
    return { base, bonus: profileWeight, totalCap: isStaff ? 700 : 1200 };
  }
  if (day === 6) return { base: randInt(120, 250), bonus: profileWeight, totalCap: 500 };
  return { base: randInt(90, 180), bonus: profileWeight, totalCap: 420 };
}

function battlePower(player) {
  return (
    player.wins * 3 +
    player.battle.wins * 6 +
    player.battle.streak * 4 +
    player.streak * 2 +
    Math.floor(player.wallet / 250) +
    Math.floor(player.bank / 500) +
    randInt(0, 45)
  );
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const commands = [];
const commandMap = new Map();

function registerCommand(command) {
  const name = command.data.name;
  if (commandMap.has(name)) {
    throw new Error(`Comando duplicado: ${name}`);
  }
  const serialized = command.data.toJSON();
  commands.push(serialized);
  commandMap.set(name, command);
}

async function persistAndReply(interaction, payload) {
  await queueWrite(db);
  return interaction.reply(payload);
}

registerCommand({
  data: new SlashCommandBuilder().setName('ping').setDescription('Teste de latência'),
  execute: async (interaction) => interaction.reply(`🏓 Pong **${interaction.client.ws.ping}ms**`),
});

registerCommand({
  data: new SlashCommandBuilder().setName('balance').setDescription('Ver saldo'),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const embed = embedBase(
      '💰 Seu saldo',
      [
        `**Carteira:** ${fmt(player.wallet)} yens`,
        `**Banco:** ${fmt(player.bank)} yens`,
        `**Total:** ${fmt(player.wallet + player.bank)} yens`,
      ].join('\n'),
      0x6366f1
    );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
});

registerCommand({
  data: new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Depositar yens no banco')
    .addIntegerOption((o) => o.setName('valor').setDescription('Valor').setRequired(true)),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const value = interaction.options.getInteger('valor');
    if (value <= 0 || value > player.wallet) return interaction.reply({ content: 'Valor inválido.', ephemeral: true });

    player.wallet -= value;
    player.bank += value;
    log('deposit', { user: player.id, value });
    await queueWrite(db);

    return interaction.reply({
      embeds: [embedSuccess('Depósito realizado', `Você depositou **${fmt(value)}** yens no banco.`)],
      ephemeral: true,
    });
  },
});

registerCommand({
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Sacar yens do banco')
    .addIntegerOption((o) => o.setName('valor').setDescription('Valor').setRequired(true)),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const value = interaction.options.getInteger('valor');
    if (value <= 0 || value > player.bank) return interaction.reply({ content: 'Valor inválido.', ephemeral: true });
    if (player.wallet + value > 5000) return interaction.reply({ content: 'Limite da carteira excedido.', ephemeral: true });

    player.bank -= value;
    player.wallet += value;
    log('withdraw', { user: player.id, value });
    await queueWrite(db);

    return interaction.reply({
      embeds: [embedSuccess('Saque realizado', `Você sacou **${fmt(value)}** yens do banco.`)],
      ephemeral: true,
    });
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('inventory').setDescription('Ver inventário'),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const embed = embedBase(
      `🎒 Inventário de ${player.name}`,
      [
        `**Sukuna Finger:** ${fmt(player.inventory.sukuna_finger)}`,
        `**Gokumonkyo:** ${fmt(player.inventory.gokumonkyo)}`,
      ].join('\n'),
      0x14b8a6
    );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('profile').setDescription('Perfil do usuário'),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const embed = embedBase(
      `👤 Perfil de ${player.name}`,
      'Resumo geral do seu progresso no servidor.',
      0x3b82f6
    ).addFields(
      { name: 'Carteira', value: `${fmt(player.wallet)}`, inline: true },
      { name: 'Banco', value: `${fmt(player.bank)}`, inline: true },
      { name: 'Total', value: `${fmt(player.wallet + player.bank)}`, inline: true },
      { name: 'Vitórias', value: `${fmt(player.wins)}`, inline: true },
      { name: 'Derrotas', value: `${fmt(player.losses)}`, inline: true },
      { name: 'Streak', value: `${fmt(player.streak)}`, inline: true },
      { name: 'Apostas ganhas', value: `${fmt(player.gambling.wins)}`, inline: true },
      { name: 'Apostas perdidas', value: `${fmt(player.gambling.losses)}`, inline: true },
      { name: 'Batalhas', value: `${fmt(player.battle.wins)} / ${fmt(player.battle.losses)}`, inline: true },
      { name: 'Renda de domingo', value: toSundayLabel(player.economy.lastSundayClaim), inline: false }
    );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('rank').setDescription('Ranking dos jogadores'),
  execute: async (interaction) => {
    const top = Object.values(db.players)
      .map((p) => ensurePlayerShape(p))
      .sort((a, b) => b.wallet + b.bank - (a.wallet + a.bank))
      .slice(0, 10)
      .map(
        (p, i) =>
          `**#${i + 1}** ${p.name} — **${fmt(p.wallet + p.bank)}** yens (${fmt(p.wallet)} na carteira / ${fmt(p.bank)} no banco)`
      )
      .join('\n');

    const embed = embedBase('🏆 Ranking Top 10', top || 'Nenhum jogador registrado ainda.', 0xf59e0b);
    return interaction.reply({ embeds: [embed] });
  },
});

registerCommand({
  data: new SlashCommandBuilder()
    .setName('work-yen')
    .setDescription('Trabalhar e ganhar yens')
    .addBooleanOption((o) => o.setName('mostrar_status').setDescription('Mostra a regra de domingo para staff')),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const day = weekdayIndex();
    const today = todayISO();
    const staff = isStaffLike(member);

    if (player.work.lastClaim === today) {
      return interaction.reply({
        embeds: [embedWarn('Trabalho já feito', 'Você já usou este comando hoje.')],
        ephemeral: true,
      });
    }

    if (staff && day !== 7) {
      return interaction.reply({
        embeds: [embedError('Acesso restrito', 'Cargos de **adm, superior, fundador e staff** só podem usar o `/work-yen` aos **domingos**.')],
        ephemeral: true,
      });
    }

    const reward = workRewardForDay(staff, player);
    const payout = clamp(reward.base + reward.bonus, 0, reward.totalCap);
    player.wallet = clamp(player.wallet + payout, 0, 5000);

    const yesterday = now().minus({ days: 1 }).toISODate();
    const previousClaim = player.work.lastClaim;
    player.work.lastClaim = today;
    player.work.streak = previousClaim === yesterday ? player.work.streak + 1 : 1;

    log('work', { user: player.id, payout, day: weekdayName(), staff });
    await queueWrite(db);

    const embed = embedBase(
      '💼 Trabalho concluído',
      [
        `**Dia:** ${weekdayName()}`,
        `**Base:** ${fmt(reward.base)} yens`,
        `**Bônus:** ${fmt(reward.bonus)} yens`,
        `**Total ganho:** ${fmt(payout)} yens`,
      ].join('\n'),
      0x10b981
    ).setFooter({
      text: staff ? 'Staff, adm e fundadores só trabalham aos domingos.' : 'Uso liberado uma vez por dia.',
    });

    return interaction.reply({ embeds: [embed] });
  },
});

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
    const challengerPower = battlePower(challenger);
    const opponentPower = battlePower(opponent);
    const total = challengerPower + opponentPower;
    const chance = total <= 0 ? 0.5 : challengerPower / total;
    const roll = Math.random();
    const challengerWins = roll < chance;

    const winner = challengerWins ? challenger : opponent;
    const loser = challengerWins ? opponent : challenger;
    const winnerUser = challengerWins ? interaction.user : targetUser;
    const loserUser = challengerWins ? targetUser : interaction.user;

    const basePrize = randInt(70, 180);
    const stakeFromLoser = clamp(Math.round(loser.wallet * randInt(4, 12) / 100), 25, 260);
    const totalPrize = basePrize + stakeFromLoser;

    winner.wallet = clamp(winner.wallet + totalPrize, 0, 5000);
    loser.wallet = clamp(loser.wallet - stakeFromLoser, 0, 5000);

    if (challengerWins) {
      challenger.wins += 1;
      challenger.streak += 1;
      challenger.battle.wins += 1;
      challenger.battle.streak += 1;
      opponent.losses += 1;
      opponent.streak = 0;
      opponent.battle.losses += 1;
      opponent.battle.streak = 0;
    } else {
      opponent.wins += 1;
      opponent.streak += 1;
      opponent.battle.wins += 1;
      opponent.battle.streak += 1;
      challenger.losses += 1;
      challenger.streak = 0;
      challenger.battle.losses += 1;
      challenger.battle.streak = 0;
    }

    log('battle', {
      challenger: challenger.id,
      opponent: opponent.id,
      challengerPower,
      opponentPower,
      chance,
      roll,
      winner: winner.id,
      stakeFromLoser,
      totalPrize,
    });
    await queueWrite(db);

    const embed = embedBase(
      '⚔️ Batalha encerrada',
      [
        `**Vencedor:** ${winnerUser.username}`,
        `**Derrotado:** ${loserUser.username}`,
        `**Chance estimada:** ${pct(chance)}`,
        `**Prêmio:** ${fmt(totalPrize)} yens`,
        `**Perda do derrotado:** ${fmt(stakeFromLoser)} yens`,
      ].join('\n'),
      challengerWins ? 0x22c55e : 0xef4444
    );

    return interaction.reply({ embeds: [embed] });
  },
});

registerCommand({
  data: new SlashCommandBuilder()
    .setName('shenanigans_bet')
    .setDescription('Receber a renda de domingo'),
  execute: async (interaction) => {
    const player = getPlayer(interaction.user);
    const guildCfg = getGuildConfig(interaction.guildId);

    if (!guildCfg.enabled) {
      return interaction.reply({ embeds: [embedWarn('Sistema desativado', 'Esse sistema está desativado no servidor.')], ephemeral: true });
    }

    if (weekdayIndex() !== 7) {
      return interaction.reply({ embeds: [embedWarn('Domingo apenas', 'Esse pagamento só libera aos domingos.')], ephemeral: true });
    }

    const sunday = todayISO();
    if (player.economy.lastSundayClaim === sunday) {
      return interaction.reply({ embeds: [embedWarn('Já recebido', 'Você já recebeu a renda de domingo hoje.')], ephemeral: true });
    }

    const boost = Number(guildCfg.sundayBonusBoost ?? 1);
    const base = randInt(380, 760);
    const activityBonus = clamp(
      Math.floor(player.wins * 14 + player.streak * 9 + player.gambling.wins * 10 + player.battle.wins * 12 + player.work.streak * 6),
      0,
      320
    );
    const loyaltyBonus = clamp(Math.floor(player.bank * 0.012 * boost), 0, 900);
    const totalPayout = Math.floor((base + activityBonus) * boost);

    player.wallet = clamp(player.wallet + totalPayout, 0, 5000);
    player.bank = clamp(player.bank + loyaltyBonus, 0, 100000);
    player.economy.lastSundayClaim = sunday;

    log('sunday_pay', {
      user: player.id,
      base,
      activityBonus,
      loyaltyBonus,
      totalPayout,
      boost,
    });
    await queueWrite(db);

    const embed = embedBase(
      '💴 Renda de domingo liberada',
      [
        `**Salário base:** ${fmt(base)} yens`,
        `**Bônus de atividade:** ${fmt(activityBonus)} yens`,
        `**Juros/bonificação:** ${fmt(loyaltyBonus)} yens`,
        `**Multiplicador do servidor:** x${boost}`,
        `**Total na carteira:** ${fmt(totalPayout)} yens`,
      ].join('\n'),
      0xf59e0b
    ).setFooter({ text: 'Esse comando só funciona uma vez por domingo.' });

    return interaction.reply({ embeds: [embed] });
  },
});

const BET_RISKS = {
  baixo: { chance: 0.47, multiplier: 1.9, label: 'Baixo risco' },
  medio: { chance: 0.29, multiplier: 2.7, label: 'Risco médio' },
  alto: { chance: 0.14, multiplier: 4.8, label: 'Alto risco' },
};

registerCommand({
  data: new SlashCommandBuilder()
    .setName('bet')
    .setDescription('Fazer uma aposta com chance mais realista')
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
    const meta = BET_RISKS[risk];

    if (!meta) return interaction.reply({ content: 'Risco inválido.', ephemeral: true });
    if (value <= 0) return interaction.reply({ content: 'Aposta inválida.', ephemeral: true });
    if (value > player.wallet) return interaction.reply({ content: 'Você não tem yens suficientes.', ephemeral: true });

    player.wallet -= value;
    const roll = Math.random();
    const bonusVariance = risk === 'alto' ? randInt(0, 18) : risk === 'medio' ? randInt(0, 12) : randInt(0, 8);
    const win = roll < meta.chance;

    if (win) {
      const payout = Math.floor(value * meta.multiplier) + bonusVariance;
      player.wallet = clamp(player.wallet + payout, 0, 5000);
      player.gambling.wins += 1;
      player.gambling.streak += 1;
      player.wins += 1;
      player.streak += 1;

      log('bet_win', { user: player.id, value, risk, roll, payout });
      await queueWrite(db);

      const embed = embedBase(
        '🎰 Aposta vencedora',
        [
          `**Risco:** ${meta.label}`,
          `**Apostado:** ${fmt(value)} yens`,
          `**Recebeu:** ${fmt(payout)} yens`,
          `**Lucro líquido:** ${fmt(payout - value)} yens`,
        ].join('\n'),
        0x22c55e
      );

      return interaction.reply({ embeds: [embed] });
    }

    player.gambling.losses += 1;
    player.gambling.streak = 0;
    player.losses += 1;
    player.streak = 0;

    log('bet_loss', { user: player.id, value, risk, roll });
    await queueWrite(db);

    const embed = embedBase(
      '💥 Aposta perdida',
      [
        `**Risco:** ${meta.label}`,
        `**Perdeu:** ${fmt(value)} yens`,
        `**Chance de acerto:** ${pct(meta.chance)}`,
        `**A roleta não sorriu hoje.**`,
      ].join('\n'),
      0xef4444
    );

    return interaction.reply({ embeds: [embed] });
  },
});

registerCommand({
  data: new SlashCommandBuilder()
    .setName('apostas')
    .setDescription('Gerenciar a economia de apostas do servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) => sub.setName('status').setDescription('Ver a configuração atual'))
    .addSubcommand((sub) =>
      sub
        .setName('editar_nome')
        .setDescription('Trocar o nome interno da renda de domingo')
        .addStringOption((o) => o.setName('novo_nome').setDescription('Novo nome').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('ativar').setDescription('Ativar o sistema do servidor'))
    .addSubcommand((sub) => sub.setName('desativar').setDescription('Desativar o sistema do servidor'))
    .addSubcommand((sub) =>
      sub
        .setName('boost')
        .setDescription('Ajustar o multiplicador da renda de domingo')
        .addNumberOption((o) => o.setName('multiplicador').setDescription('Ex: 1.1').setRequired(true))
    ),
  execute: async (interaction) => {
    const guildCfg = getGuildConfig(interaction.guildId);
    const sub = interaction.options.getSubcommand();

    if (sub === 'editar_nome') {
      const newName = interaction.options.getString('novo_nome');
      const old = guildCfg.commandName;
      guildCfg.commandName = newName;
      await saveConfig(config);
      return interaction.reply({ embeds: [embedSuccess('Nome alterado', `De **${old}** para **${newName}**.`)] });
    }

    if (sub === 'ativar') {
      guildCfg.enabled = true;
      await saveConfig(config);
      return interaction.reply({ embeds: [embedSuccess('Sistema ativado', 'A economia do servidor foi ativada.')] });
    }

    if (sub === 'desativar') {
      guildCfg.enabled = false;
      await saveConfig(config);
      return interaction.reply({ embeds: [embedWarn('Sistema desativado', 'A economia do servidor foi desativada.')] });
    }

    if (sub === 'boost') {
      const multiplicador = interaction.options.getNumber('multiplicador');
      if (!Number.isFinite(multiplicador) || multiplicador < 0.5 || multiplicador > 3) {
        return interaction.reply({ content: 'Multiplicador inválido. Use um valor entre 0.5 e 3.', ephemeral: true });
      }
      guildCfg.sundayBonusBoost = multiplicador;
      await saveConfig(config);
      return interaction.reply({ embeds: [embedSuccess('Boost atualizado', `Multiplicador da renda de domingo definido para **x${multiplicador}**.`)] });
    }

    const embed = embedBase(
      '⚙️ Configuração da economia',
      [
        `**Ativo:** ${guildCfg.enabled ? 'Sim' : 'Não'}`,
        `**Nome interno:** ${guildCfg.commandName || 'shenanigans_bet'}`,
        `**Bônus semanal:** x${guildCfg.sundayBonusBoost ?? 1}`,
        `**Trabalho liberado:** ${guildCfg.workEnabled ? 'Sim' : 'Não'}`,
        `**Apostas liberadas:** ${guildCfg.betEnabled ? 'Sim' : 'Não'}`,
        `**Batalhas liberadas:** ${guildCfg.battleEnabled ? 'Sim' : 'Não'}`,
      ].join('\n'),
      0x8b5cf6
    );
    return interaction.reply({ embeds: [embed] });
  },
});

registerCommand({
  data: new SlashCommandBuilder()
    .setName('backup_restore')
    .setDescription('Restaurar o último backup')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  execute: async (interaction) => {
    const backupFile = path.join(BACKUP_DIR, 'latest.json');
    if (!fs.existsSync(backupFile)) {
      return interaction.reply({ embeds: [embedError('Sem backup', 'Nenhum backup foi encontrado.')], ephemeral: true });
    }

    const restored = JSON.parse(await fsp.readFile(backupFile, 'utf8'));
    db.players = restored.players || {};
    db.logs = restored.logs || [];
    db.meta = restored.meta || { createdAt: isoStamp() };
    await queueWrite(db);

    return interaction.reply({ embeds: [embedSuccess('Backup restaurado', 'O último backup foi aplicado com sucesso.')] });
  },
});

registerCommand({
  data: new SlashCommandBuilder().setName('help').setDescription('Ver os comandos principais'),
  execute: async (interaction) => {
    const embed = embedBase(
      '✨ Comandos principais',
      [
        '`/work-yen` — ganhar yens no dia certo',
        '`/shenanigans_bet` — renda de domingo',
        '`/bet` — aposta com risco realista',
        '`/battle` — batalha entre jogadores',
        '`/balance` — saldo atual',
        '`/profile` — perfil e status',
      ].join('\n'),
      0x6366f1
    );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
});

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
  console.log(`🔥 Online como ${client.user.tag}`);

  try {
    // remove comandos globais antigos que costumam causar duplicação
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });

    // registra apenas os comandos atuais neste servidor
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });

    console.log(`✅ ${commands.length} comandos registrados com sucesso`);
  } catch (error) {
    console.error('Erro ao registrar comandos:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commandMap.get(interaction.commandName);
  if (!cmd) return;

  try {
    await cmd.execute(interaction);
  } catch (error) {
    console.error(error);
    const payload = { content: 'Erro interno ao executar o comando.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
});

setInterval(async () => {
  const backupFile = path.join(BACKUP_DIR, 'latest.json');
  await atomicWrite(backupFile, db);
}, 1000 * 60 * 10);

process.on('SIGINT', async () => {
  try {
    await atomicWrite(DATA_PATH, db);
    await saveConfig(config);
  } finally {
    process.exit(0);
  }
});

await client.login(TOKEN);
