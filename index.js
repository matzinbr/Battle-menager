// index.js
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

const {
  loadRanking,
  saveRanking,
  recordMatch,
  getLeaderboard,
  getProfile
} = require('./ranking.js');

/* ================ CONFIG ================ */
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID || null; // pode ser null
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;
const TZ = process.env.TZ || 'America/Sao_Paulo';
const STATE_FILE = path.join(__dirname, 'arena_state.json');

const BASE_WORK = 270;
const CURRENCY_EMOJI = '<:MoneyPilePNGClipart:1463070061630718177>';

/* ================ CLIENT ================ */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* ================ STATE UTIL ================ */
async function loadState() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const json = JSON.parse(raw);
    if (!json.override && json.override !== false) json.override = null;
    if (!json.workUsed) json.workUsed = {}; // userId -> YYYY-MM-DD of last use
    return json;
  } catch {
    return { override: null, workUsed: {} };
  }
}
async function saveState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

/* ================ TIME CHECKS ================ */
function isWithinWorkWindow(now) {
  // now: DateTime
  // domingo (weekday === 7) e entre 9:00 e 23:59 (inclusive)
  return now.weekday === 7 && now.hour >= 9 && now.hour <= 23;
}
function workIsOpen(state) {
  const now = DateTime.now().setZone(TZ);
  return state.override !== null ? state.override : isWithinWorkWindow(now);
}

/* ================ PERMISSIONS (CANAL) ================ */
async function setWorkPermission(open) {
  if (!CHANNEL_ID) return;
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);
  await channel.permissionOverwrites.edit(guild.roles.everyone, { UseApplicationCommands: open });
  return channel;
}

/* ================ LOG HELP ================ */
async function logToChannel(msg) {
  console.log(msg);
  if (!LOG_CHANNEL_ID) return;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const ch = await guild.channels.fetch(LOG_CHANNEL_ID);
    await ch.send(`📝 ${msg}`);
  } catch (err) {
    console.warn('Falha ao enviar log no canal:', err.message);
  }
}

/* ================ RECONCILE ================ */
async function reconcile() {
  try {
    const state = await loadState();
    const shouldOpen = workIsOpen(state);

    if (!CHANNEL_ID) return;
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(CHANNEL_ID);
    const perms = channel.permissionsFor(guild.roles.everyone);
    const isOpen = perms.has(PermissionFlagsBits.UseApplicationCommands);

    if (isOpen !== shouldOpen) {
      await setWorkPermission(shouldOpen);
      const embed = new EmbedBuilder()
        .setTitle(shouldOpen ? '💰 WORK LIBERADO' : '⛔ WORK ENCERRADO')
        .setDescription(shouldOpen ? 'Use `/work` até 23:59 para sua recompensa semanal!' : '⛔ WORK fechado — só funciona aos domingos (9:00–23:59)!')
        .setColor(shouldOpen ? 0x00ff99 : 0xff5555)
        .setTimestamp();
      await channel.send({ embeds: [embed] });
      await logToChannel(`Sistema ajustado automaticamente → ${shouldOpen ? 'ABERTO' : 'FECHADO'}`);
    }
  } catch (err) {
    console.error('Erro em reconcile:', err);
  }
}

/* ================ SLASH COMMANDS ================ */
const commands = [
  new SlashCommandBuilder().setName('status-work').setDescription('Mostra se o WORK está disponível'),
  new SlashCommandBuilder().setName('work').setDescription('Use seu WORK semanal e ganhe yens!'),
  new SlashCommandBuilder()
    .setName('forcar-work')
    .setDescription('Força abrir ou fechar o WORK (staff)')
    .addBooleanOption(o => o.setName('abrir').setDescription('true = abrir / false = fechar').setRequired(true)),
  new SlashCommandBuilder().setName('clear-override').setDescription('Remove o controle manual e volta ao automático'),
  new SlashCommandBuilder()
    .setName('x1_result')
    .setDescription('Registrar resultado de uma partida X1 (cada um apostou VALOR)')
    .addUserOption(o => o.setName('vencedor').setDescription('Quem ganhou').setRequired(true))
    .addUserOption(o => o.setName('perdedor').setDescription('Quem perdeu').setRequired(true))
    .addIntegerOption(o => o.setName('valor').setDescription('Valor apostado por cada um').setRequired(true)),
  new SlashCommandBuilder().setName('rank').setDescription('Mostra o ranking top 10'),
  new SlashCommandBuilder().setName('profile').setDescription('Mostra suas estatísticas e yens')
].map(c => c.toJSON());

