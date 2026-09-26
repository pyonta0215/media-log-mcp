// 読み取り系(検索・作者別・集計)。レコード配列を受け取る純粋関数だけを置く。
import { norm } from "./schema.mjs";

const filterBy = (records, { type, status } = {}) =>
  records.filter((m) => (!type || m.type === type) && (!status || m.status === status));

export function searchMedia(records, { keyword, type, status, limit = 20 }) {
  const q = norm(keyword);
  return filterBy(records, { type, status })
    .filter((m) => norm(`${m.title} ${m.creator ?? ""}`).includes(q))
    .slice(0, limit);
}

export function mediaByCreator(records, { creator, type }) {
  const q = norm(creator);
  return filterBy(records, { type }).filter((m) => norm(m.creator).includes(q));
}

export function mediaStats(records, { type, topCreators = 10 }) {
  const target = filterBy(records, { type });
  const typeCounts = new Map();
  const statusCounts = new Map();
  const creatorCounts = new Map();
  const yearCounts = new Map();
  let reviewed = 0;
  const inc = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);

  for (const m of target) {
    inc(typeCounts, m.type);
    inc(statusCounts, m.status ?? "未設定");
    if (m.review) reviewed++;
    inc(creatorCounts, m.creator || "不明");
    const match = typeof m.date === "string" ? m.date.match(/\d{4}/) : null;
    inc(yearCounts, match ? match[0] : "不明");
  }

  return {
    totalRecords: target.length,
    byType: Object.fromEntries(typeCounts),
    byStatus: Object.fromEntries(statusCounts),
    withReview: reviewed,
    withoutReview: target.length - reviewed,
    topCreators: [...creatorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topCreators)
      .map(([creator, count]) => ({ creator, count })),
    // 年でソート、"不明" は末尾へ
    byYear: [...yearCounts.entries()]
      .sort((a, b) => (a[0] === "不明" ? 1 : b[0] === "不明" ? -1 : a[0].localeCompare(b[0])))
      .map(([year, count]) => ({ year, count })),
  };
}
