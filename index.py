import argparse
import sqlite3
from pathlib import Path

import requests
import sqlite_vec

from config import CHUNK_SIZE, MODEL, OLLAMA_URL, DATABASE_PATH


def main():
    parser = argparse.ArgumentParser(description="Index Markdown files in a folder.")
    parser.add_argument(
        "folder", type=Path, nargs="?", default=Path("."),
        help="Folder to index recursively (default: current directory)",
    )
    args = parser.parse_args()
    folder = args.folder.expanduser().resolve()
    if not folder.is_dir():
        parser.error(f"Not a directory: {folder}")

    paths = sorted(path for path in folder.rglob("*.md") if path.is_file())
    if not paths:
        print(f"No Markdown files found in {folder}")
        return

    db = sqlite3.connect(DATABASE_PATH)
    total_chunks = 0
    try:
        db.enable_load_extension(True)
        sqlite_vec.load(db)
        db.enable_load_extension(False)

        db.execute("""
            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY,
                source TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                text TEXT NOT NULL
            )
        """)

        for path in paths:
            raw_data = path.read_text(encoding="utf-8")
            chunks = [
                raw_data[i:i + CHUNK_SIZE]
                for i in range(0, len(raw_data), CHUNK_SIZE)
            ]
            embeddings = []
            if chunks:
                response = requests.post(
                    OLLAMA_URL,
                    json={"model": MODEL, "input": chunks},
                    timeout=60,
                )
                response.raise_for_status()
                embeddings = response.json()["embeddings"]
                if len(embeddings) != len(chunks):
                    raise ValueError(f"Unexpected embedding count for {path}")

                dimensions = len(embeddings[0])
                db.execute(f"""
                    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
                        embedding float[{dimensions}] distance_metric=cosine
                    )
                """)

            with db:
                # Also clear previous chunks if a file is now empty.
                if db.execute(
                    "SELECT 1 FROM sqlite_master WHERE name = 'chunk_vectors'"
                ).fetchone():
                    db.execute("""
                        DELETE FROM chunk_vectors
                        WHERE rowid IN (
                            SELECT id FROM chunks WHERE source = ?
                        )
                    """, (str(path),))
                db.execute("DELETE FROM chunks WHERE source = ?", (str(path),))

                for index, (text, embedding) in enumerate(
                    zip(chunks, embeddings, strict=True)
                ):
                    cursor = db.execute(
                        "INSERT INTO chunks (source, chunk_index, text) VALUES (?, ?, ?)",
                        (str(path), index, text),
                    )
                    db.execute(
                        "INSERT INTO chunk_vectors (rowid, embedding) VALUES (?, ?)",
                        (cursor.lastrowid, sqlite_vec.serialize_float32(embedding)),
                    )

            total_chunks += len(chunks)
            print(f"Indexed {path.relative_to(folder)}: {len(chunks)} chunks")
    finally:
        db.close()

    print(f"Stored {total_chunks} chunks from {len(paths)} files in {DATABASE_PATH}")


if __name__ == "__main__":
    main()
