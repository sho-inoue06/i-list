// ───────────────────────────────────────────────
// vite build（standalone設定）の出力を、単一のHTMLファイルにまとめる。
//
//   実行時に外部ファイルを一切必要としないようにするため、
//   JS・CSSを <script> / <style> としてHTMLへ埋め込み、元の分離ファイルは残さない。
//   依存パッケージは追加していない（Node標準モジュールのみ使用）。
// ───────────────────────────────────────────────
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist-standalone");
const htmlPath = join(outDir, "index.html");
const finalName = "ilist-standalone.html";

if (!existsSync(htmlPath)) {
  console.error("dist-standalone/index.html がありません。先に vite build を実行してください。");
  process.exit(1);
}

let html = readFileSync(htmlPath, "utf8");
const assetsDir = join(outDir, "assets");
const inlined = [];

// <script type="module" src="./assets/xxx.js"></script> を中身で置き換える
html = html.replace(
  /<script\b[^>]*\ssrc="\.?\/?(assets\/[^"]+\.js)"[^>]*><\/script>/g,
  (_m, rel) => {
    const code = readFileSync(join(outDir, rel), "utf8");
    inlined.push(rel);
    // </script> がコード中に現れてもHTMLが壊れないようにする
    return `<script type="module">\n${code.replace(/<\/script>/gi, "<\\/script>")}\n</script>`;
  }
);

// <link rel="stylesheet" href="./assets/xxx.css"> を中身で置き換える
html = html.replace(
  /<link\b[^>]*\srel="stylesheet"[^>]*\shref="\.?\/?(assets\/[^"]+\.css)"[^>]*>/g,
  (_m, rel) => {
    const css = readFileSync(join(outDir, rel), "utf8");
    inlined.push(rel);
    return `<style>\n${css}\n</style>`;
  }
);

// 埋め込み漏れ（外部参照が残っていないか）を検査する。
// file:// で開いたときに読めない参照が残っていれば、ここで失敗させる。
const leftovers = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !u.startsWith("data:") && u !== "#");
if (leftovers.length) {
  console.error("外部参照が残っています:", leftovers);
  process.exit(1);
}
// http(s) 参照が紛れていないかも確認する。
// ただし次の2種類は「取得されないURL」なので許可する：
//   ・XML名前空間URI（http://www.w3.org/...）… SVG等の識別子であり、fetchされない
//   ・Reactのエラー説明URL（https://reactjs.org/docs/error-decoder...）… 例外メッセージ内の文字列
const ALLOWED_URL = /^https?:\/\/(www\.w3\.org\/|reactjs\.org\/docs\/error-decoder)/;
const urls = [...html.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)].map((m) => m[0]);
const external = [...new Set(urls.filter((u) => !ALLOWED_URL.test(u)))];
if (external.length) {
  console.error("外部URLが含まれています。実行時通信が発生する可能性があります:", external);
  process.exit(1);
}

// 「データ入りHTMLを保存」用の雛形埋め込み。
// file:// では自分自身をfetch/XHRで読み直せない（Chromeで実測して確認済み）ため、
// ビルド時点のHTML（この時点ではボットデータ枠は空 "null"、雛形枠は空文字のまま）を
// 文字列としてページ自身に持たせておき、実行時はその文字列から新しいHTMLを組み立てる。
//
// 埋め込む雛形は「雛形枠が空文字のままの状態」でなければならない
// （そうしないと自己参照で際限なく入れ子になる）。
// 保存のたびに、この雛形文字列そのものをそのまま次のファイルへコピーする
// （雛形は不変の定数として運ばれるだけで、実行時に再計算はしない）。
const TEMPLATE_START = "<!--ILIST_TEMPLATE_START-->";
const TEMPLATE_END = "<!--ILIST_TEMPLATE_END-->";
{
  // JSバンドル自身が TEMPLATE_START/END と同じ文字列を定数として持つ（src/IListApp.jsx の
  // embedTemplateSlot が使うため）。マーカーの位置を数えるときはscript本文を覆い隠し、
  // 実際のHTML構造（script本文の外）だけを見る。置換はマスク前のhtmlに対して行う。
  const maskScriptBodies = (s) =>
    s.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_m, open, body, close) => open + " ".repeat(body.length) + close);
  const masked = maskScriptBodies(html);
  const startCount = masked.split(TEMPLATE_START).length - 1;
  const endCount = masked.split(TEMPLATE_END).length - 1;
  if (startCount !== 1 || endCount !== 1) {
    console.error("雛形の埋め込み場所（ILIST_TEMPLATE_START/END）が1個所ではありません:", { startCount, endCount });
    process.exit(1);
  }
  // 雛形はBase64で埋め込む（HTML特殊文字を含まない文字列になるため、手作りのエスケープが不要になる。
  // src/IListApp.jsx の embedTemplateSlot も同じ方式でBase64化する）。
  const b64 = Buffer.from(html, "utf8").toString("base64");
  const startIdx = masked.indexOf(TEMPLATE_START);
  const endIdx = masked.indexOf(TEMPLATE_END);
  const block =
    TEMPLATE_START +
    `\n    <script type="text/plain" id="ilist-template">${b64}</script>\n    ` +
    TEMPLATE_END;
  html = html.slice(0, startIdx) + block + html.slice(endIdx + TEMPLATE_END.length);
}

writeFileSync(join(outDir, finalName), html, "utf8");

// 単一ファイルにしたので、分離アセットと元のindex.htmlは残さない
rmSync(assetsDir, { recursive: true, force: true });
rmSync(htmlPath, { force: true });

const size = Buffer.byteLength(html, "utf8");
console.log(`埋め込み: ${inlined.join(", ")}`);
console.log(`出力: dist-standalone/${finalName}（${(size / 1024).toFixed(0)} KB）`);
console.log(`残ったファイル: ${readdirSync(outDir).join(", ")}`);
