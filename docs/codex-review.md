# Codexレビュー：起動方法と設定

AGENTS.md は運用ルールだけを持つ。古くなりやすい値（コマンド・バージョン・モデル・推論強度）はこのファイルに置く。
値を変えたら「最終確認日」を更新する。

- 最終確認日：2026-11-21
- Codex CLI：codex-cli 0.154.0（`codex --version`、2026-11-21 確認）
- モデル：GPT-6 Astra（`gpt-6-astra`）
- 推論強度：high（通常のレビュー設定）
  - `~/.codex/config.toml` の既定も `high` だが、既定に依存せず起動時に毎回 `-c model_reasoning_effort="high"` を明示する。
  - 明示指定の効きは実機で確認済み（起動ヘッダーに `reasoning effort: high`）。

## 起動コマンド

repoルートで実行する。レビュー依頼文（完成条件・レビューで見るもの／見ないもの）を `PROMPT_FILE` に書き、標準入力で渡す。

```bash
codex exec --ephemeral -s read-only -C "$(git rev-parse --show-toplevel)" \
  -m gpt-6-astra -c 'model_reasoning_effort="high"' \
  -c 'web_search="disabled"' --disable apps - < "$PROMPT_FILE"
```

- `-s read-only`：読み取り専用。Codexは書込しない。
- `--ephemeral`：セッションを保存しない。
- `--ignore-user-config` は付けない（付けるとモデル指定などの既定が外れる）。
- `-c 'web_search="disabled"'`：組み込みのWeb検索（出力の `web_search` の項目）に対する指定。
- `--disable apps`：codex_apps（出力の `codex_apps` のツール呼び出し）に向けた指定。機能 `apps` を false にする（`codex exec --help`：`--disable <FEATURE>` は `-c features.<name>=false` と同じ）。`apps` と codex_apps の対応はヘルプに書かれていない。
- 既知の制約：
  - 組み込みのWeb検索：止めている（2026-11-21の対照で、指定なし3件→指定あり0件）。
  - codex_apps：指定は入れているが、効いたかは未確認（2026-11-21は指定なしでも呼ばれず、対照が取れなかった）。2026-11-20 には指定なしで codex_apps 経由の検索とページ取得を観測している。
  - read-onlyでも `node_repl` MCP によるJS実行は止められない（2026-09の過去レビューで確認。`-c mcp_servers={}` も無効）。読取は `-C` 配下に限る運用で、2026-09 の過去レビューでは書込・git・build・network は発生しなかった（2026-09 時点の観測で、それ以降は確かめていない）。
