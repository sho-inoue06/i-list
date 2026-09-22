// ───────────────────────────────────────────────
// 期日超過を「法規不適合／要対応／drop済み」に分ける（F-14）の検証ハーネス
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない
// （API版のケースでは window.fetch をモックする）。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/overdue.html
//
// 完成条件 A1〜A10（Notion「Iリスト｜バックログ」F-14）を、ケースIDの先頭で対応づける。
// A10 の「既存の自動検証とbuildが通る」はこのページの対象外（既存ハーネスと build で確認する）。
//
// 期待値に固定日付を書かない。F-13と同じく、実行時の端末ローカル日付から
// 前日・当日・翌日を作る（基準日を固定する手段を製品にも検証設定にも持たないため）。
// ───────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import IListApp, {
  TODAY, parseImportedData, evalCellWith, summarize, approachingNoticeFor,
  complianceStateOf, condOf, COMPLIANCE_STATES, samenessAffects,
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
const YESTERDAY = shift(-1), TODAY_D = shift(0), TOMORROW = shift(1);
const LONG_AGO = shift(-3650), FAR = shift(3650);
// LOがまだ来ていないランの例。翌日と必ず別の年月になるよう60日先にする（表示は YYYY/MM のため）。
const LO_SOON = shift(60);
const STAMP = `${TODAY_D} 10:00`;
const fmt = (d) => d.replaceAll("-", "/").slice(0, 7);   // 画面表示（YYYY/MM）と同じ整形

// 画面に出る状態名（F-14の表示ルール）。検証側で独立に書き、製品の定数を借りない。
const L_VIOLATION = "法規不適合";
const L_PAST = "過去に法規不適合（drop済み）";
const L_DROPPED = "drop済み（対応対象外）";
const L_EXEMPT = "対象外（判断済み）";
const L_UPCOMING = (d) => `要対応｜${fmt(d)}まで`;
// 「過去に法規不適合（drop済み）」を先に見ること（「法規不適合」が部分一致で先に当たらないように）
const STATE_RE = /過去に法規不適合（drop済み）|法規不適合|drop済み（対応対象外）|対象外（判断済み）|要対応｜\d{4}\/\d{2}まで/g;
const statesIn = (t) => t.match(STATE_RE) || [];

// ── ダミーデータ（架空。実車・実法規・実認可番号とは無関係） ──
// 継続ランだけを使い、ドロップ日を 将来／当日／前日 に分ける。
// 法規の継続車日（＝期日）は 前日／当日／翌日。
//   DEMO-A drop=将来   … 生産中
//   DEMO-B drop=当日   … ドロップ当日（まだ生産中として扱う＝A4の境界）
//   DEMO-C drop=前日   … ドロップ済み
//   DEMO-D drop=将来   … 過去期日は実績ありで塞ぐ（実効ドロップを将来日にするため）
//   DEMO-E LO=60日先   … まだラインオフしていない（法規不適合にしない＝2026-09-20 祥の判断）
const BASE_DUMMY = {
  runs: [
    { key: "r401", typeId: "DEMO-A", gen: "PJ-A", sk: "継", lo: LONG_AGO, drop: FAR },
    { key: "r402", typeId: "DEMO-B", gen: "PJ-B", sk: "継", lo: LONG_AGO, drop: TODAY_D },
    { key: "r403", typeId: "DEMO-C", gen: "PJ-C", sk: "継", lo: LONG_AGO, drop: YESTERDAY },
    { key: "r404", typeId: "DEMO-D", gen: "PJ-D", sk: "継", lo: LONG_AGO, drop: FAR },
    { key: "r405", typeId: "DEMO-E", gen: "PJ-E", sk: "継", lo: LO_SOON,  drop: FAR },
  ],
  regs: [
    { rid: "g401", id: "REG-PAST",   label: "ダミー法規（期日は前日）", shin: LONG_AGO, kei: YESTERDAY, parent: "" },
    { rid: "g402", id: "REG-TODAY",  label: "ダミー法規（期日は当日）", shin: LONG_AGO, kei: TODAY_D,   parent: "" },
    { rid: "g403", id: "REG-FUTURE", label: "ダミー法規（期日は翌日）", shin: LONG_AGO, kei: TOMORROW,  parent: "" },
  ],
  cert: { "DEMO-D": { "REG-PAST": "CK-D-PAST", "REG-TODAY": "CK-D-TODAY" } },
};
const COL = { r401: 0, r402: 1, r403: 2, r404: 3, r405: 4 };
const ROW = { g401: 0, g402: 1, g403: 2 };

// 人の適用判断つき。対象外が他の状態より優先されること（A5）を見るための3件＋対照1件。
const judgeCond = (runKey, rid) => condOf(
  BASE_DUMMY.runs.find((r) => r.key === runKey),
  BASE_DUMMY.regs.find((r) => r.rid === rid),
  BASE_DUMMY.regs);
const dec = (runKey, rid, state, reason) => ({
  runKey, rid, state, reason, decidedAt: STAMP, needsRecheck: false, cond: judgeCond(runKey, rid),
});
const JUDGE_DUMMY = {
  ...BASE_DUMMY,
  decisions: [
    dec("r401", "g401", "対象外", "ダミー：期日が来ているセルを対象外と判断"),
    dec("r401", "g403", "対象外", "ダミー：期日がこれからのセルを対象外と判断"),
    dec("r403", "g401", "対象外", "ダミー：ドロップ済みランのセルを対象外と判断"),
    dec("r402", "g401", "対象",   "ダミー：対象と判断（状態は変えない）"),
  ],
};

