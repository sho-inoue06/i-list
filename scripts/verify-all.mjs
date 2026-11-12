// npm run verify：verify/ の検証を全部回す。ダミー専用。依存追加なし。実API・実DBには接続しない。
//   ・verify/*.html（ブラウザのハーネス）：ViteをこのPCの127.0.0.1だけで起動し、ヘッドレスChromeで開く
//   ・verify/*.mjs （Nodeで回す検証）：1本ずつ node で実行する
// 対象は verify/ の中身から自動で集める（ファイル名の一覧は持たない）。
// 検証ではない生成用ファイルだけ EXCLUDED に理由つきで書く。
// 1件でもFAIL・起動失敗・時間切れがあれば、終了コードは0以外。
// Chromeの場所は環境変数 CHROME_PATH（未指定ならmacOSの既定）。
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME_PATH } from "./chrome-path.mjs";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const VERIFY = join(REPO, "verify");
const HTML_TIMEOUT_MS = 120_000;
const MJS_TIMEOUT_MS = 300_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 検証ではないもの（対象から外す）。ここに無いファイルは全部検証として回す。
const EXCLUDED = {
  "decision-table-gen.mjs": "決定表ケース（decision-table-cases*.js）の生成用で、検証ではない",
};

const files = readdirSync(VERIFY).filter((f) => /\.(html|mjs)$/.test(f)).sort();
const excluded = files.filter((f) => EXCLUDED[f]);
const targets = files.filter((f) => !EXCLUDED[f]);
const results = []; // { name, pass, fail, skip, status: "ok"|"fail"|"error", note }

console.log(`verify/ の検証: ${targets.length} 件（html ${targets.filter((f) => f.endsWith(".html")).length} / mjs ${targets.filter((f) => f.endsWith(".mjs")).length}）`);
for (const f of excluded) console.log(`対象外: verify/${f} … ${EXCLUDED[f]}`);
if (targets.length === 0) { console.log("ERROR: 検証が1件も見つからない"); process.exit(1); }

const record = (name, r) => {
  results.push({ name, ...r });
  const label = r.status === "ok" ? "PASS" : r.status === "fail" ? "FAIL" : "ERROR";
  const counts = `PASS ${r.pass} / FAIL ${r.fail}${r.skip ? ` / SKIP ${r.skip}` : ""}`;
  console.log(`[${label}] ${name.padEnd(34)} ${counts}${r.note ? `  (${r.note})` : ""}`);
};
// 0件で終わった検証は「何も確かめていない」ので、成功扱いにせずERRORにする。
const judge = (pass, fail, skip, note) =>
  pass + fail === 0
    ? errorResult("検証が0件で終わった")
    : { pass, fail, skip, status: fail > 0 ? "fail" : "ok", note };
const errorResult = (note) => ({ pass: 0, fail: 0, skip: 0, status: "error", note });

// ハーネスの「総合結果」行だけを拾う（行頭が「総合結果:」または「…セルフ検証」の行。最初の1つ）。
// 本文の後ろに出る例外文・実測値の中の "PASS n / FAIL m" は拾わない。
const SUMMARY = /^(?:\s*総合結果:\s*|.*セルフ検証\s+)PASS (\d+) \/ FAIL (\d+)(?: \/ SKIP (\d+))?/m;

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on("error", rej);
});

const children = [];
const tmpDirs = [];
const cleanup = () => {
  for (const c of children) { try { c.kill("SIGTERM"); } catch {} }
  for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {} }
};
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { cleanup(); process.exit(130); });

// ── 前提：単体HTMLのビルド（file://で開く .mjs が dist-standalone/ を使う） ──
const needsDist = targets.some((f) => f.endsWith(".mjs"));
let buildOk = true;
if (needsDist) {
  const b = spawnSync("npm", ["run", "build:standalone"], { cwd: REPO, encoding: "utf8" });
  buildOk = b.status === 0 && existsSync(join(REPO, "dist-standalone/ilist-standalone.html"));
  console.log(`前提ビルド npm run build:standalone … ${buildOk ? "OK" : "失敗（dist-standalone を使う検証は失敗扱いになる）"}`);
  if (!buildOk) results.push({ name: "build:standalone", ...errorResult("前提ビルド失敗") });
}

// ── html ハーネス ──
const htmls = targets.filter((f) => f.endsWith(".html"));
if (htmls.length) await runHtmls(htmls);

async function runHtmls(list) {
  let vite, chrome;
  try {
    const port = await freePort();
    vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
    children.push(vite);
    let viteLog = "";
    vite.stdout.on("data", (d) => (viteLog += d));
    vite.stderr.on("data", (d) => (viteLog += d));
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      if (vite.exitCode !== null) break;
      try { up = (await fetch(`${base}/`)).ok; } catch { await sleep(200); }
    }
    if (!up) throw new Error(`Viteが起動できない: ${viteLog.slice(-200).replace(/\s+/g, " ")}`);

    const profile = mkdtempSync(join(tmpdir(), "ilist-verify-chrome-"));
    tmpDirs.push(profile);
    // 127.0.0.1 以外の名前解決は遮断する（既存の検証と同じ）。
    chrome = spawn(CHROME_PATH, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--window-size=1600,1100",
      "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
      { stdio: "ignore" });
    children.push(chrome);
    let spawnErr = null;
    chrome.on("error", (e) => (spawnErr = e));
    let dbgPort = null;
    for (let i = 0; i < 100 && !dbgPort; i++) {
      if (spawnErr || chrome.exitCode !== null) break;
      try { dbgPort = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]) || null; } catch {}
      if (!dbgPort) await sleep(200);
    }
    if (!dbgPort) throw new Error(`Chromeを起動できない（CHROME_PATH=${CHROME_PATH}${spawnErr ? `: ${spawnErr.code || spawnErr.message}` : ""}）`);

    for (const f of list) {
      const name = f;
      try {
        const text = await readPage(dbgPort, `${base}/verify/${f}?autorun`);
        const m = text.match(SUMMARY);
        if (!m) { record(name, errorResult("結果の行が見つからない")); continue; }
        record(name, judge(+m[1], +m[2], +(m[3] || 0)));
      } catch (e) {
        record(name, errorResult(e.message));
      }
    }
  } catch (e) {
    for (const f of list) record(f, errorResult(e.message));
  } finally {
    for (const c of [chrome, vite]) { try { c?.kill("SIGTERM"); } catch {} }
  }
}

