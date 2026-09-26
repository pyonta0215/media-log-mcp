// 台帳データ(単一JSON)の保存先。S3 とローカルファイルの2実装を同じインターフェースで持つ。
//   load(ifNoneMatch?) → { notModified: true } | { data, etag }
//   save(data, etag)   → newEtag   (etag=null は「まだ存在しないこと」を条件に新規作成)
// 他所で更新されていた場合は ConflictError を投げる(黙って上書きしない)。
import { readFile, writeFile, rename, stat } from "node:fs/promises";
import { createHash } from "node:crypto";

export class ConflictError extends Error {
  constructor(message = "台帳が他所で更新されていたため保存を中止しました") {
    super(message);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends Error {
  constructor(where) {
    super(`台帳データが見つかりません: ${where}`);
    this.name = "NotFoundError";
  }
}

const serialize = (data) => JSON.stringify(data, null, 1) + "\n";

export function createStore(uri) {
  if (!uri) {
    throw new Error(
      "MEDIA_STORE が未設定です。s3://<bucket>/<key> またはローカルファイルのパスを指定してください"
    );
  }
  return uri.startsWith("s3://") ? new S3Store(uri) : new FileStore(uri);
}

// ---- ローカルファイル(テスト・オフライン用) ----
export class FileStore {
  constructor(path) {
    this.path = path;
    this.describe = path;
  }

  async #read() {
    try {
      const body = await readFile(this.path, "utf-8");
      return { body, etag: createHash("sha1").update(body).digest("hex") };
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }

  async load(ifNoneMatch) {
    const cur = await this.#read();
    if (!cur) throw new NotFoundError(this.path);
    if (ifNoneMatch && cur.etag === ifNoneMatch) return { notModified: true };
    return { data: JSON.parse(cur.body), etag: cur.etag };
  }

  async save(data, etag) {
    const cur = await this.#read();
    if (etag === null ? cur !== null : cur?.etag !== etag) throw new ConflictError();
    const body = serialize(data);
    const tmp = `${this.path}.tmp-${process.pid}`;
    await writeFile(tmp, body);
    await rename(tmp, this.path); // 書きかけのファイルを残さない
    return createHash("sha1").update(body).digest("hex");
  }

  async exists() {
    try {
      await stat(this.path);
      return true;
    } catch {
      return false;
    }
  }
}

// ---- S3(本番) ----
export class S3Store {
  constructor(uri) {
    const m = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
    if (!m) throw new Error(`MEDIA_STORE の形式が不正です: ${uri}`);
    [, this.bucket, this.key] = m;
    this.describe = uri;
    this.client = null;
  }

  async #s3() {
    if (!this.client) {
      // SDK の読み込みは S3 を使うときだけ(テストやファイル運用で余計な起動コストを払わない)
      this.sdk = await import("@aws-sdk/client-s3");
      this.client = new this.sdk.S3Client({ region: process.env.AWS_REGION || "ap-northeast-1" });
    }
    return this.client;
  }

  async load(ifNoneMatch) {
    const s3 = await this.#s3();
    try {
      const res = await s3.send(
        new this.sdk.GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key,
          ...(ifNoneMatch ? { IfNoneMatch: ifNoneMatch } : {}),
        })
      );
      return { data: JSON.parse(await res.Body.transformToString()), etag: res.ETag };
    } catch (e) {
      const status = e.$metadata?.httpStatusCode;
      if (status === 304) return { notModified: true };
      if (e.name === "NoSuchKey" || status === 404) throw new NotFoundError(this.describe);
      throw e;
    }
  }

  async save(data, etag) {
    const s3 = await this.#s3();
    try {
      const res = await s3.send(
        new this.sdk.PutObjectCommand({
          Bucket: this.bucket,
          Key: this.key,
          Body: serialize(data),
          ContentType: "application/json; charset=utf-8",
          ...(etag === null ? { IfNoneMatch: "*" } : { IfMatch: etag }),
        })
      );
      return res.ETag;
    } catch (e) {
      const status = e.$metadata?.httpStatusCode;
      // 412: 条件不一致 / 409: 同時の条件付き書き込みと衝突
      if (status === 412 || status === 409) throw new ConflictError();
      throw e;
    }
  }
}
