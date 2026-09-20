import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MEDIA_TYPES, defaultStore, loadLocalMedia } from "./media-store.mjs";

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFKC");
const typeSchema = z.enum(MEDIA_TYPES).optional();
export const media = process.env.S3_BUCKET ? [] : await loadLocalMedia();

export function createServer(store = defaultStore) {
  const server = new McpServer({ name: "media-log-mcp", version: "0.3.0" });
  const records = async (type) => {
    const list = (await store.get()).records;
    return type ? list.filter((m) => m.type === type) : list;
  };
  server.registerTool("search_media", {
    title: "メディア記録検索",
    description: "タイトル・作者のキーワードでメディア記録を検索する。type未指定なら全種別を横断検索",
    inputSchema: { keyword: z.string(), type: typeSchema, limit: z.number().default(20) },
  }, async ({ keyword, type, limit }) => {
    const hits = (await records(type)).filter((m) => norm(`${m.title} ${m.creator}`).includes(norm(keyword))).slice(0, limit);
    return { content: [{ type: "text", text: JSON.stringify({ count: hits.length, media: hits }, null, 2) }] };
  });
  server.registerTool("media_by_creator", {
    title: "作者別メディア一覧",
    description: "指定した作者の記録を全件返す",
    inputSchema: { creator: z.string(), type: typeSchema },
  }, async ({ creator, type }) => {
    const hits = (await records(type)).filter((m) => norm(m.creator).includes(norm(creator)));
    return { content: [{ type: "text", text: JSON.stringify({ count: hits.length, media: hits }, null, 2) }] };
  });
  server.registerTool("media_stats", {
    title: "メディア統計",
    description: "総件数・種別内訳・感想を書いた数・作者別トップN・年別件数を集計する",
    inputSchema: { type: typeSchema, topCreators: z.number().default(10) },
  }, async ({ type, topCreators }) => {
    const list = await records(type), typeCounts = new Map(), creatorCounts = new Map(), yearCounts = new Map();
    let reviewed = 0;
    for (const m of list) {
      typeCounts.set(m.type, (typeCounts.get(m.type) ?? 0) + 1);
      if (m.review) reviewed++;
      const creator = m.creator || "不明";
      creatorCounts.set(creator, (creatorCounts.get(creator) ?? 0) + 1);
      const year = typeof m.date === "string" ? (m.date.match(/\d{4}/)?.[0] ?? "不明") : "不明";
      yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
    }
    const topCreatorsList = [...creatorCounts].sort((a, b) => b[1] - a[1]).slice(0, topCreators).map(([creator, count]) => ({ creator, count }));
    const byYear = [...yearCounts].sort((a, b) => a[0] === "不明" ? 1 : b[0] === "不明" ? -1 : a[0].localeCompare(b[0])).map(([year, count]) => ({ year, count }));
    return { content: [{ type: "text", text: JSON.stringify({ totalRecords: list.length, byType: Object.fromEntries(typeCounts), withReview: reviewed, withoutReview: list.length - reviewed, topCreators: topCreatorsList, byYear }, null, 2) }] };
  });
  return server;
}
