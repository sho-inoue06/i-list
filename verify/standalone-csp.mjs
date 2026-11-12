// 単体HTMLのCSPメタ検証。ダミー専用。依存追加なし。実API/実DBは使用しない。
// 先に npm run build:standalone を実行すること。
//   usage: node verify/standalone-csp.mjs <既存の証拠ディレクトリ>
//
// 確認すること：
//   ・CSPメタが初期生成物と「データ入りHTML」再保存物の両方に、同じ内容で残る
//   ・CSPを入れた状態で 起動・表示・JSON読込／書出し・データ入りHTML保存 が壊れない
//   ・CSP違反・consoleエラー・外部ドメイン通信がいずれも0件
//   ・HTML風／外部URL風の文字列を入力しても、実行も送信もされない
//   ・読込失敗時に既存データを壊さない
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { CHROME_PATH } from "../scripts/chrome-path.mjs";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const OUT = process.argv[2];
if (!OUT) throw new Error("usage: node verify/standalone-csp.mjs <existing evidence directory>");
const PAGE_FILE = join(REPO, "dist-standalone/ilist-standalone.html");
const PAGE = `file://${PAGE_FILE}`;
const CHROME = CHROME_PATH;
const PORT = 9335;

// standalone/index.html に書いたCSPと一致していなければならない（取り違え・欠落の検出）。
const EXPECTED_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

// 完全ダミーの敵対的入力。実在の会社情報・実車情報・実認可番号は含まない。
const HTMLISH = '対象外の理由（ダミー）</script><script>window.__PWNED__=1</script><img src=x onerror="window.__PWNED__=2">';
const URLISH = "https://example.invalid/dummy-should-never-be-fetched.js";

const profile = mkdtempSync(join(tmpdir(), "ilist-csp-"));
const dl = mkdtempSync(join(OUT, "downloads-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--host-resolver-rules=MAP * ~NOTFOUND",       // 外部通信を全面遮断（ループバックも開けない）
  "--window-size=1400,1000", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });

let ws = null;
const cleanup = () => { try { ws?.close(); } catch {} try { chrome.kill("SIGTERM"); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

async function target() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const t = list.find((x) => x.type === "page" && x.url === "about:blank");
      if (t?.webSocketDebuggerUrl) return t;
    } catch {}
    await sleep(250);
  }
  throw new Error("ページターゲットに接続できません");
}
const t = await target();
ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("WS失敗")); });

let id = 0; const pending = new Map();
const netUrls = [], consoleErrors = [], cspViolations = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Network.requestWillBeSent") netUrls.push(m.params.request.url);
  if (m.method === "Runtime.exceptionThrown") consoleErrors.push(m.params?.exceptionDetails?.exception?.description || "exception");
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") consoleErrors.push(m.params.args.map((a) => a.description || a.value).join(" "));
  // CSP違反はコンソールではなくLogドメインへ source:"security" として出る。
  if (m.method === "Log.entryAdded") {
    const en = m.params.entry;
    if (en.source === "security" || /Content Security Policy/i.test(en.text || "")) cspViolations.push(en.text);
    else if (en.level === "error") consoleErrors.push(`[log:${en.source}] ${en.text}`);
  }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error("評価失敗: " + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
await send("Runtime.enable"); await send("Network.enable"); await send("Page.enable"); await send("Log.enable");
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl });

const results = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ label, ok, actual, expected });
  console.log(`${ok ? "OK" : "NG"} ${label}${ok ? "" : `\n   実際=${JSON.stringify(actual)}\n   期待=${JSON.stringify(expected)}`}`);
};

// alert/confirm はページ実装が使う。CDPから差し替えて内容を記録する（遷移のたびに入れ直す）。
const installStubs = () => ev(`(() => { window.__ALERTS__ = [];
  window.alert = (m) => { window.__ALERTS__.push(String(m)); };
  window.confirm = (m) => { window.__ALERTS__.push("confirm:" + String(m)); return true; };
  return true; })()`);
