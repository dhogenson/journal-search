import { afterEach, expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexFile, indexJournal } from "./embedFiles";
import { JournalDatabase } from "./journal";

const directories: string[] = [];
const databases: JournalDatabase[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "search-journal-"));
  directories.push(directory);
  return directory;
}

function openDatabase(path = ":memory:") {
  const db = new JournalDatabase(path);
  databases.push(db);
  return db;
}

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

const embed = async (text: string) => text.includes("hiking") ? [1, 0, 0] : [0, 1, 0];
const embedBatch = (texts: string[]) => Promise.all(texts.map(embed));

function chunk(file: string, text: string, embedding: number[], chunk_index = 0) {
  return { file, text, embedding, chunk_index };
}

test("chunk indexes stay integral for the final partial chunk", async () => {
  const file = join(await temporaryDirectory(), "entry.md");
  await Bun.write(file, Array(1200).fill("word").join(" "));
  const chunks = await indexFile(file, embedBatch);
  expect(chunks.map((item) => item.chunk_index)).toEqual([0, 1, 2]);
  expect(chunks.map((item) => item.text.split(" ").length)).toEqual([512, 512, 176]);
});

test("indexFile batches chunks and preserves text, indexes, and embedding order", async () => {
  const file = join(await temporaryDirectory(), "entry.md");
  await Bun.write(file, ["first", "second", "third", "fourth", "fifth"]
    .flatMap((word) => Array(512).fill(word)).join(" "));
  const calls: string[][] = [];
  const chunks = await indexFile(file, async (texts) => {
    calls.push(texts);
    return texts.map((text) => [text.length]);
  }, 2);
  expect(calls.map((texts) => texts.length)).toEqual([2, 2, 1]);
  expect(chunks.map((item) => item.chunk_index)).toEqual([0, 1, 2, 3, 4]);
  expect(chunks.map((item) => item.text.split(" ")[0])).toEqual([
    "first", "second", "third", "fourth", "fifth",
  ]);
  expect(chunks.every((item) => item.embedding[0] === item.text.length)).toBe(true);
});

test("empty files skip embedding; invalid batches and embedding failures reject", async () => {
  const file = join(await temporaryDirectory(), "entry.md");
  await Bun.write(file, "  \n ");
  const fail = async (): Promise<number[][]> => { throw new Error("Ollama unavailable"); };
  expect(await indexFile(file, fail)).toEqual([]);
  for (const size of [0, -1, 1.5, NaN, Infinity]) {
    await rejects(indexFile(file, fail, size), /positive integer/);
  }
  await Bun.write(file, "some text");
  await rejects(indexFile(file, fail), /Ollama unavailable/);
  await rejects(indexFile(file, async () => []), /Expected 1 embeddings, received 0/);
});

test("indexing sends arrays to Ollama with a default limit of 32 chunks", async () => {
  const file = join(await temporaryDirectory(), "entry.md");
  await Bun.write(file, Array(512 * 32 + 1).fill("word").join(" "));
  const calls: number[] = [];
  const ollama = Bun.serve({
    port: 0,
    async fetch(request) {
      expect(new URL(request.url).pathname).toBe("/api/embed");
      const body = await request.json() as { input: string[] };
      expect(Array.isArray(body.input)).toBe(true);
      calls.push(body.input.length);
      return Response.json({ embeddings: body.input.map(() => [1, 0, 0]) });
    },
  });
  try {
    // A subprocess ensures journal.ts reads the mock URL before module initialization.
    const process = Bun.spawn(["bun", "--eval", `
      import { indexFile } from "./embedFiles";
      const chunks = await indexFile(${JSON.stringify(file)});
      if (chunks.length !== 33) throw new Error("Missing chunks");
    `], {
      cwd: import.meta.dir,
      env: { ...Bun.env, OLLAMA_URL: ollama.url.toString() },
      stdout: "pipe", stderr: "pipe",
    });
    const stderr = await new Response(process.stderr).text();
    expect(await process.exited, stderr).toBe(0);
    expect(calls).toEqual([32, 1]);
  } finally {
    ollama.stop(true);
  }
});

test("indexing and semantic search return the nearest passage with its source", async () => {
  const directory = await temporaryDirectory();
  await Bun.write(join(directory, "hike.md"), "Went hiking in the mountains");
  await Bun.write(join(directory, "food.md"), "Cooked dinner");
  await Bun.write(join(directory, "ignore.txt"), "not a journal entry");
  const db = openDatabase();
  await indexJournal(db, directory, embedBatch);
  const results = await db.search("hiking outdoors", 1, embed);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    file: join(directory, "hike.md"), chunk_index: 0,
    text: "Went hiking in the mountains", distance: 0,
  });
  expect(typeof results[0]!.id).toBe("string");
});

