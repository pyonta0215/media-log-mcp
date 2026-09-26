// 台帳のローカル Web UI(一覧・検索・手動修正・画像確認・候補からの登録)。
//
//   node web.mjs   → http://127.0.0.1:4319
//
// 自分のPCだけで動かす前提で認証は持たない。その代わり:
//   - 127.0.0.1 でしか待ち受けない
//   - Host ヘッダが localhost 系でなければ拒否(DNSリバインディング対策)
//   - 書き込み系は独自ヘッダ X-Media-Log と JSON を必須にする(他サイトからのフォーム送信=CSRF対策。
//     独自ヘッダ付きのクロスオリジン要求はプリフライトで止まり、このサーバーは CORS を許可しない)
// 業務ロジックは MCP と同じ lib/service.mjs を呼ぶ。
import express from "express";
import { fileURLToPath } from "node:url";
import { loadLocalConfig, createRuntime } from "./lib/runtime.mjs";
import { MEDIA_TYPES, STATUSES, STATUS_LABELS } from "./lib/schema.mjs";

loadLocalConfig();
const { service, store } = createRuntime();
const PORT = Number(process.env.MEDIA_LOG_WEB_PORT || 4319);
const HOST = "127.0.0.1";

export const app = express();
app.disable("x-powered-by");

app.use((req, res, next) => {
  const host = (req.headers.host || "").replace(/:\d+$/, "");
  if (!["127.0.0.1", "localhost"].includes(host)) return res.status(403).json({ error: "Forbidden host" });
  next();
});

app.use("/api", (req, res, next) => {
  if (req.method === "GET") return next();
  if (req.headers["x-media-log"] !== "1" || !req.is("application/json")) {
    return res.status(403).json({ error: "書き込み要求には X-Media-Log ヘッダと JSON 本文が必要です" });
  }
  next();
});
app.use(express.json({ limit: "256kb" }));

const STATUS_BY_ERROR = { InputError: 400, ProviderError: 502, ConflictError: 409, NotFoundError: 500 };
const route = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    const status = STATUS_BY_ERROR[e.name] ?? 500;
    if (status === 500) console.error(e);
    res.status(status).json({ error: STATUS_BY_ERROR[e.name] ? e.message : "内部エラーが発生しました" });
  }
};

app.get("/api/meta", route(async () => ({ types: MEDIA_TYPES, statuses: STATUSES, statusLabels: STATUS_LABELS, store: store.describe })));
app.get("/api/media", route(async () => ({ records: await service.all() })));
app.get("/api/discover", route((req) => service.discover({ type: req.query.type, query: String(req.query.query ?? ""), limit: 8 })));
app.post("/api/media", route((req) => service.add(req.body)));
app.patch("/api/media/:id", route((req) => service.update(req.params.id, req.body)));
app.delete("/api/media/:id", route((req) => service.remove(req.params.id)));

app.use(express.static(fileURLToPath(new URL("./web/", import.meta.url)), { index: "index.html" }));
app.use((_req, res) => res.status(404).json({ error: "Not Found" }));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, HOST, () => console.error(`media-log web: http://${HOST}:${PORT}  (store: ${store.describe})`));
}
