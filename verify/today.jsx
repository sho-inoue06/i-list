// ───────────────────────────────────────────────
// 「今日」を端末日付にする（F-13：期日表示）の検証ハーネス
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない
// （API版のケースでは window.fetch をモックする）。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/today.html
//
// 完成条件 A1〜A8（Notion「Iリスト｜バックログ」F-13）を、ケースIDの先頭で対応づける。
// A8（既存の自動検証とbuild）はこのページの対象外で、既存ハーネスと build で確認する。
//
// 期待値に固定日付を書かない。実行時の端末ローカル日付から前日・当日・翌日を作る
// （基準日を固定する手段を製品にも検証設定にも持たないため）。
// ───────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import IListApp, {
  TODAY, todayStr, parseImportedData, evalCellWith, summarize, approachingNoticeFor,
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
// 基点は検証側で独立に求めた端末ローカル日付（LOCAL_TODAY）にする。
// 製品側の TODAY を基点にすると、TODAY が固定値へ戻っても期待値が一緒にずれて気づけない。
// ずらす計算はUTCで行う（端末のタイムゾーンや夏時間で1日ぶれないため）。
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
const YESTERDAY = shift(-1), TOMORROW = shift(1), NEXT_YEAR = shift(365), LONG_AGO = shift(-3650);
const FAR = shift(3650);                 // 判定を確実に成立／不成立にさせるための遠い日
const TODAY_D = shift(0);                // 当日（検証側が独立に求めた端末ローカル日付）
const STAMP = `${TODAY_D} 10:00`;        // 確定日時も実行時の今日から作る

// ── ダミーデータ（架空。実車・実法規・実認可番号とは無関係） ──
// 継続ランだけを使い、継続車日（kei）＝期日が 前日／当日／翌日／来年 になる4行を作る。
//   A2：前日 → 期日到来（F-14の状態表示では「法規不適合」。ドロップ日は将来＝生産中のため）
//   A4：当日 → 前日と同じ扱い
//   A3：翌日・来年 → 将来日（F-14の状態表示では「要対応｜YYYY/MMまで」）
// ※ 表示の文言は F-14（期日超過の4状態）で置き換わった。ここで確かめるのは
//   「今日」の決め方と境界（前日・当日・翌日）であり、F-13のA1〜A8の意味は変えていない。
const KEI_DUMMY = {
  runs: [
    { key: "r301", typeId: "DEMO-S", gen: "PJ-1", sk: "継", lo: LONG_AGO, drop: FAR },
  ],
  regs: [
    { rid: "g301", id: "REG-PAST",   label: "ダミー法規（期日は前日）", shin: LONG_AGO, kei: YESTERDAY, parent: "" },
    { rid: "g302", id: "REG-TODAY",  label: "ダミー法規（期日は当日）", shin: LONG_AGO, kei: TODAY_D,   parent: "" },
    { rid: "g303", id: "REG-TOMORROW", label: "ダミー法規（期日は翌日）", shin: LONG_AGO, kei: TOMORROW, parent: "" },
    { rid: "g304", id: "REG-NEXTYEAR", label: "ダミー法規（期日は来年）", shin: LONG_AGO, kei: NEXT_YEAR, parent: "" },
  ],
  cert: {},
};

// 実効ドロップ用。型式ごとに認可書実績で手前の法規を塞ぎ、実効日を 前日／当日／翌日 に分ける。
const EFF_DUMMY = {
  runs: [
    { key: "r311", typeId: "DEMO-S", gen: "PJ-1", sk: "継", lo: LONG_AGO, drop: YESTERDAY },
    { key: "r312", typeId: "DEMO-T", gen: "PJ-2", sk: "継", lo: LONG_AGO, drop: TODAY_D },
    { key: "r313", typeId: "DEMO-U", gen: "PJ-3", sk: "継", lo: LONG_AGO, drop: TOMORROW },
  ],
  regs: KEI_DUMMY.regs,
  cert: {
    "DEMO-T": { "REG-PAST": "CK-T-PAST" },
    "DEMO-U": { "REG-PAST": "CK-U-PAST", "REG-TODAY": "CK-U-TODAY" },
  },
};

