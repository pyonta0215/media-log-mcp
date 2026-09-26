// 旧形式(種別ごとの JSON 8ファイル)を、単一の台帳 media.json へ移行する。
//
//   node scripts/migrate.mjs --from <旧JSONのあるディレクトリ> --out <出力先>
//
// --out はローカルパスか s3://<bucket>/<key>。既存の台帳は上書きしない(新規作成のみ)。
// ID は「ファイル名+行番号+タイトル」から決定的に作るので、同じ入力なら何度流しても同じ ID になる。
// 旧ファイルはリポジトリから削除済み。取り出すには:
//   mkdir -p /tmp/legacy && git archive 9aa7ecc -- '*.json' ':!package*.json' | tar -x -C /tmp/legacy
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { recordSchema, stableId, compact } from "../lib/schema.mjs";
import { createStore } from "../lib/store.mjs";

const SOURCES = [
  { file: "books.json", type: "book", legacy: "bookmeter" },
  { file: "kindle-books.json", type: "book" },
  { file: "audiobooks.json", type: "audiobook" },
  { file: "movies.json", type: "movie" },
  { file: "anime.json", type: "anime" },
  { file: "dramas.json", type: "drama" },
  { file: "varieties.json", type: "variety" },
  { file: "games.json", type: "game" },
];

// 旧 status → 統一語彙。未設定は「読了・鑑賞済」とみなす(2026-09-25 本人確認済み)。
const STATUS_MAP = { played: "done", playing: "doing", tried: "tried", purchased: "owned" };
const mapStatus = (s) => {
  if (s === undefined || s === "") return "done";
  if (!(s in STATUS_MAP)) throw new Error(`未知の status: ${s}`);
  return STATUS_MAP[s];
};

// Amazon の商品ページURLから ASIN を取り出して externalId にする(重複判定キーになる)
const asinOf = (url) => url?.match(/amazon\.[^/]+\/(?:.*\/)?dp\/([A-Z0-9]{10})/)?.[1];

export function migrate(fromDir, at) {
  const out = [];
  const counts = {};
  for (const { file, type, legacy } of SOURCES) {
    const rows = JSON.parse(readFileSync(join(fromDir, file), "utf-8"));
    counts[file] = rows.length;
    rows.forEach((row, index) => {
      const base =
        legacy === "bookmeter"
          ? { title: row.t, creator: row.a, date: row.d === "日付不明" ? "" : row.d, review: row.r, image: row.i, url: row.u, source: "Bookmeter" }
          : { ...row };
      const asin = asinOf(base.url);
      const record = compact({
        id: stableId(type, `${file}\n${index}\n${base.title}`),
        type,
        ...base,
        status: mapStatus(base.status),
        externalId: base.externalId ?? (asin ? `amazon:asin:${asin}` : undefined),
        createdAt: at,
        updatedAt: at,
      });
      const r = recordSchema.safeParse(record);
      if (!r.success) throw new Error(`${file}[${index}] ${base.title}: ${r.error.issues.map((i) => `${i.path}: ${i.message}`).join(", ")}`);
      out.push(r.data);
    });
  }
  const ids = new Set(out.map((r) => r.id));
  if (ids.size !== out.length) throw new Error(`ID が衝突しました(${out.length}件中 ${ids.size}種)`);
  return { records: out, counts };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { from: { type: "string" }, out: { type: "string" }, at: { type: "string" } },
  });
  if (!values.from || !values.out) {
    console.error("usage: node scripts/migrate.mjs --from <dir> --out <path|s3://bucket/key> [--at ISO8601]");
    process.exit(2);
  }
  const { records, counts } = migrate(values.from, values.at ?? new Date().toISOString());
  const expected = Object.values(counts).reduce((a, b) => a + b, 0);
  if (records.length !== expected) throw new Error(`件数不一致: 入力 ${expected} / 出力 ${records.length}`);

  const byType = {};
  const byStatus = {};
  for (const r of records) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }
  console.error(JSON.stringify({ input: counts, total: records.length, byType, byStatus,
    withExternalId: records.filter((r) => r.externalId).length }, null, 1));

  await createStore(values.out).save({ version: 1, records }, null);
  console.error(`wrote ${records.length} records → ${values.out}`);
}
