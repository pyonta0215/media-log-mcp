import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "../lib/runtime.mjs";
import { FileStore, ConflictError } from "../lib/store.mjs";
import { identityKeys, isbn13to10 } from "../lib/schema.mjs";

let path, rt;
const seed = [
  { id: "bk_0000000001", type: "book", title: "HUNTER×HUNTER 39 (ジャンプコミックス)", creator: "冨樫 義博", externalId: "amazon:asin:4088851749", status: "done", createdAt: "x", updatedAt: "x" },
  { id: "mv_0000000001", type: "movie", title: "ズートピア", creator: "バイロン・ハワード", status: "done", favoriteRank: 1, createdAt: "x", updatedAt: "x" },
];
const realFetch = globalThis.fetch;

beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), "media-log-")), "media.json");
  writeFileSync(path, JSON.stringify({ version: 1, records: seed }));
  rt = createRuntime(path);
  process.env.GOOGLE_BOOKS_API_KEY = "test-key";
  process.env.TMDB_API_KEY = "test-key";
});
afterEach(() => { globalThis.fetch = realFetch; });

// URL の部分一致で応答を返す偽の fetch
function fakeFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const hit = Object.entries(routes).find(([k]) => String(url).includes(k));
    if (!hit) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: 200 });
  };
  return calls;
}

const saved = () => JSON.parse(readFileSync(path, "utf-8")).records;

test("ISBN-13 と Amazon ASIN(ISBN-10) を同じ本として扱う", () => {
  assert.equal(isbn13to10("9784088851747"), "4088851749");
  assert.equal(isbn13to10("9794088851747"), null);
  const a = identityKeys("isbn:9784088851747");
  const b = identityKeys("amazon:asin:4088851749");
  assert.ok(a.some((k) => b.includes(k)));
});

test("手入力で登録でき、ファイルに保存される", async () => {
  const r = await rt.service.add({ type: "game", title: "ピクミン4", status: "done", date: "2023-07-21" });
  assert.equal(r.added, true);
  assert.match(r.record.id, /^gm_[0-9a-f]{10}$/);
  assert.equal(saved().length, 3);
});

test("externalId から title/creator/url/image を補完し、本人の入力を優先する", async () => {
  fakeFetch({
    "/movie/129": { id: 129, title: "千と千尋の神隠し", original_title: "千と千尋の神隠し", release_date: "2001-07-20", poster_path: "/p.jpg",
      credits: { crew: [{ job: "Director", name: "宮崎駿" }, { job: "Producer", name: "鈴木敏夫" }] } },
  });
  const r = await rt.service.add({ type: "movie", externalId: "tmdb:movie:129", status: "done", review: "何度でも観られる", title: "千と千尋の神隠し (千尋)" });
  assert.equal(r.record.title, "千と千尋の神隠し (千尋)"); // 本人の入力が優先
  assert.equal(r.record.creator, "宮崎駿");
  assert.equal(r.record.image, "https://image.tmdb.org/t/p/w342/p.jpg");
  assert.equal(r.record.url, "https://www.themoviedb.org/movie/129");
});

test("Google Books の ISBN が既存の Amazon ASIN と一致したら重複として登録しない", async () => {
  fakeFetch({ "q=isbn:9784088851747": { items: [{ id: "vol1", volumeInfo: { title: "HUNTER×HUNTER 39", authors: ["冨樫義博"],
    industryIdentifiers: [{ type: "ISBN_13", identifier: "9784088851747" }] } }] } });
  const r = await rt.service.add({ type: "book", externalId: "isbn:9784088851747", status: "done" });
  assert.equal(r.added, false);
  assert.equal(r.duplicate.id, "bk_0000000001");
  assert.equal(saved().length, 2); // 保存されていない
});

test("同種別・同タイトル(全角半角や空白の違いを無視)は重複として扱う", async () => {
  const r = await rt.service.add({ type: "movie", title: "ｽﾞｰﾄﾋﾟｱ" });
  assert.equal(r.added, false);
  const r2 = await rt.service.add({ type: "book", title: "ズートピア" }); // 種別が違えば別物
  assert.equal(r2.added, true);
});

