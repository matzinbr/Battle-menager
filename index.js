/**
 * ARENA BETS — WORK SYSTEM + X1 RESULTADO COMPLETO
 * Versão Profissional Atualizada
 */

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

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;
const TZ = process.env.TZ || 'America/Sao_Paulo';
const STATE_FILE = path.join(__dirname, 'arena_state.json');
const RANK_FILE = path.join(__dirname, 'ranking.json');

/* ================= CLIENT ================= */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ================= STATE ================= */
async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { override: null }; }
}
async function saveState(state) { await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2)); }

/* ================= RANKING ================= */
async function loadRanking() {
  try { return JSON.parse(await fs.readFile(RANK_FILE, 'utf8')); } catch { return { players: {} }; }
}
async function saveRanking(ranking) {
  await fs.writeFile(RANK_FILE, JSON.stringify(ranking, null, 2));
}
async function recordMatch(winner, loser, valor) {
  const ranking = await loadRanking();
  if (!ranking.players[winner.id]) ranking.players[winner.id] = { name: winner.username, wins: 0, losses: 0, streak: 0, games: 0 };
  if (!ranking.players[loser.id]) ranking.players[loser.id] = { name: loser.username, wins: 0, losses: 0, streak: 0, games: 0 };

  // Atualiza vencedor
  ranking.players[winner.id].wins += 1;
  ranking.players[winner.id].streak += 1;
  ranking.players[winner.id].games += 1;

  // Atualiza perdedor
  ranking.players[loser.id].losses += 1;
  ranking.players[loser.id].streak = 0;
  ranking.players[loser.id].games += 1;

  await saveRanking(ranking);
}
async function getLeaderboard() {
  const ranking = await loadRanking();
  return Object.values(ranking.players).sort((a,b) => b.wins - a.wins).slice(0,10);
}

/* ================= TIME LOGIC ================= */
function workIsOpen(state) {
  const now = DateTime.now().setZone(TZ);
  const isSunday = now.weekday === 7;
  return state.override !== null ? state.override : isSunday;
}

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
          ? 'Use `/work` até 00:00 para apostas.'
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
  new SlashCommandBuilder()
    .setName('forcar-work')
    .setDescription('Força abrir ou fechar o WORK (staff)')
    .addBooleanOption(o => o.setName('abrir').setDescription('true = abrir / false = fechar').setRequired(true)),
  new SlashCommandBuilder().setName('clear-override').setDescription('Remove o controle manual e volta ao automático'),

  new SlashCommandBuilder()
    .setName('x1_result')
    .setDescription('Registrar resultado de uma partida X1')
    .addUserOption(o => o.setName('vencedor').setDescription('Quem ganhou').setRequired(true))
    .addUserOption(o => o.setName('perdedor').setDescription('Quem perdeu').setRequired(true))
    .addNumberOption(o => o.setName('valor').setDescription('Quanto cada um apostou').setRequired(true)),

  new SlashCommandBuilder().setName('rank').setDescription('Mostra o ranking top 10'),
  new SlashCommandBuilder().setName('profile').setDescription('Mostra suas estatísticas de vitórias/derrotas')
].map(c => c.toJSON());

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await log(`Bot online: ${client.user.tag}`);

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });

  await saveState(await readState());
  await reconcile();

  cron.schedule('0 9 * * 0', reconcile, { timezone: TZ }); // Domingo
  cron.schedule('0 0 * * 1', reconcile, { timezone: TZ }); // Segunda
  cron.schedule('*/5 * * * *', reconcile, { timezone: TZ }); // Auto check
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const state = await readState();
  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
    (ADMIN_ROLE_ID && interaction.member.roles.cache.has(ADMIN_ROLE_ID));

  /* ---------- WORK ---------- */
  if (interaction.commandName === 'status-work') {
    const open = workIsOpen(state);
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle(open ? '✅ WORK LIBERADO' : '⛔ WORK BLOQUEADO').setColor(open ? 0x00ff99 : 0xff5555)], ephemeral: true });
  }

  if (!isAdmin) {
    if (['forcar-work', 'clear-override', 'x1_result'].includes(interaction.commandName)) {
      return interaction.reply({ content: '🔒 Apenas a staff pode usar este comando.', ephemeral: true });
    }
  }

  if (interaction.commandName === 'forcar-work') {
    state.override = interaction.options.getBoolean('abrir');
    await saveState(state);
    await reconcile();
    return interaction.reply({ content: '✅ Override aplicado.', ephemeral: true });
  }

  if (interaction.commandName === 'clear-override') {
    state.override = null;
    await saveState(state);
    await reconcile();
    return interaction.reply({ content: '♻ Sistema voltou ao automático.', ephemeral: true });
  }

  /* ---------- X1 RESULT ---------- */
  if (interaction.commandName === 'x1_result') {
    try {
      const vencedor = interaction.options.getUser('vencedor');
      const perdedor = interaction.options.getUser('perdedor');
      const valor = interaction.options.getNumber('valor');

      if (!vencedor || !perdedor || !valor) {
        return interaction.reply({ content: '❌ Preencha todos os campos corretamente!', ephemeral: true });
      }

      if (valor <= 0) {
        return interaction.reply({ content: '❌ O valor da aposta deve ser maior que 0!', ephemeral: true });
      }

      if (vencedor.id === perdedor.id) {
        return interaction.reply({ content: '❌ O vencedor e o perdedor não podem ser a mesma pessoa!', ephemeral: true });
      }

      const total = valor * 2;
      await recordMatch(vencedor, perdedor, valor);

      const embed = new EmbedBuilder()
        .setTitle('🎮 Resultado X1')
        .setDescription(`${vencedor.username} ganhou do ${perdedor.username}\n💰 Dinheiro total apostado: ${total} yens`)
        .setColor(0x00ff99)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      await log(`X1 registrado → ${vencedor.username} venceu ${perdedor.username}, total apostado: ${total} yens`);
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: '❌ Ocorreu um erro ao registrar o resultado.', ephemeral: true });
    }
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
        desc += `**${i + 1}. ${p.name}** - Vitórias: ${p.wins} - Derrotas: ${p.losses} - Streak: ${p.streak}\n`;
      });
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
      .setDescription(`Vitórias: ${player.wins}\nDerrotas: ${player.losses}\nStreak atual: ${player.streak}\nPartidas jogadas: ${player.games}`)
      .setColor(0x00ccff)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);
