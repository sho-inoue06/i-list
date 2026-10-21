# AGENTS.md — Iリスト 開発ルール（要約）

このファイルは禁止と境界だけを持つ。手順（工程の順序・観点・報告形式）は「手順の索引」に挙げたファイルに置く。

## 優先順位

- 手順ファイル・skill・current-run.md はこのファイルの境界を緩めない。矛盾したらこのファイルを優先して停止する。
- `AGENTS.md`の安全境界をworkflowやSkillで緩和しない。

## 共通の禁止と境界

- 実装前に必ず [docs/current-task.md](docs/current-task.md) を読む。
- `docs/current-task.md`が存在しない場合は、実装を開始せず停止する。`docs/current-task-legacy-2026-09.md`を代用せず、`/prepare-f`で実行仕様が生成されるまで待つ。
- Notion「Iリスト｜仕様・開発方針」を仕様・判断理由の正本とする。開発ルールの正本はこのファイルで、Notionには写さない。読んでいない内容を読んだと報告しない。
- 画面・データは**ダミーのみ**。会社実データ・秘密情報は扱わない。
- Git運用ルール：
  - 状態を変更しない確認（status／diff／log／remote -v／rev-parse等）は実行してよい。
  - 書込前に、repo・ブランチ・対象ファイル・差分要約・検証結果と残件・コミット案・push先・送信する全コミットを提示する。提示後に差分・送り先・送るコミットが変わったら再確認する。
  - 明示承認後、その範囲だけをファイル指定でstage→差分再確認→commit→通常pushできる。無関係な変更・既存stage済み変更を勝手に取り込まない。
  - stageは常にファイル指定で行う（`git add .`／`git add -A` は使わない）。ignoreの強制解除はしない。秘密情報・会社実データ・DBはstageしない。
  - 作業ブランチ（`feat/f-xx` のような機能単位の名前）へのcommitは、実装・セルフ検証・レビュー後の修正など区切りごとに行う限り、都度承認なしでよい（1回にまとめない）。承認不要はcommitのみで、pushは常に明示承認を要する。commitとpushの承認は1回にまとめてよいが、commitだけの承認にpushを含めない。
  - mainへの直接commit・push・mergeはしない（承認があっても行わない）。PR作成、mainへのマージ、branch削除、tag付けは祥が行う。
  - 変更を戻すときは `git revert` を使う。強制push、履歴書換え、reset・変更破棄、remote／Git設定変更、pull／競合解消は別承認。
- 旧repo（i-list-reference）は参照専用。コピー元としてのみ扱い、書き込まない。
- 同一フォルダ／ファイルの編集担当は常に1つに保つ。並行編集で衝突させない。
- 合意済みの範囲と安全境界の内側では、コードを調べれば解決する技術判断・実装・検証・修正を実装担当が続ける（担当・Git承認・権限の制限は緩めない）。対象範囲・仕様・ユーザー体験を変える選択と重要な未確定事項は、推測で埋めず「判断してほしいこと・選択による影響・推奨と理由」を非専門家にも分かる言葉で示して相談する。
- Notionの該当ページまたはバックログの行を着手対象として指示された場合、番号付きの完成条件が明記されていなければ着手せず、理由を1行で祥に差し戻す。
- 依頼に目的・仕様・対象範囲・完成条件がそろっていれば、Notionへの追加確認なしで着手・継続してよい。仕様が欠ける・矛盾する場合は、その点だけ相談する。
- このファイルを変更したら、最終報告に「AGENTS.md変更あり」と明記する。
- 「参照元に実績がある」ことは「このrepoで適合確認済み」を意味しない。移植後は都度検証する。
- 依存パッケージ・権限・セキュリティ設定を無断で変更しない（追加・更新・緩和いずれも不可）。
- LAN公開・トンネル・外部公開はしない。ローカル（127.0.0.1）限定。
- 報告は [docs/procedures/implement.md](docs/procedures/implement.md) の「最終報告の形式」に従い、実装したことと検証できたことを分けて書く。
- `docs/current-task.md` は凍結された今回の実行仕様（WHAT）で、進捗や現在地を書き込まない。履歴はgit historyに残す。同じ内容のログや管理ファイルを増やさない。
- 前提崩れ、安全性、データ破壊、情報持ち出し、権限の疑い：修正もバックログ候補化もせず、停止して報告する。

## ファイルの責務と不変ルール

