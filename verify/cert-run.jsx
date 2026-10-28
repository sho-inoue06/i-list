// ───────────────────────────────────────────────
// 認証実績の器を型式ラン×法規行へ付け替える（F-22）の検証ハーネス
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない
// （API版のケースでは window.fetch をモックし、PUTの本文を実測する）。
// サーバDBの往復（A2の5経路のうちサーバDB・A3）は verify/cert-server.mjs で確かめる。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/cert-run.html
//
// 完成条件 A1〜A8・B1〜B6（Notion「Iリスト｜バックログ」F-22）を、ケースIDの先頭で対応づける。
// A8（既存ハーネスの全PASS）はこのページの対象外（各ハーネスで確かめる）。
// ───────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import IListApp, {
  SEED, parseImportedData, replaceBootData, readBootData, isValidData,
  evalCellWith, decideCell, effectiveSideOf, certPlanOf, summarize, buildCellModel, riskRunRows,
  makeSamenessContext, migrateLegacyCert, findCert, setCertNumber, pruneCertByRun, pruneCertByReg,
  SCHEMA_VERSION, TODAY,
} from "../src/IListApp.jsx";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));
window.__ALERTS__ = [];
window.alert = (m) => { window.__ALERTS__.push(String(m)); };
window.confirm = (m) => { window.__ALERTS__.push("confirm:" + String(m)); return true; };
const WAIT_PAST_DEBOUNCE = 1600;   // API版の自動保存（0.8秒のデバウンス）を越えるまで待つ

function createAsserts() {
  const failures = [], notes = [];
  const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures.push(`${label}: 期待=${JSON.stringify(expected)} 実際=${JSON.stringify(actual)}`);
    notes.push(`${label}=${JSON.stringify(actual)}${ok ? "" : " ← NG"}`);
    return ok;
  };
  const checkTrue = (label, actual) => check(label, !!actual, true);
  return { check, checkTrue, failures, notes };
}

// ── ダミーデータ（架空。実車・実法規・実認可番号とは無関係） ──
// 版2の文書。書き出しと同じキーの並び（schemaVersion, runs, regs, cert, decisions, bases, sameness）にしてあり、
// 往復で「完全一致」を文字列比較で確かめられる。
//   ・r801・r802 は同じ型式 CR-A（プロジェクトが違う）。r803 は別型式 CR-B
//   ・run.key に区切り文字を含むラン（"PJ:9|x"）も入れる（runKey と rid を連結していないことの確認）
//   ・管理番号：空白だけ（B6）、空文字のレコード、取得予定 true のレコード（器だけ。判定には使わない）、HTML風の文字列
const TRICKY_CK = "CR*</script><script>window.__PWNED__=1</script>&\"'";
const V2 = {
  schemaVersion: 2,
  runs: [
    { key: "r801", typeId: "CR-A", gen: "PJ-1", sk: "新", lo: "2021-01-01", drop: "2030-12-31" },
    { key: "r802", typeId: "CR-A", gen: "PJ-2", sk: "継", lo: "2024-01-01", drop: "2031-12-31" },
    { key: "r803", typeId: "CR-B", gen: "PJ-1", sk: "新", lo: "2021-06-01", drop: "2030-12-31" },
    { key: "PJ:9|x", typeId: "CR-C", gen: "PJ-9", sk: "新", lo: "2022-01-01", drop: "2030-12-31" },
  ],
  regs: [
    { rid: "g801", id: "CR-REG-1", label: "ダミー法規1", shin: "2020-01-01", kei: "2022-01-01", parent: "" },
    { rid: "g802", id: "CR-REG-2", label: "ダミー法規2", shin: "2020-06-01", kei: "2023-01-01", parent: "" },
    { rid: "g803", id: "CR-REG-3", label: "ダミー法規3", shin: "2020-06-01", kei: "2023-06-01", parent: "" },
  ],
  cert: [
    { runKey: "r801", rid: "g801", ck: "CR*01", planned: false },
    { runKey: "r802", rid: "g801", ck: " ", planned: false },
    { runKey: "r803", rid: "g802", ck: TRICKY_CK, planned: false },
    { runKey: "r801", rid: "g803", ck: "", planned: false },
    { runKey: "PJ:9|x", rid: "g802", ck: "", planned: true },
    { runKey: "PJ:9|x", rid: "g801", ck: "CR*09", planned: false },
  ],
  decisions: [],
  bases: [],
  sameness: [],
};
const API_V2 = { schemaVersion: 2, runs: V2.runs, regs: V2.regs, cert: V2.cert };
// 旧形式（版なし・型式 × 法規ID）。rid も持たない（旧DB・旧JSONの形）
const LEGACY = {
  runs: V2.runs.slice(0, 3),
  regs: V2.regs.map(({ rid, ...r }) => r),
  cert: { "CR-A": { "CR-REG-1": "CR*A1" }, "CR-B": { "CR-REG-2": "CR*B2" }, "CR-GHOST": { "CR-REG-1": "CR*X" } },
};

// ── 画面ユーティリティ ──
const setNativeValue = (el, value) => {
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype
    : el instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event(el instanceof window.HTMLSelectElement ? "change" : "input", { bubbles: true }));
};
async function clickByText(container, re) {
  const b = [...container.querySelectorAll("button")].find((x) => re.test(x.textContent));
  if (!b) throw new Error(`ボタンが見つかりません: ${re}`);
  b.click();
  await sleep(20);
}
const openTab = (c, name) => clickByText(c, new RegExp(`^${name}`));
const certInput = (c, runKey, rid) => c.querySelector(`input[aria-label="認可書番号 ${runKey} ${rid}"]`);
// 帳票セル（行＝法規行の並び、列＝型式ランの並び）
function cellAt(c, row, col) {
  const td = c.querySelector("table tbody")?.children[row]?.children[col + 1];
  if (!td) throw new Error(`帳票のセルがありません: ${row},${col}`);
  return td;
}
const borderOf = (td) => getComputedStyle(td.firstElementChild || td).borderTopColor;
const GREEN_RGB = "rgb(63, 191, 143)", RED_RGB = "rgb(255, 107, 87)";

