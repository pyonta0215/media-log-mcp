# media-log-mcp

自分が触れてきたメディアの記録（本・映画・アニメ・ゲーム）を提供する最小の MCP サーバーです。3つのツールで記録を横断検索・集計できます。読書記録は Bookmeter のエクスポートをそのまま利用します。

> 旧リポジトリ名は `bookmeter-mcp` です。読書記録だけの MCP から全メディア対応へ拡張したのに合わせて改名しました。

使い方は2通りあります。

- **ローカル(stdio)** — 自分の PC の Claude Desktop / Claude Code から使う。セットアップが最も簡単。
- **リモート(AWS Lambda)** — claude.ai(Web) やモバイルアプリからも使う。公開エンドポイントを立てる。

## 提供ツール

いずれも `type`（`book` / `audiobook` / `movie` / `anime` / `drama` / `variety` / `game`）で種別を絞り込めます。未指定なら全種別を横断します。

- `search_media(keyword, type?, limit=20)` — タイトル・作者をキーワード検索（「これ読んだ/観た/やった?」判定用）
- `media_by_creator(creator, type?)` — 指定した作者（著者・監督・開発元など）の記録を全件返す
- `media_stats(type?, topCreators=10)` — 総件数・種別内訳・作者別トップN・年別件数を集計

## 使い方1: ローカル(stdio)

```bash
git clone <このリポジトリのURL>
cd media-log-mcp
npm install
node server.mjs
```

`node server.mjs` を実行して、エラーなく起動しプロセスが待機状態になっていれば起動確認は完了です
（stdio 前提のサーバーなので、ターミナルで単体実行しても何も表示されずに待機し続けるのが正常動作です。
終了する場合は Ctrl+C で止めてください）。

### Claude Desktop などMCPクライアントへの登録

npm パッケージとして公開しているわけではないため、`npx` ではなく `node` コマンドで直接起動します。
設定ファイル（例: Claude Desktop の `claude_desktop_config.json`）に以下のように追記してください。
`args` の値は、クローンした先の `server.mjs` への**絶対パス**に置き換えます。

```json
{
  "mcpServers": {
    "media-log": {
      "command": "node",
      "args": ["/絶対パス/media-log-mcp/server.mjs"]
    }
  }
}
```

設定後、MCP クライアントを再起動すると `media-log` サーバーが認識され、上記3つのツールが利用できます。

## 使い方2: リモート(AWS Lambda + Function URL)

claude.ai(Web) やモバイルアプリからも使いたい場合、AWS Lambda に立てて「リモート MCP コネクタ」として登録します。ローカルの stdio サーバーは claude.ai(Web) からは使えないため、Web で使うにはこちらが必要です。

### 構成

- AWS Lambda + Function URL（Function URL自体はNONE、アプリ層でCognito JWT認証）/ Node.js 22.x（arm64）
- トランスポート: Streamable HTTP（stateless、単一 JSON 応答）
- Express アプリ（`app.mjs`）を `@codegenie/serverless-express` で Lambda ハンドラ（`lambda.mjs`）に載せる
- ツール定義（`mcp-server.mjs`）は stdio 版とリモート版で共有
- 費用: Lambda 無料枠内（月100万リクエスト）。API Gateway も WAF も使わないので実質 $0/月

### 防御

