import { Database } from "bun:sqlite";
import { join } from "node:path";
import * as sqliteVec from "sqlite-vec";
import { z } from "zod";

export const databasePath =
  process.env.JOURNAL_DB_PATH ?? join(import.meta.dir, "journal.sqlite");
const embeddingModel = process.env.EMBEDDING_MODEL ?? "embeddinggemma-2:270m";
const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";

export interface Chunk {
  text: string;
  file: string;
  chunk_index: number;
  embedding: number[];
}

export interface SearchResult {
  id: string;
  file: string;
  chunk_index: number;
  text: string;
  distance: number;
}

export type Embed = (text: string) => Promise<number[]>;
export type EmbedBatch = (texts: string[]) => Promise<number[][]>;

const embedResponseSchema = z.object({
  embeddings: z.array(z.array(z.number()).min(1)).min(1),
});

async function requestEmbeddings(input: string | string[]): Promise<number[][]> {
  const response = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embeddingModel, input }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed: ${response.status}`);
  }

  const result = embedResponseSchema.parse(await response.json());
  const expected = typeof input === "string" ? 1 : input.length;
  if (result.embeddings.length !== expected) {
    throw new Error(`Expected ${expected} embeddings, received ${result.embeddings.length}`);
  }
  return result.embeddings;
}

export const embedText: Embed = async (text) => (await requestEmbeddings(text))[0]!;

export const embedTexts: EmbedBatch = async (texts) =>
  texts.length ? requestEmbeddings(texts) : [];

export class JournalDatabase {
  private readonly db: Database;

  constructor(path = databasePath) {
    this.db = new Database(path, { create: true });
    sqliteVec.load(this.db);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY,
        file TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL
      )
    `);
  }

  private hasVectors(): boolean {
    return (
      this.db
        .query("SELECT 1 FROM sqlite_master WHERE name = 'chunk_vectors'")
        .get() !== null
    );
  }

  saveFile(file: string, chunks: Chunk[]): void {
    const firstChunk = chunks[0];
    if (firstChunk) {
      const dimensions = firstChunk.embedding.length;
      if (
        !dimensions ||
        chunks.some((chunk) => chunk.embedding.length !== dimensions)
      ) {
        throw new Error(
          "Chunks must have nonempty embeddings with matching dimensions",
        );
      }
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
          embedding float[${dimensions}] distance_metric=cosine
        )
      `);
    }

    const hasVectors = this.hasVectors();
    this.db.transaction(() => {
      if (hasVectors) {
        this.db.run(
          `DELETE FROM chunk_vectors
           WHERE rowid IN (SELECT id FROM chunks WHERE file = ?)`,
          [file],
        );
      }
      this.db.run("DELETE FROM chunks WHERE file = ?", [file]);

      if (!chunks.length) return;
      const insertChunk = this.db.prepare(`
        INSERT INTO chunks (file, chunk_index, text) VALUES (?, ?, ?)
      `);
      const insertVector = this.db.prepare(`
        INSERT INTO chunk_vectors (rowid, embedding) VALUES (?, ?)
      `);
      for (const chunk of chunks) {
        const result = insertChunk.run(file, chunk.chunk_index, chunk.text);
        insertVector.run(
          result.lastInsertRowid,
          new Float32Array(chunk.embedding),
        );
      }
    })();
  }

  async search(
    query: string,
    limit = 5,
    embed: Embed = embedText,
  ): Promise<SearchResult[]> {
    if (!query.trim()) throw new Error("Search query must not be empty");
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw new Error("Search limit must be an integer between 1 and 10");
    }
    if (
      !this.hasVectors() ||
      !this.db.query("SELECT 1 FROM chunks LIMIT 1").get()
    ) {
      return [];
    }

    const embedding = await embed(query);
    return this.db
      .query<SearchResult, [Float32Array, number]>(
        `
      SELECT CAST(chunks.id AS TEXT) AS id, chunks.file, chunks.chunk_index,
             chunks.text, nearest.distance
      FROM (
        SELECT rowid, distance
        FROM chunk_vectors
        WHERE embedding MATCH ? AND k = ?
      ) AS nearest
      JOIN chunks ON chunks.id = nearest.rowid
      ORDER BY nearest.distance
    `,
      )
      .all(new Float32Array(embedding), limit);
  }

  close(): void {
    this.db.close();
  }
}
