---
name: prepare-f
description: Notionの指定したFページを、機密情報を除いたcurrent-task.mdとcurrent-run.mdへ変換する準備作業
disable-model-invocation: true
argument-hint: "[FページURL] [workflow] [implementer] [reviewer]"
---

# prepare-f

## 目的

明示的に起動されたときだけ、Notionの指定Fページ1件を読み取り、repo内の次の2ファイルを実装用に準備する。

- docs/current-task.md
- docs/current-run.md

このSkillは実装、レビュー、commit、pushを行わない。

## 起動条件

- ユーザーが明示的に `/prepare-f` を実行したときだけ動く
- 指定されたNotion FページのURLが必要
- workflow、実装AI、レビューAIが指定されていない場合は推測せず停止する
- Notion検索で候補を探さない
- 指定URL以外のNotionページを読まない

## Notionの扱い

- 指定されたFページを読み取り専用で読む
- Notionへ書き込まない
- コメント、議論、他ページ、バックログ全体を読まない
- Notion URLをcurrent-task.mdへ書かない
- Notionの内容をそのまま外部AIへ渡さず、実行に必要な情報だけを抽出する

## current-task.mdへ入れる内容

- F番号または成果識別子
- 目的
- 対象範囲
- 番号付き完成条件
- 出てはいけないもの
- やらないこと
- 必須検証
- 実装に必要な未決事項

## current-task.mdへ入れない内容

- 会社実データ
- 個人情報
- 秘密情報
- 認証情報
- Notion URL
- 実装に不要な人名、組織名、案件名
- 他のFやバックログ全体
- 優先順位
- 長い判断履歴
- branch、HEAD、push状況
- 実装結果、レビュー結果、過去の作業履歴

機密情報や会社固有情報を抽象化できない場合は、ファイルを書かず停止して確認を求める。

## current-run.mdの作成

docs/workflow-profiles.mdから、指定されたworkflowの手順を読み取る。

指定された値を使ってdocs/current-run.mdを作成する。

- Task
- Workflow
- Implementer
- Reviewer
- Reviewer model
- Reviewer effort
- Review invocation
- Review rounds
- Fix rounds
- Gates：今回の人間確認・停止点を書く
- Immutable：テンプレートにある固定ルールを維持する。Immutable節自体はprepare-fが書き換えない

workflow、実装AI、レビューAI、モデル、effortを推測しない。
未指定の値が必要な場合は停止して質問する。

## ファイル変更の境界

- 変更してよいのは docs/current-task.md と docs/current-run.md だけ
- .claude/skills/prepare-f/SKILL.md自身は実行中に変更しない
- AGENTS.md、README.md、docs/workflow-profiles.md、docs/claude-review.md、docs/codex-review.mdは変更しない
- docs/current-task.mdが存在しない場合は新規作成してよい
- docs/current-task.mdが存在し、空欄テンプレートではない場合は上書きせず停止する
- 既存のcurrent-task.mdの実行仕様を自動的に上書きしない
- docs/current-run.mdが次の空欄テンプレートの場合は、今回のF用に埋めてよい：Task、Workflow、Implementer、Reviewer、Reviewer model、Reviewer effort、Review invocation、Review rounds、Fix roundsが空欄で、Gatesも空欄
- docs/current-run.mdのいずれかの項目に具体的な値が入っている場合は、既存の実行契約を上書きせず停止する
- current-run.mdの安全ルールとImmutable節は維持する
- 空欄テンプレートとは、header項目がすべて空欄、Gatesの番号項目が空欄、Immutableの固定文がテンプレートどおりであるものをいう。この条件を満たさない場合は停止する
- `## Immutable`はテンプレートの固定ルールとして維持する。Preparation modeでは空欄テンプレートを充填できるが、Implementation modeとReview modeでは変更しない
- workflow、実装AI、レビューAI、モデル、effortはユーザー指定値を使い、推測しない
- current-task.mdとcurrent-run.mdは一時ファイルとして生成してから内容を検査する
- 機密情報が混入していないことを確認し、検査に失敗した場合は既存ファイルを変更しない
- 検査成功後にだけ対象ファイルへ反映する
- stage、commit、pushをしない
- branchを作成・変更しない
- 実装やテストをしない

## 実行後の報告

次だけ報告する。

1. 指定されたFページを読めたか
2. 抽出したF識別子
3. workflow、実装AI、レビューAI、モデル、effort
4. current-task.mdとcurrent-run.mdを作成したか
5. 除外・抽象化した情報の種類
6. 機密情報を含めていないことの確認
7. git status
8. stage、commit、pushを行っていないこと

追加作業をせず停止する。

【禁止】

- Claude Codeの自動起動
- Codexの起動
- Notionへの書き込み
- Notion検索
- 他ページの読み取り
- Web、MCP、外部通信
- AGENTS.mdの変更
- README.mdの変更
- 具体的な実行仕様が入ったcurrent-task.mdは上書きしない
- 具体的な実行契約が入ったcurrent-run.mdは上書きしない
- current-task.mdが存在しない場合は新規作成してよい
- current-run.mdが空欄テンプレートの場合だけ、今回のF用に充填してよい
- 空欄テンプレート以外のcurrent-run.mdは上書きしない
- commit、push
