// リモート版(Streamable HTTP)の Express アプリ。
// AWS Lambda(lambda.mjs 経由)でも、ローカル単体(node app.mjs)でも動く。
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./mcp-server.mjs";
import { createRuntime, loadLocalConfig } from "./lib/runtime.mjs";

// ローカル単体起動時だけ設定ファイルを読む(Lambda では環境変数で渡す)
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) loadLocalConfig();

// リポジトリはモジュールスコープに置き、warm な Lambda ではメモリ上の台帳を使い回す
// (リクエストごとに ETag で鮮度だけ確認する)。リモート版は読み取り専用。
const { service } = createRuntime();

// MCP エンドポイントのパス。本番では推測困難なランダムパスを環境変数で渡す(URL秘匿)。
// コードにはハードコードしない(public リポジトリに実パスを出さないため)。
const MCP_PATH = process.env.MCP_PATH || "/mcp";

const app = express();

// ヘルスチェック(疎通確認用・任意)
app.get("/health", (_req, res) => res.json({ ok: true }));

// MCP 本体: リクエストごとに server + transport を新規生成する stateless 構成。
// sessionIdGenerator を持たず、enableJsonResponse で単一JSONを即応(Lambda buffered 応答に最適)。
app.post(MCP_PATH, express.json(), async (req, res) => {
  try {
    const server = createServer({ service, writable: false });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP request failed:", e);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// stateless なのでセッション系メソッド(GET/DELETE)は不要 → 405
const methodNotAllowed = (_req, res) =>
  res
    .status(405)
    .set("Allow", "POST")
    .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
app.get(MCP_PATH, methodNotAllowed);
app.delete(MCP_PATH, methodNotAllowed);

// 未定義ルートは明示的に404で返す(finalhandler を経由させないことで、
// serverless-express のモックsocketと on-finished の非互換を回避する)
app.use((_req, res) => res.status(404).json({ error: "Not Found" }));

export { app };

// ローカル起動(Lambda 実行環境では AWS_LAMBDA_FUNCTION_NAME がセットされ、この分岐は通らない)
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.error(`media-log-mcp (remote) listening on http://localhost:${port}${MCP_PATH}`);
  });
}
