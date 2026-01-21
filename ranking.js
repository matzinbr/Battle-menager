const fs = require('fs').promises;
const RANK_FILE = './ranking.json';

// Carrega o ranking do arquivo
async function loadRanking() {
  try {
    const data = await fs.readFile(RANK_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { players: {} };
  }
}

// Salva o ranking no arquivo
async function saveRanking(ranking) {
  await fs.writeFile(RANK_FILE, JSON.stringify(ranking, null, 2));
}

// Registra resultado de X1 com valor apostado
async function recordMatch(winner, loser, value) {
  const ranking = await loadRanking();

  if (!ranking.players[winner.id]) {
    ranking.players[winner.id] = { name: winner.username, wins: 0, losses: 0, streak: 0, yens: 0, items: [], titles: [] };
  }
  if (!ranking.players[loser.id]) {
    ranking.players[loser.id] = { name: loser.username, wins: 0, losses: 0, streak: 0, yens: 0, items: [], titles: [] };
  }

  // Atualiza vencedor
  ranking.players[winner.id].wins += 1;
  ranking.players[winner.id].streak += 1;
  ranking.players[winner.id].yens += value * 2;

  // Atualiza perdedor
  ranking.players[loser.id].losses += 1;
  ranking.players[loser.id].streak = 0;
  ranking.players[loser.id].yens -= value;
  if (ranking.players[loser.id].yens < 0) ranking.players[loser.id].yens = 0;

  await saveRanking(ranking);
}

// Retorna top 10 do ranking por vitórias e yens
async function getLeaderboard() {
  const ranking = await loadRanking();
  return Object.values(ranking.players)
    .sort((a, b) => {
      if (b.wins === a.wins) return b.yens - a.yens;
      return b.wins - a.wins;
    })
    .slice(0, 10);
}

module.exports = { loadRanking, saveRanking, recordMatch, getLeaderboard };