test("discover は候補を返すだけで保存せず、台帳にあるものに印を付ける", async () => {
  fakeFetch({ "books/v1/volumes?q=": { items: [
    { id: "a", volumeInfo: { title: "HUNTER×HUNTER 39", authors: ["冨樫義博"], industryIdentifiers: [{ type: "ISBN_13", identifier: "9784088851747" }],
      imageLinks: { thumbnail: "http://books.google.com/x" } } },
    { id: "b", volumeInfo: { title: "HUNTER×HUNTER 40", authors: ["冨樫義博"] } },
  ] } });
  const before = readFileSync(path, "utf-8");
  const c = await rt.service.discover({ type: "book", query: "HUNTER×HUNTER" });
  assert.equal(c.length, 2);
  assert.equal(c[0].alreadyRecorded.id, "bk_0000000001");
  assert.equal(c[0].image, "https://books.google.com/x"); // http → https
  assert.equal(c[0].url, "https://www.amazon.co.jp/dp/4088851749");
  assert.equal(c[1].alreadyRecorded, undefined);
  assert.equal(c[1].externalId, "googlebooks:volume:b");
  assert.equal(readFileSync(path, "utf-8"), before);
});

test("Provider が無い種別の discover は手入力を案内する", async () => {
  await assert.rejects(rt.service.discover({ type: "game", query: "x" }), /手入力/);
});

test("APIキー未設定は分かるメッセージで失敗し、キーをエラーに含めない", async () => {
  delete process.env.TMDB_API_KEY;
  await assert.rejects(rt.service.discover({ type: "movie", query: "x" }), /TMDB_API_KEY が未設定/);
  process.env.TMDB_API_KEY = "secret-xyz";
  fakeFetch({});
  await assert.rejects(rt.service.discover({ type: "movie", query: "x" }), (e) => !e.message.includes("secret-xyz") && /404/.test(e.message));
});

test("update は指定項目だけ変え、null で項目を消す", async () => {
  const r = await rt.service.update("mv_0000000001", { review: "何度観ても良い", favoriteRank: null });
  assert.equal(r.record.review, "何度観ても良い");
  assert.equal(r.record.favoriteRank, undefined);
  assert.equal(r.record.title, "ズートピア");
  assert.notEqual(r.record.updatedAt, "x");
  assert.equal(saved().find((x) => x.id === "mv_0000000001").review, "何度観ても良い");
});

test("不正な入力は保存前に弾く", async () => {
  await assert.rejects(rt.service.update("mv_0000000001", { status: "watched" }), /status/);
  await assert.rejects(rt.service.update("mv_0000000001", { title: null }), /title/);
  await assert.rejects(rt.service.update("mv_0000000001", { unknownField: 1 }), /InputError|unknownField|Unrecognized/);
  await assert.rejects(rt.service.update("nope", { review: "x" }), /id=nope/);
  await assert.rejects(rt.service.add({ type: "movie" }), /title/);
  assert.equal(saved().length, 2);
});

test("delete は1件だけ消して対象を返す", async () => {
  const r = await rt.service.remove("mv_0000000001");
  assert.equal(r.record.title, "ズートピア");
  assert.deepEqual(saved().map((x) => x.id), ["bk_0000000001"]);
});

test("別の入口が先に書き込んでいたら、最新を読み直して両方の変更を残す", async () => {
  const other = createRuntime(path); // Web UI など別プロセス相当
  await rt.service.all();            // rt は古い状態をキャッシュ
  await other.service.add({ type: "game", title: "別の入口から登録" });
  await rt.service.update("mv_0000000001", { review: "こちらの変更" });
  const titles = saved().map((x) => x.title);
  assert.ok(titles.includes("別の入口から登録"));
  assert.equal(saved().find((x) => x.id === "mv_0000000001").review, "こちらの変更");
});

test("読み取りは他の入口の書き込みをすぐに反映する", async () => {
  const other = createRuntime(path);
  assert.equal((await rt.service.search({ keyword: "反映" })).length, 0);
  await other.service.add({ type: "game", title: "反映テスト" });
  assert.equal((await rt.service.search({ keyword: "反映" })).length, 1);
});

test("FileStore は古い ETag での保存を拒否する", async () => {
  const s = new FileStore(path);
  const { etag } = await s.load();
  await s.save({ version: 1, records: [] }, etag);
  await assert.rejects(s.save({ version: 1, records: [] }, etag), ConflictError);
  await assert.rejects(s.save({ version: 1, records: [] }, null), ConflictError); // 既存があれば新規作成しない
});

test("読み込みと保存の間に割り込まれたら、競合を検出して再適用する", async () => {
  const other = createRuntime(path);
  const origSave = rt.store.save.bind(rt.store);
  let interfered = false;
  rt.store.save = async (data, etag) => {
    if (!interfered) { interfered = true; await other.service.add({ type: "game", title: "割り込み" }); }
    return origSave(data, etag);
  };
  await rt.service.update("mv_0000000001", { review: "競合後も残る" });
  const recs = saved();
  assert.ok(recs.some((x) => x.title === "割り込み"), "割り込んだ登録が消えていない");
  assert.equal(recs.find((x) => x.id === "mv_0000000001").review, "競合後も残る");
});
