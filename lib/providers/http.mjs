export class ProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProviderError";
  }
}

export async function fetchJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    // URL にはキーが含まれうるので、エラーメッセージにはホスト名だけを出す
    throw new ProviderError(`${new URL(url).host} が ${res.status} を返しました`);
  }
  return res.json();
}
