import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { JournalDatabase } from "./journal";

const db = new JournalDatabase();
process.once("exit", () => db.close());

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "journal", version: "0.1.0" });

  server.registerTool(
    "search",
    {
      title: "Search Journal",
      description: "Search indexed journal passages by semantic similarity.",
      inputSchema: z.object({
        query: z
          .string()
          .trim()
          .min(1)
          .describe("Question or text to search for"),
        limit: z.number().int().min(1).max(10).default(5),
      }),

      outputSchema: z.object({
        results: z.array(
          z.object({
            id: z.string(),
            file: z.string(),
            chunk_index: z.number().int(),
            text: z.string(),
            distance: z.number(),
          }),
        ),
      }),

      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },

    async ({ query, limit }) => {
      let results;
      try {
        results = await db.search(query, limit);
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Journal search failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }

      const output = { results };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(output),
          },
        ],
        structuredContent: output,
      };
    },
  );

  return server;
});

const hostname = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "8000");
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("PORT must be an integer between 0 and 65535");
}

const httpServer = Bun.serve({
  hostname,
  port,
  // Embedding requests can take up to 60 seconds.
  idleTimeout: 120,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }
    // Browser origins are not needed by MCP clients. Reject cross-origin calls.
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) {
      return new Response("Forbidden origin", { status: 403 });
    }
    return handler.fetch(request);
  },
});

console.log(
  `Journal MCP server listening at ${new URL("/mcp", httpServer.url)}`,
);

async function shutdown() {
  await handler.close();
  await httpServer.stop(true);
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