const goto = async (url) => { await send("Page.navigate", { url }); await sleep(1000); await installStubs(); };
const cspMeta = () => ev(`(() => { const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  return m ? m.getAttribute("content") : null; })()`);
const click = async (text) => {
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}));
    if (!b) throw new Error('button missing: ' + ${JSON.stringify(text)}); b.click(); })()`);
};
const download = async (button, extension) => {
  const destination = mkdtempSync(join(dl, "export-"));
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: destination });
  await click(button);
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    const file = readdirSync(destination).find((f) => f.endsWith(extension));
    if (file && statSync(join(destination, file)).size) return join(destination, file);
  }
  throw new Error(`download missing: ${button}`);
};
const importFile = async (path) => {
  const doc = await send("DOM.getDocument");
  const el = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: 'input[type="file"]' });
  const r = await send("DOM.setFileInputFiles", { nodeId: el.result.nodeId, files: [path] });
  if (r.error) throw new Error(JSON.stringify(r.error));
  await sleep(500);
};
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

// headのインライン<style>が実際に適用されたかを、そのCSSでしか起きない値で確かめる。
// body の margin は既定8px。0pxになっているなら head の <style> が効いている
// （style-src 'unsafe-inline' が無ければCSPに弾かれ、既定の8pxのままになる）。
const headCssApplied = () => ev(`(() => { const s = getComputedStyle(document.body);
  return [s.marginTop, s.marginLeft, s.backgroundColor]; })()`);

// 敵対的ダミー文字列が「要素にならず、文字として表示されている」ことを確かめる。
// 要素が0件であることだけでは、単に未表示でもPASSしてしまうため、表示側も見る。
const shownAsText = () => ev(`(() => { const t = document.body.innerText;
  return { url: t.includes(${JSON.stringify(URLISH)}),
           reasonHead: t.includes(${JSON.stringify(HTMLISH.slice(0, 22))}),
           elements: document.querySelectorAll('a[href], img, iframe, script[src]').length }; })()`);

// 完全ダミー入力（実在情報なし）。敵対的文字列は reason と reg.label に入れる。
const input = {
  runs: [{ key: "r201", typeId: "DEMO-CSP", gen: "DUMMY-PJ", sk: "新", lo: "2024-01-01", drop: "2027-12-31" }],
  regs: [
    { rid: "g201", id: "DUMMY-A", label: "ダミー法規A", shin: "2023-01-01", kei: "2025-01-01", parent: "" },
    { rid: "g202", id: "DUMMY-B", label: URLISH, shin: "2023-02-01", kei: "2026-02-10", parent: "" },
  ],
  cert: { "DEMO-CSP": { "DUMMY-A": "DUMMY-CERT" } },
  decisions: [{ runKey: "r201", rid: "g202", state: "対象外", reason: HTMLISH,
    decidedAt: "2026-09-01 10:11", needsRecheck: false, cond: null }],
};
const inputPath = join(OUT, "csp-input.json");
writeFileSync(inputPath, JSON.stringify(input, null, 2));

// ── ① 初期の単体HTML ───────────────────────────
await goto(PAGE);
check("初期HTML：CSPメタが期待どおり", await cspMeta(), EXPECTED_CSP);
check("初期HTML：アプリが描画された（#rootに中身がある）", await ev(`document.getElementById('root').childElementCount > 0`), true);
check("初期HTML：4タブが出ている", await ev(`['帳票','型式ラン','法規DB','認可書実績']
  .every(n => [...document.querySelectorAll('button')].some(b => b.textContent.includes(n)))`), true);
// style-src 'unsafe-inline' が効いていること：head の <style> と Reactの style 属性の両方。
check("初期HTML：headのインライン<style>が適用されている（body margin 0px・背景色）",
  await headCssApplied(), ["0px", "0px", "rgb(12, 22, 35)"]);
check("初期HTML：インライン<style>がCSPに弾かれていない（stylesheetが生きている）",
  await ev(`document.styleSheets.length > 0 && document.styleSheets[0].cssRules.length > 0`), true);
check("初期HTML：Reactのstyle属性が適用されている（背景が透明でない）",
  await ev(`getComputedStyle(document.querySelector('#root > div')).backgroundColor`), "rgb(12, 22, 35)");
check("初期HTML：script-srcで本体が動いている（保存ボタンがある）",
  await ev(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('データ入りHTMLを保存'))`), true);

// ── ② JSON読込（敵対的ダミー文字列つき） ─────────
await importFile(inputPath);
check("JSON読込：HTML風文字列は実行されない", await ev(`window.__PWNED__ === undefined`), true);
check("JSON読込：URL風・HTML風の文字列が、要素にならず文字として表示される",
  await shownAsText(), { url: true, reasonHead: true, elements: 0 });

// ── ③ JSON書出し（Blobダウンロード） ─────────────
const savedJSON = await download("JSONに書き出し", ".json");
{
  const d = JSON.parse(readFileSync(savedJSON, "utf8"));
  check("JSON書出し：URL風文字列がそのまま保たれる", d.regs?.[1]?.label, URLISH);
  check("JSON書出し：HTML風の理由がそのまま保たれる", d.decisions?.[0]?.reason, HTMLISH);
  // F-22：旧形式（版なし）で読んだ cert は型式ラン × 法規行へ移り、書き出しは版2になる（期待値は入力から手で書く）
  check("JSON書出し：runs/regs/certが保たれる（cert は版2へ移行）", [d.schemaVersion, d.runs, d.regs?.length, d.cert],
    [2, input.runs, 2, [{ runKey: "r201", rid: "g201", ck: "DUMMY-CERT", planned: false }]]);
}

// ── ④ データ入りHTML保存（BlobダウンロードがCSP下で通ること） ──
const savedHTML = await download("データ入りHTMLを保存", ".html");
check("データ入りHTML：CSPメタが再保存物にも残っている",
  readFileSync(savedHTML, "utf8").includes(`content="${EXPECTED_CSP}"`), true);

// ── ⑤ 保存したHTMLを新たに開く ───────────────────
await goto("file://" + savedHTML);
check("再保存HTML：CSPメタが同じ内容で残る", await cspMeta(), EXPECTED_CSP);
check("再保存HTML：保存時点のダミーデータで復元した",
  await ev(`(() => { const d = JSON.parse(document.getElementById('ilist-boot-data').textContent);
    return [d.runs?.[0]?.typeId, d.regs?.[1]?.label, d.decisions?.[0]?.reason]; })()`),
  ["DEMO-CSP", URLISH, HTMLISH]);
