// ───────────────────────────────────────────────
// 危険一覧の3区分と drop済み除外（F-26）の検証ハーネス
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない
// （API版のケースでは window.fetch をモックする）。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/categories.html
//
// 完成条件 A1〜A5・B1〜B3（docs/current-task.md の F-26）を、ケースIDの先頭で対応づける。
// 必須検証の境界（継続車規制日 − drop ＝ 0／1／30／31、drop未定、LO＝今日、drop済み、認可番号待ち、
// ○の付け外し前後の件数）はすべてここで確かめる。A5（初期ダミー）は verify/seed-demo.html の A2-risk-panel。
// 決定表の既存ケースは verify/decision-table.html（期待値は変えていない）。
//
// 期待値に固定日付を書かない。実行時の端末ローカル日付から相対日付を作る。
// ───────────────────────────────────────────────
import React from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import IListApp, {
  TODAY, parseImportedData, riskRunRows, buildCellModel, evalCellWith, makeSamenessContext, RISK_KINDS,
} from "../src/IListApp.jsx";
import { makeCertStatusContext } from "../standalone/cert-status.js";

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

// ── 実行時の端末ローカル日付から作る相対日付（製品の TODAY は基点にしない） ──
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
const K_OVER = "期限超過", K_DUE = "期限前・未取得", K_YELLOW = "黄色予告";
const L_PLANNED = "計画済み";
const L_NONE = "危険な型式ランはありません。";
const L_COUNT = (runs, cells) => `${runs} ラン・${cells} 件`;
const L_BREAK = (bad, due, warn) => `期限超過 ${bad} 件・期限前 ${due} 件・予告 ${warn} 件`;
const L_PAST = "過去に法規不適合（drop済み）";
const L_YELLOW = "否・要再確認";

const LONG_AGO = shift(-3650), FAR = shift(3650);
const run = (key, typeId, lo, drop, { sk = "継", gen = "PJ-F26" } = {}) => ({ key, typeId, gen, sk, lo, drop });
const reg = (rid, id, shin, kei) => ({ rid, id, label: "ダミー法規", shin, kei, parent: "" });
const data = (runs, regs, cert = []) => ({ schemaVersion: 2, runs, regs, cert, decisions: [], bases: [], sameness: [] });
const clone = (o) => JSON.parse(JSON.stringify(o));

// 単体版と同じ入口（F-23の前例・取得予定つき）でモデルを作る
function modelOf(d, today = TODAY) {
  const p = parseImportedData(clone(d));
  if (!p.ok) throw new Error("ダミーデータが不正です: " + p.error);
  const { runs, regs, cert, decisions, bases, sameness } = p.data;
  const sameCtx = makeSamenessContext(runs, bases, sameness);
  const ctx = makeCertStatusContext(runs, cert, decisions, sameCtx, today);
  const model = buildCellModel({ runs, regs, evalCell: ctx.evaluate, decisions, sameCtx, today });
  const cell = (rk, rid) => model.get(runs.find((r) => r.key === rk), regs.find((r) => r.rid === rid));
  return { model, runs, regs, cell, rows: riskRunRows(model, { runs }) };
}
const kindOf = (m) => m.risk?.kind ?? null;
// 一覧の「行・件数」（○の付け外しで変わってはいけないもの）
const rowSig = (rows) => rows.map((r) => [r.run.key, r.bad, r.due, r.warn, r.cells.map((m) => [m.reg.rid, m.risk])]);

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
async function expandAll(c) {
  const b = [...panelEl(c).querySelectorAll("button")].find((x) => /すべて展開/.test(x.textContent));
  if (b) { b.click(); await sleep(40); }
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
const groupTypeIds = (c) => riskGroups(c).map((g) => g.head.textContent.match(/TYPE-[A-Z0-9-]+/)?.[0] || "");
const regState = (tr) => tr.children[1].textContent.trim();
function chip(container, label) {
  const b = [...container.querySelectorAll("button")].find((x) => x.textContent.trim() === label);
  if (!b) throw new Error(`チップが見つかりません: ${label}`);
  return b;
}
async function toggleChip(c, label) { chip(c, label).click(); await sleep(40); }
async function clickByText(container, re) {
  const b = [...container.querySelectorAll("button")].find((x) => re.test(x.textContent));
  if (!b) throw new Error(`ボタンが見つかりません: ${re}`);
  b.click(); await sleep(40);
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
async function mountWith(mount, d) {
  const p = parseImportedData(clone(d));
  if (!p.ok) throw new Error("ダミーデータが不正です: " + p.error);
  const app = mount({ present: true, ok: true, data: p.data, maxId: p.maxId, maxRid: p.maxRid });
  await sleep(70);
  return app.container;
}
function installApiMock(d) {
  const real = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url) !== "/api/data") throw new Error("想定外のfetch: " + url);
    if (!opts || !opts.method || opts.method === "GET") return { ok: true, json: async () => clone(d) };
    if (opts.method === "PUT") return { ok: true, json: async () => ({ ok: true }) };
    throw new Error("想定外のmethod: " + opts.method);
  };
  return { restore() { window.fetch = real; } };
}
async function setChecked(el, value) {
  if (el.checked !== value) el.click();
  await sleep(50);
}

