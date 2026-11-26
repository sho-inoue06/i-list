// 「データ入りHTML」の書き出し（単体版専用）：起動時データの埋め込み・読み取りと、雛形の保持。

import { parseImportedData } from "./data.js";

// ───────────────────────────────────────────────
// 「データ入りHTML」書き出し（単体版専用）。
//
// 起動時データを埋め込むための場所は、standalone/index.html に置いた
// 制御されたマーカーの間（<!--ILIST_BOOT_DATA_START--> 〜 <!--ILIST_BOOT_DATA_END-->）
// にある <script type="application/json" id="ilist-boot-data"> 1個所に限定する。
// 描画済みDOMの丸ごと保存はしない（テンプレートは常にビルド済みのアプリコードのまま）。
//
// type="application/json" のscriptはブラウザに実行されない（構文チェックもされない）ため、
// ここで気を付けるべきはJSON構文そのものではなく「HTML側のトークン化を壊さないこと」。
//   ・"</script" を含む文字列 → そのscript要素が早期に終端してしまう
//   ・"<!--" を含む文字列 → 直後のHTMLコメント終端(-->)がここで閉じてしまう場合がある
// この2つをJSON文字列化のあとにエスケープする（内容は変えず、区切りとして解釈されなくする）。
// ───────────────────────────────────────────────
export const BOOT_DATA_START = "<!--ILIST_BOOT_DATA_START-->";
export const BOOT_DATA_END = "<!--ILIST_BOOT_DATA_END-->";

// JSON文字列をHTMLの<script>要素へ安全に埋め込むためのエスケープ。
// JSONの構文・値は変えない（< 等はJSON.parseで通常の文字へ戻る）。
const escapeForInlineScript = (jsonText) =>
  jsonText
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

// html中の <script ...>〜</script> の中身を、同じ長さの空白で覆い隠す。
// 「起動データのマーカーはHTML側に1個所だけ存在する」ことを確認したいが、
// この単体版はページ自身の雛形（HTML全文）を文字列としてscriptの中に持つため、
// script本文の中にも同じマーカー文字列が（データとして）現れる。
// マーカーの位置を数えるときはscript本文を除外し、実際のHTML構造だけを見る。
// 置換そのものは、この関数が返す位置に対して「元のhtml」へ行うため、内容は変えない。
const maskScriptBodies = (html) =>
  html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_m, open, body, close) =>
    open + " ".repeat(body.length) + close
  );

// 現在のHTML文字列から、起動データのマーカー区間を1個所だけ置き換える。
// マーカーはHTML構造上（script本文を除いて）1個所（開始・終了とも1回ずつ）でなければ拒否する
// （テンプレート構造の想定外を検出するため。script本文中に同じ文字列が現れても数えない）。
export function replaceBootData(html, data) {
  const masked = maskScriptBodies(html);
  const startCount = masked.split(BOOT_DATA_START).length - 1;
  const endCount = masked.split(BOOT_DATA_END).length - 1;
  if (startCount !== 1 || endCount !== 1) {
    return { ok: false, error: "起動データの埋め込み場所を特定できませんでした（テンプレートの構造が想定と異なります）。" };
  }
  const startIdx = masked.indexOf(BOOT_DATA_START);
  const endIdx = masked.indexOf(BOOT_DATA_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { ok: false, error: "起動データの埋め込み場所を特定できませんでした（マーカーの順序が想定と異なります）。" };
  }
  // masked と html は同じ長さ・同じオフセットなので、位置だけをそのまま元のhtmlへ流用できる
  const json = escapeForInlineScript(JSON.stringify(data));
  const block =
    BOOT_DATA_START +
    `\n    <script type="application/json" id="ilist-boot-data">${json}</script>\n    ` +
    BOOT_DATA_END;
  const next = html.slice(0, startIdx) + block + html.slice(endIdx + BOOT_DATA_END.length);
  return { ok: true, html: next };
}

// ページに埋め込まれた起動データ（#ilist-boot-data）を読み取る。
// 「無い」（初回配布のテンプレートそのもの）と「あるが壊れている」を区別して返す。
//   present=false … 埋め込みが無い（通常のテンプレート起動。SEEDを使ってよい）
//   present=true, ok=false … 埋め込みはあるが読めない（黙ってSEEDへ置き換えてはいけない）
//   present=true, ok=true  … 埋め込みを読めた
export function readBootData(doc = document) {
  const el = doc.getElementById("ilist-boot-data");
  if (!el) return { present: false };
  const text = el.textContent;
  if (text == null || text.trim() === "" || text.trim() === "null") return { present: false };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { present: true, ok: false, error: "埋め込みデータのJSONを解析できませんでした。" };
  }
  const parsed = parseImportedData(raw);
  if (!parsed.ok) return { present: true, ok: false, error: parsed.error };
  return { present: true, ok: true, data: parsed.data, maxId: parsed.maxId, maxRid: parsed.maxRid };
}

