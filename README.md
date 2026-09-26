# media-log-mcp

自分が触れてきたメディア（本・映画・アニメ・ドラマ・ゲームなど）の個人台帳です。Claude との会話（MCP）とローカルの Web UI から、同じデータを検索・登録・編集できます。

> 旧リポジトリ名は `bookmeter-mcp` です。v0.4.0 で参照専用から書き込み可能な台帳へ移行しました。

## 構成

```
 Claude Code / Desktop ──stdio──┐
 ローカル Web UI (127.0.0.1) ────┼── lib/service.mjs ── S3: media.json（正本・Versioning）
 claude.ai / モバイル ──HTTPS──┘   （全入口で共通）
        └─ リモート版は読み取り専用
```

- **正本は S3 の `media.json` 1ファイル**。約1MB・2,700件規模なので、全件をメモリに載せて部分一致検索する。DB は使わない（部分一致検索と噛み合わないため）
- 書き込みは ETag を使った条件付き書き込み。別の入口が先に書いていたら最新を読み直して再適用し、黙って上書きしない
- 巻き戻しは S3 Versioning。古い版は30日で自動削除
- 業務ロジックは `lib/` にだけ置き、MCP（`mcp-server.mjs`）と Web UI（`web.mjs`）は入口として呼ぶだけ

| 入口 | 書き込み | 身元の確認 |
| --- | --- | --- |
| ローカル stdio（`server.mjs`） | 可 | 自分のPCにログインできること |
| ローカル Web UI（`web.mjs`） | 可 | 127.0.0.1 限定。Host 検査と独自ヘッダで他サイトからの要求を拒否 |
| リモート（Lambda / `app.mjs`） | **不可** | IP制限＋URL秘匿のみ。本人確認にならないため書き込みツールを登録せず、IAM でも S3 の読み取りしか許可しない |

## MCP ツール

`type` は `book` / `audiobook` / `movie` / `anime` / `drama` / `variety` / `game`。
`status` は `done`（読了・鑑賞済）/ `doing`（進行中）/ `tried`（ちょい見・試遊）/ `owned`（所有・未消化）/ `want`（これから）/ `dropped`（途中でやめた）。

| ツール | 内容 | リモート |
| --- | --- | --- |
| `search_media(keyword, type?, status?, limit=20)` | タイトル・作者で検索（「これ読んだ?」判定）。結果の `id` を編集・削除に使う | ○ |
| `media_by_creator(creator, type?)` | 作者別の全件 | ○ |
| `media_stats(type?, topCreators=10)` | 件数・種別・status・作者・年の集計 | ○ |
| `discover_media(type, query, limit=5)` | 外部DBから登録候補を探す（**登録はしない**） | — |
| `add_media(type, externalId?, status?, date?, review?, favoriteRank?, title?, …)` | 1件登録。`externalId` を渡すとタイトル・作者・URL・画像を自動で補完。同じ作品があれば登録せず既存を返す | — |
| `update_media(id, patch)` | 部分更新。`null` でその項目を削除 | — |
| `delete_media(id)` | 1件削除 | — |

登録は「`discover_media` で候補を出す → 1件を選ぶ → `add_media` に `externalId` と自分の `status` / `date` / `review` を渡す」の2段階。上位の候補を自動で採用しないのは、同名の別作品や版違いを混ぜないため。

| 種別 | 候補検索 | 必要なキー |
| --- | --- | --- |
| book | Google Books | `GOOGLE_BOOKS_API_KEY`（キー無しの共有枠は枯渇していて使えない） |
| movie / anime / drama / variety | TMDB | `TMDB_API_KEY`（v3 キーか v4 トークン） |
| game / audiobook | なし | `title` を指定して手入力 |

書籍は ISBN を `isbn:978…` として持ち、既存の Amazon ASIN（`amazon:asin:…` = ISBN-10）と同じ本として重複判定する。

## ローカルで使う

```bash
npm install
```

設定は**リポジトリの外**の `~/.config/media-log-mcp/env` に置く（API キーを誤ってコミット・Lambda へ同梱しないため）。`MEDIA_LOG_ENV` で場所を変えられる。