// ── ダミーデータ（架空。実車・実法規・実認可番号とは無関係） ──
// A1：drop済みの除外。rD は昨日ドロップ、rT は今日ドロップ（当日はまだ生産中）。
//   g11 … 継続車日は15日後。rD では dropの16日後＝決定表の黄色予告は はい。rT では dropの15日後
//   g12 … 継続車日は100日前。rD では過去に法規不適合、rT では現在法規不適合
const GATE = data(
  [run("rD", "TYPE-DROPPED", LONG_AGO, shift(-1)), run("rT", "TYPE-DROPTODAY", LONG_AGO, LOCAL_TODAY)],
  [reg("g11", "REG-K15", LONG_AGO, shift(15)), reg("g12", "REG-K-100", LONG_AGO, shift(-100))],
);
// A2・A3：LO＝今日の境界。新型車日は100日前なので、新ランは「新型車日 ≤ LO」で要・期限＝max（新型車日, LO）＝LO。
const LOEDGE = data(
  [run("rLm", "TYPE-LO-1", shift(-1), FAR, { sk: "新" }), run("rL0", "TYPE-LO0", LOCAL_TODAY, FAR, { sk: "新" }),
    run("rL1", "TYPE-LO1", shift(1), FAR, { sk: "新" })],
  [reg("g21", "REG-SHIN-100", shift(-100), FAR)],
);
// A4：継続車規制日 − drop ＝ 0／1／30／31、drop未定。継続車日は40日後（これから来る）。
const WINDOW = data(
  [run("w0", "TYPE-D0", LONG_AGO, shift(40)), run("w1", "TYPE-D1", LONG_AGO, shift(39)),
    run("w30", "TYPE-D30", LONG_AGO, shift(10)), run("w31", "TYPE-D31", LONG_AGO, shift(9)),
    run("wU", "TYPE-DU", LONG_AGO, "")],
  [reg("g31", "REG-K40", LONG_AGO, shift(40))],
);
// B1：認可番号待ち（同じ型式の前のランに番号がある＝前例あり＝決定表へ「実績あり」で渡る）と実績あり。
//   rP  … 番号あり（実績あり）
//   rN  … 同じ型式の次のラン。番号は空・前例あり＝認可番号待ち（引き継ぎ確認中）
//   rX  … 別の型式で前例なし（対照：期限前・未取得で出る）
const CERT = data(
  [run("rP", "TYPE-CK", shift(-300), FAR, { sk: "新" }), run("rN", "TYPE-CK", shift(100), FAR, { sk: "新" }),
    run("rX", "TYPE-OTHER", shift(100), FAR, { sk: "新" })],
  [reg("g41", "REG-CK", shift(-500), shift(-300))],
  [{ runKey: "rP", rid: "g41", ck: "DUMMY*CK*01", planned: false }],
);
// A3・B2：○（取得予定）。開発中のラン（LO 100日後）で、要・実績なし・未超過のセルに○を付け外しする。
//   g51 … ○を付ける法規（新型車日は過去＝要・期限＝LO）
//   g52 … ○を付けない法規（同じ条件の対照）
const PLAN = data(
  [run("rQ", "TYPE-PLAN", shift(100), FAR, { sk: "新" })],
  [reg("g51", "REG-PLAN", shift(-200), FAR), reg("g52", "REG-NOPLAN", shift(-200), FAR)],
);
// B3：両フィルター。PJ-A に TYPE-FA1（期限前）・TYPE-FA2（実績あり＝出ない）、PJ-B に TYPE-FB1（期限前）。
const FILTER = data(
  [run("f1", "TYPE-FA1", shift(50), FAR, { sk: "新", gen: "PJ-A" }), run("f2", "TYPE-FA2", shift(50), FAR, { sk: "新", gen: "PJ-A" }),
    run("f3", "TYPE-FB1", shift(70), FAR, { sk: "新", gen: "PJ-B" })],
  [reg("g61", "REG-F", shift(-200), FAR)],
  [{ runKey: "f2", rid: "g61", ck: "DUMMY*F*02", planned: false }],
);