1. **IP制限** — Lambda ハンドラで送信元 IP を検査し、Anthropic の outbound レンジ `160.79.104.0/21`（[公式](https://platform.claude.com/docs/en/api/ip-addresses)）以外を 403 で拒否
2. **Cognito JWT** — APIとMCPで署名・issuer・audienceを検証
3. **URL秘匿** — MCP エンドポイントのパスを推測困難なランダム文字列にする（`/mcp/<ランダム>`）。パスは環境変数 `MCP_PATH` で渡し、コードには含めない

> `books.json` 自体は公開リポジトリに含まれるため、上記はデータ機密性というより無駄なアクセス・DoS を防ぐ目的です。

### 前提

- AWS アカウントと認証済みの AWS CLI
- AWS SAM CLI

### デプロイ

```bash
# 1. 秘匿パスを生成（出力の32文字hexをメモ）
openssl rand -hex 16

# 2. デプロイ（McpPath に /mcp/<生成した文字列> を渡す）
sam deploy \
  --stack-name media-log-mcp \
  --resolve-s3 --capabilities CAPABILITY_IAM \
  --region ap-northeast-1 \
  --parameter-overrides 'McpPath=/mcp/<生成した文字列> AllowedCidr=160.79.104.0/21'
```

デプロイ後、出力の `FunctionUrl` の末尾に秘匿パスを付けたものが MCP エンドポイントです:
`https://xxxx.lambda-url.ap-northeast-1.on.aws/mcp/<生成した文字列>`

| パラメータ | 意味 | 既定 |
| --- | --- | --- |
| `McpPath` | MCP エンドポイントの秘匿パス | (必須) |
| `AllowedCidr` | 許可する送信元 IP レンジ | `160.79.104.0/21` |

> スタック名を後から変えることはできません（変えると別スタックが新規作成されて Function URL が変わり、コネクタの再登録が必要になります）。

> 自分の PC から疎通確認したいときは、一時的に `AllowedCidr` を自分のグローバル IP（`curl https://checkip.amazonaws.com` の結果）の `/32` にしてデプロイし、確認後に `160.79.104.0/21` へ戻します。本番レンジのままだと、Anthropic のクラウド経由（＝Claude から）以外はすべて 403 になります。

### claude.ai / Claude Desktop への登録

1. **Settings > Connectors**（設定 > コネクタ）を開く
2. **Add custom connector**（カスタムコネクタを追加）
3. 上記の MCP エンドポイント URL（秘匿パス込み）を入力。認証（OAuth）は不要
4. 追加後、チャットの「+」からコネクタを ON にして使う

無料プランでも1個まで登録できます。一度登録すれば Web・モバイル・Desktop すべてで使えます（新規登録は Web / Desktop 推奨）。

## データについて

### Web CRUD / S3

`npm run start:remote` でWeb UI（`/`）とREST API（`/api/media`）を起動します。S3_BUCKETを設定すると
正規化済みの `media.json`（S3_KEYで変更可）がデータストアになり、未設定時は従来のJSONファイルを読み込みます。
S3更新はETag/条件付きPutを使うため、同時更新は409になります。初期投入は次のように行います。

```bash
S3_BUCKET=my-bucket node scripts/seed-s3.mjs
```

本番では `COGNITO_USER_POOL_ID`、`COGNITO_REGION`、`COGNITO_CLIENT_ID` と `AUTH_REQUIRED=true` を設定すると、
APIとMCPの両方で署名・issuer・audience検証済みのCognito JWTが必須です。ローカルではCognito設定を省略すると認証を無効化できます。
Function URLのIP制限（既定は従来どおりAnthropicのレンジ）は、Web UIを直接使う場合だけ
`AllowedCidr=0.0.0.0/0` に変更し、必ずCognito認証を併用してください。IP制限を無効にしてもMCPにもJWT認証が適用されます。
CORSはテンプレートで許可オリジンを設定し、無制限にはしていません。

UIはHTTPS画像URLのみをブラウザ表示し、画像の保存・プロキシはしません。画像・作品情報は各サービスの
著作権、利用規約、公開範囲を確認し、許可のない再配布や公開を行わないでください。

認証付きのWeb UIでは、画面上部のJWT入力欄にCognitoのIDトークンまたはアクセストークンを設定します。
Hosted UIの本番ログイン画面は、固定のWebオリジン（独自ドメイン等）を用意する段階で追加してください。
ローカル認証なしの場合、CRUDの保存先はリポジトリ直下の `media.json` です。これは開発用であり、
本番では必ずS3とCognitoを使用してください。

S3を使わない従来のJSONは初期データ・バックアップとして扱います。S3へ移行した後の追加・編集・削除は
Web UI/APIから行い、MCPは同じS3データを参照します。

| 種別 | ファイル | パス上書き用の環境変数 |
| --- | --- | --- |
| 本（Bookmeter） | `books.json` | `BOOKS_JSON` |
| 本（Kindle購入分） | `kindle-books.json` | `KINDLE_BOOKS_JSON` |
| オーディオブック | `audiobooks.json` | `AUDIOBOOKS_JSON` |
| 映画 | `movies.json` | `MOVIES_JSON` |
| アニメ | `anime.json` | `ANIME_JSON` |
| ドラマ | `dramas.json` | `DRAMAS_JSON` |
| バラエティ | `varieties.json` | `VARIETIES_JSON` |
| ゲーム | `games.json` | `GAMES_JSON` |

### books.json（Bookmeter エクスポート形式）

Bookmeter からのエクスポート形式をそのまま温存しています。読み込み時に下記の共通スキーマへ正規化されます。

| フィールド | 内容 |
| --- | --- |
| `t` | タイトル |
| `a` | 著者 |
| `d` | 日付（`"YYYY/MM/DD"` 形式の文字列、または `"日付不明"`） |
| `r` | 感想文 |
| `i` | Amazon画像URL |
| `u` | Amazon商品ページURL |

### movies.json / anime.json / games.json（共通スキーマ）

最初から共通スキーマで記録します。`title` 以外は省略可で、任意の追加フィールドも
そのまま検索結果に含まれます。

```json
[
  {
    "title": "作品タイトル",
    "creator": "監督・開発元など",
    "date": "YYYY-MM-DD",
    "review": "感想",
    "url": "関連URL"
  }
]
```

- `date` は「自分が観た・遊んだ時期」。日付まで不明なら `"2010頃"` のような年表記でもよい
  （集計は文字列中の4桁年を拾う）。完全に不明なら空文字
- 通称・略称で検索できるよう、`title` に `"ゼルダの伝説 ティアーズ オブ ザ キングダム (ティアキン)"` の
  ように括弧で併記する（検索対象は `title` + `creator` のみのため）
- 任意フィールドの例:
  - `favoriteRank` — 「好きな作品トップ10」の順位（movies / games で使用）
  - `platform` / `hours` — 機種・プレイ時間/視聴時間（games / 映像記録で使用）
  - `status` — `played`（プレイ済み）/ `tried`（1時間以下の試遊、映像・オーディオブックでは冒頭だけのちょい見・ちょい聴き）/ `playing`（プレイ中）/ `purchased`（Kindleで購入したが読了記録なし）
  - `dateLast` / `episodes` / `source` — 視聴期間の終端・視聴話数・記録の出典（Prime Video 視聴履歴からの取り込み分で使用。`date` は初回視聴日）
  - `progress` — オーディオブックの聴取進捗（%。audiobooks で使用）
  - `purchasedDate` — Kindle 購入日（読了日が `date` に入っている場合の補助。kindle-books で使用）

> 同じ種別を複数ファイルに分けることもできます（`SOURCES` に同じ `type` の行を複数書く。例: `books.json` と `kindle-books.json` はどちらも `book`）。

### 種別の追加

新しい種別（ドラマなど）を増やす場合は、`mcp-server.mjs` の `SOURCES` に1行足して
対応する JSON ファイルを置くだけです。
