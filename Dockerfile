FROM oven/bun:1.3.13 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.13
WORKDIR /app

ENV HOST=0.0.0.0 \
    PORT=8000 \
    JOURNAL_DIR=/journal \
    JOURNAL_DB_PATH=/data/journal.sqlite

RUN mkdir /data && chown bun:bun /data
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json index.ts journal.ts embedFiles.ts ./

USER bun
EXPOSE 8000
CMD ["bun", "run", "index.ts"]