test("re-indexing replaces old chunks and empty files remove their chunks", async () => {
  const db = openDatabase();
  db.saveFile("entry.md", [chunk("entry.md", "old", [1, 0, 0])]);
  db.saveFile("entry.md", [chunk("entry.md", "new", [0, 1, 0])]);
  expect((await db.search("dinner", 10, embed)).map((item) => item.text)).toEqual(["new"]);
  db.saveFile("entry.md", []);
  expect(await db.search("dinner", 5, embed)).toEqual([]);
});

test("a failed replacement rolls back both text and vectors", async () => {
  const db = openDatabase();
  db.saveFile("entry.md", [chunk("entry.md", "original", [1, 0, 0])]);
  expect(() => db.saveFile("entry.md", [chunk("entry.md", "invalid", [1, 0])])).toThrow();
  expect((await db.search("hiking", 5, embed)).map((item) => item.text)).toEqual(["original"]);
});

test("empty databases need no embedding request; embedding failures propagate", async () => {
  const db = openDatabase();
  const fail = async (): Promise<number[]> => { throw new Error("Ollama unavailable"); };
  expect(await db.search("hiking", 5, fail)).toEqual([]);
  db.saveFile("entry.md", [chunk("entry.md", "hiking", [1, 0, 0])]);
  await rejects(db.search("hiking", 5, fail), /Ollama unavailable/);
  await rejects(db.search(" ", 5, embed), /must not be empty/);
  await rejects(db.search("hiking", 0, embed), /Search limit/);
});

test("the MCP search tool queries the persisted index through Ollama", async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, "journal.sqlite");
  const db = new JournalDatabase(path);
  db.saveFile("hike.md", [chunk("hike.md", "Went hiking", [1, 0, 0])]);
  db.close();

  const ollama = Bun.serve({
    port: 0,
    async fetch(request) {
      expect(new URL(request.url).pathname).toBe("/api/embed");
      const body = await request.json() as { input: string; model: string };
      expect(body.model).toBe("test-model");
      return Response.json({ embeddings: [await embed(body.input)] });
    },
  });
  const process = Bun.spawn(["bun", "run", "index.ts"], {
    cwd: import.meta.dir,
    env: {
      ...Bun.env, HOST: "127.0.0.1", PORT: "0",
      JOURNAL_DB_PATH: path, OLLAMA_URL: ollama.url.toString(), EMBEDDING_MODEL: "test-model",
    },
    stdout: "pipe", stderr: "pipe",
  });
  const timeout = setTimeout(() => process.kill(), 10_000);
  try {
    const reader = process.stdout.getReader();
    let output = "";
    let endpoint: string | undefined;
    while (!endpoint) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`MCP server failed to start: ${await new Response(process.stderr).text()}`);
      output += new TextDecoder().decode(value);
      endpoint = output.match(/listening at (http:\/\/[^\s]+)/)?.[1];
    }
    reader.releaseLock();

    const rpc = (message: object) => fetch(endpoint!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-03-26",
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(5000),
    });
    const readMessage = async (response: Response) => {
      expect(response.status).toBe(200);
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        const body = await response.text();
        const data = body.split("\n").find((line) => line.startsWith("data:"));
        if (!data) throw new Error(`No MCP response in stream: ${body}`);
        return JSON.parse(data.slice(5));
      }
      return response.json();
    };

    const initialized = await readMessage(await rpc({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    }));
    expect(initialized.result.serverInfo.name).toBe("journal");
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);

    const tools = await readMessage(await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    expect(tools.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["search"]);

    const message = await readMessage(await rpc({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "search", arguments: { query: "hiking", limit: 1 } },
    }));
    expect(message.error).toBeUndefined();
    expect(message.result.isError).not.toBe(true);
    expect(message.result.structuredContent.results).toEqual([
      { id: "1", file: "hike.md", chunk_index: 0, text: "Went hiking", distance: 0 },
    ]);

    const invalid = await readMessage(await rpc({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "search", arguments: { query: "hiking", limit: 11 } },
    }));
    expect(Boolean(invalid.error || invalid.result?.isError)).toBe(true);
    expect((await fetch(new URL("/missing", endpoint))).status).toBe(404);
    expect((await fetch(endpoint, { headers: { Origin: "https://untrusted.example" } })).status).toBe(403);
    expect((await fetch(endpoint)).status).toBe(405);
  } finally {
    clearTimeout(timeout);
    process.kill();
    await process.exited;
    ollama.stop(true);
  }
}, 15_000);