// 書き出しボタンを押して、Blobの中身（書き出すJSON）を取る。ダウンロードはしない。
async function exportVia(c, re) {
  const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL, realClick = HTMLAnchorElement.prototype.click;
  let blob = null;
  URL.createObjectURL = (b) => { blob = b; return "blob:dummy"; };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () {};
  try {
    await clickByText(c, re);
    await sleep(60);
    if (!blob) throw new Error("書き出しのBlobを取得できませんでした");
    return JSON.parse(await blob.text());
  } finally {
    URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke; HTMLAnchorElement.prototype.click = realClick;
  }
}
const snapshotAll = (c) => exportVia(c, /JSONに書き出し/);
const snapshotApi = (c) => exportVia(c, /データ書き出し/);
function selectFile(c, text) {
  const inp = c.querySelector('input[type="file"]');
  const dt = new DataTransfer();
  dt.items.add(new File([text], "d.json", { type: "application/json" }));
  Object.defineProperty(inp, "files", { value: dt.files, configurable: true });
  inp.dispatchEvent(new Event("change", { bubbles: true }));
}
function installApiMock(getJson) {
  const real = window.fetch;
  const puts = [];
  window.fetch = async (url, opts) => {
    if (String(url) !== "/api/data") throw new Error("想定外のfetch: " + url);
    if (!opts || !opts.method || opts.method === "GET") return { ok: true, json: async () => clone(getJson) };
    if (opts.method === "PUT") { puts.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ ok: true }) }; }
    throw new Error("想定外のmethod: " + opts.method);
  };
  return { puts, restore() { window.fetch = real; } };
}
function createMountManager() {
  const mounted = [];
  const mountNode = (node) => {
    const container = document.createElement("div");
    document.getElementById("sandbox").appendChild(container);
    const root = createRoot(container);
    root.render(node);
    const h = { container, unmount() { if (h._d) return; h._d = true; try { root.unmount(); } catch {} try { container.remove(); } catch {} } };
    mounted.push(h);
    return h;
  };
  return {
    mount: (bootData) => mountNode(<StandaloneApp bootData={bootData} />),
    mountApi: () => mountNode(<IListApp />),
    cleanupAll() { for (const h of mounted.slice().reverse()) h.unmount(); mounted.length = 0; },
  };
}
async function mountWith(mount, data = V2) {
  const parsed = parseImportedData(clone(data));
  if (!parsed.ok) throw new Error("ダミーデータが不正です: " + parsed.error);
  const app = mount({ present: true, ok: true, data: parsed.data, maxId: parsed.maxId, maxRid: parsed.maxRid });
  await sleep(80);
  return app.container;
}
// 型式ランタブ・法規DBタブの行を消す（行の最後のボタン＝ゴミ箱）
async function deleteRow(c, tab, index) {
  await openTab(c, tab);
  const tr = c.querySelectorAll("table tbody tr")[index];
  const btns = tr.querySelectorAll("button");
  btns[btns.length - 1].click();
  await sleep(40);
}

// ───────────────────────────────────────────────
// F-22より前の判定の入口（参照実装）。**認証実績の引き方だけ**が旧い：cert[run.typeId][reg.id]。
// それ以外（decideCell・effectiveSideOf・certPlanOf）は製品と同じものを呼ぶ＝B5「変えるのは入力の取り方だけ」。
// これと製品の evalCellWith（型式ラン × 法規行で引く）を、旧形式を移行したデータで突き合わせる（B1・B5）。
const legacyEvalCellWith = (cert, run, r, sameness, today = TODAY) => {
  const applied = sameness==="同一" ? "継続車日" : sameness==="同一でない" ? "新型車日" : "";
  const ck = cert[run.typeId]?.[r.id] || null;
  const { side, 根拠未確認 } = effectiveSideOf(run, sameness);
  const d = decideCell({ lo: run.lo, drop: run.drop, shin: r.shin, kei: r.kei, today, certPlan: certPlanOf(ck), side, 根拠未確認 });
  const required = d.要否 === "要";
  const kind = d.適用した規制 === "なし" ? "" : d.適用した規制;
  const status = !required ? "off" : ck ? "ok" : "leak";
  return { required, kind, ck, status, dueDate: d.規制日, applied };
};

// 疑似乱数（再現できるように種を固定する）。ダミーの組み合わせを多数作るためだけに使う。
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
// 1組のダミーデータ（旧形式の cert 付き）。法規IDの重複・空、空白だけ・空文字の番号、付け先の無い実績、
// 比較元と同一性も混ぜる（判定の入口の違いがあれば必ずどこかのセルに出るようにする）。
function randomLegacyData(seed) {
  const r = rng(seed);
  const types = ["FZ-1", "FZ-2", "FZ-3"];
  const gens = ["PJ-A", "PJ-B"];
  const day = () => `20${pick(r, ["18", "20", "22", "24", "26", "28", "30"])}-${pick(r, ["01", "06", "11"])}-0${1 + Math.floor(r() * 9)}`;
  const runs = [], regs = [];
  const nRun = 3 + Math.floor(r() * 5), nReg = 2 + Math.floor(r() * 5);
  for (let i = 0; i < nRun; i++) runs.push({ key: `r${900 + i}`, typeId: pick(r, types), gen: pick(r, gens), sk: pick(r, ["新", "継"]), lo: day(), drop: day() });
  const ids = ["FZ-REG-1", "FZ-REG-2", "FZ-REG-3", "FZ-REG-1", ""];   // 重複・空を含む
  for (let i = 0; i < nReg; i++) regs.push({ rid: `g${900 + i}`, id: pick(r, ids), label: "ダミー", shin: day(), kei: day(), parent: "" });
  const cert = {};
  for (const t of [...types, "FZ-GHOST"]) {
    for (const id of ["FZ-REG-1", "FZ-REG-2", "FZ-REG-3", "", "FZ-REG-NONE"]) {
      const x = r();
      if (x < 0.35) (cert[t] ??= {})[id] = pick(r, ["FZ*1", "FZ*2", " ", ""]);
    }
  }
  const bases = [], sameness = [];
  for (const run of runs) {
    const cands = runs.filter((b) => b.gen === run.gen && b.typeId !== run.typeId);
    if (cands.length && r() < 0.6) {
      const b = pick(r, cands);
      bases.push({ runKey: run.key, baseRunKey: b.key, decidedAt: "2026-09-01 10:00" });
      for (const reg of regs) if (r() < 0.5) {
        const value = pick(r, ["同一", "同一でない"]);
        sameness.push({ runKey: run.key, rid: reg.rid, value, reason: "ダミー", decidedAt: "2026-09-01 10:00", needsRecheck: false, baseRunKey: b.key });
      }
    }
  }
  return { runs, regs, cert, bases, sameness };
}
// F-22より前の集計（参照実装）。製品の summarize と同じ手順で、評価だけ旧い入口を使う
// （製品の summarize は中で新しい evalCellWith を呼ぶので、旧形式の cert を渡しても旧い見え方にはならない）。
const legacySummarize = (runs, regs, cert, samenessFor) => {
  const leaks = [], effDrop = {};
  for (const run of runs) {
    let earliest = null;
    for (const r of regs) {
      const c = legacyEvalCellWith(cert, run, r, samenessFor ? samenessFor(run, r) : undefined);
      if (c.status === "leak") {
        leaks.push({ run, reg: r.id, rid: r.rid, kind: c.kind, dueDate: c.dueDate });
        if (!earliest || c.dueDate < earliest) earliest = c.dueDate;
      }
    }
    if (earliest) effDrop[run.key] = earliest;
  }
  return { leaks, effDrop };
};
// 1組のデータについて、旧い入口と新しい入口の「見え方」を丸ごと作る（セルの判定・漏れ一覧・危険一覧）
function viewOf(data, evalWith, cert) {
  const sameCtx = makeSamenessContext(data.runs, data.bases, data.sameness);
  const evalCell = (run, reg) => evalWith(cert, run, reg, sameCtx.effective(run, reg));
  const model = buildCellModel({ runs: data.runs, regs: data.regs, evalCell, sameCtx });
  const cells = model.list.map((m) => ({ run: m.run.key, rid: m.reg.rid, auto: m.auto, decision: m.decision,
    notice: m.notice, compliance: m.compliance, showSame: m.showSame, risk: m.risk }));
  const sum = (evalWith === legacyEvalCellWith ? legacySummarize : summarize)(data.runs, data.regs, cert, sameCtx.effective);
  const risk = riskRunRows(model, { runs: data.runs }).map((row) => ({ run: row.run.key, phase: row.phase, bad: row.bad, warn: row.warn,
    cells: row.cells.map((m) => [m.reg.rid, m.risk]) }));
  return { cells, leaks: sum.leaks.map((l) => [l.run.key, l.rid, l.kind, l.dueDate]), effDrop: sum.effDrop, risk };
}

