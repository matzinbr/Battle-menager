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
const TZ = process.env.TZ || 'America/Sao_Paulo';
const STATE_FILE = path.join(__dirname, 'arena_state.json');

const WORK_REWARD = 270;
const CURRENCY_EMOJI = '<:MoneyPilePNGClipart:1463070061630718177>';

/* ================= CLIENT ================= */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ================= STATE ================= */
async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { override: null }; }
}
async function saveState(state) { await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2)); }

/* ================= TIME LOGIC ================= */
function isSundayOpen() { return DateTime.now().setZone(TZ).weekday === 7 && DateTime.now().setZone(TZ).hour >= 9 && DateTime.now().setZone(TZ).hour < 24; }
function workIsOpen(state) { return state.override !== null ? state.override : isSundayOpen(); }

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
      .setTitle(shouldOpen ? '💰 WORK LIBERADO' : '⛔ WORK ENCERRADO')
      .setDescription(
        shouldOpen
          ? `Use /work até 23:59 para receber ${CURRENCY_EMOJI}`
          : '⛔ WORK fechado — só funciona aos domingos!'
      )
      .setColor(shouldOpen ? 0x00ff99 : 0xff5555)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    await log(`Sistema ajustado automaticamente → ${shouldOpen ? 'ABERTO' : 'FECHADO'}`);
  }
}

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder().setName('status-work').setDescription('Mostra se o WORK está disponível'),
  new SlashCommandBuilder().setName('work').setDescription('Receba seus Yens pelo trabalho semanal!'),
  new SlashCommandBuilder()
    .setName('x1_result')
    .setDescription('Registrar resultado de uma partida X1')
    .addUserOption(o => o.setName('vencedor').setDescription('Quem ganhou').setRequired(true))
    .addUserOption(o => o.setName('perdedor').setDescription('Quem perdeu').setRequired(true))
    .addIntegerOption(o => o.setName('valor').setDescription('Valor da aposta').setRequired(true)),
  new SlashCommandBuilder().setName('rank').setDescription('Mostra o ranking top 10'),
  new SlashCommandBuilder().setName('profile').setDescription('Mostra suas estatísticas')
].map(c => c.toJSON());

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await log(`Bot online: ${client.user.tag}`);

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });

  await saveState(await readState());
  await reconcile();

  cron.schedule('0 9 * * 0', reconcile, { timezone: TZ });
  cron.schedule('0 0 * * 1', reconcile, { timezone: TZ });
  cron.schedule('*/5 * * * *', reconcile, { timezone: TZ });
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const state = await readState();
  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator) || (ADMIN_ROLE_ID && interaction.member.roles.cache.has(ADMIN_ROLE_ID));

  /* ---------- STATUS WORK ---------- */
  if (interaction.commandName === 'status-work') {
    const open = workIsOpen(state);
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle(open ? '✅ WORK LIBERADO' : '⛔ WORK BLOQUEADO').setColor(open ? 0x00ff99 : 0xff5555)], ephemeral: true });
  }

  /* ---------- WORK ---------- */
  if (interaction.commandName === 'work') {
    const now = DateTime.now().setZone(TZ);
    if ((now.weekday !== 7 || now.hour < 9 || now.hour >= 24) && !isAdmin)
      return interaction.reply({ content: '⛔ O WORK só funciona aos domingos, das 9:00 às 23:59!', ephemeral: true });

    const ranking = await loadRanking();
    if (!ranking.players[interaction.user.id]) ranking.players[interaction.user.id] = { name: interaction.user.username, wins:0, losses:0, streak:0, yens:0, lastWork:null };

    const lastWork = ranking.players[interaction.user.id].lastWork;
    if (lastWork) {
      const lastDate = DateTime.fromISO(lastWork).setZone(TZ);
      if (lastDate.hasSame(now, 'week') && !isAdmin) 
        return interaction.reply({ content: '⏱ Você já usou /work este domingo! Tente novamente no próximo domingo.', ephemeral: true });
    }

    let reward = WORK_REWARD;
    let jackpot = '';
    if (Math.random() < 0.12) { 
      const multiplier = Math.floor(Math.random()*3)+2;
      reward *= multiplier;
      jackpot = ` 🎉 JACKPOT ${multiplier}x!`;
    }

    // Surpresa secreta
    if (Math.random() < 0.05) reward += 50;

    ranking.players[interaction.user.id].yens += reward;
    ranking.players[interaction.user.id].lastWork = now.toISO();
    await saveRanking(ranking);

    const embed = new EmbedBuilder()
      .setTitle('💼 WORK realizado!')
      .setDescription(`${interaction.user.username} recebeu ${reward} ${CURRENCY_EMOJI}${jackpot}`)
      .setColor(0x00ff99)
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  /* ---------- X1 RESULT ---------- */
  if (interaction.commandName === 'x1_result') {
    const vencedor = interaction.options.getUser('vencedor');
    const perdedor = interaction.options.getUser('perdedor');
    const valor = interaction.options.getInteger('valor');

    if (vencedor.id === perdedor.id) return interaction.reply({ content: '❌ O vencedor e o perdedor não podem ser a mesma pessoa!', ephemeral: true });
    if (valor <= 0) return interaction.reply({ content: '❌ Valor inválido!', ephemeral: true });

    await recordMatch(vencedor, perdedor);

    const ranking = await loadRanking();
    ranking.players[vencedor.id].yens += valor*2;
    ranking.players[perdedor.id].yens -= valor;
    await saveRanking(ranking);

    const embed = new EmbedBuilder()
      .setTitle('🎮 Resultado X1 registrado')
      .setDescription(`${vencedor.username} venceu ${perdedor.username}\n💰 Total ganho: ${valor*2} ${CURRENCY_EMOJI}`)
      .setColor(0x00ff99)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
    await log(`X1 registrado → ${vencedor.username} venceu ${perdedor.username}`);
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
      leaderboard.forEach((p, i) => desc += `**${i+1}. ${p.name}** - Vitórias: ${p.wins} - Yens: ${p.yens} - Streak: ${p.streak}\n`);
      embed.setDescription(desc);
    }

    await interaction.reply({ embeds: [embed] });
  }

  /* ---------- PROFILE ---------- */
  if (interaction.commandName === 'profile') {
    const ranking = await loadRanking();
    const player = ranking.players[interaction.user.id];

    if (!player) return interaction.reply({ content: 'Você ainda não tem nenhuma partida registrada.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(`📊 Perfil de ${player.name}`)
      .setDescription(`Vitórias: ${player.wins}\nDerrotas: ${player.losses}\nStreak: ${player.streak}\nYens: ${player.yens} ${CURRENCY_EMOJI}`)
      .setColor(0x00ccff)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);
