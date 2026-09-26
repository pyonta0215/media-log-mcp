// ローカル(Claude Desktop / Claude Code)向けの stdio トランスポート起動。
// ツール定義は mcp-server.mjs に集約し、リモート版(app.mjs)と共有する。
// ローカルは自分のPC上でしか動かないため、書き込み系ツールも有効にする(MEDIA_LOG_READONLY=1 で無効化)。
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./mcp-server.mjs";
import { loadLocalConfig, createRuntime } from "./lib/runtime.mjs";

async function main() {
  loadLocalConfig();
  const { service } = createRuntime();
  const server = createServer({ service, writable: process.env.MEDIA_LOG_READONLY !== "1" });
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
