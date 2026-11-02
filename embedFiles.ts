import { homedir } from "node:os";
import { join } from "node:path";
import { JournalDatabase, embedTexts } from "./journal";
import type { Chunk, EmbedBatch } from "./journal";

export const journalDir =
  process.env.JOURNAL_DIR ?? join(homedir(), "notes", "Journal");

export const indexFile = async (
  file: string,
  embed: EmbedBatch = embedTexts,
  batchSize = 32,
): Promise<Chunk[]> => {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("Embedding batch size must be a positive integer");
  }
  const text = await Bun.file(file).text();
  const words = text.match(/\S+/g) ?? [];
  const wordsPerChunk = 512;
  const chunks: Chunk[] = [];

  for (let i = 0; i < words.length; i += wordsPerChunk * batchSize) {
    const texts: string[] = [];
    const end = Math.min(i + wordsPerChunk * batchSize, words.length);
    for (let j = i; j < end; j += wordsPerChunk) {
      texts.push(words.slice(j, j + wordsPerChunk).join(" "));
    }
    const embeddings = await embed(texts);
    if (embeddings.length !== texts.length) {
      throw new Error(`Expected ${texts.length} embeddings, received ${embeddings.length}`);
    }
    for (let j = 0; j < texts.length; j++) {
      chunks.push({
        text: texts[j]!,
        file,
        chunk_index: i / wordsPerChunk + j,
        embedding: embeddings[j]!,
      });
    }
  }

  return chunks;
};

export async function indexJournal(
  db: JournalDatabase,
  directory = journalDir,
  embed: EmbedBatch = embedTexts,
): Promise<void> {
  const glob = new Bun.Glob("**/*.md");
  for await (const file of glob.scan({
    cwd: directory,
    absolute: true,
    onlyFiles: true,
  })) {
    const chunks = await indexFile(file, embed);
    db.saveFile(file, chunks);
    console.error(`Indexed ${file}: ${chunks.length} chunks`);
  }
}

if (import.meta.main) {
  const db = new JournalDatabase();
  try {
    await indexJournal(db);
  } finally {
    db.close();
  }
}
