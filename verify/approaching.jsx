// ───────────────────────────────────────────────
// 黄色の30日接近予告から過去分を除く（F-15）の検証ハーネス
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない
// （API版のケースでは window.fetch をモックする）。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/approaching.html
//
// 完成条件 B1〜B7（Notion「Iリスト｜バックログ」F-15）を、ケースIDの先頭で対応づける。
// B7（既存の自動検証とbuild）はこのページの対象外で、既存ハーネスと build で確認する。
//
// 期待値に固定日付を書かない。実行時の端末ローカル日付から前日・当日・翌日を作る
// （基準日を固定する手段を製品にも検証設定にも持たないため）。
// ───────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import IListApp, {
  TODAY, parseImportedData, evalCellWith, complianceStateOf,
  approachingKeiDays, approachingNoticeFor, condOf,
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
const STAMP = `${TODAY_D} 10:00`;
const fmt = (d) => d.replaceAll("-", "/").slice(0, 7);   // 画面表示（YYYY/MM）と同じ整形

// 実在しない日付（例：2月30日）を拒むことの確認用。
// 「日付が読めないからnull」なのか「窓の外だからnull」なのかを区別できるように作る：
//   ・必ず将来の年の 2月30日 にする（F-15のゲートで消えたのではないことを分けるため）
//   ・仮に繰り上がって 3/1〜3/2 と解釈されてしまった場合、dropとの差が9〜10日＝窓の中に入る位置にdropを置く
// つまり実在性チェックが外れていれば、この組み合わせは null ではなく予告を返すようになる。
const FUTURE_YEAR = Number(shift(400).slice(0, 4));      // 端末日付がいつでも必ず将来の年
const INVALID_KEI = `${FUTURE_YEAR}-02-30`;              // 実在しない日付
const INVALID_KEI_DROP = `${FUTURE_YEAR}-02-20`;         // 繰り上がると差は9〜10日（窓の中）
// 繰り上がった場合の解釈（うるう年なら3/1、それ以外は3/2）。陽性対照に使う。
const INVALID_KEI_ROLLED = (() => {
  const t = new Date(Date.UTC(FUTURE_YEAR, 1, 30)), p = (n) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
})();
const clone = (o) => JSON.parse(JSON.stringify(o));

// 画面に出る黄色の文言（検証側で独立に書き、製品の定数を借りない）
const noticeText = (days, kei) => `継続規制まで${days}日（${fmt(kei)}・延長時は再確認）`;
const AMBER_RGB = "rgb(224, 178, 77)", LINE_RGB = "rgb(34, 48, 63)";
const RED_RGB = "rgb(255, 107, 87)", ORANGE_RGB = "rgb(255, 159, 67)", GRAY_RGB = "rgb(154, 171, 189)";

// ── ダミーデータ（架空。実車・実法規・実認可番号とは無関係） ──
// 継続ランだけを使う（継続ランは 要⇔継続車日 ≤ drop なので、継続車日 > drop のセルが必ず「否」になる）。
// 列＝drop の位置、行＝継続車日の位置。黄色の窓は「継続車日 − drop日 が1〜30日」。
//   DEMO-A drop=2日前   … 行ごとの差は 1・2・3日（すべて窓の中）
//   DEMO-B drop=31日前  … 差は 30・31・32日（先頭行だけ窓の中。ただし継続車日は前日＝過去）
//   DEMO-C drop=29日前  … 差は 28・29・30日（翌日の行がちょうど30日＝窓の上限）
//   DEMO-D drop=30日前  … 差は 29・30・31日（翌日の行が31日＝窓の外）
//   DEMO-E drop=遠い将来 … 継続車日 ≤ drop で「要」になる側（黄色ではなく赤・橙の確認用）
// ※「継続車日 − drop日 = 0」（同日）は、要否の式で必ず「要」になるためセルが黄色の対象にならない。
//    0日の境界は純関数（B1B3B6-pure）で確認する。
const APPROACH_DUMMY = {
  runs: [
    { key: "r501", typeId: "DEMO-A", gen: "PJ-A", sk: "継", lo: LONG_AGO, drop: shift(-2) },
    { key: "r502", typeId: "DEMO-B", gen: "PJ-B", sk: "継", lo: LONG_AGO, drop: shift(-31) },
    { key: "r503", typeId: "DEMO-C", gen: "PJ-C", sk: "継", lo: LONG_AGO, drop: shift(-29) },
    { key: "r504", typeId: "DEMO-D", gen: "PJ-D", sk: "継", lo: LONG_AGO, drop: shift(-30) },
    { key: "r505", typeId: "DEMO-E", gen: "PJ-E", sk: "継", lo: LONG_AGO, drop: FAR },
  ],
  regs: [
    { rid: "g501", id: "REG-Y", label: "ダミー法規（継続車日は前日）", shin: LONG_AGO, kei: YESTERDAY, parent: "" },
    { rid: "g502", id: "REG-T", label: "ダミー法規（継続車日は当日）", shin: LONG_AGO, kei: TODAY_D,   parent: "" },
    { rid: "g503", id: "REG-M", label: "ダミー法規（継続車日は翌日）", shin: LONG_AGO, kei: TOMORROW,  parent: "" },
    { rid: "g504", id: "REG-O", label: "ダミー法規（継続車日は遠い過去）", shin: LONG_AGO, kei: LONG_AGO, parent: "" },
  ],
  cert: {},
};
const COL = { r501: 0, r502: 1, r503: 2, r504: 3, r505: 4 };
const ROW = { g501: 0, g502: 1, g503: 2, g504: 3 };

