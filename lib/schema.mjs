// 台帳レコードの共通スキーマ。MCP・Web UI・移行スクリプトはすべてここを参照する。
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";

// 種別と ID 接頭辞。種別を増やすときはここに1行足す。
export const TYPE_PREFIX = {
  book: "bk",
  audiobook: "ab",
  movie: "mv",
  anime: "an",
  drama: "dr",
  variety: "va",
  game: "gm",
};
export const MEDIA_TYPES = Object.keys(TYPE_PREFIX);

// status の統一語彙
export const STATUSES = ["done", "doing", "tried", "owned", "want", "dropped"];
export const STATUS_LABELS = {
  done: "読了・鑑賞済・クリア",
  doing: "進行中",
  tried: "ちょい見・試遊",
  owned: "所有・未消化",
  want: "これから",
  dropped: "途中でやめた",
};

// ユーザーが入力・編集できるフィールド。id / type / createdAt / updatedAt はシステム管理。
// 種別固有の項目は任意とし、スキーマに無い項目は受け付けない(打ち間違いで項目が増殖しないように)。
export const editableFields = {
  title: z.string().min(1),
  creator: z.string(),
  status: z.enum(STATUSES),
  date: z.string(), // ISO日付 / "2002頃" のような年表記 / 空文字(不明)
  dateLast: z.string(),
  review: z.string(),
  favoriteRank: z.number().int().positive(),
  url: z.string(),
  image: z.string(),
  externalId: z.string(),
  source: z.string(),
  platform: z.string(),
  venue: z.string(),
  genre: z.string(),
  hours: z.number().nonnegative(),
  episodes: z.number().int().nonnegative(),
  progress: z.number().min(0).max(100),
  purchasedDate: z.string(),
};
export const EDITABLE_KEYS = Object.keys(editableFields);

export const recordSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(MEDIA_TYPES),
    ...editableFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .partial()
  .required({ id: true, type: true, title: true, createdAt: true, updatedAt: true })
  .strict();

// 新規登録の入力(title は Provider から補完されうるので任意)
export const newRecordInput = z
  .object({ type: z.enum(MEDIA_TYPES), ...editableFields })
  .partial()
  .required({ type: true })
  .strict();

// 部分更新。null はそのフィールドの削除を意味する。
export const patchInput = z
  .object(Object.fromEntries(EDITABLE_KEYS.map((k) => [k, editableFields[k].nullable()])))
  .partial()
  .strict();

// 新規 ID: 接頭辞 + 乱数10桁hex
export function newId(type) {
  return `${TYPE_PREFIX[type]}_${randomBytes(5).toString("hex")}`;
}

// 移行用の決定的 ID: 同じ入力からは常に同じ ID になる(移行を何度流し直しても変わらない)
export function stableId(type, seed) {
  return `${TYPE_PREFIX[type]}_${createHash("sha1").update(seed).digest("hex").slice(0, 10)}`;
}

// 空文字・null・undefined のフィールドを落とす(保存形式を小さく保つ)
export function compact(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
}

// ---- 同一性(重複判定) ----

// ISBN-13(978始まり) → ISBN-10。979始まりは ISBN-10 が存在しないので null。
export function isbn13to10(isbn13) {
  if (!/^978\d{10}$/.test(isbn13)) return null;
  const core = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(core[i]);
  const c = (11 - (sum % 11)) % 11;
  return core + (c === 10 ? "X" : String(c));
}

// 物理書籍の Amazon ASIN は ISBN-10 と一致する。
// isbn:978... と amazon:asin:<ISBN-10> を同じ本として扱えるよう、比較用キーを複数返す。
export function identityKeys(externalId) {
  if (!externalId) return [];
  const keys = [externalId];
  let m = externalId.match(/^isbn:(\d{13})$/);
  if (m) {
    const i10 = isbn13to10(m[1]);
    if (i10) keys.push(`book:isbn10:${i10}`);
  }
  m = externalId.match(/^amazon:asin:(\d{9}[\dX])$/);
  if (m) keys.push(`book:isbn10:${m[1]}`);
  return keys;
}

// 検索・重複判定用の正規化(小文字化 + NFKC で全角/半角を吸収 + 空白除去)
export const norm = (s) => String(s ?? "").toLowerCase().normalize("NFKC");
export const titleKey = (s) => norm(s).replace(/\s+/g, "");
