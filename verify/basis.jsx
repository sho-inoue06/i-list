// ───────────────────────────────────────────────
// 比較元を官報準拠にする（F-12）の検証ハーネス
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/basis.html
//
// 完成条件 B1〜B9（Notion「Iリスト｜バックログ」F-12）を、ケースIDの先頭で対応づける。
//
// このページは固定日付を使う。対象判定（継続車扱いで要否が変わるか）も根の判定（LO ≤ 新型車適用日）も
// 保存された日付どうしの比較だけで決まり、端末の「今日」を読まないため（F-13〜F-15のハーネスとはここが違う）。
// 今日に依存する表示（F-14の状態名・F-15の黄色）はここでは判定対象にしない。
// 期待値の文言・色は検証側で独立に書き、製品の定数を借りない。
// ───────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import {
  SEED, parseImportedData, evalCellWith, makeSamenessContext, makeBasisContext,
  basisOf, usesGrace, graceChangesNeed, isBasisRoot, chainPrevRun, BASIS_STATES,
  replaceBootData, readBootData,
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

const clone = (o) => JSON.parse(JSON.stringify(o));
const STAMP = "2026-09-19 10:00";

// ── ダミーデータ（架空の型式・法規。実車・実法規・実認可番号とは無関係） ──
//
// F-12の対象は「継続車扱いにすることで要否が変わるセル」＝新型車日なら要・継続車日なら否のセル。
// そのため、法規の継続車適用日はどのランのdropよりも後（2030-01-01）に置き、
// 新型車適用日の位置だけを法規ごとに変えてある。dropより前の継続車適用日を持つ法規（REG-V）は、
// どちらの日でも「要」になる対象外の例として置く（B2・B9）。
//
// 型式TP-1 … PJ-A(2016) → PJ-B(2021) → PJ-C(2023) の3世代。型式記号が同じなので(a)の辺で自動接続される。
// 型式TP-2 … PJ-B(2021/06)で登場し、比較元はTP-1のPJ-B（人が確定＝(b)の辺）。PJ-C(2023)へ続く。
//            TP-2のPJ-Cは(a)の前段と(b)の比較元の両方を持つ（(a)優先の確認用）。
// 型式TP-3 … 前のランも比較元も無い（前段なし）。
// 型式TP-4 … LOが空。新型車日でも「要」にならないため、対象判定の段階で対象外になる（B8）。
// 型式TP-5・TP-6 … 同じPJ-Eで互いを比較元にし、両方「同一」＝連鎖が循環する。
// 型式TP-7・TP-8 … 同じPJ-F。TP-7は同一性が「同一・要再確認あり」で、要再確認と根拠未確認が同じセルに出る
//                  （比較元TP-8は根になれる位置にないので、連鎖はそこで前段なしになる）。
// 型式TP-9・TP-10 … 同じPJ-G。比較元（TP-10）のLOが空＝連鎖の途中でLOが読めない。
// 型式TP-11・TP-12 … 同じPJ-H。TP-11は同じLOの前のランが2つあり(a)が一意に決まらない。
//                    比較元（TP-12・同一）は根になれる位置にあるが、(b)へフォールバックしない確認に使う。
//
// 法規（新型車適用日の位置を変えてある。継続車適用日は REG-V 以外すべて 2030-01-01）
//   REG-P 2020-01-01 … 基準にする法規。TP-1のPJ-A(2016)が根になる
//   REG-Q 2010-01-01 … 新型車適用日が古く、どのランも根にならない（根に到達できない）
//   REG-R （空）      … 新型車適用日が無い。新型車扱いでも要にならないので対象外
//   REG-S 2020-13-01 … 実在しない日付＝新型車適用日が読めない
//   REG-T 2021-01-01 … TP-1のPJ-BのLOとちょうど同じ日（境界：以前に含める）
//   REG-U 2020-12-31 … その前日（境界の隣。TP-1のPJ-Bは根にならない）
//   REG-V 2016-01-01／継続車日 2018-01-01 … 継続車日がdropより前。どちらの日でも「要」＝対象外（B9の回帰例と同じ形）
//   REG-W 2035-01-01 … 新型車適用日がまだ来ていない。どちらの日でも「否」＝対象外
const FAR_KEI = "2030-01-01";
const REGS = [
  { rid: "g901", id: "REG-P", label: "ダミー法規P", shin: "2020-01-01", kei: FAR_KEI, parent: "" },
  { rid: "g902", id: "REG-Q", label: "ダミー法規Q（新型車適用日が古い）", shin: "2010-01-01", kei: FAR_KEI, parent: "" },
  { rid: "g903", id: "REG-R", label: "ダミー法規R（新型車適用日なし）", shin: "", kei: FAR_KEI, parent: "" },
  { rid: "g904", id: "REG-S", label: "ダミー法規S（新型車適用日が読めない）", shin: "2020-13-01", kei: FAR_KEI, parent: "" },
  { rid: "g905", id: "REG-T", label: "ダミー法規T（境界ちょうど）", shin: "2021-01-01", kei: FAR_KEI, parent: "" },
  { rid: "g906", id: "REG-U", label: "ダミー法規U（境界の前日）", shin: "2020-12-31", kei: FAR_KEI, parent: "" },
  { rid: "g907", id: "REG-V", label: "ダミー法規V（継続車日がdropより前）", shin: "2016-01-01", kei: "2018-01-01", parent: "" },
  { rid: "g908", id: "REG-W", label: "ダミー法規W（新型車適用日がまだ）", shin: "2035-01-01", kei: "2036-01-01", parent: "" },
];
const RUNS = [
  { key: "r901", typeId: "TP-1",  gen: "PJ-A", sk: "新", lo: "2016-01-01", drop: "2018-12-31" },
  { key: "r902", typeId: "TP-1",  gen: "PJ-B", sk: "継", lo: "2021-01-01", drop: "2024-12-31" },
  { key: "r903", typeId: "TP-1",  gen: "PJ-C", sk: "継", lo: "2023-01-01", drop: "2026-12-31" },
  { key: "r904", typeId: "TP-2",  gen: "PJ-B", sk: "新", lo: "2021-06-01", drop: "2024-12-31" },
  { key: "r905", typeId: "TP-2",  gen: "PJ-C", sk: "継", lo: "2023-01-01", drop: "2026-12-31" },
  { key: "r906", typeId: "TP-3",  gen: "PJ-C", sk: "継", lo: "2023-02-01", drop: "2026-12-31" },
  { key: "r907", typeId: "TP-4",  gen: "PJ-D", sk: "継", lo: "",           drop: "2026-12-31" },
  { key: "r908", typeId: "TP-5",  gen: "PJ-E", sk: "継", lo: "2023-03-01", drop: "2026-12-31" },
  { key: "r909", typeId: "TP-6",  gen: "PJ-E", sk: "継", lo: "2023-04-01", drop: "2026-12-31" },
  { key: "r910", typeId: "TP-7",  gen: "PJ-F", sk: "継", lo: "2023-05-01", drop: "2026-12-31" },
  { key: "r911", typeId: "TP-8",  gen: "PJ-F", sk: "新", lo: "2023-05-01", drop: "2026-12-31" },
  { key: "r912", typeId: "TP-9",  gen: "PJ-G", sk: "継", lo: "2023-06-01", drop: "2026-12-31" },
  { key: "r913", typeId: "TP-10", gen: "PJ-G", sk: "新", lo: "",           drop: "2026-12-31" },
  { key: "r914", typeId: "TP-11", gen: "PJ-H", sk: "継", lo: "2024-01-01", drop: "2026-12-31" },
  { key: "r915", typeId: "TP-11", gen: "PJ-X", sk: "継", lo: "2022-01-01", drop: "2026-12-31" },
  { key: "r916", typeId: "TP-11", gen: "PJ-Y", sk: "継", lo: "2022-01-01", drop: "2026-12-31" },
  { key: "r917", typeId: "TP-12", gen: "PJ-H", sk: "新", lo: "2019-01-01", drop: "2026-12-31" },
];
const BASES = [
  { runKey: "r904", baseRunKey: "r902", decidedAt: STAMP },
  { runKey: "r905", baseRunKey: "r903", decidedAt: STAMP },
  { runKey: "r908", baseRunKey: "r909", decidedAt: STAMP },
  { runKey: "r909", baseRunKey: "r908", decidedAt: STAMP },
  { runKey: "r910", baseRunKey: "r911", decidedAt: STAMP },
  { runKey: "r912", baseRunKey: "r913", decidedAt: STAMP },
  { runKey: "r914", baseRunKey: "r917", decidedAt: STAMP },
];
const SAMENESS = [
  { runKey: "r904", rid: "g901", value: "同一",       reason: "ダミー：装置は同じ", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r902" },
  { runKey: "r904", rid: "g906", value: "同一でない", reason: "ダミー：装置を変更", decidedAt: STAMP, needsRecheck: true,  baseRunKey: "r902" },
  { runKey: "r905", rid: "g901", value: "同一",       reason: "ダミー：(a)と(b)の両方がある節", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r903" },
  // REG-T・REG-U でも「同一」と答えておく。F-19 C3 で、比較元があって同一性が未確認のセルは
  // 新型車側で判定される（＝猶予を使っていない＝F-12の対象外）ようになったため、
  // 「連鎖の途中で止まる」ことを見るには、セル自身は猶予を使っている（＝同一と答えた）必要がある。
  { runKey: "r905", rid: "g905", value: "同一",       reason: "ダミー：連鎖の途中（TP-2 PJ-B）が未確認で止まる例", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r903" },
  { runKey: "r905", rid: "g906", value: "同一",       reason: "ダミー：連鎖の途中（TP-2 PJ-B）が同一でないで止まる例", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r903" },
  { runKey: "r908", rid: "g901", value: "同一",       reason: "ダミー：循環その1", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r909" },
  { runKey: "r909", rid: "g901", value: "同一",       reason: "ダミー：循環その2", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r908" },
  // 要再確認と根拠未確認が同じセルに並ぶ例。F-19 C3 以降、未確認のセルは新型車側で判定されて
  // F-12の対象外になるので、「同一」と答えたうえで要再確認が立っている状態にしてある
  // （読み込んだデータとしては起こりうる形。比較元が変わったあと同一で答え直す前など）。
  { runKey: "r910", rid: "g901", value: "同一",       reason: "ダミー：同一と答えたが要再確認が立っている", decidedAt: STAMP, needsRecheck: true,  baseRunKey: "r911" },
  { runKey: "r912", rid: "g901", value: "同一",       reason: "ダミー：比較元のLOが空", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r913" },
  { runKey: "r914", rid: "g901", value: "同一",       reason: "ダミー：(a)が曖昧でも(b)へ逃げない", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r917" },
];
const DUMMY = { runs: RUNS, regs: REGS, cert: {}, decisions: [], bases: BASES, sameness: SAMENESS };
const SEED_DATA = { ...clone(SEED), decisions: [] };

const runOf = (key) => RUNS.find((r) => r.key === key);
const regOf = (rid) => REGS.find((r) => r.rid === rid);
// 製品と同じ文脈（比較元・同一性つき）で根拠を求めるヘルパ
const ctxOf = (data = DUMMY) => makeSamenessContext(data.runs, data.bases, data.sameness);
const basisIn = (data, runKey, rid) =>
  basisOf(data.runs.find((r) => r.key === runKey), data.regs.find((r) => r.rid === rid), data.runs, ctxOf(data));
const basis = (runKey, rid) => basisIn(DUMMY, runKey, rid);
const shape = (b) => [b.state, b.hops, b.root ? b.root.key : null];

// 画面から読む位置（行＝法規の並び、列＝型式ランの並び）
function cellAt(c, data, runKey, rid) {
  const row = data.regs.findIndex((r) => r.rid === rid);
  const col = data.runs.findIndex((r) => r.key === runKey);
  const td = c.querySelector("table tbody")?.children[row]?.children[col + 1];
  if (!td) throw new Error(`帳票のセルがありません: ${runKey} × ${rid}`);
  return td;
}
const cellText = (c, data, runKey, rid) => cellAt(c, data, runKey, rid).textContent;
const spanIn = (c, data, runKey, rid, label) =>
  [...cellAt(c, data, runKey, rid).querySelectorAll("span")].find((s) => s.textContent.trim() === label) || null;

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
const openTab = (c, name) => clickByText(c, new RegExp(`^${name}`));
const setNativeValue = (el, value) => {
  const proto = el instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event(el instanceof window.HTMLSelectElement ? "change" : "input", { bubbles: true }));
};
// 法規DBタブで法規行の日付を書き換え、帳票タブへ戻る（列＝新型適用日3番目・継続適用日4番目）
async function editRegDate(c, data, rid, field, value) {
  await openTab(c, "法規DB");
  const row = c.querySelectorAll("table tbody tr")[data.regs.findIndex((r) => r.rid === rid)];
  const input = row.querySelectorAll('input[type="date"]')[field === "shin" ? 0 : 1];
  setNativeValue(input, value);
  await sleep(20);
  await openTab(c, "帳票");
}
async function clickByText(container, re) {
  const b = [...container.querySelectorAll("button")].find((x) => re.test(x.textContent));
  if (!b) throw new Error(`ボタンが見つかりません: ${re}`);
  b.click();
  await sleep(10);
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
// 全セルの根拠を1つの表にする（往復の前後で比べるため）
const basisTable = (data) => {
  const bctx = makeBasisContext(data.runs, ctxOf(data));
  const out = {};
  for (const run of data.runs) for (const reg of data.regs) {
    const b = bctx.of(run, reg);
    out[`${run.key}|${reg.rid}`] = [b.state, b.hops, b.root ? b.root.key : null, b.text];
  }
  return out;
};
// 検証側で独立に作る「要否」（製品の要否判定と突き合わせるため、式はここにも書く）
const needAs = (side, run, reg) => side === "新"
  ? !!((reg.shin && reg.shin <= run.lo) || (reg.kei && reg.kei <= run.drop))
  : !!(reg.kei && reg.kei <= run.drop);

// ───────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "B2-scope",
    name: "対象判定：継続車扱いで要否が変わるセルだけを対象にする（「継続」表示だけでは対象にしない）",
    expect: "新型車日なら要・継続車日なら否のセルだけが対象。両方要・両方否のセルは対象外",
    async run({ asserts }) {
      // 検証側で独立に作った要否と、製品の対象判定を突き合わせる
      const pairs = [
        ["r902", "g901", true],   // 新=要（2020≤2021）／継=否（2030>2024） → 対象
        ["r903", "g901", true],
        ["r902", "g907", false],  // REG-V：新=要／継も要（2018≤2024） → 対象外（B9の回帰例と同じ形）
        ["r903", "g907", false],
        ["r903", "g908", false],  // REG-W：新も否（2035>2023）／継も否 → 対象外
        ["r903", "g903", false],  // REG-R：新型車適用日が無い → どちらも否 → 対象外
        ["r907", "g901", false],  // LOが空：新型車日側が要にならない → 対象外
      ];
      asserts.check("要否が変わるか（製品）", pairs.map(([rk, rid]) => graceChangesNeed(runOf(rk), regOf(rid))), pairs.map((p) => p[2]));
      asserts.check("要否が変わるか（検証側で独立に計算）",
        pairs.map(([rk, rid]) => needAs("新", runOf(rk), regOf(rid)) !== needAs("継", runOf(rk), regOf(rid))), pairs.map((p) => p[2]));
      asserts.check("対象外セルは根拠を持たない", pairs.filter((p) => !p[2]).map(([rk, rid]) => basis(rk, rid).state),
        pairs.filter((p) => !p[2]).map(() => "対象外"));
      // 「継続」表示だけでは対象にしない：REG-V は継続ランで「要・継続」だが対象外
      asserts.check("REG-V の継続ランは要・継続だが対象外",
        [evalCellWith({}, runOf("r903"), regOf("g907"), null).kind, basis("r903", "g907").state], ["継続", "対象外"]);
      asserts.check("対象外の理由（要否が同じ）", basis("r903", "g907").reason, "新型車日でも継続車日でも要否が同じため、連鎖は要否を左右しない");
      // 新型車側で判定されているセル（同一でない）は猶予を使っていないので対象外
      asserts.check("同一でないと答えたセルは対象外", basis("r904", "g906").state, "対象外");
      asserts.check("対象外の理由（新型車日で判定）", basis("r904", "g906").reason, "新型車日で判定しているため継続車適用日の猶予を使っていない");
      asserts.check("usesGrace：継続ランで猶予を使う", usesGrace(runOf("r903"), regOf("g901"), null), true);
      asserts.check("usesGrace：同一と答えた新型ランも使う", usesGrace(runOf("r904"), regOf("g901"), "同一"), true);
      asserts.check("usesGrace：同一でないと答えたら使わない", usesGrace(runOf("r904"), regOf("g901"), "同一でない"), false);
    },
  },
  {
    id: "B1B4-root",
    name: "根の判定：LOを代用し、法規の新型車適用日と比べる（境界は「以前」に含める）",
    expect: "LO ≤ その法規の新型車適用日 なら根。同じランでも法規ごとに変わる。drop・新継・実績は見ない",
    async run({ asserts }) {
      const P = regOf("g901"), Q = regOf("g902"), T = regOf("g905"), U = regOf("g906");
      asserts.check("TP-1 PJ-A(2016) は REG-P(2020) の根", isBasisRoot(runOf("r901"), P), true);
      asserts.check("TP-1 PJ-B(2021) は REG-P(2020) の根ではない", isBasisRoot(runOf("r902"), P), false);
      // B4：同じ型式ランでも法規ごとに根かどうかが変わる
      asserts.check("同じ TP-1 PJ-A でも REG-Q(2010) の根ではない", isBasisRoot(runOf("r901"), Q), false);
      // 境界：LO と新型車適用日がちょうど同じ日（法令用語の「以前」は当日を含む）
      asserts.check("LO＝新型車適用日（REG-T）は根に含める", isBasisRoot(runOf("r902"), T), true);
      asserts.check("その前日（REG-U）は根にならない", isBasisRoot(runOf("r902"), U), false);
      asserts.check("境界のセルは自分が根になる", shape(basis("r902", "g905")), ["自分が根", 0, "r902"]);
      asserts.check("境界の前日では自分が根にならない", basis("r902", "g906").state, "根到達");
      // B1：判定に使うのはLOだけ。認可日という別の日付は持たない
      asserts.check("LOだけで決まる（1日後ろへずらすと根でなくなる）",
        [isBasisRoot({ lo: "2020-01-01" }, { shin: "2020-01-01" }), isBasisRoot({ lo: "2020-01-02" }, { shin: "2020-01-01" })],
        [true, false]);
      asserts.check("drop・新継・実績は根の判定に影響しない",
        isBasisRoot({ ...runOf("r901"), sk: "継", drop: "1900-01-01" }, P), true);
      asserts.check("LOが空なら根にしない", isBasisRoot({ lo: "" }, P), false);
      asserts.check("実在しない日付のLOは根にしない", isBasisRoot({ lo: "2019-02-30" }, P), false);
      asserts.check("実在しない新型車適用日では根にしない", isBasisRoot(runOf("r901"), regOf("g904")), false);
    },
  },
  {
    id: "B3-edges",
    name: "連鎖の辺：(a)型式記号一致の自動接続を優先し、(b)人が確定した比較元へフォールバックしない",
    expect: "(a)は人の入力なしでつながる。(b)は「同一」のときだけ辺になる。(a)がある節では(b)を見ない",
    async run({ asserts }) {
      asserts.check("TP-1 PJ-C の前段は TP-1 PJ-B", [chainPrevRun(runOf("r903"), RUNS).state, chainPrevRun(runOf("r903"), RUNS).run?.key], ["one", "r902"]);
      asserts.check("TP-1 PJ-B の前段は TP-1 PJ-A", [chainPrevRun(runOf("r902"), RUNS).state, chainPrevRun(runOf("r902"), RUNS).run?.key], ["one", "r901"]);
      asserts.check("その型式の最初のランには前段が無い", chainPrevRun(runOf("r901"), RUNS).state, "none");
      asserts.check("LOが読めないランの前段は決められない", chainPrevRun(runOf("r907"), RUNS).state, "ambiguous");
      asserts.check("同じLOの前のランが複数あれば一意に決めない", chainPrevRun(runOf("r914"), RUNS).state, "ambiguous");
      asserts.check("同じ型式にLOが読めないランがあれば一意に決めない",
        chainPrevRun({ key: "x", typeId: "TP-9", lo: "2024-01-01" },
          [{ key: "a", typeId: "TP-9", lo: "2023-01-01" }, { key: "b", typeId: "TP-9", lo: "" }]).state, "ambiguous");
      // (a)だけで根まで届く（比較元・同一性を持たない版でも同じ）
      const noCtx = basisOf(runOf("r903"), regOf("g901"), RUNS, null);
      asserts.check("比較元・同一性が無くても(a)だけで根に届く", [noCtx.state, noCtx.hops, noCtx.root?.key], ["根到達", 1, "r901"]);
      // (b)：同一のときだけ辺になる
      asserts.check("同一と答えた比較元は辺になる（TP-2 PJ-B → TP-1 PJ-B → 根）", shape(basis("r904", "g901")), ["根到達", 1, "r901"]);
      // 連鎖の途中（TP-2 PJ-B）の同一性が未確認／同一でない → そこで止まる。セル自身は「同一」で猶予を使っている。
      asserts.check("未確認の比較元は辺にしない（REG-T）", basis("r905", "g905").state, "根拠未確認");
      asserts.check("同一でないと答えた節はそこで止まる（REG-U）", basis("r905", "g906").state, "根拠未確認");
      // F-19 C3：セル自身の同一性が未確認なら新型車側で判定される＝猶予を使っていない＝対象外
      asserts.check("セル自身が未確認なら対象外（C3）",
        [basisOf(runOf("r905"), regOf("g905"), RUNS, ctxOf({ ...DUMMY, sameness: [] })).state,
         usesGrace(runOf("r905"), regOf("g905"), "未確認")], ["対象外", false]);
      // (a)優先：TP-2 PJ-C は(a)の前段（TP-2 PJ-B）と(b)の比較元（TP-1 PJ-C・同一）の両方を持つ
      asserts.check("(a)と(b)の両方がある節は(a)をたどる", basis("r905", "g901").path.map((r) => r.key), ["r905", "r904", "r902", "r901"]);
      asserts.check("(b)の比較元（TP-1 PJ-C）は通らない", basis("r905", "g901").path.some((r) => r.key === "r903"), false);
      // (a)が一意に決まらないときも(b)へフォールバックしない（TP-12・同一は根になれる位置にある）
      asserts.check("比較元TP-12は根になれる位置にいる", isBasisRoot(runOf("r917"), regOf("g901")), true);
      asserts.check("(a)が曖昧なら(b)へ逃げずに根拠未確認",
        [basis("r914", "g901").state, basis("r914", "g901").reason],
        ["根拠未確認", "TP-11（PJ-H）：同じLOの前のランが複数あり前段を決められない"]);
      // 型式記号が空のラン同士は(a)の辺にしない（空欄どうしを「同じ型式」とは確認できない）
      const blank = [
        { key: "b1", typeId: "", gen: "PJ-A", sk: "新", lo: "2016-01-01", drop: "2018-12-31" },
        { key: "b2", typeId: "", gen: "PJ-B", sk: "継", lo: "2021-01-01", drop: "2024-12-31" },
      ];
      asserts.check("型式記号が空なら前段を作らない", chainPrevRun(blank[1], blank).state, "none");
      asserts.check("空欄どうしで根に到達しない",
        [basisOf(blank[1], regOf("g901"), blank, null).state, basisOf(blank[1], regOf("g901"), blank, null).reason],
        ["根拠未確認", "（PJ-B）に前段が無い（前のランも比較元も無い）"]);
      asserts.check("対象セルであることは変わらない（安全側に倒れただけ）", graceChangesNeed(blank[1], regOf("g901")), true);
      // 人の入力は増やさない：型式ランの持ち物は従来どおり
      asserts.check("型式ランの項目は従来どおり", Object.keys(RUNS[0]), ["key", "typeId", "gen", "sk", "lo", "drop"]);
    },
  },
  {
    id: "B4B6-reach",
    name: "根に到達した／できなかったの区別と、1行の根拠文（根と中継点の数）",
    expect: "到達したセルは「どの型式ランのどの指定から変更なしで継続しているか」と中継点の数を1行で返す",
    async run({ asserts }) {
      asserts.check("TP-1 PJ-B × REG-P（中継0）", shape(basis("r902", "g901")), ["根到達", 0, "r901"]);
      asserts.check("TP-1 PJ-C × REG-P（中継1）", shape(basis("r903", "g901")), ["根到達", 1, "r901"]);
      asserts.check("TP-2 PJ-C × REG-P（中継2）", shape(basis("r905", "g901")), ["根到達", 2, "r901"]);
      asserts.check("根拠文（中継0）", basis("r902", "g901").text, "根拠：TP-1（PJ-A・LO 2016/01）の指定から変更なしで継続（中継0件）");
      asserts.check("根拠文（中継2）", basis("r905", "g901").text, "根拠：TP-1（PJ-A・LO 2016/01）の指定から変更なしで継続（中継2件）");
      asserts.check("自分が根の1行", basis("r902", "g905").text, "根拠：この型式ラン自身の指定（LO 2021/01）が新型車適用日 2021/01 以前（中継0件）");
      // 境界（REG-T）では TP-1 PJ-B 自身が根になるので、TP-1 PJ-C の中継点が1つ減る
      asserts.check("REG-T では TP-1 PJ-B が根（中継0）", shape(basis("r903", "g905")), ["根到達", 0, "r902"]);
      asserts.check("REG-U では TP-1 PJ-A が根（中継1）", shape(basis("r903", "g906")), ["根到達", 1, "r901"]);
      // 到達できなかったことが区別できる
      asserts.check("REG-Q は誰も根にならないので到達できない", basis("r902", "g902").state, "根拠未確認");
      asserts.check("到達できないセルは根を持たない", basis("r902", "g902").root, null);
    },
  },
  {
    id: "B5-unknown",
    name: "根拠未確認：途中が未確認・LOがない・前段がない（対象セルだけ）",
    expect: "いずれも根拠未確認になり、どこで止まったかが理由に出る。対象外のセルへは広げない",
    async run({ asserts }) {
      const cases = {
        "途中の同一性が未確認": basis("r905", "g905"),
        "同一でない節で止まる": basis("r905", "g906"),
        "前段が無い": basis("r906", "g901"),
        "途中のLOが読めない": basis("r912", "g901"),
        "新型車適用日が読めない": basis("r903", "g904"),
        "根に届かない（前段なし）": basis("r902", "g902"),
        "前段が一意に決まらない": basis("r914", "g901"),
      };
      asserts.check("すべて根拠未確認", Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v.state])),
        Object.fromEntries(Object.keys(cases).map((k) => [k, "根拠未確認"])));
      asserts.check("理由（途中の同一性が未確認）", cases["途中の同一性が未確認"].reason, "TP-2（PJ-B）の同一性が未確認");
      asserts.check("理由（同一でない節）", cases["同一でない節で止まる"].reason,
        "TP-2（PJ-B）が比較元と同一でない＝そこが新しい連鎖の始点になり、根まで届かない");
      asserts.check("理由（前段が無い）", cases["前段が無い"].reason, "TP-3（PJ-C）に前段が無い（前のランも比較元も無い）");
      asserts.check("理由（途中のLOが読めない）", cases["途中のLOが読めない"].reason, "連鎖の途中TP-10（PJ-G）のLOが読めない");
      asserts.check("理由（新型車適用日が読めない）", cases["新型車適用日が読めない"].reason, "法規の新型車適用日が読めない");
      asserts.check("理由（根に届かない）", cases["根に届かない（前段なし）"].reason, "TP-1（PJ-A）に前段が無い（前のランも比較元も無い）");
      asserts.check("根拠未確認の1行説明", cases["前段が無い"].text, "根拠未確認：TP-3（PJ-C）に前段が無い（前のランも比較元も無い）");
      // 状態は4種類しかない（どのセルもこのどれかになる）
      asserts.check("状態は4種", BASIS_STATES, ["対象外", "自分が根", "根到達", "根拠未確認"]);
      const allStates = Object.values(basisTable(DUMMY)).map((v) => v[0]);
      asserts.check("全セルが4状態のいずれか", allStates.every((x) => BASIS_STATES.includes(x)), true);
      // 対象外のセルへは広げない：同じ連鎖の切れ方でも、要否が変わらない法規では何も出さない
      asserts.check("同じ前段なしでもREG-V（要否が同じ）なら対象外", basis("r906", "g907").state, "対象外");
      asserts.check("同じ循環でもREG-W（要否が同じ）なら対象外", basis("r908", "g908").state, "対象外");
      // 比較元が無効（候補の条件を外れた）ときも根拠未確認
      const broken = { ...DUMMY, bases: [{ runKey: "r906", baseRunKey: "r901", decidedAt: STAMP }] };
      asserts.check("候補の条件を外れた比較元は辺にしない", basisIn(broken, "r906", "g901").reason, "TP-3（PJ-C）の比較元が無効で前段をたどれない");
    },
  },
  {
    id: "B7-cycle",
    name: "連鎖が循環・自己参照しても無限ループしない",
    expect: "循環を検出して根拠未確認になり、処理が有限時間で終わる",
    async run({ asserts }) {
      const t0 = performance.now();
      const a = basis("r908", "g901"), b = basis("r909", "g901");
      const ms = performance.now() - t0;
      asserts.check("互いを比較元にした2ラン（TP-5）", [a.state, a.reason], ["根拠未確認", "連鎖が循環している（TP-5（PJ-E）へ戻る）"]);
      asserts.check("互いを比較元にした2ラン（TP-6）", [b.state, b.reason], ["根拠未確認", "連鎖が循環している（TP-6（PJ-E）へ戻る）"]);
      asserts.checkTrue(`有限時間で終わる（${ms.toFixed(1)}ms）`, ms < 1000);
      // 自己参照（保存時は拒否されるが、手で作られても止まること）
      const selfCtx = makeSamenessContext(RUNS, [{ runKey: "r906", baseRunKey: "r906", decidedAt: STAMP }], []);
      const self = basisOf(runOf("r906"), regOf("g901"), RUNS, selfCtx);
      asserts.check("自己参照でも止まる", self.state, "根拠未確認");
      // 同じ型式記号のランが同じLOで並んでも、辺を作らず止まる
      const sameLo = [{ key: "x1", typeId: "TP-Z", gen: "PJ-Z", sk: "継", lo: "2023-01-01", drop: "2026-12-31" },
                      { key: "x2", typeId: "TP-Z", gen: "PJ-Z", sk: "継", lo: "2023-01-01", drop: "2026-12-31" }];
      asserts.check("同じLOのラン同士は辺にしない", basisOf(sameLo[0], regOf("g901"), sameLo, null).state, "根拠未確認");
    },
  },
  {
    id: "B5B6-screen",
    name: "画面：対象セルにだけ根拠文と根拠未確認の印が出る／要再確認とは別の表示",
    expect: "対象外セルには何も出ない。根拠未確認は要再確認と文言・色・線種が違う",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, DUMMY);
      const t = (runKey, rid) => cellText(c, DUMMY, runKey, rid);
      asserts.checkTrue("根拠文（中継0）が出る", t("r902", "g901").includes("根拠：TP-1（PJ-A・LO 2016/01）の指定から変更なしで継続（中継0件）"));
      asserts.checkTrue("根拠文（中継2）が出る", t("r905", "g901").includes("根拠：TP-1（PJ-A・LO 2016/01）の指定から変更なしで継続（中継2件）"));
      asserts.checkTrue("自分が根の1行が出る", t("r902", "g905").includes("この型式ラン自身の指定（LO 2021/01）"));
      asserts.checkTrue("根拠未確認の印と理由が出る",
        t("r906", "g901").includes("根拠未確認") &&
        t("r906", "g901").includes("継続車適用日の猶予を使っているが、TP-3（PJ-C）に前段が無い"));
      asserts.check("要否が変わらないセルには出さない（REG-V）", t("r903", "g907").includes("根拠"), false);
      asserts.check("両方否のセルには出さない（REG-W）", t("r903", "g908").includes("根拠"), false);
      asserts.check("新型車適用日が無い法規のセルには出さない（REG-R）", t("r903", "g903").includes("根拠"), false);
      asserts.check("新型車日で判定しているセルには出さない", t("r904", "g906").includes("根拠"), false);
      asserts.check("LOが空のランには出さない", t("r907", "g901").includes("根拠"), false);
      // 同じセルに「要再確認」と「根拠未確認」が並ぶケース（TP-7）
      const both = t("r910", "g901");
      asserts.check("要再確認と根拠未確認が同じセルに出る", [both.includes("要再確認"), both.includes("根拠未確認")], [true, true]);
      const bBadge = spanIn(c, DUMMY, "r910", "g901", "根拠未確認"), rBadge = spanIn(c, DUMMY, "r910", "g901", "要再確認");
      asserts.check("2つは別の要素", [!!bBadge, !!rBadge, bBadge === rBadge], [true, true, false]);
      const bs = bBadge ? getComputedStyle(bBadge) : null, rs = rBadge ? getComputedStyle(rBadge) : null;
      asserts.check("色が違う（根拠未確認は青系・要再確認は黄）", [bs?.color, rs?.color], ["rgb(109, 181, 255)", "rgb(224, 178, 77)"]);
      asserts.check("線種が違う（破線と実線）", [bs?.borderTopStyle, rs?.borderTopStyle], ["dashed", "solid"]);
      // 凡例
      asserts.checkTrue("凡例に対象の説明がある", c.textContent.includes("継続車適用日の猶予を使っているセル"));
    },
  },
  {
    id: "B9-regression",
    name: "回帰例：新型車日・継続車日がともにLOより前の法規（REG-A）の000B・000Cには何も出さない",
    expect: "どちらの日でも「要」のセルには根拠文も根拠未確認も出ない。猶予を使うセルでは連鎖検証が動く",
    async run({ mount, asserts }) {
      // 製品のSEEDそのもので確認する（停止①の現物確認で見つかった誤りの回帰）
      // F-20でSEEDの日付が「今日からの相対日付」になったため、日付の値そのものではなく
      // **この回帰が成り立つ前提**（REG-Aの両方の日が000B・000CのLOより前）を確認する。
      const reg = (id) => SEED_DATA.regs.find((r) => r.id === id);
      const run = (key) => SEED_DATA.runs.find((r) => r.key === key);
      // F-25：猶予を使う例は 000C の DEMO-0005（r8）×REG-A2 へ移した（比較元は000CのDEMO-0001＝r4）
      const A = reg("DEMO-REG-A"), A2 = reg("DEMO-REG-A2");
      asserts.check("REG-Aは新型車日・継続車日とも000B・000CのLOより前",
        [A.shin < run("r2").lo && A.kei < run("r2").lo, A.shin < run("r4").lo && A.kei < run("r4").lo], [true, true]);
      asserts.check("REG-A2の新型車日は000CのDEMO-0005のLO以前、継続車日はそのdropより後",
        [A2.shin <= run("r8").lo, A2.kei > run("r8").drop], [true, true]);
      asserts.check("どちらの日でも要（要否が変わらない）",
        [graceChangesNeed(run("r2"), A), graceChangesNeed(run("r4"), A)], [false, false]);
      asserts.check("よって対象外", [basisIn(SEED_DATA, "r2", A.rid).state, basisIn(SEED_DATA, "r4", A.rid).state], ["対象外", "対象外"]);
      // 猶予を使うセル（新型車日なら要・継続車日なら否）では連鎖検証が動く
      asserts.check("000CのDEMO-0005×REG-A2は猶予を使う", graceChangesNeed(run("r8"), A2), true);
      asserts.check("そのセルは根までたどれる", shape(basisIn(SEED_DATA, "r8", A2.rid)), ["根到達", 0, "r4"]);
      // 画面（SEEDのまま）
      const c = await mountWith(mount, SEED_DATA);
      asserts.check("REG-Aの000Bセルに根拠は出ない", cellText(c, SEED_DATA, "r2", A.rid).includes("根拠"), false);
      asserts.check("REG-Aの000Cセルに根拠は出ない", cellText(c, SEED_DATA, "r4", A.rid).includes("根拠"), false);
      // 根拠文のLOはSEEDの値から作る（固定日付を書かない。F-20でSEEDが相対日付になったため）
      const ym = (d) => d.replaceAll("-", "/").slice(0, 7);
      asserts.checkTrue("猶予を使うセルには根拠文が出る",
        cellText(c, SEED_DATA, "r8", A2.rid).includes(`根拠：DEMO-0001（000C・LO ${ym(run("r4").lo)}）の指定から変更なしで継続（中継0件）`));
      const shown = [...c.querySelectorAll("table tbody td")].filter((td) => td.textContent.includes("根拠")).length;
      asserts.check("SEEDで根拠の行が出るセル数", shown, 1);
    },
  },
  {
    id: "B2B5-live-edit",
    name: "表示後に法規の日付を編集すると、対象判定と根拠表示が追随する",
    expect: "継続車日をdropより前にすると対象外になり根拠が消える。戻すとまた出る",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, DUMMY);
      const has = (runKey) => cellText(c, DUMMY, runKey, "g901").includes("根拠");
      asserts.check("編集前は根拠が出ている", [has("r902"), has("r903")], [true, true]);
      // REG-P の継続車日を、どちらのランのdropよりも前にする（＝両方の日で「要」＝対象外）
      await editRegDate(c, DUMMY, "g901", "kei", "2022-01-01");
      asserts.check("継続車日を早めると対象外になり根拠が消える", [has("r902"), has("r903")], [false, false]);
      asserts.checkTrue("要否そのものは既存ルールどおり「要」になる", cellText(c, DUMMY, "r903", "g901").includes("申請発生"));
      // 元に戻すと再び出る
      await editRegDate(c, DUMMY, "g901", "kei", FAR_KEI);
      asserts.check("戻すとまた根拠が出る", [has("r902"), has("r903")], [true, true]);
      // 新型車適用日を動かすと根も動く（中継点の数が変わる）
      await editRegDate(c, DUMMY, "g901", "shin", "2021-01-01");
      asserts.checkTrue("新型車適用日を動かすと根も変わる",
        cellText(c, DUMMY, "r903", "g901").includes("TP-1（PJ-B・LO 2021/01）の指定から変更なしで継続（中継0件）"));
      // 索引そのものも、同じ rid の別内容を取り違えない
      const ctx = makeBasisContext(RUNS, ctxOf());
      const before = ctx.of(runOf("r903"), regOf("g901")).state;
      const edited = { ...regOf("g901"), kei: "2022-01-01" };
      asserts.check("同じridでも内容が変われば結果を作り直す", [before, ctx.of(runOf("r903"), edited).state], ["根到達", "対象外"]);
    },
  },
  {
    id: "B8-legacy-roundtrip",
    name: "既存データの読み込みと、JSON往復・データ入りHTML往復",
    expect: "連鎖不明・LOなしの旧形式でも壊れず、対象セルだけ根拠未確認になる。往復の前後で変わらない",
    async run({ mount, asserts }) {
      // 旧形式（bases・sameness・decisions を持たない）。LOが空のランも含む
      const legacy = { runs: clone(RUNS), regs: clone(REGS), cert: {} };
      const parsedLegacy = parseImportedData(clone(legacy));
      asserts.check("旧形式を読み込める", parsedLegacy.ok, true);
      const legacyData = parsedLegacy.data;
      asserts.check("比較元・同一性は空で補われる", [legacyData.bases, legacyData.sameness], [[], []]);
      asserts.check("旧形式でも(a)だけで根に届く", shape(basisIn(legacyData, "r903", "g901")), ["根到達", 1, "r901"]);
      asserts.check("比較元が要るセルは根拠未確認になる", basisIn(legacyData, "r905", "g901").state, "根拠未確認");
      asserts.check("LOが空のランは対象外のまま（警告を広げない）", basisIn(legacyData, "r907", "g901").state, "対象外");
      asserts.check("要否が変わらない法規へは広げない", basisIn(legacyData, "r903", "g907").state, "対象外");

      // JSON往復
      const before = basisTable(DUMMY);
      const c = await mountWith(mount, DUMMY);
      const snap = await snapshotAll(c);
      // F-22：書き出しは版番号（schemaVersion）付きの版2になる。それ以外の項目は従来どおり。
      asserts.check("書き出したデータの項目は従来どおり＋版番号", Object.keys(snap).sort(), ["bases", "cert", "decisions", "regs", "runs", "sameness", "schemaVersion"]);
      const reparsed = parseImportedData(clone(snap));
      asserts.check("書き出したデータを読み戻せる", reparsed.ok, true);
      asserts.check("JSON往復で根拠が変わらない", basisTable(reparsed.data), before);

      // データ入りHTML往復
      const html = `<html><body><!--ILIST_BOOT_DATA_START--><!--ILIST_BOOT_DATA_END--></body></html>`;
      const rep = replaceBootData(html, snap);
      const doc = new DOMParser().parseFromString(rep.html, "text/html");
      const boot = readBootData(doc);
      asserts.check("埋め込みを読める", [boot.present, boot.ok], [true, true]);
      asserts.check("データ入りHTML往復で根拠が変わらない", basisTable(boot.data), before);
      const c2 = await mountWith(mount, boot.data);
      asserts.checkTrue("埋め込みから起動した画面にも根拠文が出る", cellText(c2, DUMMY, "r905", "g901").includes("（中継2件）"));
    },
  },
  {
    id: "no-side-effects",
    name: "やらないこと：要否・期日・同一性・人の判断・保存データを変えない",
    expect: "根拠は表示だけ。判定結果と保存データは根拠の有無に関係なく従来どおり",
    async run({ mount, asserts }) {
      const ctx = ctxOf();
      const cell = (runKey, rid) => {
        const c = evalCellWith({}, runOf(runKey), regOf(rid), ctx.effective(runOf(runKey), regOf(rid)));
        return [c.status, c.kind, c.dueDate];
      };
      asserts.check("継続ラン×REG-P（猶予中なので否）", cell("r903", "g901"), ["off", "", FAR_KEI]);
      asserts.check("継続ラン×REG-V（継続車日で要）", cell("r903", "g907"), ["leak", "継続", "2018-01-01"]);
      asserts.check("同一と答えた新型ラン×REG-P（継続車日で判定＝否）", cell("r904", "g901"), ["off", "", FAR_KEI]);
      asserts.check("同一でない×REG-U（新型車日で要）", cell("r904", "g906"), ["leak", "新型", "2020-12-31"]);
      asserts.check("根拠未確認のセルでも要否は変わらない", cell("r906", "g901"), ["off", "", FAR_KEI]);
      // 同一性の要再確認は根拠とは別（根拠未確認になっても要再確認は増えない）
      const c = await mountWith(mount, DUMMY);
      const table = c.querySelector("table");
      const rechecks = [...table.querySelectorAll("span")].filter((s) => s.textContent.trim() === "要再確認").length;
      asserts.check("帳票に出る要再確認の数（根拠未確認では増えない）", rechecks, 2);
      asserts.check("要再確認が出るセル（同一性が原因のセルだけ）",
        [cellText(c, DUMMY, "r910", "g901").includes("要再確認"), cellText(c, DUMMY, "r904", "g906").includes("要再確認"),
         cellText(c, DUMMY, "r906", "g901").includes("要再確認"), cellText(c, DUMMY, "r905", "g905").includes("要再確認")],
        [true, true, false, false]);
      // 保存データは根拠を持たない（派生情報を保存しない）
      const snap = await snapshotAll(c);
      asserts.check("保存データに根拠の項目は増えない",
        [Object.keys(snap).includes("basis"), JSON.stringify(snap).includes("根拠")], [false, false]);
      // F-22：旧形式（版なし・cert:{}）で読み込んだものは版2で書き出される。空の認証実績は空配列へ移る。
      asserts.check("保存データの中身は読み込んだものと一致（版2へ移行した形）", snap,
        { schemaVersion: 2, runs: RUNS, regs: REGS, cert: [], decisions: [], bases: BASES, sameness: SAMENESS });
    },
  },
];