/* ================ READY (compat com ready/clientReady) ================ */
let _initialized = false;
async function onReadyOnce() {
  if (_initialized) return;
  _initialized = true;

  console.log(`✅ Bot online: ${client.user.tag}`);
  await logToChannel(`Bot online: ${client.user.tag}`);

  if (GUILD_ID) {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    } catch (err) {
      console.error('Erro registrando comandos (guild):', err);
    }
  } else {
    try {
      await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    } catch (err) {
      console.error('Erro registrando comandos (global):', err);
    }
  }

  await reconcile();

  cron.schedule('0 9 * * 0', reconcile, { timezone: TZ }); // Domingo 09:00
  cron.schedule('0 0 * * 1', async () => { // Segunda 00:00 -> limpa workUsed semanalmente
    const state = await loadState();
    state.workUsed = {};
    await saveState(state);
    await reconcile();
  }, { timezone: TZ });
  cron.schedule('*/5 * * * *', reconcile, { timezone: TZ });
}
client.once('ready', onReadyOnce);
client.once('clientReady', onReadyOnce); // compatibilidade com v15+

/* ================ INTERACTIONS ================ */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const state = await loadState();
  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
    (ADMIN_ROLE_ID && interaction.member.roles.cache.has(ADMIN_ROLE_ID));

  try {
    // STATUS-WORK
    if (interaction.commandName === 'status-work') {
      const open = workIsOpen(state);
      return await interaction.reply({
        embeds: [ new EmbedBuilder().setTitle(open ? '✅ WORK LIBERADO' : '⛔ WORK BLOQUEADO').setColor(open ? 0x00ff99 : 0xff5555) ],
        ephemeral: true
      });
    }

    // FORÇAR / CLEAR OVERRIDE (staff)
    if (interaction.commandName === 'forcar-work') {
      if (!isAdmin) return interaction.reply({ content: '🔒 Apenas staff pode usar.', ephemeral: true });
      state.override = interaction.options.getBoolean('abrir');
      await saveState(state);
      await reconcile();
      return interaction.reply({ content: '✅ Override aplicado.', ephemeral: true });
    }
    if (interaction.commandName === 'clear-override') {
      if (!isAdmin) return interaction.reply({ content: '🔒 Apenas staff pode usar.', ephemeral: true });
      state.override = null;
      await saveState(state);
      await reconcile();
      return interaction.reply({ content: '♻ Sistema voltou ao automático.', ephemeral: true });
    }

    /* ---------- WORK ---------- */
    if (interaction.commandName === 'work') {
      const now = DateTime.now().setZone(TZ);

      // verifica janela (somente domingos 09:00-23:59) — admins sempre podem testar
      if (!isWithinWorkWindow(now) && !isAdmin) {
        return interaction.reply({ content: '⛔ O /work só funciona aos domingos, das 9:00 às 23:59!', ephemeral: true });
      }

      // garante objeto workUsed
      if (!state.workUsed) state.workUsed = {};

      const todayDate = now.toISODate(); // YYYY-MM-DD
      const lastUsedDate = state.workUsed[interaction.user.id] || null;

      // já usou neste domingo?
      if (lastUsedDate === todayDate && !isAdmin) {
        return interaction.reply({ content: '⛔ Você já usou o /work este domingo!', ephemeral: true });
      }

      // Recompensa base
      let reward = BASE_WORK;

      // Evento-surpresa (5% chance): mini-evento (não jackpot puro)
      let surpriseText = '';
      if (Math.random() < 0.05) {
        // três tipos de eventos (aleatório)
        const ev = Math.floor(Math.random() * 3);
        if (ev === 0) {
          // Viajante misterioso: ganho extra fixo
          const bonus = 50 + Math.floor(Math.random() * 151); // 50-200
          reward += bonus;
          surpriseText = `\n🎁 Você encontrou um viajante misterioso e recebeu +${bonus} yens!`;
        } else if (ev === 1) {
          // Missão rápida: dá opção (apenas informativo aqui) — recompensa pequena
          const bonus = 30 + Math.floor(Math.random() * 71); // 30-100
          reward += bonus;
          surpriseText = `\n🧭 Missão curta: você completou uma tarefa e recebeu +${bonus} yens!`;
        } else {
          // Desafio secreto: extra aleatório
          const bonus = 20 + Math.floor(Math.random() * 181); // 20-200
          reward += bonus;
          surpriseText = `\n🏹 Desafio secreto concluído! +${bonus} yens adicionados.`;
        }
      }

      // marca uso para este domingo
      state.workUsed[interaction.user.id] = todayDate;
      await saveState(state);

      // atualiza ranking yens (cria jogador se necessário)
      const ranking = await loadRanking();
      if (!ranking.players) ranking.players = {};
      if (!ranking.players[interaction.user.id]) {
        ranking.players[interaction.user.id] = { name: interaction.user.username, wins:0, losses:0, streak:0, games:0, yens:0 };
      }
      ranking.players[interaction.user.id].yens = (Number(ranking.players[interaction.user.id].yens) || 0) + reward;
      await saveRanking(ranking);

      const embed = new EmbedBuilder()
        .setTitle('💼 WORK realizado!')
        .setDescription(`${CURRENCY_EMOJI} Você recebeu **${reward} yens**!${surpriseText}`)
        .setColor(0x00ff99)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      await logToChannel(`${interaction.user.tag} usou /work e recebeu ${reward} yens`);
      return;
    }

    /* ---------- X1 RESULT ---------- */
    if (interaction.commandName === 'x1_result') {
      // apenas staff allowed for registering results (keep safety)
      if (!isAdmin) return interaction.reply({ content: '🔒 Apenas staff pode registrar resultados X1.', ephemeral: true });

      const vencedor = interaction.options.getUser('vencedor');
      const perdedor = interaction.options.getUser('perdedor');
      const valor = interaction.options.getInteger('valor');

      if (!vencedor || !perdedor) return interaction.reply({ content: '❌ Usuário inválido.', ephemeral: true });
      if (vencedor.id === perdedor.id) return interaction.reply({ content: '❌ Vencedor e perdedor não podem ser a mesma pessoa!', ephemeral: true });
      if (!Number.isInteger(valor) || valor <= 0) return interaction.reply({ content: '❌ Valor inválido (must be positive integer).', ephemeral: true });

      // verifica perfil e saldo do perdedor
      const ranking = await loadRanking();
      if (!ranking.players) ranking.players = {};
      if (!ranking.players[perdedor.id]) {
        return interaction.reply({ content: '❌ O perdedor não tem saldo/perfil suficiente.', ephemeral: true });
      }
      const loserYens = Number(ranking.players[perdedor.id].yens || 0);
      if (loserYens < valor) {
        return interaction.reply({ content: `❌ O perdedor não possui ${valor} yens. Saldo atual: ${loserYens}`, ephemeral: true });
      }

      // registra a partida (recordMatch já atualiza wins/losses/streak e yens)
      await recordMatch(vencedor, perdedor, valor);

      const embed = new EmbedBuilder()
        .setTitle('🎮 Resultado X1 registrado')
        .setDescription(`${vencedor.username} venceu ${perdedor.username}\n💰 Total recebido: ${valor * 2} ${CURRENCY_EMOJI}`)
        .setColor(0x00ff99)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      await logToChannel(`X1 registrado: ${vencedor.tag || vencedor.username} venceu ${perdedor.tag || perdedor.username} por ${valor} yens`);
      return;
    }

    /* ---------- RANK ---------- */
    if (interaction.commandName === 'rank') {
      const leaderboard = await getLeaderboard();
      const embed = new EmbedBuilder()
        .setTitle('🏆 Ranking Top 10')
        .setColor(0xffcc00)
        .setTimestamp();

      if (!leaderboard || leaderboard.length === 0) embed.setDescription('Nenhum jogador registrado ainda.');
      else {
        const lines = leaderboard.map((p, i) => {
          const y = p.yens || 0;
          return `**${i+1}. ${p.name}** — Vitórias: ${p.wins} — Streak: ${p.streak} — ${y} ${CURRENCY_EMOJI}`;
        });
        embed.setDescription(lines.join('\n'));
      }

      await interaction.reply({ embeds: [embed] });
      return;
    }

    /* ---------- PROFILE ---------- */
    if (interaction.commandName === 'profile') {
      const profile = await getProfile(interaction.user.id);
      if (!profile) return interaction.reply({ content: 'Você ainda não tem registro ou saldo.', ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle(`📊 Perfil — ${profile.name}`)
        .setDescription(`Vitórias: ${profile.wins}\nDerrotas: ${profile.losses}\nStreak: ${profile.streak}\nPartidas: ${profile.games}\n💰 Yens: ${profile.yens || 0} ${CURRENCY_EMOJI}`)
        .setColor(0x00ccff)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

  } catch (err) {
    console.error('Erro na interação:', err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Ocorreu um erro ao executar o comando. Avise a administração.', ephemeral: true });
      } else {
        await interaction.followUp({ content: '❌ Ocorreu um erro ao executar o comando.', ephemeral: true });
      }
    } catch (err2) {
      console.error('Falha ao enviar mensagem de erro:', err2);
    }
  }
});

/* ================ LOGIN ================ */
client.login(TOKEN);
