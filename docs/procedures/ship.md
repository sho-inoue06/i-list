版：2026-10-23

# 出荷の手順

禁止と境界は [AGENTS.md](../../AGENTS.md) に従う。このファイルは手順だけを持ち、AGENTS.md の境界を緩めない。矛盾したら AGENTS.md を優先して停止する。

実装セッションが、最終停止の後に祥の出荷承認を得た場合だけ実行する。

## 前提確認

1つでも満たさなければ、何もせず停止して報告する。

1. 祥の出荷承認がある（最終停止の報告に対して「出荷」と明示されている）
2. 現在のbranchが作業branchで、承認時に報告したHEADと現在のHEADが一致する
3. 未コミット差分が無い
4. `gh` が使え、認証済み（`gh auth status`）。使えなければ停止して祥に返す

## 手順

1. `git push -u origin <branch>`
2. `gh pr create --base main --head <branch>`（本文は最終報告の要約）
3. PRが mergeable で、base が main、head の SHA が承認時のHEADと一致することを確認する。コンフリクト・base違い・SHA不一致・チェック失敗のどれかがあれば、マージせず停止する
4. `gh pr merge --squash --delete-branch`
5. `git switch main` → `git pull --ff-only origin main`。ff-onlyで失敗したら停止する（競合は解消しない）
6. マージcommitのhash、PR番号、ローカルmainのHEADを報告する
