import { readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute } from "node:path";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID, createHash } from "node:crypto";

export const SOURCES = [
  { type: "book", file: "books.json", env: "BOOKS_JSON", normalize: (b) => ({ type: "book", title: b.t, creator: b.a, date: b.d, review: b.r, image: b.i, url: b.u }) },
  { type: "book", file: "kindle-books.json", env: "KINDLE_BOOKS_JSON" },
  { type: "audiobook", file: "audiobooks.json", env: "AUDIOBOOKS_JSON" },
  { type: "movie", file: "movies.json", env: "MOVIES_JSON" },
  { type: "anime", file: "anime.json", env: "ANIME_JSON" },
  { type: "drama", file: "dramas.json", env: "DRAMAS_JSON" },
  { type: "variety", file: "varieties.json", env: "VARIETIES_JSON" },
  { type: "game", file: "games.json", env: "GAMES_JSON" },
];
export const MEDIA_TYPES = [...new Set(SOURCES.map((s) => s.type))];
const localPath = (source) => process.env[source.env] ?? fileURLToPath(new URL(`./${source.file}`, import.meta.url));
const recordsOf = (raw) => Array.isArray(raw) ? raw : raw?.records ?? raw?.books ?? [];

export function deterministicId(record, source, index) {
  return record.id || createHash("sha256").update(`${source.type}:${source.file}:${index}:${record.title ?? ""}:${record.creator ?? ""}`).digest("hex").slice(0, 20);
}

export function normalizeRecord(record, source, index) {
  const value = source.normalize ? source.normalize(record) : { type: source.type, ...record };
  return { ...value, type: value.type || source.type, id: deterministicId(value, source, index) };
}

export async function loadLocalMedia() {
  const all = [];
  for (const source of SOURCES) {
    try {
      const raw = JSON.parse(await readFile(localPath(source), "utf8"));
      recordsOf(raw).forEach((record, index) => all.push(normalizeRecord(record, source, index)));
    } catch (error) {
      if (error.code !== "ENOENT" || process.env[source.env]) throw error;
    }
  }
  return all;
}

export function createMediaStore() {
  const bucket = process.env.S3_BUCKET;
  const key = process.env.S3_KEY || "media.json";
  const s3 = bucket ? new S3Client({}) : null;
  const localStorePath = process.env.MEDIA_JSON
    ? isAbsolute(process.env.MEDIA_JSON)
      ? process.env.MEDIA_JSON
      : fileURLToPath(new URL(process.env.MEDIA_JSON, import.meta.url))
    : fileURLToPath(new URL("./media.json", import.meta.url));
  async function get() {
    if (!s3) {
      try {
        const records = recordsOf(JSON.parse(await readFile(localStorePath, "utf8")));
        return { records, etag: null };
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return { records: await loadLocalMedia(), etag: null };
      }
    }
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const records = recordsOf(JSON.parse(await result.Body.transformToString())).map((record, index) => ({
        ...record,
        id: record.id || createHash("sha256").update(`s3:${index}:${record.type ?? ""}:${record.title ?? ""}`).digest("hex").slice(0, 20),
      }));
      return { records, etag: result.ETag?.replaceAll('"', "") };
    } catch (error) {
      if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) return { records: [], etag: null };
      throw error;
    }
  }
  async function save(records, etag = null) {
    if (!s3) {
      await writeFile(`${localStorePath}.tmp`, JSON.stringify(records, null, 2) + "\n");
      await rename(`${localStorePath}.tmp`, localStorePath);
      return { records, etag: null };
    }
    const input = { Bucket: bucket, Key: key, Body: JSON.stringify(records, null, 2) + "\n", ContentType: "application/json" };
    if (etag) input.IfMatch = etag;
    else input.IfNoneMatch = "*";
    try {
      const result = await s3.send(new PutObjectCommand(input));
      return { records, etag: result.ETag?.replaceAll('"', "") };
    } catch (error) {
      if (error.$metadata?.httpStatusCode === 412) {
        const conflict = new Error("The media data was changed by another request");
        conflict.status = 409;
        throw conflict;
      }
      throw error;
    }
  }
  return { get, save };
}

export const defaultStore = createMediaStore();
