// 台帳のメモリキャッシュ。読み取りは全件メモリ上で行い(部分一致検索のため)、
// 呼び出しごとに ETag で鮮度だけ確認する。変更は「最新を読む → 適用 → 条件付き保存」。
import { ConflictError } from "./store.mjs";

export class MediaRepository {
  constructor(store) {
    this.store = store;
    this.records = null;
    this.etag = null;
  }

  // 未読込なら読み込み、読込済みなら ETag を渡して変わっていないかだけ確認する
  // (S3 では変更が無ければ 304 が返り、本文は転送されない)
  async refresh() {
    const res = await this.store.load(this.records ? this.etag : undefined);
    if (res.notModified) return this.records;
    this.records = res.data.records ?? [];
    this.etag = res.etag;
    return this.records;
  }

  async all() {
    return this.refresh();
  }

  async get(id) {
    return (await this.refresh()).find((r) => r.id === id) ?? null;
  }

  // mutate(records) は新しい records 配列と戻り値を返す純粋関数にすること。
  // 保存時に競合したら最新を読み直して1回だけやり直す(対象はIDで特定しているので安全に再適用できる)。
  async update(mutate) {
    for (let attempt = 0; ; attempt++) {
      const current = await this.refresh();
      const { records, result } = mutate(current);
      if (records === current) return result; // 変更なし(重複で中止など)は保存しない
      try {
        const etag = await this.store.save({ version: 1, records }, this.etag);
        this.records = records;
        this.etag = etag;
        return result;
      } catch (e) {
        if (!(e instanceof ConflictError) || attempt >= 1) throw e;
        this.records = null; // 次の refresh で必ず全体を読み直す
      }
    }
  }
}
