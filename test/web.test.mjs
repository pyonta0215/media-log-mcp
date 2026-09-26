import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "media-log-web-"));
const path = join(dir, "media.json");
writeFileSync(path, JSON.stringify({ version: 1, records: [
  { id: "mv_0000000001", type: "movie", title: "ズートピア", status: "done", createdAt: "x", updatedAt: "x" },
] }));
process.env.MEDIA_STORE = path;
process.env.MEDIA_LOG_ENV = join(dir, "no-config");
const { app } = await import("../web.mjs");

let server, base;
before(() => new Promise((r) => { server = app.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => server.close());

const json = { "Content-Type": "application/json", "X-Media-Log": "1" };

test("一覧を返す", async () => {
  const res = await fetch(`${base}/api/media`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).records.length, 1);
});

test("localhost 以外の Host は拒否する(DNSリバインディング対策)", async () => {
  const http = await import("node:http");
  const status = await new Promise((resolve) => {
    http.get(`${base}/api/media`, { headers: { Host: "evil.example.com" } }, (res) => resolve(res.statusCode));
  });
  assert.equal(status, 403);
});

test("独自ヘッダの無い書き込みは拒否する(CSRF対策)", async () => {
  const form = await fetch(`${base}/api/media`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "type=game&title=x" });
  assert.equal(form.status, 403);
  const noHeader = await fetch(`${base}/api/media/mv_0000000001`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(noHeader.status, 403);
  assert.equal(JSON.parse(readFileSync(path, "utf-8")).records.length, 1);
});

test("登録・更新・削除が通り、入力ミスは400で返る", async () => {
  const add = await (await fetch(`${base}/api/media`, { method: "POST", headers: json, body: JSON.stringify({ type: "game", title: "テスト" }) })).json();
  assert.equal(add.added, true);
  const upd = await fetch(`${base}/api/media/${add.record.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ review: "良い" }) });
  assert.equal((await upd.json()).record.review, "良い");
  const bad = await fetch(`${base}/api/media/${add.record.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ status: "watched" }) });
  assert.equal(bad.status, 400);
  const del = await fetch(`${base}/api/media/${add.record.id}`, { method: "DELETE", headers: json, body: "{}" });
  assert.equal(del.status, 200);
  assert.equal(JSON.parse(readFileSync(path, "utf-8")).records.length, 1);
});