check("再保存HTML：HTML風文字列は実行されない", await ev(`window.__PWNED__ === undefined`), true);
check("再保存HTML：アプリが描画された", await ev(`document.getElementById('root').childElementCount > 0`), true);
check("再保存HTML：headのインライン<style>が適用されている（body margin 0px・背景色）",
  await headCssApplied(), ["0px", "0px", "rgb(12, 22, 35)"]);
check("再保存HTML：URL風・HTML風の文字列が、要素にならず文字として表示される",
  await shownAsText(), { url: true, reasonHead: true, elements: 0 });

// ── ⑥ 再保存HTMLからさらに保存しても雛形ごとCSPが運ばれる ──
const savedHTML2 = await download("データ入りHTMLを保存", ".html");
check("2世代目HTML：CSPメタが残る", readFileSync(savedHTML2, "utf8").includes(`content="${EXPECTED_CSP}"`), true);

// ── ⑦ 読込失敗で既存データを壊さない ───────────────
const brokenPath = join(OUT, "csp-broken.json");
writeFileSync(brokenPath, "{ これはJSONではない ");
await importFile(brokenPath);
check("不正JSON：案内が出る", await ev(`(window.__ALERTS__ || []).some(m => m.includes('読み込め'))`), true);
check("不正JSON：既存のダミーデータが壊れていない",
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('型式ラン'));
    return b.textContent.includes('(1)'); })()`), true);
const afterBroken = await download("JSONに書き出し", ".json");
{
  const d = JSON.parse(readFileSync(afterBroken, "utf8"));
  check("不正JSON後：書き出せる内容が保存時点のまま", [d.runs?.[0]?.typeId, d.decisions?.[0]?.reason], ["DEMO-CSP", HTMLISH]);
}

// ── ⑧ 通信・違反の集計 ──────────────────────────
// ここで通常操作ぶんを「複製して」確定する。以降（負の対照）で同じ配列へ追記されても、
// 検査結果にも証拠JSONにも混ざらないようにする（checkは値を参照のまま保持するため）。
const external = [...new Set(netUrls)].filter((u) => !/^(file|data|blob):/.test(u));
const urlishRequests = netUrls.filter((u) => u.includes("example.invalid")).slice();
const cspViolationsNormal = cspViolations.slice();
const consoleErrorsNormal = consoleErrors.slice();
check("外部ドメインへの通信は0件", external, []);
check("URL風文字列への取得要求は0件", urlishRequests, []);
check("CSP違反は0件", cspViolationsNormal, []);
check("consoleエラーは0件", consoleErrorsNormal, []);

// ── ⑨ 負の対照：CSPが「無視されている」のではなく実際に効いていることを確かめる ──
// ここまでの「違反0件・通信0件」は、CSPが効いていなくても成立しうる。
// そこでCSPが禁じているはずの操作をわざと行い、遮断されることを確かめる。
// （集計のあとに実行する。ここで出る違反は意図したものなので上の集計には入れない）
await ev(`(() => { window.__CSPV__ = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__CSPV__.push(e.effectiveDirective || e.violatedDirective));
  return true; })()`);
check("負の対照：外部fetchがCSPで遮断される",
  await ev(`(async () => { try { await fetch(${JSON.stringify(URLISH)}); return "allowed"; } catch (e) { return e.name; } })()`),
  "TypeError");
await ev(`(() => { const i = document.createElement('img');
  i.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  document.body.appendChild(i); return true; })()`);
await sleep(400);
const blocked = await ev(`[...new Set(window.__CSPV__)].sort()`);
check("負の対照：connect-src・img-src が default-src 'none' で塞がれている", blocked, ["connect-src", "img-src"]);

const hashes = {
  "dist-standalone/ilist-standalone.html": sha256(PAGE_FILE),
  savedHTML: sha256(savedHTML),
  savedHTML2: sha256(savedHTML2),
};
const failed = results.filter((r) => !r.ok).length;
writeFileSync(join(OUT, "standalone-csp-result.json"), JSON.stringify({
  page: PAGE, expectedCsp: EXPECTED_CSP, inputPath, savedJSON, savedHTML, savedHTML2, afterBroken,
  hashes, pass: results.length - failed, fail: failed, results, external,
  cspViolations: cspViolationsNormal, consoleErrors: consoleErrorsNormal,
  // 負の対照でわざと起こしたぶんは、通常操作の集計とは別に残す
  negativeControlBlocked: blocked,
  negativeControlCspViolations: cspViolations.slice(cspViolationsNormal.length),
  netUrlKinds: [...new Set(netUrls.map((u) => u.split(":")[0] + ":"))],
}, null, 2));
console.log("SHA-256:", JSON.stringify(hashes, null, 2));
console.log(`PASS ${results.length - failed} / FAIL ${failed}`);
cleanup();
process.exit(failed ? 1 : 0);