// ───────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "A1-B1-kinds",
    name: "区分は3つ（期限超過・期限前・未取得・黄色予告）で、決定表の出力だけで決まる",
    expect: "RISK_KINDS＝不適合・期限前・予告。各セルは高々1区分。過去に法規不適合・実績あり・ただの否・判定不能は区分に入らない",
    async run({ asserts }) {
      asserts.check("区分の種別", RISK_KINDS, ["不適合", "期限前", "予告"]);
      const all = [GATE, LOEDGE, WINDOW, CERT, PLAN, FILTER].flatMap((d) => modelOf(d).model.list);
      const bad = all.filter((m) => {
        const d = m.decision;
        const want = d.生産フェーズ === "drop済み" ? null
          : d.現在法規不適合 ? "不適合" : d.法規適合必要 ? "期限前" : d.黄色予告 ? "予告" : null;
        return kindOf(m) !== want;
      }).map((m) => `${m.run.key}×${m.reg.id}`);
      asserts.check("全セルで区分＝決定表の出力（drop済みは除外）", bad, []);
      asserts.checkTrue("確かめたセル数", all.length >= 15);
      // LO未入力（判定不能）は区分に入らない
      const unknown = modelOf(data([run("rU", "TYPE-NOLO", "", FAR)], [reg("g71", "REG-U", LONG_AGO, shift(-10))]));
      asserts.check("判定不能（LO未入力）は区分に入らない", [unknown.cell("rU", "g71").decision.表示, unknown.rows.length], ["判定不能", 0]);
    },
  },
  {
    id: "A1-dropped-gate",
    name: "A1 共通ゲート：drop済みのランはどの区分にも出ず、マトリクスには残る",
    expect: "昨日ドロップした rD は、決定表の黄色予告が はい（dropの16日後）でも、過去に法規不適合でも一覧に出ない。今日ドロップの rT（生産中）は出る",
    async run({ mount, asserts }) {
      const { cell, rows } = modelOf(GATE);
      asserts.check("rD は drop済み", cell("rD", "g11").decision.生産フェーズ, "drop済み");
      asserts.check("rD×REG-K15 は決定表では黄色予告（16日）", [cell("rD", "g11").decision.表示, cell("rD", "g11").decision.黄色予告?.days], ["否・予告", 16]);
      asserts.check("rD×REG-K-100 は過去に法規不適合", cell("rD", "g12").decision.過去に法規不適合, true);
      asserts.check("rD のセルは区分に入らない", [cell("rD", "g11").risk, cell("rD", "g12").risk], [null, null]);
      asserts.check("drop当日の rT は生産中", cell("rT", "g11").decision.生産フェーズ, "生産中");
      asserts.check("rT は黄色予告（15日）と期限超過", [kindOf(cell("rT", "g11")), cell("rT", "g11").risk?.afterDrop, kindOf(cell("rT", "g12"))], ["予告", 15, "不適合"]);
      asserts.check("一覧に出るのは rT だけ", rows.map((r) => r.run.key), ["rT"]);
      const c = await mountWith(mount, GATE);
      asserts.check("パネルの件数", riskCountText(c), L_COUNT(1, 2));
      await openPanel(c);
      asserts.check("一覧のラン", groupTypeIds(c), ["TYPE-DROPTODAY"]);
      const matrix = matrixTable(c).textContent;
      asserts.checkTrue("マトリクスには rD の列が残る", matrix.includes("TYPE-DROPPED"));
      asserts.checkTrue("rD の過去に法規不適合はマトリクスに残る", matrix.includes(L_PAST));
      asserts.checkTrue("rD の否・要再確認もマトリクスに残る", matrix.includes(L_YELLOW));
    },
  },
  {
    id: "A2-A3-lo-today",
    name: "A2・A3：LO＝今日の境界（LO当日は期限到来＝期限超過、LO翌日は期限前・未取得）",
    expect: "期限＝max（新型車日, LO）＝LO。LO＝昨日は期限を過ぎて1日、LO＝今日は0日で期限超過、LO＝明日は開発中で期限まで1日",
    async run({ mount, asserts }) {
      const { cell, rows } = modelOf(LOEDGE);
      const v = (rk) => { const m = cell(rk, "g21"); return [m.decision.生産フェーズ, m.decision.期限, kindOf(m), m.risk?.days]; };
      asserts.check("LO＝昨日", v("rLm"), ["生産中", "LO", "不適合", 1]);
      asserts.check("LO＝今日", v("rL0"), ["生産中", "LO", "不適合", 0]);
      asserts.check("LO＝明日（開発中）", v("rL1"), ["開発中", "LO", "期限前", 1]);
      asserts.check("並び（切迫順）", rows.map((r) => r.run.key), ["rLm", "rL0", "rL1"]);
      const c = await mountWith(mount, LOEDGE);
      await openPanel(c); await expandAll(c);
      const g = riskGroups(c);
      asserts.check("状態欄の区分名", g.map((x) => regState(x.regs[0]).slice(0, x === g[2] ? K_DUE.length : K_OVER.length)), [K_OVER, K_OVER, K_DUE]);
      asserts.checkTrue("期限前の日数の主語", g[2].regs[0].textContent.includes("期限まで 1 日"));
      asserts.checkTrue("LO当日の期限超過は0日", g[1].regs[0].textContent.includes("期限を過ぎて 0 日"));
      asserts.checkTrue("開発中のラン行の内訳", g[2].head.textContent.includes(L_BREAK(0, 1, 0)));
    },
  },
  {
    id: "A4-window-boundary",
    name: "A4：継続車規制日 − drop ＝ 0／1／30／31 と drop未定",
    expect: "差0は要（継続車日 ≤ drop）なので期限前・未取得。差1・差30は黄色予告。差31はどれにも入らない。drop未定（∞）は要＝期限前で、黄色予告には出ない",
    async run({ mount, asserts }) {
      const { cell, rows } = modelOf(WINDOW);
      const v = (rk) => { const m = cell(rk, "g31"); return [m.decision.要否, kindOf(m), m.risk?.afterDrop ?? null]; };
      asserts.check("差0", v("w0"), ["要", "期限前", null]);
      asserts.check("差1", v("w1"), ["否", "予告", 1]);
      asserts.check("差30", v("w30"), ["否", "予告", 30]);
      asserts.check("差31", v("w31"), ["否", null, null]);
      asserts.check("drop未定", [...v("wU"), cell("wU", "g31").decision.drop未定, cell("wU", "g31").decision.黄色予告], ["要", "期限前", null, true, null]);
      asserts.check("一覧に出るラン", rows.map((r) => r.run.key).sort(), ["w0", "w1", "w30", "wU"]);
      const c = await mountWith(mount, WINDOW);
      await openPanel(c); await expandAll(c);
      const st = Object.fromEntries(riskGroups(c).map((g) => [g.head.textContent.match(/TYPE-D[0-9U]+/)[0], regState(g.regs[0])]));
      asserts.checkTrue("差0は期限前・未取得", st["TYPE-D0"].startsWith(K_DUE));
      asserts.checkTrue("差1・差30は黄色予告", st["TYPE-D1"].startsWith(K_YELLOW) && st["TYPE-D30"].startsWith(K_YELLOW));
      asserts.check("差31は一覧に無い", "TYPE-D31" in st, false);
      asserts.checkTrue("drop未定は期限前・未取得＋drop未定の印", st["TYPE-DU"].startsWith(K_DUE) && st["TYPE-DU"].includes("drop未定"));
    },
  },
  {
    id: "B1-cert-and-waiting",
    name: "B1：実績あり・実績あり（認可番号待ち）のセルは出さない",
    expect: "番号のある rP と、前例ありで決定表へ「実績あり」で渡る rN（引き継ぎ確認中）は出ない。前例の無い rX は期限前・未取得で出る",
    async run({ mount, asserts }) {
      const { cell, rows } = modelOf(CERT);
      asserts.check("rP は実績あり", [cell("rP", "g41").decision.表示, cell("rP", "g41").risk], ["実績あり", null]);
      asserts.check("rN は認可番号待ち（実績ありとして渡る）",
        [cell("rN", "g41").decision.表示, cell("rN", "g41").auto.certPlan, cell("rN", "g41").auto.ck, cell("rN", "g41").risk], ["引き継ぎ確認中", "実績あり", null, null]);
      asserts.check("一覧に出るのは rX だけ", rows.map((r) => [r.run.key, r.due]), [["rX", 1]]);
      const c = await mountWith(mount, CERT);
      asserts.check("パネルの件数", riskCountText(c), L_COUNT(1, 1));
      await openPanel(c);
      asserts.check("一覧のラン", groupTypeIds(c), ["TYPE-OTHER"]);
    },
  },
  {
    id: "A3-B2-plan-toggle",
    name: "A3・B2：○ありのセルは「計画済み」と分かり、○を付け外ししても一覧の行・件数は変わらない",
    expect: "○を付けると決定表の車両申請が「発生する（計画済み）」になり、一覧の法規行に計画済みの印が付く。行・件数・区分は付け外しの前後で同じ",
    async run({ mount, asserts }) {
      const off = modelOf(PLAN);
      const onData = clone(PLAN); onData.cert.push({ runKey: "rQ", rid: "g51", ck: "", planned: true });
      const on = modelOf(onData);
      asserts.check("○なし／ありの車両申請", [off.cell("rQ", "g51").decision.車両申請, on.cell("rQ", "g51").decision.車両申請],
        ["発生する（未計画）", "発生する（計画済み）"]);
      asserts.check("○ありでも区分は期限前・未取得", kindOf(on.cell("rQ", "g51")), "期限前");
      asserts.check("モデル：行・件数・区分は○の前後で同じ", rowSig(on.rows), rowSig(off.rows));
      const c = await mountWith(mount, PLAN);
      const box = () => c.querySelector('input[aria-label="取得予定 rQ g51"]');
      asserts.checkTrue("○のチェックボックスがある", !!box());
      await openPanel(c); await expandAll(c);
      const snap = () => ({ count: riskCountText(c), heads: riskGroups(c).map((g) => g.head.textContent),
        regs: riskGroups(c).flatMap((g) => g.regs.map((tr) => [tr.children[0].textContent, regState(tr).replace(L_PLANNED, "")])) });
      const planned = () => riskGroups(c).flatMap((g) => g.regs.map((tr) => regState(tr).includes(L_PLANNED)));
      const before = snap();
      asserts.check("○なし：件数", before.count, L_COUNT(1, 2));
      asserts.check("○なし：計画済みの印は無い", planned(), [false, false]);
      await setChecked(box(), true);
      asserts.check("○あり：行・件数は同じ", snap(), before);
      asserts.check("○あり：○を付けた法規行だけに計画済み", planned(), [true, false]);
      await setChecked(box(), false);
      asserts.check("○を外す：行・件数は同じ", snap(), before);
      asserts.check("○を外す：計画済みの印が消える", planned(), [false, false]);
    },
  },
  {
    id: "B3-filters",
    name: "B3：プロジェクト・型式の両フィルターに危険一覧が連動する（期限前・未取得を含む）",
    expect: "PJ-Aで絞るとTYPE-FA1だけ（TYPE-FA2は実績あり）。型式TYPE-FB1で絞るとそれだけ。PJ-A×TYPE-FB1は該当なし。解除で全体に戻る",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, FILTER);
      await openPanel(c);
      asserts.check("初期", [groupTypeIds(c), riskCountText(c)], [["TYPE-FA1", "TYPE-FB1"], L_COUNT(2, 2)]);
      await toggleChip(c, "PJ-A");
      asserts.check("プロジェクトで絞る", [groupTypeIds(c), riskCountText(c)], [["TYPE-FA1"], L_COUNT(1, 1)]);
      await toggleChip(c, "TYPE-FB1");
      asserts.check("プロジェクト×型式（AND）で該当なし", [riskGroups(c).length, riskCountText(c)], [0, L_NONE]);
      await toggleChip(c, "PJ-A");
      asserts.check("型式だけ", [groupTypeIds(c), riskCountText(c)], [["TYPE-FB1"], L_COUNT(1, 1)]);
      await clickByText(c, /すべて表示/);
      asserts.check("解除で全体に戻る", [groupTypeIds(c), riskCountText(c)], [["TYPE-FA1", "TYPE-FB1"], L_COUNT(2, 2)]);
    },
  },
  {
    id: "A2-api-version",
    name: "API版（サーバ保存版）でも同じ3区分とdrop済み除外になる",
    expect: "IListApp に GATE＋WINDOW を読ませると、drop済みの rD は出ず、期限超過・期限前・黄色予告が出る",
    async run({ mountApi, asserts }) {
      const both = { runs: [...GATE.runs, ...WINDOW.runs], regs: [...GATE.regs, ...WINDOW.regs], cert: {} };
      // 版なし（旧形式）で渡す：API版の読込経路
      const { model, runs } = (() => {
        const p = parseImportedData(clone(both));
        const evalCell = (r, g) => evalCellWith(p.data.cert, r, g);
        return { model: buildCellModel({ runs: p.data.runs, regs: p.data.regs, evalCell }), runs: p.data.runs };
      })();
      const want = riskRunRows(model, { runs });
      asserts.check("drop済みの rD は出ない", want.some((r) => r.run.key === "rD"), false);
      const api = installApiMock(both);
      try {
        const c = mountApi().container;
        await sleep(150);
        asserts.check("件数", riskCountText(c), L_COUNT(want.length, want.reduce((n, r) => n + r.cells.length, 0)));
        await openPanel(c); await expandAll(c);
        asserts.check("ラン行", groupTypeIds(c), want.map((r) => r.run.typeId));
        const text = riskTable(c).textContent;
        asserts.checkTrue("3区分が出ている", [K_OVER, K_DUE, K_YELLOW].every((k) => text.includes(k)));
        asserts.check("TYPE-DROPPED は出ない", text.includes("TYPE-DROPPED"), false);
      } finally { api.restore(); }
    },
  },
];

// ───────────────────────────────────────────────
function Runner() {
  const [results, setResults] = React.useState({});
  const [running, setRunning] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const runAll = async () => {
    setRunning(true); setDone(false); setResults({});
    window.__CATVERIFY_RESULT__ = { finished: false };
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
      window.__CATVERIFY_RESULT__ = {
        finished: true,
        today: TODAY,
        pass: vals.filter((r) => r.pass).length,
        fail: vals.filter((r) => !r.pass).length,
        total: SCENARIOS.length,
        residualNodes: document.getElementById("sandbox").childElementCount,
        scenarios: SCENARIOS.map((s) => ({ id: s.id, name: s.name, pass: collected[s.id]?.pass, actual: collected[s.id]?.actual, detail: collected[s.id]?.detail })),
      };
    }
  };
  React.useEffect(() => {
    window.__runCategoriesVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);
  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>危険一覧の3区分（F-26） 検証ハーネス</h1>
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
