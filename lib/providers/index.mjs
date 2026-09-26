// メディア種別 → Provider の対応表。Provider が無い種別(game / audiobook)は手入力で登録する。
import { googleBooks } from "./googlebooks.mjs";
import { tmdb } from "./tmdb.mjs";
import { ProviderError } from "./http.mjs";

const PROVIDERS = [googleBooks, tmdb];

export function providerFor(type) {
  return PROVIDERS.find((p) => p.types.includes(type)) ?? null;
}

export function providerForExternalId(externalId) {
  if (/^(isbn|googlebooks):/.test(externalId)) return googleBooks;
  if (/^tmdb:/.test(externalId)) return tmdb;
  return null;
}

export { ProviderError };