// ───────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "A1-shape",
    name: "認証実績を型式ラン × 法規行で1件持つ（管理番号1欄＋取得予定）",
    expect: "SEEDも読込結果も {runKey, rid, ck, planned} のレコード配列。組は重複しない。番号は文字列1欄、予定は真偽値",
    async run({ asserts }) {
      asserts.check("SEEDの版", SEED.schemaVersion, SCHEMA_VERSION);
      asserts.checkTrue("SEEDの cert は配列", Array.isArray(SEED.cert));
      asserts.check("各件の項目", [...new Set(SEED.cert.map((c) => Object.keys(c).sort().join(",")))], ["ck,planned,rid,runKey"]);
      const pairs = SEED.cert.map((c) => `${c.runKey}\u0000${c.rid}`);
      asserts.check("組 (runKey, rid) の重複なし", new Set(pairs).size, pairs.length);
      asserts.checkTrue("参照先の型式ラン・法規行がすべて存在する",
        SEED.cert.every((c) => SEED.runs.some((r) => r.key === c.runKey) && SEED.regs.some((g) => g.rid === c.rid)));
      asserts.checkTrue("番号は文字列・予定は真偽値", SEED.cert.every((c) => typeof c.ck === "string" && typeof c.planned === "boolean"));
      const p = parseImportedData(clone(V2));
      asserts.check("版2の文書を読める", p.ok, true);
      asserts.check("読んだ cert はそのまま", p.data.cert, V2.cert);
      asserts.check("区切り文字を含む run.key でも引ける", findCert(p.data.cert, "PJ:9|x", "g801")?.ck, "CR*09");
      asserts.check("別の組は引かない", findCert(p.data.cert, "PJ:9", "g801"), null);
    },
  },
  {
    id: "A4-version-guard",
    name: "版の判定と、壊れた版2の拒否",
    expect: "版なし＝旧形式として移行、2＝そのまま、それ以外の版は拒否。版2の cert の形・参照先・重複を検証する",
    async run({ asserts }) {
      const bad = (label, mutate) => {
        const d = clone(V2); mutate(d);
        const p = parseImportedData(d);
        asserts.check(`拒否：${label}`, p.ok, false);
        return p.error;
      };
      bad("知らない版 3", (d) => { d.schemaVersion = 3; });
      bad("版が文字列 \"2\"", (d) => { d.schemaVersion = "2"; });
      bad("版2で cert がオブジェクト", (d) => { d.cert = {}; });
      bad("版2で regs に rid が無い", (d) => { delete d.regs[0].rid; });
      bad("存在しない型式ラン", (d) => { d.cert.push({ runKey: "r999", rid: "g801", ck: "X", planned: false }); });
      bad("存在しない法規行", (d) => { d.cert.push({ runKey: "r801", rid: "g999", ck: "X", planned: false }); });
      bad("組の重複", (d) => { d.cert.push({ runKey: "r801", rid: "g801", ck: "X", planned: false }); });
      bad("番号が数値", (d) => { d.cert[0].ck = 5; });
      bad("予定が文字列", (d) => { d.cert[0].planned = "false"; });
      bad("予定が無い", (d) => { delete d.cert[0].planned; });
      bad("不明な項目", (d) => { d.cert[0].typeId = "CR-A"; });
      bad("レコードが null", (d) => { d.cert.push(null); });
      bad("版なしで cert が配列", (d) => { delete d.schemaVersion; });
      asserts.check("isValidData：版なし・オブジェクト", isValidData({ runs: [], regs: [], cert: {} }), true);
      asserts.check("isValidData：版2・配列", isValidData({ schemaVersion: 2, runs: [], regs: [], cert: [] }), true);
      asserts.check("isValidData：版3", isValidData({ schemaVersion: 3, runs: [], regs: [], cert: [] }), false);
      asserts.check("isValidData：版2・オブジェクト", isValidData({ schemaVersion: 2, runs: [], regs: [], cert: {} }), false);
    },
  },
  {
    id: "A5-migration-rules",
    name: "移行規則：同じ型式の全ランへ複製・同じ法規IDの全行へ複製・付け先の無いものは破棄・予定はなし",
    expect: "期待値は検証側に手で書く（製品の移行関数の出力から作らない）",
    async run({ asserts }) {
      const runs = [
        { key: "k1", typeId: "T1" }, { key: "k2", typeId: "T1" }, { key: "k3", typeId: "T2" },
        { key: "k4", typeId: "T3" }, { key: "k5", typeId: "toString" },
      ];
      const regs = [
        { rid: "g1", id: "R1" }, { rid: "g2", id: "R1" }, { rid: "g3", id: "R2" }, { rid: "g4", id: "R3" }, { rid: "g5", id: "" },
      ];
      const legacy = {
        T1: { R1: "A", R2: " ", R3: "", "": "E", "R-NONE": "Y" },
        T2: { R1: "B" },
        GHOST: { R1: "X" },
      };
      const f = (runKey, rid, ck) => ({ runKey, rid, ck, planned: false });
      asserts.check("移行結果（runs の順 × regs の順）", migrateLegacyCert(legacy, runs, regs), [
        f("k1", "g1", "A"), f("k1", "g2", "A"), f("k1", "g3", " "), f("k1", "g4", ""), f("k1", "g5", "E"),
        f("k2", "g1", "A"), f("k2", "g2", "A"), f("k2", "g3", " "), f("k2", "g4", ""), f("k2", "g5", "E"),
        f("k3", "g1", "B"), f("k3", "g2", "B"),
      ]);
      asserts.check("空の旧形式は空配列", migrateLegacyCert({}, runs, regs), []);
      // 旧形式の読込（rid の無い法規行は、補った rid へ移す）
      const p = parseImportedData(clone(LEGACY));
      asserts.check("旧形式を読める", p.ok, true);
      asserts.check("読込結果は版2", p.data.schemaVersion, 2);
      const ridOf = (id) => p.data.regs.find((g) => g.id === id).rid;
      asserts.check("読込時の移行（補った rid へ・GHOST は破棄）", p.data.cert, [
        f("r801", ridOf("CR-REG-1"), "CR*A1"), f("r802", ridOf("CR-REG-1"), "CR*A1"), f("r803", ridOf("CR-REG-2"), "CR*B2"),
      ]);
      // データ入りHTMLに旧形式が埋まっていた場合も同じ
      const html = replaceBootData(`<html><body><!--ILIST_BOOT_DATA_START--><!--ILIST_BOOT_DATA_END--></body></html>`, clone(LEGACY));
      const boot = readBootData(new DOMParser().parseFromString(html.html, "text/html"));
      asserts.check("データ入りHTMLの旧形式も移行して開ける", [boot.ok, boot.data?.cert], [true, p.data.cert]);
    },
  },
  {
    id: "A4-legacy-open",
    name: "旧形式を読み込むと移行して開ける（単体版の読込・API版の初回読込とJSON読込）",
    expect: "どの入口でも同じ移行結果になり、書き出し・PUTは版2。知らない版は state を変えずに拒否する",
    async run({ mount, mountApi, asserts }) {
      // 期待値：rid は読込時に補われる（採番の位置は画面の状態で変わる）ので、実際に付いた rid を法規IDから引いて手で組む
      const expectedFor = (regs) => {
        const ridOf = (id) => regs.find((g) => g.id === id).rid;
        return [
          { runKey: "r801", rid: ridOf("CR-REG-1"), ck: "CR*A1", planned: false },
          { runKey: "r802", rid: ridOf("CR-REG-1"), ck: "CR*A1", planned: false },
          { runKey: "r803", rid: ridOf("CR-REG-2"), ck: "CR*B2", planned: false },
        ];
      };
      // 単体版：JSON読込
      const c = await mountWith(mount);
      selectFile(c, JSON.stringify(LEGACY));
      await sleep(150);
      const snap = await snapshotAll(c);
      const expectedCert = expectedFor(snap.regs);
      asserts.check("単体版：書き出しは版2・移行済み", [snap.schemaVersion, snap.cert], [2, expectedCert]);
      await openTab(c, "帳票");
      asserts.check("単体版：移行した実績で緑（r801・r802 × CR-REG-1）", [borderOf(cellAt(c, 0, 0)), borderOf(cellAt(c, 0, 1))], [GREEN_RGB, GREEN_RGB]);
      window.__ALERTS__ = [];
      selectFile(c, JSON.stringify({ ...clone(V2), schemaVersion: 3 }));
      await sleep(150);
      asserts.check("単体版：版3は拒否", window.__ALERTS__.filter((m) => m.includes("読めない版")).length, 1);
      asserts.check("単体版：拒否しても中身は変わらない", (await snapshotAll(c)).cert, expectedCert);

      // API版：旧形式DBの初回読込 → 直後の自動保存で版2としてPUT
      const m1 = installApiMock(LEGACY);
      try {
        const a = mountApi().container;
        await sleep(300); await sleep(WAIT_PAST_DEBOUNCE);
        asserts.check("API版：読込直後のPUTは1回", m1.puts.length, 1);
        const body = m1.puts[0];
        asserts.check("API版：PUTは版2", [body?.schemaVersion, Object.keys(body || {})], [2, ["schemaVersion", "runs", "regs", "cert"]]);
        asserts.check("API版：PUTの cert は移行済み", body?.cert, body ? expectedFor(body.regs) : null);
        asserts.checkTrue("API版：PUTの regs は全行 rid 付き", body?.regs.every((g) => /^g\d+$/.test(g.rid)));
        asserts.check("API版：書き出しも同じ", (await snapshotApi(a)).cert, body?.cert);
        // API版：JSON読込（旧形式）
        selectFile(a, JSON.stringify({ ...clone(LEGACY), cert: { "CR-B": { "CR-REG-1": "CR*B1" } } }));
        await sleep(150); await sleep(WAIT_PAST_DEBOUNCE);
        const last = m1.puts[m1.puts.length - 1];
        asserts.check("API版：旧形式のJSON読込も移行してPUT", last?.cert?.map((x) => [x.runKey, x.ck]), [["r803", "CR*B1"]]);
        // API版：知らない版は拒否（state を変えない＝PUTも増えない）
        window.__ALERTS__ = [];
        const before = m1.puts.length;
        selectFile(a, JSON.stringify({ ...clone(API_V2), schemaVersion: 3 }));
        await sleep(150); await sleep(WAIT_PAST_DEBOUNCE);
        asserts.check("API版：版3のJSONは拒否", [window.__ALERTS__.filter((m) => m.includes("読めない版")).length, m1.puts.length - before], [1, 0]);
      } finally { m1.restore(); }
      // API版：サーバが知らない版を返したら読込失敗（保存しない）
      const m2 = installApiMock({ ...clone(API_V2), schemaVersion: 3 });
      try {
        const a = mountApi().container;
        await sleep(300); await sleep(WAIT_PAST_DEBOUNCE);
        asserts.check("API版：版3の応答はPUTしない", m2.puts.length, 0);
        asserts.checkTrue("API版：読込失敗の表示", a.textContent.includes("初回読込に失敗"));
      } finally { m2.restore(); }
      // API版：版2でも壊れた cert（重複）は読込失敗
      const dup = clone(API_V2); dup.cert.push({ ...dup.cert[0] });
      const m3 = installApiMock(dup);
      try {
        const a = mountApi().container;
        await sleep(300); await sleep(WAIT_PAST_DEBOUNCE);
        asserts.check("API版：重複した cert の応答はPUTしない", [m3.puts.length, a.textContent.includes("初回読込に失敗")], [0, true]);
      } finally { m3.restore(); }
    },
  },
  {
    id: "A2-roundtrip-standalone",
    name: "単体版：画面状態・JSON書き出し／読み込み・データ入りHTMLの往復で完全一致",
    expect: "版2の文書（空白だけ・空文字・予定ありの器・HTML風の番号・区切り文字入りの run.key を含む）が3経路で1文字も変わらない",
    async run({ mount, asserts }) {
      // ① 画面状態：埋め込み起動 → 書き出し
      const c = await mountWith(mount);
      const s1 = await snapshotAll(c);
      asserts.check("画面状態 → 書き出し", s1, V2);
      // ② JSON：読み込み → 書き出し → もう一度読み込み → 書き出し
      const c2 = await mountWith(mount, { ...clone(V2), cert: [] });
      selectFile(c2, JSON.stringify(V2));
      await sleep(150);
      const s2 = await snapshotAll(c2);
      asserts.check("JSON読込 → 書き出し", s2, V2);
      selectFile(c2, JSON.stringify(s2));
      await sleep(150);
      asserts.check("JSON再往復", await snapshotAll(c2), V2);
      // ③ データ入りHTML：埋め込み → 読み取り → 起動 → 書き出し
      const html = replaceBootData(`<html><body><!--ILIST_BOOT_DATA_START--><!--ILIST_BOOT_DATA_END--></body></html>`, s1);
      asserts.check("HTMLへ埋め込める", html.ok, true);
      asserts.check("HTML風の番号でも script が早く閉じない", (html.html.match(/<\/script>/g) || []).length, 1);
      const boot = readBootData(new DOMParser().parseFromString(html.html, "text/html"));
      asserts.check("埋め込みを読める", [boot.present, boot.ok], [true, true]);
      asserts.check("埋め込みの中身", boot.data, V2);
      const app3 = mount(boot);
      await sleep(80);
      asserts.check("データ入りHTMLで起動 → 書き出し", await snapshotAll(app3.container), V2);
      asserts.check("スクリプトは実行されていない", window.__PWNED__, undefined);
    },
  },
  {
    id: "A2-roundtrip-api",
    name: "API版：初回読込 → 自動保存（PUT）・書き出し・JSON読込の往復で完全一致",
    expect: "版2のサーバ応答をそのまま PUT・書き出しする。JSONで読み込んだ版2の文書も1文字も変わらずにPUTされる",
    async run({ mountApi, asserts }) {
      const m = installApiMock(API_V2);
      try {
        const a = mountApi().container;
        await sleep(300); await sleep(WAIT_PAST_DEBOUNCE);
        asserts.check("読込直後のPUT本文＝サーバ応答", m.puts[0], API_V2);
        asserts.check("書き出し＝サーバ応答", await snapshotApi(a), API_V2);
        const other = { ...clone(API_V2), cert: [{ runKey: "r803", rid: "g803", ck: "CR*OTHER", planned: false }] };
        selectFile(a, JSON.stringify(other));
        await sleep(150); await sleep(WAIT_PAST_DEBOUNCE);
        asserts.check("JSON読込 → PUT本文", m.puts[m.puts.length - 1], other);
        selectFile(a, JSON.stringify(API_V2));
        await sleep(150); await sleep(WAIT_PAST_DEBOUNCE);
        asserts.check("JSON読込（戻す） → PUT本文", m.puts[m.puts.length - 1], API_V2);
      } finally { m.restore(); }
    },
  },
  {
    id: "A6-editor-per-run",
    name: "認可書実績の編集画面：型式ランごとの欄で編集できる",
    expect: "同じ型式でもランごとに別の欄。片方を入力・消去しても他方は変わらない。帳票の色もランごとに変わる",
    async run({ mount, mountApi, asserts }) {
      const c = await mountWith(mount);
      await openTab(c, "認可書実績");
      const heads = [...c.querySelectorAll("table thead th")].slice(1).map((th) => th.textContent);
      asserts.check("列は型式ラン（型式・プロジェクトコード・新継）", heads, ["CR-APJ-1・新", "CR-APJ-2・継", "CR-BPJ-1・新", "CR-CPJ-9・新"]);
      asserts.check("欄の数＝型式ラン × 法規行", c.querySelectorAll('input[placeholder="認可書番号"]').length, 12);
      asserts.check("同じ型式でも欄の値はランごと", [certInput(c, "r801", "g801").value, certInput(c, "r802", "g801").value], ["CR*01", " "]);
      setNativeValue(certInput(c, "r802", "g802"), "CR*NEW");
      await sleep(30);
      setNativeValue(certInput(c, "r801", "g801"), "");
      await sleep(30);
      asserts.check("書き換えは未書き出し扱い", c.textContent.includes("未書き出しの変更があります"), true);
      const snap = await snapshotAll(c);
      asserts.check("r801×g801 を消すとレコードごと消える", findCert(snap.cert, "r801", "g801"), null);
      asserts.check("r802×g802 は追加される（予定はなし）", findCert(snap.cert, "r802", "g802"), { runKey: "r802", rid: "g802", ck: "CR*NEW", planned: false });
      asserts.check("他のレコードは位置も値も変わらない",
        snap.cert.filter((x) => !(x.runKey === "r802" && x.rid === "g802")), V2.cert.filter((x) => !(x.runKey === "r801" && x.rid === "g801")));
      await openTab(c, "帳票");
      // F-23 B6：前ランの番号を消すと、空白だけの当ランも実績なしになる。
      asserts.check("帳票：番号なし・空白だけは両ランとも赤", [borderOf(cellAt(c, 0, 0)), borderOf(cellAt(c, 0, 1))], [RED_RGB, RED_RGB]);

      // API版も同じ部品・同じ単位で編集し、PUTへ出る
      const m = installApiMock(API_V2);
      try {
        const a = mountApi().container;
        await sleep(300); await sleep(WAIT_PAST_DEBOUNCE);
        await openTab(a, "認可書実績");
        setNativeValue(certInput(a, "r803", "g801"), "CR*API");
        await sleep(30); await sleep(WAIT_PAST_DEBOUNCE);
        const last = m.puts[m.puts.length - 1];
        asserts.check("API版：r803×g801 だけ追加されてPUT", last?.cert, [...API_V2.cert, { runKey: "r803", rid: "g801", ck: "CR*API", planned: false }]);
      } finally { m.restore(); }
    },
  },
  {
    id: "A7-delete-rename",
    name: "型式ラン・法規行の削除で認証実績も消え、型式記号・法規IDの変更では付いてくる",
    expect: "削除した行を指すレコードが残らない。型式記号・法規IDを変えてもレコードは同じ組のまま・帳票の緑も変わらない",
    async run({ mount, mountApi, asserts }) {
      // 純関数
      asserts.check("pruneCertByRun", pruneCertByRun(V2.cert, "PJ:9|x").map((x) => x.runKey), ["r801", "r802", "r803", "r801"]);
      asserts.check("pruneCertByReg", pruneCertByReg(V2.cert, "g801").map((x) => x.rid), ["g802", "g803", "g802"]);
      asserts.checkTrue("変化が無ければ同じ配列", pruneCertByRun(V2.cert, "r999") === V2.cert && pruneCertByReg(V2.cert, "g999") === V2.cert);
      asserts.checkTrue("setCertNumber：同じ値なら同じ配列", setCertNumber(V2.cert, "r801", "g801", "CR*01") === V2.cert);
      // 単体版：名前の変更
      const c = await mountWith(mount);
      await openTab(c, "型式ラン");
      setNativeValue(c.querySelectorAll("table tbody tr")[0].querySelector("input"), "CR-A-RENAMED");
      await sleep(30);
      await openTab(c, "法規DB");
      setNativeValue(c.querySelectorAll("table tbody tr")[0].querySelector("input"), "CR-REG-1-RENAMED");
      await sleep(30);
      let snap = await snapshotAll(c);
      asserts.check("型式記号・法規IDを変えても cert は同じ", snap.cert, V2.cert);
      await openTab(c, "帳票");
      asserts.check("帳票：r801×（名前を変えた法規1）は緑のまま", borderOf(cellAt(c, 0, 0)), GREEN_RGB);
      // 単体版：削除
      await deleteRow(c, "型式ラン", 3);   // PJ:9|x
      await deleteRow(c, "法規DB", 1);     // g802
      snap = await snapshotAll(c);
      asserts.check("削除後の cert", snap.cert, V2.cert.filter((x) => x.runKey !== "PJ:9|x" && x.rid !== "g802"));
      asserts.check("削除後に読み直せる（孤立参照が残っていない）", parseImportedData(clone(snap)).ok, true);
      // API版：削除
      const m = installApiMock(API_V2);
      try {
        const a = mountApi().container;
        await sleep(300); await sleep(WAIT_PAST_DEBOUNCE);
        await deleteRow(a, "型式ラン", 0);   // r801
        await sleep(WAIT_PAST_DEBOUNCE);
        await deleteRow(a, "法規DB", 2);     // g803
        await sleep(WAIT_PAST_DEBOUNCE);
        const last = m.puts[m.puts.length - 1];
        asserts.check("API版：削除した行の実績はPUTに残らない", last?.cert, API_V2.cert.filter((x) => x.runKey !== "r801" && x.rid !== "g803"));
      } finally { m.restore(); }
    },
  },
  {
    id: "R2-api-v2-requires-rid",
    name: "Codexレビュー指摘2：API版で版2の文書を読むとき、rid の無い法規行を補番して実績を結び付けない",
    expect: "rid の無い法規行を含む版2のJSONは拒否し、state・PUTを変えない（単体版と同じ扱い）",
    async run({ mountApi, asserts }) {
      const m = installApiMock(API_V2);
      try {
        const a = mountApi().container;
        await sleep(300); await sleep(WAIT_PAST_DEBOUNCE);
        const before = m.puts.length;
        window.__ALERTS__ = [];
        selectFile(a, JSON.stringify({ schemaVersion: 2,
          runs: [{ key: "r1", typeId: "DEMO-A", gen: "PJ-A", sk: "新", lo: "", drop: "" }],
          regs: [{ id: "DEMO-B", label: "ダミーB", shin: "", kei: "", parent: "" }],
          cert: [{ runKey: "r1", rid: "g7", ck: "DEMO-A-CK", planned: false }] }));
        await sleep(150); await sleep(WAIT_PAST_DEBOUNCE);
        asserts.check("拒否の知らせが出る", window.__ALERTS__.filter((x) => x.includes("rid")).length, 1);
        asserts.check("PUTは増えない", m.puts.length - before, 0);
        asserts.check("中身は元のまま", await snapshotApi(a), API_V2);
      } finally { m.restore(); }
    },
  },
  {
    id: "R3-api-v2-empty-stays-empty",
    name: "Codexレビュー指摘3：版2として保存済みの空データは、開き直しても空のまま（SEEDに置き換えない）",
    expect: "版2の空応答ではSEEDを出さず、書き戻しも空。版なしの空応答（未初期化DB）は従来どおりSEEDを投入する",
    async run({ mountApi, asserts }) {
      const EMPTY_V2 = { schemaVersion: 2, runs: [], regs: [], cert: [] };
      const m = installApiMock(EMPTY_V2);
      try {
        const a = mountApi().container;
        await sleep(300); await sleep(WAIT_PAST_DEBOUNCE);
        asserts.check("SEEDの型式を出さない", a.textContent.includes("DEMO-0001"), false);
        asserts.check("書き戻しは空のまま", m.puts.map((b) => [b.runs.length, b.regs.length, b.cert.length]), [[0, 0, 0]]);
      } finally { m.restore(); }
      const m2 = installApiMock({ runs: [], regs: [], cert: {} });
      try {
        const a = mountApi().container;
        await sleep(300); await sleep(WAIT_PAST_DEBOUNCE);
        asserts.check("版なしの空応答はSEEDを投入（従来どおり）", [a.textContent.includes("DEMO-0001"), m2.puts[0]?.runs.length], [true, SEED.runs.length]);
      } finally { m2.restore(); }
    },
  },
  {
    id: "B1-B5-same-view",
    name: "見え方と判定の結論が変わらない（旧形式の入口と、移行後の入口を突き合わせる）",
    expect: "SEEDと、法規IDの重複・空、空白だけ・空文字の番号、付け先の無い実績、比較元・同一性を混ぜた300組のダミーで、全セルの判定・色の元になる表示区分・漏れ一覧・実効drop・危険一覧が1件も違わない",
    async run({ asserts }) {
      // SEED：F-22より前の型式単位の表（SEEDのコメントと同じ番号）を旧い入口で読み、SEEDの cert を新しい入口で読む
      const legacySeedCert = {
        "DEMO-0001": { "DEMO-REG-A": "DEMO*A00/00*01", "DEMO-REG-B": "DEMO*B00/00*01", "DEMO-REG-D": "DEMO*D00/00*01" },
        "DEMO-0002": { "DEMO-REG-A": "DEMO*A00/00*02", "DEMO-REG-D": "DEMO*D00/00*02" },
        "DEMO-0003": { "DEMO-REG-A": "DEMO*A00/00*03", "DEMO-REG-A2": "DEMO*A02/00*01", "DEMO-REG-B": "DEMO*B00/00*02", "DEMO-REG-D": "DEMO*D00/00*03" },
        "DEMO-0004": { "DEMO-REG-A": "DEMO*A00/00*04", "DEMO-REG-A2": "DEMO*A02/00*02", "DEMO-REG-D": "DEMO*D00/00*04" },
        "DEMO-0005": { "DEMO-REG-A": "DEMO*A00/00*05", "DEMO-REG-B": "DEMO*B00/00*03", "DEMO-REG-C": "DEMO*C00/00*01", "DEMO-REG-D": "DEMO*D00/00*05" },
        // F-28でSEEDに足した型式（r11）。SEEDのコメントの表と同じ番号
        "DEMO-0006": { "DEMO-REG-A": "DEMO*A00/00*06", "DEMO-REG-A2": "DEMO*A02/00*03", "DEMO-REG-C": "DEMO*C00/00*02" },
      };
      // F-25でSEEDにLO空のラン（r9）が入った。旧い入口はF-24（LO空＝判定不能）より前の写しなので、
      // LOのあるランだけで突き合わせる（比べたいのは番号の持ち方の違いで、F-24の判定ではない）。
      const seedLo = { ...SEED, runs: SEED.runs.filter((r) => r.lo !== "") };
      const seedOld = viewOf(seedLo, legacyEvalCellWith, legacySeedCert);
      const seedNew = viewOf(seedLo, evalCellWith, SEED.cert);
      asserts.check("SEED：旧い入口と新しい入口で見え方が同じ", JSON.stringify(seedNew) === JSON.stringify(seedOld), true);
      asserts.check("SEED：漏れ件数・危険ラン数（参考）", [seedNew.leaks.length, seedNew.risk.length], [seedOld.leaks.length, seedOld.risk.length]);
      // 疑似乱数のダミー300組
      let diffs = 0, cells = 0, withCert = 0, first = "";
      for (let seed = 1; seed <= 300; seed++) {
        const d = randomLegacyData(seed);
        const oldV = viewOf(d, legacyEvalCellWith, d.cert);
        const newV = viewOf(d, evalCellWith, migrateLegacyCert(d.cert, d.runs, d.regs));
        cells += newV.cells.length;
        withCert += newV.cells.filter((x) => x.auto.ck).length;
        if (JSON.stringify(oldV) !== JSON.stringify(newV)) { diffs++; if (!first) first = `seed=${seed}`; }
      }
      asserts.check("300組で違いが出た組の数", [diffs, first], [0, ""]);
      asserts.checkTrue(`突き合わせたセル数（${cells}）・実績ありのセル数（${withCert}）が十分ある`, cells > 3000 && withCert > 300);
      // 対照実験：旧い入口が「同じ型式の別ランの実績」を読むことを、新しい形で1ランだけ消すと差が出ることで確かめる
      const d = randomLegacyData(7);
      const mig = migrateLegacyCert(d.cert, d.runs, d.regs);
      const dropped = mig.length ? pruneCertByRun(mig, mig[0].runKey) : mig;
      asserts.checkTrue("対照：実績を1ランぶん消すと差が出る（この突き合わせが空振りしていない）",
        mig.length > 0 && JSON.stringify(viewOf(d, evalCellWith, dropped)) !== JSON.stringify(viewOf(d, legacyEvalCellWith, d.cert)));
    },
  },
  {
    id: "B2-no-handover",
    name: "引き継ぎ確認中を出さない（handover は false のまま）",
    expect: "SEED・版2のダミー・300組のどのセルにも「引き継ぎ確認中」が出ない。評価関数の戻り値に handover が無い",
    async run({ mount, asserts }) {
      const all = [viewOf(SEED, evalCellWith, SEED.cert)];
      for (let seed = 1; seed <= 300; seed++) { const d = randomLegacyData(seed); all.push(viewOf(d, evalCellWith, migrateLegacyCert(d.cert, d.runs, d.regs))); }
      asserts.check("引き継ぎ確認中のセル数", all.reduce((n, v) => n + v.cells.filter((x) => x.decision.表示 === "引き継ぎ確認中").length, 0), 0);
      asserts.check("評価関数の戻り値の項目は従来どおり", Object.keys(evalCellWith(V2.cert, V2.runs[0], V2.regs[0])).sort(),
        ["applied", "ck", "dueDate", "kind", "required", "status"]);
      const c = await mountWith(mount);
      // 凡例には説明として語が出るので、帳票のセル（tbody）だけを見る
      asserts.check("帳票のセルにも出ない", c.querySelector("table tbody").textContent.includes("引き継ぎ確認中"), false);
    },
  },
  {
    id: "B3-no-plan-ui",
    name: "取得予定の入力UIを出さない・予定は判定に使わない（器だけ）",
    expect: "認可書実績タブに予定の入力部品が無い。画面の編集で予定が true にならない。読み込んだ予定 true は保たれるが結論は変えない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount);
      await openTab(c, "認可書実績");
      const panel = c.querySelector("table").closest("div").parentElement;
      asserts.check("チェックボックス・ラジオ・選択欄が無い", panel.querySelectorAll('input[type="checkbox"],input[type="radio"],select').length, 0);
      asserts.check("「予定」「○」の文字が無い", /予定|○/.test(panel.textContent), false);
      setNativeValue(certInput(c, "r803", "g803"), "CR*X");
      await sleep(30);
      const snap = await snapshotAll(c);
      asserts.check("画面の編集で予定が true になるのは読み込んだ1件だけ", snap.cert.filter((x) => x.planned).map((x) => [x.runKey, x.rid]), [["PJ:9|x", "g802"]]);
      // 予定 true は判定に使わない：予定を false にしたデータと結論が同じ
      const flat = V2.cert.map((x) => ({ ...x, planned: false }));
      const run = V2.runs[3], reg = V2.regs[1];
      asserts.check("予定ありでも結論は同じ（実績なし＝申請発生のまま）", evalCellWith(V2.cert, run, reg), evalCellWith(flat, run, reg));
      asserts.check("そのセルは申請発生", evalCellWith(V2.cert, run, reg).status, "leak");
      // 予定 true のレコードは番号を消しても消えない（器を落とさない）
      asserts.check("setCertNumber：予定ありは番号を消しても残る", setCertNumber(V2.cert, "PJ:9|x", "g802", ""), V2.cert);
    },
  },
  {
    id: "B4-no-cross-type",
    name: "比較元（異型式）の認証実績を読まない・書かない・コピーしない",
    expect: "同一性を「同一」と答えた型式ランでも、比較元の型式の実績は読まない。移行でも別型式へは写さない",
    async run({ mount, asserts }) {
      const d = {
        schemaVersion: 2,
        runs: [
          { key: "r811", typeId: "CX-BASE", gen: "PJ-X", sk: "新", lo: "2020-01-01", drop: "2030-12-31" },
          { key: "r812", typeId: "CX-NEW", gen: "PJ-X", sk: "新", lo: "2021-01-01", drop: "2030-12-31" },
        ],
        regs: [{ rid: "g811", id: "CX-REG", label: "ダミー", shin: "2020-06-01", kei: "2022-01-01", parent: "" }],
        cert: [{ runKey: "r811", rid: "g811", ck: "CX*BASE", planned: false }],
        decisions: [],
        bases: [{ runKey: "r812", baseRunKey: "r811", decidedAt: "2026-09-01 10:00" }],
        sameness: [{ runKey: "r812", rid: "g811", value: "同一", reason: "ダミー", decidedAt: "2026-09-01 10:00", needsRecheck: false, baseRunKey: "r811" }],
      };
      const ctx = makeSamenessContext(d.runs, d.bases, d.sameness);
      const e = evalCellWith(d.cert, d.runs[1], d.regs[0], ctx.effective(d.runs[1], d.regs[0]));
      asserts.check("同一でも比較元の番号は読まない", [e.applied, e.ck], ["継続車日", null]);
      asserts.check("移行でも別型式へ写さない", migrateLegacyCert({ "CX-BASE": { "CX-REG": "CX*BASE" } }, d.runs, d.regs).map((x) => x.runKey), ["r811"]);
      const c = await mountWith(mount, d);
      const snap = await snapshotAll(c);
      asserts.check("起動・書き出しでも cert は比較元の1件だけ", snap.cert, d.cert);
    },
  },
  {
    id: "B6-blank-number",
    name: "空白だけの管理番号は今のまま「実績あり」（trim しない）",
    expect: "\" \" は実績あり・緑。書き出し・読み直しでも \" \" のまま。空文字は実績なし",
    async run({ mount, asserts }) {
      asserts.check("空白だけ＝実績あり", evalCellWith(V2.cert, V2.runs[1], V2.regs[0]).status, "ok");
      asserts.check("空文字＝実績なし", evalCellWith(V2.cert, V2.runs[0], V2.regs[2]).ck, null);
      const c = await mountWith(mount);
      asserts.check("帳票：r802×CR-REG-1（空白だけ）は緑", borderOf(cellAt(c, 0, 1)), GREEN_RGB);
      await openTab(c, "認可書実績");
      asserts.check("編集欄にも空白のまま出る", certInput(c, "r802", "g801").value, " ");
      asserts.check("書き出しても空白のまま", findCert((await snapshotAll(c)).cert, "r802", "g801").ck, " ");
    },
  },
];

