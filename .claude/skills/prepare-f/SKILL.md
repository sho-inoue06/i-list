---
name: prepare-f
description: Notionの指定したFページを、機密情報を除いたcurrent-task.mdとcurrent-run.mdへ変換する準備作業
disable-model-invocation: true
argument-hint: "[FページURL] [implementer] [reviewer]"
---

# prepare-f

版：2026-10-21

禁止と境界は AGENTS.md（「セッションごとの境界」の準備の行と「### 準備」）に従う。このファイルは手順だけを持ち、AGENTS.md の境界を緩めない。矛盾したら AGENTS.md を優先して停止する。

## 目的

明示的に起動されたときだけ、Notionの指定Fページ1件を読み取り、Fのbranchを用意して、repo内の次の2ファイルを実装用に準備する。

- docs/current-task.md
- docs/current-run.md

祥が事前点検OKを伝えて明示承認した後に、2ファイルだけを1回commitして凍結する。

## 起動条件

- 指定されたNotion FページのURLが必要
- 実装AI、レビューAIが指定されていない場合は推測せず停止する

## 手順の全体

1. Fページを読み、F識別子を抽出する
2. branchを用意する（新規作成、またはやり直しモード）
3. 2ファイルを空欄テンプレートから生成する
4. 報告して停止する（祥が事前点検を行う）
5. 祥の事前点検OKと明示承認の後、凍結commitを1回行う

## 1. Fページの読み取り

- 指定されたFページを読み取り専用で読む
- コメント、議論、他ページ、バックログ全体を読まない
- F識別子（例：F-24）を抽出する。branch名は `feat/f-xx`（F識別子を小文字にしたもの）とする
- F識別子が抽出できない場合は停止する

## 2. branchの用意

### 2-1. 同名branchの有無

- `git rev-parse --verify --quiet refs/heads/<branch>` で同名のローカルbranchの有無を確認する
- 無ければ 2-2 へ、あれば 2-3 へ進む

### 2-2. 新規作成

1. `git status --porcelain` で未コミット差分（未追跡ファイルを含む）が無いことを確認する。1件でもあれば停止する
2. `git fetch origin`
3. `refs/remotes/origin/<branch>` があれば（同名branchが既にある）停止する
4. `git switch -c <branch> origin/main`
5. 作ったbranch上の docs/current-task.md・docs/current-run.md が origin/main の内容と同一（前のFの凍結仕様）なら、そのファイルを空欄テンプレートへ戻す。ファイルが無ければ空欄テンプレートで新規作成する

### 2-3. やり直しモード

`git fetch origin` の後、次の3つをすべて満たすときだけ続行する。1つでも満たさなければ停止する。

- 現在そのbranchにいる（`git branch --show-current` が `<branch>`）
- origin/main より先のcommitが0件（`git rev-list --count origin/main..HEAD` が 0）
- 未コミット差分が docs/current-task.md と docs/current-run.md だけ（`git status --porcelain` に他のパスが1件も無い。stage済みの差分も含めて見る）

満たした場合は、2ファイルを空欄テンプレートへ戻してから 3 へ進む。branchは作らない。

## 3. 2ファイルの生成

### 生成前の確認

- 2-2・2-3の後、2ファイルが下の空欄テンプレートと一致しない場合は上書きせず停止する

### current-task.mdへ入れる内容

- F番号または成果識別子
- 目的
- 対象範囲
- 番号付き完成条件
- 出てはいけないもの
- やらないこと
- 必須検証
- 実装に必要な未決事項

### current-task.mdへ入れない内容

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
Notionの内容をそのまま外部AIへ渡さず、実行に必要な情報だけを抽出する。

### current-run.mdへ入れる内容

- Task：F識別子（docs/current-task.md）
- Implementer：指定された実装AI
- Reviewer：指定されたレビューAI
- Reviewer model・Reviewer effort：レビューAIの設定ファイル（Codexなら docs/codex-review.md、Claude Codeなら docs/claude-review.md）の値を写す。値が条件つきで1つに決まらない場合は停止して質問する
- Procedure：docs/procedures/implement.md のまま変えない
- `## Immutable` はテンプレートの固定文のまま変えない

実装AI、レビューAI、モデル、effortを推測しない。

### 生成と反映

- current-task.mdとcurrent-run.mdは一時ファイルとして生成してから内容を検査する
- 機密情報が混入していないことを確認し、検査に失敗した場合は既存ファイルを変更しない
- 検査成功後にだけ対象ファイルへ反映する

## 空欄テンプレート

### docs/current-task.md

```markdown
# Current Task

凍結された今回の実行仕様（WHAT）。進捗や現在地を書き込まない。
実装AI・レビューAIはこのファイルを変更しない。

## 成果識別子

## 目的

## 対象範囲

## 完成条件

## 出てはいけないもの

## やらないこと

## 必須検証

## 実装に必要な未決事項
```

### docs/current-run.md

```markdown
# Current Run

実装開始前に凍結する実行契約。進行状態のログではない。
実装AI・レビューAIはこのファイルを変更しない。

- Task:
- Implementer:
- Reviewer:
- Reviewer model:
- Reviewer effort:
- Procedure: docs/procedures/implement.md

## Immutable

- docs/current-task.md を変更しない
- Preparation modeでの初回生成または空欄テンプレートの充填は許可する
- 充填後はcurrent-run.mdを変更しない
- Implementation modeとReview modeでは変更禁止
- workflow、実装AI、レビューAI、停止点、回数を自己判断で変更しない
- 仕様変更が必要なら実装を停止し、Notion更新後に/prepare-fを再実行する
- Notion を読み書きしない
- push、権限変更、仕様変更は別承認
```

空欄テンプレートとの一致は、上の本文とファイル全体が一致することで判定する。current-run.md は Task・Implementer・Reviewer・Reviewer model・Reviewer effort が空欄で、Procedure と Immutable が上のとおりであることをいう。

## 4. 報告して停止

1行目に「読んだ手順：.claude/skills/prepare-f/SKILL.md（版：<版>）」を書き、次を報告して停止する。

1. 指定されたFページを読めたか
2. 抽出したF識別子
3. branch名と、新規作成かやり直しモードか
4. 実装AI、レビューAI、モデル、effort
5. current-task.mdとcurrent-run.mdを作成したか
6. 除外・抽象化した情報の種類
7. 機密情報を含めていないことの確認
8. git status
9. 凍結commitの案（対象2ファイル、コミットメッセージ `docs: freeze F-xx spec`、pushしないこと）

祥が事前点検（docs/procedures/precheck.md）を行う。点検でNGなら、祥の指示で 2-3 のやり直しモードから生成し直す。

## 5. 凍結commit

次をすべて満たすときだけ、1回だけ行う。1つでも満たさなければcommitせず停止する。

- 祥が事前点検OKを伝え、凍結commitを明示承認した
- 4の報告後に2ファイルの内容が変わっていない（変わっていたら再報告して承認を取り直す）
- このbranchに凍結commitがまだ無い（origin/main より先のcommitが0件）

手順：

1. `git add -- docs/current-task.md docs/current-run.md`
2. `git diff --cached --name-only` が上の2ファイルだけであることを確認する。他のパスがあれば停止する
3. `git commit` を1回行う
4. pushしない。branch、HEAD、git statusを報告して終了する
