const fs = require('fs').promises;
const path = require('path');

const RANK_FILE = path.join(__dirname, 'ranking.json');

/* ================= LOAD / SAVE ================= */
async function loadRanking() {
  try {
    const data = await fs.readFile(RANK_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { players: {} };
  }
}

async function saveRanking(ranking) {
  await fs.writeFile(RANK_FILE, JSON.stringify(ranking, null, 2));
}

/* ================= PLAYER BASE ================= */
function createPlayer(username) {
  return {
    name: username,
    wins: 0,
    losses: 0,
    streak: 0,
    wallet: 600,
    bank: 0,
    items: {
      sukuna: 0,
      gokumonkyo: 0
    }
  };
}

/* ================= X1 ================= */
async function recordMatch(winner, loser) {
  const ranking = await loadRanking();

  if (!ranking.players[winner.id]) {
    ranking.players[winner.id] = createPlayer(winner.username);
  }

  if (!ranking.players[loser.id]) {
    ranking.players[loser.id] = createPlayer(loser.username);
  }

  ranking.players[winner.id].wins += 1;
  ranking.players[winner.id].streak += 1;

  ranking.players[loser.id].losses += 1;
  ranking.players[loser.id].streak = 0;

  await saveRanking(ranking);
}

/* ================= LEADERBOARD ================= */
async function getLeaderboard() {
  const ranking = await loadRanking();
  return Object.values(ranking.players)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 10);
}

/* ================= PROFILE ================= */
async function getProfile(userId) {
  const ranking = await loadRanking();
  return ranking.players[userId] || null;
}

/* ================= TRADE ITEMS ================= */
async function tradeItem(userId, item) {
  const ranking = await loadRanking();
  const player = ranking.players[userId];

  if (!player) {
    return { success: false, message: 'Perfil não encontrado.' };
  }

  if (item === 'sukuna') {
    if (player.items.sukuna < 2) {
      return { success: false, message: 'Você precisa de 2 Sukuna Fingers.' };
    }

    player.items.sukuna -= 2;
    await saveRanking(ranking);

    return {
      success: true,
      reward: {
        roleId: '1463413152824819753'
      }
    };
  }

  if (item === 'gokumonkyo') {
    if (player.items.gokumonkyo < 3) {
      return { success: false, message: 'Você precisa de 3 Gokumonkyō.' };
    }

    player.items.gokumonkyo -= 3;
    await saveRanking(ranking);

    return {
      success: true,
      reward: {
        roleId: '1463413249734086860'
      }
    };
  }

  return { success: false, message: 'Item inválido.' };
}

/* ================= EXPORTS ================= */
module.exports = {
  loadRanking,
  saveRanking,
  recordMatch,
  getLeaderboard,
  getProfile,
  tradeItem
};
