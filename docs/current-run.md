# Current Run

実装開始前に凍結する実行契約。進行状態のログではない。
実装AI・レビューAIはこのファイルを変更しない。

- Task: F-23（docs/current-task.md）
- Workflow: visual-first
- Implementer: Codex
- Reviewer: Claude Code
- Reviewer model: claude-opus-5-5
- Reviewer effort: high
- Review invocation: docs/claude-review.md の起動形（読み取り専用、Readのみ）。`--effort` は high を指定する
- Review rounds: 1
- Fix rounds: 1

## Gates

1. 停止①（方向性確認）：実装→セルフ検証の後に停止し、色分け・○の入力UIなどの見せ方を人が確認する。方向性が否定されたらレビューへ進まない
2. 停止②（最終確認）：レビュー→指摘修正1回→再検証の後に停止し、人が最終確認する。pushは別承認

## Immutable

- docs/current-task.md を変更しない
- Preparation modeでの初回生成または空欄テンプレートの充填は許可する
- 充填後はcurrent-run.mdを変更しない
- Implementation modeとReview modeでは変更禁止
- workflow、実装AI、レビューAI、停止点、回数を自己判断で変更しない
- 仕様変更が必要なら実装を停止し、Notion更新後に/prepare-fを再実行する
- Notion を読み書きしない
- push、権限変更、仕様変更は別承認
