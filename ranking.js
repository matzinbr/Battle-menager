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

// Registra o resultado de uma partida X1
async function recordMatch(winner, loser) {
  const ranking = await loadRanking();

  // Cria entradas se não existirem
  if (!ranking.players[winner.id]) {
    ranking.players[winner.id] = { name: winner.username, wins: 0, losses: 0, streak: 0 };
  }
  if (!ranking.players[loser.id]) {
    ranking.players[loser.id] = { name: loser.username, wins: 0, losses: 0, streak: 0 };
  }

  // Atualiza vencedor
  ranking.players[winner.id].wins += 1;
  ranking.players[winner.id].streak += 1;

  // Atualiza perdedor
  ranking.players[loser.id].losses += 1;
  ranking.players[loser.id].streak = 0;

  await saveRanking(ranking);
}

// Retorna o top 10 do ranking
async function getLeaderboard() {
  const ranking = await loadRanking();
  return Object.values(ranking.players)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 10);
}

module.exports = { recordMatch, getLeaderboard };
