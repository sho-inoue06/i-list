// ───────────────────────────────────────────────
// 危険な型式ランの一覧（F-10）の検証ハーネス
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない
// （API版のケースでは window.fetch をモックする）。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/risk.html
//
// 完成条件 A1〜A10（Notion「Iリスト｜バックログ」F-10）を、ケースIDの先頭で対応づける。
// A8 の「両build成功」はこのページの対象外（build コマンドで確認する）。
//
// 期待値に固定日付を書かない。F-13と同じく、実行時の端末ローカル日付から相対日付を作る。
// ───────────────────────────────────────────────
import React from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import IListApp, {
  TODAY, parseImportedData, decideCell, riskOfCell, riskRunRows, buildCellModel,
  evalCellWith, makeSamenessContext, RISK_KINDS,
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

// ── 実行時の端末ローカル日付から作る相対日付（固定日付は書かない） ──
// 基点は検証側で独立に求めた端末ローカル日付。製品側の TODAY を基点にすると、
// TODAY が壊れても期待値が一緒にずれて気づけない。ずらす計算はUTCで行う。
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
const fmt = (d) => (d ? d.replaceAll("-", "/").slice(0, 7) : "—");   // 画面表示（YYYY/MM）と同じ整形

// 画面に出る文言。検証側で独立に書き、製品の辞書を借りない（辞書が壊れても気づけるようにする）。
const L_VIOLATION = "法規不適合";
const L_PAST = "過去に法規不適合（drop済み）";
const L_YELLOW = "否・要再確認";
const L_NONE = "危険な型式ランはありません。";
const L_MARK = "同一性 未確認";
const L_COUNT = (runs, cells) => `${runs} ラン・${cells} 件`;
const L_BREAK = (bad, warn) => `不適合 ${bad} 件・予告 ${warn} 件`;
const L_OVER = (n) => `期限を過ぎて ${n} 日`;
const L_LEFT = (n, afterDrop) => `継続車規制日まで ${n} 日（dropの ${afterDrop} 日後）`;

// ── ダミーデータ（架空。実車・実法規・実認可番号とは無関係） ──
// すべて継続ランにして、要否は「継続車規制日 ≤ drop」だけで決まるようにする。
//
//   r501 TYPE-1 / PJ-A / 生産中     … REG-OVERDUE で法規不適合（期限＝規制日・100日超過）
//   r502 TYPE-2 / PJ-A / 開発中     … 期限がLOになるので超過しない＝法規適合必要（一覧に出ない）
//   r503 TYPE-3 / PJ-B / drop済み   … 過去に法規不適合（一覧に出ない）
//   r504 TYPE-4 / PJ-B / 生産中     … REG-OVERDUE に実績あり（一覧に出ない）
//   r505 TYPE-5 / PJ-C / 生産中     … 法規不適合（期限＝LO・50日超過）＋ 黄色予告（15日後）
//   r506 TYPE-6 / PJ-C / 開発中     … 開発中でも黄色予告では出る（80日後）
//   r508 TYPE-8 / PJ-C / 生産中     … 要・否の両方に実績あり（どちらの条件でも出ない）
const D = {
  LONG_AGO: shift(-3650), FAR: shift(3650),
  OVER: shift(-100), LO_MID: shift(-50), DROP_SOON: shift(5),
  SOON: shift(200), YELLOW: shift(15), YELLOW2: shift(80),
  LO_FUTURE: shift(60), DROP_FUTURE: shift(70),
};
const MAIN = {
  // 並べ替えが実際に効いていることを確かめるため、**元の並び順を切迫順と別**にしてある
  // （ラン：TYPE-6 が先頭／法規：REG-YELLOW が REG-OVERDUE より前）。
  runs: [
    { key: "r506", typeId: "TYPE-6", gen: "PJ-C", sk: "継", lo: D.LO_FUTURE, drop: D.DROP_FUTURE },
    { key: "r502", typeId: "TYPE-2", gen: "PJ-A", sk: "継", lo: D.LO_FUTURE, drop: D.FAR },
    { key: "r503", typeId: "TYPE-3", gen: "PJ-B", sk: "継", lo: D.LONG_AGO,  drop: D.OVER },
    { key: "r504", typeId: "TYPE-4", gen: "PJ-B", sk: "継", lo: D.LONG_AGO,  drop: D.FAR },
    { key: "r505", typeId: "TYPE-5", gen: "PJ-C", sk: "継", lo: D.LO_MID,    drop: D.DROP_SOON },
    { key: "r501", typeId: "TYPE-1", gen: "PJ-A", sk: "継", lo: D.LONG_AGO,  drop: D.FAR },
    { key: "r508", typeId: "TYPE-8", gen: "PJ-C", sk: "継", lo: D.LO_MID,    drop: D.DROP_SOON },
  ],
  regs: [
    { rid: "g503", id: "REG-YELLOW",  label: "ダミー法規（継続車日は15日後）",  shin: D.LONG_AGO, kei: D.YELLOW,  parent: "" },
    { rid: "g502", id: "REG-SOON",    label: "ダミー法規（継続車日は200日後）", shin: D.LONG_AGO, kei: D.SOON,    parent: "" },
    { rid: "g501", id: "REG-OVERDUE", label: "ダミー法規（継続車日は100日前）", shin: D.LONG_AGO, kei: D.OVER,    parent: "" },
    { rid: "g504", id: "REG-YELLOW2", label: "ダミー法規（継続車日は80日後）",  shin: D.LONG_AGO, kei: D.YELLOW2, parent: "" },
  ],
  cert: {
    "TYPE-4": { "REG-OVERDUE": "CK-T4-OVER" },
    "TYPE-8": { "REG-OVERDUE": "CK-T8-OVER", "REG-YELLOW": "CK-T8-YELLOW" },
  },
};

// 同一性（A9）用。比較元を選んでいるのに未回答のセルを作る。
//   r522 × g521 … 新型車日(150日前) ≤ LO(100日前) なので新型車側で判定＝法規不適合（100日超過）＋根拠未確認
//   r522 × g522 … 根拠未確認だが法規適合必要。**印があっても一覧には出さない**ことの対照
const S = { BASE_LO: shift(-200), SUB_LO: shift(-100), SHIN: shift(-150), FAR: shift(3650), LATER: shift(500), LATER2: shift(600) };
const SAME_DUMMY = {
  runs: [
    { key: "r521", typeId: "TYPE-BASE", gen: "PJ-S", sk: "新", lo: S.BASE_LO, drop: S.FAR },
    { key: "r522", typeId: "TYPE-SUB",  gen: "PJ-S", sk: "新", lo: S.SUB_LO,  drop: S.FAR },
  ],
  regs: [
    { rid: "g521", id: "REG-S1", label: "ダミー法規（新型車日は150日前）", shin: S.SHIN,  kei: shift(3000), parent: "" },
    { rid: "g522", id: "REG-S2", label: "ダミー法規（新型車日は500日後）", shin: S.LATER, kei: S.LATER2,   parent: "" },
  ],
  cert: {},
  bases: [{ runKey: "r522", baseRunKey: "r521", decidedAt: `${LOCAL_TODAY} 10:00` }],
  sameness: [],   // 回答なし＝未確認（比較元はあるので decideCell の 根拠未確認 が はい になる）
};

// A1の2条件をそのまま読んだ結果、drop直後のランが黄色予告で出る場合の確認用。
//   r531 … 昨日ドロップ／継続車規制日は15日後（窓16日・これから来る）＝黄色予告＝はい
const EDGE_DUMMY = {
  runs: [{ key: "r531", typeId: "TYPE-E", gen: "PJ-E", sk: "継", lo: D.LONG_AGO, drop: shift(-1) }],
  regs: [{ rid: "g531", id: "REG-E", label: "ダミー法規（継続車日は15日後）", shin: D.LONG_AGO, kei: D.YELLOW, parent: "" }],
  cert: {},
};

const clone = (o) => JSON.parse(JSON.stringify(o));

// ── 画面ユーティリティ ──
function panelEl(c) {
  const b = [...c.querySelectorAll("button")].find((x) => x.textContent.includes("危険な型式ラン"));
  if (!b) throw new Error("危険一覧のパネルが見つかりません");
  return b.parentElement.parentElement;
}
const panelToggle = (c) => [...c.querySelectorAll("button")].find((x) => x.textContent.includes("危険な型式ラン"));
const riskCountText = (c) => panelEl(c).children[0].children[1].textContent.trim();
const riskTable = (c) => panelEl(c).querySelector("table");
// 帳票（マトリクス）の表。危険一覧のパネルにも表があるので、パネルの外の表を選ぶ。
const matrixTable = (c) => { const p = panelEl(c); return [...c.querySelectorAll("table")].find((t) => !p.contains(t)); };
async function openPanel(c) { panelToggle(c).click(); await sleep(40); }
async function clickInPanel(c, re) {
  const b = [...panelEl(c).querySelectorAll("button")].find((x) => re.test(x.textContent));
  if (!b) throw new Error(`パネル内のボタンが見つかりません: ${re}`);
  b.click(); await sleep(40);
}
// 一覧の行を「ラン行＋その下の法規行」へ束ね直す（ラン行は colSpan の1セルだけを持つ）
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
const regCells = (tr) => [...tr.children].map((x) => x.textContent.trim());
async function toggleGroup(c, typeId) {
  const g = riskGroups(c).find((x) => x.head.textContent.includes(typeId));
  if (!g) throw new Error(`ラン行がありません: ${typeId}`);
  g.head.querySelector("button").click(); await sleep(40);
}
// 帳票セル（行＝法規、列＝表示中の型式ラン）。先頭tdは法規名なので +1。
function matrixCell(c, regRow, runCol) {
  const tr = matrixTable(c).querySelector("tbody").children[regRow];
  const td = tr?.children[runCol + 1];
  if (!td) throw new Error(`帳票のセルがありません: ${regRow},${runCol}`);
  return td.textContent;
}
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

function installApiMock(data) {
  const real = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url) !== "/api/data") throw new Error("想定外のfetch: " + url);
    if (!opts || !opts.method || opts.method === "GET") return { ok: true, json: async () => clone(data) };
    if (opts.method === "PUT") return { ok: true, json: async () => ({ ok: true }) };
    throw new Error("想定外のmethod: " + opts.method);
  };
  return { restore() { window.fetch = real; } };
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