// ───────────────────────────────────────────────
function Runner() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const runAll = async () => {
    if (window.__BASISVERIFY_RUNNING__) return;
    window.__BASISVERIFY_RUNNING__ = true;
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
          await s.run({ mount: mgr.mount, asserts });
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
      window.__BASISVERIFY_RESULT__ = {
        finished: true,
        pass: vals.filter((r) => r.pass).length,
        fail: vals.filter((r) => !r.pass).length,
        total: SCENARIOS.length,
        residualNodes: document.getElementById("sandbox").childElementCount,
        scenarios: SCENARIOS.map((s) => ({ id: s.id, name: s.name, pass: collected[s.id]?.pass, actual: collected[s.id]?.actual, detail: collected[s.id]?.detail })),
      };
      window.__BASISVERIFY_RUNNING__ = false;
    }
  };
  useEffect(() => {
    window.__runBasisVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);
  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>比較元を官報準拠にする（F-12） 検証ハーネス</h1>
      <p style={{ color: "#5a6b7d", fontSize: 12.5, lineHeight: 1.7, marginTop: 0 }}>
        実際の <code>StandaloneApp</code> をマウントして実測します。対象判定も根の判定も保存された日付どうしの比較だけで決まるため、
        このページは固定日付を使います（端末の「今日」には依存しません）。<br />
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
