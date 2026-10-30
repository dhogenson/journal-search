import os
from pathlib import Path

CHUNK_SIZE = 512
MODEL = os.getenv("MODEL", "embeddinggemma-2:270m")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/embed")
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", "index.db")).expanduser()
if not DATABASE_PATH.is_absolute():
    DATABASE_PATH = Path(__file__).resolve().parent / DATABASE_PATH

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))
