// ───────────────────────────────────────────────
// 規制再判定のデータ（F-04：比較元・同一性・LO／drop）の検証ハーネス
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない
// （API版のケースでは window.fetch をモックし、PUTの発生回数と本文を実測する）。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/regs-data.html
//
// 完成条件 A1〜A8（Notion「Iリスト｜バックログ」F-04）を、ケースIDの先頭で対応づける。
// ───────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import IListApp, {
  SEED, parseImportedData, replaceBootData, readBootData, evalCellWith,
  baseCandidates, baseOf, setBase, samenessMatters, effectiveSameness, sweepSameness,
  nextSamenessRecord, SAMENESS_VALUES,
} from "../src/IListApp.jsx";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
window.__ALERTS__ = [];
window.alert = (m) => { window.__ALERTS__.push(String(m)); };
window.confirm = (m) => { window.__ALERTS__.push("confirm:" + String(m)); return true; };

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

// ── ダミーデータ（架空。実車・実法規・実認可番号とは無関係。車名・車種名は持たない） ──
//   PJ-1：既存型式 DEMO-P と、後から追加された型式 DEMO-Q（LOが違う＝A1）
//   PJ-2：同じ2型式が続く
//   PJ-3：別プロジェクトの DEMO-R（比較元の候補に出てはいけない）
const DUMMY = {
  runs: [
    { key: "r201", typeId: "DEMO-P", gen: "PJ-1", sk: "新", lo: "2021-01-01", drop: "2022-12-31" },
    { key: "r202", typeId: "DEMO-Q", gen: "PJ-1", sk: "新", lo: "2021-06-01", drop: "2022-12-31" },
    { key: "r203", typeId: "DEMO-Q", gen: "PJ-2", sk: "継", lo: "2023-01-01", drop: "2025-12-31" },
    { key: "r204", typeId: "DEMO-P", gen: "PJ-2", sk: "継", lo: "2023-01-01", drop: "2025-12-31" },
    { key: "r205", typeId: "DEMO-R", gen: "PJ-3", sk: "新", lo: "2021-01-01", drop: "2030-12-31" },
  ],
  regs: [
    // 新型車日 2021-03-01／継続車日 2023-10-01：DEMO-Q(PJ-1) は同一なら否、同一でなければ新型車日で申請発生
    { rid: "g201", id: "REG-N", label: "ダミー法規N", shin: "2021-03-01", kei: "2023-10-01", parent: "" },
    // 継続車日 2020-01-01：どのランもLO≥継続車日＝同一性で結論が変わらない（要再確認の対象外）
    { rid: "g202", id: "REG-M", label: "ダミー法規M", shin: "2019-01-01", kei: "2020-01-01", parent: "" },
  ],
  cert: { "DEMO-P": { "REG-M": "CK-PM" } },
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const COL = { r201: 0, r202: 1, r203: 2, r204: 3, r205: 4, r206: 5, r207: 5 };   // r206・r207 は個別ケースで6列目に足すラン
const ROW = { g201: 0, g202: 1 };
const STAMP = "2026-09-19 10:20";
const REASON_TRICKY = "同一性メモ（ダミー）</script><script>window.__PWNED__=1</script><b>太字にならない</b> & \" '";

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
  await sleep(10);
}
const openTab = (c, name) => clickByText(c, new RegExp(`^${name}`));
function cellAt(c, row, col) {
  const tr = c.querySelector("table tbody")?.children[row];
  const td = tr?.children[col + 1];
  if (!td) throw new Error(`帳票のセルがありません: ${row},${col}`);
  return td;
}
const cellText = (c, run, rid) => cellAt(c, ROW[rid], COL[run]).textContent;
const headText = (c, run) => c.querySelectorAll("table thead th")[COL[run] + 1]?.textContent || "";
const baseSelects = (c) => [...c.querySelectorAll('select[aria-label="比較元"]')];
const baseRowText = (c, i) => baseSelects(c)[i].parentElement.textContent;
const optionValues = (sel) => [...sel.options].map((o) => o.value);
const runLoInputs = (c) => [...c.querySelectorAll('table tbody tr')].map((tr) => tr.querySelectorAll('input[type="date"]')[0]).filter(Boolean);

async function withFakeClock(iso, fn) {
  const Real = window.Date;
  class Fake extends Real {
    constructor(...a) { if (a.length === 0) super(iso); else super(...a); }
    static now() { return new Real(iso).getTime(); }
  }
  window.Date = Fake;
  try { return await fn(); } finally { window.Date = Real; }
}

// 型式ランタブで比較元を選ぶ（"" で未選択に戻す）。帳票タブへ戻して終える。
async function chooseBase(c, runKey, baseRunKey) {
  await openTab(c, "型式ラン");
  const sel = baseSelects(c)[COL[runKey]];
  await withFakeClock("2026-09-19T10:20:00", async () => { setNativeValue(sel, baseRunKey); await sleep(20); });
  await openTab(c, "帳票");
}

// 帳票セルの同一性を編集する。action を省略すると通常の保存ボタンを押す。
async function editSame(c, run, rid, { value, reason, action } = {}) {
  const td = () => cellAt(c, ROW[rid], COL[run]);
  const open = td().querySelector('button[title="同一性を編集"]');
  if (!open) throw new Error(`同一性の編集ボタンがありません: ${run} × ${rid}`);
  open.click();
  await sleep(10);
  if (value !== undefined) {
    const radios = td().querySelectorAll('input[type="radio"]');
    radios[SAMENESS_VALUES.indexOf(value)].click();
    await sleep(5);
  }
  if (reason !== undefined) { setNativeValue(td().querySelector("textarea"), reason); await sleep(5); }
  const btns = [...td().querySelectorAll("button")];
  const btn = action ? btns.find((b) => b.textContent.includes(action))
    : btns.find((b) => /メモを保存|未確認に戻す|この回答で確定/.test(b.textContent));
  if (!btn) throw new Error(`保存ボタンがありません（候補: ${btns.map((b) => b.textContent).join(" | ")}）`);
  await withFakeClock("2026-09-19T10:20:00", async () => { btn.click(); await sleep(30); });
}

