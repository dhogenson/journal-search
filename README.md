**Note:** This is a personal project meant for my Journal, this is not a general purpose RAG mcp server

# search-journal

To install dependencies:

```bash
bun install
```

## Index your journal

Start Ollama and make sure the embedding model is available:

```bash
ollama pull embeddinggemma-2:270m
bun run embedFiles.ts
```

This reads Markdown files in `~/notes/Journal`, splits them into 512-word chunks,
embeds them with Ollama, and stores the text and vectors in `journal.sqlite`.
Re-running the command replaces each scanned file's previous chunks, including
clearing chunks for files that are now empty. Deleted files are not automatically
removed from the index.

## Start the MCP server

```bash
bun run index.ts
```

The MCP server uses Streamable HTTP at **http://127.0.0.1:8000/mcp**. Configure
that URL in your MCP client (HTTP transport, not stdio). It exposes a `search`
tool with `query` and an optional `limit`
(1–10, default 5). It embeds the query and returns the closest indexed passages,
including their file, zero-based chunk index, and cosine distance (lower is closer).
An empty index returns no results. Indexing is a separate command; the server does
not re-embed your journal at startup. Keep Ollama running for searches.

Both commands use the same defaults, configurable through environment variables:

| Variable | Default |
| --- | --- |
| `HOST` | `127.0.0.1` (server only) |
| `PORT` | `8000` (server only) |
| `JOURNAL_DIR` | `~/notes/Journal` (indexing only) |
| `JOURNAL_DB_PATH` | `journal.sqlite` beside these source files |
| `OLLAMA_URL` | `http://localhost:11434` |
| `EMBEDDING_MODEL` | `embeddinggemma-2:270m` |

To listen on other interfaces or use a different port:

```bash
HOST=0.0.0.0 PORT=8000 bun run index.ts
```

The server has no authentication and provides access to private journal content.
Keep it on localhost unless access is restricted by a firewall or an authenticated
reverse proxy. Cross-origin browser requests are rejected. HTTP requests are
stateless; no session ID is required.

Use the same embedding model for indexing and search. If changing models, use a
fresh database and re-index; existing vectors cannot be mixed with another model.

## Docker Compose

Requires Docker with Compose and host networking (native on Linux; Docker Desktop
4.34+ requires opting in to host networking). Ollama runs separately on the host;
Compose does not install it or download models.

Make sure your journal directory exists and is readable by the container's
non-root user, then build, index, and start:

```bash
ollama pull embeddinggemma-2:270m
docker compose build
docker compose run --rm search-journal bun run embedFiles.ts
docker compose up -d
```

The MCP endpoint is **http://127.0.0.1:8000/mcp**. Compose uses host networking
and binds the server to localhost by default, so no port publishing is needed and
host-local Ollama remains reachable without exposing Ollama to the network.

The journal defaults to `~/notes/Journal` on the host and is mounted read-only at
`/journal`. Override `JOURNAL_DIR`, `OLLAMA_URL`, `EMBEDDING_MODEL`, `HOST`, or
`PORT` using your shell environment or a Compose `.env` file, for example:

```dotenv
JOURNAL_DIR=/absolute/path/to/your/journal
OLLAMA_URL=http://127.0.0.1:11434
EMBEDDING_MODEL=embeddinggemma-2:270m
PORT=8000
```

SQLite is stored at `/data/journal.sqlite` in the `journal-data` named volume,
shared by the server and indexing commands. The existing local `journal.sqlite`
is **not** copied into the image or imported; the commands above create a fresh
index. Search results report container paths under `/journal`.

After changing journal files, re-run the indexing command. To avoid concurrent
SQLite writes during indexing, you can stop the server first:

```bash
docker compose stop
docker compose run --rm search-journal bun run embedFiles.ts
docker compose up -d
docker compose logs -f search-journal
```

`docker compose down` preserves the index; `docker compose down -v` deletes it.
The image build excludes local databases, journal files, `.env` files, and
`node_modules`. Do not set `HOST=0.0.0.0` without restricting access: with host
networking this exposes the unauthenticated server on all host interfaces.

## Tests

```bash
bun test
```

Tests use temporary databases and mocked embeddings, not your journal or Ollama.