// 検証側でモデルを組み立てる（画面を通さずに riskRunRows の出力を見るため）。
// 製品の画面と同じ入口（buildCellModel）を使うが、同一性つきかどうかは呼び分ける。
function modelOf(data, withSameness = false) {
  const parsed = parseImportedData(clone(data));
  if (!parsed.ok) throw new Error("ダミーデータが不正です: " + parsed.error);
  const { runs, regs, cert, bases, sameness } = parsed.data;
  const sameCtx = withSameness ? makeSamenessContext(runs, bases, sameness) : null;
  const evalCell = (run, r) => evalCellWith(cert, run, r, sameCtx ? sameCtx.effective(run, r) : undefined);
  return { model: buildCellModel({ runs, regs, evalCell, sameCtx }), runs, regs };
}

// ───────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "A10-source-of-truth",
    name: "A9の前提の現物確認：根拠未確認が buildCellModel の集約結果から読める",
    expect: "集約結果の各セルが decision.根拠未確認 を持ち、比較元があって未回答のセルだけ はい になる。一覧側で同一性・連鎖を再判定する必要がない",
    async run({ asserts }) {
      const { model, runs, regs } = modelOf(SAME_DUMMY, true);
      const cell = (rk, rid) => model.get(runs.find((r) => r.key === rk), regs.find((r) => r.rid === rid));
      asserts.check("集約結果が 根拠未確認 を持っている", typeof cell("r522", "g521").decision.根拠未確認, "boolean");
      asserts.check("比較元があって未回答＝はい", cell("r522", "g521").decision.根拠未確認, true);
      asserts.check("同じランの別法規も はい（同一性はラン単位の問い）", cell("r522", "g522").decision.根拠未確認, true);
      asserts.check("比較元を選んでいないラン＝いいえ", cell("r521", "g521").decision.根拠未確認, false);
      // 同一性を渡さない（API版と同じ）経路では常に いいえ
      const api = modelOf(SAME_DUMMY, false);
      asserts.check("同一性を持たない版では常に いいえ",
        api.model.list.every((m) => m.decision.根拠未確認 === false), true);
    },
  },
  {
    id: "A1-two-conditions-only",
    name: "危険は「現在法規不適合」と「黄色予告」の2つだけ",
    expect: "riskOfCell が返すのはこの2条件のときだけ。法規適合必要・過去に法規不適合・実績あり・ただの否は null",
    async run({ asserts }) {
      asserts.check("危険の種別は2つ", RISK_KINDS, ["不適合", "予告"]);
      const of = (o) => riskOfCell(decideCell({ side: "継", ...o }));
      // 現在法規不適合（要・実績なし・超過・生産中）
      asserts.check("現在法規不適合＝不適合", of({ lo: D.LONG_AGO, drop: D.FAR, kei: D.OVER })?.kind, "不適合");
      // 法規適合必要（超過前）は出さない
      asserts.check("法規適合必要は出さない", of({ lo: D.LONG_AGO, drop: D.FAR, kei: D.SOON }), null);
      // 過去に法規不適合（drop済み）は出さない
      asserts.check("過去に法規不適合は出さない", of({ lo: D.LONG_AGO, drop: D.OVER, kei: shift(-200) }), null);
      // 実績ありは出さない（要側・否側の両方）
      asserts.check("実績ありの要は出さない", of({ lo: D.LONG_AGO, drop: D.FAR, kei: D.OVER, certPlan: "実績あり" }), null);
      asserts.check("実績ありの否は出さない", of({ lo: D.LONG_AGO, drop: D.DROP_SOON, kei: D.YELLOW, certPlan: "実績あり" }), null);
      // 黄色予告
      asserts.check("黄色予告＝予告", of({ lo: D.LONG_AGO, drop: D.DROP_SOON, kei: D.YELLOW })?.kind, "予告");
      // 窓の外・過ぎた規制日は出さない（decideCell 側のゲートがそのまま効く）
      asserts.check("窓の外（31日）は出さない", of({ lo: D.LONG_AGO, drop: D.DROP_SOON, kei: shift(36) }), null);
      asserts.check("もう過ぎた継続車日は出さない", of({ lo: D.LONG_AGO, drop: shift(-10), kei: shift(-1) }), null);
      // ただの否
      asserts.check("窓に入らない否は出さない", of({ lo: D.LONG_AGO, drop: D.DROP_SOON, kei: D.SOON }), null);
    },
  },
  {
    id: "A1-dev-run",
    name: "開発中のランは不適合で出ない（黄色予告では出うる）",
    expect: "今日<LO のランは期限がLOになり超過しないので不適合に入らない。黄色予告の条件は満たしうる",
    async run({ asserts }) {
      const { model, runs } = modelOf(MAIN);
      const rows = riskRunRows(model, { runs });
      const r502 = rows.find((r) => r.run.key === "r502");
      asserts.check("開発中で規制日だけ過去のラン（TYPE-2）は一覧に出ない", r502, undefined);
      const r506 = rows.find((r) => r.run.key === "r506");
      asserts.checkTrue("開発中でも黄色予告のラン（TYPE-6）は出る", !!r506);
      asserts.check("TYPE-6の生産フェーズ", r506.phase, "開発中");
      asserts.check("TYPE-6の内訳", [r506.bad, r506.warn], [0, 1]);
      asserts.check("TYPE-6の日数", [r506.top.kind, r506.top.days, r506.top.afterDrop], ["予告", 80, 10]);
    },
  },
  {
    id: "A1-dropped-and-cert",
    name: "drop済み（過去に法規不適合）と実績ありは出ない",
    expect: "TYPE-3（drop済み・過去に法規不適合）と TYPE-4・TYPE-8（実績あり）は一覧に出ない",
    async run({ asserts }) {
      const { model, runs, regs } = modelOf(MAIN);
      const cell = (rk, rid) => model.get(runs.find((r) => r.key === rk), regs.find((r) => r.rid === rid));
      asserts.check("TYPE-3×REG-OVERDUE は過去に法規不適合", cell("r503", "g501").decision.過去に法規不適合, true);
      asserts.check("TYPE-4×REG-OVERDUE は要・実績あり", cell("r504", "g501").auto.status, "ok");
      // 否のセルは実績の有無で status が変わらない（常に "off"）。実績は黄色予告のゲートとして効く。
      asserts.check("TYPE-8×REG-YELLOW は否・認可書あり",
        [cell("r508", "g503").auto.status, !!cell("r508", "g503").auto.ck, cell("r508", "g503").decision.黄色予告], ["off", true, null]);
      asserts.check("実績が無ければ同じ日程で黄色予告が出る（対照）",
        cell("r505", "g503").decision.黄色予告 !== null, true);
      const keys = riskRunRows(model, { runs }).map((r) => r.run.key);
      asserts.check("一覧に出るラン", keys, ["r501", "r505", "r506"]);
      asserts.check("drop済みのTYPE-3は出ない", keys.includes("r503"), false);
      asserts.check("実績ありのTYPE-4は出ない", keys.includes("r504"), false);
      asserts.check("要・否の両方に実績があるTYPE-8は出ない", keys.includes("r508"), false);
    },
  },
  {
    id: "A2-grouped-rows",
    name: "行は型式ラン単位で束ね、展開で法規が並ぶ",
    expect: "ラン行＝プロジェクト/型式ラン/生産フェーズ/LO・drop/内訳/最も切迫した日数。展開すると法規行が並ぶ",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      asserts.check("ラン行は3本", groupTypeIds(c), ["TYPE-1", "TYPE-5", "TYPE-6"]);
      asserts.check("既定では法規行は畳まれている", riskGroups(c).map((g) => g.regs.length), [0, 0, 0]);
      const head = riskGroups(c)[1].head.textContent;
      asserts.checkTrue("ラン行にプロジェクト", head.includes("PJ-C"));
      asserts.checkTrue("ラン行に型式ラン", head.includes("TYPE-5"));
      asserts.checkTrue("ラン行に生産フェーズ", head.includes("生産中"));
      asserts.checkTrue("ラン行にLO・drop", head.includes(`LO ${fmt(D.LO_MID)}`) && head.includes(`drop ${fmt(D.DROP_SOON)}`));
      asserts.checkTrue("ラン行に危険件数の内訳", head.includes(L_BREAK(1, 1)));
      asserts.checkTrue("ラン行に最も切迫した日数", head.includes(L_OVER(50)));
      await toggleGroup(c, "TYPE-5");
      const regs = riskGroups(c).find((g) => g.head.textContent.includes("TYPE-5")).regs;
      asserts.check("展開でそのランの危険な法規が並ぶ", regs.length, 2);
      asserts.check("法規行の項目（法規/状態/適用した規制/規制日/期限/日数）", regCells(regs[0]),
        ["REG-OVERDUEダミー法規（継続車日は100日前）", L_VIOLATION, "継続", fmt(D.OVER), `LO ${fmt(D.LO_MID)}`, L_OVER(50)]);
      asserts.check("2本目は黄色予告の行", regCells(regs[1]),
        ["REG-YELLOWダミー法規（継続車日は15日後）", L_YELLOW, "—", fmt(D.YELLOW), "—", L_LEFT(15, 10)]);
      await toggleGroup(c, "TYPE-5");
      asserts.check("もう一度押すと畳む", riskGroups(c)[1].regs.length, 0);
      await clickInPanel(c, /すべて展開/);
      asserts.check("すべて展開", riskGroups(c).map((g) => g.regs.length), [1, 2, 1]);
    },
  },
  {
    id: "A3-days-and-order",
    name: "日数の主語を状態ごとに変え、最も切迫した日数の昇順に並べる",
    expect: "不適合＝「期限を過ぎて n 日」／予告＝「継続車規制日まで n 日（dropの n 日後）」。超過が最上段",
    async run({ mount, asserts }) {
      const { model, runs } = modelOf(MAIN);
      const rows = riskRunRows(model, { runs });
      asserts.check("元データの並びは切迫順ではない", MAIN.runs.map((r) => r.typeId).slice(0, 2), ["TYPE-6", "TYPE-2"]);
      asserts.check("切迫度（超過は負・これからは正）", rows.map((r) => r.urgency), [-100, -50, 80]);
      asserts.check("並び順は昇順（元の並びを切迫順へ並べ替える）", rows.map((r) => r.run.typeId), ["TYPE-1", "TYPE-5", "TYPE-6"]);
      asserts.check("元データの法規の並びも切迫順ではない", MAIN.regs.map((r) => r.id).slice(0, 3), ["REG-YELLOW", "REG-SOON", "REG-OVERDUE"]);
      asserts.check("ランの中も切迫順（不適合が先）",
        rows[1].cells.map((m) => [m.reg.id, m.risk.urgency]), [["REG-OVERDUE", -50], ["REG-YELLOW", 15]]);
      // 期限 = max(規制日, LO)。LOのほうが後なら日数もLO基準になる（F-19 C6の結果をそのまま使う）
      asserts.check("TYPE-1は規制日が期限（100日超過）", [rows[0].cells[0].decision.期限, rows[0].top.days], ["規制日", 100]);
      asserts.check("TYPE-5はLOが期限（50日超過）", [rows[1].cells[0].decision.期限, rows[1].top.days], ["LO", 50]);
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      await clickInPanel(c, /すべて展開/);
      const text = riskTable(c).textContent;
      asserts.checkTrue("不適合の主語", text.includes(L_OVER(100)) && text.includes(L_OVER(50)));
      asserts.checkTrue("予告の主語", text.includes(L_LEFT(15, 10)) && text.includes(L_LEFT(80, 10)));
      asserts.check("「規制日まで n 日超過」のような混ざった言い方をしない", /日超過/.test(text), false);
      asserts.check("画面の並びも切迫順", groupTypeIds(c), ["TYPE-1", "TYPE-5", "TYPE-6"]);
    },
  },
  {
    id: "A4-filter-linked",
    name: "F-02のプロジェクト・車両型式の両フィルターに連動する",
    expect: "プロジェクトで絞る／車両型式で絞る／両方（AND）で絞る／解除で全件に戻る。件数表示も追随する",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      asserts.check("初期（絞り込みなし）", [groupTypeIds(c), riskCountText(c)], [["TYPE-1", "TYPE-5", "TYPE-6"], L_COUNT(3, 4)]);
      await toggleChip(c, "PJ-C");
      asserts.check("プロジェクトで絞る", [groupTypeIds(c), riskCountText(c)], [["TYPE-5", "TYPE-6"], L_COUNT(2, 3)]);
      await toggleChip(c, "TYPE-6");
      asserts.check("プロジェクト×車両型式（AND）", [groupTypeIds(c), riskCountText(c)], [["TYPE-6"], L_COUNT(1, 1)]);
      await toggleChip(c, "PJ-C");
      asserts.check("車両型式だけ", [groupTypeIds(c), riskCountText(c)], [["TYPE-6"], L_COUNT(1, 1)]);
      await toggleChip(c, "TYPE-4");
      asserts.check("欄内は OR（危険が無い型式を足しても増えない）", [groupTypeIds(c), riskCountText(c)], [["TYPE-6"], L_COUNT(1, 1)]);
      await toggleChip(c, "TYPE-1");
      asserts.check("欄内は OR（危険がある型式を足すと増える）", groupTypeIds(c), ["TYPE-1", "TYPE-6"]);
      await toggleChip(c, "PJ-B");
      asserts.check("危険が1件も無い組み合わせ", [riskGroups(c).length, riskCountText(c)], [0, L_NONE]);
      asserts.checkTrue("該当なしの文言が出る", panelEl(c).textContent.includes(L_NONE));
      await clickByText(c, /すべて表示/);
      asserts.check("解除で全体の見回しに戻る", [groupTypeIds(c), riskCountText(c)], [["TYPE-1", "TYPE-5", "TYPE-6"], L_COUNT(3, 4)]);
    },
  },
  {
    id: "A5A7-same-as-matrix",
    name: "一覧側で判定せず、マトリクスの状態と一覧の状態が一致する",
    expect: "一覧の状態・規制日・期限は帳票セルと同じ判定結果。危険でないセルは帳票にだけ残る",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, MAIN);
      // 帳票（列＝runs順 r501..r508、行＝regs順 g501..g504）
      // 列＝MAIN.runs の順、行＝MAIN.regs の順（帳票は元の並びのまま。並べ替えるのは一覧だけ）
      const COL = { r501: 5, r503: 2, r505: 4, r506: 0 }, ROW = { g503: 0, g501: 2, g504: 3 };
      asserts.checkTrue("帳票 TYPE-1×REG-OVERDUE は法規不適合", matrixCell(c, ROW.g501, COL.r501).includes(L_VIOLATION));
      asserts.checkTrue("帳票 TYPE-5×REG-YELLOW は否・要再確認", matrixCell(c, ROW.g503, COL.r505).includes(L_YELLOW));
      asserts.checkTrue("帳票 TYPE-6×REG-YELLOW2 は否・要再確認", matrixCell(c, ROW.g504, COL.r506).includes(L_YELLOW));
      await openPanel(c);
      await clickInPanel(c, /すべて展開/);
      const state = (typeId, regId) => {
        const g = riskGroups(c).find((x) => x.head.textContent.includes(typeId));
        const tr = g.regs.find((x) => x.children[0].textContent.includes(regId));
        return regCells(tr)[1];
      };
      asserts.check("一覧の状態も同じ（TYPE-1×REG-OVERDUE）", state("TYPE-1", "REG-OVERDUE"), L_VIOLATION);
      asserts.check("一覧の状態も同じ（TYPE-5×REG-YELLOW）", state("TYPE-5", "REG-YELLOW"), L_YELLOW);
      asserts.check("一覧の状態も同じ（TYPE-6×REG-YELLOW2）", state("TYPE-6", "REG-YELLOW2"), L_YELLOW);
      // 危険でないセルは帳票に残り、一覧には出ない
      asserts.checkTrue("帳票 TYPE-3×REG-OVERDUE は過去に法規不適合のまま残る", matrixCell(c, ROW.g501, COL.r503).includes(L_PAST));
      asserts.check("一覧には TYPE-3 が無い", groupTypeIds(c).includes("TYPE-3"), false);
      asserts.check("一覧に過去に法規不適合の文言が無い", panelEl(c).textContent.includes(L_PAST), false);
    },
  },
  {
    id: "A6-panel-default-closed",
    name: "マトリクス上部の開閉パネル。既定は閉じた状態で該当件数だけ見える",
    expect: "初期表示では一覧の表が無く、件数だけが見える。押すと開き、もう一度押すと閉じる",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, MAIN);
      asserts.check("既定は閉じている（表が無い）", riskTable(c), null);
      asserts.check("件数だけ見える", riskCountText(c), L_COUNT(3, 4));
      // 帳票（マトリクス）より上にある
      const p = panelEl(c), m = matrixTable(c);
      asserts.check("パネルは帳票より前にある",
        (p.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, true);
      await openPanel(c);
      asserts.checkTrue("押すと開く", !!riskTable(c));
      await openPanel(c);
      asserts.check("もう一度押すと閉じる", riskTable(c), null);
    },
  },
  {
    id: "A9-sameness-mark",
    name: "同一性が未確認のセルに印を付ける（印だけを理由に一覧へ出さない）",
    expect: "一覧に出たラン行・法規行に「同一性 未確認」の印が付く。印があっても法規適合必要のセルは出ない",
    async run({ mount, asserts }) {
      const { model, runs } = modelOf(SAME_DUMMY, true);
      const rows = riskRunRows(model, { runs });
      asserts.check("一覧に出るのは法規不適合のランだけ", rows.map((r) => r.run.key), ["r522"]);
      asserts.check("そのランの危険な法規は1本だけ（REG-S2は法規適合必要）", rows[0].cells.map((m) => m.reg.id), ["REG-S1"]);
      asserts.check("ラン行に印が立つ", rows[0].unconfirmed, true);
      const c = await mountWith(mount, SAME_DUMMY);
      await openPanel(c);
      asserts.check("ラン行に印", riskGroups(c)[0].head.textContent.includes(L_MARK), true);
      await clickInPanel(c, /すべて展開/);
      const regs = riskGroups(c)[0].regs;
      asserts.check("法規行は1本", regs.length, 1);
      asserts.checkTrue("法規行にも印", regCells(regs[0])[1].includes(L_MARK));
      asserts.checkTrue("状態は法規不適合のまま（印で判定は変わらない）", regCells(regs[0])[1].includes(L_VIOLATION));
      asserts.check("印だけの REG-S2 は一覧に出ない", riskTable(c).textContent.includes("REG-S2"), false);
      // 比較元を持たないダミーでは印が出ない
      const c2 = await mountWith(mount, MAIN);
      await openPanel(c2);
      await clickInPanel(c2, /すべて展開/);
      asserts.check("比較元が無ければ印は出ない", riskTable(c2).textContent.includes(L_MARK), false);
    },
  },
  {
    id: "A1-edge-dropped-yellow",
    name: "A1の2条件をそのまま読む：昨日ドロップしたランでも、これから来る継続車規制日が窓内なら予告で出る",
    expect: "drop < 今日 でも「否・実績なし・0<継続車日−drop≤30・継続車日>今日」を満たすので黄色予告として出る（別ゲートを足さない）",
    async run({ asserts }) {
      const { model, runs, regs } = modelOf(EDGE_DUMMY);
      const m = model.get(runs[0], regs[0]);
      asserts.check("生産フェーズはdrop済み", m.decision.生産フェーズ, "drop済み");
      asserts.check("帳票セルも黄色予告", m.decision.表示, "否・予告");
      const rows = riskRunRows(model, { runs });
      asserts.check("一覧に出る", rows.map((r) => [r.run.typeId, r.top.kind, r.top.days, r.top.afterDrop]), [["TYPE-E", "予告", 15, 16]]);
    },
  },
  {
    id: "A8-api-version",
    name: "API版（サーバ保存版）でも同じパネルが出て、同一性の印は出ない",
    expect: "IListApp でもマトリクス上部にパネルが出る。表示フィルターが無いので全ランが対象。根拠未確認は常にいいえ",
    async run({ mountApi, asserts }) {
      const api = installApiMock({ runs: MAIN.runs, regs: MAIN.regs, cert: MAIN.cert });
      try {
        const c = mountApi().container;
        await sleep(120);
        asserts.check("既定は閉じている", riskTable(c), null);
        asserts.check("件数は全ラン対象", riskCountText(c), L_COUNT(3, 4));
        await openPanel(c);
        await clickInPanel(c, /すべて展開/);
        asserts.check("ラン行", groupTypeIds(c), ["TYPE-1", "TYPE-5", "TYPE-6"]);
        asserts.check("同一性の印は出ない", riskTable(c).textContent.includes(L_MARK), false);
        asserts.check("表示フィルターは無い", c.textContent.includes("表示フィルター適用中"), false);
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
    window.__RISKVERIFY_RUNNING__ = true;
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
      window.__RISKVERIFY_RESULT__ = {
        finished: true,
        today: TODAY,
        pass: vals.filter((r) => r.pass).length,
        fail: vals.filter((r) => !r.pass).length,
        total: SCENARIOS.length,
        residualNodes: document.getElementById("sandbox").childElementCount,
        scenarios: SCENARIOS.map((s) => ({ id: s.id, name: s.name, pass: collected[s.id]?.pass, actual: collected[s.id]?.actual, detail: collected[s.id]?.detail })),
      };
      window.__RISKVERIFY_RUNNING__ = false;
    }
  };
  React.useEffect(() => {
    window.__runRiskVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);
  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>危険な型式ランの一覧（F-10） 検証ハーネス</h1>
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