// 同一性（F-04）の行用。「同一でない」＝新型車日で判定させ、新型車日を 前日／当日／翌日 にする。
// LOは当日にする：新型車日 ≤ LO を満たす前日・当日は kind「新型」で期日＝shin、
// 翌日の行は継続車日（翌日）で要になる。どちらも期日は前日／当日／翌日のまま。
// （F-14で、LOがまだ来ていないランは法規不適合にしない扱いになったため、LOを将来日にしない。）
const SAME_DUMMY = {
  runs: [
    { key: "r321", typeId: "DEMO-V", gen: "PJ-9", sk: "新", lo: TODAY_D, drop: FAR },
    { key: "r322", typeId: "DEMO-W", gen: "PJ-9", sk: "新", lo: TODAY_D, drop: FAR },
  ],
  regs: [
    { rid: "g321", id: "REG-S-PAST",     label: "ダミー法規（新型車日は前日）", shin: YESTERDAY, kei: FAR,      parent: "" },
    { rid: "g322", id: "REG-S-TODAY",    label: "ダミー法規（新型車日は当日）", shin: TODAY_D,   kei: FAR,      parent: "" },
    { rid: "g323", id: "REG-S-TOMORROW", label: "ダミー法規（期日は翌日）",     shin: TOMORROW,  kei: TOMORROW, parent: "" },
  ],
  cert: {},
  bases: [{ runKey: "r322", baseRunKey: "r321", decidedAt: STAMP }],
  sameness: [
    { runKey: "r322", rid: "g321", value: "同一でない", reason: "ダミー：装置を変更", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r321" },
    { runKey: "r322", rid: "g322", value: "同一でない", reason: "ダミー：装置を変更", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r321" },
    { runKey: "r322", rid: "g323", value: "同一でない", reason: "ダミー：装置を変更", decidedAt: STAMP, needsRecheck: false, baseRunKey: "r321" },
  ],
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const fmt = (d) => d.replaceAll("-", "/").slice(0, 7);   // 画面表示（YYYY/MM）と同じ整形

// ── 画面ユーティリティ ──
async function clickByText(container, re) {
  const b = [...container.querySelectorAll("button")].find((x) => re.test(x.textContent));
  if (!b) throw new Error(`ボタンが見つかりません: ${re}`);
  b.click();
  await sleep(10);
}
function cellAt(c, row, col) {
  const tr = c.querySelector("table tbody")?.children[row];
  const td = tr?.children[col + 1];
  if (!td) throw new Error(`帳票のセルがありません: ${row},${col}`);
  return td;
}
const cellText = (c, row, col) => cellAt(c, row, col).textContent;
// Card のタイトル（h3）から、そのカード全体の文字列を拾う（コンプラ漏れ・実効ドロップ）
function cardText(c, title) {
  const h = [...c.querySelectorAll("h3")].find((e) => e.textContent.trim() === title);
  if (!h) throw new Error(`カードが見つかりません: ${title}`);
  return h.parentElement.parentElement.textContent;
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
    id: "A1-today-is-terminal-local-date",
    name: "「今日」は画面を開いた時点の端末ローカル日付になる（固定値を使わない）",
    expect: "TODAY が実行時の端末ローカル日付と一致し、YYYY-MM-DD 形式。todayStr はUTCではなく端末ローカルの暦日を返す",
    async run({ asserts }) {
      const now = new Date();
      const p = (n) => String(n).padStart(2, "0");
      const localNow = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
      asserts.check("TODAY は実行時の端末ローカル日付", TODAY, localNow);
      asserts.checkTrue("YYYY-MM-DD 形式", /^\d{4}-\d{2}-\d{2}$/.test(TODAY));
      asserts.check("todayStr も同じ値を返す", todayStr(), localNow);
      // 端末ローカルの暦日であることの確認（UTC整形なら、日本時間では前日・同日にずれる）
      asserts.check("深夜0:30は当日", todayStr(new Date(2031, 0, 1, 0, 30)), "2031-01-01");
      asserts.check("23:45も当日", todayStr(new Date(2031, 11, 31, 23, 45)), "2031-12-31");
      asserts.check("1桁の月日は0詰め", todayStr(new Date(2031, 8, 5, 12, 0)), "2031-09-05");
      asserts.check("相対日付の作り方（前日・翌日）", [shift(-1, "2031-03-01"), shift(1, "2031-02-28")], ["2031-02-28", "2031-03-01"]);
    },
  },
  {
    id: "A2A3A4-matrix-cell",
    name: "帳票セル：期日が前日・当日なら期日到来、翌日以降は将来日の表示（文言はF-14の4状態）",
    expect: "前日・当日の行は「法規不適合」、翌日・来年の行は「要対応｜YYYY/MMまで」。いずれも申請発生のまま",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, KEI_DUMMY);
      asserts.checkTrue("前日は期日到来（法規不適合）", cellText(c, 0, 0).includes("法規不適合"));
      asserts.checkTrue("当日も期日到来（A4）", cellText(c, 1, 0).includes("法規不適合"));
      asserts.checkTrue("翌日は将来日のまま", cellText(c, 2, 0).includes(`要対応｜${fmt(TOMORROW)}まで`));
      asserts.checkTrue("翌日は期日到来にしない", !cellText(c, 2, 0).includes("法規不適合"));
      asserts.checkTrue("来年も将来日のまま", cellText(c, 3, 0).includes(`要対応｜${fmt(NEXT_YEAR)}まで`));
      asserts.check("4行とも申請発生のまま（A5）",
        [0, 1, 2, 3].map((r) => cellText(c, r, 0).includes("申請発生")), [true, true, true, true]);
    },
  },
  {
    id: "A2A3A4-leak-list",
    name: "コンプラ漏れ一覧：期日が前日・当日なら期日到来、翌日以降は将来日（文言はF-14の4状態）",
    expect: "一覧に4件出て、前日・当日が法規不適合、翌日・来年が 要対応｜YYYY/MMまで",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, KEI_DUMMY);
      const t = cardText(c, "コンプラ漏れ（自動検出）");
      asserts.check("法規不適合は2件（前日・当日）", (t.match(/法規不適合/g) || []).length, 2);
      asserts.checkTrue("REG-PAST は法規不適合", /REG-PAST継続\s*法規不適合/.test(t));
      asserts.checkTrue("REG-TODAY は法規不適合（A4）", /REG-TODAY継続\s*法規不適合/.test(t));
      asserts.checkTrue("REG-TOMORROW は要対応", t.includes(`REG-TOMORROW継続 要対応｜${fmt(TOMORROW)}まで`));
      asserts.checkTrue("REG-NEXTYEAR は要対応", t.includes(`REG-NEXTYEAR継続 要対応｜${fmt(NEXT_YEAR)}まで`));
    },
  },
  {
    id: "A2A3A4-effective-drop",
    name: "実効ドロップ一覧：実効日が前日・当日なら既発効、翌日は日付表示",
    expect: "DEMO-S（前日）・DEMO-T（当日）は「実効 既発効」、DEMO-U（翌日）は「実効 YYYY/MM」",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, EFF_DUMMY);
      const t = cardText(c, "実効ドロップ（規制で縛られる期限）");
      asserts.check("実効日の内訳（純関数）",
        summarize(EFF_DUMMY.runs, EFF_DUMMY.regs, EFF_DUMMY.cert).effDrop,
        { r311: YESTERDAY, r312: TODAY_D, r313: TOMORROW });
      asserts.check("既発効は2件（前日・当日）", (t.match(/既発効/g) || []).length, 2);
      asserts.checkTrue("DEMO-S（前日）は既発効", /DEMO-S（PJ-1）\s*実効 既発効/.test(t));
      asserts.checkTrue("DEMO-T（当日）も既発効（A4）", /DEMO-T（PJ-2）\s*実効 既発効/.test(t));
      asserts.checkTrue("DEMO-U（翌日）は日付表示", t.includes(`DEMO-U（PJ-3） 実効 ${fmt(TOMORROW)}`));
    },
  },
  {
    id: "A2A3A4-sameness-overdue",
    name: "同一性の行：同一でないで新型車日が前日・当日なら法規不適合、翌日は要対応（F-14で「期限超過」は廃止）",
    expect: "DEMO-W の3セルで、前日・当日が法規不適合、翌日が要対応。どのセルにも「期限超過」は出ない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, SAME_DUMMY);
      const col = 1;   // DEMO-W（比較元を選んだ側）
      asserts.checkTrue("前日は法規不適合", cellText(c, 0, col).includes("法規不適合"));
      asserts.checkTrue("当日も法規不適合（A4）", cellText(c, 1, col).includes("法規不適合"));
      asserts.checkTrue("翌日は法規不適合にしない", !cellText(c, 2, col).includes("法規不適合"));
      asserts.checkTrue("翌日は要対応", cellText(c, 2, col).includes(`要対応｜${fmt(TOMORROW)}まで`));
      asserts.check("3セルとも「期限超過」を使わない",
        [0, 1, 2].map((r) => cellText(c, r, col).includes("期限超過")), [false, false, false]);
      asserts.check("3セルとも同一性：同一でない のまま",
        [0, 1, 2].map((r) => cellText(c, r, col).includes("同一でない")), [true, true, true]);
      asserts.check("比較元を選んでいない列には同一性の行そのものが出ない",
        [0, 1, 2].map((r) => cellText(c, r, 0).includes("同一性")), [false, false, false]);
    },
  },
  {
    id: "A5-judgement-unchanged",
    name: "要／否・申請発生の判定、黄色の30日接近予告、要再確認は変わらない",
    expect: "evalCellWith の戻り値は今日と無関係。黄色予告はドロップ日と継続車日だけで決まり、要再確認も変わらない",
    async run({ mount, asserts }) {
      // 判定式は「今日」を参照しない（期日が前日・当日・翌日でも、要否・種別・期日は同じ形）
      const run = KEI_DUMMY.runs[0];
      asserts.check("前日の期日（判定）", evalCellWith({}, run, KEI_DUMMY.regs[0]),
        { required: true, kind: "継続", ck: null, status: "leak", dueDate: YESTERDAY, applied: "" });
      asserts.check("当日の期日（判定）", evalCellWith({}, run, KEI_DUMMY.regs[1]),
        { required: true, kind: "継続", ck: null, status: "leak", dueDate: TODAY_D, applied: "" });
      asserts.check("翌日の期日（判定）", evalCellWith({}, run, KEI_DUMMY.regs[2]),
        { required: true, kind: "継続", ck: null, status: "leak", dueDate: TOMORROW, applied: "" });
      // 黄色の30日接近予告：ドロップ日と継続車日の差だけで決まる（今日と無関係）
      const near = { rid: "g331", id: "REG-NEAR", label: "ダミー法規（接近予告）", shin: FAR, kei: shift(10), parent: "" };
      const offRun = { ...run, drop: TODAY_D };
      asserts.check("今日の周辺でも10日で予告", approachingNoticeFor("off", offRun, near), { days: 10, keiDate: near.kei });
      asserts.check("遠い過去でも同じ日数で予告",
        approachingNoticeFor("off", { ...run, drop: shift(-3650) }, { ...near, kei: shift(-3640) }), { days: 10, keiDate: shift(-3640) });
      asserts.check("申請発生のセルには予告を出さない（従来どおり）", approachingNoticeFor("leak", offRun, near), null);
      // 同一性の要再確認は期日と無関係（法規不適合が出るセルでも出ないセルでも同じ）
      const c = await mountWith(mount, SAME_DUMMY);
      asserts.check("3セルとも要再確認なしのまま",
        [0, 1, 2].map((r) => cellText(c, r, 1).includes("要再確認")), [false, false, false]);
    },
  },
  {
    id: "A6-api-and-standalone",
    name: "API版・単体HTML版で同じ「今日」を使う",
    expect: "同じダミーデータで、両方の帳票セルが前日・当日＝法規不適合、翌日＝要対応 で一致する",
    async run({ mount, mountApi, asserts }) {
      const cs = await mountWith(mount, KEI_DUMMY);
      const api = installApiMock(clone({ runs: KEI_DUMMY.runs, regs: KEI_DUMMY.regs, cert: KEI_DUMMY.cert }));
      let ca;
      try {
        ca = mountApi().container;
        await sleep(120);
        // 期日の表示だけを抜き出して比べる（列の他の文言に影響されないため）
        const DUE = /法規不適合|要対応｜\d{4}\/\d{2}まで/;
        const read = (c) => [0, 1, 2, 3].map((r) => (cellText(c, r, 0).match(DUE) || [""])[0]);
        const sa = read(cs), aa = read(ca);
        asserts.check("単体版の4行", sa, ["法規不適合", "法規不適合", `要対応｜${fmt(TOMORROW)}まで`, `要対応｜${fmt(NEXT_YEAR)}まで`]);
        asserts.check("API版も同じ", aa, sa);
      } finally {
        api.restore();
      }
    },
  },
  {
    id: "A7-no-base-date-anywhere",
    name: "基準日を固定する手段を、画面にも保存データにも持たない",
    expect: "書き出したJSONのキーは runs/regs/cert/decisions/bases/sameness だけ。画面に基準日の入力欄がない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, SAME_DUMMY);
      const snap = await snapshotAll(c);
      asserts.check("保存データのキー", Object.keys(snap).sort(),
        ["bases", "cert", "decisions", "regs", "runs", "sameness"]);
      const labels = [...c.querySelectorAll("input,select,textarea")].map((e) => e.getAttribute("aria-label") || "");
      asserts.check("基準日・今日の入力欄がない", labels.filter((l) => /基準日|今日/.test(l)), []);
      asserts.checkTrue("画面に『基準日』の文字がない", !c.textContent.includes("基準日"));
      // 検証側の期待値も実行時の端末ローカル日付から作っている（固定日付を書いていない）
      asserts.check("ダミーの期日は実行時の今日から作った相対日付",
        KEI_DUMMY.regs.map((r) => r.kei), [shift(-1), shift(0), shift(1), shift(365)]);
    },
  },
];

function Runner() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const runAll = async () => {
    if (window.__TODAYVERIFY_RUNNING__) return;
    window.__TODAYVERIFY_RUNNING__ = true;
    window.__TODAYVERIFY_RESULT__ = { finished: false };
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
      window.__TODAYVERIFY_RESULT__ = {
        finished: true,
        today: TODAY,
        pass: vals.filter((r) => r.pass).length,
        fail: vals.filter((r) => !r.pass).length,
        total: SCENARIOS.length,
        residualNodes: document.getElementById("sandbox").childElementCount,
        scenarios: SCENARIOS.map((s) => ({ id: s.id, name: s.name, pass: collected[s.id]?.pass, actual: collected[s.id]?.actual, detail: collected[s.id]?.detail })),
      };
      window.__TODAYVERIFY_RUNNING__ = false;
    }
  };
  useEffect(() => {
    window.__runTodayVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);
  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>「今日」を端末日付にする（F-13） 検証ハーネス</h1>
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
