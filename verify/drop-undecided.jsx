// ───────────────────────────────────────────────
// LO・dropの未入力を「否」に見せない（F-24）の検証ハーネス
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない
// （API版のケースでは window.fetch をモックする）。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/drop-undecided.html
//
// 完成条件 A1〜A5・B1〜B6（Notion「Iリスト｜バックログ」F-24）を、ケースIDの先頭で対応づける。
// A5（決定表の総当たり）は verify/decision-table.html の A5-F24-drop-cases で確かめる。
//
// 画面を通すケースは、F-13と同じく実行時の端末ローカル日付から相対日付を作る（製品の「今日」は端末日付で固定できない）。
// 今日に依存する分岐（LO過去／未来・LO当日）は、B5のとおり buildCellModel に日付を渡して固定しても確かめる。
// ───────────────────────────────────────────────
import React from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import IListApp, {
  TODAY, parseImportedData, decideCell, riskRunRows, buildCellModel, evalCellWith, dropInputStateOf,
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

// ── 実行時の端末ローカル日付から作る相対日付（製品の TODAY を基点にしない） ──
const LOCAL_TODAY = (() => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();
const shift = (days, from = LOCAL_TODAY) => {
  const [y, m, d] = from.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
};

// 画面に出る文言。検証側で独立に書き、製品の辞書を借りない。
const L_UNKNOWN = "判定不能（LO未入力）";
const L_UNDECIDED = "drop未定";
const L_MISSING = "drop未入力（LO済み）";
const L_COUNT = (runs, cells) => `${runs} ラン・${cells} 件`;
const L_OVER = (n) => `期限を過ぎて ${n} 日`;

// ── ダミーデータ（架空。実車・実法規・実認可番号とは無関係） ──
// すべて継続ラン（要否は継続車規制日とdropだけで決まる）。
//   法規
//     g801 REG-PAST … 継続車日は100日前
//     g802 REG-NEAR … 継続車日は90日後（r803 のLOの30日後＝「LO直後に継続車日が来る」例）
//     g803 REG-FAR  … 継続車日は2000日後
//   型式ラン
//     r801 TYPE-FULL   … LO・drop とも入っている（対照。REG-PASTで法規不適合・100日超過／REG-FARはdropより後なので否）
//     r802 TYPE-LOPAST … LO 200日前・drop空 → ラン単位の「drop未入力（LO済み）」＋REG-PASTで法規不適合（drop未定の印）
//     r803 TYPE-LOFUT  … LO 60日後・drop空 → 期限がLOなので超過せず、予告も無い＝一覧に出ない（祥の判断・2026-09-24）
//     r804 TYPE-CERT   … LO 30日前・drop空・REG-PASTに実績あり → 危険な法規は0件だが、ラン単位の行だけ出る
//     r805 TYPE-NOLO   … LO空・dropあり → 全法規が判定不能・一覧に出ない
//     r806 TYPE-NOBOTH … LO空・drop空   → 全法規が判定不能（drop未定の印は付けない）・一覧に出ない
//     r807 TYPE-LOTODAY… LO＝今日・drop空・REG-PASTに実績あり → LO当日は過去側＝ラン単位の行が出る（危険な法規は0件）
const D = { LONG_AGO: shift(-3650), FAR: shift(3650), PAST: shift(-100), NEAR: shift(90), FARKEI: shift(2000) };
const MAIN = {
  runs: [
    { key: "r801", typeId: "TYPE-FULL",    gen: "PJ-A", sk: "継", lo: D.LONG_AGO,  drop: shift(1000) },
    { key: "r802", typeId: "TYPE-LOPAST",  gen: "PJ-A", sk: "継", lo: shift(-200), drop: "" },
    { key: "r803", typeId: "TYPE-LOFUT",   gen: "PJ-B", sk: "継", lo: shift(60),   drop: "" },
    { key: "r804", typeId: "TYPE-CERT",    gen: "PJ-B", sk: "継", lo: shift(-30),  drop: "" },
    { key: "r805", typeId: "TYPE-NOLO",    gen: "PJ-C", sk: "継", lo: "",          drop: D.FAR },
    { key: "r806", typeId: "TYPE-NOBOTH",  gen: "PJ-C", sk: "継", lo: "",          drop: "" },
    { key: "r807", typeId: "TYPE-LOTODAY", gen: "PJ-C", sk: "継", lo: LOCAL_TODAY, drop: "" },
  ],
  regs: [
    { rid: "g801", id: "REG-PAST", label: "ダミー法規（継続車日は100日前）", shin: D.LONG_AGO, kei: D.PAST,   parent: "" },
    { rid: "g802", id: "REG-NEAR", label: "ダミー法規（継続車日は90日後）",  shin: D.LONG_AGO, kei: D.NEAR,   parent: "" },
    { rid: "g803", id: "REG-FAR",  label: "ダミー法規（継続車日は2000日後）", shin: shift(1000), kei: D.FARKEI, parent: "" },
  ],
  cert: { "TYPE-CERT": { "REG-PAST": "CK-DUMMY-804" }, "TYPE-LOTODAY": { "REG-PAST": "CK-DUMMY-807" } },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

// ── 画面ユーティリティ（risk.jsx と同じ読み方） ──
function panelEl(c) {
  const b = [...c.querySelectorAll("button")].find((x) => x.textContent.includes("危険な型式ラン"));
  if (!b) throw new Error("危険一覧のパネルが見つかりません");
  return b.parentElement.parentElement;
}
const panelToggle = (c) => [...c.querySelectorAll("button")].find((x) => x.textContent.includes("危険な型式ラン"));
const riskCountText = (c) => panelEl(c).children[0].children[1].textContent.trim();
const riskTable = (c) => panelEl(c).querySelector("table");
const matrixTable = (c) => { const p = panelEl(c); return [...c.querySelectorAll("table")].find((t) => !p.contains(t)); };
async function openPanel(c) { panelToggle(c).click(); await sleep(40); }
async function clickInPanel(c, re) {
  const b = [...panelEl(c).querySelectorAll("button")].find((x) => re.test(x.textContent));
  if (!b) throw new Error(`パネル内のボタンが見つかりません: ${re}`);
  b.click(); await sleep(40);
}
function riskGroups(c) {
  const t = riskTable(c);
  if (!t) return [];
  const out = [];
  for (const tr of t.querySelectorAll("tbody > tr")) {
    if (tr.children.length === 1) out.push({ head: tr, regs: [] });
    else if (out.length) out[out.length - 1].regs.push(tr);
  }
  return out;
}
const groupTypeIds = (c) => riskGroups(c).map((g) => g.head.textContent.match(/TYPE-[A-Z]+/)?.[0] || "");
// 帳票セル（行＝法規、列＝表示中の型式ラン）。先頭tdは法規名なので +1。
function matrixCellEl(c, regRow, runCol) {
  const td = matrixTable(c).querySelector("tbody").children[regRow]?.children[runCol + 1];
  if (!td) throw new Error(`帳票のセルがありません: ${regRow},${runCol}`);
  return td;
}
async function clickByText(container, re) {
  const b = [...container.querySelectorAll("button")].find((x) => re.test(x.textContent));
  if (!b) throw new Error(`ボタンが見つかりません: ${re}`);
  b.click(); await sleep(40);
}
async function exportJson(c) {
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
async function mountWith(mount, data) {
  const parsed = parseImportedData(clone(data));
  if (!parsed.ok) throw new Error("ダミーデータが不正です: " + parsed.error);
  const app = mount({ present: true, ok: true, data: parsed.data, maxId: parsed.maxId, maxRid: parsed.maxRid });
  await sleep(60);
  return app.container;
}
// 画面と同じ入口（buildCellModel）でモデルを作る。today を渡すと日付を固定できる（B5）。
function modelOf(data, today) {
  const parsed = parseImportedData(clone(data));
  if (!parsed.ok) throw new Error("ダミーデータが不正です: " + parsed.error);
  const { runs, regs, cert } = parsed.data;
  const evalCell = (run, r) => evalCellWith(cert, run, r, undefined, today);
  const model = today === undefined ? buildCellModel({ runs, regs, evalCell }) : buildCellModel({ runs, regs, evalCell, today });
  const cell = (rk, rid) => model.get(runs.find((r) => r.key === rk), regs.find((r) => r.rid === rid));
  return { model, runs, regs, cell };
}
const RUN_COL = Object.fromEntries(MAIN.runs.map((r, i) => [r.key, i]));
const REG_ROW = Object.fromEntries(MAIN.regs.map((r, i) => [r.rid, i]));

// ───────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "A1-drop-infinity",
    name: "A1：LOあり・drop空のランは drop＝∞ として判定し、適用される継続車規制はすべて「要」になる",
    expect: "r802・r803・r804 の全法規が「要（継続）」。新ランでも新型車日がLOより後なら継続側で「要」。LO・dropありの対照ランは従来どおり",
    async run({ asserts }) {
      const { cell } = modelOf(MAIN);
      for (const rk of ["r802", "r803", "r804", "r807"]) {
        asserts.check(`${rk} の要否・適用した規制`, ["g801", "g802", "g803"].map((g) => [cell(rk, g).decision.要否, cell(rk, g).decision.適用した規制]),
          [["要", "継続"], ["要", "継続"], ["要", "継続"]]);
      }
      // 新ラン：新型車日≤LO なら新型（dropを使わない）、新型車日＞LO なら継続車側で drop＝∞ により要
      const 新 = (shin) => decideCell({ lo: shift(-200), drop: "", shin, kei: D.FARKEI, today: LOCAL_TODAY, side: "新" }).適用した規制;
      asserts.check("新ランの適用した規制（新型車日≤LO／＞LO）", [新(D.LONG_AGO), 新(shift(1000))], ["新型", "継続"]);
      // 対照：dropが入っていれば、継続車日がdropより後の法規は否のまま
      const withDrop = decideCell({ lo: shift(-200), drop: shift(-150), kei: D.PAST, today: LOCAL_TODAY, side: "継" });
      asserts.check("対照：dropありで継続車日がdropより後なら否", withDrop.要否, "否");
      asserts.check("同じ日付でdropだけ空にすると要", decideCell({ lo: shift(-200), drop: "", kei: D.PAST, today: LOCAL_TODAY, side: "継" }).要否, "要");
      asserts.check("入力状態の分類", MAIN.runs.map((r) => dropInputStateOf(r.lo, r.drop)),
        ["入力済み", "drop未定", "drop未定", "drop未定", "LO未入力", "LO未入力", "drop未定"]);
      // 生産フェーズ：drop空は drop済みにならない
      asserts.check("drop空のランの生産フェーズ", ["r802", "r803", "r804", "r807"].map((rk) => cell(rk, "g801").decision.生産フェーズ),
        ["生産中", "開発中", "生産中", "生産中"]);
    },
  },
  {
    id: "A2-cell-mark",
    name: "A2：A1のセルに「drop未定」の要注意表示が出る",
    expect: "drop空・LOありのランの全セルに「drop未定」。LO・dropありのラン、LO空のランには出ない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, MAIN);
      const has = (rk) => MAIN.regs.map((g) => matrixCellEl(c, REG_ROW[g.rid], RUN_COL[rk]).textContent.includes(L_UNDECIDED));
      for (const rk of ["r802", "r803", "r804", "r807"]) asserts.check(`${rk} の全セルに drop未定`, has(rk), [true, true, true]);
      for (const rk of ["r801", "r805", "r806"]) asserts.check(`${rk} には drop未定 が出ない`, has(rk), [false, false, false]);
      // 印は判定の表示に足されるだけ：r802×REG-PAST は申請発生・法規不適合のまま
      const t = matrixCellEl(c, REG_ROW.g801, RUN_COL.r802).textContent;
      asserts.checkTrue("r802×REG-PAST は申請発生＋法規不適合＋drop未定", t.includes("申請発生") && t.includes("法規不適合") && t.includes(L_UNDECIDED));
      const t2 = matrixCellEl(c, REG_ROW.g802, RUN_COL.r803).textContent;
      asserts.checkTrue("r803×REG-NEAR（LO未来）は申請発生＋要対応（LOまで）＋drop未定",
        t2.includes("申請発生") && t2.includes("要対応") && t2.includes(L_UNDECIDED));
      asserts.checkTrue("凡例に drop未定 の説明がある", c.textContent.includes("drop未定＝dropが空なので生産継続"));
    },
  },
  {
    id: "A3-lo-blank",
    name: "A3：LOが空のランは全法規を「判定不能（LO未入力）」で表示し、危険一覧には出さない",
    expect: "r805・r806 の全セルが判定不能（否ではない）。決定表の出力はどの危険条件にも当たらず、一覧・コンプラ漏れにも出ない",
    async run({ mount, asserts }) {
      const { model, runs, cell } = modelOf(MAIN);
      for (const rk of ["r805", "r806"]) {
        asserts.check(`${rk} の表示`, ["g801", "g802", "g803"].map((g) => cell(rk, g).decision.表示), ["判定不能", "判定不能", "判定不能"]);
        asserts.check(`${rk} の状態（evalCellWith）`, ["g801", "g802", "g803"].map((g) => cell(rk, g).auto.status), ["unknown", "unknown", "unknown"]);
        asserts.check(`${rk} は危険なし・予告なし・申請発生の4状態なし`,
          ["g801", "g802", "g803"].map((g) => [cell(rk, g).risk, cell(rk, g).notice, cell(rk, g).compliance]), [[null, null, null], [null, null, null], [null, null, null]]);
      }
      const keys = riskRunRows(model, { runs }).map((r) => r.run.key);
      asserts.check("LO空のランは一覧に出ない", [keys.includes("r805"), keys.includes("r806")], [false, false]);
      const c = await mountWith(mount, MAIN);
      for (const rk of ["r805", "r806"]) {
        asserts.check(`${rk} の画面セル`, MAIN.regs.map((g) => matrixCellEl(c, REG_ROW[g.rid], RUN_COL[rk]).textContent.includes(L_UNKNOWN)), [true, true, true]);
      }
      // コンプラ漏れ（申請発生の一覧）にも出ない
      const leakCard = [...c.querySelectorAll("div")].find((d) => d.textContent.startsWith("コンプラ漏れ（自動検出）"));
      asserts.check("コンプラ漏れにLO空のランが出ない", [leakCard.textContent.includes("TYPE-NOLO"), leakCard.textContent.includes("TYPE-NOBOTH")], [false, false]);
      asserts.checkTrue("凡例に判定不能の説明がある", c.textContent.includes("判定不能＝LOが未入力"));
    },
  },
  {
    id: "A4-lo-past-run-row",
    name: "A4：LO過去（当日を含む）・drop空は、日付条件と関係なくラン単位の「drop未入力（LO済み）」行を出す",
    expect: "r802（法規不適合あり）・r804（危険な法規0件）・r807（LO当日）にラン単位の印。法規単位の行は drop＝∞ で日付条件に通した結果だけ（r802×REG-PAST）で、drop未定の印つき",
    async run({ mount, asserts }) {
      const { model, runs } = modelOf(MAIN);
      const rows = riskRunRows(model, { runs });
      const by = (rk) => rows.find((r) => r.run.key === rk);
      asserts.check("一覧に出るラン", rows.map((r) => r.run.key), ["r801", "r802", "r804", "r807"]);
      asserts.check("ラン単位の印", rows.map((r) => [r.run.key, r.alert]), [["r801", null], ["r802", "drop未入力"], ["r804", "drop未入力"], ["r807", "drop未入力"]]);
      asserts.check("r802 の法規行は REG-PAST の不適合だけ（REG-NEAR・REG-FAR は超過前なので出ない）",
        by("r802").cells.map((m) => [m.reg.id, m.risk.kind, m.decision.drop未定]), [["REG-PAST", "不適合", true]]);
      asserts.check("r804・r807 は危険な法規0件（実績あり・超過前）", [by("r804").cells.length, by("r807").cells.length], [0, 0]);
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      await clickInPanel(c, /すべて展開/);
      asserts.check("画面のラン行", groupTypeIds(c), ["TYPE-FULL", "TYPE-LOPAST", "TYPE-CERT", "TYPE-LOTODAY"]);
      const g = riskGroups(c);
      asserts.check("ラン行の印", g.map((x) => x.head.textContent.includes(L_MISSING)), [false, true, true, true]);
      asserts.check("危険な法規が無いラン行には内訳・日数を出さない",
        [g[2].head.textContent.includes("不適合 0 件"), g[2].head.textContent.includes("日数不明")], [false, false]);
      asserts.check("法規行の数", g.map((x) => x.regs.length), [1, 1, 0, 0]);
      const regRow = g[1].regs[0].textContent;
      asserts.checkTrue("r802 の法規行に drop未定 の印と超過日数", regRow.includes(L_UNDECIDED) && regRow.includes(L_OVER(100)));
      asserts.check("LO・dropありのランの法規行には drop未定 が付かない", g[0].regs[0].textContent.includes(L_UNDECIDED), false);
    },
  },
  {
    id: "A4-B4-lo-future",
    name: "A4・B4：LO未来・drop空は一律には出さず、drop＝∞ を既存の2条件に通した結果だけを出す",
    expect: "r803 は期限がLOで超過せず、dropの後の30日窓も無いので出ない（REG-NEAR＝LOの30日後に継続車日が来る例も含む。2026-09-24 祥の判断で条件どおり）。ラン単位の印も付かない",
    async run({ asserts }) {
      const { model, runs, cell } = modelOf(MAIN);
      asserts.check("r803 は一覧に出ない", riskRunRows(model, { runs }).some((r) => r.run.key === "r803"), false);
      asserts.check("r803 にラン単位の印は付かない", model.alertOf(runs.find((r) => r.key === "r803")), null);
      asserts.check("r803×REG-NEAR は 法規適合必要（LO後の継続車日が期限）・危険ではない",
        [cell("r803", "g802").decision.法規適合必要, cell("r803", "g802").decision.期限, cell("r803", "g802").risk], [true, "規制日", null]);
      asserts.check("r803×REG-PAST は 法規適合必要（期限＝LO）・危険ではない",
        [cell("r803", "g801").decision.法規適合必要, cell("r803", "g801").decision.期限, cell("r803", "g801").risk], [true, "LO", null]);
      // 日付条件に当たる組み合わせ（LO過去側へ時間が進んだ場合）は消えない：同じランを「LOの31日後」で見ると法規不適合で出る
      const later = modelOf(MAIN, shift(91));
      const rowLater = riskRunRows(later.model, { runs: later.runs }).find((r) => r.run.key === "r803");
      asserts.check("今日＝91日後（LO過去・REG-NEAR超過）なら REG-NEAR が不適合で出て、ラン単位の印も付く",
        [rowLater?.alert, rowLater?.cells.map((m) => [m.reg.id, m.risk.kind])], ["drop未入力", [["REG-PAST", "不適合"], ["REG-NEAR", "不適合"]]]);
    },
  },
  {
    id: "B1-full-runs-unchanged",
    name: "B1：LO・dropが両方入っているランの判定・表示・一覧は変わらない",
    expect: "r801 は F-24 の入力を足しても、単独で置いたときと判定・一覧の行が同じ。drop未定・判定不能は出ない",
    async run({ asserts }) {
      const all = modelOf(MAIN);
      const only = modelOf({ ...MAIN, runs: [MAIN.runs[0]] });
      const pick = (m) => ({ d: m.decision, a: m.auto, r: m.risk, n: m.notice, c: m.compliance });
      asserts.check("r801 の全セルの判定が同じ",
        MAIN.regs.map((g) => JSON.stringify(pick(all.cell("r801", g.rid)))), MAIN.regs.map((g) => JSON.stringify(pick(only.cell("r801", g.rid)))));
      asserts.check("r801 の一覧の行が同じ",
        JSON.stringify(riskRunRows(all.model, { runs: [all.runs[0]] }).map((r) => [r.bad, r.warn, r.urgency, r.alert])),
        JSON.stringify(riskRunRows(only.model, { runs: only.runs }).map((r) => [r.bad, r.warn, r.urgency, r.alert])));
      asserts.check("r801 に drop未定・判定不能が無い",
        MAIN.regs.map((g) => [all.cell("r801", g.rid).decision.drop未定, all.cell("r801", g.rid).decision.表示]),
        [[false, "申請発生"], [false, "申請発生"], [false, "否"]]);
      // 852件の固定表（LO・dropが両方入っている全順序）の一致は verify/decision-table.html の C2-all-852 で確かめる
    },
  },
  {
    id: "B2-no-black-no",
    name: "B2：LOかdropが空なだけで「否」（黒）を出さない",
    expect: "LOかdropが空のランのセルは、どれも表示が「否」「否・予告」にならず、画面の文言にも単独の「否」が出ない",
    async run({ mount, asserts }) {
      const { cell } = modelOf(MAIN);
      const blanks = ["r802", "r803", "r804", "r805", "r806", "r807"];
      const disp = blanks.flatMap((rk) => MAIN.regs.map((g) => cell(rk, g.rid).decision.表示));
      asserts.check("表示に否が無い", disp.filter((x) => x.startsWith("否")).length, 0);
      const c = await mountWith(mount, MAIN);
      const texts = blanks.flatMap((rk) => MAIN.regs.map((g) => matrixCellEl(c, REG_ROW[g.rid], RUN_COL[rk]).querySelector("div").children[0].textContent));
      asserts.check("セル先頭の文言が「否」のものが無い", texts.filter((t) => t === "否" || t.startsWith("否・")).length, 0);
      // 判定不能のセルは否と別の見た目（破線の枠）
      const box = getComputedStyle(matrixCellEl(c, REG_ROW.g801, RUN_COL.r805).querySelector("div"));
      const noBox = getComputedStyle(matrixCellEl(c, REG_ROW.g803, RUN_COL.r801).querySelector("div"));
      asserts.check("判定不能の枠は破線・否の枠は実線", [box.borderTopStyle, noBox.borderTopStyle], ["dashed", "solid"]);
      asserts.check("判定不能と否は枠の色が違う", box.borderTopColor !== noBox.borderTopColor, true);
    },
  },
  {
    id: "B3-no-autofill",
    name: "B3：dropを自動で補完・保存しない（生産継続は判定上の仮定だけ）",
    expect: "表示・一覧を作ったあとも run.drop は空のまま。単体版のJSON書き出し・API版のPUTでも drop は空文字",
    async run({ mount, mountApi, asserts }) {
      const { runs } = modelOf(MAIN);
      asserts.check("モデルを作っても drop は空のまま", runs.filter((r) => r.drop === "").map((r) => r.key), ["r802", "r803", "r804", "r806", "r807"]);
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      const out = await exportJson(c);
      asserts.check("単体版の書き出し：drop", out.runs.map((r) => r.drop), MAIN.runs.map((r) => r.drop));
      asserts.check("単体版の書き出し：LO", out.runs.map((r) => r.lo), MAIN.runs.map((r) => r.lo));
      // API版：旧形式（版なし）を返すと、読込直後に移行して自動保存（PUT）する。そのPUT本文の drop を見る
      const mock = installApiMock(clone(MAIN));
      try {
        mountApi();
        for (let i = 0; i < 40 && mock.puts.length === 0; i++) await sleep(100);
        asserts.checkTrue("PUTが送られた", mock.puts.length > 0);
        const last = mock.puts[mock.puts.length - 1];
        asserts.check("API版のPUT：drop", last.runs.map((r) => r.drop), MAIN.runs.map((r) => r.drop));
      } finally { mock.restore(); }
    },
  },
  {
    id: "B5-fixed-today",
    name: "B5：今日に依存する分岐（LO過去／未来・LO当日・予告期間）を、日付を固定して確かめる",
    expect: "固定日 T で LO＝T−1・T・T＋1 を比べる：T−1とT（当日）はラン単位の行あり、T＋1 は無し。drop空では dropの後30日の予告が出ない（dropありの対照では出る）",
    async run({ asserts }) {
      const T = "2031-03-15";
      const at = (lo, drop = "") => ({
        runs: [{ key: "r851", typeId: "TYPE-FIX", gen: "PJ-F", sk: "継", lo, drop }],
        regs: [{ rid: "g851", id: "REG-FIX", label: "ダミー法規（継続車日はT＋20日）", shin: "2020-01-01", kei: "2031-04-04", parent: "" }],
        cert: {},
      });
      const alertAt = (lo) => { const { model, runs } = modelOf(at(lo), T); return riskRunRows(model, { runs }).map((r) => r.alert); };
      asserts.check("LO＝T−1（過去）", alertAt("2031-03-14"), ["drop未入力"]);
      asserts.check("LO＝T（当日は過去側）", alertAt("2031-03-15"), ["drop未入力"]);
      asserts.check("LO＝T＋1（未来）", alertAt("2031-03-16"), []);
      // 予告期間：dropあり（T＋5、継続車日はその15日後）なら黄色予告、drop空（∞）では窓が無いので要・超過前
      const withDrop = modelOf(at("2031-01-01", "2031-03-20"), T).cell("r851", "g851").decision;
      const noDrop = modelOf(at("2031-01-01", ""), T).cell("r851", "g851").decision;
      asserts.check("対照：dropありは黄色予告（dropの15日後）", [withDrop.表示, withDrop.黄色予告?.days], ["否・予告", 15]);
      asserts.check("drop空は要・超過前・予告なし", [noDrop.要否, noDrop.超過, noDrop.黄色予告, noDrop.drop未定], ["要", false, null, true]);
      // 継続車日が固定日を過ぎると（T＝継続車日）、drop空のLO過去ランは法規不適合になる
      const over = modelOf(at("2031-01-01", ""), "2031-04-04");
      const r = riskRunRows(over.model, { runs: over.runs });
      asserts.check("T＝継続車日で法規不適合（期限を過ぎて0日）＋ラン単位の印",
        [r[0]?.alert, r[0]?.cells.map((m) => [m.risk.kind, m.risk.days])], ["drop未入力", [["不適合", 0]]]);
    },
  },
  {
    id: "B6-one-row-per-run",
    name: "B6：ラン単位の「drop未入力（LO済み）」行は1ランにつき1行で、法規単位の件数に混ざらない",
    expect: "法規が3つあってもラン行は1本・印は1つ。パネルの件数は「4 ラン・2 件」（件＝法規単位の危険だけ：r801×REG-PAST・r802×REG-PAST）",
    async run({ mount, asserts }) {
      const { model, runs } = modelOf(MAIN);
      const rows = riskRunRows(model, { runs });
      asserts.check("ランごとに1行", rows.length, new Set(rows.map((r) => r.run)).size);
      asserts.check("法規単位の件数", rows.reduce((n, r) => n + r.cells.length, 0), 2);
      asserts.check("ラン単位の印は cells に入らない", rows.flatMap((r) => r.cells).every((m) => !!m.risk), true);
      const c = await mountWith(mount, MAIN);
      asserts.check("パネルの件数（閉じた状態）", riskCountText(c), L_COUNT(4, 2));
      await openPanel(c);
      await clickInPanel(c, /すべて展開/);
      const g = riskGroups(c);
      asserts.check("印はラン行に1つずつ", g.map((x) => (x.head.textContent.match(/drop未入力（LO済み）/g) || []).length), [0, 1, 1, 1]);
      asserts.check("印は法規行に出ない", g.flatMap((x) => x.regs).some((tr) => tr.textContent.includes(L_MISSING)), false);
    },
  },
];

function Runner() {
  const [results, setResults] = React.useState({});
  const [running, setRunning] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const runAll = async () => {
    setRunning(true); setDone(false); setResults({});
    window.__DROPVERIFY_RUNNING__ = true;
    const collected = {};
    try {
      for (const s of SCENARIOS) {
        setResults((p) => ({ ...p, [s.id]: { state: "running" } }));
        const asserts = createAsserts();
        const mgr = createMountManager();
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
      window.__DROPVERIFY_RESULT__ = {
        finished: true,
        today: TODAY,
        pass: vals.filter((r) => r.pass).length,
        fail: vals.filter((r) => !r.pass).length,
        total: SCENARIOS.length,
        residualNodes: document.getElementById("sandbox").childElementCount,
        scenarios: SCENARIOS.map((s) => ({ id: s.id, name: s.name, pass: collected[s.id]?.pass, actual: collected[s.id]?.actual, detail: collected[s.id]?.detail })),
      };
      window.__DROPVERIFY_RUNNING__ = false;
    }
  };
  React.useEffect(() => {
    window.__runDropVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);
  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>LO・dropの未入力（F-24） 検証ハーネス</h1>
      <p style={{ color: "#5a6b7d", fontSize: 12.5, lineHeight: 1.7, marginTop: 0 }}>
        実際の <code>StandaloneApp</code> / <code>IListApp</code> をマウントして実測します。
        期待値は実行時の端末ローカル日付（<code>{LOCAL_TODAY}</code>）から作ります。<br />
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
