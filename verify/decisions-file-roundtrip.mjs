// ダミー専用。生成HTMLと実JSONの値比較。依存追加なし。実API/DBは使用しない。
// 先に npm run build:standalone を実行。証拠ディレクトリに入力・期待値・全ダウンロードを残す。
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { CHROME_PATH } from "../scripts/chrome-path.mjs";
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const OUT = process.argv[2];
if (!OUT) throw new Error("usage: node verify/decisions-file-roundtrip.mjs <existing evidence directory>");
const PAGE = `file://${REPO}/dist-standalone/ilist-standalone.html`;
const CHROME = CHROME_PATH;
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), "ilist-file-"));
const dl = mkdtempSync(join(OUT, "downloads-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REASON = "対象外の理由（ダミー）\n</script><script>window.__PWNED__=1</script>\n<b>太字にならない</b> & \" ' 日本語";

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--host-resolver-rules=MAP * ~NOTFOUND",       // 外部通信を全面遮断
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

let id = 0; const pending = new Map(); const netUrls = []; const consoleErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Network.requestWillBeSent") netUrls.push(m.params.request.url);
  if (m.method === "Runtime.exceptionThrown") consoleErrors.push(m.params?.exceptionDetails?.exception?.description || "exception");
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") consoleErrors.push(m.params.args.map((a) => a.description || a.value).join(" "));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error("評価失敗: " + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
await send("Runtime.enable"); await send("Network.enable"); await send("Page.enable");
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl });
await send("Page.navigate", { url: PAGE });
await sleep(900);

const results = [];
const check = (label, actual, expected) => {
  const ok = isDeepStrictEqual(actual, expected);
  results.push({ label, ok, actual, expected });
  console.log(`${ok ? "OK" : "NG"} ${label}`);
};
const input = {
  runs: [
    { key: "r101", typeId: "DEMO-ROUNDTRIP", gen: "DUMMY-PJ", sk: "新", lo: "2024-01-01", drop: "2027-12-31" },
    // F-04：同じプロジェクトの別型式（r101 の比較元）
    { key: "r102", typeId: "DEMO-ROUNDTRIP-BASE", gen: "DUMMY-PJ", sk: "新", lo: "2022-01-01", drop: "2027-12-31" },
  ],
  regs: [
    { rid: "g101", id: "DUMMY-PARENT", label: "ダミー親", shin: "2023-01-01", kei: "2025-01-01", parent: "" },
    { rid: "g102", id: "DUMMY-CHILD", label: "ダミー子", shin: "2023-02-01", kei: "2026-02-10", parent: "DUMMY-PARENT" },
  ],
  cert: { "DEMO-ROUNDTRIP": { "DUMMY-PARENT": "DUMMY-CERT" } },
  decisions: [
    { runKey: "r101", rid: "g102", state: "対象外", reason: REASON, decidedAt: "2026-09-01 10:11", needsRecheck: false,
      cond: { typeId: "DEMO-ROUNDTRIP", sk: "新", lo: "2001-01-01", drop: "2027-12-31", regId: "DUMMY-CHILD",
        shin: "2023-02-01", kei: "2026-02-10", parent: "DUMMY-PARENT", parentLink: "one", parentRid: "g101" } },
    { runKey: "r101", rid: "g101", state: "対象", reason: "確定時条件なし（ダミー）", decidedAt: "2026-09-02 12:34", needsRecheck: false, cond: null },
  ],
  // F-04：比較元と同一性（掃き出しで変わらない値にしてあるので、期待値は入力のまま）
  bases: [{ runKey: "r101", baseRunKey: "r102", decidedAt: "2026-09-19 10:20" }],
  sameness: [
    { runKey: "r101", rid: "g102", value: "同一でない", reason: REASON, decidedAt: "2026-09-19 10:21", needsRecheck: false, baseRunKey: "r102" },
    { runKey: "r101", rid: "g101", value: "未確認", reason: "", decidedAt: "", needsRecheck: true, baseRunKey: "" },
  ],
};
// 期待値は出力から作らず、入力に対する仕様（両判断でtrueになる）から保存操作前に定める。
// F-22：入力は旧形式（版なし）の cert。読込時に型式ラン × 法規行へ移り、書き出しは版2になる。
// 移行後の形も製品コードを通さず、入力から手で書く（DEMO-ROUNDTRIP のランは r101 だけ、DUMMY-PARENT の法規行は g101 だけ）。
const expected = { schemaVersion: 2, ...input,
  cert: [{ runKey: "r101", rid: "g101", ck: "DUMMY-CERT", planned: false }],
  decisions: input.decisions.map((d) => ({ ...d, needsRecheck: true })) };
