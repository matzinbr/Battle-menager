require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
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

const { recordMatch, getLeaderboard, loadRanking, saveRanking } = require('./ranking.js');

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;
const FOUNDER_ROLE_ID = '1463413721970769973';
const TZ = process.env.TZ || 'America/Sao_Paulo';
const STATE_FILE = path.join(__dirname, 'arena_state.json');

/* ================= CLIENT ================= */
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ================= STATE ================= */
async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { override: null, workUsed: {} }; }
}
async function saveState(state) { await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2)); }

/* ================= TIME LOGIC ================= */
function isSunday() { return DateTime.now().setZone(TZ).weekday === 7; }
function workIsOpen(state) { return state.override !== null ? state.override : isSunday(); }

/* ================= PERMISSIONS ================= */
async function setWorkPermission(open) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);
  await channel.permissionOverwrites.edit(guild.roles.everyone, { UseApplicationCommands: open });
  return channel;
}

/* ================= LOG ================= */
async function log(msg) {
  console.log(msg);
  if (!LOG_CHANNEL_ID) return;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const ch = await guild.channels.fetch(LOG_CHANNEL_ID);
    await ch.send(`📝 ${msg}`);
  } catch {}
}

/* ================= RECONCILE ================= */
async function reconcile() {
  const state = await readState();
  const shouldOpen = workIsOpen(state);

  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);
  const perms = channel.permissionsFor(guild.roles.everyone);
  const isOpen = perms.has(PermissionFlagsBits.UseApplicationCommands);

  if (isOpen !== shouldOpen) {
    await setWorkPermission(shouldOpen);
    const embed = new EmbedBuilder()
      .setTitle(shouldOpen ? '💰 Shenanigans Bet Liberado' : '⛔ Shenanigans Bet Encerrado')
      .setDescription(shouldOpen ? 'Use `/shenanigans_bet` até 23:59 para participar!' : 'Shenanigans Bet só funciona aos domingos!')
      .setColor(shouldOpen ? 0x00ff99 : 0xff5555)
      .setTimestamp();
    await channel.send({ embeds: [embed] });
    await log(`Sistema ajustado automaticamente → ${shouldOpen ? 'ABERTO' : 'FECHADO'}`);
  }
}

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder().setName('status-shenanigans').setDescription('Mostra se o shenanigans bet está disponível'),
  new SlashCommandBuilder().setName('shenanigans_bet').setDescription('Use uma vez por domingo para ganhar yens'),
  new SlashCommandBuilder().setName('x1_result')
    .setDescription('Registrar resultado de uma partida X1')
    .addUserOption(o => o.setName('vencedor').setDescription('Quem ganhou').setRequired(true))
    .addUserOption(o => o.setName('perdedor').setDescription('Quem perdeu').setRequired(true))
    .addIntegerOption(o => o.setName('valor').setDescription('Valor apostado').setRequired(true)),
  new SlashCommandBuilder().setName('rank').setDescription('Mostra o ranking top 10'),
  new SlashCommandBuilder().setName('profile').setDescription('Mostra suas estatísticas de vitórias/derrotas'),
  new SlashCommandBuilder().setName('trade')
    .setDescription('Troque itens por títulos')
    .addUserOption(o => o.setName('user').setDescription('Para quem dar o título').setRequired(true))
    .addStringOption(o => o.setName('item').setDescription('Item para trocar').setRequired(true))
].map(c => c.toJSON());

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await log(`Bot online: ${client.user.tag}`);

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  await saveState(await readState());
  await reconcile();

  cron.schedule('0 9 * * 0', reconcile, { timezone: TZ }); // Domingo 9h
  cron.schedule('0 0 * * 1', reconcile, { timezone: TZ }); // Segunda 0h reset
  cron.schedule('*/5 * * * *', reconcile, { timezone: TZ }); // Auto check
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const state = await readState();
  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
    (ADMIN_ROLE_ID && interaction.member.roles.cache.has(ADMIN_ROLE_ID));
  const isFounder = interaction.member.roles.cache.has(FOUNDER_ROLE_ID);

  /* ---------- SHENANIGANS BET ---------- */
  if (interaction.commandName === 'shenanigans_bet') {
    if (!workIsOpen(state) && !isFounder) {
      return interaction.reply({ content: '⛔ Shenanigans Bet só funciona aos domingos!', ephemeral: true });
    }

    if (state.workUsed?.[interaction.user.id] && !isFounder) {
      return interaction.reply({ content: '⚠ Você já usou o shenanigans bet este domingo!', ephemeral: true });
    }

    // Marca como usado
    state.workUsed = state.workUsed || {};
    state.workUsed[interaction.user.id] = true;
    await saveState(state);

    let yenGanho = 270; // valor base
    let bonus = 0;

    // Eventos especiais
    if (Math.random() < 0.2) { bonus += 100; } // streak
    if (Math.random() < 0.1) { bonus -= 150; } // desastre

    const total = yenGanho + bonus;

    await interaction.reply({ content: `💰 Você ganhou ${total} yens!` });
    return;
  }

  /* ---------- X1 RESULT ---------- */
  if (interaction.commandName === 'x1_result') {
    const vencedor = interaction.options.getUser('vencedor');
    const perdedor = interaction.options.getUser('perdedor');
    const valor = interaction.options.getInteger('valor');

    if (vencedor.id === perdedor.id) {
      return interaction.reply({ content: '❌ Vencedor e perdedor não podem ser a mesma pessoa!', ephemeral: true });
    }

    await recordMatch(vencedor, perdedor);

    await interaction.reply({ content: `${vencedor.username} venceu ${perdedor.username}, total ganho: ${valor*2} yens!` });
  }

  /* ---------- RANK ---------- */
  if (interaction.commandName === 'rank') {
    const leaderboard = await getLeaderboard();
    const embed = new EmbedBuilder()
      .setTitle('🏆 Ranking Top 10')
      .setColor(0xffcc00)
      .setTimestamp();

    if (leaderboard.length === 0) embed.setDescription('Nenhum jogador registrado ainda.');
    else {
      let desc = '';
      leaderboard.forEach((p, i) => {
        desc += `**${i+1}. ${p.name}** - Vitórias: ${p.wins} - Streak: ${p.streak}\n`;
      });
      embed.setDescription(desc);
    }

    await interaction.reply({ embeds: [embed] });
  }

  /* ---------- PROFILE ---------- */
  if (interaction.commandName === 'profile') {
    const ranking = await loadRanking();
    const player = ranking.players[interaction.user.id];
    if (!player) return interaction.reply({ content: 'Você ainda não tem partidas registradas.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(`📊 Perfil de ${player.name}`)
      .setDescription(`Vitórias: ${player.wins}\nDerrotas: ${player.losses}\nStreak: ${player.streak}`)
      .setColor(0x00ccff)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  /* ---------- TRADE ---------- */
  if (interaction.commandName === 'trade') {
    // Aqui você adicionaria lógica de verificar itens do usuário e dar o cargo correspondente
    await interaction.reply({ content: '💎 Comando de trade registrado!', ephemeral: true });
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);
