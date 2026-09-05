# i-list（移植中の骨格・ダミー専用）

自動車型式の適合必要法規と認証取得実績（認可書）を管理する帳票アプリの骨格。

**現状はダミーデータ専用・業務利用未検証です。** 実車情報・実日程・実認可番号・会社の機微情報は含みません。

## 移植元

- リポジトリ: `I_list_v01`（旧repo、参照専用）
- バージョン: v1.0
- コミット: `c0efb949bcf1511ded128b085ac57b2fd153dcdd`
- 参照元パス: `../i-list-reference/ilist-app/`

このrepoは上記の `ilist-app/` 配下（`index.html`, `package.json`, `package-lock.json`, `vite.config.js`, `src/`, `server/`）をルート直下に移植したものです。旧repoのデータベース（SQLite）・Excel・個人設定・`.claude`・`.git`等は移植していません。詳細は [docs/current-task.md](docs/current-task.md) を参照。

## 前提

- Node.js（`node:sqlite` を使うため、比較的新しいバージョンが必要。動作確認は Node v24 系）
- npm

`node:sqlite` は実験的機能です。利用しているNodeバージョンで有効かどうかは `node -e "require('node:sqlite')"` 等で事前に確認してください。

## 導入・起動

```bash
npm ci          # 初回。lockfile通りに依存をインストール
npm run dev     # 画面(Vite)とAPIサーバ(SQLite保存)を同時起動
```

ターミナルに出るURL（`http://127.0.0.1:5173`）をブラウザで開く。

止めるときは `Ctrl + C`。

データは編集すると自動でAPIサーバ（`server/index.js`）経由でSQLiteに保存されます（画面右上に保存状態表示）。保存先は `data/ilist.db`（`.gitignore`対象、リポジトリには含まれません）。

### 本番モード（ビルドして1プロセスで動かす）

```bash
npm run build   # dist/ に静的ファイルが出る
npm run server  # http://127.0.0.1:3001 だけで画面もAPIも動く
```

APIサーバ・Vite開発サーバともに **127.0.0.1（ローカルホスト）限定**で待ち受けます。LAN公開やトンネル経由の外部公開は行っていません（意図的にそうしています）。

## データ形・API

- データ形: `{ runs, regs, cert }`
- `GET /api/data` … 現在のデータを返す
- `PUT /api/data` … 全置換で保存（トランザクション）
- 4タブ: 帳票／型式ラン／法規DB／認可書実績

## ダミーデータについて

画面初期表示のSEEDデータ（型式ID・法規ID・認可書番号など）はすべて `DEMO-` 等の架空の識別子です。実在の型式・法規・認可書とは無関係です。型式↔法規↔認可書実績の対応関係（参照整合性）は、機能確認ができるように維持しています。

## 現時点の制限・未実装（既知）

- **⑤-0は未着手**です。
- **Excel（指定装置一覧）取り込みは未実装**です。現行ソースにも実装がなく、今回の移植でも追加していません。
- 画面上の日付基準 `TODAY` は定数（ハードコード）のままです。
- サーバへの初回接続に失敗した場合でも、直後にSEEDデータで自動保存が走り、サーバ側のデータを上書きしうる既存の挙動が残っています（`src/IListApp.jsx` の起動時 `useEffect` 参照）。今回は現状維持とし、別課題として記録しています。
- プロジェクトグループ・認可継承の実装はありません。

## 除外設定（.gitignore）についての注意

`.gitignore` で `node_modules/`, `dist/`, `data/`, `.DS_Store`, `*.log`, `.env`・`.env.*`, `*.db`関連, `*.sqlite*`, Excel/CSV/PDF, `.claude/settings.local.json` を除外していますが、**これはGit管理下に置かないという設定であり、データの安全性やアクセス制御を保証するものではありません**。機微情報を扱う場合は別途の管理策が必要です。

## 開発ルール

このリポジトリでの作業ルールは [AGENTS.md](AGENTS.md) を参照してください（`CLAUDE.md` も同じ内容を指しています）。