// ───────────────────────────────────────────────
function Runner() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const runAll = async () => {
    if (window.__CERTVERIFY_RUNNING__) return;
    window.__CERTVERIFY_RUNNING__ = true;
    setRunning(true); setDone(false); setResults({});
    const collected = {};
    try {
      for (const s of SCENARIOS) {
        setResults((p) => ({ ...p, [s.id]: { state: "running" } }));
        await sleep(20);
        window.__ALERTS__ = [];
        const mgr = createMountManager();
        const asserts = createAsserts();
        let outcome;
        try {
          await s.run({ mount: mgr.mount, mountApi: mgr.mountApi, asserts });
          outcome = { state: "done", pass: asserts.failures.length === 0, actual: asserts.notes.join(" / "), detail: asserts.failures.join("\n") };
        } catch (e) {
          outcome = { state: "done", pass: false, actual: `例外: ${e.message}`, detail: String(e.stack || "") };
        } finally {
          mgr.cleanupAll();
        }
        collected[s.id] = outcome;
        setResults((p) => ({ ...p, [s.id]: outcome }));
        await sleep(50);
      }
    } finally {
      setRunning(false); setDone(true);
      const vals = Object.values(collected);
      window.__CERTVERIFY_RESULT__ = {
        finished: true,
        pass: vals.filter((r) => r.pass).length,
        fail: vals.filter((r) => !r.pass).length,
        total: SCENARIOS.length,
        residualNodes: document.getElementById("sandbox").childElementCount,
        scenarios: SCENARIOS.map((s) => ({ id: s.id, name: s.name, pass: collected[s.id]?.pass, actual: collected[s.id]?.actual, detail: collected[s.id]?.detail })),
      };
      window.__CERTVERIFY_RUNNING__ = false;
    }
  };
  useEffect(() => {
    window.__runCertVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);
  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>認証実績の器の付け替え（F-22） 検証ハーネス</h1>
      <p style={{ color: "#5a6b7d", fontSize: 12.5, lineHeight: 1.7, marginTop: 0 }}>
        実際の <code>StandaloneApp</code> / <code>IListApp</code> をマウントして実測します。<br />
        <strong style={{ color: "#e0b24d" }}>ダミーデータのみ。実APIサーバ・実DBには接続しません。</strong>
      </p>
      <button onClick={runAll} disabled={running}
        style={{ background: running ? "#22303f" : "#4dd6e0", color: running ? "#5a6b7d" : "#0c1623", border: "none", borderRadius: 7, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: running ? "default" : "pointer" }}>
        {running ? "検証を実行中…" : "すべての検証を実行"}
      </button>
      {done && (
        <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, fontSize: 13, fontWeight: 700,
          background: fail === 0 ? "rgba(63,191,143,0.13)" : "rgba(255,107,87,0.16)",
          border: `1px solid ${fail === 0 ? "#3fbf8f" : "#ff6b57"}`, color: fail === 0 ? "#3fbf8f" : "#ff6b57" }}>
          総合結果: PASS {pass} / FAIL {fail}（全 {SCENARIOS.length} 件）
        </div>
      )}
      <div style={{ marginTop: 18 }}>
        {SCENARIOS.map((s) => {
          const r = results[s.id];
          const color = !r ? "#22303f" : r.state === "running" ? "#e0b24d" : r.pass ? "#3fbf8f" : "#ff6b57";
          return (
            <div key={s.id} style={{ background: "#13202f", border: `1px solid ${color}`, borderRadius: 10, padding: "12px 15px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#5a6b7d" }}>{s.id}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#eef4fa", flex: 1 }}>{s.name}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color }}>{!r ? "未実行" : r.state === "running" ? "実行中…" : r.pass ? "PASS" : "FAIL"}</span>
              </div>
              <div style={{ fontSize: 11.5, color: "#8fa3b8", lineHeight: 1.7 }}>
                <div><span style={{ color: "#5a6b7d" }}>期待結果：</span>{s.expect}</div>
                {r?.state === "done" && <div><span style={{ color: "#5a6b7d" }}>実測：</span>{r.actual}</div>}
                {r?.state === "done" && r.detail && (
                  <div style={{ marginTop: 4, fontFamily: "ui-monospace, monospace", fontSize: 10.5, color: "#ff9e7d", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{r.detail}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div id="sandbox" style={{ position: "absolute", left: -99999, top: 0, width: 1400, height: 900, overflow: "hidden" }} />
    </div>
  );
}

createRoot(document.getElementById("runner")).render(<Runner />);
