// 台帳の操作。MCP ツールと Web UI の REST API はどちらもこのモジュールだけを呼ぶ。
import {
  newRecordInput,
  patchInput,
  recordSchema,
  newId,
  compact,
  identityKeys,
  titleKey,
  EDITABLE_KEYS,
} from "./schema.mjs";
import { searchMedia, mediaByCreator, mediaStats } from "./query.mjs";
import { providerFor, providerForExternalId, ProviderError } from "./providers/index.mjs";

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}

// zod のエラーを人が読める1行にする
function parseOr(schema, value) {
  const r = schema.safeParse(value);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "(入力)"}: ${i.message}`).join(" / ");
    throw new InputError(msg);
  }
  return r.data;
}

// 既に台帳にある同じ作品を探す。externalId(ISBN と ASIN の同一視を含む)か、同種別で同じタイトル。
function findDuplicate(records, candidate, exceptId) {
  const keys = new Set(identityKeys(candidate.externalId));
  const tkey = titleKey(candidate.title);
  return (
    records.find(
      (r) =>
        r.id !== exceptId &&
        (identityKeys(r.externalId).some((k) => keys.has(k)) ||
          (r.type === candidate.type && titleKey(r.title) === tkey))
    ) ?? null
  );
}

const now = () => new Date().toISOString();

export function createService(repo) {
  return {
    // ---- 読み取り ----
    async search(args) {
      return searchMedia(await repo.all(), args);
    },
    async byCreator(args) {
      return mediaByCreator(await repo.all(), args);
    },
    async stats(args) {
      return mediaStats(await repo.all(), args);
    },
    async get(id) {
      return repo.get(id);
    },
    async all() {
      return repo.all();
    },

    // ---- 外部候補の検索(登録はしない) ----
    async discover({ type, query, limit = 5 }) {
      const provider = providerFor(type);
      if (!provider) {
        throw new InputError(`${type} には候補検索の Provider がありません。title を指定して手入力で登録してください`);
      }
      const candidates = await provider.search(query, { limit, type });
      const records = await repo.all();
      // 台帳に既にあるものには印を付ける(重複登録の防止と「これ観た?」の確認を兼ねる)
      return candidates.map((c) => {
        const dup = findDuplicate(records, { ...c, type });
        return dup ? { ...c, alreadyRecorded: { id: dup.id, title: dup.title, status: dup.status } } : c;
      });
    },

    // ---- 登録 ----
    // externalId があれば Provider から title / creator / url / image を補完する(本人の入力が優先)。
    // 既に同じ作品があれば保存せずに { duplicate } を返す。
    async add(input) {
      const data = parseOr(newRecordInput, input);
      if (data.externalId) {
        const provider = providerForExternalId(data.externalId);
        if (provider) {
          const details = await provider.get(data.externalId);
          if (!details) throw new InputError(`${data.externalId} の詳細を取得できませんでした`);
          for (const k of ["title", "creator", "url", "image"]) {
            if (data[k] === undefined && details[k]) data[k] = details[k];
          }
          data.externalId = details.externalId; // googlebooks:volume → isbn: への正規化を反映
        }
      }
      if (!data.title) throw new InputError("title を指定するか、候補検索で得た externalId を指定してください");

      const ts = now();
      const record = parseOr(recordSchema, compact({ id: newId(data.type), ...data, createdAt: ts, updatedAt: ts }));
      return repo.update((records) => {
        const dup = findDuplicate(records, record);
        if (dup) return { records, result: { added: false, duplicate: dup } };
        return { records: [...records, record], result: { added: true, record } };
      });
    },

    // ---- 部分更新(null はフィールド削除) ----
    async update(id, patch) {
      const p = parseOr(patchInput, patch);
      if (Object.keys(p).length === 0) throw new InputError("変更する項目がありません");
      if (p.title === null) throw new InputError("title は削除できません");
      return repo.update((records) => {
        const i = records.findIndex((r) => r.id === id);
        if (i < 0) throw new InputError(`id=${id} の記録はありません`);
        const next = { ...records[i] };
        for (const k of EDITABLE_KEYS) {
          if (!(k in p)) continue;
          if (p[k] === null || p[k] === "") delete next[k];
          else next[k] = p[k];
        }
        next.updatedAt = now();
        const record = parseOr(recordSchema, next);
        const copy = records.slice();
        copy[i] = record;
        return { records: copy, result: { updated: true, record } };
      });
    },

    // ---- 削除(1件ずつ。S3 のバージョン履歴から戻せる) ----
    async remove(id) {
      return repo.update((records) => {
        const target = records.find((r) => r.id === id);
        if (!target) throw new InputError(`id=${id} の記録はありません`);
        return { records: records.filter((r) => r.id !== id), result: { deleted: true, record: target } };
      });
    },
  };
}

export { ProviderError };
