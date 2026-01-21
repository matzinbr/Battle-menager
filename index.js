require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');

const {
  recordMatch,
  getLeaderboard,
  getProfile,
  tradeItem,
  loadRanking,
  saveRanking
} = require('./ranking.js');

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const TZ = 'America/Sao_Paulo';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ================= UTIL ================= */
function isSundayValid() {
  const now = new Date().toLocaleString('en-US', { timeZone: TZ });
  const date = new Date(now);
  const day = date.getDay(); // 0 = domingo
  const hour = date.getHours();
  return day === 0 && hour >= 9 && hour <= 23;
}

async function ensurePlayer(user) {
  const ranking = await loadRanking();
  if (!ranking.players[user.id]) {
    ranking.players[user.id] = {
      name: user.username,
      wins: 0,
      losses: 0,
      streak: 0,
      wallet: 600,
      bank: 0,
      items: { sukuna: 0, gokumonkyo: 0 }
    };
    await saveRanking(ranking);
  }
}

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder().setName('bank').setDescription('Ver seus yens'),
  new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Depositar yens no banco')
    .addIntegerOption(o => o.setName('valor').setRequired(true)),
  new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Sacar yens do banco')
    .addIntegerOption(o => o.setName('valor').setRequired(true)),

  new SlashCommandBuilder()
    .setName('x1_result')
    .setDescription('Registrar X1')
    .addUserOption(o => o.setName('vencedor').setRequired(true))
    .addUserOption(o => o.setName('perdedor').setRequired(true))
    .addIntegerOption(o => o.setName('valor').setRequired(true)),

  new SlashCommandBuilder().setName('rank').setDescription('Ranking Top 10'),
  new SlashCommandBuilder().setName('profile').setDescription('Seu perfil'),

  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Trocar itens por cargos')
    .addStringOption(o =>
      o.setName('item')
        .setRequired(true)
        .addChoices(
          { name: 'Sukuna Finger', value: 'sukuna' },
          { name: 'Gokumonkyo', value: 'gokumonkyo' }
        )
    ),

  new SlashCommandBuilder().setName('shenanigans_bet').setDescription('Work de domingo')
].map(c => c.toJSON());

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await ensurePlayer(interaction.user);

  const ranking = await loadRanking();
  const player = ranking.players[interaction.user.id];

  /* ===== BANK ===== */
  if (interaction.commandName === 'bank') {
    const embed = new EmbedBuilder()
      .setTitle('🏦 Seus Yens')
      .setDescription(
        `💰 Carteira: **${player.wallet}** yens\n🏦 Banco: **${player.bank}** yens`
      )
      .setColor(0x00ff99);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.commandName === 'deposit') {
    const v = interaction.options.getInteger('valor');
    if (v <= 0 || player.wallet < v)
      return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });

    player.wallet -= v;
    player.bank += v;
    await saveRanking(ranking);
    return interaction.reply({ content: `✅ Depositado ${v} yens.` });
  }

  if (interaction.commandName === 'withdraw') {
    const v = interaction.options.getInteger('valor');
    if (v <= 0 || player.bank < v)
      return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });

    player.bank -= v;
    player.wallet += v;
    await saveRanking(ranking);
    return interaction.reply({ content: `✅ Sacado ${v} yens.` });
  }

  /* ===== WORK ===== */
  if (interaction.commandName === 'shenanigans_bet') {
    if (!isSundayValid())
      return interaction.reply({ content: '⛔ Apenas domingo 09:00–23:59.', ephemeral: true });

    player.wallet += 270;
    await saveRanking(ranking);
    return interaction.reply({ content: '💸 Você ganhou **270 yens**!' });
  }

  /* ===== X1 ===== */
  if (interaction.commandName === 'x1_result') {
    const vencedor = interaction.options.getUser('vencedor');
    const perdedor = interaction.options.getUser('perdedor');
    const valor = interaction.options.getInteger('valor');

    await ensurePlayer(vencedor);
    await ensurePlayer(perdedor);

    const r = await loadRanking();
    if (r.players[perdedor.id].wallet < valor)
      return interaction.reply({ content: '❌ Perdedor sem yens.', ephemeral: true });

    r.players[perdedor.id].wallet -= valor;
    r.players[vencedor.id].wallet += valor * 2;

    await saveRanking(r);
    await recordMatch(vencedor, perdedor, valor);

    return interaction.reply(`⚔️ **${vencedor.username}** venceu e ganhou **${valor * 2} yens**`);
  }

  /* ===== RANK ===== */
  if (interaction.commandName === 'rank') {
    const lb = await getLeaderboard();
    const embed = new EmbedBuilder().setTitle('🏆 Ranking');
    embed.setDescription(lb.map((p, i) => `**${i + 1}. ${p.name}** - ${p.wins} vitórias`).join('\n'));
    return interaction.reply({ embeds: [embed] });
  }

  /* ===== PROFILE ===== */
  if (interaction.commandName === 'profile') {
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${player.name}`)
      .setDescription(
        `Vitórias: ${player.wins}\nDerrotas: ${player.losses}\nStreak: ${player.streak}\n💰 Carteira: ${player.wallet}`
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  /* ===== TRADE ===== */
  if (interaction.commandName === 'trade') {
    const item = interaction.options.getString('item');
    const result = await tradeItem(interaction.user.id, item);

    if (!result.success)
      return interaction.reply({ content: result.message, ephemeral: true });

    const role = interaction.guild.roles.cache.get(result.reward.roleId);
    if (role) await interaction.member.roles.add(role);

    return interaction.reply(`🏆 Você recebeu o cargo **${result.reward.title}**!`);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);
