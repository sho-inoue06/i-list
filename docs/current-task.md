# 現在のタスク

## 日付
2026-09-05

## 目的
新しいi-listで既存アプリ（React/Vite + Node標準HTTP/SQLite、データ形 `{ runs, regs, cert }`、4タブ構成）の骨格を起動可能にし、次の開発の足場を作る。今夜は業務仕様を変更しない。

## 正本
- Notion「Iリスト｜開発ルールと初回移植計画」（2026-09-05時点の内容）。
- 本依頼は、Notion本体に接続できない状況における、同日付の実行用抜粋として使用する。
- Notion URLは本依頼時点で提示されていないため、ここには記録しない（未提示のものを推測で記載しない）。

## 参照元
- パス: `../i-list-reference/ilist-app/`（読取専用）
- プロジェクト: I_list_v01
- バージョン: v1.0
- コミット: `c0efb949bcf1511ded128b085ac57b2fd153dcdd`

## 対象外（今夜はやらない）
- Gitコマンドの実行（読取・書込とも）。clone・状態確認・差分確認・commit・pushはユーザーが行う。
- 会社資料・実車情報・実日程・実認可番号・秘密情報の取り扱い。
- 旧data、SQLiteファイル、Excelファイル、profile.md、notion_node.html、.claude、.git、node_modules、dist、個人設定の移植。
- ⑤-0の実装、Excel取り込みの実装、プロジェクトグループの実装、認可継承の実装。
- 既存コードの`≤`の一括置換、TypeScript化、大規模なファイル分割。
- 新しい依存の追加、lockfileの作り直し。
- セキュリティ設定の緩和（listen先の緩和、LAN公開、トンネル等）。
- 業務ロジック・判定式の変更。

## 移植する内容
- 参照元 `ilist-app/` 直下の `index.html`, `package.json`, `package-lock.json`, `vite.config.js`, `src/`, `server/` を新repoのルートに配置する（新repo内にさらに`ilist-app/`という一段を作らない）。
- データ形 `{ runs, regs, cert }`、`GET /api/data`、`PUT /api/data`、4タブ（帳票／型式ラン／法規DB／認可書実績）を維持する。
- SEEDのtypeId・認可書番号などの識別子・表示は、実車を想起しない架空名（DEMO等）に置き換える。参照整合（型式↔認可書↔法規の対応関係）は保つ。
- 旧DB（data/ilist.db 等）は使わない。新repoでは新規にダミーDBを生成する。
- サーバのlisten先を127.0.0.1に限定する（既存コードは未指定のため変更が必要）。Vite dev serverも127.0.0.1に揃え、APIプロキシ先も127.0.0.1:3001に揃える。

## 既知の未実装・別課題（今夜は対応しない。記録のみ）
- ⑤-0は未着手。
- Excel（指定装置一覧）取り込みは現行ソースに実装なし。今夜も追加実装しない。
- `TODAY`が定数（ハードコード）になっている。
- サーバ読み込み失敗時にも自動保存が走り、SEEDでサーバ側を上書きしうる既存挙動がある（`IListApp.jsx`のuseEffect参照）。

## 受入条件
- `npm ci` が参照元のlockfileのまま成功する。
- `npm run build` が成功する（vite build）。
- Node/npmのバージョンと`node:sqlite`の利用可否を確認し、報告する。
- サーバのlisten先が127.0.0.1限定になっている。Vite設定・プロキシ先も127.0.0.1に揃っている。
- SEEDデータが架空の識別子（DEMO等）になっている。
- `.gitignore`が指定要件（node_modules/, dist/, data/, .DS_Store, *.log, .env・.env.*, *.db関連, *.sqlite*, Excel/CSV/PDF, .claude/settings.local.json）を除外する。
- READMEに移植元・導入手順・Node前提・ダミー専用／業務利用未検証・⑤-0とExcel取り込み未完、が明記されている。
- 画面上にダミー専用・検証中である旨の短い表示がある。
- 実際のブラウザ起動確認はユーザーが行う。AIが実行できなかった場合は「未実行」と明記する。
