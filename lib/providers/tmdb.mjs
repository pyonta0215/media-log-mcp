// 映画・アニメ・ドラマ・バラエティ: TMDB。
// TMDB_API_KEY には v3 の API キーか v4 の読み取りアクセストークン(eyJ...)のどちらでも入れられる。
import { fetchJson, ProviderError } from "./http.mjs";

const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w342";

function request(path, params = {}) {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new ProviderError("TMDB_API_KEY が未設定です（映像作品の候補検索に必要）");
  const isBearer = key.startsWith("eyJ");
  const qs = new URLSearchParams({ language: "ja-JP", ...params, ...(isBearer ? {} : { api_key: key }) });
  return fetchJson(`${BASE}${path}?${qs}`, isBearer ? { headers: { Authorization: `Bearer ${key}` } } : {});
}

const trim = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? "");

function toFields(kind, r, creator = "") {
  const title = kind === "movie" ? r.title : r.name;
  const original = kind === "movie" ? r.original_title : r.original_name;
  const date = kind === "movie" ? r.release_date : r.first_air_date;
  return {
    externalId: `tmdb:${kind}:${r.id}`,
    title,
    creator,
    year: date?.slice(0, 4) ?? "",
    image: r.poster_path ? `${IMG}${r.poster_path}` : undefined,
    url: `https://www.themoviedb.org/${kind}/${r.id}`,
    note: [kind === "movie" ? "映画" : "TV", original !== title ? original : "", trim(r.overview, 60)]
      .filter(Boolean)
      .join(" / "),
  };
}

// 種別ごとに検索する TMDB の区分。アニメは劇場版もあるので両方引く。
const KINDS = { movie: ["movie"], anime: ["tv", "movie"], drama: ["tv"], variety: ["tv"] };

export const tmdb = {
  name: "tmdb",
  types: Object.keys(KINDS),

  async search(query, { limit = 5, type = "movie" } = {}) {
    const results = [];
    for (const kind of KINDS[type]) {
      const json = await request(`/search/${kind}`, { query, include_adult: "false" });
      results.push(...(json.results ?? []).map((r) => ({ ...toFields(kind, r), _pop: r.popularity ?? 0 })));
    }
    // 2区分を混ぜたときは人気順で並べ直す(同名作品の本命が上に来やすい)
    if (KINDS[type].length > 1) results.sort((a, b) => b._pop - a._pop);
    return results.slice(0, limit).map(({ _pop, ...c }) => c);
  },

  // 詳細取得時にだけ監督・原作者などの作り手を取る(検索結果には含まれないため)
  async get(externalId) {
    const m = externalId.match(/^tmdb:(movie|tv):(\d+)$/);
    if (!m) return null;
    const [, kind, id] = m;
    if (kind === "movie") {
      const r = await request(`/movie/${id}`, { append_to_response: "credits" });
      const directors = (r.credits?.crew ?? []).filter((c) => c.job === "Director").map((c) => c.name);
      return toFields(kind, r, directors.join("、"));
    }
    const r = await request(`/tv/${id}`);
    return toFields(kind, r, (r.created_by ?? []).map((c) => c.name).join("、"));
  },
};
