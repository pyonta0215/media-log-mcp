// 入口(stdio / リモート / Web UI)で共通の組み立て。
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createStore } from "./store.mjs";
import { MediaRepository } from "./repository.mjs";
import { createService } from "./service.mjs";

// ローカル実行時の設定ファイル。リポジトリの外に置く(APIキーを誤ってコミット・Lambdaへ同梱しないため)。
export const LOCAL_CONFIG = process.env.MEDIA_LOG_ENV || join(homedir(), ".config", "media-log-mcp", "env");

export function loadLocalConfig() {
  if (existsSync(LOCAL_CONFIG)) process.loadEnvFile(LOCAL_CONFIG); // 既にある環境変数は上書きしない
}

export function createRuntime(uri = process.env.MEDIA_STORE) {
  const store = createStore(uri);
  const repo = new MediaRepository(store);
  return { store, repo, service: createService(repo) };
}
