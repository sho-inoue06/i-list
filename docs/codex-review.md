# Codexレビュー：起動方法と設定

AGENTS.md は運用ルールだけを持つ。古くなりやすい値（コマンド・バージョン・モデル・推論強度）はこのファイルに置く。
値を変えたら「最終確認日」を更新する。

- 最終確認日：2026-09-21
- Codex CLI：codex-cli 0.154.0（`codex --version`）
- モデル：GPT-6 Astra（`gpt-6-astra`）
- 推論強度：high（通常のレビュー設定）
  - `~/.codex/config.toml` の既定も `high` だが、既定に依存せず起動時に毎回 `-c model_reasoning_effort="high"` を明示する。
  - 明示指定の効きは実機で確認済み（起動ヘッダーに `reasoning effort: high`）。

## 起動コマンド

repoルートで実行する。レビュー依頼文（完成条件・レビューで見るもの／見ないもの）を `PROMPT_FILE` に書き、標準入力で渡す。

```bash
codex exec --ephemeral -s read-only -C "$(git rev-parse --show-toplevel)" \
  -m gpt-6-astra -c 'model_reasoning_effort="high"' - < "$PROMPT_FILE"
```

- `-s read-only`：読み取り専用。Codexは書込しない。
- `--ephemeral`：セッションを保存しない。
- `--ignore-user-config` は付けない（付けるとモデル指定などの既定が外れる）。
- 既知の制約：read-onlyでも `node_repl` MCP によるJS実行は止められない（2026-09の過去レビューで確認。`-c mcp_servers={}` も無効）。読取は `-C` 配下に限る運用で、書込・git・build・network は発生しなかった。
