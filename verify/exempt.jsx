// ───────────────────────────────────────────────
// 危険一覧の補助表示（F-28）の検証ハーネス：人の対象外の印・区分見出しの「うち対象外」・末尾寄せ・判定不能の件数
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない
// （API版のケースでは window.fetch をモックする）。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/exempt.html
//
// 完成条件 A1〜A5・B1〜B3（docs/current-task.md の F-28）を、ケースIDの先頭で対応づける。
// 保存HTMLを実ファイルで開き直す確認（必須検証の保存HTML）は verify/exempt-file.mjs が行う。
// 期待値に固定日付を書かない。実行時の端末ローカル日付から相対日付を作る。
// ───────────────────────────────────────────────
import React from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import IListApp, {
  TODAY, SEED, parseImportedData, riskSections, buildCellModel, makeSamenessContext, condOf, RISK_KINDS,
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
const L_HEAD = (n, m) => `${n} 件（うち対象外 ${m}）`;
const L_UNDECIDABLE = (k) => `判定不能 ラン ${k} 件`;
const M_EXEMPT = "対象外", M_RECHECK = "対象外・要再確認";
const L_EXEMPT_GRAY = "対象外（判断済み）";   // 帳票の灰の上書き表示。一覧には出さない（B1）
const L_VIOLATION = "法規不適合";

// ── ダミーデータ（架空。実車・実法規・実認可番号とは無関係） ──
// すべて継続ラン（要 ⇔ 継続車規制日 ≤ drop）。
//
//   rA TYPE-A / PJ-X / 生産中        … REG-OVER 期限超過100日 ＋ 期限前 15・50・60日
//   rB TYPE-B / PJ-Y / 生産中        … REG-OVER 期限超過30日（期限＝LO）＋ REG-K15 黄色予告（15日）
//   rC TYPE-C / PJ-X / 生産中        … REG-OVER 期限超過10日（期限＝LO）＋ 期限前 15日 ＋ 黄色予告 50・60日
//   rL TYPE-L / PJ-X / LO・drop が空 … 判定不能（区分に入らない）
//   rM TYPE-M / PJ-Y / LO が空       … 判定不能（dropはある）
//   rK TYPE-K / PJ-Z / drop が空     … drop未入力の別枠（全法規に実績あり）。判定不能には数えない（B3）
//   REG-BLANK … 規制日が空の法規。どのランも判定不能にしない（B3）
//
// 人の判断（rB×REG-OVER は「対象」＝印なし）
//   期限超過       … rA×OVER 対象外（rA ごと区分の末尾へ）／rC×OVER 対象外・要再確認（保存済みのフラグ）
//   期限前・未取得 … rA×K15 対象外（区分の末尾の段へ。rA は上の段（K50・K60）と末尾の段の2回出る）／rA×K50 対象外・要再確認（確定時から条件が変わった）
//   黄色予告       … rC×K50 対象外（区分の末尾の段へ。rC は上の段（K60）と末尾の段の2回出る）
const LONG_AGO = shift(-3650), FAR = shift(3650);
const run = (key, typeId, gen, lo, drop) => ({ key, typeId, gen, sk: "継", lo, drop });
const reg = (rid, id, kei, shin = LONG_AGO) => ({ rid, id, label: "ダミー法規", shin, kei, parent: "" });
const RUNS = [
  run("rA", "TYPE-A", "PJ-X", LONG_AGO, FAR),
  run("rB", "TYPE-B", "PJ-Y", shift(-30), shift(5)),
  run("rC", "TYPE-C", "PJ-X", shift(-10), shift(40)),
  run("rL", "TYPE-L", "PJ-X", "", ""),
  run("rM", "TYPE-M", "PJ-Y", "", shift(100)),
  run("rK", "TYPE-K", "PJ-Z", shift(-5), ""),
];
const REGS = [
  reg("g1", "REG-OVER", shift(-100)),
  reg("g2", "REG-K15", shift(15)),
  reg("g3", "REG-K50", shift(50)),
  reg("g4", "REG-K60", shift(60)),
  reg("g5", "REG-BLANK", "", ""),
];
const runOf = (k) => RUNS.find((r) => r.key === k), regOf = (rid) => REGS.find((g) => g.rid === rid);
const dec = (runKey, rid, state, { needsRecheck = false, cond } = {}) => ({ runKey, rid, state,
  reason: state === "対象外" ? "ダミー：対象外と判断" : "", decidedAt: `${LOCAL_TODAY} 10:00`, needsRecheck,
  cond: cond || condOf(runOf(runKey), regOf(rid), REGS) });
const DECISIONS = [
  dec("rA", "g1", "対象外"),
  dec("rC", "g1", "対象外", { needsRecheck: true }),
  dec("rB", "g1", "対象"),
  dec("rA", "g2", "対象外"),
  // 確定した時の継続車規制日が今と違う＝条件が変わった（保存済みのフラグは false のまま。掃き出し前でも要再確認として見る）
  dec("rA", "g3", "対象外", { cond: { ...condOf(runOf("rA"), regOf("g3"), REGS), kei: shift(51) } }),
  dec("rC", "g3", "対象外"),
];
const certAll = (runKey) => REGS.map((g) => ({ runKey, rid: g.rid, ck: `CK-${runKey}-${g.rid}`, planned: false }));
const clone = (o) => JSON.parse(JSON.stringify(o));
const MAIN = { schemaVersion: 2, runs: RUNS, regs: REGS, cert: certAll("rK"), decisions: DECISIONS, bases: [], sameness: [] };
const NO_DECISIONS = { ...clone(MAIN), decisions: [] };

// 期待する区分（[型式, [[法規, 印]…]] の並び）。印の無い行は ""。
const WANT = {
  不適合: [["TYPE-B", [["REG-OVER", ""]]], ["TYPE-C", [["REG-OVER", M_RECHECK]]], ["TYPE-A", [["REG-OVER", M_EXEMPT]]]],
  期限前: [["TYPE-C", [["REG-K15", ""]]], ["TYPE-A", [["REG-K50", M_RECHECK], ["REG-K60", ""]]], ["TYPE-A", [["REG-K15", M_EXEMPT]]]],
  予告: [["TYPE-B", [["REG-K15", ""]]], ["TYPE-C", [["REG-K60", ""]]], ["TYPE-C", [["REG-K50", M_EXEMPT]]]],
};
// 判断が無いときの並び（F-27 のまま）
const WANT_PLAIN = {
  不適合: [["TYPE-A", ["REG-OVER"]], ["TYPE-B", ["REG-OVER"]], ["TYPE-C", ["REG-OVER"]]],
  期限前: [["TYPE-A", ["REG-K15", "REG-K50", "REG-K60"]], ["TYPE-C", ["REG-K15"]]],
  予告: [["TYPE-B", ["REG-K15"]], ["TYPE-C", ["REG-K50", "REG-K60"]]],
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
const secSig = (sec) => Object.fromEntries(sec.sections.map((s) => [s.kind, s.rows.map((r) => [r.run.typeId, r.cells.map((m) => [m.reg.id, m.exemptMark || ""])])]));
const secPlain = (sec) => Object.fromEntries(sec.sections.map((s) => [s.kind, s.rows.map((r) => [r.run.typeId, r.cells.map((m) => m.reg.id)])]));
const secCounts = (sec) => sec.sections.map((s) => [s.kind, s.count, s.exempt]);

// ── 画面ユーティリティ ──
function panelEl(c) {
  const b = [...c.querySelectorAll("button")].find((x) => x.textContent.includes("危険な型式ラン"));
  if (!b) throw new Error("危険一覧のパネルが見つかりません");
  return b.parentElement.parentElement;
}
const panelToggle = (c) => [...c.querySelectorAll("button")].find((x) => x.textContent.includes("危険な型式ラン"));
const riskTable = (c) => panelEl(c).querySelector("table");
const undecidableEl = (c) => panelEl(c).querySelector("[data-risk-undecidable]");
const undecidableText = (c) => undecidableEl(c)?.textContent.match(/判定不能 ラン \d+ 件/)?.[0] ?? null;
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
const regOf2 = (tr) => tr.children[0].textContent.match(/REG-[A-Z0-9]+/)?.[0] || "";
const markOf = (tr) => tr.querySelector("[data-risk-exempt]")?.getAttribute("data-risk-exempt") || "";
// 見出しの [区分名, 件数表記]
const heads = (c) => view(c).map((s) => [K[s.kind], s.head.textContent.match(/\d+ 件（うち対象外 \d+）/)?.[0] ?? s.head.textContent]);
const shown = (c) => Object.fromEntries(view(c).map((s) => [s.kind, s.runs.map((r) => [typeOf(r.head), r.regs.map((tr) => [regOf2(tr), markOf(tr)])])]));
async function clickSection(c, kind) {
  const s = view(c).find((x) => x.kind === kind);
  s.head.querySelector("button").click(); await sleep(40);
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
    id: "A1-marks",
    name: "A1：対象外のセルは消さずに印を付ける（要再確認なし＝対象外／あり＝対象外・要再確認）",
    expect: "対象外の6件中5件が区分に出て印が付く（rC×K50 は黄色予告）。要再確認は保存済みフラグでも条件変化でも「対象外・要再確認」。「対象」の判断・判断なしには印が出ない",
    async run({ mount, asserts }) {
      const { model, runs } = modelOf(MAIN);
      asserts.check("区分と印（モデル）", secSig(riskSections(model, { runs })), WANT);
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      await clickInPanel(c, /すべて展開/);
      asserts.check("区分と印（画面）", shown(c), WANT);
      const rows = view(c).flatMap((s) => s.runs.flatMap((r) => r.regs));
      asserts.check("印の数（対象外・対象外・要再確認）", [M_EXEMPT, M_RECHECK].map((m) => rows.filter((tr) => markOf(tr) === m).length), [3, 2]);
      asserts.check("印の文言", [...new Set(rows.map((tr) => tr.querySelector("[data-risk-exempt]")?.textContent).filter(Boolean))].sort(), [M_EXEMPT, M_RECHECK].sort());
      // 「対象」の判断（rB×OVER）には印を出さない
      const rbOver = view(c).find((s) => s.kind === "不適合").runs.find((r) => typeOf(r.head) === "TYPE-B").regs[0];
      asserts.check("「対象」の判断には印が無い", markOf(rbOver), "");
      // 判断が無いデータでは印が1つも無い
      const c2 = await mountWith(mount, NO_DECISIONS);
      await openPanel(c2);
      await clickInPanel(c2, /すべて展開/);
      asserts.check("判断が無ければ印は0件", riskTable(c2).querySelectorAll("[data-risk-exempt]").length, 0);
    },
  },
  {
    id: "B1-color-unchanged",
    name: "B1：人の判断・要再確認で、自動判定・色・区分の所属が変わらない（赤を薄くしない）",
    expect: "判断あり／なしで、全セルの決定表の出力・区分・件数 n が同じ。一覧の状態は「法規不適合」の赤のままで、灰の「対象外（判断済み）」にしない。行の不透明度は1",
    async run({ mount, asserts }) {
      const a = modelOf(MAIN), b = modelOf(NO_DECISIONS);
      const sig = (m) => m.model.list.map((x) => [x.run.key, x.reg.rid, JSON.stringify(x.decision), x.risk?.kind ?? null, x.auto.status]);
      asserts.check("決定表の出力・区分・自動判定は判断の有無で同じ", sig(a), sig(b));
      const cnt = (m) => riskSections(m.model, { runs: m.runs }).sections.map((s) => s.count);
      asserts.check("区分の件数 n は判断の有無で同じ", cnt(a), cnt(b));
      asserts.check("区分に入るセルの集合は同じ（並びは変わってよい）",
        Object.values(secPlain(riskSections(a.model, { runs: a.runs }))).map((rs) => rs.flatMap(([t, gs]) => gs.map((g) => `${t}×${g}`)).sort()),
        Object.values(secPlain(riskSections(b.model, { runs: b.runs }))).map((rs) => rs.flatMap(([t, gs]) => gs.map((g) => `${t}×${g}`)).sort()));
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      await clickInPanel(c, /すべて展開/);
      const over = view(c).find((s) => s.kind === "不適合").runs;
      const plain = over[0].regs[0], exempt = over[2].regs[0], recheck = over[1].regs[0];
      const stateColor = (tr) => {
        const el = [...tr.children[1].querySelectorAll("span")].find((s) => s.textContent === L_VIOLATION);
        return el ? getComputedStyle(el).color : null;
      };
      asserts.check("対象外・要再確認の行も状態は法規不適合（同じ色）", [stateColor(exempt), stateColor(recheck)], [stateColor(plain), stateColor(plain)]);
      asserts.checkTrue("状態の色は赤（判断なしの行と同じ・灰でない）", stateColor(plain) && stateColor(plain) !== "rgb(154, 171, 189)");
      asserts.check("一覧に灰の上書き表示は出ない", riskTable(c).textContent.includes(L_EXEMPT_GRAY), false);
      const op = (el) => [el, ...el.querySelectorAll("*")].map((x) => getComputedStyle(x).opacity);
      asserts.check("対象外の行は薄くならない", [exempt, recheck].every((tr) => op(tr).every((x) => x === "1")), true);
      asserts.check("区分見出しの色は判断の有無で同じ（期限超過）",
        getComputedStyle(view(c).find((s) => s.kind === "不適合").head.querySelector("button")).color,
        await (async () => { const c2 = await mountWith(mount, NO_DECISIONS); await openPanel(c2);
          return getComputedStyle(view(c2).find((s) => s.kind === "不適合").head.querySelector("button")).color; })());
    },
  },
  {
    id: "A2-heading-counts",
    name: "A2：区分見出しは「n 件（うち対象外 m）」。m は印が「対象外」だけ。0 も出す。折りたたんでも出る",
    expect: "判断あり：3件（うち対象外1）／4件（うち対象外1）／3件（うち対象外1）。判断なし：うち対象外0。開いた直後にたたんでいる期限前も、全部たたんでも見出しに出る",
    async run({ mount, asserts }) {
      const { model, runs } = modelOf(MAIN);
      asserts.check("件数（モデル）", secCounts(riskSections(model, { runs })), [["不適合", 3, 1], ["期限前", 4, 1], ["予告", 3, 1]]);
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      const want = [[K.不適合, L_HEAD(3, 1)], [K.期限前, L_HEAD(4, 1)], [K.予告, L_HEAD(3, 1)]];
      asserts.check("開いた直後（期限前はたたんでいる）", heads(c), want);
      asserts.check("開いた直後の期限前はラン行を出していない", view(c).find((s) => s.kind === "期限前").runs.length, 0);
      await clickInPanel(c, /すべて展開/);
      await clickInPanel(c, /すべてたたむ/);
      asserts.check("全部たたんでも見出しに出る", heads(c), want);
      asserts.check("たたんだ区分にはラン行が無い", view(c).map((s) => s.runs.length), [0, 0, 0]);
      await clickSection(c, "不適合");
      asserts.check("開き直しても同じ", heads(c), want);
      // 要再確認の対象外は m に数えない：rC×OVER（要再確認）を外しても m は変わらず、rA×OVER を外すと 0 になる
      const d1 = clone(MAIN); d1.decisions = d1.decisions.filter((x) => !(x.runKey === "rC" && x.rid === "g1"));
      const d2 = clone(MAIN); d2.decisions = d2.decisions.filter((x) => !(x.runKey === "rA" && x.rid === "g1"));
      const m1 = modelOf(d1), m2 = modelOf(d2);
      asserts.check("要再確認の対象外を外しても m は同じ", secCounts(riskSections(m1.model, { runs: m1.runs }))[0], ["不適合", 3, 1]);
      asserts.check("対象外を外すと m は0（n は同じ）", secCounts(riskSections(m2.model, { runs: m2.runs }))[0], ["不適合", 3, 0]);
      const c0 = await mountWith(mount, NO_DECISIONS);
      await openPanel(c0);
      asserts.check("対象外0件の区分は「うち対象外 0」", heads(c0), [[K.不適合, L_HEAD(3, 0)], [K.期限前, L_HEAD(4, 0)], [K.予告, L_HEAD(3, 0)]]);
      // 0件の区分（PJ-Z だけ：drop未入力の別枠だけ）も「0 件（うち対象外 0）」
      await toggleChip(c0, "PJ-Z");
      asserts.check("0件の区分", heads(c0), [[K.不適合, L_HEAD(0, 0)], [K.期限前, L_HEAD(0, 0)], [K.予告, L_HEAD(0, 0)]]);
    },
  },
  {
    id: "A3-set-aside",
    name: "A3：印が「対象外」の行だけを区分の末尾に寄せる。要再確認は寄せない。各グループの中は F-27 の並び",
    expect: "期限超過：B → C（要再確認は寄らない）→ 末尾の段 A。期限前：C → A（K50・K60）→ 末尾の段 A（K15）。黄色予告：B → C（K60）→ 末尾の段 C（K50）。対象外の行の後に、対象外でない行が来ない。判断なしなら F-27 の並び",
    async run({ mount, asserts }) {
      const p = modelOf(NO_DECISIONS);
      asserts.check("判断なしは F-27 の並び", secPlain(riskSections(p.model, { runs: p.runs })), WANT_PLAIN);
      const { model, runs } = modelOf(MAIN);
      const sec = riskSections(model, { runs });
      asserts.check("寄せた後の並び", secSig(sec), WANT);
      // 区分全体で見て、対象外の行の後に対象外でない行が来ない（Codexレビュー指摘1）
      asserts.check("各区分で対象外の行は末尾にまとまる", sec.sections.map((s) => {
        const marks = s.rows.flatMap((r) => r.cells.map((m) => m.exemptMark === "対象外"));
        return marks.indexOf(true) === -1 || marks.slice(marks.indexOf(true)).every(Boolean);
      }), [true, true, true]);
      asserts.check("末尾の段だけが aside", sec.sections.map((s) => s.rows.map((r) => r.aside)), [[false, false, true], [false, false, true], [false, false, true]]);
      // 寄せたグループの中も F-27 の並び：rA の期限前を全部対象外にすると、K15 → K50 → K60（期限の近い順）のまま末尾
      const d = clone(MAIN);
      d.decisions = d.decisions.filter((x) => !(x.runKey === "rA" && ["g2", "g3"].includes(x.rid)));
      for (const rid of ["g4", "g3", "g2"]) d.decisions.push(dec("rA", rid, "対象外"));
      const m2 = modelOf(d);
      asserts.check("寄せたグループの中は期限の近い順", secSig(riskSections(m2.model, { runs: m2.runs })).期限前,
        [["TYPE-C", [["REG-K15", ""]]], ["TYPE-A", [["REG-K15", M_EXEMPT], ["REG-K50", M_EXEMPT], ["REG-K60", M_EXEMPT]]]]);
      // 寄せていないグループの中も F-27 の並び：要再確認は寄らず、切迫度の順に混ざる
      asserts.check("要再確認は寄らず切迫度の順（rA の K50 が先頭）", secSig(sec).期限前[1][1][0], ["REG-K50", M_RECHECK]);
      // ランの見出しの日数は寄せていない行から（rA の期限前は K50 の 50 日）
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      await clickInPanel(c, /すべて展開/);
      asserts.check("並び（画面）", shown(c), WANT);
      const aHead = view(c).find((s) => s.kind === "期限前").runs.find((r) => typeOf(r.head) === "TYPE-A").head;
      asserts.checkTrue("ラン行の日数は寄せていない行から（期限まで 50 日）", aHead.textContent.includes("期限まで 50 日"));
      // 同じランの2つの段は別々に開閉する（展開状態が段で区別されている）
      await clickInPanel(c, /すべてたたむ/);
      await clickSection(c, "期限前");
      const aRuns = () => view(c).find((s) => s.kind === "期限前").runs.filter((r) => typeOf(r.head) === "TYPE-A");
      aRuns()[1].head.querySelector("button").click(); await sleep(40);
      asserts.check("末尾の段だけを開ける", aRuns().map((r) => r.regs.map(regOf2)), [[], ["REG-K15"]]);
      asserts.check("末尾の段のラン行に対象外の印", aRuns().map((r) => r.head.hasAttribute("data-risk-aside")), [false, true]);
    },
  },
  {
    id: "A3-aside-only-section",
    name: "境界：対象外だけの区分。寄せた行だけでも並びは F-27 のまま、件数は n＝m",
    expect: "黄色予告の3件をすべて対象外にすると「3 件（うち対象外 3）」。並びは B（15日）→ C（50・60日）のまま",
    async run({ mount, asserts }) {
      const d = clone(NO_DECISIONS);
      d.decisions = [dec("rB", "g2", "対象外"), dec("rC", "g3", "対象外"), dec("rC", "g4", "対象外")];
      const { model, runs } = modelOf(d);
      const sec = riskSections(model, { runs });
      asserts.check("件数", secCounts(sec)[2], ["予告", 3, 3]);
      asserts.check("並び", secSig(sec).予告, [["TYPE-B", [["REG-K15", M_EXEMPT]]], ["TYPE-C", [["REG-K50", M_EXEMPT], ["REG-K60", M_EXEMPT]]]]);
      const c = await mountWith(mount, d);
      await openPanel(c);
      asserts.check("見出し", heads(c)[2], [K.予告, L_HEAD(3, 3)]);
    },
  },
  {
    id: "A4-undecidable",
    name: "A4・B3：LO未入力のランは区分に入れず、一覧の上に「判定不能 ラン k 件」。0件でも出す。規制日空欄・drop未入力は数えない",
    expect: "k＝2（TYPE-L・TYPE-M）。drop未入力の TYPE-K・規制日が空の REG-BLANK は数えない・区分から外さない。表示は区分見出しより上。TYPE-A だけ表示すると 0 件で出る",
    async run({ mount, asserts }) {
      const { model, runs } = modelOf(MAIN);
      const sec = riskSections(model, { runs });
      asserts.check("判定不能のラン（モデル）", sec.undecidable.map((r) => r.typeId), ["TYPE-L", "TYPE-M"]);
      const inSections = new Set(sec.sections.flatMap((s) => s.rows.map((r) => r.run.typeId)));
      asserts.check("判定不能のランは区分に入らない", ["TYPE-L", "TYPE-M"].map((t) => inSections.has(t)), [false, false]);
      asserts.check("drop未入力のランは別枠のまま（判定不能に数えない）", [sec.alerts.map((a) => a.run.typeId), sec.undecidable.some((r) => r.typeId === "TYPE-K")], [["TYPE-K"], false]);
      // 規制日が空の法規：どのランも判定不能にしない。drop未入力（実績を外した TYPE-K）は区分に入ったまま
      const d = clone(MAIN); d.cert = d.cert.filter((x) => x.rid !== "g1");
      const m2 = modelOf(d), s2 = riskSections(m2.model, { runs: m2.runs });
      asserts.check("drop未入力のランは区分から外さない（実績を外すと期限超過に入る）", s2.sections[0].rows.some((r) => r.run.typeId === "TYPE-K"), true);
      asserts.check("それでも判定不能には数えない", s2.undecidable.map((r) => r.typeId), ["TYPE-L", "TYPE-M"]);
      asserts.check("REG-BLANK の行は判定不能のセルにならない（判定不能は LO の空いた2ランの5法規ずつ）",
        m2.model.list.filter((m) => m.decision.表示 === "判定不能").map((m) => m.run.typeId).sort(),
        [...Array(5).fill("TYPE-L"), ...Array(5).fill("TYPE-M")]);
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      asserts.check("画面の表示", undecidableText(c), L_UNDECIDABLE(2));
      const firstHead = riskTable(c).querySelector("tr[data-risk-section]");
      asserts.check("区分見出しより上", (undecidableEl(c).compareDocumentPosition(firstHead) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, true);
      asserts.check("drop未入力の別枠より上", (undecidableEl(c).compareDocumentPosition(panelEl(c).querySelector("[data-risk-alerts]")) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, true);
      asserts.check("判定不能のランは区分の表に出ない", /TYPE-[LM]/.test(riskTable(c).textContent), false);
      await toggleChip(c, "TYPE-A");
      asserts.check("0件でも出す（TYPE-A だけ）", undecidableText(c), L_UNDECIDABLE(0));
      // 判定不能のランが1本も無いデータでも 0 件で出す
      const d0 = clone(MAIN); d0.runs = d0.runs.filter((r) => r.lo !== ""); d0.decisions = d0.decisions.filter((x) => d0.runs.some((r) => r.key === x.runKey));
      const c0 = await mountWith(mount, d0);
      await openPanel(c0);
      asserts.check("LO未入力のランが無いデータ", undecidableText(c0), L_UNDECIDABLE(0));
    },
  },
  {
    id: "A4-no-regs",
    name: "A4：法規が0件でも、LO未入力のランがあれば判定不能の件数を出す（Codexレビュー指摘2）",
    expect: "LOが空のラン1本・法規0件のデータで、危険一覧のパネルが出て「判定不能 ラン 1 件」。LOのあるラン1本・法規0件ならパネルは出ない（従来どおり）",
    async run({ mount, asserts }) {
      const base = { schemaVersion: 2, regs: [], cert: [], decisions: [], bases: [], sameness: [] };
      const c = await mountWith(mount, { ...base, runs: [run("rL", "TYPE-L", "PJ-X", "", "")] });
      asserts.checkTrue("パネルが出る", !!panelToggle(c));
      await openPanel(c);
      asserts.check("判定不能の件数", undecidableText(c), L_UNDECIDABLE(1));
      const c2 = await mountWith(mount, { ...base, runs: [run("rA", "TYPE-A", "PJ-X", LONG_AGO, FAR)] });
      asserts.check("判定不能が0件・警告も無いならパネルは出ない（従来どおり）", !!panelToggle(c2), false);
    },
  },
  {
    id: "A4-filters",
    name: "A2・A4：型式・プロジェクトのフィルター適用前後の n・m・k",
    expect: "全体：3/1・4/1・3/1・k2。PJ-X：2/1・4/1・2/1・k1。PJ-Y：1/0・0/0・1/0・k1。TYPE-M だけ：0/0・0/0・0/0・k1。解除で全体に戻る",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, MAIN);
      await openPanel(c);
      const snap = () => ({ heads: heads(c).map((h) => h[1]), k: undecidableText(c) });
      const all = snap();
      asserts.check("フィルター前", all, { heads: [L_HEAD(3, 1), L_HEAD(4, 1), L_HEAD(3, 1)], k: L_UNDECIDABLE(2) });
      await toggleChip(c, "PJ-X");
      asserts.check("PJ-X", snap(), { heads: [L_HEAD(2, 1), L_HEAD(4, 1), L_HEAD(2, 1)], k: L_UNDECIDABLE(1) });
      await toggleChip(c, "PJ-X");
      await toggleChip(c, "PJ-Y");
      asserts.check("PJ-Y", snap(), { heads: [L_HEAD(1, 0), L_HEAD(0, 0), L_HEAD(1, 0)], k: L_UNDECIDABLE(1) });
      await toggleChip(c, "PJ-Y");
      await toggleChip(c, "TYPE-M");
      asserts.check("TYPE-M だけ", snap(), { heads: [L_HEAD(0, 0), L_HEAD(0, 0), L_HEAD(0, 0)], k: L_UNDECIDABLE(1) });
      await toggleChip(c, "PJ-X");
      asserts.check("PJ-X × TYPE-M（AND）", snap().k, L_UNDECIDABLE(0));
      await clickByText(c, /すべて表示/);
      asserts.check("解除で全体に戻る", snap(), all);
      // モデル側も同じ（表示中のランで数える）
      const { model, runs } = modelOf(MAIN);
      const pjx = runs.filter((r) => r.gen === "PJ-X");
      const s = riskSections(model, { runs: pjx });
      asserts.check("PJ-X（モデル）", [secCounts(s), s.undecidable.length], [[["不適合", 2, 1], ["期限前", 4, 1], ["予告", 2, 1]], 1]);
    },
  },
  {
    id: "B2-export-unchanged",
    name: "B2：印・件数・並びは表示時の導出だけ。JSON書き出しのデータ・項目・版が変わらない",
    expect: "開閉・すべて展開／たたむ・フィルターの前後で JSON書き出しが1文字も変わらない。書き出しは読み込んだデータと同じ項目・schemaVersion 2 のままで、印・件数の項目が無い",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, MAIN);
      const before = await exportJson(c);
      await openPanel(c);
      await clickSection(c, "期限前");
      await clickInPanel(c, /すべて展開/);
      await clickInPanel(c, /すべてたたむ/);
      await toggleChip(c, "PJ-X");
      await clickByText(c, /すべて表示/);
      const after = await exportJson(c);
      asserts.check("JSON書き出しは同じ", JSON.stringify(after), JSON.stringify(before));
      asserts.check("項目は従来どおり", Object.keys(after).sort(), ["bases", "cert", "decisions", "regs", "runs", "sameness", "schemaVersion"]);
      asserts.check("版は2のまま", after.schemaVersion, 2);
      asserts.check("判断のレコードの項目は従来どおり", [...new Set(after.decisions.map((x) => Object.keys(x).sort().join(",")))], ["cond,decidedAt,needsRecheck,reason,rid,runKey,state"]);
      asserts.check("印・件数の項目は保存データに無い", /exemptMark|riskCompliance|undecidable|うち対象外|判定不能 ラン/.test(JSON.stringify(after)), false);
      asserts.check("判断の内容は読み込んだまま（要再確認の付与・解除をしない）",
        after.decisions.map((x) => [x.runKey, x.rid, x.state, x.needsRecheck]),
        // rA×K50 は条件が変わっているので、既存の掃き出し（F-04）が書き出し時に要再確認を立てる。これは F-28 で変えていない
        MAIN.decisions.map((x) => [x.runKey, x.rid, x.state, x.needsRecheck || (x.runKey === "rA" && x.rid === "g3")]));
    },
  },
  {
    id: "A5-seed",
    name: "A5：初期ダミーで A1〜A4 を現物で確かめられる",
    expect: "JSON読込なしの単体版で、3区分それぞれに「対象外」「対象外・要再確認」の行が1件以上。見出しは 3件（うち対象外1）／11件（うち対象外1）／2件（うち対象外1）。判定不能 ラン 1 件。開いた直後は変更なし",
    async run({ mount, asserts }) {
      const c = mount(undefined).container;
      await sleep(80);
      asserts.checkTrue("開いた直後は変更なし（初期データの判断は掃き出しで変わらない）", c.textContent.includes("変更なし（未書き出しの変更はありません）"));
      await openPanel(c);
      asserts.check("見出し", heads(c), [[K.不適合, L_HEAD(3, 1)], [K.期限前, L_HEAD(11, 1)], [K.予告, L_HEAD(2, 1)]]);
      asserts.check("判定不能", undecidableText(c), L_UNDECIDABLE(1));
      await clickInPanel(c, /すべて展開/);
      const s = shown(c);
      const marksIn = (kind) => s[kind].flatMap(([, rs]) => rs.map(([, m]) => m));
      asserts.check("各区分に対象外・対象外・要再確認が1件以上", RISK_KINDS.map((k) => [marksIn(k).includes(M_EXEMPT), marksIn(k).includes(M_RECHECK)]),
        [[true, true], [true, true], [true, true]]);
      asserts.check("LO が空の型式ランがある", SEED.runs.filter((r) => r.lo === "").map((r) => r.key), ["r9"]);
      asserts.check("判断の理由はすべてダミー", SEED.decisions.every((x) => x.reason.startsWith("ダミー：")), true);
    },
  },
  {
    id: "A4-api-version",
    name: "API版（サーバ保存版）でも区分見出しの表記と判定不能の件数が出る（人の判断は持たないので印は無い）",
    expect: "IListApp で 3件（うち対象外0）／4件（うち対象外0）／3件（うち対象外0）・判定不能 ラン 2 件。印は0件",
    async run({ mountApi, asserts }) {
      const cert = { "TYPE-K": Object.fromEntries(REGS.map((g) => [g.id, `CK-TYPE-K-${g.id}`])) };
      const api = installApiMock({ runs: RUNS, regs: REGS, cert });
      try {
        const c = mountApi().container;
        await sleep(150);
        await openPanel(c);
        asserts.check("見出し", heads(c), [[K.不適合, L_HEAD(3, 0)], [K.期限前, L_HEAD(4, 0)], [K.予告, L_HEAD(3, 0)]]);
        asserts.check("判定不能", undecidableText(c), L_UNDECIDABLE(2));
        await clickInPanel(c, /すべて展開/);
        asserts.check("印は無い", riskTable(c).querySelectorAll("[data-risk-exempt]").length, 0);
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
    window.__EXEMPTVERIFY_RESULT__ = { finished: false };
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
      window.__EXEMPTVERIFY_RESULT__ = {
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
    window.__runExemptVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);
  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>危険一覧の補助表示（F-28） 検証ハーネス</h1>
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
