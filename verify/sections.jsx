// ───────────────────────────────────────────────
// 危険一覧の区分見出し・並び・開閉（F-27）の検証ハーネス
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない
// （API版のケースでは window.fetch をモックする）。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/sections.html
//
// 完成条件 A1〜A7・B1〜B6（docs/current-task.md の F-27）を、ケースIDの先頭で対応づける。
// 保存HTMLを実ファイルで開き直す確認（B1の保存HTML・B2）は verify/sections-file.mjs が行う。
// 期待値に固定日付を書かない。実行時の端末ローカル日付から相対日付を作る。
// ───────────────────────────────────────────────
import React from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import IListApp, {
  TODAY, parseImportedData, riskRunRows, riskSections, buildCellModel, makeSamenessContext, condOf, RISK_KINDS,
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
const K = { 不適合: "期限超過", 期限前: "期限前・未取得", 予告: "黄色予告" };
const L_COUNT = (runs, cells) => `${runs} ラン・${cells} 件`;
const L_NONE = "危険な型式ランはありません。";
const L_MISSING = "drop未入力（LO済み）";
const L_PLANNED = "計画済み";
const L_EXEMPT = "対象外（判断済み）";

// ── ダミーデータ（架空。実車・実法規・実認可番号とは無関係） ──
// すべて継続ラン（要 ⇔ 継続車規制日 ≤ drop）。並べ替えが効いていることを見るため、
// **ランも法規も元の並びを切迫順と別にしてある**。
//
//   r1 TYPE-A / PJ-X / 生産中      … REG-OVER 期限超過100日 ＋ 期限前 15・50・50日     → 2区分にまたがる
//   r2 TYPE-B / PJ-Y / 生産中      … REG-OVER 期限超過30日（期限＝LO）＋ REG-K15 黄色予告   → 2区分にまたがる
//   r3 TYPE-C / PJ-X / drop未入力   … REG-OVER 期限超過10日（期限＝LO）＋ 期限前 15・50・50日 ＋ drop未入力の別枠
//   r4 TYPE-D / PJ-Z / drop済み     … どの区分にも出ない
//   r5 TYPE-E / PJ-X / 開発中      … 期限前 20・20（REG-OVER と REG-K15 の期限がどちらもLO）・50・50日
//   r6 TYPE-F / PJ-Z / 生産中      … 全法規に実績あり。どの区分にも出ない
//   r7 TYPE-G / PJ-X / drop未入力   … 全法規に実績あり。drop未入力の別枠にだけ出る（drop未入力だけのラン）
const LONG_AGO = shift(-3650), FAR = shift(3650);
const run = (key, typeId, gen, lo, drop) => ({ key, typeId, gen, sk: "継", lo, drop });
const reg = (rid, id, kei) => ({ rid, id, label: "ダミー法規", shin: LONG_AGO, kei, parent: "" });
const RUNS = [
  run("r5", "TYPE-E", "PJ-X", shift(20), FAR),
  run("r3", "TYPE-C", "PJ-X", shift(-10), ""),
  run("r2", "TYPE-B", "PJ-Y", shift(-30), shift(5)),
  run("r7", "TYPE-G", "PJ-X", shift(-5), ""),
  run("r1", "TYPE-A", "PJ-X", LONG_AGO, FAR),
  run("r4", "TYPE-D", "PJ-Z", LONG_AGO, shift(-1)),
  run("r6", "TYPE-F", "PJ-Z", LONG_AGO, FAR),
];
const REGS = [
  reg("g3", "REG-K50", shift(50)),
  reg("g1", "REG-OVER", shift(-100)),
  reg("g4", "REG-K50B", shift(50)),
  reg("g2", "REG-K15", shift(15)),
];
const certAll = (runKey) => REGS.map((g) => ({ runKey, rid: g.rid, ck: `CK-${runKey}-${g.rid}`, planned: false }));
const MAIN = { schemaVersion: 2, runs: RUNS, regs: REGS, cert: [...certAll("r6"), ...certAll("r7")], decisions: [], bases: [], sameness: [] };
const clone = (o) => JSON.parse(JSON.stringify(o));
const withPlan = (d, pairs) => {
  const x = clone(d);
  for (const [runKey, rid] of pairs) x.cert.push({ runKey, rid, ck: "", planned: true });
  return x;
};

// 期待する区分（日数は上のコメントの通り）。[型式, [法規…]] の並び。
const WANT = {
  不適合: [["TYPE-A", ["REG-OVER"]], ["TYPE-B", ["REG-OVER"]], ["TYPE-C", ["REG-OVER"]]],
  // TYPE-C と TYPE-A は先頭がどちらも15日・未計画 → 元の並び（r3 が r1 より前）。TYPE-E は 20日なので後ろ。
  // TYPE-E の中の 20日どうし（REG-OVER・REG-K15）は法規の元の並び（g1 が g2 より前）。
  期限前: [["TYPE-C", ["REG-K15", "REG-K50", "REG-K50B"]], ["TYPE-A", ["REG-K15", "REG-K50", "REG-K50B"]],
           ["TYPE-E", ["REG-OVER", "REG-K15", "REG-K50", "REG-K50B"]]],
  予告: [["TYPE-B", ["REG-K15"]]],
};

// 単体版と同じ入口（F-23の前例・取得予定つき）でモデルを作る
function modelOf(d) {
  const p = parseImportedData(clone(d));
  if (!p.ok) throw new Error("ダミーデータが不正です: " + p.error);
  const { runs, regs, cert, decisions, bases, sameness } = p.data;
  const sameCtx = makeSamenessContext(runs, bases, sameness);
  const ctx = makeCertStatusContext(runs, cert, decisions, sameCtx, TODAY);
  const model = buildCellModel({ runs, regs, evalCell: ctx.evaluate, decisions, sameCtx, today: TODAY });
  return { model, runs, regs };
}
// riskSections の出力を [区分, [[型式, [法規…]]…]] にする
const secSig = (sec) => Object.fromEntries(sec.sections.map((s) => [s.kind, s.rows.map((r) => [r.run.typeId, r.cells.map((m) => m.reg.id)])]));
const secCounts = (sec) => sec.sections.map((s) => [s.kind, s.count]);

// ── 画面ユーティリティ ──
function panelEl(c) {
  const b = [...c.querySelectorAll("button")].find((x) => x.textContent.includes("危険な型式ラン"));
  if (!b) throw new Error("危険一覧のパネルが見つかりません");
  return b.parentElement.parentElement;
}
const panelToggle = (c) => [...c.querySelectorAll("button")].find((x) => x.textContent.includes("危険な型式ラン"));
const riskCountText = (c) => panelEl(c).children[0].children[1].textContent.trim();
const riskTable = (c) => panelEl(c).querySelector("table");
const alertBox = (c) => panelEl(c).querySelector("[data-risk-alerts]");
async function openPanel(c) { panelToggle(c).click(); await sleep(40); }
async function clickInPanel(c, re) {
  const b = [...panelEl(c).querySelectorAll("button")].find((x) => re.test(x.textContent));
  if (!b) throw new Error(`パネル内のボタンが見つかりません: ${re}`);
  b.click(); await sleep(40);
}
// 表を「区分 → ラン行 → 法規行」へ束ね直す
function view(c) {
  const t = riskTable(c);
  if (!t) return null;
  const out = [];
  for (const tr of t.querySelectorAll("tbody > tr")) {
    if (tr.hasAttribute("data-risk-section")) out.push({ kind: tr.getAttribute("data-risk-section"), head: tr, runs: [] });
    else if (tr.hasAttribute("data-risk-run")) out[out.length - 1].runs.push({ head: tr, regs: [] });
    else out[out.length - 1].runs.at(-1).regs.push(tr);
  }
  return out;
}
const typeOf = (tr) => tr.textContent.match(/TYPE-[A-Z]/)?.[0] || "";
const regOf = (tr) => tr.children[0].textContent.match(/REG-[A-Z0-9]+/)?.[0] || "";
// 見出しの [区分名, 件数]
const heads = (c) => view(c).map((s) => [s.head.textContent.includes(K[s.kind]) ? K[s.kind] : "?", Number(s.head.textContent.match(/(\d+) 件/)?.[1])]);
// 見えているラン・法規
const shown = (c) => Object.fromEntries(view(c).map((s) => [s.kind, s.runs.map((r) => [typeOf(r.head), r.regs.map(regOf)])]));
async function clickSection(c, kind) {
  const s = view(c).find((x) => x.kind === kind);
  s.head.querySelector("button").click(); await sleep(40);
}
async function clickRun(c, kind, typeId) {
  const r = view(c).find((x) => x.kind === kind).runs.find((x) => typeOf(x.head) === typeId);
  if (!r) throw new Error(`ラン行がありません: ${kind} ${typeId}`);
  r.head.querySelector("button").click(); await sleep(40);
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
async function setChecked(el, value) {
  if (el.checked !== value) el.click();
  await sleep(50);
}
// 単体版の「JSONに書き出し」を横取りして、いま画面が持っているデータを取り出す。
async function exportJson(c) {
  const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL, realClick = HTMLAnchorElement.prototype.click;
  let blob = null;
  URL.createObjectURL = (b) => { blob = b; return "blob:dummy"; };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () {};
  try {
    const b = [...c.querySelectorAll("button")].find((x) => /JSONに書き出し/.test(x.textContent));
    if (!b) throw new Error("書き出しボタンが見つかりません");
    b.click();
    await sleep(60);
    if (!blob) throw new Error("書き出しのBlobを取得できませんでした");
    return JSON.parse(await blob.text());
  } finally {
    URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke; HTMLAnchorElement.prototype.click = realClick;
  }
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

// ───────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "A1-A4-headings",
    name: "A1・A4：区分見出しが「期限超過 → 期限前・未取得 → 黄色予告」の順に出て、件数＝その区分の法規行の数",
    expect: "見出しは3つ・この順。件数は 3／10／1（drop未入力の別枠は数えない）。パネルの件数は 5 ラン・14 件",
    async run({ mount, asserts }) {
      const { model, runs } = modelOf(MAIN);
      const sec = riskSections(model, { runs });
      asserts.check("区分の順（モデル）", sec.sections.map((s) => s.kind), RISK_KINDS);
      asserts.check("区分の件数（モデル）", secCounts(sec), [["不適合", 3], ["期限前", 10], ["予告", 1]]);
      const c = await mountWith(mount, MAIN);
      asserts.check("閉じたパネルの件数", riskCountText(c), L_COUNT(5, 14));
      await openPanel(c);
      asserts.check("見出しの順と件数（画面）", heads(c), [[K.不適合, 3], [K.期限前, 10], [K.予告, 1]]);
    },
  },
  {
    id: "A1-zero-section",
    name: "A1：0件の区分も「0 件」で見出しを出す",
    expect: "PJ-Y だけ表示すると期限前・未取得は0件でも見出しが出る。PJ-Z（drop済み・実績ありだけ）は該当なしでも、開くと3つの見出しが 0 件で出る",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, MAIN);
      await toggleChip(c, "PJ-Y");
      await openPanel(c);
      asserts.check("PJ-Y：見出し", heads(c), [[K.不適合, 1], [K.期限前, 0], [K.予告, 1]]);
      asserts.check("PJ-Y：0件の区分にはラン行が無い", shown(c).期限前, []);
      await toggleChip(c, "PJ-Y");
      await toggleChip(c, "PJ-Z");
      asserts.check("PJ-Z：パネルの件数は該当なし", riskCountText(c), L_NONE);
      asserts.check("PJ-Z：3つとも 0 件の見出し", heads(c), [[K.不適合, 0], [K.期限前, 0], [K.予告, 0]]);
      asserts.check("PJ-Z：ラン行は無い", Object.values(shown(c)).flat().length, 0);
      asserts.check("PJ-Z：drop未入力の別枠も無い", alertBox(c), null);
    },
  },
  {
    id: "A2-multi-section",
    name: "A2：区分の下にラン、ランを開くとその区分の法規行だけ。複数区分にまたがるランは各区分に出る",
    expect: "TYPE-A は期限超過と期限前・未取得の両方に出る。期限超過で開くと REG-OVER だけ、期限前で開くと残り3つだけ",
    async run({ mount, asserts }) {
      const { model, runs } = modelOf(MAIN);
      asserts.check("区分ごとのランと法規行（モデル）", secSig(riskSections(model, { runs })), WANT);
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      await clickSection(c, "期限前");
      await clickRun(c, "不適合", "TYPE-A");
      await clickRun(c, "期限前", "TYPE-A");
      const s = shown(c);
      asserts.check("期限超過で開いた TYPE-A", s.不適合.find((x) => x[0] === "TYPE-A")[1], ["REG-OVER"]);
      asserts.check("期限前で開いた TYPE-A", s.期限前.find((x) => x[0] === "TYPE-A")[1], ["REG-K15", "REG-K50", "REG-K50B"]);
      asserts.check("開いていない TYPE-B は法規行なし", s.不適合.find((x) => x[0] === "TYPE-B")[1], []);
      asserts.check("TYPE-B は期限超過と黄色予告の両方", [s.不適合.some((x) => x[0] === "TYPE-B"), s.予告.some((x) => x[0] === "TYPE-B")], [true, true]);
      // 区分の中のラン行は、その区分の件数と最も切迫した日数を出す
      const headA = (kind) => view(c).find((x) => x.kind === kind).runs.find((r) => typeOf(r.head) === "TYPE-A").head.textContent;
      asserts.checkTrue("期限超過の TYPE-A 行：1 件・期限を過ぎて 100 日", headA("不適合").includes("1 件") && headA("不適合").includes("期限を過ぎて 100 日"));
      asserts.checkTrue("期限前の TYPE-A 行：3 件・期限まで 15 日", headA("期限前").includes("3 件") && headA("期限前").includes("期限まで 15 日"));
      // すべて展開で、全区分・全ランが開き、モデルと同じ並びになる
      await clickInPanel(c, /すべて展開/);
      asserts.check("すべて展開（画面）", shown(c), WANT);
      await clickInPanel(c, /すべてたたむ/);
      asserts.check("すべてたたむ", Object.values(shown(c)).flat().length, 0);
    },
  },
  {
    id: "A3-default-open",
    name: "A3：開いた直後は期限超過と黄色予告が展開・期限前はたたむ。見出しで開閉し、開き直すと既定に戻る",
    expect: "開いた直後は期限超過・黄色予告のラン行だけ見える。見出しを押すと開閉。パネルを閉じて開き直すと、区分もランも既定に戻る",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, MAIN);
      asserts.check("パネルの既定は閉じている（F-10のまま）", riskTable(c), null);
      await openPanel(c);
      const DEF = { 不適合: [["TYPE-A", []], ["TYPE-B", []], ["TYPE-C", []]], 期限前: [], 予告: [["TYPE-B", []]] };
      asserts.check("開いた直後", shown(c), DEF);
      await clickSection(c, "期限前");
      asserts.check("期限前の見出しを押すと開く", shown(c).期限前.map((x) => x[0]), ["TYPE-C", "TYPE-A", "TYPE-E"]);
      await clickSection(c, "不適合");
      asserts.check("期限超過の見出しを押すと閉じる", shown(c).不適合, []);
      await clickSection(c, "不適合");
      asserts.check("もう一度押すと開く", shown(c).不適合.map((x) => x[0]), ["TYPE-A", "TYPE-B", "TYPE-C"]);
      await clickRun(c, "予告", "TYPE-B");
      await clickSection(c, "不適合");
      await openPanel(c);   // 閉じる
      await openPanel(c);   // 開き直す
      asserts.check("開き直すと既定に戻る（区分・ランとも）", shown(c), DEF);
    },
  },
  {
    id: "A5-order-plan-tie",
    name: "A5・B4：区分内は切迫順。期限前は同じ期限なら未計画 → 計画済み。○の付け外しで件数は変わらない",
    expect: "○なし：TYPE-A の期限前は REG-K15・REG-K50・REG-K50B。REG-K50 に○があると REG-K50B の後ろへ。TYPE-C の先頭（REG-K15）に○があると、同じ15日の TYPE-A が先になる。画面で TYPE-E×REG-OVER の○を付け外ししても件数は同じで、並びだけが変わる",
    async run({ mount, asserts }) {
      const base = modelOf(MAIN), sec0 = riskSections(base.model, { runs: base.runs });
      const p1 = modelOf(withPlan(MAIN, [["r1", "g3"]])), sec1 = riskSections(p1.model, { runs: p1.runs });
      asserts.check("○あり：REG-K50 は区分のまま期限前", p1.model.list.find((m) => m.run.key === "r1" && m.reg.rid === "g3").risk.kind, "期限前");
      asserts.check("同じ期限は未計画が先（ランの中）", secSig(sec1).期限前[1], ["TYPE-A", ["REG-K15", "REG-K50B", "REG-K50"]]);
      asserts.check("件数は○の前後で同じ（ランの中）", secCounts(sec1), secCounts(sec0));
      const p2 = modelOf(withPlan(MAIN, [["r3", "g2"]])), sec2 = riskSections(p2.model, { runs: p2.runs });
      asserts.check("ランどうしも先頭が同じ期限なら未計画が先", secSig(sec2).期限前.map((x) => x[0]), ["TYPE-A", "TYPE-C", "TYPE-E"]);
      asserts.check("件数は○の前後で同じ（ランどうし）", secCounts(sec2), secCounts(sec0));
      asserts.check("○でパネルの件数も変わらない（モデル）",
        [riskRunRows(p2.model, { runs: p2.runs }).length, riskRunRows(p2.model, { runs: p2.runs }).reduce((n, r) => n + r.cells.length, 0)], [5, 14]);
      // 画面で○を付け外しする。○を付けられるのはLOが先のランだけ（F-23）なので、開発中の TYPE-E（20日が2つ）で見る
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      await clickInPanel(c, /すべて展開/);
      const before = { count: riskCountText(c), heads: heads(c) };
      const box = () => c.querySelector('input[aria-label="取得予定 r5 g1"]');
      const typeE = () => view(c).find((s) => s.kind === "期限前").runs.find((r) => typeOf(r.head) === "TYPE-E");
      asserts.checkTrue("○のチェックボックスがある", !!box() && !box().disabled);
      await setChecked(box(), true);
      asserts.check("○あり：件数は同じ", { count: riskCountText(c), heads: heads(c) }, before);
      asserts.check("○あり：同じ期限（20日）は未計画の REG-K15 が先", typeE().regs.map(regOf), ["REG-K15", "REG-OVER", "REG-K50", "REG-K50B"]);
      asserts.check("○あり：計画済みの印は REG-OVER だけ", typeE().regs.map((tr) => tr.textContent.includes(L_PLANNED)), [false, true, false, false]);
      await setChecked(box(), false);
      asserts.check("○を外す：件数は同じ", { count: riskCountText(c), heads: heads(c) }, before);
      asserts.check("○を外す：元の並びに戻る", shown(c).期限前, WANT.期限前);
      // 読み込んだ○（LOを迎えたランの保存済みの予定）でも、画面のラン順がモデルと同じになる
      const c2 = await mountWith(mount, withPlan(MAIN, [["r3", "g2"]]));
      await openPanel(c2);
      await clickSection(c2, "期限前");
      asserts.check("読み込んだ○：ランどうしの並び（画面）", shown(c2).期限前.map((x) => x[0]), ["TYPE-A", "TYPE-C", "TYPE-E"]);
      asserts.check("読み込んだ○：件数は同じ", heads(c2), before.heads);
      // 期限超過・黄色予告の並び：超過日数の大きい順・継続車規制日の近い順
      asserts.check("期限超過は超過日数の大きい順（100・30・10日）",
        sec0.sections[0].rows.map((r) => r.top.days), [100, 30, 10]);
    },
  },
  {
    id: "A6-unreadable-days",
    name: "A6：日数が読めない行はランの末尾、読める行が無いランは区分の末尾。同順位は元の並び",
    expect: "組み立てたモデルで、ラン a（-5日・読めない）→ a の中は読める行が先。ラン順は c(-20) → a(-5) → d(-5・a と同順位なので元の並び) → b（読める行なし）",
    async run({ asserts }) {
      // 決定表は期限日を必ず読める日付で返すので（不正なLOでも規制日側が期限になる）、
      // 日数が読めない行は実データからは作れない。並べ方だけを確かめるため、集約結果の形を組み立てる。
      const runs = ["a", "b", "c", "d"].map((k) => ({ key: k, typeId: `T-${k}` }));
      const reg = (id) => ({ rid: id, id });
      const cell = (run, rid, urgency) => ({ run, reg: reg(rid), risk: { kind: "不適合", days: urgency === null ? null : -urgency, urgency },
        decision: { 車両申請: "発生する（未計画）", 根拠未確認: false } });
      const [a, b, c, d] = runs;
      const model = {
        runs, phaseOf: () => "生産中", alertOf: () => null,
        list: [cell(a, "x1", null), cell(a, "x2", -5), cell(b, "x1", null), cell(c, "x1", -20), cell(d, "x1", -5)],
      };
      const s = riskSections(model).sections[0];
      asserts.check("ランの並び", s.rows.map((r) => r.run.key), ["c", "a", "d", "b"]);
      asserts.check("a の中は読める行が先", s.rows[1].cells.map((m) => m.reg.id), ["x2", "x1"]);
      asserts.check("読める行が無いランの先頭日数は無い", s.rows[3].top, null);
      asserts.check("件数は日数が読めない行も数える", s.count, 5);
    },
  },
  {
    id: "A7-drop-missing-box",
    name: "A7・B3：drop未入力のランは見出しより上の別枠。危険な法規行があれば該当する区分にも出る。別枠は件数に混ざらない",
    expect: "別枠に TYPE-C・TYPE-G。別枠は最初の見出しより上。TYPE-C は期限超過・期限前にも出る。TYPE-G（drop未入力だけ）はどの区分にも出ない",
    async run({ mount, asserts }) {
      const { model, runs } = modelOf(MAIN);
      const sec = riskSections(model, { runs });
      asserts.check("別枠のラン（モデル）", sec.alerts.map((a) => a.run.key), ["r3", "r7"]);
      // B3：区分の件数の合計＝区分に入るセルの数。セルの所属は riskOfCell のまま
      const cells = model.list.filter((m) => m.risk);
      asserts.check("件数の合計＝区分に入るセル数", sec.sections.reduce((n, s) => n + s.count, 0), cells.length);
      const fromSec = sec.sections.flatMap((s) => s.rows.flatMap((r) => r.cells.map((m) => `${m.run.key}×${m.reg.rid}:${s.kind}`))).sort();
      asserts.check("セルの所属は riskOfCell の kind のまま", fromSec, cells.map((m) => `${m.run.key}×${m.reg.rid}:${m.risk.kind}`).sort());
      asserts.check("drop済み・実績ありのランはどの区分にも無い", fromSec.some((x) => /^r[467]×/.test(x)), false);
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      const box = alertBox(c);
      asserts.checkTrue("別枠がある", !!box);
      asserts.check("別枠のラン（画面）", [...box.querySelectorAll("[data-risk-alert-run]")].map(typeOf), ["TYPE-C", "TYPE-G"]);
      asserts.check("別枠の印は1ランに1つ", (box.textContent.match(/drop未入力（LO済み）/g) || []).length, 2);
      const firstHead = riskTable(c).querySelector("tr[data-risk-section]");
      asserts.check("別枠は区分見出しより上", (box.compareDocumentPosition(firstHead) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, true);
      await clickInPanel(c, /すべて展開/);
      const s = shown(c);
      asserts.check("TYPE-C は該当する区分にも出る", [s.不適合.some((x) => x[0] === "TYPE-C"), s.期限前.some((x) => x[0] === "TYPE-C"), s.予告.some((x) => x[0] === "TYPE-C")], [true, true, false]);
      asserts.check("TYPE-G はどの区分にも出ない", Object.values(s).flat().some((x) => x[0] === "TYPE-G"), false);
      asserts.check("区分の表に drop未入力の印は出ない", riskTable(c).textContent.includes(L_MISSING), false);
      asserts.check("見出しの件数は別枠を数えない", heads(c).map((h) => h[1]), [3, 10, 1]);
    },
  },
  {
    id: "B6-filters",
    name: "A4・B6：プロジェクト・型式の両フィルターに区分の件数・ラン・別枠が連動する",
    expect: "PJ-X：3区分 2／10／0・4 ラン 12 件・別枠 TYPE-C・TYPE-G。TYPE-B：1／0／1。PJ-X×TYPE-B は該当なし。解除で全体に戻る",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      const snap = () => ({ count: riskCountText(c), heads: heads(c).map((h) => h[1]),
        alerts: alertBox(c) ? [...alertBox(c).querySelectorAll("[data-risk-alert-run]")].map(typeOf) : [] });
      const all = snap();
      asserts.check("フィルター前", all, { count: L_COUNT(5, 14), heads: [3, 10, 1], alerts: ["TYPE-C", "TYPE-G"] });
      await toggleChip(c, "PJ-X");
      asserts.check("プロジェクトで絞る", snap(), { count: L_COUNT(4, 12), heads: [2, 10, 0], alerts: ["TYPE-C", "TYPE-G"] });
      asserts.check("プロジェクトで絞った期限超過のラン", shown(c).不適合.map((x) => x[0]), ["TYPE-A", "TYPE-C"]);
      await toggleChip(c, "TYPE-B");
      asserts.check("プロジェクト×型式（AND）で該当なし", snap(), { count: L_NONE, heads: [0, 0, 0], alerts: [] });
      await toggleChip(c, "PJ-X");
      asserts.check("型式だけ", snap(), { count: L_COUNT(1, 2), heads: [1, 0, 1], alerts: [] });
      await clickByText(c, /すべて表示/);
      asserts.check("解除で全体に戻る", snap(), all);
    },
  },
  {
    id: "B5-decided-rows",
    name: "B5・A4：判断済み（対象外）の行は消えず・薄くならず、件数にも数える",
    expect: "r1×REG-OVER を対象外と判断しても、期限超過は3件のまま。その行は「対象外（判断済み）」で出て、不透明度は他の行と同じ",
    async run({ mount, asserts }) {
      const d = clone(MAIN);
      const r1 = d.runs.find((r) => r.key === "r1"), g1 = d.regs.find((g) => g.rid === "g1");
      d.decisions = [{ runKey: "r1", rid: "g1", state: "対象外", reason: "ダミー：対象外と判断", decidedAt: `${LOCAL_TODAY} 10:00`,
        needsRecheck: false, cond: condOf(r1, g1, d.regs) }];
      const { model, runs } = modelOf(d);
      asserts.check("判断済みでも件数は同じ（モデル）", secCounts(riskSections(model, { runs })), [["不適合", 3], ["期限前", 10], ["予告", 1]]);
      const c = await mountWith(mount, d);
      await openPanel(c);
      await clickInPanel(c, /すべて展開/);
      const rows = view(c).find((s) => s.kind === "不適合").runs;
      asserts.check("期限超過のランは同じ", rows.map((r) => typeOf(r.head)), ["TYPE-A", "TYPE-B", "TYPE-C"]);
      const tr = rows[0].regs[0];
      asserts.checkTrue("判断済みの行が出ている", regOf(tr) === "REG-OVER" && tr.textContent.includes(L_EXEMPT));
      const op = (el) => [el, ...el.querySelectorAll("*")].map((x) => getComputedStyle(x).opacity);
      asserts.check("判断済みの行は薄くならない（全要素の不透明度が1）", op(tr).every((x) => x === "1"), true);
      asserts.check("文字色は他の期限超過の行と同じ", getComputedStyle(tr.children[0]).color, getComputedStyle(rows[1].regs[0].children[0]).color);
    },
  },
  {
    id: "B1-export-unchanged",
    name: "B1：並び・開閉の操作で JSON書き出しのデータが変わらない",
    expect: "パネル・区分・ランの開閉、すべて展開／たたむの前後で、JSON書き出しが1文字も変わらない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, MAIN);
      const before = await exportJson(c);
      await openPanel(c);
      await clickSection(c, "期限前");
      await clickSection(c, "不適合");
      await clickRun(c, "予告", "TYPE-B");
      await clickInPanel(c, /すべて展開/);
      await clickInPanel(c, /すべてたたむ/);
      await openPanel(c);
      const after = await exportJson(c);
      asserts.check("JSON書き出しは同じ", JSON.stringify(after), JSON.stringify(before));
      asserts.check("開閉の状態はデータに入っていない", /sectionOpen|expanded|期限超過/.test(JSON.stringify(after)), false);
    },
  },
  {
    id: "A8-api-version",
    name: "API版（サーバ保存版）でも同じ区分見出し・既定の開閉・別枠になる",
    expect: "IListApp でも見出し 3／10／1、開いた直後は期限超過・黄色予告だけ展開、別枠に TYPE-C・TYPE-G",
    async run({ mountApi, asserts }) {
      // API版は版なし（旧形式）の cert を読む（型式 → 法規ID → 認可番号）
      const cert = {};
      for (const t of ["TYPE-F", "TYPE-G"]) cert[t] = Object.fromEntries(REGS.map((g) => [g.id, `CK-${t}-${g.id}`]));
      const api = installApiMock({ runs: RUNS, regs: REGS, cert });
      try {
        const c = mountApi().container;
        await sleep(150);
        asserts.check("件数", riskCountText(c), L_COUNT(5, 14));
        await openPanel(c);
        asserts.check("見出し", heads(c), [[K.不適合, 3], [K.期限前, 10], [K.予告, 1]]);
        asserts.check("開いた直後", shown(c), { 不適合: [["TYPE-A", []], ["TYPE-B", []], ["TYPE-C", []]], 期限前: [], 予告: [["TYPE-B", []]] });
        asserts.check("別枠", [...alertBox(c).querySelectorAll("[data-risk-alert-run]")].map(typeOf), ["TYPE-C", "TYPE-G"]);
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
    window.__SECVERIFY_RESULT__ = { finished: false };
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
      window.__SECVERIFY_RESULT__ = {
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
    window.__runSectionsVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);
  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>危険一覧の区分見出し・並び・開閉（F-27） 検証ハーネス</h1>
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