// ページを開き、「PASS n / FAIL m」が現れるまで待って本文を返す（時間切れは例外）。
function readPage(dbgPort, url) {
  let timer;
  const limit = new Promise((_, ng) => { timer = setTimeout(() => ng(new Error(`時間切れ（${HTML_TIMEOUT_MS / 1000}秒）`)), HTML_TIMEOUT_MS); });
  return Promise.race([readPageInner(dbgPort, url), limit]).finally(() => clearTimeout(timer));
}
async function readPageInner(dbgPort, url) {
  const res = await fetch(`http://127.0.0.1:${dbgPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const tab = await res.json();
  let ws;
  try { ws = new WebSocket(tab.webSocketDebuggerUrl); } catch (e) { throw new Error(`CDPに接続できない: ${e.message}`); }
  await new Promise((ok, ng) => { ws.onopen = ok; ws.onerror = () => ng(new Error("CDPに接続できない")); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); pending.get(m.id)?.(m); pending.delete(m.id); };
  const send = (method, params = {}) => new Promise((ok) => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onclose = () => { for (const ok of pending.values()) ok({}); pending.clear(); };
  try {
    const deadline = Date.now() + HTML_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const r = await send("Runtime.evaluate", { expression: "document.body ? document.body.innerText : ''", returnByValue: true });
      const text = r.result?.result?.value ?? "";
      if (SUMMARY.test(text)) return text;
      await sleep(500);
    }
    throw new Error(`時間切れ（${HTML_TIMEOUT_MS / 1000}秒）`);
  } finally {
    try { ws.close(); } catch {}
    try { await fetch(`http://127.0.0.1:${dbgPort}/json/close/${tab.id}`); } catch {}
  }
}

// ── mjs 検証 ──
for (const f of targets.filter((x) => x.endsWith(".mjs"))) {
  const evidence = mkdtempSync(join(tmpdir(), "ilist-verify-evidence-"));
  tmpDirs.push(evidence);
  const r = await new Promise((res) => {
    let out = "";
    const c = spawn(process.execPath, [join("verify", f), evidence], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
    children.push(c);
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => { c.kill("SIGKILL"); res({ timeout: true, out }); }, MJS_TIMEOUT_MS);
    c.on("error", (e) => { clearTimeout(timer); res({ spawnError: e, out }); });
    c.on("close", (code) => { clearTimeout(timer); res({ code, out }); });
  });
  if (r.timeout) { record(f, errorResult(`時間切れ（${MJS_TIMEOUT_MS / 1000}秒）`)); continue; }
  if (r.spawnError) { record(f, errorResult(`起動できない: ${r.spawnError.message}`)); continue; }
  const m = [...r.out.matchAll(/PASS (\d+) \/ FAIL (\d+)/g)].pop();
  const tail = r.out.trim().split("\n").slice(-1)[0]?.slice(0, 160) ?? "";
  if (m) {
    const res = judge(+m[1], +m[2], 0);
    // 行は PASS 0 でも終了コードが0以外なら失敗にする（取りこぼし防止）。
    if (r.code !== 0 && res.status === "ok") record(f, { ...res, status: "fail", fail: Math.max(res.fail, 1), note: `終了コード ${r.code}` });
    else record(f, res);
  } else if (r.code === 0) {
    // 件数を出さない検証（assert方式）。最後まで通れば1件PASSとして数える。
    record(f, judge(1, 0, 0, "件数表示なし：全体で1件として計上"));
  } else {
    // 件数を出さずに非0で終わった＝検証が失敗した（assert等）。エラー行を理由に出す。
    const why = r.out.split("\n").find((l) => /Error|NG|失敗/.test(l))?.trim().slice(0, 160) || tail;
    record(f, { pass: 0, fail: 1, skip: 0, status: "fail", note: `終了コード ${r.code}: ${why}` });
  }
}

// ── 合計 ──
const sum = (k) => results.reduce((a, r) => a + r[k], 0);
const bad = results.filter((r) => r.status !== "ok");
const ok = bad.length === 0 && results.length > 0;
console.log("-".repeat(60));
const skips = sum("skip");
console.log(`合計: 検証 ${results.length} 本 / PASS ${sum("pass")} / FAIL ${sum("fail")} / SKIP(未検証) ${skips} / ERROR(起動不能・時間切れ) ${results.filter((r) => r.status === "error").length} 本`);
console.log(ok ? `結果: すべて PASS${skips ? `（ただし SKIP ${skips} 件は未検証。ハーネス側が「すべて検証済みではない」と明示している既存の扱い）` : ""}` : `結果: 失敗あり … ${bad.map((r) => r.name).join(", ")}`);
process.exit(ok ? 0 : 1);
