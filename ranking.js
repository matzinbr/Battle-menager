// ranking.js
const fs = require('fs').promises;
const path = require('path');

const RANK_FILE = path.join(__dirname, 'ranking.json');
const DEFAULT_START_YENS = 0; // jogadores começam com 0 yens (o /work dá yens)

/** Carrega o ranking do disco, garante estrutura mínima. */
async function loadRanking() {
  try {
    const data = await fs.readFile(RANK_FILE, 'utf8');
    const json = JSON.parse(data);
    if (!json.players) json.players = {};
    return json;
  } catch (err) {
    return { players: {} };
  }
}

/** Salva o ranking no disco */
async function saveRanking(ranking) {
  await fs.writeFile(RANK_FILE, JSON.stringify(ranking, null, 2));
}

/** Garante existência do jogador e normaliza campos */
function ensurePlayerRecord(ranking, userId, userName = 'Unknown') {
  if (!ranking.players[userId]) {
    ranking.players[userId] = {
      name: userName,
      wins: 0,
      losses: 0,
      streak: 0,
      games: 0,
      yens: DEFAULT_START_YENS
    };
  } else {
    const p = ranking.players[userId];
    // garante campos existentes
    p.name = p.name || userName;
    p.wins = Number(p.wins || 0);
    p.losses = Number(p.losses || 0);
    p.streak = Number(p.streak || 0);
    p.games = Number(p.games || 0);
    p.yens = Number(p.yens || 0);
  }
  return ranking.players[userId];
}

/**
 * Registra o resultado de uma partida X1.
 * winner, loser são objetos User (ou têm id/username).
 * valor = inteiro (quanto cada um apostou). Pode ser 0.
 */
async function recordMatch(winner, loser, valor = 0) {
  const ranking = await loadRanking();

  ensurePlayerRecord(ranking, winner.id, winner.username);
  ensurePlayerRecord(ranking, loser.id, loser.username);

  const pw = ranking.players[winner.id];
  const pl = ranking.players[loser.id];

  // vitórias/derrotas/streak/games
  pw.wins += 1;
  pw.streak += 1;
  pw.games += 1;

  pl.losses += 1;
  pl.streak = 0;
  pl.games += 1;

  // movimentação de yens
  // vencedor ganha o valor apostado do perdedor (total recebido = valor*2)
  if (typeof valor === 'number' && valor > 0) {
    pw.yens = Number(pw.yens || 0) + valor * 2;
    pl.yens = Number(pl.yens || 0) - valor;
    if (pl.yens < 0) pl.yens = 0;
  }

  await saveRanking(ranking);
  return { winner: pw, loser: pl };
}

/** Retorna top 10 ordenado por wins (desempata por yens) */
async function getLeaderboard() {
  const ranking = await loadRanking();
  return Object.values(ranking.players)
    .sort((a, b) => {
      if ((b.wins - a.wins) !== 0) return b.wins - a.wins;
      return (b.yens || 0) - (a.yens || 0);
    })
    .slice(0, 10);
}

/** Retorna perfil de um jogador (ou null) */
async function getProfile(userId) {
  const ranking = await loadRanking();
  return ranking.players[userId] || null;
}

module.exports = {
  loadRanking,
  saveRanking,
  recordMatch,
  getLeaderboard,
  getProfile
};
