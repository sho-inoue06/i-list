# Current Run

実装開始前に凍結する実行契約。進行状態のログではない。
実装AI・レビューAIはこのファイルを変更しない。

- Task: F-26（docs/current-task.md）
- Implementer: Claude Code
- Reviewer: Codex
- Reviewer model: gpt-6-astra（GPT-6 Astra）
- Reviewer effort: high
- Procedure: docs/procedures/implement.md

## Immutable

- docs/current-task.md を変更しない
- Preparation modeでの初回生成または空欄テンプレートの充填は許可する
- 充填後はcurrent-run.mdを変更しない。ただし凍結commit前に限り、準備セッションのやり直しモード（.claude/skills/prepare-f/SKILL.md の 2-3）で空欄テンプレートへ戻して再生成できる
- Implementation modeとReview modeでは変更禁止
- workflow、実装AI、レビューAI、停止点、回数を自己判断で変更しない
- 仕様変更が必要なら実装を停止し、Notion更新後に/prepare-fを再実行する
- Notion を読み書きしない
- push、権限変更、仕様変更は別承認
