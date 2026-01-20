# ranking/ranking.py
import aiosqlite
from datetime import datetime, timedelta

DB_PATH = "ranking.db"
DAILY_BONUS = 100
TOP_LIMIT = 10  # top 10 jogadores

# Inicializa banco de dados
async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
        CREATE TABLE IF NOT EXISTS players (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            chips INTEGER DEFAULT 0,
            streak INTEGER DEFAULT 0,
            last_win TIMESTAMP
        );""")
        await db.execute("""
        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            winner_id INTEGER,
            loser_id INTEGER,
            chips INTEGER,
            ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );""")
        await db.execute("""
        CREATE TABLE IF NOT EXISTS daily_claims (
            user_id INTEGER PRIMARY KEY,
            last_claim TIMESTAMP
        );""")
        await db.commit()

# Garante que jogador exista
async def ensure_player(db, user):
    async with db.execute("SELECT 1 FROM players WHERE user_id = ?", (user.id,)) as cur:
        row = await cur.fetchone()
    if not row:
        await db.execute(
            "INSERT INTO players(user_id, username) VALUES(?,?)",
            (user.id, str(user))
        )
        await db.commit()

# Registra uma partida
async def record_match(winner, loser, chips):
    async with aiosqlite.connect(DB_PATH) as db:
        await ensure_player(db, winner)
        await ensure_player(db, loser)

        # Atualiza vencedor
        await db.execute(
            "UPDATE players SET wins = wins + 1, chips = chips + ?, streak = streak + 1, last_win = ? WHERE user_id = ?",
            (chips, datetime.utcnow().isoformat(), winner.id)
        )
        # Atualiza perdedor
        await db.execute(
            "UPDATE players SET losses = losses + 1, chips = chips - ?, streak = 0 WHERE user_id = ?",
            (chips, loser.id)
        )
        # Registra partida
        await db.execute(
            "INSERT INTO matches(winner_id, loser_id, chips) VALUES(?,?,?)",
            (winner.id, loser.id, chips)
        )
        await db.commit()

# Mostra leaderboard
async def get_leaderboard(by="wins", limit=TOP_LIMIT):
    if by not in ("wins", "chips"):
        by = "wins"
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(f"""
            SELECT user_id, username, wins, losses, chips, streak
            FROM players
            ORDER BY {by} DESC, wins DESC
            LIMIT ?
        """, (limit,)) as cur:
            rows = await cur.fetchall()
    return rows

# Mostra perfil de um jogador
async def get_profile(user):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("""
            SELECT user_id, username, wins, losses, chips, streak, last_win
            FROM players WHERE user_id = ?
        """, (user.id,)) as cur:
            row = await cur.fetchone()
    return row

# Bônus diário
async def claim_daily(user):
    now = datetime.utcnow()
    async with aiosqlite.connect(DB_PATH) as db:
        await ensure_player(db, user)
        async with db.execute("SELECT last_claim FROM daily_claims WHERE user_id = ?", (user.id,)) as cur:
            row = await cur.fetchone()
        if row and row[0]:
            last = datetime.fromisoformat(row[0])
            if now - last < timedelta(hours=24):
                remaining = timedelta(hours=24) - (now - last)
                return False, remaining
        await db.execute(
            "INSERT OR REPLACE INTO daily_claims(user_id, last_claim) VALUES(?,?)",
            (user.id, now.isoformat())
        )
        await db.execute(
            "UPDATE players SET chips = chips + ? WHERE user_id = ?",
            (DAILY_BONUS, user.id)
        )
        await db.commit()
    return True, DAILY_BONUS
