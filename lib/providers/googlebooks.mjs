// 書籍: Google Books API。キー無しは共有クォータが枯渇していて実用にならないため、キー必須。
import { isbn13to10 } from "../schema.mjs";
import { fetchJson, ProviderError } from "./http.mjs";

const BASE = "https://www.googleapis.com/books/v1/volumes";

function apiKey() {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (!key) throw new ProviderError("GOOGLE_BOOKS_API_KEY が未設定です（書籍の候補検索に必要）");
  return key;
}

const https = (u) => (u ? u.replace(/^http:/, "https:") : undefined);

// Google Books の1冊を台帳の項目へ変換する。
// ISBN-13 があれば externalId は isbn:<13桁>、URL は既存データと同じ Amazon の商品ページ形式に揃える。
function toFields(v) {
  const i = v.volumeInfo ?? {};
  const isbn13 = (i.industryIdentifiers ?? []).find((x) => x.type === "ISBN_13")?.identifier;
  const isbn10 = isbn13 ? isbn13to10(isbn13) : null;
  return {
    externalId: isbn13 ? `isbn:${isbn13}` : `googlebooks:volume:${v.id}`,
    title: [i.title, i.subtitle].filter(Boolean).join(" "),
    creator: (i.authors ?? []).join("、"),
    year: i.publishedDate?.slice(0, 4) ?? "",
    image: https(i.imageLinks?.thumbnail ?? i.imageLinks?.smallThumbnail),
    url: isbn10 ? `https://www.amazon.co.jp/dp/${isbn10}` : https(i.canonicalVolumeLink ?? i.infoLink),
    note: [i.publisher, i.publishedDate].filter(Boolean).join(" / "),
    providerRef: `googlebooks:volume:${v.id}`,
  };
}

export const googleBooks = {
  name: "googlebooks",
  types: ["book"],

  async search(query, { limit = 5 } = {}) {
    const url = `${BASE}?q=${encodeURIComponent(query)}&maxResults=${Math.min(limit, 20)}&printType=books&key=${apiKey()}`;
    const json = await fetchJson(url);
    return (json.items ?? []).map(toFields);
  },

  // externalId(isbn:... / googlebooks:volume:...) から詳細を引く
  async get(externalId) {
    let m = externalId.match(/^googlebooks:volume:(.+)$/);
    if (m) return toFields(await fetchJson(`${BASE}/${encodeURIComponent(m[1])}?key=${apiKey()}`));
    m = externalId.match(/^isbn:(\d{13})$/);
    if (m) {
      const json = await fetchJson(`${BASE}?q=isbn:${m[1]}&maxResults=1&key=${apiKey()}`);
      if (json.items?.length) return toFields(json.items[0]);
    }
    return null;
  },
};