```sh
MEDIA_STORE=s3://<バケット名>/media.json   # sam deploy の出力 MediaStore
AWS_REGION=ap-northeast-1
GOOGLE_BOOKS_API_KEY=...                    # 任意
TMDB_API_KEY=...                            # 任意
```

S3 へのアクセスには AWS CLI と同じ認証情報（`~/.aws`）を使う。

### Claude Code / Desktop（stdio）

```json
{
  "mcpServers": {
    "media-log": { "command": "node", "args": ["/絶対パス/media-log-mcp/server.mjs"] }
  }
}
```

stdio 版は書き込みツールも有効。読み取り専用にしたいときは `"env": { "MEDIA_LOG_READONLY": "1" }`。

### Web UI

```bash
npm run web   # → http://127.0.0.1:4319
```

一覧・絞り込み（種別 / 状態 / 画像なし / 感想なし）・並べ替え・編集・削除・候補からの登録ができる。

## リモート（AWS Lambda + Function URL）

claude.ai（Web）やモバイルアプリから検索するための読み取り専用版。

- Lambda + Function URL（認証なし）/ Node.js 22.x（arm64）、Streamable HTTP（stateless）
- 防御は2段: 送信元 IP を Anthropic の outbound レンジ `160.79.104.0/21` に限定し、パスを推測困難なランダム文字列にする（`MCP_PATH`）
- 台帳は S3 から読む。warm な Lambda はメモリ上の台帳を使い回し、リクエストごとに ETag で変更の有無だけ確認する（変更が無ければ 304 で本文は転送されない）
- 費用: Lambda・CloudFront は常時無料枠内。S3 は12ヶ月無料枠を過ぎると従量だが月 $0.01 程度

### デプロイ

```bash
openssl rand -hex 16                      # 初回のみ: 秘匿パスを生成
npm run deploy                            # = scripts/build-lambda.sh && sam deploy
```

初回は `sam deploy --guided` で `McpPath=/mcp/<生成した文字列>`・`AllowedCidr=160.79.104.0/21` を渡す（値は `samconfig.toml` に保存され、このファイルは `.gitignore` 済み）。

> `scripts/build-lambda.sh` は Lambda に必要なファイルだけを `dist/` に集める。SAM CLI は `.samignore` を読まないため、リポジトリ直下を `CodeUri` にすると `.git/` や `samconfig.toml` までパッケージに入る。

デプロイ後、出力の `FunctionUrl` の末尾に秘匿パスを付けたものが MCP エンドポイント。claude.ai の **Settings > Connectors > Add custom connector** に登録する（OAuth 不要）。

## データ

旧形式（種別ごとの JSON 8ファイル）は v0.4.0 で S3 の単一台帳へ移行し、リポジトリからは削除した。移行はコミット `9aa7ecc` の JSON から再現できる（同じ入力なら ID も含めて同一の出力になる）:

```bash
mkdir -p /tmp/legacy && git archive 9aa7ecc -- '*.json' ':!package*.json' | tar -x -C /tmp/legacy
node scripts/migrate.mjs --from /tmp/legacy --out ./media.json --at 2026-09-25T00:00:00.000Z
```

レコードの主な項目（`lib/schema.mjs`）:

| 項目 | 内容 |
| --- | --- |
| `id` | 不変の識別子（`bk_` `mv_` などの接頭辞＋10桁） |
| `type` / `title` | 必須。通称は `"ゼルダの伝説 ティアーズ オブ ザ キングダム (ティアキン)"` のように括弧で併記 |
| `creator` | 著者・監督・開発元 |
| `status` / `date` / `dateLast` / `review` / `favoriteRank` | 自分固有の情報。`date` は ISO 日付か `"2010頃"`、不明なら省略 |
| `url` / `image` / `externalId` | 外部の情報。画像は外部 URL をそのまま持つ |
| `source` / `platform` / `venue` / `hours` / `episodes` / `progress` / `purchasedDate` | 種別固有・取り込み元 |
| `createdAt` / `updatedAt` | 自動 |

## テスト

```bash
npm test
```
