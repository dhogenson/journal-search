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
./index.sh /path/to/journals
```

Relative paths are supported. Quote paths containing spaces, for example:

```sh
./index.sh "~/Documents/My Journals"
```

Run `./index.sh --help` for usage. The script validates the folder and mounts it
read-only at `/journals` inside the container.

Then start the server:

```sh
docker compose up -d
docker compose logs -f
```

Connect your MCP client to `http://localhost:8000/mcp`. Index at least one
non-empty Markdown file before searching. Re-run the indexing command to update
changed files, keeping the same `/journals` mount path. Use the same embedding
model for indexing and searching; rebuild the index if you change models.

### LAN access

The default Compose configuration only accepts connections from the Docker
host. To allow other machines on your LAN, change `HOST` in
`docker-compose.yaml`:

```yaml
    environment:
      HOST: 0.0.0.0
```

Recreate the container to apply the change:

```sh
docker compose up -d --force-recreate
```

LAN clients can then connect to `http://<server-lan-ip>:8000/mcp`. Because
Compose uses host networking, no `ports:` mapping is needed. If your host has a
firewall, allow TCP port 8000 only from the intended clients. Ollama can remain
bound to localhost; it does not need to be exposed to the LAN.

Setting `HOST` in `.env` alone does not enable LAN access: the current Compose
file hardcodes it to `127.0.0.1`.

### Persistence and security

- The `journal-data` named volume stores `/data/index.db` and survives container
  replacement and `docker compose down`. `docker compose down -v` **deletes it**.
- The image runs as a non-root user (UID/GID 10001). If replacing the named volume
  with a host bind mount, make its directory writable by that user. An existing
  `index.db` can be placed there before starting the service.
- Journal files, local databases, `.env` files, and `.venv` are excluded from the
  image build context. The database contains journal text; treat it as private.
- Compose binds the MCP server only to `127.0.0.1` by default. The server has no
  authentication and returns private journal content. Put an authenticated
  reverse proxy in front of it before allowing access from other machines, and
  restrict direct access to port 8000 to that proxy. Do not expose the
  unauthenticated endpoint to the internet.

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
