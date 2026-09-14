# 現在のタスク（現在地）

このファイルは「次回のClaude Codeが短時間で再開できる現在地」だけを保持する。
過去の実装・検証・判断の詳細（2026-09-05〜2026-09-12分）はすべて
[docs/current-task-history-2026-09.md](current-task-history-2026-09.md) に分離済み。
作業前に必ず [AGENTS.md](../AGENTS.md) を読むこと。Notion正本の確認は本整理作業では不要（次回作業では別途要否を判断）。

## repo／単体HTMLの目的
- 本repoは既存アプリ（React/Vite + Node標準HTTP/SQLite、データ形 `{ runs, regs, cert }`、4タブ：帳票／型式ラン／法規DB／認可書実績）のダミー専用移植。参照元は `../i-list-reference/ilist-app/`（読取専用・コピー元としてのみ扱う）。
- 単体HTML版（`standalone/`）はサーバなしの手入力デモ。業務ロジックはAPI版と共通コードを使い、二重管理しない。
- **画面・データはダミーのみ**。会社資料・実車情報・実日程・実認可番号・秘密情報は扱わない。
- API版・単体版とも**業務利用は未検証**。会社利用可否の判断はしていない。

## 現在のbranch・repo
- repo: `/Users/inouesho/i-list/i-list`
- branch: `chore/bootstrap`
- 最新機能の基準commit：`d62d939719975996d54689e6095811ca7d76c640`（下記「push済み主要commit」参照）
- 文書整理（本ファイルの分離）開始時点では `origin/chore/bootstrap` と同期済みだった。実際のHEADは`git log`／`git status`で都度確認すること（本ファイル分離のcommit自体のhashは、自己参照を避けるためここには記載しない）。

## push済み主要commit
- `d26bd108139d0a362d290ff6ca8a61ee23a5b611` — 単体HTMLへのCSPメタ追加（最小・単体版のみ）
- `d62d939719975996d54689e6095811ca7d76c640` — プロジェクト別の適用判断（decisions）＋プロジェクト・型式 表示フィルター
- それぞれの実装・検証・レビュー詳細は [docs/current-task-history-2026-09.md](current-task-history-2026-09.md) を参照。

## 現在の残存差分
- `docs/current-task.md`：本整理作業（現在地／履歴への分離）による変更のみ。アプリコード（`src/`・`standalone/`・`server/`等）に差分はない。
- `docs/current-task-history-2026-09.md`：本整理作業で新規作成（履歴移動先）。
- `.claude/`：未追跡。由来未確認のため今回も未操作・未読（`.claude/launch.json` を含め触れていない）。
- いずれも**未stage**。stage→commit→pushはユーザー承認後のみ（[AGENTS.md](../AGENTS.md) のGit運用ルール参照）。

## 現在の機能状態と未確認事項
実装・push済み（詳細は履歴ファイル参照）：保存保護（読込失敗時のPUT抑止等）／単体HTML版（サーバなし手入力デモ）／
データ入りHTML保存（起動データ埋め込み方式）／黄色30日接近予告／プロジェクト別の適用判断・理由メモ（`decisions`）／
プロジェクト・型式 表示フィルター（単体HTML版のみ）／単体HTMLへのCSPメタ追加。

共通の未確認事項（全機能に共通して残っている）：
- **人手による目視・操作確認は未実施。** これまでの検証はすべてヘッドレスChromeの自動操作。
- **Chrome以外（Edge・Safari・Firefox等）、通常プロファイルのChrome、ブラウザ終了・再起動をまたいだ確認は未実施。**
- **実APIサーバ（`server/index.js`）・実DBとの結合確認は未実施。** API版の検証はfetchモック。
- 終了時の実ダイアログ表示は未実測（`beforeunload`ハンドラの登録・キャンセル扱いまでを確認）。
- `save-guard` のSKIP（`M-unmount-inflight-put`）、サーバ側の書込順序の競合は引き続き未解消。
- 「要再確認」解除条件（明示再確定のみ）と実装（状態変更を伴う保存でも解除される）の差は未解消・判断待ち（履歴ファイル2026-09-09分参照）。

## 次の一手
次回の作業内容は次回の依頼・Notion正本待ち（現時点で確定した次タスクはない）。着手前に：
1. [AGENTS.md](../AGENTS.md) と本ファイルを読み、上記の残存差分・未確認事項を確認する。
2. 上記「現在の機能状態と未確認事項」のうち、今回依頼に関係する項目を優先して扱う。
3. 詳細な経緯が必要な場合のみ [docs/current-task-history-2026-09.md](current-task-history-2026-09.md) と [docs/handoff.md](handoff.md) を参照する。

## 安全境界（毎回守る）
- 画面・データは**ダミーのみ**。会社資料・実車情報・実日程・実認可番号・秘密情報は扱わない。
- **会社利用は未承認。** 「業務利用可」と判断しない。
- `npm run dev`・実APIサーバ起動・既存DB操作・LAN公開／トンネル／外部公開はしない（127.0.0.1限定）。
- 依存パッケージ・権限・セキュリティ設定の変更（追加・更新・緩和いずれも）は無断で行わない。
- Gitのstage／commit／pushは、対象ファイル・差分要約・検証結果・commit案・push先をユーザーへ提示し、明示承認後にのみ、承認範囲だけ実行する（`git add .`／`-A`は使わない。詳細は[AGENTS.md](../AGENTS.md)）。

## ポインタ
- [AGENTS.md](../AGENTS.md) — Git運用ルール・秘密情報の扱い等、開発ルールの正本。
- [docs/handoff.md](handoff.md) — 2026-09-08分（データ入りHTML保存／黄色30日接近予告）の引き継ぎ報告。
- [docs/current-task-history-2026-09.md](current-task-history-2026-09.md) — 2026-09-05〜2026-09-12分の実装・検証・レビューの詳細記録（時系列）。
