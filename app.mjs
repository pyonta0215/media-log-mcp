import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./mcp-server.mjs";
import { defaultStore, MEDIA_TYPES } from "./media-store.mjs";
import { requireAuth } from "./auth.mjs";
import { randomUUID } from "node:crypto";

const MCP_PATH = process.env.MCP_PATH || "/mcp";
const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static(new URL("./public", import.meta.url).pathname));
app.get("/health", (_req, res) => res.json({ ok: true }));

const stringFields = ["title", "creator", "date", "review", "image", "url", "platform", "status"];
function validate(input, partial = false) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Object.assign(new Error("JSON object required"), { status: 400 });
  const allowed = new Set(["type", ...stringFields, "favoriteRank", "hours", "episodes", "progress", "dateLast", "purchasedDate", "source"]);
  for (const key of Object.keys(input)) if (!allowed.has(key) || key === "id") throw Object.assign(new Error(`Unknown or immutable field: ${key}`), { status: 400 });
  if (!partial && (!input.type || !input.title)) throw Object.assign(new Error("type and title are required"), { status: 400 });
  if (input.type !== undefined && !MEDIA_TYPES.includes(input.type)) throw Object.assign(new Error("Invalid type"), { status: 400 });
  for (const key of stringFields) if (input[key] !== undefined && (typeof input[key] !== "string" || input[key].length > 10000)) throw Object.assign(new Error(`Invalid ${key}`), { status: 400 });
  for (const key of ["title", "creator"]) if (input[key] !== undefined && input[key].length > 500) throw Object.assign(new Error(`Invalid ${key}`), { status: 400 });
  for (const key of ["url", "image"]) if (input[key]) {
    try { if (!/^https?:$/i.test(new URL(input[key]).protocol)) throw new Error(); }
    catch { throw Object.assign(new Error(`Invalid ${key} URL`), { status: 400 }); }
  }
  return input;
}
const auth = requireAuth();
app.use("/api", auth);
app.get("/api/media", async (req, res, next) => {
  try {
    const { records } = await defaultStore.get();
    const keyword = String(req.query.keyword ?? "").toLowerCase().normalize("NFKC");
    const type = req.query.type;
    if (type && !MEDIA_TYPES.includes(type)) return res.status(400).json({ error: "Invalid type" });
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? "20", 10) || 20, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset ?? "0", 10) || 0, 0);
    const filtered = records.filter((m) => (!type || m.type === type) && (!keyword || `${m.title} ${m.creator}`.toLowerCase().normalize("NFKC").includes(keyword)));
    res.json({ count: filtered.length, media: filtered.slice(offset, offset + limit), limit, offset });
  } catch (e) { next(e); }
});
app.get("/api/media/:id", async (req, res, next) => {
  try { const { records } = await defaultStore.get(); const record = records.find((m) => m.id === req.params.id); return record ? res.json(record) : res.status(404).json({ error: "Not found" }); } catch (e) { next(e); }
});
async function mutate(req, res, next, operation) {
  try {
    const current = await defaultStore.get();
    const result = operation(current.records);
    await defaultStore.save(result, current.etag);
    res.status(req.method === "POST" ? 201 : 200).json(req.created ?? result);
  } catch (e) { next(e); }
}
app.post("/api/media", (req, res, next) => {
  try {
    const value = validate(req.body);
    req.created = { ...value, id: randomUUID() };
    return mutate(req, res, next, (records) => [...records, req.created]);
  } catch (e) { next(e); }
});
app.patch("/api/media/:id", (req, res, next) => {
  try {
    const value = validate(req.body, true);
    return mutate(req, res, next, (records) => {
      const index = records.findIndex((m) => m.id === req.params.id);
      if (index < 0) throw Object.assign(new Error("Not found"), { status: 404 });
      const updated = { ...records[index], ...value, id: records[index].id };
      req.created = updated;
      return records.toSpliced(index, 1, updated);
    });
  } catch (e) { next(e); }
});
app.delete("/api/media/:id", (req, res, next) => mutate(req, res, next, (records) => {
  if (!records.some((m) => m.id === req.params.id)) throw Object.assign(new Error("Not found"), { status: 404 });
  return records.filter((m) => m.id !== req.params.id);
}));

app.post(MCP_PATH, auth, async (req, res) => {
  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP request failed:", e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});
const methodNotAllowed = (_req, res) => res.status(405).set("Allow", "POST").json({ error: "Method not allowed" });
app.get(MCP_PATH, methodNotAllowed);
app.delete(MCP_PATH, methodNotAllowed);
app.use((error, _req, res, _next) => { console.error(error); res.status(error.status || 500).json({ error: error.status ? error.message : "Internal server error" }); });
app.use((_req, res) => res.status(404).json({ error: "Not Found" }));
export { app };
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) app.listen(process.env.PORT || 3000, () => console.error(`media-log-mcp listening on http://localhost:${process.env.PORT || 3000}`));