// 同一性（F-04）の行用。「同一でない」＝新型車日で判定させる。
// 同一性の行は「新型車日 ≤ LO」のセルにしか出ない（答えても結論が変わらないセルには出さない）。
//   PJ-S：DEMO-W（LO=当日）… REG-S-PAST で法規不適合／REG-S-FUTURE は新型車日がLOより後＝行を出さない
//   PJ-T：DEMO-X（drop=前日）… REG-S-PAST で過去に法規不適合
//   PJ-U：DEMO-ZZ（LO=60日先）… LO未到来。REG-S-PAST は要対応｜LOまで、REG-S-FUTURE は要対応｜期日まで
const SAME_DUMMY = {
  runs: [
    { key: "r411", typeId: "DEMO-V",  gen: "PJ-S", sk: "新", lo: TODAY_D,   drop: FAR },
    { key: "r412", typeId: "DEMO-W",  gen: "PJ-S", sk: "新", lo: TODAY_D,   drop: FAR },
    { key: "r413", typeId: "DEMO-X",  gen: "PJ-T", sk: "新", lo: YESTERDAY, drop: YESTERDAY },
    { key: "r414", typeId: "DEMO-Y",  gen: "PJ-T", sk: "新", lo: YESTERDAY, drop: YESTERDAY },
    { key: "r415", typeId: "DEMO-Z",  gen: "PJ-U", sk: "新", lo: LO_SOON,   drop: FAR },
    { key: "r416", typeId: "DEMO-ZZ", gen: "PJ-U", sk: "新", lo: LO_SOON,   drop: FAR },
  ],
  regs: [
    { rid: "g411", id: "REG-S-PAST",   label: "ダミー法規（新型車日は前日）", shin: YESTERDAY, kei: FAR,      parent: "" },
    { rid: "g412", id: "REG-S-FUTURE", label: "ダミー法規（新型車日は翌日）", shin: TOMORROW,  kei: TOMORROW, parent: "" },
  ],
  cert: {},
  bases: [
    { runKey: "r412", baseRunKey: "r411", decidedAt: STAMP },
    { runKey: "r413", baseRunKey: "r414", decidedAt: STAMP },
    { runKey: "r416", baseRunKey: "r415", decidedAt: STAMP },
  ],
  sameness: [
    { runKey: "r412", rid: "g411", value: "同一でない", reason: "ダミー：装置を変更", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r411" },
    { runKey: "r412", rid: "g412", value: "同一でない", reason: "ダミー：答えても結論が変わらないセル", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r411" },
    { runKey: "r413", rid: "g411", value: "同一でない", reason: "ダミー：装置を変更", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r414" },
    { runKey: "r416", rid: "g411", value: "同一でない", reason: "ダミー：装置を変更", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r415" },
  ],
};
const SCOL = { r411: 0, r412: 1, r413: 2, r414: 3, r415: 4, r416: 5 };
const SROW = { g411: 0, g412: 1 };

// ドロップ済みの2種類を分けるためのダミー（2026-09-20 祥の判断）。
//   DEMO-P（新型・LO=前日・drop=30日前）… 期日(新型車日=前日) > drop ＝ 規制が来る前にドロップしていた
//   DEMO-Q（継続・drop=前日）          … 期日(継続車日=30日前) ≤ drop ＝ 不適合のまま生産を続けていた
const PAST_DUMMY = {
  runs: [
    { key: "r421", typeId: "DEMO-P", gen: "PJ-P", sk: "新", lo: YESTERDAY, drop: shift(-30) },
    { key: "r422", typeId: "DEMO-Q", gen: "PJ-Q", sk: "継", lo: LONG_AGO,  drop: YESTERDAY },
  ],
  regs: [
    { rid: "g421", id: "REG-OLD", label: "ダミー法規（新型車日は前日・継続車日は30日前）", shin: YESTERDAY, kei: shift(-30), parent: "" },
  ],
  cert: {},
};

const clone = (o) => JSON.parse(JSON.stringify(o));

// ── 画面ユーティリティ ──
function cellAt(c, row, col) {
  const tr = c.querySelector("table tbody")?.children[row];
  const td = tr?.children[col + 1];
  if (!td) throw new Error(`帳票のセルがありません: ${row},${col}`);
  return td;
}
const cellText = (c, row, col) => cellAt(c, row, col).textContent;
function cardEl(c, title) {
  const h = [...c.querySelectorAll("h3")].find((e) => e.textContent.trim() === title);
  if (!h) throw new Error(`カードが見つかりません: ${title}`);
  return h.parentElement.parentElement;
}
const cardText = (c, title) => cardEl(c, title).textContent;
const LEAKS = "コンプラ漏れ（自動検出）";
const EFFDROP = "実効ドロップ（規制で縛られる期限）";
// コンプラ漏れ一覧の1行（型式と状態名で特定する）
function leakRow(c, typeId, label) {
  const el = [...cardEl(c, LEAKS).querySelectorAll("div")]
    .find((d) => d.textContent.includes(typeId) && d.textContent.includes(label) && d.querySelector("span"));
  if (!el) throw new Error(`コンプラ漏れの行がありません: ${typeId} / ${label}`);
  return el;
}
const rowTypeColor = (el) => el.querySelector("span").style.color;            // 先頭＝型式名
const rowStateColor = (el) => [...el.querySelectorAll("span")].pop().style.color;  // 末尾＝状態名

async function clickByText(container, re) {
  const b = [...container.querySelectorAll("button")].find((x) => re.test(x.textContent));
  if (!b) throw new Error(`ボタンが見つかりません: ${re}`);
  b.click();
  await sleep(10);
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

// ───────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "A1-classify-uniquely",
    name: "期日・drop・人の適用判断だけで4状態へ一意に分類できる（境界日を含む）",
    expect: "complianceStateOf が 対象外＞drop済み＞法規不適合＞要対応 の順で1状態だけを返す。期日当日・drop当日は境界どおり。日付が読めないときは警告を弱めない側へ寄る",
    async run({ asserts }) {
      // lo を省略した呼び出しは「もうLOを迎えている」扱い（警告を弱めない側）
      const st = (dueDate, drop, decisionState, lo) => complianceStateOf({ dueDate, drop, lo, decisionState }).state;
      asserts.check("状態は5種", COMPLIANCE_STATES, ["対象外", "過去不適合", "drop済み", "法規不適合", "要対応"]);
      // 期日の境界（≤今日）
      asserts.check("期日=前日・生産中", st(YESTERDAY, FAR), "法規不適合");
      asserts.check("期日=当日・生産中（境界）", st(TODAY_D, FAR), "法規不適合");
      asserts.check("期日=翌日", st(TOMORROW, FAR), "要対応");
      // dropの境界（drop当日はまだ生産中）
      asserts.check("drop=翌日", st(YESTERDAY, TOMORROW), "法規不適合");
      asserts.check("drop=当日（境界）", st(YESTERDAY, TODAY_D), "法規不適合");
      asserts.check("drop=前日（期日 ≤ drop＝過去に不適合）", st(YESTERDAY, YESTERDAY), "過去不適合");
      asserts.check("期日 < drop（不適合のまま生産していた）", st(shift(-30), YESTERDAY), "過去不適合");
      asserts.check("期日 > drop（規制前にやめた）", st(YESTERDAY, shift(-30)), "drop済み");
      asserts.check("期日が読めないときは事実を残す側", st("", YESTERDAY), "過去不適合");
      // 人の判断は最優先。対象・未確認・判断なしは状態を変えない
      asserts.check("対象外は法規不適合より優先", st(YESTERDAY, FAR, "対象外"), "対象外");
      asserts.check("対象外は過去不適合より優先", st(YESTERDAY, YESTERDAY, "対象外"), "対象外");
      asserts.check("対象外は要対応より優先", st(TOMORROW, FAR, "対象外"), "対象外");
      asserts.check("対象は状態を変えない", st(YESTERDAY, FAR, "対象"), "法規不適合");
      asserts.check("未確認は状態を変えない", st(YESTERDAY, YESTERDAY, "未確認"), "過去不適合");
      asserts.check("判断なしも同じ", st(TOMORROW, FAR, undefined), "要対応");
      // LO（ラインオフ）の境界。期日を過ぎていても、LOがまだのランは法規不適合にしない
      asserts.check("LO=翌日（未到来）", st(YESTERDAY, FAR, undefined, TOMORROW), "要対応");
      asserts.check("LO=当日（境界・到来済み）", st(YESTERDAY, FAR, undefined, TODAY_D), "法規不適合");
      asserts.check("LO=前日（到来済み）", st(YESTERDAY, FAR, undefined, YESTERDAY), "法規不適合");
      // F-19 C6：期限 = max（適用した規制日、LO）。期日が先でもLOがもっと先ならLOを示す
      // （F-14では期日を示していた点が、F-19で変わった）
      asserts.check("LO未到来で期日より後なら、期日が先でもLOを示す", complianceStateOf({ dueDate: TOMORROW, drop: FAR, lo: LO_SOON }).label, L_UPCOMING(LO_SOON));
      asserts.check("LOのほうが先なら期日を示す", complianceStateOf({ dueDate: LO_SOON, drop: FAR, lo: TOMORROW }).label, L_UPCOMING(LO_SOON));
      asserts.check("LO未到来で期日が過去ならLOを示す", complianceStateOf({ dueDate: YESTERDAY, drop: FAR, lo: LO_SOON }).label, L_UPCOMING(LO_SOON));
      // F-19：状態名も決定表の出力から作る（Codexレビュー指摘1の修正）。LO > drop は決定表が前提にする
      // 並び（LO < drop）から外れたデータで、LOがまだ来ていない＝超過にならないので「要対応｜LOまで」になる。
      // F-14では drop済みを優先して「過去不適合」にしていたが、それだと決定表の出力と画面が食い違う。
      asserts.check("LO未到来はドロップ済みでも超過にしない", st(YESTERDAY, YESTERDAY, undefined, TOMORROW), "要対応");
      asserts.check("LOが到来していればドロップ済みは過去不適合のまま", st(YESTERDAY, YESTERDAY, undefined, LONG_AGO), "過去不適合");
      asserts.check("LO未到来より人の対象外が優先", st(YESTERDAY, FAR, "対象外", TOMORROW), "対象外");
      asserts.check("LOが空なら到来済み側", st(YESTERDAY, FAR, undefined, ""), "法規不適合");
      asserts.check("LOが実在しない日付でも到来済み側", st(YESTERDAY, FAR, undefined, "2026-02-30"), "法規不適合");
      // 表示文言（ラベル）
      asserts.check("ラベル", [
        complianceStateOf({ dueDate: YESTERDAY, drop: FAR }).label,
        complianceStateOf({ dueDate: YESTERDAY, drop: YESTERDAY }).label,
        complianceStateOf({ dueDate: YESTERDAY, drop: shift(-30) }).label,
        complianceStateOf({ dueDate: TOMORROW, drop: FAR }).label,
        complianceStateOf({ dueDate: TOMORROW, drop: FAR, decisionState: "対象外" }).label,
      ], [L_VIOLATION, L_PAST, L_DROPPED, L_UPCOMING(TOMORROW), L_EXEMPT]);
      // 読めない日付は「警告を弱めない側」へ寄せる
      asserts.check("期日が空なら期日到来側", st("", FAR), "法規不適合");
      asserts.check("期日が不正形式でも期日到来側", st("2026/13/40", FAR), "法規不適合");
      asserts.check("dropが空ならまだ生産中側", st(YESTERDAY, ""), "法規不適合");
      asserts.check("dropが実在しない日付でも生産中側", st(YESTERDAY, "2026-02-30"), "法規不適合");
      // 全組み合わせが必ず1状態に決まる（未分類・複数該当が無い）
      const all = [];
      for (const d of [YESTERDAY, TODAY_D, TOMORROW, "", "2026-02-30"])
        for (const dr of [YESTERDAY, TODAY_D, TOMORROW, FAR, "", "2026-02-30"])
          for (const l of [LONG_AGO, TODAY_D, TOMORROW, "", "2026-02-30"])
            for (const j of [undefined, "未確認", "対象", "対象外"]) all.push(st(d, dr, j, l));
      asserts.check("全組み合わせが5状態のいずれか", all.every((x) => COMPLIANCE_STATES.includes(x)), true);
      asserts.check("組み合わせ数", all.length, 5 * 6 * 5 * 4);
    },
  },
  {
    id: "A2-violation-red",
    name: "期日到来・まだ生産中のセルは、帳票セルとコンプラ漏れ一覧で赤い「法規不適合」になる",
    expect: "DEMO-A（drop将来）とDEMO-B（drop当日）の過去・当日期日のセルが法規不適合。申請発生の表示は残る",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, BASE_DUMMY);
      const cells = [["r401", "g401"], ["r401", "g402"], ["r402", "g401"], ["r402", "g402"]];
      asserts.check("4セルとも法規不適合", cells.map(([k, g]) => statesIn(cellText(c, ROW[g], COL[k]))), [[L_VIOLATION], [L_VIOLATION], [L_VIOLATION], [L_VIOLATION]]);
      asserts.check("申請発生の表示は残る（A9）", cells.map(([k, g]) => cellText(c, ROW[g], COL[k]).includes("申請発生")), [true, true, true, true]);
      const t = cardText(c, LEAKS);
      // 「過去に法規不適合（drop済み）」に部分一致しないよう、直前の「過去に」を除外して数える
      asserts.check("コンプラ漏れにも4件", (t.match(/(?<!過去に)法規不適合/g) || []).length, 4);
      asserts.checkTrue("DEMO-A×REG-PAST の行", /DEMO-A（PJ-A）\s*×\s*REG-PAST継続\s*法規不適合/.test(t));
      asserts.checkTrue("DEMO-B×REG-TODAY の行（drop当日でも赤）", /DEMO-B（PJ-B）\s*×\s*REG-TODAY継続\s*法規不適合/.test(t));
      asserts.check("赤で出す", rowStateColor(leakRow(c, "DEMO-A", L_VIOLATION)), "rgb(255, 107, 87)");
      asserts.check("LOがまだのランは法規不適合にしない（対照）", statesIn(cellText(c, ROW.g401, COL.r405)), [L_UPCOMING(LO_SOON)]);
    },
  },
  {
    id: "A3-upcoming-orange",
    name: "期日がこれからのセルは、帳票セルとコンプラ漏れ一覧で橙の「要対応｜YYYY/MMまで」になる",
    expect: "DEMO-A・DEMO-D × REG-FUTURE が 要対応｜翌日の年月まで。LOが60日先のDEMO-EだけはLOの年月（C6の max）。法規不適合は併記しない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, BASE_DUMMY);
      // F-19 C6：期限 = max（適用した規制日、LO）。DEMO-E はLOが60日先なので期日（翌日）ではなくLOを出す。
      asserts.check("3セルとも要対応（期限は max（期日、LO））",
        [["r401", "g403"], ["r404", "g403"], ["r405", "g403"]].map(([k, g]) => statesIn(cellText(c, ROW[g], COL[k]))),
        [[L_UPCOMING(TOMORROW)], [L_UPCOMING(TOMORROW)], [L_UPCOMING(LO_SOON)]]);
      asserts.checkTrue("LOが期日より後なら、期日ではなくLOを示す", cellText(c, ROW.g403, COL.r405).includes(L_UPCOMING(LO_SOON)));
      const t = cardText(c, LEAKS);
      asserts.check("コンプラ漏れの要対応は5件（期日3・LO2）", (t.match(/要対応｜/g) || []).length, 5);
      asserts.checkTrue("DEMO-A×REG-FUTURE の行", t.includes(`DEMO-A（PJ-A） × REG-FUTURE継続 ${L_UPCOMING(TOMORROW)}`));
      asserts.check("橙で出す", rowStateColor(leakRow(c, "DEMO-A", "要対応｜")), "rgb(255, 159, 67)");
    },
  },
  {
    id: "A4-dropped-gray",
    name: "期日到来でもドロップ済みなら灰色になる（不適合のまま生産していた場合は事実を残す／drop当日は生産中）",
    expect: "DEMO-C（drop前日・期日＝前日）×REG-PAST が「過去に法規不適合（drop済み）」。DEMO-B（drop当日）×REG-PAST は法規不適合のまま",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, BASE_DUMMY);
      asserts.check("drop前日のセルは過去に法規不適合", statesIn(cellText(c, ROW.g401, COL.r403)), [L_PAST]);
      asserts.check("赤い「法規不適合」は出さない", statesIn(cellText(c, ROW.g401, COL.r403)).includes(L_VIOLATION), false);
      asserts.check("drop当日は法規不適合のまま", statesIn(cellText(c, ROW.g401, COL.r402)), [L_VIOLATION]);
      asserts.checkTrue("ドロップ済みでも申請発生の表示は残る（A9）", cellText(c, ROW.g401, COL.r403).includes("申請発生"));
      const t = cardText(c, LEAKS);
      asserts.check("コンプラ漏れにも1件", (t.match(/過去に法規不適合（drop済み）/g) || []).length, 1);
      asserts.checkTrue("DEMO-C×REG-PAST の行", /DEMO-C（PJ-C）\s*×\s*REG-PAST継続\s*過去に法規不適合（drop済み）/.test(t));
    },
  },
  {
    id: "LO-before-lineoff",
    name: "LO（ラインオフ）がまだ来ていないランは、期日を過ぎていても法規不適合にしない",
    expect: "DEMO-E（LO=60日先）の過去期日セルが、帳票セル・コンプラ漏れ一覧で橙の「要対応｜LOの年月まで」になる。同一性の行でも同じ",
    async run({ mount, asserts }) {
      // 2026-09-20 祥の判断：まだ世に出ていない車を「法規不適合」と呼ばない。期限はLOで示す。
      const c = await mountWith(mount, BASE_DUMMY);
      asserts.check("期日=前日・当日の2セルとも 要対応｜LOまで",
        [["r405", "g401"], ["r405", "g402"]].map(([k, g]) => statesIn(cellText(c, ROW[g], COL[k]))),
        [[L_UPCOMING(LO_SOON)], [L_UPCOMING(LO_SOON)]]);
      asserts.check("同じ期日でもLOが過ぎているランは法規不適合（対照）",
        [["r401", "g401"], ["r401", "g402"]].map(([k, g]) => statesIn(cellText(c, ROW[g], COL[k]))),
        [[L_VIOLATION], [L_VIOLATION]]);
      asserts.checkTrue("申請発生の表示は残る（A9）", cellText(c, ROW.g401, COL.r405).includes("申請発生"));
      const t = cardText(c, LEAKS);
      asserts.checkTrue("コンプラ漏れにも出る", t.includes(`DEMO-E（PJ-E） × REG-PAST継続 ${L_UPCOMING(LO_SOON)}`));
      asserts.check("橙で出す（灰にはしない）", rowStateColor(leakRow(c, "DEMO-E", L_UPCOMING(LO_SOON))), "rgb(255, 159, 67)");
      asserts.check("型式名は灰色にしない", rowTypeColor(leakRow(c, "DEMO-E", L_UPCOMING(LO_SOON))), "rgb(238, 244, 250)");
      // 同一性の行でも同じ（DEMO-ZZ は LO=60日先、新型車日は前日）
      const cs = await mountWith(mount, SAME_DUMMY);
      asserts.check("同一性の行がある列でもLO未到来なら法規不適合にしない",
        statesIn(cellText(cs, SROW.g411, SCOL.r416)), [L_UPCOMING(LO_SOON), L_UPCOMING(LO_SOON)]);
      asserts.check("LOが過ぎている列は法規不適合（対照）",
        statesIn(cellText(cs, SROW.g411, SCOL.r412)), [L_VIOLATION, L_VIOLATION]);
    },
  },
  {
    id: "PAST-violation-vs-never-affected",
    name: "ドロップ済みでも、不適合のまま生産していたセルとそうでないセルを分ける",
    expect: "期日 ≤ drop は「過去に法規不適合（drop済み）」、期日 > drop は「drop済み（対応対象外）」。どちらも灰色で、コンプラ漏れ一覧にも残る",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, PAST_DUMMY);
      asserts.check("期日 ≤ drop（不適合のまま生産していた）", statesIn(cellText(c, 0, 1)), [L_PAST]);
      asserts.check("期日 > drop（規制前にやめた）", statesIn(cellText(c, 0, 0)), [L_DROPPED]);
      asserts.check("どちらも申請発生のまま（A9）",
        [0, 1].map((k) => cellText(c, 0, k).includes("申請発生")), [true, true]);
      const t = cardText(c, LEAKS);
      asserts.check("一覧は2件とも残る", summarize(PAST_DUMMY.runs, PAST_DUMMY.regs, PAST_DUMMY.cert).leaks.length, 2);
      asserts.checkTrue("DEMO-P は drop済み（対応対象外）", /DEMO-P（PJ-P）\s*×\s*REG-OLD新型\s*drop済み（対応対象外）/.test(t));
      asserts.checkTrue("DEMO-Q は過去に法規不適合", /DEMO-Q（PJ-Q）\s*×\s*REG-OLD継続\s*過去に法規不適合（drop済み）/.test(t));
      asserts.check("どちらも灰色（赤い警告には含めない）",
        [rowStateColor(leakRow(c, "DEMO-P", L_DROPPED)), rowStateColor(leakRow(c, "DEMO-Q", L_PAST))],
        ["rgb(154, 171, 189)", "rgb(154, 171, 189)"]);
    },
  },
  {
    id: "A5-human-exempt-first",
    name: "人が「対象外」と判断したセルは、他の状態より優先して灰色の「対象外（判断済み）」になる",
    expect: "法規不適合・要対応・drop済みのいずれになるセルでも、対象外の判断があれば対象外（判断済み）だけが出る。対象の判断は状態を変えない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, JUDGE_DUMMY);
      asserts.check("法規不適合のセル→対象外", statesIn(cellText(c, ROW.g401, COL.r401)), [L_EXEMPT]);
      asserts.check("要対応のセル→対象外", statesIn(cellText(c, ROW.g403, COL.r401)), [L_EXEMPT]);
      asserts.check("過去に不適合だったセル→対象外", statesIn(cellText(c, ROW.g401, COL.r403)), [L_EXEMPT]);
      asserts.check("「対象」の判断は状態を変えない（対照）", statesIn(cellText(c, ROW.g401, COL.r402)), [L_VIOLATION]);
      asserts.check("判断なしのセルも変わらない（対照）", statesIn(cellText(c, ROW.g402, COL.r401)), [L_VIOLATION]);
      asserts.check("3セルとも法規不適合を出さない",
        [[ROW.g401, COL.r401], [ROW.g403, COL.r401], [ROW.g401, COL.r403]].map(([r, k]) => cellText(c, r, k).includes(L_VIOLATION)),
        [false, false, false]);
      asserts.checkTrue("対象外でも申請発生の赤い表示は残る（A9）", cellText(c, ROW.g401, COL.r401).includes("申請発生"));
    },
  },
  {
    id: "A6-leak-list-keeps-rows",
    name: "コンプラ漏れ一覧は drop済み・対象外の行を除外せず、灰色の行として残す",
    expect: "判断なしでも判断ありでも一覧は10件。drop済み・対象外の行が残り、型式名・法規名が灰色で出る",
    async run({ mount, asserts }) {
      const cBase = await mountWith(mount, BASE_DUMMY);
      const tBase = cardText(cBase, LEAKS);
      asserts.check("判断なしの一覧は10件", summarize(BASE_DUMMY.runs, BASE_DUMMY.regs, BASE_DUMMY.cert).leaks.length, 10);
      asserts.check("判断なしの件数（法規不適合4・要対応5・過去不適合1）",
        [/(?<!過去に)法規不適合/g, /要対応｜/g, /過去に法規不適合（drop済み）/g].map((re) => (tBase.match(re) || []).length),
        [4, 5, 1]);
      asserts.check("過去に不適合だった行は灰色（型式名・状態名）",
        [rowTypeColor(leakRow(cBase, "DEMO-C", L_PAST)), rowStateColor(leakRow(cBase, "DEMO-C", L_PAST))],
        ["rgb(154, 171, 189)", "rgb(154, 171, 189)"]);
      asserts.check("法規不適合の行は灰色にしない（対照）", rowTypeColor(leakRow(cBase, "DEMO-A", L_VIOLATION)), "rgb(238, 244, 250)");

      const cJudge = await mountWith(mount, JUDGE_DUMMY);
      const tJudge = cardText(cJudge, LEAKS);
      asserts.check("判断ありでも件数は同じ（除外しない）",
        summarize(JUDGE_DUMMY.runs, JUDGE_DUMMY.regs, JUDGE_DUMMY.cert).leaks.length, 10);
      // 10件の内訳：対象外3（r401×PAST・r401×FUTURE・r403×PAST）／法規不適合3／要対応4／drop済み0
      asserts.check("対象外3件・法規不適合3件・要対応4件・過去不適合0件",
        [/対象外（判断済み）/g, /(?<!過去に)法規不適合/g, /要対応｜/g, /過去に法規不適合（drop済み）/g].map((re) => (tJudge.match(re) || []).length),
        [3, 3, 4, 0]);
      asserts.checkTrue("DEMO-C の行は残っている", tJudge.includes("DEMO-C（PJ-C）"));
      asserts.check("対象外の行は灰色（型式名・状態名）",
        [rowTypeColor(leakRow(cJudge, "DEMO-A", L_EXEMPT)), rowStateColor(leakRow(cJudge, "DEMO-A", L_EXEMPT))],
        ["rgb(154, 171, 189)", "rgb(154, 171, 189)"]);
    },
  },
  {
    id: "A7-sameness-row",
    name: "同一性の行は「期限超過」を廃止し、帳票セルと同じ状態名・色・優先順位で表示する",
    expect: "DEMO-W は前日＝法規不適合／翌日＝要対応、DEMO-X（drop前日）は drop済み。どのセルにも「期限超過」は出ない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, SAME_DUMMY);
      const cell = (k, g) => cellText(c, SROW[g], SCOL[k]);
      // 同一性の行があるセルは、帳票セルと同一性の行で同じ状態名が2回出る
      asserts.check("DEMO-W×前日", statesIn(cell("r412", "g411")), [L_VIOLATION, L_VIOLATION]);
      // F-19 C6：DEMO-ZZ はLOが60日先なので、期日（翌日）ではなくLOが期限になる
      asserts.check("DEMO-ZZ×翌日（期限は max＝LO）", statesIn(cell("r416", "g412")), [L_UPCOMING(LO_SOON), L_UPCOMING(LO_SOON)]);
      asserts.check("DEMO-X×前日（drop前日・期日＝前日）", statesIn(cell("r413", "g411")), [L_PAST, L_PAST]);
      asserts.check("DEMO-ZZ（LO未到来）×前日は法規不適合にしない", statesIn(cell("r416", "g411")), [L_UPCOMING(LO_SOON), L_UPCOMING(LO_SOON)]);
      asserts.check("同一性の行が出ていること", ["r412", "r413", "r416"].map((k) => cell(k, "g411").includes("同一性：同一でない")), [true, true, true]);
      asserts.check("「期限超過」はどこにも出さない",
        [["r411", "g411"], ["r412", "g411"], ["r412", "g412"], ["r413", "g411"], ["r414", "g411"], ["r416", "g411"]]
          .map(([k, g]) => cell(k, g).includes("期限超過")), [false, false, false, false, false, false]);
      asserts.checkTrue("画面全体にも「期限超過」は無い", !c.textContent.includes("期限超過"));
      asserts.check("比較元の無い列は帳票セルだけ（状態は1回）", statesIn(cell("r414", "g411")), [L_PAST]);
      asserts.check("比較元（LO未到来）の帳票セルも1回", statesIn(cell("r415", "g411")), [L_UPCOMING(LO_SOON)]);
    },
  },
  {
    id: "SAMENESS-hidden-when-no-effect",
    name: "同一性の答えで判定が何も変わらないセルには、同一性の行を出さない",
    expect: "新型車日がLOより後のセル（DEMO-W×REG-S-FUTURE）は、保存済みの「同一でない」があっても同一性の行と編集ボタンを出さない。帳票セルの状態と保存値は変わらない",
    async run({ mount, asserts }) {
      // 2026-09-20 祥の判断：答えても結論が変わらないセルでは同一性を選ばせない（行ごと出さない）。
      const c = await mountWith(mount, SAME_DUMMY);
      const hidden = cellText(c, SROW.g412, SCOL.r412);
      asserts.checkTrue("同一性の行を出さない", !hidden.includes("同一性"));
      asserts.check("編集ボタンも出さない",
        cellAt(c, SROW.g412, SCOL.r412).querySelectorAll('button[title="同一性を編集"]').length, 0);
      asserts.check("帳票セルの状態は従来どおり出る", statesIn(hidden), [L_UPCOMING(TOMORROW)]);
      asserts.checkTrue("答えが効くセルには出る（対照）", cellText(c, SROW.g411, SCOL.r412).includes("同一性：同一でない"));
      asserts.check("対照セルには編集ボタンがある",
        cellAt(c, SROW.g411, SCOL.r412).querySelectorAll('button[title="同一性を編集"]').length, 1);
      // 純関数：新型車日 ≤ LO のときだけ答えが効く
      asserts.check("新型車日がLOより後なら効かない／LO以前なら効く",
        [samenessAffects(SAME_DUMMY.runs[1], SAME_DUMMY.regs[1]), samenessAffects(SAME_DUMMY.runs[1], SAME_DUMMY.regs[0])], [false, true]);
      asserts.check("LOが未入力なら選ばせる側", samenessAffects({ lo: "" }, SAME_DUMMY.regs[1]), true);
      asserts.check("LOが不正な日付でも選ばせる側", samenessAffects({ lo: "2026-02-30" }, SAME_DUMMY.regs[1]), true);
      asserts.check("新型車日が空なら効かない", samenessAffects({ lo: TODAY_D }, { shin: "", kei: FAR }), false);
      // LO ≥ 継続車日 のセルは要否こそ変わらないが期日が変わるので、今までどおり選ばせる
      asserts.check("LO ≥ 継続車日でも選ばせる", samenessAffects({ lo: TODAY_D }, { shin: LONG_AGO, kei: LONG_AGO }), true);
      // 保存値は消さない（記録としては残る）
      const snap = await snapshotAll(c);
      asserts.check("保存済みの回答は残っている", snap.sameness, SAME_DUMMY.sameness);
    },
  },
  {
    id: "A8-effective-drop-unchanged",
    name: "実効ドロップ一覧の表示と判定を変更しない",
    expect: "実効日は summarize のとおりで、前日・当日は「既発効」、翌日は YYYY/MM。4状態の文言は一覧に出ない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, BASE_DUMMY);
      asserts.check("実効日（純関数）", summarize(BASE_DUMMY.runs, BASE_DUMMY.regs, BASE_DUMMY.cert).effDrop,
        { r401: YESTERDAY, r402: YESTERDAY, r403: YESTERDAY, r404: TOMORROW, r405: YESTERDAY });
      const t = cardText(c, EFFDROP);
      asserts.check("既発効は4件", (t.match(/既発効/g) || []).length, 4);
      asserts.checkTrue("LOがまだのDEMO-Eも従来どおり既発効", /DEMO-E（PJ-E）\s*実効 既発効/.test(t));
      asserts.checkTrue("DEMO-A は既発効", /DEMO-A（PJ-A）\s*実効 既発効/.test(t));
      asserts.checkTrue("DEMO-D は翌日の日付表示", t.includes(`DEMO-D（PJ-D） 実効 ${fmt(TOMORROW)}`));
      asserts.check("4状態の文言は出さない", statesIn(t), []);
    },
  },
  {
    id: "A9-no-change-to-judgement-or-data",
    name: "要否判定・人の適用判断の保存値・要再確認・保存データ形式を変更しない",
    expect: "evalCellWith の戻り値は今日・dropの位置と無関係。書き出したJSONのキーと判断・同一性の値は読み込んだものと一致し、要再確認も増えない",
    async run({ mount, asserts }) {
      // 要否判定は「今日」も人の判断も見ない
      const runA = BASE_DUMMY.runs[0], runC = BASE_DUMMY.runs[2];
      asserts.check("生産中ランの過去期日", evalCellWith({}, runA, BASE_DUMMY.regs[0]),
        { required: true, kind: "継続", ck: null, status: "leak", dueDate: YESTERDAY, applied: "" });
      asserts.check("drop済みランでも判定は同じ形", evalCellWith({}, runC, BASE_DUMMY.regs[0]),
        { required: true, kind: "継続", ck: null, status: "leak", dueDate: YESTERDAY, applied: "" });
      asserts.check("黄色の30日接近予告は変わらない",
        approachingNoticeFor("off", { ...runC, drop: TODAY_D }, { ...BASE_DUMMY.regs[0], kei: shift(10) }), { days: 10, keiDate: shift(10) });
      asserts.check("申請発生のセルには予告を出さない（従来どおり）",
        approachingNoticeFor("leak", runC, BASE_DUMMY.regs[0]), null);

      // 保存データ：キーも判断の値も変わらない。対象外の表示で要再確認は立たない
      const c = await mountWith(mount, JUDGE_DUMMY);
      const snap = await snapshotAll(c);
      asserts.check("保存データのキー", Object.keys(snap).sort(), ["bases", "cert", "decisions", "regs", "runs", "sameness"]);
      asserts.check("判断は読み込んだままの値", snap.decisions, JUDGE_DUMMY.decisions);
      asserts.check("要再確認は増えない", snap.decisions.filter((d) => d.needsRecheck).length, 0);
      asserts.checkTrue("画面にも要再確認は出ない", !cellText(c, ROW.g401, COL.r401).includes("要再確認"));
      const cs = await mountWith(mount, SAME_DUMMY);
      const snapS = await snapshotAll(cs);
      asserts.check("同一性も読み込んだままの値", snapS.sameness, SAME_DUMMY.sameness);
    },
  },
  {
    id: "A10-api-and-standalone",
    name: "API版・単体HTML版で同じ状態表示になる",
    expect: "同じダミーデータで、帳票セル15個の状態表示とコンプラ漏れ一覧の状態が完全に一致する",
    async run({ mount, mountApi, asserts }) {
      const cs = await mountWith(mount, BASE_DUMMY);
      const api = installApiMock(clone({ runs: BASE_DUMMY.runs, regs: BASE_DUMMY.regs, cert: BASE_DUMMY.cert }));
      try {
        const ca = mountApi().container;
        await sleep(160);
        const grid = (c) => [0, 1, 2].map((r) => [0, 1, 2, 3, 4].map((k) => statesIn(cellText(c, r, k)).join("")));
        const sa = grid(cs), aa = grid(ca);
        // 最終列（DEMO-E）はLOが60日先なので、期日が翌日の行でも期限はLOになる（F-19 C6の max）
        asserts.check("単体版の状態（行＝法規、列＝型式ラン）", sa, [
          [L_VIOLATION, L_VIOLATION, L_PAST, "", L_UPCOMING(LO_SOON)],
          [L_VIOLATION, L_VIOLATION, "", "", L_UPCOMING(LO_SOON)],
          [L_UPCOMING(TOMORROW), "", "", L_UPCOMING(TOMORROW), L_UPCOMING(LO_SOON)],
        ]);
        asserts.check("API版も同じ", aa, sa);
        asserts.check("コンプラ漏れ一覧も同じ", statesIn(cardText(ca, LEAKS)), statesIn(cardText(cs, LEAKS)));
        asserts.check("実効ドロップ一覧も同じ", cardText(ca, EFFDROP).replace(/\s+/g, ""), cardText(cs, EFFDROP).replace(/\s+/g, ""));
        asserts.check("検証側の今日と製品のTODAYが一致", TODAY, LOCAL_TODAY);
      } finally {
        api.restore();
      }
    },
  },
];

function Runner() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const runAll = async () => {
    if (window.__OVERDUEVERIFY_RUNNING__) return;
    window.__OVERDUEVERIFY_RUNNING__ = true;
    window.__OVERDUEVERIFY_RESULT__ = { finished: false };
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
      window.__OVERDUEVERIFY_RESULT__ = {
        finished: true,
        today: TODAY,
        pass: vals.filter((r) => r.pass).length,
        fail: vals.filter((r) => !r.pass).length,
        total: SCENARIOS.length,
        residualNodes: document.getElementById("sandbox").childElementCount,
        scenarios: SCENARIOS.map((s) => ({ id: s.id, name: s.name, pass: collected[s.id]?.pass, actual: collected[s.id]?.actual, detail: collected[s.id]?.detail })),
      };
      window.__OVERDUEVERIFY_RUNNING__ = false;
    }
  };
  useEffect(() => {
    window.__runOverdueVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);
  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>期日超過の状態分け（F-14） 検証ハーネス</h1>
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