// ページ自身に埋め込まれた「まっさらな雛形」（#ilist-template）を読み取る。
//
// file:// で開いたページは自分自身を fetch/XMLHttpRequest で読み直せない
// （Chromeで実測して確認済み：どちらも失敗する）。そのため、ビルド時点の雛形HTMLを
// あらかじめ文字列としてページに持たせておき、保存時はその文字列を使う。
// 描画済みDOMを読むわけではない（document.documentElement.outerHTMLは使わない）。
//
// 雛形文字列そのものは「雛形枠（#ilist-template）が空文字のままの状態」で保存されている
// （ビルド時に scripts/inline-standalone.mjs が埋め込む。自己参照で際限なく入れ子にしないため）。
const TEMPLATE_START = "<!--ILIST_TEMPLATE_START-->";
const TEMPLATE_END = "<!--ILIST_TEMPLATE_END-->";

// 雛形はBase64で運ぶ（"<" 等のHTML特殊文字を一切含まない文字列になるため、
// HTML側のトークン化を壊す心配がなく、手作りのエスケープ／アンエスケープも不要になる）。
// UTF-8（日本語を含む）を経由するため TextEncoder/TextDecoder を使う。
function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function base64ToUtf8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function readTemplateHtml(doc = document) {
  const el = doc.getElementById("ilist-template");
  if (!el) return { ok: false, error: "雛形（#ilist-template）が見つかりません。" };
  const text = el.textContent;
  if (!text || text.trim() === "") {
    return { ok: false, error: "雛形が空です。このページは「データ入りHTMLを保存」に対応していないビルドの可能性があります。" };
  }
  let html;
  try {
    html = base64ToUtf8(text.trim());
  } catch {
    return { ok: false, error: "雛形（Base64）を解読できませんでした。" };
  }
  return { ok: true, html };
}

// html中の雛形マーカー区間へ、雛形文字列そのもの（Base64化して）を書き込む。
// 保存のたびに「雛形は不変の定数として次のファイルへそのままコピーする」ことで、
// 保存版から編集→再保存→さらに新しく開く、という連鎖を成立させる
// （このコピーをしないと、保存版には空の雛形枠しか残らず、次の保存ができなくなる）。
function embedTemplateSlot(html, templateText) {
  const masked = maskScriptBodies(html);
  const startCount = masked.split(TEMPLATE_START).length - 1;
  const endCount = masked.split(TEMPLATE_END).length - 1;
  if (startCount !== 1 || endCount !== 1) {
    return { ok: false, error: "雛形の埋め込み場所を特定できませんでした（テンプレートの構造が想定と異なります）。" };
  }
  const startIdx = masked.indexOf(TEMPLATE_START);
  const endIdx = masked.indexOf(TEMPLATE_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { ok: false, error: "雛形の埋め込み場所を特定できませんでした（マーカーの順序が想定と異なります）。" };
  }
  const b64 = utf8ToBase64(templateText);
  const block =
    TEMPLATE_START +
    `\n    <script type="text/plain" id="ilist-template">${b64}</script>\n    ` +
    TEMPLATE_END;
  const next = html.slice(0, startIdx) + block + html.slice(endIdx + TEMPLATE_END.length);
  return { ok: true, html: next };
}

// 現在のデータを埋め込んだ新しいHTML文字列を組み立てる（ダウンロードするのは呼び出し側）。
// 1) 雛形（#ilist-template）を読む
// 2) 雛形の起動データ枠を現在のデータで置き換える
// 3) その結果へ、同じ雛形文字列をもう一度（雛形枠として）書き戻す
//    （そうしないと、生成したHTMLは「次の保存」ができないファイルになってしまう）
export function buildSavedHtml(data) {
  const tpl = readTemplateHtml();
  if (!tpl.ok) return tpl;
  const withData = replaceBootData(tpl.html, data);
  if (!withData.ok) return withData;
  return embedTemplateSlot(withData.html, tpl.html);
}
