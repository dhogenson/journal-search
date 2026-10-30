from mcp.server.mcpserver import MCPServer
import sqlite_vec
from config import OLLAMA_URL, MODEL, DATABASE_PATH, HOST, PORT
import requests
import sqlite3

mcp = MCPServer("search-journal")

@mcp.tool()
def search(prompt: str, limit: int = 5) -> list[dict]:
    """Search journal using RAG"""
    if not 1 <= limit <= 100:
        raise ValueError("limit must be between 1 and 100")

    try:
        response = requests.post(
            OLLAMA_URL,
            json={"model": MODEL, "input": prompt},
            timeout=60
        )
        response.raise_for_status()
        embedding = response.json()["embeddings"][0]
    except:
        raise RuntimeError("Unable to get embeddings")

    db: sqlite3.Connection | None = None
    try:
        db = sqlite3.connect(DATABASE_PATH)
        db.row_factory = sqlite3.Row
        db.enable_load_extension(True)
        sqlite_vec.load(db)
        db.enable_load_extension(False)

        rows = db.execute(
            """
            WITH matches AS (
                SELECT rowid, distance
                FROM chunk_vectors
                WHERE embedding MATCH ?
                    AND k = ?
            )
            SELECT
                chunks.source,
                chunks.chunk_index,
                chunks.text

            FROM matches
            JOIN chunks ON chunks.id = matches.rowid
            ORDER BY matches.distance
            """,
            (sqlite_vec.serialize_float32(embedding), limit),
        ).fetchall()

        return [dict(row) for row in rows]
    except sqlite3.Error as exc:
        raise RuntimeError("Unable to search the journal database") from exc
    finally:
        if db is not None:
            db.close()

if __name__ == "__main__":
    try:
        mcp.run(transport="streamable-http", host=HOST, port=PORT)
    except KeyboardInterrupt:
        pass  # Exit quietly on Ctrl+C.
