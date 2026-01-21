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
async function recordMatch(winner, loser, bet = 0) {
  const ranking = await loadRanking();

  if (!ranking.players[winner.id]) {
    ranking.players[winner.id] = {
      name: winner.username,
      wins: 0,
      losses: 0,
      streak: 0,
      yens: 0,
      items: { sukuna: 0, gokumonkyo: 0 }
    };
  }

  if (!ranking.players[loser.id]) {
    ranking.players[loser.id] = {
      name: loser.username,
      wins: 0,
      losses: 0,
      streak: 0,
      yens: 0,
      items: { sukuna: 0, gokumonkyo: 0 }
    };
  }

  // Atualiza vencedor
  ranking.players[winner.id].wins += 1;
  ranking.players[winner.id].streak += 1;
  ranking.players[winner.id].yens += bet * 2; // ganha dobro do valor apostado

  // Atualiza itens colecionáveis dependendo da vitória
  if (Math.random() < 0.15) ranking.players[winner.id].items.sukuna += 1; // chance de 15%
  if (Math.random() < 0.1) ranking.players[winner.id].items.gokumonkyo += 1; // chance de 10%

  // Atualiza perdedor
  ranking.players[loser.id].losses += 1;
  ranking.players[loser.id].streak = 0;
  ranking.players[loser.id].yens -= bet; // perde o valor apostado

  await saveRanking(ranking);
}

// Retorna o top 10 do ranking por vitórias
async function getLeaderboard() {
  const ranking = await loadRanking();
  return Object.values(ranking.players)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 10);
}

// Pega perfil completo do jogador
async function getProfile(userId) {
  const ranking = await loadRanking();
  return ranking.players[userId] || null;
}

// Troca itens por cargos
async function tradeItem(userId, item) {
  const ranking = await loadRanking();
  const player = ranking.players[userId];

  if (!player) return { success: false, message: 'Jogador não encontrado.' };

  let reward = null;

  if (item === 'sukuna' && player.items.sukuna >= 2) {
    player.items.sukuna -= 2;
    reward = { title: 'Disgraceful King', roleId: '1463413152824819753' };
  } else if (item === 'gokumonkyo' && player.items.gokumonkyo >= 3) {
    player.items.gokumonkyo -= 3;
    reward = { title: 'The Honored One', roleId: '1463413249734086860' };
  } else {
    return { success: false, message: 'Você não tem itens suficientes para trocar.' };
  }

  await saveRanking(ranking);
  return { success: true, reward };
}

module.exports = { loadRanking, saveRanking, recordMatch, getLeaderboard, getProfile, tradeItem };