const inputPath = join(OUT, "roundtrip-input.json");
writeFileSync(inputPath, JSON.stringify(input, null, 2));
writeFileSync(join(OUT, "roundtrip-expected.json"), JSON.stringify(expected, null, 2));
const click = async (text) => {
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}));
    if (!b) throw new Error('button missing'); b.click(); })()`);
};
const importFile = async (path) => {
  const doc = await send("DOM.getDocument");
  const el = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: 'input[type="file"]' });
  const r = await send("DOM.setFileInputFiles", { nodeId: el.result.nodeId, files: [path] });
  if (r.error) throw new Error(JSON.stringify(r.error));
  await sleep(400);
};
const status = () => ev(`(() => {
  const values = ['未書き出しの変更があります（書き出してください）','JSONから読み込みました',
    '保存済みのHTMLから起動しました（この時点のデータで再開しています）',
    'JSONの書き出しを開始しました（保存先はブラウザの動作に従います）',
    'データ入りHTMLの書き出しを開始しました（保存先はブラウザの動作に従います）'];
  return [...document.querySelectorAll('span')].map(e => e.textContent.trim()).find(s => values.includes(s));
})()`);
const download = async (button, extension) => {
  // 同日名のJSONが上書きされても見落とさないよう、保存操作ごとに証拠先を分ける。
  const destination = mkdtempSync(join(dl, "export-"));
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: destination });
  await click(button);
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    const file = readdirSync(destination).find(f => f.endsWith(extension));
    if (file && statSync(join(destination, file)).size) return join(destination, file);
  }
  throw new Error(`download missing: ${button}`);
};
const compare = (label, data) => {
  check(`${label}: runs/regs/cert/decisions/bases/sameness全体の値`, data, expected);
  for (const area of ["bases", "sameness"]) {
    for (let i = 0; i < expected[area].length; i++) {
      for (const key of Object.keys(expected[area][i])) {
        check(`${label}: ${area}[${i}].${key}`, data[area]?.[i]?.[key], expected[area][i][key]);
      }
    }
  }
  for (let i = 0; i < expected.decisions.length; i++) {
    for (const key of ["runKey", "rid", "state", "reason", "decidedAt", "needsRecheck", "cond"]) {
      check(`${label}: decisions[${i}].${key}`, data.decisions?.[i]?.[key], expected.decisions[i][key]);
    }
    for (const key of Object.keys(expected.decisions[i].cond || {})) {
      check(`${label}: decisions[${i}].cond.${key}`, data.decisions?.[i]?.cond?.[key], expected.decisions[i].cond[key]);
    }
  }
};
await importFile(inputPath);
check("実JSON読込後・書出し前のdirty表示", await status(), "未書き出しの変更があります（書き出してください）");
check("実JSON読込後・書出し前の終了時ハンドラ", await ev(`(() => { const e=new Event('beforeunload',{cancelable:true}); window.dispatchEvent(e); return e.defaultPrevented; })()`), true);
const savedJSON = await download("JSONに書き出し", ".json");
compare("最初のJSON実ファイル", JSON.parse(readFileSync(savedJSON, "utf8")));
const savedHTML = await download("データ入りHTMLを保存", ".html");
await send("Page.navigate", { url: "file://" + savedHTML });
await sleep(900);
check("保存版起動は不要なdirtyなし", await status(), "保存済みのHTMLから起動しました（この時点のデータで再開しています）");
const boot = await ev(`JSON.parse(document.getElementById('ilist-boot-data').textContent)`);
compare("保存版を開いたDOMの起動データ", boot);
check("保存版で要再確認2件を描画", await ev(`[...document.querySelectorAll('table tbody td')].filter(td => td.textContent.includes('要再確認')).length`), 2);
check("保存版で比較元を見出しに描画", await ev(`[...document.querySelectorAll('table thead th')].some(th => th.textContent.includes('比較元 DEMO-ROUNDTRIP-BASE'))`), true);
// F-14：期日超過の表示は「法規不適合／要対応｜〜／drop済み／対象外」の4状態になった。
// このセル（r101×g102）は人の判断が「対象外」なので、他の状態より優先して灰の対象外が出る。
// 日付に依らない期待値だけを見る（このダミーの日付は固定値のため）。
check("保存版で人の対象外が最優先で描画", await ev(`[...document.querySelectorAll('table tbody td')].filter(td => td.textContent.includes('対象外（判断済み）')).length`), 1);
check("保存版のセルに法規不適合を出さない（対象外が優先）", await ev(`[...document.querySelectorAll('table tbody td')].filter(td => td.textContent.includes('対象外（判断済み）') && td.textContent.includes('法規不適合')).length`), 0);
check("保存版に「期限超過」は無い（F-14で廃止）", await ev(`document.body.textContent.includes('期限超過')`), false);
check("HTML風理由のスクリプト実行なし", await ev("window.__PWNED__ === undefined"), true);
const afterHTML = await download("JSONに書き出し", ".json");
compare("保存版起動後のJSON再書出し", JSON.parse(readFileSync(afterHTML, "utf8")));
await send("Page.navigate", { url: PAGE });
await sleep(900);
await importFile(savedJSON);
check("trueを保存済みの正常JSONはimported", await status(), "JSONから読み込みました");
const afterJSON = await download("JSONに書き出し", ".json");
compare("JSON実ファイル再読込後の再書出し", JSON.parse(readFileSync(afterJSON, "utf8")));
await sleep(300);
check("再書出し後にdirtyへ戻らない", await status(), "JSONの書き出しを開始しました（保存先はブラウザの動作に従います）");
const external = [...new Set(netUrls)].filter(u => !/^(file|data|blob):/.test(u));
check("ページから外部リクエストなし", external, []);
check("consoleエラーなし", consoleErrors, []);
const failed = results.filter(r => !r.ok).length;
writeFileSync(join(OUT, "file-roundtrip-result.json"), JSON.stringify({ page: PAGE, inputPath, savedJSON, savedHTML, afterHTML, afterJSON,
  pass: results.length-failed, fail: failed, results, external, consoleErrors }, null, 2));
console.log(`PASS ${results.length-failed} / FAIL ${failed}`);
cleanup();
process.exit(failed ? 1 : 0);
