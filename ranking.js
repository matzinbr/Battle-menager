const fs = require('fs').promises;
const RANK_FILE = './ranking.json';

const DEFAULT_START_YENS = 1000; // Valor inicial para novos jogadores

// Carrega o ranking do arquivo
async function loadRanking() {
  try {
    const data = await fs.readFile(RANK_FILE, 'utf8');
    const json = JSON.parse(data);
    if (!json.players) json.players = {};
    return json;
  } catch {
    return { players: {} };
  }
}

// Salva o ranking no arquivo
async function saveRanking(ranking) {
  await fs.writeFile(RANK_FILE, JSON.stringify(ranking, null, 2));
}

// Registra o resultado de uma partida X1 com valor em Yens
async function recordMatch(winner, loser, valor) {
  const ranking = await loadRanking();

  // Cria entradas se não existirem
  if (!ranking.players[winner.id]) {
    ranking.players[winner.id] = { name: winner.username, wins: 0, losses: 0, streak: 0, yens: DEFAULT_START_YENS };
  }
  if (!ranking.players[loser.id]) {
    ranking.players[loser.id] = { name: loser.username, wins: 0, losses: 0, streak: 0, yens: DEFAULT_START_YENS };
  }

  // Atualiza vencedor
  ranking.players[winner.id].wins += 1;
  ranking.players[winner.id].streak += 1;
  ranking.players[winner.id].yens += valor; // ganha Yens do perdedor

  // Atualiza perdedor
  ranking.players[loser.id].losses += 1;
  ranking.players[loser.id].streak = 0;
  ranking.players[loser.id].yens -= valor; // perde Yens

  // Garante que ninguém fique com Yens negativos
  if (ranking.players[loser.id].yens < 0) ranking.players[loser.id].yens = 0;

  await saveRanking(ranking);
}

// Retorna o top 10 do ranking
async function getLeaderboard() {
  const ranking = await loadRanking();
  return Object.values(ranking.players)
    .sort((a, b) => b.wins - a.wins || b.yens - a.yens) // desempate por Yens
    .slice(0, 10);
}

// Retorna o perfil de um jogador específico
async function getProfile(userId) {
  const ranking = await loadRanking();
  const player = ranking.players[userId];
  return player || null;
}

module.exports = { recordMatch, getLeaderboard, loadRanking, saveRanking };