- `AGENTS.md`：全成果に共通する安全境界と不変ルール。
- `docs/current-task.md`：今回のFのWHAT（目的、対象範囲、完成条件、やらないこと、必須検証）。
- `docs/current-run.md`：今回のHOW（実装AI、レビューAI、モデル、推論強度、手順ファイル）。実行開始前に凍結する契約であり、進行状態のログではない。
- `docs/procedures/`：セッションごとの手順（下の「手順の索引」）。
- `docs/codex-review.md`：Codexレビューの起動設定。
- `docs/claude-review.md`：Claude Codeレビューの起動設定。

実装セッションとレビューセッションは、`docs/current-task.md` と `docs/current-run.md` を読む。実装AI・レビューAIは両ファイルを変更しない。内容が不足、矛盾、または機密混入している場合は着手せず停止する。仕様変更が必要な場合は実装を停止し、Notion更新後に準備Skillで再生成する。

## セッションごとの境界

| セッション | Notion | 書いてよいもの | Git |
|---|---|---|---|
| 準備（`/prepare-f`） | 指定Fページ1件の読み取りのみ | `docs/current-task.md`・`docs/current-run.md` のみ | 開始時のbranch作成1回と、祥の明示承認後の凍結commit1回（2ファイルだけ）。pushは承認があっても禁止 |
| 事前点検（祥の指示） | 禁止 | 無し | 変更禁止 |
| 実装（`docs/current-run.md`） | 禁止 | コード（`docs/current-task.md`・`docs/current-run.md` は不可） | branchの作成・切り替え禁止。commitは上のGit運用ルールどおり、pushは明示承認 |
| レビュー | 禁止 | 無し | 変更禁止 |

- 実装AIとレビューAIを同一セッションにしない。

### 準備

- ユーザーがClaude Codeで `/prepare-f` を明示起動したときだけ許可する。
- 指定されたNotion Fページ1件だけを読み取り可能とする。Notion検索、他ページの読み取り、Notion書き込みは禁止する。
- 実装、レビュー、テストは禁止する。
- Web検索・Web取得、Notion以外のMCP、Claude Code・Codexの起動は行わない。
- 指定Fページ、実装AI、レビューAIのいずれかが未指定の場合は停止する。

### 実装

- Notionの読み取り・書き込み・検索は禁止する。
- `AGENTS.md`、`docs/current-task.md`、`docs/current-run.md`、手順ファイル、必要なコードだけを読む。
- `current-task.md` と `current-run.md` を変更しない。
- 実装AIは指定されたworkflowの範囲だけを実行する。
- 仕様、完成条件、やらないことを自分で変更しない。

### レビュー

- Notionの読み取り・書き込み・検索は禁止する。
- 実装AIとは別系統・別セッションでレビューする。
- コード、`current-task.md`、`current-run.md`、手順ファイル、必要な設定だけを読む。
- コード、Git状態、`current-task.md`、`current-run.md` を変更しない。
- レビューAIは読み取り専用。書き込まない。
- モデルと推論強度は各設定ファイルの値から変えない。変える必要が生じた場合は、実行前に祥へ理由を報告して確認する。
- レビュー起動は、`current-run.md`で指定され、必要な承認が得られた場合だけ行う。
- CodexからClaude Codeを起動する場合、`docs/claude-review.md`の読み取り専用条件に従う。
- Codex全体のdanger-full-access化、認証情報の受け渡し、OAuthトークンの環境変数設定は禁止する。

## 手順の索引

- 着手前に自分のセッションの手順ファイルを読む。見つからなければ停止する。
- 報告の1行目に「読んだ手順：<パス>（版：<版>）」を書く。

| セッション | 手順ファイル |
|---|---|
| 準備 | [.claude/skills/prepare-f/SKILL.md](.claude/skills/prepare-f/SKILL.md) |
| 事前点検 | [docs/procedures/precheck.md](docs/procedures/precheck.md) |
| 実装 | [docs/procedures/implement.md](docs/procedures/implement.md) |
| レビュー | [docs/procedures/review.md](docs/procedures/review.md) |

## セッションと成果単位

- 1セッションにつき1成果単位とする。1成果単位＝1branch。branchを切るのは準備セッションだけ。前の作業branchの上に、別の成果を積まない。
- branch名は次を基本とする：機能 `feat/f-xx`、進め方・基盤 `chore/内容`、記録整理 `docs/内容`。
- 着手時に、現在のbranch、HEAD、未コミット差分、mainとの差を確認する。
- 実装セッションは、`docs/current-run.md` のTaskに対応するbranchでない、または仕様凍結commitが無い場合は着手せず停止する。
- mainへのマージ方式はsquashを基本とし、1成果単位をmain上の1commitにする。