async function snapshotAll(c) {
  const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL, realClick = HTMLAnchorElement.prototype.click;
  let blob = null;
  URL.createObjectURL = (b) => { blob = b; return "blob:dummy"; };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () {};
  try {
    await clickByText(c, /JSONに書き出し/);
    await sleep(60);
    if (!blob) throw new Error("書き出しのBlobを取得できませんでした");
    return JSON.parse(await blob.text());
  } finally {
    URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke; HTMLAnchorElement.prototype.click = realClick;
  }
}
function selectFile(c, text) {
  const inp = c.querySelector('input[type="file"]');
  const dt = new DataTransfer();
  dt.items.add(new File([text], "d.json", { type: "application/json" }));
  Object.defineProperty(inp, "files", { value: dt.files, configurable: true });
  inp.dispatchEvent(new Event("change", { bubbles: true }));
}
const findSame = (snap, runKey, rid) => (snap.sameness || []).find((s) => s.runKey === runKey && s.rid === rid) || null;
const hasRecheck = (c, run, rid) => cellText(c, run, rid).includes("要再確認");

function installApiMock(data) {
  const real = window.fetch;
  const puts = [];
  window.fetch = async (url, opts) => {
    if (String(url) !== "/api/data") throw new Error("想定外のfetch: " + url);
    if (!opts || !opts.method || opts.method === "GET") return { ok: true, json: async () => clone(data) };
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
async function mountWith(mount, data = DUMMY) {
  const parsed = parseImportedData(clone(data));
  if (!parsed.ok) throw new Error("ダミーデータが不正です: " + parsed.error);
  const app = mount({ present: true, ok: true, data: parsed.data, maxId: parsed.maxId, maxRid: parsed.maxRid });
  await sleep(60);
  return app.container;
}

// ───────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "A1-lo-drop-per-type",
    name: "型式ランごとにLO／dropを持ち、同じプロジェクト内でも型式ごとに違う日付で判定される",
    expect: "PJ-1のDEMO-PとDEMO-QでLOが違い、同じ法規で判定が分かれる。片方のLOを変えても他方は変わらない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount);
      await openTab(c, "型式ラン");
      asserts.check("PJ-1の2ランのLO", runLoInputs(c).slice(0, 2).map((i) => i.value), ["2021-01-01", "2021-06-01"]);
      await openTab(c, "帳票");
      asserts.checkTrue("DEMO-P(PJ-1)×REG-N は否", cellText(c, "r201", "g201").includes("否"));
      asserts.checkTrue("DEMO-Q(PJ-1)×REG-N は申請発生", cellText(c, "r202", "g201").includes("申請発生"));
      await openTab(c, "型式ラン");
      setNativeValue(runLoInputs(c)[0], "2021-04-01");
      await sleep(20);
      await openTab(c, "帳票");
      asserts.checkTrue("DEMO-PのLO変更で DEMO-P×REG-N が申請発生へ", cellText(c, "r201", "g201").includes("申請発生"));
      const snap = await snapshotAll(c);
      asserts.check("変更したランだけLOが変わる", snap.runs.map((r) => r.lo), ["2021-04-01", "2021-06-01", "2023-01-01", "2023-01-01", "2021-01-01"]);
      asserts.check("dropは型式ランごとに保持", snap.runs.map((r) => r.drop), DUMMY.runs.map((r) => r.drop));
    },
  },
  {
    id: "A2-base-select",
    name: "同じプロジェクト内の既存型式を比較元として1件選んで確定でき、未選択と選択済みが区別できる",
    expect: "候補は同じプロジェクトの別型式だけ。選ぶと bases に1件入り『選択済み』、帳票見出しに比較元が出る。未選択に戻すと消える",
    async run({ mount, asserts }) {
      const c = await mountWith(mount);
      await openTab(c, "型式ラン");
      const sels = baseSelects(c);
      asserts.check("比較元欄は全ランにある", sels.length, 5);
      asserts.check("DEMO-Q(PJ-1)の候補", optionValues(sels[1]), ["", "r201"]);
      asserts.check("DEMO-P(PJ-1)の候補", optionValues(sels[0]), ["", "r202"]);
      asserts.check("DEMO-Q(PJ-2)の候補", optionValues(sels[2]), ["", "r204"]);
      asserts.check("別プロジェクトしかないDEMO-Rは候補なし", optionValues(sels[4]), [""]);
      asserts.checkTrue("DEMO-Rは『候補なし』と出る", baseRowText(c, 4).includes("候補なし"));
      asserts.check("初期は全ラン未選択", sels.map((s) => s.value), ["", "", "", "", ""]);
      asserts.checkTrue("未選択の表示", baseRowText(c, 1).includes("（未選択）") && baseRowText(c, 1).includes("候補 1 件"));

      await chooseBase(c, "r202", "r201");
      asserts.checkTrue("帳票見出しに比較元が出る", headText(c, "r202").includes("比較元 DEMO-P"));
      asserts.checkTrue("未選択の列には出ない", !headText(c, "r201").includes("比較元"));
      await openTab(c, "型式ラン");
      asserts.checkTrue("選択済みの表示と確定日時", baseRowText(c, 1).includes(`選択済み（${STAMP}）`));
      asserts.checkTrue("他のランは未選択のまま", baseRowText(c, 0).includes("候補 1 件"));
      let snap = await snapshotAll(c);
      asserts.check("bases は1件", snap.bases, [{ runKey: "r202", baseRunKey: "r201", decidedAt: STAMP }]);

      await chooseBase(c, "r202", "");
      snap = await snapshotAll(c);
      asserts.check("未選択に戻すと bases から消える", snap.bases, []);
      asserts.checkTrue("見出しの比較元も消える", !headText(c, "r202").includes("比較元"));
    },
  },
  {
    id: "A3-sameness-per-cell",
    name: "型式ラン×法規ごとに同一性（同一／同一でない／未確認）を持てる",
    expect: "比較元を選んだ列にだけ『同一性：未確認』が出る。セルごとに別の値を保存でき、他のセル・他のランには影響しない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount);
      asserts.checkTrue("比較元未選択なら同一性は出ない", !c.querySelector("table tbody").textContent.includes("同一性："));
      await chooseBase(c, "r202", "r201");
      asserts.checkTrue("比較元を選んだ列に未確認", cellText(c, "r202", "g201").includes("同一性：未確認") && cellText(c, "r202", "g202").includes("同一性：未確認"));
      asserts.checkTrue("他の列には出ない", !cellText(c, "r201", "g201").includes("同一性") && !cellText(c, "r203", "g201").includes("同一性"));
      await editSame(c, "r202", "g201", { value: "同一", reason: REASON_TRICKY });
      await editSame(c, "r202", "g202", { value: "同一でない" });
      asserts.checkTrue("g201は同一", cellText(c, "r202", "g201").includes("同一性：同一"));
      asserts.checkTrue("g202は同一でない", cellText(c, "r202", "g202").includes("同一性：同一でない"));
      const snap = await snapshotAll(c);
      asserts.check("sameness は2件（セルごと）", snap.sameness.map((s) => [s.runKey, s.rid, s.value, s.baseRunKey]),
        [["r202", "g201", "同一", "r201"], ["r202", "g202", "同一でない", "r201"]]);
      asserts.check("メモは文字のまま保存", findSame(snap, "r202", "g201").reason, REASON_TRICKY);
      asserts.check("HTML風メモは実行されない", window.__PWNED__, undefined);
      asserts.check("確定日時", findSame(snap, "r202", "g201").decidedAt, STAMP);
    },
  },
  {
    id: "A4-applied-date",
    name: "同一なら継続車日、同一でないなら新型車日を適用し、どちらを適用しているかがセルで分かる",
    expect: "DEMO-Q(PJ-1)×REG-N：同一→『継続車日を適用』で否、同一でない→『新型車日を適用』で申請発生、未確認→『新継どおり』。PJ-2では同じ型式・法規でも答えが割れる",
    async run({ mount, asserts }) {
      const c = await mountWith(mount);
      await chooseBase(c, "r202", "r201");
      await chooseBase(c, "r203", "r204");
      asserts.checkTrue("未確認は新継どおり（申請発生）", cellText(c, "r202", "g201").includes("新継どおり") && cellText(c, "r202", "g201").includes("申請発生"));
      await editSame(c, "r202", "g201", { value: "同一" });
      let t = cellText(c, "r202", "g201");
      asserts.checkTrue("同一→継続車日を適用・否", t.includes("継続車日を適用") && t.includes("否") && !t.includes("申請発生"));
      const leaksCard = () => [...c.querySelectorAll("h3")].find((h) => h.textContent.includes("コンプラ漏れ")).parentElement.parentElement.textContent;
      asserts.checkTrue("集計（コンプラ漏れ）からも消える", !/DEMO-Q（PJ-1）\s*×\s*REG-N/.test(leaksCard()));
      await editSame(c, "r203", "g201", { value: "同一でない" });
      t = cellText(c, "r203", "g201");
      asserts.checkTrue("PJ-2で同一でない→新型車日を適用 2021/03", t.includes("新型車日を適用 2021/03") && t.includes("申請発生"));
      asserts.checkTrue("PJ-1の同じ型式・法規は継続車日のまま", cellText(c, "r202", "g201").includes("継続車日を適用"));
      asserts.checkTrue("集計にPJ-2の新型が出る", /DEMO-Q（PJ-2）\s*×\s*REG-N新型/.test(leaksCard()));
      // 判定式そのもの（純関数）
      const run = DUMMY.runs[1], reg = DUMMY.regs[0];
      asserts.check("evalCellWith 省略時は従来どおり", evalCellWith({}, run, reg).status, "leak");
      asserts.check("evalCellWith 同一", [evalCellWith({}, run, reg, "同一").status, evalCellWith({}, run, reg, "同一").applied], ["off", "継続車日"]);
      asserts.check("evalCellWith 同一でない", [evalCellWith({}, run, reg, "同一でない").kind, evalCellWith({}, run, reg, "同一でない").applied], ["新型", "新型車日"]);
      asserts.check("evalCellWith 未確認", evalCellWith({}, run, reg, "未確認").applied, "");
    },
  },
  {
    id: "A5-recheck",
    name: "同一でない・未確認へ変わると要再確認。メモ保存では消えず、答え直して確定したときだけ消える",
    expect: "同一→同一でない で要再確認、メモ保存・JSON再読込では残り、『答え直して確定』で消える。未確認へ戻すと要再確認、同一と答え直すと消える。比較元の変更でも立つ。LO≥継続車日のセルでは立たない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount);
      await chooseBase(c, "r202", "r201");
      await editSame(c, "r202", "g201", { value: "同一" });
      asserts.checkTrue("同一では要再確認なし", !hasRecheck(c, "r202", "g201"));
      await editSame(c, "r202", "g201", { value: "同一でない" });
      asserts.checkTrue("同一でないへ変わると要再確認", hasRecheck(c, "r202", "g201"));
      await editSame(c, "r202", "g201", { reason: "メモだけ直す（ダミー）" });
      let snap = await snapshotAll(c);
      asserts.check("メモ保存では消えない", findSame(snap, "r202", "g201").needsRecheck, true);
      asserts.checkTrue("メモ保存後も表示される", hasRecheck(c, "r202", "g201"));

      // JSONへ書き出して読み直しても消えない
      selectFile(c, JSON.stringify(snap));
      await sleep(120);
      asserts.checkTrue("JSON再読込でも残る", hasRecheck(c, "r202", "g201"));

      await editSame(c, "r202", "g201", { action: "答え直して確定" });
      snap = await snapshotAll(c);
      asserts.check("答え直して確定で消える", [findSame(snap, "r202", "g201").value, findSame(snap, "r202", "g201").needsRecheck], ["同一でない", false]);
      asserts.checkTrue("表示も消える", !hasRecheck(c, "r202", "g201"));

      await editSame(c, "r202", "g201", { value: "未確認" });
      snap = await snapshotAll(c);
      asserts.check("未確認へ戻すと要再確認（記録は残る）", [findSame(snap, "r202", "g201")?.value, findSame(snap, "r202", "g201")?.needsRecheck], ["未確認", true]);
      await editSame(c, "r202", "g201", { value: "同一" });
      snap = await snapshotAll(c);
      asserts.check("同一と答え直すと消える", findSame(snap, "r202", "g201").needsRecheck, false);

      // 比較元を外す→選び直しても、答え直すまで残る
      await chooseBase(c, "r202", "");
      asserts.checkTrue("比較元が未選択の間は回答を判定に使わない（新継どおり＝申請発生）", cellText(c, "r202", "g201").includes("申請発生"));
      await chooseBase(c, "r202", "r201");
      snap = await snapshotAll(c);
      asserts.check("比較元の変更で要再確認（選び直しても残る）", findSame(snap, "r202", "g201").needsRecheck, true);
      await editSame(c, "r202", "g201", { action: "答え直して確定" });
      snap = await snapshotAll(c);
      asserts.check("答え直すと消え、いまの比較元で確定", [findSame(snap, "r202", "g201").needsRecheck, findSame(snap, "r202", "g201").baseRunKey], [false, "r201"]);

      // LO≥継続車日（REG-M）：同一性で結論が変わらないので要再確認を出さない
      await editSame(c, "r202", "g202", { value: "同一" });
      await editSame(c, "r202", "g202", { value: "同一でない" });
      asserts.checkTrue("LO≥継続車日のセルは要再確認なし", !hasRecheck(c, "r202", "g202"));
      asserts.check("samenessMatters", [samenessMatters(DUMMY.runs[1], DUMMY.regs[0]), samenessMatters(DUMMY.runs[1], DUMMY.regs[1]), samenessMatters({ lo: "" }, DUMMY.regs[1])], [true, false, true]);
    },
  },
  {
    id: "A6-overdue",
    name: "同一でないと確定して適用日が過去日になったら、要再確認が消えても期限超過と分かる",
    expect: "DEMO-Q(PJ-1)×REG-N を同一でない→答え直して確定。要再確認は出ず、『期限超過』『既発効・即対応』とコンプラ漏れの行が出る",
    async run({ mount, asserts }) {
      const c = await mountWith(mount);
      await chooseBase(c, "r202", "r201");
      await editSame(c, "r202", "g201", { value: "同一でない" });
      await editSame(c, "r202", "g201", { action: "答え直して確定" });
      const t = cellText(c, "r202", "g201");
      asserts.checkTrue("要再確認は消えている", !t.includes("要再確認"));
      asserts.checkTrue("期限超過と出る", t.includes("期限超過"));
      asserts.checkTrue("既発効・即対応と出る", t.includes("既発効・即対応"));
      const leaks = [...c.querySelectorAll("h3")].find((h) => h.textContent.includes("コンプラ漏れ")).parentElement.parentElement.textContent;
      asserts.checkTrue("コンプラ漏れに載る", /DEMO-Q（PJ-1）\s*×\s*REG-N新型\s*既発効・即対応/.test(leaks));
      asserts.checkTrue("同一なら期限超過は出ない（対照）", !cellText(c, "r201", "g201").includes("期限超過"));
    },
  },
  {
    id: "A7-legacy-and-roundtrip",
    name: "旧データは壊れず未選択・未確認として読め、JSON保存・復元とデータ入りHTMLの埋め込みで保持される",
    expect: "bases/sameness の無いJSONを読込→『JSONから読み込みました』・全ラン未選択・同一性表示なし・書出しは空配列。値入りデータはJSON往復・埋め込み往復で完全一致",
    async run({ mount, asserts }) {
      const c = await mountWith(mount);
      const legacy = clone(DUMMY);
      selectFile(c, JSON.stringify(legacy));
      await sleep(120);
      asserts.check("読込成功", window.__ALERTS__.filter((m) => !m.startsWith("confirm:")), []);
      let snap = await snapshotAll(c);
      asserts.check("旧データ：bases は空", snap.bases, []);
      asserts.check("旧データ：sameness は空", snap.sameness, []);
      asserts.check("旧データ：既存3領域は変わらない", [snap.runs, snap.regs, snap.cert], [legacy.runs, legacy.regs, legacy.cert]);
      asserts.checkTrue("同一性の表示なし", !c.querySelector("table tbody").textContent.includes("同一性："));
      await openTab(c, "型式ラン");
      asserts.check("全ラン未選択", baseSelects(c).map((s) => s.value), ["", "", "", "", ""]);
      await openTab(c, "帳票");
      // rid の無い旧JSON（decisions/sameness なし）も従来どおり読める
      const noRid = { ...clone(DUMMY), regs: DUMMY.regs.map(({ rid, ...r }) => r) };
      asserts.check("rid の無い旧JSONも受理", parseImportedData(noRid).ok, true);

      // 値入りデータの往復
      const full = {
        ...clone(DUMMY),
        decisions: [],
        bases: [{ runKey: "r202", baseRunKey: "r201", decidedAt: STAMP }, { runKey: "r203", baseRunKey: "r204", decidedAt: "2026-09-18 08:00" }],
        sameness: [
          { runKey: "r202", rid: "g201", value: "同一", reason: REASON_TRICKY, decidedAt: STAMP, needsRecheck: false, baseRunKey: "r201" },
          { runKey: "r203", rid: "g201", value: "同一でない", reason: "", decidedAt: STAMP, needsRecheck: true, baseRunKey: "r204" },
          { runKey: "r202", rid: "g202", value: "未確認", reason: "", decidedAt: "", needsRecheck: true, baseRunKey: "" },
        ],
      };
      selectFile(c, JSON.stringify(full));
      await sleep(150);
      snap = await snapshotAll(c);
      asserts.check("JSON往復：全体が一致", snap, full);
      selectFile(c, JSON.stringify(snap));
      await sleep(150);
      asserts.check("JSON再往復：全体が一致", await snapshotAll(c), full);

      const html = `<html><body><!--ILIST_BOOT_DATA_START--><!--ILIST_BOOT_DATA_END--></body></html>`;
      const rep = replaceBootData(html, snap);
      const doc = new DOMParser().parseFromString(rep.html, "text/html");
      const boot = readBootData(doc);
      asserts.check("埋め込み往復：読める", [boot.present, boot.ok], [true, true]);
      asserts.check("埋め込み往復：bases一致", boot.data.bases, full.bases);
      asserts.check("埋め込み往復：sameness一致", boot.data.sameness, full.sameness);
      const c2 = mount(boot).container;
      await sleep(80);
      asserts.check("埋め込みから起動したアプリの書出しも一致", await snapshotAll(c2), full);
      asserts.checkTrue("埋め込みから起動：見出しに比較元", headText(c2, "r202").includes("比較元 DEMO-P"));
      asserts.check("HTML風メモは実行されない", window.__PWNED__, undefined);
    },
  },
  {
    id: "A7-reject-broken",
    name: "壊れた bases / sameness は現在のデータを一切置換せずに拒否される",
    expect: "各不正パターンで拒否の案内が出て、書出し内容は変わらない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount);
      await chooseBase(c, "r202", "r201");
      const before = await snapshotAll(c);
      const okS = { runKey: "r202", rid: "g201", value: "同一", reason: "", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r201" };
      const okB = { runKey: "r202", baseRunKey: "r201", decidedAt: STAMP };
      const cases = [
        ["bases が配列でない", { bases: {} }],
        ["bases 存在しないラン", { bases: [{ ...okB, runKey: "r999" }] }],
        ["bases 比較元が存在しない", { bases: [{ ...okB, baseRunKey: "r999" }] }],
        ["bases 自分自身", { bases: [{ ...okB, baseRunKey: "r202" }] }],
        ["bases 重複", { bases: [okB, { ...okB }] }],
        ["bases 日時不正", { bases: [{ ...okB, decidedAt: "2026-02-30 10:00" }] }],
        ["sameness が配列でない", { sameness: "x" }],
        ["sameness 値が不正", { sameness: [{ ...okS, value: "たぶん同一" }] }],
        ["sameness 同一なのに比較元なし", { sameness: [{ ...okS, baseRunKey: "" }] }],
        ["sameness 未確認なのに日時あり", { sameness: [{ ...okS, value: "未確認", baseRunKey: "" }] }],
        ["sameness 存在しない法規行", { sameness: [{ ...okS, rid: "g999" }] }],
        ["sameness 重複", { sameness: [okS, { ...okS }] }],
        ["sameness needsRecheck が真偽値でない", { sameness: [{ ...okS, needsRecheck: "false" }] }],
        ["sameness 付きで regs に rid なし", { regs: DUMMY.regs.map(({ rid, ...r }) => r), sameness: [] }],
      ];
      for (const [label, extra] of cases) {
        window.__ALERTS__ = [];
        selectFile(c, JSON.stringify({ ...clone(DUMMY), ...extra }));
        await sleep(80);
        asserts.checkTrue(`拒否：${label}`, window.__ALERTS__.some((m) => m.includes("読み込めません")));
      }
      asserts.check("すべて拒否してもデータ不変", await snapshotAll(c), before);
    },
  },
  {
    id: "A7-api-guard",
    name: "API版は bases / sameness 付きJSONをstate置換前に拒否し、UIにも比較元・同一性を出さない",
    expect: "拒否の案内が出て型式は置き換わらない。型式ランタブに比較元欄、帳票に同一性行が出ない",
    async run({ mountApi, asserts }) {
      const api = installApiMock({ runs: clone(DUMMY.runs), regs: DUMMY.regs.map(({ rid, ...r }) => r), cert: clone(DUMMY.cert) });
      try {
        const c = mountApi().container;
        await sleep(1300);
        for (const extra of [{ bases: [] }, { sameness: [] }]) {
          window.__ALERTS__ = [];
          selectFile(c, JSON.stringify({ ...clone(DUMMY), runs: [{ ...DUMMY.runs[0], typeId: "SHOULD-NOT-LOAD" }], ...extra }));
          await sleep(100);
          asserts.checkTrue(`拒否の案内（${Object.keys(extra)[0]}）`, window.__ALERTS__.some((m) => m.includes("読み込みを中止")));
        }
        asserts.checkTrue("state は置き換わらない", !c.textContent.includes("SHOULD-NOT-LOAD"));
        asserts.checkTrue("帳票に同一性行なし", !c.textContent.includes("同一性："));
        await openTab(c, "型式ラン");
        asserts.check("比較元欄なし", baseSelects(c).length, 0);
        const last = api.puts[api.puts.length - 1];
        asserts.check("PUT本文に bases/sameness は無い", [last?.bases, last?.sameness], [undefined, undefined]);
      } finally {
        api.restore();
      }
    },
  },
  {
    id: "A8-no-vehicle-name",
    name: "車名・車種名をデータにもUIにも持たない",
    expect: "bases/sameness のレコードは定義した項目だけ。書出し全体に車名・車種系のキーが無く、入力欄・見出しにも無い",
    async run({ mount, asserts }) {
      const c = await mountWith(mount);
      await chooseBase(c, "r202", "r201");
      await editSame(c, "r202", "g201", { value: "同一" });
      const snap = await snapshotAll(c);
      asserts.check("bases の項目", Object.keys(snap.bases[0]).sort(), ["baseRunKey", "decidedAt", "runKey"]);
      asserts.check("sameness の項目", Object.keys(snap.sameness[0]).sort(), ["baseRunKey", "decidedAt", "needsRecheck", "reason", "rid", "runKey", "value"]);
      const keys = [];
      const walk = (o) => { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); } };
      walk(snap);
      asserts.check("車名・車種系のキーなし", keys.filter((k) => /車名|車種|car|vehicle|model/i.test(k)), []);
      asserts.check("トップレベルの項目", Object.keys(snap), ["runs", "regs", "cert", "decisions", "bases", "sameness"]);
      await openTab(c, "型式ラン");
      const labels = [...c.querySelectorAll("th, label, [aria-label], input[placeholder]")]
        .map((e) => e.textContent + (e.getAttribute("aria-label") || "") + (e.getAttribute("placeholder") || ""));
      asserts.check("見出し・入力欄に車名・車種なし", labels.filter((t) => /車名|車種/.test(t)), []);
    },
  },
  {
    id: "R-editor-draft",
    name: "同一性の入力途中は表示フィルターで列が隠れても残り、セル内の編集領域は1つだけ開く",
    expect: "未保存の選択・メモが列の再表示後も残る（保存データは変わらない）。判断の編集を開くと同一性の編集は閉じ、その逆も同じ",
    async run({ mount, asserts }) {
      const c = await mountWith(mount);
      await chooseBase(c, "r202", "r201");
      const td = () => cellAt(c, ROW.g201, COL.r202);
      td().querySelector('button[title="同一性を編集"]').click();
      await sleep(10);
      td().querySelectorAll('input[type="radio"]')[SAMENESS_VALUES.indexOf("同一でない")].click();
      setNativeValue(td().querySelector("textarea"), "入力途中のメモ（ダミー）");
      await sleep(10);
      await clickByText(c, /^PJ-2$/);                  // PJ-1 の列を隠す
      asserts.check("PJ-1 の列が隠れている", c.querySelector("table thead").textContent.includes("PJ-1"), false);
      await clickByText(c, /すべて表示/);
      const ta = td().querySelector("textarea");
      asserts.check("メモが残る", ta?.value, "入力途中のメモ（ダミー）");
      asserts.check("選択が残る", td().querySelectorAll('input[type="radio"]')[SAMENESS_VALUES.indexOf("同一でない")]?.checked, true);
      asserts.check("保存データは変わらない", (await snapshotAll(c)).sameness, []);
      td().querySelector('button[title="適用判断・理由メモを編集"]').click();
      await sleep(10);
      asserts.check("判断を開くと同一性の編集は閉じる（入力欄は1つ）", td().querySelectorAll("textarea").length, 1);
      asserts.checkTrue("開いているのは判断の編集", td().textContent.includes("この判断で確定") || td().textContent.includes("メモを保存"));
      td().querySelector('button[title="同一性を編集"]').click();
      await sleep(10);
      asserts.check("同一性を開くと判断の編集は閉じる", [td().querySelectorAll("textarea").length, td().textContent.includes("比較元 DEMO-P と当該装置")], [1, true]);
    },
  },
  {
    id: "C1-deleted-base-key-not-reused",
    name: "削除した比較元のキーが、開き直した後の新しいランに再発行されない（Codex指摘1）",
    expect: "回答時の比較元 r900 が残るJSONを読むと、次に追加するランは r901 以降。範囲外の比較元キーは拒否",
    async run({ mount, asserts }) {
      const data = {
        ...clone(DUMMY),
        sameness: [{ runKey: "r202", rid: "g201", value: "同一", reason: "", decidedAt: STAMP, needsRecheck: true, baseRunKey: "r900" }],
      };
      const parsed = parseImportedData(clone(data));
      asserts.check("採番の底上げに比較元キーを含む", parsed.maxId, 900);
      const c = await mountWith(mount, data);
      await openTab(c, "型式ラン");
      await clickByText(c, /ランを追加/);
      const snap = await snapshotAll(c);
      const added = snap.runs[snap.runs.length - 1].key;
      asserts.check("新しいランは r900 ではない", added === "r900", false);
      asserts.checkTrue("新しいランは r900 より大きい番号", Number(added.slice(1)) > 900);
      const huge = { ...clone(data), sameness: [{ ...data.sameness[0], baseRunKey: "r9007199254740993" }] };
      asserts.check("範囲外の比較元キーは拒否", parseImportedData(huge).ok, false);
      asserts.check("数字でない比較元キーは採番に影響しない", parseImportedData({ ...clone(data), sameness: [{ ...data.sameness[0], baseRunKey: "run-x" }] }).maxId, 205);
    },
  },
  {
    id: "C2-recheck-visible-without-base",
    name: "比較元を外しても、要再確認の残るセルには警告が見える（Codex指摘2）",
    expect: "同一でないを確定→比較元を未選択に戻すと、セルに『要再確認』と『比較元が未選択』が出る。回答の無いセルには出ない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount);
      await chooseBase(c, "r202", "r201");
      await editSame(c, "r202", "g201", { value: "同一でない" });
      await editSame(c, "r202", "g201", { action: "答え直して確定" });
      asserts.checkTrue("確定直後は要再確認なし", !hasRecheck(c, "r202", "g201"));
      await chooseBase(c, "r202", "");
      const t = cellText(c, "r202", "g201");
      asserts.checkTrue("比較元を外すと要再確認が見える", t.includes("要再確認"));
      asserts.checkTrue("比較元が未選択と分かる", t.includes("比較元が未選択"));
      asserts.checkTrue("編集ボタンは出さない（比較元が無いので答えられない）", !cellAt(c, ROW.g201, COL.r202).querySelector('button[title="同一性を編集"]'));
      asserts.checkTrue("回答の無いセルには同一性行を出さない", !cellText(c, "r202", "g202").includes("同一性"));
      asserts.checkTrue("見出しには比較元を出さない", !headText(c, "r202").includes("比較元"));
    },
  },
  {
    id: "C3-reconfirm-after-base-change-no-recheck-cell",
    name: "LO≥継続車日のセルでも、比較元を変えた後に同じ回答をいまの比較元で確定し直せる（Codex指摘3）",
    expect: "比較元Aに同一でない→比較元Bへ変更→同じ回答で『答え直して確定』が出て、押すと比較元Bで確定・新型車日を適用",
    async run({ mount, asserts }) {
      const data = { ...clone(DUMMY), runs: [...clone(DUMMY.runs), { key: "r206", typeId: "DEMO-S", gen: "PJ-1", sk: "新", lo: "2021-02-01", drop: "2022-12-31" }] };
      const c = await mountWith(mount, data);
      await chooseBase(c, "r202", "r201");
      await editSame(c, "r202", "g202", { value: "同一でない" });
      asserts.checkTrue("このセルは要再確認を立てない", !hasRecheck(c, "r202", "g202"));
      await chooseBase(c, "r202", "r206");
      asserts.checkTrue("比較元変更後は前の回答を使わない（新継どおり）", cellText(c, "r202", "g202").includes("新継どおり"));
      const td = () => cellAt(c, ROW.g202, COL.r202);
      td().querySelector('button[title="同一性を編集"]').click();
      await sleep(10);
      asserts.checkTrue("前の比較元への回答と案内が出る", td().textContent.includes("前の比較元への回答です"));
      asserts.checkTrue("答え直して確定が出る", [...td().querySelectorAll("button")].some((b) => b.textContent.includes("答え直して確定")));
      await clickByText(td(), /キャンセル/);
      await editSame(c, "r202", "g202", { action: "答え直して確定" });
      const snap = await snapshotAll(c);
      asserts.check("いまの比較元で確定", [findSame(snap, "r202", "g202").value, findSame(snap, "r202", "g202").baseRunKey], ["同一でない", "r206"]);
      asserts.checkTrue("新型車日を適用に戻る", cellText(c, "r202", "g202").includes("新型車日を適用"));
    },
  },
  {
    id: "C4-label-follows-actual-date",
    name: "同一でないで継続車日によって要になったセルを「新型車日を適用」と表示しない（Codex再レビュー指摘）",
    expect: "LO 2020/06・drop 2024/12・新型車日 2021/03・継続車日 2023/10 で同一でない → 要（継続・2023/10）のまま、表示は『新型車の式で判定・継続車日で要 2023/10』",
    async run({ mount, asserts }) {
      const data = { ...clone(DUMMY), runs: [...clone(DUMMY.runs), { key: "r207", typeId: "DEMO-T", gen: "PJ-1", sk: "新", lo: "2020-06-01", drop: "2024-12-31" }] };
      const c = await mountWith(mount, data);
      const td = () => cellAt(c, ROW.g201, 5).textContent;
      await chooseBase(c, "r207", "r201");
      await editSame(c, "r207", "g201", { value: "同一でない" });
      asserts.checkTrue("判定は要（申請発生・継続）のまま", td().includes("申請発生") && td().includes("継続"));
      asserts.checkTrue("実際の日付の種類で表示", td().includes("新型車の式で判定・継続車日で要 2023/10"));
      asserts.checkTrue("『新型車日を適用』とは書かない", !td().includes("新型車日を適用"));
      const e = evalCellWith({}, data.runs[5], DUMMY.regs[0], "同一でない");
      asserts.check("判定式の結果", [e.required, e.kind, e.dueDate], [true, "継続", "2023-10-01"]);
    },
  },
  {
    id: "S-seed-demo",
    name: "単体版の初期表示（SEED）が検討用の各ケースを出す",
    expect: "SEEDは検証を通り、開いた直後は『変更なし』。000Bで型式追加、000Cで同一でない・期限超過、LO≥継続車日、未確認に戻した要再確認、初回回答の要再確認が見える",
    async run({ mount, asserts }) {
      const p = parseImportedData(clone(SEED));
      asserts.check("SEEDはそのまま読込検証を通る", p.ok, true);
      asserts.check("掃き出しで変わらない", sweepSameness(SEED.sameness, SEED.runs, SEED.regs, SEED.bases) === SEED.sameness, true);
      asserts.check("プロジェクトコード", [...new Set(SEED.runs.map((r) => r.gen))], ["000A", "000B", "000C", "001A"]);
      asserts.check("型式追加のあるプロジェクト（複数型式）", ["000B", "000C", "001A"].map((g) => new Set(SEED.runs.filter((r) => r.gen === g).map((r) => r.typeId)).size), [2, 2, 2]);
      const c = mount(undefined).container;
      await sleep(80);
      asserts.checkTrue("開いた直後は変更なし", c.textContent.includes("変更なし（未書き出しの変更はありません）"));
      const at = (col, row) => cellAt(c, row, col).textContent;
      // 列：r1..r7 = 0..6、行：A,A2,B,C,D,E = 0..5
      asserts.checkTrue("r3×B 同一→継続車日で否", at(2, 2).includes("継続車日を適用") && at(2, 2).includes("否"));
      asserts.checkTrue("r5×B 同一でない→期限超過", at(4, 2).includes("新型車日を適用") && at(4, 2).includes("期限超過"));
      asserts.checkTrue("r5×D LO≥継続車日：要再確認なし・実績あり", !at(4, 4).includes("要再確認") && at(4, 4).includes("DEMO*D00/00*02"));
      asserts.checkTrue("r3×C 未確認に戻した：要再確認（実績なし）", at(2, 3).includes("同一性：未確認") && at(2, 3).includes("要再確認"));
      asserts.checkTrue("r7×E 初回回答：要再確認・継続車日で要", at(6, 5).includes("要再確認") && at(6, 5).includes("新型車の式で判定・継続車日で要"));
      asserts.checkTrue("r7×C 未確認：新継どおり", at(6, 3).includes("新継どおり"));
      asserts.checkTrue("比較元の無い列に同一性は出ない", !at(3, 2).includes("同一性"));
    },
  },
  {
    id: "C5-no-recheck-when-certified",
    name: "認可書の実績があるセルには要再確認を出さない（実績が無ければ出しっぱなし）",
    expect: "実績ありのセルで同一でないへ変えても『要再確認』は出ない（記録上のフラグは残る）。実績を消すと出る。実績なしのセルは従来どおり出る",
    async run({ mount, asserts }) {
      const data = { ...clone(DUMMY), cert: { ...clone(DUMMY.cert), "DEMO-Q": { "REG-N": "CK-QN" } } };
      const c = await mountWith(mount, data);
      await chooseBase(c, "r202", "r201");
      await editSame(c, "r202", "g201", { value: "同一でない" });
      asserts.checkTrue("実績ありなら要再確認を出さない", !hasRecheck(c, "r202", "g201"));
      asserts.check("記録上のフラグは残る", findSame(await snapshotAll(c), "r202", "g201").needsRecheck, true);
      const td = () => cellAt(c, ROW.g201, COL.r202);
      td().querySelector('button[title="同一性を編集"]').click();
      await sleep(10);
      asserts.checkTrue("編集欄にも要再確認は出ない", !td().textContent.includes("要再確認"));
      await clickByText(td(), /キャンセル/);
      await openTab(c, "認可書実績");
      const inp = [...c.querySelectorAll('input[placeholder="認可書番号"]')].find((i) => i.value === "CK-QN");
      setNativeValue(inp, "");
      await sleep(20);
      await openTab(c, "帳票");
      asserts.checkTrue("実績を消すと要再確認が出る", hasRecheck(c, "r202", "g201"));
      await chooseBase(c, "r203", "r204");
      await editSame(c, "r203", "g201", { value: "同一でない" });
      asserts.checkTrue("実績なしのセル（DEMO-Q×REG-Nは実績を消した）は出しっぱなし", hasRecheck(c, "r203", "g201"));
    },
  },
  {
    id: "U-pure-functions",
    name: "候補・比較元の状態・同一性の掃き出し（純関数）",
    expect: "候補はLO順・同PJ別型式のみ。比較元のPJ変更で無効化され判定に使わない。掃き出しは変化なしなら同じ参照を返す",
    async run({ asserts }) {
      const runs = clone(DUMMY.runs);
      asserts.check("候補（プロジェクトコード空は候補なし）", baseCandidates({ ...runs[1], gen: "" }, runs), []);
      const bases = setBase([], "r202", "r201", STAMP);
      asserts.check("baseOf ok", baseOf(runs[1], runs, bases).state, "ok");
      const moved = runs.map((r) => (r.key === "r201" ? { ...r, gen: "PJ-9" } : r));
      asserts.check("比較元が別PJへ移ると無効", baseOf(moved[1], moved, bases).state, "invalid");
      const rec = { runKey: "r202", rid: "g201", value: "同一", reason: "", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r201" };
      asserts.check("有効な比較元では回答を使う", effectiveSameness(rec, baseOf(runs[1], runs, bases)), "同一");
      asserts.check("無効な比較元では同一性を使わない", effectiveSameness(rec, baseOf(moved[1], moved, bases)), null);
      const list = [rec];
      asserts.check("変化なしは同じ参照", sweepSameness(list, runs, DUMMY.regs, bases) === list, true);
      asserts.check("無効化で要再確認", sweepSameness(list, moved, DUMMY.regs, bases)[0].needsRecheck, true);
      const base = baseOf(runs[1], runs, bases);
      const r1 = nextSamenessRecord({ rec: null, run: runs[1], reg: DUMMY.regs[0], base, value: "同一でない", reason: "", now: STAMP });
      asserts.check("未確認→同一でない は要再確認", r1.needsRecheck, true);
      const r2 = nextSamenessRecord({ rec: null, run: runs[1], reg: DUMMY.regs[0], base, value: "同一", reason: "", now: STAMP });
      asserts.check("未確認→同一 は要再確認なし", [r2.needsRecheck, r2.baseRunKey, r2.decidedAt], [false, "r201", STAMP]);
    },
  },
];

function Runner() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const runAll = async () => {
    if (window.__RDVERIFY_RUNNING__) return;
    window.__RDVERIFY_RUNNING__ = true;
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
      window.__RDVERIFY_RESULT__ = {
        finished: true,
        pass: vals.filter((r) => r.pass).length,
        fail: vals.filter((r) => !r.pass).length,
        total: SCENARIOS.length,
        scenarios: SCENARIOS.map((s) => ({ id: s.id, name: s.name, pass: collected[s.id]?.pass, actual: collected[s.id]?.actual, detail: collected[s.id]?.detail })),
      };
      window.__RDVERIFY_RUNNING__ = false;
    }
  };
  useEffect(() => {
    window.__runRegsDataVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);
  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>規制再判定のデータ（F-04） 検証ハーネス</h1>
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
