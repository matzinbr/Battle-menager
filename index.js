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

/* ================= CLIENT ================= */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ================= STATE ================= */
async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { override: null }; }
}
async function saveState(state) { await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2)); }

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

/* ================= SHENANIGANS BET ================= */
async function shenanigansBet(interaction) {
  const ranking = await loadRanking();
  const user = interaction.user;

  if (!ranking.players[user.id]) {
    ranking.players[user.id] = { 
      name: user.username, 
      yens: 0, 
      lastWork: null, 
      streak: 0,
      items: [],
      titles: []
    };
  }

  const player = ranking.players[user.id];
  const now = DateTime.now().setZone(TZ);

  // Verifica domingo e horário
  if (now.weekday !== 7 || now.hour < 9 || now.hour >= 24) {
    return interaction.reply({ content: '⛔ /shenanigans_bet só funciona aos domingos das 9:00 às 23:59!', ephemeral: true });
  }

  // Uso apenas 1 vez por domingo
  if (player.lastWork === now.toISODate()) {
    return interaction.reply({ content: '⛔ Você já usou /shenanigans_bet hoje!', ephemeral: true });
  }

  player.lastWork = now.toISODate();
  player.streak += 1;

  // Valor base
  let reward = 270;

  // Evento streak: 3 domingos consecutivos
  if (player.streak % 3 === 0) {
    reward += 100;
  }

  // Evento desastre: chance de -150 yens
  if (Math.random() < 0.03) {
    reward -= 150;
    if (reward < 0) reward = 0;
  }

  // Evento missão secreta: chance de ganhar itens
  const secretRoll = Math.random();
  let secretMsg = '';
  if (secretRoll < 0.05 && !player.items.includes('Sukuna Finger')) {
    player.items.push('Sukuna Finger');
    secretMsg = '🎁 Você encontrou um item raro: <:sukuna_finger:1463407933449572352>';
  } else if (secretRoll < 0.10 && !player.items.includes('Gokumonkyō')) {
    player.items.push('Gokumonkyō');
    secretMsg = '🎁 Você encontrou um item raro: <:Gokumonkyo:1463408847556444233>';
  }

  player.yens += reward;
  await saveRanking(ranking);

  const embed = new EmbedBuilder()
    .setTitle('💼 Shenanigans Bet Concluído!')
    .setDescription(`${user.username} recebeu ${reward} <:MoneyPilePNGClipart:1463070061630718177>\nStreak atual: ${player.streak}${secretMsg ? '\n' + secretMsg : ''}`)
    .setColor(0x00ff99)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder().setName('shenanigans_bet').setDescription('Use seu trabalho de apostas dominical!'),
  new SlashCommandBuilder()
    .setName('x1_result')
    .setDescription('Registrar resultado de uma partida X1')
    .addUserOption(o => o.setName('vencedor').setDescription('Quem ganhou').setRequired(true))
    .addUserOption(o => o.setName('perdedor').setDescription('Quem perdeu').setRequired(true))
    .addIntegerOption(o => o.setName('valor').setDescription('Valor apostado em yens').setRequired(true)),
  new SlashCommandBuilder().setName('rank').setDescription('Mostra o ranking top 10'),
  new SlashCommandBuilder().setName('profile').setDescription('Mostra suas estatísticas de vitórias/derrotas, yens e itens'),
  new SlashCommandBuilder()
    .setName('trade_item')
    .setDescription('Troque seus itens por títulos')
    .addStringOption(o => o.setName('item').setDescription('Item que deseja trocar').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Título que deseja ganhar').setRequired(true))
].map(c => c.toJSON());

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await log(`Bot online: ${client.user.tag}`);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const isAdmin =
    interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
    (ADMIN_ROLE_ID && interaction.member.roles.cache.has(ADMIN_ROLE_ID));

  // Shenanigans Bet
  if (interaction.commandName === 'shenanigans_bet') {
    return shenanigansBet(interaction);
  }

  // X1 RESULT
  if (interaction.commandName === 'x1_result') {
    if (!isAdmin) return interaction.reply({ content: '🔒 Apenas staff pode usar este comando.', ephemeral: true });

    const vencedor = interaction.options.getUser('vencedor');
    const perdedor = interaction.options.getUser('perdedor');
    const valor = interaction.options.getInteger('valor');

    if (vencedor.id === perdedor.id) return interaction.reply({ content: '❌ Vencedor e perdedor não podem ser a mesma pessoa!', ephemeral: true });

    await recordMatch(vencedor, perdedor, valor);

    const embed = new EmbedBuilder()
      .setTitle('🎮 Resultado X1 registrado')
      .setDescription(`${vencedor.username} venceu ${perdedor.username}\nValor: ${valor * 2} yens`)
      .setColor(0x00ff99)
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // RANK
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
        desc += `**${i + 1}. ${p.name}** - Vitórias: ${p.wins} - Yens: ${p.yens}\n`;
      });
      embed.setDescription(desc);
    }

    return interaction.reply({ embeds: [embed] });
  }

  // PROFILE
  if (interaction.commandName === 'profile') {
    const ranking = await loadRanking();
    const player = ranking.players[interaction.user.id];

    if (!player) return interaction.reply({ content: 'Você ainda não tem nenhuma partida registrada.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(`📊 Perfil de ${player.name}`)
      .setDescription(`Vitórias: ${player.wins || 0}\nDerrotas: ${player.losses || 0}\nYens: ${player.yens}\nStreak: ${player.streak}\nItens: ${player.items.join(', ') || 'Nenhum'}\nTítulos: ${player.titles.join(', ') || 'Nenhum'}`)
      .setColor(0x00ccff)
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // TRADE_ITEM
  if (interaction.commandName === 'trade_item') {
    const ranking = await loadRanking();
    const player = ranking.players[interaction.user.id];
    if (!player) return interaction.reply({ content: 'Você ainda não tem itens.', ephemeral: true });

    const item = interaction.options.getString('item');
    const title = interaction.options.getString('title');

    if (!player.items.includes(item)) return interaction.reply({ content: 'Você não possui esse item.', ephemeral: true });

    // Remove item e adiciona título
    player.items = player.items.filter(i => i !== item);
    player.titles.push(title);

    await saveRanking(ranking);

    return interaction.reply({ content: `✅ Você trocou ${item} pelo título "${title}"!`, ephemeral: true });
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);