// 人の適用判断つき（B4：判断の保存値・要再確認が変わらないことの確認用）
const judgeCond = (runKey, rid) => condOf(
  APPROACH_DUMMY.runs.find((r) => r.key === runKey),
  APPROACH_DUMMY.regs.find((r) => r.rid === rid),
  APPROACH_DUMMY.regs);
const JUDGE_DUMMY = {
  ...APPROACH_DUMMY,
  decisions: [
    { runKey: "r501", rid: "g503", state: "対象外", reason: "ダミー：黄色セルを対象外と判断",
      decidedAt: STAMP, needsRecheck: false, cond: judgeCond("r501", "g503") },
    { runKey: "r505", rid: "g501", state: "対象",   reason: "ダミー：申請発生セルを対象と判断",
      decidedAt: STAMP, needsRecheck: false, cond: judgeCond("r505", "g501") },
  ],
};

// ── 画面ユーティリティ ──
function cellAt(c, row, col) {
  const tr = c.querySelector("table tbody")?.children[row];
  const td = tr?.children[col + 1];
  if (!td) throw new Error(`帳票のセルがありません: ${row},${col}`);
  return td;
}
const cellText = (c, row, col) => cellAt(c, row, col).textContent;
const cellBorder = (c, row, col) => getComputedStyle(cellAt(c, row, col).querySelector("div")).borderTopColor;
// セル内で、その文言を表示している span の文字色（F-14の状態名の色を見るため）
const labelColor = (c, row, col, label) => {
  const el = [...cellAt(c, row, col).querySelectorAll("span")].find((s) => s.textContent.trim() === label);
  return el ? el.style.color : "(見つかりません)";
};
// セルに出ている黄色の残日数（出ていなければ null）
const noticeDays = (c, row, col) => {
  const m = cellText(c, row, col).match(/継続規制まで(\d+)日/);
  return m ? Number(m[1]) : null;
};
// 行ぶんの残日数（列は左から）
const noticeRow = (c, row) => [0, 1, 2, 3, 4].map((col) => noticeDays(c, row, col));

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
    id: "B1B3B6-pure",
    name: "純関数の境界：継続車日が前日・当日・翌日 × 差が0・1・30・31日",
    expect: "予告が出るのは「継続車日 > 今日」かつ「差が1〜30日」のときだけ。当日ちょうどは出さない（既発効側）",
    async run({ asserts }) {
      // 継続車日の位置（3通り）× 差（4通り）。dropは「継続車日 − 差」で作る。
      const notice = (kei, diff) =>
        approachingNoticeFor("off", { drop: shift(-diff, kei) }, { kei });
      const daysOf = (kei, diff) => { const n = notice(kei, diff); return n ? n.days : null; };
      const row = (kei) => [0, 1, 30, 31].map((d) => daysOf(kei, d));
      asserts.check("継続車日=前日（差 0/1/30/31）", row(YESTERDAY), [null, null, null, null]);
      asserts.check("継続車日=当日（差 0/1/30/31）", row(TODAY_D), [null, null, null, null]);
      asserts.check("継続車日=翌日（差 0/1/30/31）", row(TOMORROW), [null, 1, 30, null]);
      asserts.check("翌日・差1日の中身", notice(TOMORROW, 1), { days: 1, keiDate: TOMORROW });
      asserts.check("翌日・差30日の中身", notice(TOMORROW, 30), { days: 30, keiDate: TOMORROW });
      // 再現条件（Notionの「再現条件」そのもの）：継続車日＝今日・drop＝前日
      asserts.check("再現条件（継続車日=今日・drop=前日）は予告なし",
        approachingNoticeFor("off", { drop: YESTERDAY }, { kei: TODAY_D }), null);
      // 遠い過去の組み合わせ（窓は満たすが、とっくに過ぎている）
      asserts.check("遠い過去の組み合わせも予告なし",
        approachingNoticeFor("off", { drop: shift(-3651) }, { kei: LONG_AGO }), null);
      // これから先の組み合わせは従来どおり出る（B3）
      asserts.check("遠い将来の組み合わせは従来どおり予告あり",
        approachingNoticeFor("off", { drop: shift(-10, FAR) }, { kei: FAR }), { days: 10, keiDate: FAR });
      // 既存の扱いは変えない：off 以外のセル・読めない日付には出さない
      asserts.check("申請発生のセルには出さない", approachingNoticeFor("leak", { drop: TODAY_D }, { kei: shift(10) }), null);
      asserts.check("認可書ありのセルには出さない", approachingNoticeFor("ok", { drop: TODAY_D }, { kei: shift(10) }), null);
      asserts.check("dropが空なら出さない", approachingNoticeFor("off", { drop: "" }, { kei: shift(10) }), null);
      asserts.check("継続車日が空なら出さない", approachingNoticeFor("off", { drop: TODAY_D }, { kei: "" }), null);
      // 実在しない日付。繰り上がって解釈されれば窓の中（9〜10日）に入る組み合わせなので、
      // 実在性チェックが外れていればここは null にならない（＝この期待値は素通りしない）。
      asserts.check("陽性対照：繰り上がった日付なら窓の中で予告が出る",
        approachingNoticeFor("off", { drop: INVALID_KEI_DROP }, { kei: INVALID_KEI_ROLLED }),
        { days: approachingKeiDays(INVALID_KEI_DROP, INVALID_KEI_ROLLED), keiDate: INVALID_KEI_ROLLED });
      asserts.checkTrue("陽性対照の差は窓の中（1〜30日）",
        approachingKeiDays(INVALID_KEI_DROP, INVALID_KEI_ROLLED) >= 1 && approachingKeiDays(INVALID_KEI_DROP, INVALID_KEI_ROLLED) <= 30);
      asserts.check("継続車日が実在しない日付なら出さない",
        approachingNoticeFor("off", { drop: INVALID_KEI_DROP }, { kei: INVALID_KEI }), null);
      asserts.check("dropが実在しない日付でも出さない",
        approachingNoticeFor("off", { drop: INVALID_KEI }, { kei: shift(10, INVALID_KEI_ROLLED) }), null);
      // 「今日」は引数で差し替えられる（既定は製品のTODAY）。基準日をUIや保存データへ持たせるものではない。
      asserts.check("todayを翌日にすると翌日の予告も消える",
        approachingNoticeFor("off", { drop: shift(-1, TOMORROW) }, { kei: TOMORROW }, TOMORROW), null);
      asserts.check("todayが読めないときは出さない",
        approachingNoticeFor("off", { drop: shift(-1, TOMORROW) }, { kei: TOMORROW }, ""), null);
    },
  },
  {
    id: "B2-window-unchanged",
    name: "窓の判定（継続車日 − drop日 が1〜30日）そのものは変えていない",
    expect: "approachingKeiDays は今日を見ない。過去の組み合わせでも1〜30日ならその日数を返し、0日・31日はnullのまま",
    async run({ asserts }) {
      const win = (kei, diff) => approachingKeiDays(shift(-diff, kei), kei);
      const row = (kei) => [0, 1, 30, 31].map((d) => win(kei, d));
      asserts.check("継続車日=前日でも窓は生きている", row(YESTERDAY), [null, 1, 30, null]);
      asserts.check("継続車日=当日でも同じ", row(TODAY_D), [null, 1, 30, null]);
      asserts.check("継続車日=翌日でも同じ", row(TOMORROW), [null, 1, 30, null]);
      asserts.check("遠い過去でも窓は同じ日数を返す", approachingKeiDays(shift(-3660), LONG_AGO), 10);
      asserts.check("同日（0日）は従来どおり対象外", approachingKeiDays(TODAY_D, TODAY_D), null);
      asserts.check("ドロップ日より前（負数）も対象外", approachingKeiDays(TODAY_D, YESTERDAY), null);
      asserts.check("31日は従来どおり対象外", approachingKeiDays(shift(-31, TOMORROW), TOMORROW), null);
      // 窓の側でも実在しない日付を拒む。繰り上がれば窓の中に入る組み合わせで確かめる。
      asserts.check("読めない日付は従来どおりnull",
        [approachingKeiDays("", TOMORROW), approachingKeiDays(INVALID_KEI_DROP, INVALID_KEI)], [null, null]);
      asserts.checkTrue("陽性対照：繰り上がれば窓の中",
        approachingKeiDays(INVALID_KEI_DROP, INVALID_KEI_ROLLED) !== null);
    },
  },
  {
    id: "B1-screen-past",
    name: "画面：継続車日が今日以前のランには黄色の予告が出ない",
    expect: "継続車日＝前日・当日の行は全列で予告なし。セルは「否」のままで、枠も黄色にならない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, APPROACH_DUMMY);
      asserts.check("継続車日=前日の行（全5列）", noticeRow(c, ROW.g501), [null, null, null, null, null]);
      asserts.check("継続車日=当日の行（全5列）", noticeRow(c, ROW.g502), [null, null, null, null, null]);
      // 窓（1〜30日）は満たしているのに出ないこと＝過去分だけを外している
      asserts.check("窓は満たしている（前日の行・純関数）",
        [0, 1, 2, 3].map((i) => approachingKeiDays(APPROACH_DUMMY.runs[i].drop, YESTERDAY)), [1, 30, 28, 29]);
      asserts.checkTrue("否のまま（要再確認にならない）", !cellText(c, ROW.g501, COL.r501).includes("要再確認"));
      asserts.checkTrue("「否」と出ている", cellText(c, ROW.g501, COL.r501).includes("否"));
      asserts.check("枠は黄色ではない", cellBorder(c, ROW.g501, COL.r501), LINE_RGB);
      asserts.check("当日の行の枠も黄色ではない", cellBorder(c, ROW.g502, COL.r501), LINE_RGB);
    },
  },
  {
    id: "B3B6-screen-future",
    name: "画面：継続車日がこれからで窓を満たすランは従来どおり黄色と残日数を出す",
    expect: "継続車日＝翌日の行で、差3日・差30日の列だけ黄色になり残日数が出る。差31日・32日は出ない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, APPROACH_DUMMY);
      // 列の差： DEMO-A=3日 / DEMO-B=32日 / DEMO-C=30日 / DEMO-D=31日 / DEMO-E=要（黄色の対象外）
      asserts.check("継続車日=翌日の行（全5列）", noticeRow(c, ROW.g503), [3, null, 30, null, null]);
      // 枠の色：黄色は「否」のセルだけ。申請発生（DEMO-E）の枠は従来どおり赤のまま
      asserts.check("枠の色（全5列）",
        [0, 1, 2, 3, 4].map((col) => cellBorder(c, ROW.g503, col)),
        [AMBER_RGB, LINE_RGB, AMBER_RGB, LINE_RGB, RED_RGB]);
      asserts.checkTrue("予告文（差3日）", cellText(c, ROW.g503, COL.r501).includes(noticeText(3, TOMORROW)));
      asserts.checkTrue("予告文（差30日＝窓の上限）", cellText(c, ROW.g503, COL.r503).includes(noticeText(30, TOMORROW)));
      asserts.checkTrue("「否・要再確認」の表示も従来どおり", cellText(c, ROW.g503, COL.r501).includes("否・要再確認"));
      asserts.checkTrue("差31日には出ない", !cellText(c, ROW.g503, COL.r504).includes("継続規制まで"));
      asserts.checkTrue("差32日にも出ない", !cellText(c, ROW.g503, COL.r502).includes("継続規制まで"));
    },
  },
  {
    id: "B4-others-unchanged",
    name: "要否・申請発生の判定、赤・橙・灰の表示、人の適用判断、要再確認を変えない",
    expect: "evalCellWith の戻り値と complianceStateOf の状態は従来どおり。判断の保存値も要再確認も増えない",
    async run({ mount, asserts }) {
      const R = APPROACH_DUMMY.runs, G = APPROACH_DUMMY.regs;
      // 要否判定は「今日」を見ない（黄色のゲートは判定式の外側）
      asserts.check("継続車日 > drop は否", evalCellWith({}, R[0], G[2]),
        { required: false, kind: "", ck: null, status: "off", dueDate: TOMORROW, applied: "" });
      asserts.check("継続車日 ≤ drop は申請発生", evalCellWith({}, R[4], G[0]),
        { required: true, kind: "継続", ck: null, status: "leak", dueDate: YESTERDAY, applied: "" });
      asserts.check("黄色セルの判定も否のまま", evalCellWith({}, R[2], G[2]).status, "off");
      // F-14の状態分け（赤・橙・灰）は変わらない
      const c = await mountWith(mount, APPROACH_DUMMY);
      asserts.checkTrue("生産中・期日到来は赤「法規不適合」", cellText(c, ROW.g501, COL.r505).includes("法規不適合"));
      asserts.check("赤の色", cellBorder(c, ROW.g501, COL.r505), RED_RGB);
      asserts.check("赤の状態名の色", labelColor(c, ROW.g501, COL.r505, "法規不適合"), RED_RGB);
      asserts.checkTrue("期日がこれからは橙「要対応」", cellText(c, ROW.g503, COL.r505).includes(`要対応｜${fmt(TOMORROW)}まで`));
      asserts.check("橙の状態名の色", labelColor(c, ROW.g503, COL.r505, `要対応｜${fmt(TOMORROW)}まで`), ORANGE_RGB);
      asserts.checkTrue("drop済みは灰「過去に法規不適合（drop済み）」", cellText(c, ROW.g504, COL.r501).includes("過去に法規不適合（drop済み）"));
      asserts.check("灰の状態名の色", labelColor(c, ROW.g504, COL.r501, "過去に法規不適合（drop済み）"), GRAY_RGB);
      // 人の適用判断・要再確認・保存データは変わらない
      const cj = await mountWith(mount, JUDGE_DUMMY);
      const snap = await snapshotAll(cj);
      asserts.check("保存データのキー", Object.keys(snap).sort(), ["bases", "cert", "decisions", "regs", "runs", "sameness"]);
      asserts.check("判断は読み込んだままの値", snap.decisions, JUDGE_DUMMY.decisions);
      asserts.check("要再確認は増えない", snap.decisions.filter((d) => d.needsRecheck).length, 0);
      asserts.checkTrue("画面にも要再確認は出ない", !cellText(cj, ROW.g501, COL.r501).includes("要再確認"));
      asserts.check("runs・regsは読み込んだまま", [snap.runs, snap.regs], [JUDGE_DUMMY.runs, JUDGE_DUMMY.regs]);
    },
  },
  {
    id: "B5-api-and-standalone",
    name: "API版・単体HTML版で黄色の出方が一致する",
    expect: "同じダミーデータで、両方の帳票の残日数が3行×5列とも一致する",
    async run({ mount, mountApi, asserts }) {
      const cs = await mountWith(mount, APPROACH_DUMMY);
      const api = installApiMock(clone({ runs: APPROACH_DUMMY.runs, regs: APPROACH_DUMMY.regs, cert: APPROACH_DUMMY.cert }));
      let ca;
      try {
        ca = mountApi().container;
        await sleep(160);
        const read = (c) => [ROW.g501, ROW.g502, ROW.g503].map((row) => noticeRow(c, row));
        const sa = read(cs), aa = read(ca);
        asserts.check("単体版の3行", sa, [
          [null, null, null, null, null],
          [null, null, null, null, null],
          [3, null, 30, null, null],
        ]);
        asserts.check("API版も同じ", aa, sa);
        asserts.check("PUTは発生していない（読込のみ）", api.puts.length, 0);
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
    if (window.__APPROACHVERIFY_RUNNING__) return;
    window.__APPROACHVERIFY_RUNNING__ = true;
    window.__APPROACHVERIFY_RESULT__ = { finished: false };
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
      window.__APPROACHVERIFY_RESULT__ = {
        finished: true,
        today: TODAY,
        pass: vals.filter((r) => r.pass).length,
        fail: vals.filter((r) => !r.pass).length,
        total: SCENARIOS.length,
        residualNodes: document.getElementById("sandbox").childElementCount,
        scenarios: SCENARIOS.map((s) => ({ id: s.id, name: s.name, pass: collected[s.id]?.pass, actual: collected[s.id]?.actual, detail: collected[s.id]?.detail })),
      };
      window.__APPROACHVERIFY_RUNNING__ = false;
    }
  };
  useEffect(() => {
    window.__runApproachVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);
  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>黄色の30日接近予告から過去分を除く（F-15） 検証ハーネス</h1>
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
