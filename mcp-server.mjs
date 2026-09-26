// メディア台帳(本・映画・アニメ・ゲームなど)の MCP ツール定義。
// stdio版(server.mjs)とリモート版(app.mjs)の双方から createServer() を共有する。
// 業務ロジックは lib/service.mjs にあり、ここは引数の定義と結果の整形だけを行う。
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MEDIA_TYPES, STATUSES, STATUS_LABELS, editableFields } from "./lib/schema.mjs";

const typeSchema = z.enum(MEDIA_TYPES);
const statusSchema = z.enum(STATUSES);
const statusHelp = Object.entries(STATUS_LABELS).map(([k, v]) => `${k}=${v}`).join(", ");

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

// 例外をツールのエラー応答に変換する(入力ミスや外部APIの失敗はモデルに読ませて言い直させる)
const handle = (fn) => async (args) => {
  try {
    return json(await fn(args));
  } catch (e) {
    const known = ["InputError", "ProviderError", "ConflictError", "NotFoundError"].includes(e.name);
    if (!known) console.error("tool failed:", e);
    return { isError: true, content: [{ type: "text", text: known ? e.message : "内部エラーが発生しました" }] };
  }
};

// writable=false(リモート版)では書き込み系ツールと外部候補検索を登録しない。
// リモートの防御(IP制限+URL秘匿)は「本人である」ことを確認できないため。
export function createServer({ service, writable = false }) {
  const server = new McpServer({ name: "media-log-mcp", version: "0.4.0" });

  server.registerTool(
    "search_media",
    {
      title: "メディア記録検索",
      description:
        "タイトル・作者のキーワードでメディア記録(本・映画・アニメ・ゲーム等)を検索する（「これ読んだ/観た/やった?」判定用）。type未指定なら全種別を横断。結果の id は update_media / delete_media に使える",
      inputSchema: {
        keyword: z.string(),
        type: typeSchema.optional(),
        status: statusSchema.optional().describe(statusHelp),
        limit: z.number().default(20),
      },
    },
    handle(async (args) => {
      const hits = await service.search(args);
      return { count: hits.length, media: hits };
    })
  );

  server.registerTool(
    "media_by_creator",
    {
      title: "作者別メディア一覧",
      description: "指定した作者(著者・監督・開発元など)のメディア記録を全件返す。type未指定なら全種別を対象にする",
      inputSchema: { creator: z.string(), type: typeSchema.optional() },
    },
    handle(async (args) => {
      const hits = await service.byCreator(args);
      return { count: hits.length, media: hits };
    })
  );

  server.registerTool(
    "media_stats",
    {
      title: "メディア統計",
      description:
        "メディア記録の総件数・種別内訳・status内訳・感想を書いた数・作者別トップN・年別件数を集計する。type指定でその種別のみ集計",
      inputSchema: { type: typeSchema.optional(), topCreators: z.number().default(10) },
    },
    handle((args) => service.stats(args))
  );

  if (!writable) return server;

  server.registerTool(
    "discover_media",
    {
      title: "登録候補の検索",
      description:
        "外部データベース(書籍=Google Books、映画/アニメ/ドラマ/バラエティ=TMDB)から登録候補を探す。登録はしない。" +
        "候補をユーザーに見せて1件を選んでもらい、その externalId を add_media に渡すこと。上位の候補を自動で選ばないこと（同名の別作品・版違いがあるため）。" +
        "alreadyRecorded が付いた候補は既に台帳にある。game / audiobook は Provider が無いので add_media に title を渡して手入力で登録する",
      inputSchema: {
        type: typeSchema,
        query: z.string().describe("作品名。作者名を足すと絞り込める"),
        limit: z.number().int().min(1).max(10).default(5),
      },
    },
    handle(async (args) => ({ candidates: await service.discover(args) }))
  );

  server.registerTool(
    "add_media",
    {
      title: "メディア記録の登録",
      description:
        "台帳に1件登録する。discover_media の externalId を渡すとタイトル・作者・URL・画像が自動で埋まるので、本人固有の status / date / review / favoriteRank だけ指定すればよい。" +
        "externalId が無い場合は title 必須。同じ作品が既にあれば登録せず既存の記録を返すので、その場合は update_media で更新すること",
      inputSchema: {
        type: typeSchema,
        externalId: z.string().optional().describe("discover_media の候補の externalId"),
        status: statusSchema.optional().describe(statusHelp),
        date: z.string().optional().describe("読んだ/観た/遊んだ日。YYYY-MM-DD、分からなければ '2010頃' のような年表記"),
        review: z.string().optional(),
        favoriteRank: z.number().int().positive().optional(),
        title: z.string().optional().describe("手入力のとき、または候補のタイトルを上書きしたいとき"),
        creator: z.string().optional(),
        dateLast: z.string().optional(),
        url: z.string().optional(),
        image: z.string().optional(),
        platform: z.string().optional(),
        venue: z.string().optional(),
        hours: z.number().optional(),
        episodes: z.number().int().optional(),
        progress: z.number().optional(),
        source: z.string().optional(),
      },
    },
    handle((args) => service.add(args))
  );

  server.registerTool(
    "update_media",
    {
      title: "メディア記録の修正",
      description:
        "id を指定して記録を部分更新する(指定した項目だけ変わる)。項目に null を渡すとその項目を消す。id は search_media の結果から取る",
      inputSchema: {
        id: z.string(),
        patch: z
          .object(Object.fromEntries(Object.entries(editableFields).map(([k, s]) => [k, s.nullable().optional()])))
          .strict()
          .describe("変更する項目だけを入れる。例: {\"status\":\"done\",\"review\":\"...\"}"),
      },
    },
    handle(({ id, patch }) => service.update(id, patch))
  );

  server.registerTool(
    "delete_media",
    {
      title: "メディア記録の削除",
      description: "id を指定して1件削除する。実行前に対象のタイトルをユーザーに確認すること",
      inputSchema: { id: z.string() },
    },
    handle(({ id }) => service.remove(id))
  );

  return server;
}
