# search-journal

An MCP server that searches Markdown journals using Ollama embeddings and a
SQLite vector index. The Streamable HTTP endpoint is `/mcp` (port 8000).

## Docker

Requires Docker with the Compose plugin, an Ollama server, and the embedding
model installed on that server:

```sh
ollama pull embeddinggemma-2:270m
docker compose build
```

Compose uses host networking on Linux/NixOS and connects to Ollama at
`http://127.0.0.1:11434/api/embed`. Keep Ollama bound to localhost (its default);
there is no need to expose it to your LAN. If you previously changed
`OLLAMA_HOST` to `0.0.0.0:11434`, restore it to `127.0.0.1:11434` and restart
Ollama.

Host networking shares the host's network namespace, so the container has less
network isolation. The MCP server explicitly binds to `127.0.0.1:8000`, and no
Docker port publishing is needed. Port 8000 must be free on the host. Docker
Desktop requires host networking support to be enabled.

For a remote Ollama server or a different model, set `OLLAMA_URL` and/or `MODEL`
in a local `.env` file before running Compose:

```dotenv
OLLAMA_URL=http://192.168.1.10:11434/api/embed
MODEL=embeddinggemma-2:270m
```

### Index your journals

Mount your Markdown directory read-only and run the indexer using the same
image, settings, and persistent database volume as the server:

```sh
docker compose run --rm \
  -v /absolute/path/to/journals:/journals:ro \
  search-journal python index.py /journals
```

Then start the server:

```sh
docker compose up -d
docker compose logs -f
```

Connect your MCP client to `http://localhost:8000/mcp`. Index at least one
non-empty Markdown file before searching. Re-run the indexing command to update
changed files, keeping the same `/journals` mount path. Use the same embedding
model for indexing and searching; rebuild the index if you change models.

### Persistence and security

- The `journal-data` named volume stores `/data/index.db` and survives container
  replacement and `docker compose down`. `docker compose down -v` **deletes it**.
- The image runs as a non-root user (UID/GID 10001). If replacing the named volume
  with a host bind mount, make its directory writable by that user. An existing
  `index.db` can be placed there before starting the service.
- Journal files, local databases, `.env` files, and `.venv` are excluded from the
  image build context. The database contains journal text; treat it as private.
- Compose binds the unauthenticated MCP server only to `127.0.0.1`. Add an
  authenticated reverse proxy before exposing it to other machines.

## Configuration

| Variable | Local default | Docker default |
| --- | --- | --- |
| `OLLAMA_URL` | `http://localhost:11434/api/embed` | Compose: `http://127.0.0.1:11434/api/embed` |
| `MODEL` | `embeddinggemma-2:270m` | Same |
| `DATABASE_PATH` | `index.db`, relative to the source directory | `/data/index.db` |
| `HOST` | `127.0.0.1` | Compose: `127.0.0.1` (image alone: `0.0.0.0`) |
| `PORT` | `8000` | `8000` |

Without Docker, install dependencies with `uv sync --locked`, run
`uv run python index.py /path/to/journals`, then `uv run python main.py`.
Environment variables must be exported when running locally; `.env` is read by
Compose, not by the Python scripts.
