import { test } from "node:test";
import assert from "node:assert/strict";

// ほかのリポジトリ(lifelog)が github 依存で取り込む口。名前を変えると取り込む側が壊れる
test("package.json の exports から lib を読める", async () => {
  const { createService } = await import("media-log-mcp/service");
  const { MediaRepository } = await import("media-log-mcp/repository");
  const { createStore, S3Store, FileStore, ConflictError } = await import("media-log-mcp/store");
  const { STATUSES, MEDIA_TYPES } = await import("media-log-mcp/schema");
  const { providerFor, ProviderError } = await import("media-log-mcp/providers");
  for (const f of [createService, MediaRepository, createStore, S3Store, FileStore, ConflictError, providerFor, ProviderError]) {
    assert.equal(typeof f, "function");
  }
  assert.ok(STATUSES.includes("doing") && MEDIA_TYPES.includes("movie"));
});
