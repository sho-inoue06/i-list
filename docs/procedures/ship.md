版：2026-11-21

# 出荷の手順

禁止と境界は [AGENTS.md](../../AGENTS.md) に従う。このファイルは手順だけを持ち、AGENTS.md の境界を緩めない。矛盾したら AGENTS.md を優先して停止する。

実装セッションが、最終停止の後に祥の出荷承認を得た場合だけ実行する。

## 前提確認

1つでも満たさなければ、何もせず停止して報告する。

1. 祥の出荷承認がある（最終停止の報告に対して「出荷」と明示されている）
2. 現在のbranchが作業branch（Fでは docs/current-run.md のTaskに対応するbranch、chore・docsでは依頼文で指定されたbranch）で、承認時に報告したHEADと現在のHEADが一致する
3. 未コミット差分が無い
4. `gh` が使え、認証済み（`gh auth status`）。使えなければ停止して祥に返す

## 手順

1. `git push -u origin <branch>`
2. `gh pr create --base main --head <branch>`（本文は最後の停止報告を、implement.md の最終報告の形式のまま載せる。要約しない）
3. PRが mergeable で、base が main、head の SHA が承認時のHEADと一致することを確認する。コンフリクト・base違い・SHA不一致のどれかがあれば、マージせず停止する。続けて、PRのチェック（CI）がすべて終わるまで待ち、結果で次のどれかに進む。
   - 待ち方：承認時のHEADに対する run（`gh run list --commit <承認時のHEAD> --json databaseId,status,conclusion,url`）を、run そのものが終わる（全件の status が completed）まで、間をあけて繰り返し確かめる。`gh pr checks --watch` の終了を待ち終わりとしない（2026-11-21、実行中のまま217秒で終わったため）。上限は、手順1の push から20分。
   - すべて成功：run が1件以上あり、全件の conclusion が success で、`gh pr checks <PR番号>` の全件が成功のときだけ、手順4へ進む。
   - 0件・時間切れ：20分たっても run が0件、または終わっていない run があれば、マージせず停止する。
   - 失敗（conclusion が success 以外の run がある）：1回目の失敗の内容（run のURL、失敗したジョブとステップの名前、そのステップの最後の出力。`gh run view <run ID> --log-failed` で見る）を控えてから、失敗したジョブを1回だけ再実行してよい（`gh run rerun <run ID> --failed`）。再実行後は同じ待ち方で、再実行から20分を上限に待つ。再実行後にすべて成功なら手順4へ進む。再実行も失敗、または再実行後20分で終わらなければ、マージせず停止する。2回目の再実行はしない
4. `gh pr merge --squash --delete-branch --match-head-commit <承認時のHEAD>`（確認後にheadが動いていたらマージされない。失敗したら停止する）
5. `git switch main` → `git pull --ff-only origin main`。ff-onlyで失敗したら停止する（競合は解消しない）
6. マージcommitのhash、PR番号、ローカルmainのHEADを報告する。あわせて、手順3のCIについて、run のURL、待った時間、成否、再実行の有無を書く。ログに `npm run verify` の合計の行があればその行を、無ければ止まったステップの名前とそのステップの最後の出力を書く。再実行したときは、再実行したことと1回目の失敗の内容を必ず書く。手順3で停止したときも、ここに書く項目を停止の報告に書く
