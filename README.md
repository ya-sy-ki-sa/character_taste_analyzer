# キャラ好みラボ

キャラクター像と「どこに・どう惹かれるか」を根拠とともに確認し、累積した好みからオリジナルキャラクターを作る日本語Webアプリです。通常版とdark版を同じ機能基盤で提供します。React・Hono・Cloudflare Worker/D1/R2/Workflowsを単一のnpmプロジェクトで管理しています。

## 起動

Node.js 24とnpmを使用します。

```bash
npm ci
cp .dev.vars.example .dev.vars
# AUTH_PEPPERを十分に長いランダム値に変更
npm run db:migrate:local
npm run dev:offline
```

`http://localhost:5173` を開きます。offlineはReplay/Fakeを明示的に使用します。外部プロバイダーの設定、通常起動、環境別コマンドは[導入・運用](docs/operations.md)を参照してください。

## 開発

```bash
npm run assets:generate  # カタログ、ルート、共有スキーマ、プロンプトから生成
npm run assets:check     # 生成内容との差分検査。ファイルは書き換えない
npm run verify          # CIと同じ品質ゲート
```

DB定義の正本は [database/migrations](database/migrations)、属性辞書は [shared/catalogs](shared/catalogs)、API・データ契約は [shared/contracts](shared/contracts) と実際の [HTTPルート](worker/routes) です。生成物を直接編集しません。既存データの変換、remote DBへの適用、デプロイは資産再配置に含めません。

## 文書

- [現行文書の索引](docs/README.md)
- [導入・運用](docs/operations.md)
- [構成・依存関係・正本](docs/architecture.md)
- [分析・レビュー・生成仕様](docs/analysis.md)
- [テスト・品質評価](docs/quality.md)
- [過去の設計・評価・試作](archive/README.md)

後方互換のURLや旧形式の読み替えは提供しません。通常版・dark版の生成履歴は、それぞれのAPIプレフィックス配下の `generation-requests` です。JSON成功応答は `{ data: ... }` に統一し、204とファイルダウンロードを別扱いにします。

ソースコードは [MIT License](LICENSE)、依存パッケージのライセンスは[サードパーティライセンス一覧](public/third-party-licenses.html)を参照してください。
