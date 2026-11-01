import { homedir } from "node:os";
import { join } from "node:path";
import { JournalDatabase, embedText } from "./journal";
import type { Chunk, Embed } from "./journal";

export const journalDir =
  process.env.JOURNAL_DIR ?? join(homedir(), "notes", "Journal");

export const indexFile = async (
  file: string,
  embed: Embed = embedText,
): Promise<Chunk[]> => {
  const text = await Bun.file(file).text();
  const words = text.match(/\S+/g) ?? [];
  const wordsPerChunk = 512;
  const chunks: Chunk[] = [];

  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const chunk = words.slice(i, i + wordsPerChunk).join(" ");
    chunks.push({
      text: chunk,
      file,
      chunk_index: i / wordsPerChunk,
      embedding: await embed(chunk),
    });
  }

  return chunks;
};

export async function indexJournal(
  db: JournalDatabase,
  directory = journalDir,
  embed: Embed = embedText,
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
