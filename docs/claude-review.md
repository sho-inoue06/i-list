# Claude Code レビュー起動設定

Codex実装時の読み取り専用レビュー担当。Codexレビューの設定は docs/codex-review.md を参照する。両者を混在させない。

## 前提

- 実行前に次を確認する。
  ```text
  command -v claude
  claude --version
  claude auth status --text
  ```
- CLIは次のように解決する。
  ```bash
  CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude)}"
  ```
- `CLAUDE_BIN`が解決できない場合は停止する。
- 認証方式は実行環境の確認事項とし、トークンや認証情報をCodexへ渡さない。
- 実行環境によって認証ストアへのアクセス承認が必要になる場合がある。
- 必要な場合はClaude起動コマンド1件だけを明示的に承認する。
- Codex全体を danger-full-access にしない。
- OAuthトークン・認証情報をCodexへ渡さない。

## 標準設定

- model: claude-opus-5-5
- effort: medium（法規判定・データ破壊・境界値が重いFは high）
- 許可ツール: Read のみ
- Bash、Edit、Write、Web、MCP は与えない

## 起動形

$CLAUDE_BIN -p "$PROMPT" \
--model claude-opus-5-5 \
--effort medium \
--safe-mode \
--output-format json \
--permission-mode dontAsk \
--permission-prompts none \
--tools 'Read' \
--allowedTools 'Read' \
--mcp-config '{"mcpServers":{}}' \
--strict-mcp-config \
--no-session-persistence

## レビュー依頼に含めるもの

- docs/current-task.md の完成条件を基準にすること
- 対象ファイル・対象差分の範囲
- 指摘に完成条件番号または再現手順を付けること
- 命名・整形・リファクタリング・性能改善を指摘しないこと
- ファイル変更、Git操作、外部通信、MCP、Web、Notion を行わないこと
- 指摘がなければ「指摘なし」と回答すること

## 実行前後の確認

外側のCodexが branch、HEAD、git status --short、stage、git diff --stat を比較する。

## 検証済み

2026-09-24、読み取り専用の接続試験とダミー差分レビューに成功。
claude-sonnet-5 / effort low で完成条件番号と再現手順付きの指摘を取得。
Git状態は前後で不変。
