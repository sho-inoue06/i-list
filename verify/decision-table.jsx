// ───────────────────────────────────────────────
// 判定の決定表（F-19）の検証ハーネス
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/decision-table.html
//
// 完成条件 C1〜C8（Notion「Iリスト｜バックログ」F-19）を、ケースIDの先頭で対応づける。
// C7（既存の全検証ハーネス）・C8（build）はこのページの対象外で、既存ハーネスとbuildで確認する。
//
// 852ケースの入力と期待値は verify/decision-table-cases.js に固定してある。
// この表は製品コードを一度も呼ばずに作ってあり（作り方は verify/decision-table-gen.mjs）、
// このページはその固定表と製品の出力を突き合わせるだけで、ここで期待値を計算し直さない。
// 「今日」も入力として渡すので、このページは端末の日付に依存しない（F-13〜F-15のハーネスとはここが違う）。
// ───────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import {
  decideCell, effectiveSideOf, certPlanOf, productionPhaseOf, deadlineOf, makeSamenessContext,
  evalCellWith, complianceStateOf, complianceOfDecision, approachingNoticeFor, parseImportedData,
  MatrixView, summarize, PRODUCTION_PHASES, CELL_DISPLAYS,
  migrateLegacyCert,
} from "../src/IListApp.jsx";
import { DECISION_CASES } from "./decision-table-cases.js";
import { DROP_CASES } from "./decision-table-cases-drop.js";

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
const fmt = (d) => d.replaceAll("-", "/").slice(0, 7);   // 画面表示（YYYY/MM）と同じ整形

// 決定表の出力のうち、固定表が持っている項目だけを取り出して比べる
// （比べる項目を検証側で明示し、製品が項目を増やしても期待値の形が勝手に変わらないようにする）。
const OUT_KEYS = ["生産フェーズ", "要否", "適用した規制", "車両申請", "期限", "期限日",
  "現在法規不適合", "過去に法規不適合", "法規適合必要", "黄色予告", "根拠未確認",
  "規制日", "超過", "表示"];
const pick = (o) => Object.fromEntries(OUT_KEYS.map((k) => [k, o[k]]));

// Notion「F-19」に載っている独立の試算値（AI1が別途数えたもの。2026-09-22に祥が黄色予告を100件へ改訂）。
// 固定表そのものが正しいかを、この分布で外から確かめる。
const NOTION_TALLY = {
  生産中: 408, drop済み: 252, 開発中: 192,
  要: 456, 否: 396,
  新型: 228, 継続: 228, なし: 396,
  現在法規不適合: 112, 過去に法規不適合: 56, 法規適合必要: 136,
  黄色予告: 100, 黄色継: 62, 黄色新: 38,
};

// ── 画面用のダミー（架空。実車・実法規・実認可番号とは無関係） ──
// C4・C5の見た目だけを見る。固定日付は使わず、実行時の端末ローカル日付から作る
// （画面側の「今日」は端末日付なので、期待する生産フェーズを固定日付で書くと時間で壊れるため）。
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
const YESTERDAY = shift(-1), TODAY_D = shift(0), LONG_AGO = shift(-3650), FAR = shift(3650);
const LO_SOON = shift(60);

//   DEMO-P（PJ-P）… LOが60日先 ＝ 開発中。規制日は過去だが超過にしない（C6）
//   DEMO-Q（PJ-Q）… 生産中
//   DEMO-R（PJ-R）… dropが前日 ＝ drop済み
const PHASE_DUMMY = {
  runs: [
    { key: "r601", typeId: "DEMO-P", gen: "PJ-P", sk: "継", lo: LO_SOON,  drop: FAR },
    { key: "r602", typeId: "DEMO-Q", gen: "PJ-Q", sk: "継", lo: LONG_AGO, drop: FAR },
    { key: "r603", typeId: "DEMO-R", gen: "PJ-R", sk: "継", lo: LONG_AGO, drop: YESTERDAY },
  ],
  regs: [
    { rid: "g601", id: "REG-P", label: "ダミー法規（継続車日は遠い過去）", shin: LONG_AGO, kei: LONG_AGO, parent: "" },
  ],
  cert: {},
};

// C4の見た目を見るためのダミー。1つの法規行に対して、5つの表示区分を1列ずつ並べる。
//   r611 実績あり／r612 引き継ぎ確認中（evalCell側で立てる）／r613 申請発生／
//   r614 否（継続車日が遠い将来）／r615 否・予告（dropの10日後に継続車日）
const DISPLAY_DUMMY = {
  runs: [
    { key: "r611", typeId: "DEMO-K1", gen: "PJ-K", sk: "継", lo: LONG_AGO, drop: FAR },
    { key: "r612", typeId: "DEMO-K2", gen: "PJ-K", sk: "継", lo: LONG_AGO, drop: FAR },
    { key: "r613", typeId: "DEMO-K3", gen: "PJ-K", sk: "継", lo: LONG_AGO, drop: FAR },
    { key: "r614", typeId: "DEMO-K4", gen: "PJ-K", sk: "継", lo: LONG_AGO, drop: shift(-400) },
    { key: "r615", typeId: "DEMO-K5", gen: "PJ-K", sk: "継", lo: LONG_AGO, drop: shift(5) },
  ],
  regs: [{ rid: "g611", id: "REG-K", label: "ダミー法規K", shin: LONG_AGO, kei: shift(15), parent: "" }],
  cert: { "DEMO-K1": { "REG-K": "CK-611" }, "DEMO-K2": { "REG-K": "CK-612" } },
};
// 期待する色（検証側で独立に書き、製品の定数を借りない）
const GREEN_RGB = "rgb(63, 191, 143)", RED_RGB = "rgb(255, 107, 87)",
      LINE_RGB = "rgb(34, 48, 63)", AMBER_RGB = "rgb(224, 178, 77)";
const alphaOf = (rgba) => { const m = rgba.match(/rgba?\(([^)]+)\)/); if (!m) return 1;
  const parts = m[1].split(",").map((x) => Number(x)); return parts.length > 3 ? parts[3] : 1; };

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
    mountNode,
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
const matrix = (c) => c.querySelectorAll("table")[0];
const headerCell = (c, col) => matrix(c).querySelectorAll("thead th")[col + 1];
const cellAt = (c, row, col) => matrix(c).querySelectorAll("tbody tr")[row].querySelectorAll("td")[col + 1];
const cellText = (c, row, col) => cellAt(c, row, col).textContent;
const cellBox = (c, row, col) => getComputedStyle(cellAt(c, row, col).querySelector("div"));

// ───────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "C1-shape",
    name: "C1：決定表が1つの関数で、決定表どおりの項目を返す",
    expect: "decideCell が10項目＋画面用3項目を返し、生産フェーズ・表示の値域が定数どおり。判定はこの関数だけが持つ",
    run: async ({ asserts }) => {
      const d = decideCell({ lo: "2020-01-01", drop: "2025-12-31", shin: "2019-01-01", kei: "2021-01-01",
        today: "2026-01-01", certPlan: "実績なし+予定なし", side: "新" });
      // F-24：印の項目 drop未定 と、表示の「判定不能」が増えた（A2・A3）。F-19の13項目はそのまま。
      asserts.check("返す項目", Object.keys(d).sort(), [...OUT_KEYS, "drop未定"].sort());
      asserts.check("生産フェーズの値域", PRODUCTION_PHASES, ["開発中", "生産中", "drop済み"]);
      asserts.check("表示の値域", CELL_DISPLAYS, ["否", "否・予告", "実績あり", "引き継ぎ確認中", "申請発生", "判定不能"]);
      // 新型車規制はLOで、継続車規制はdropで比べる（両方をdropで比べるのは誤り）
      asserts.check("新型車規制はLOで比べる",
        [decideCell({ lo: "2020-01-01", drop: "2025-12-31", shin: "2019-01-01", kei: "2030-01-01", today: "2026-01-01", side: "新" }).適用した規制,
         decideCell({ lo: "2020-01-01", drop: "2025-12-31", shin: "2021-01-01", kei: "2030-01-01", today: "2026-01-01", side: "新" }).適用した規制],
        ["新型", "なし"]);
      asserts.check("継続側は新型車日を見ない",
        decideCell({ lo: "2020-01-01", drop: "2025-12-31", shin: "2019-01-01", kei: "2030-01-01", today: "2026-01-01", side: "継" }).適用した規制,
        "なし");
      // 引き継ぎ確認中は表示だけに効く（業務状態は動かない）
      const base = decideCell({ lo: "2020-01-01", drop: "2025-12-31", shin: "2019-01-01", kei: "2021-01-01", today: "2026-01-01", certPlan: "実績あり", side: "新" });
      const hand = decideCell({ lo: "2020-01-01", drop: "2025-12-31", shin: "2019-01-01", kei: "2021-01-01", today: "2026-01-01", certPlan: "実績あり", side: "新", handover: true });
      asserts.check("引き継ぎ確認中は表示だけを変える",
        [base.表示, hand.表示, JSON.stringify({ ...base, 表示: 0 }) === JSON.stringify({ ...hand, 表示: 0 })],
        ["実績あり", "引き継ぎ確認中", true]);
    },
  },
  {
    id: "C2-all-852",
    name: "C2：852ケースを総当たりで、固定した期待値の表と突き合わせる",
    expect: "852件すべてが固定表と一致。件数も852・順序142・認証3・区分2の内訳どおり",
    run: async ({ asserts }) => {
      asserts.check("ケース数", DECISION_CASES.length, 852);
      asserts.check("順序ケース数", new Set(DECISION_CASES.map((r) => r.id.split("/")[0])).size, 142);
      asserts.check("認証の3状態", new Set(DECISION_CASES.map((r) => r.in.certPlan)).size, 3);
      asserts.check("実効の適用区分", [...new Set(DECISION_CASES.map((r) => r.in.side))].sort(), ["新", "継"]);
      const bad = [];
      for (const r of DECISION_CASES) {
        const got = pick(decideCell({ ...r.in }));
        if (JSON.stringify(got) !== JSON.stringify(r.out)) {
          bad.push(`${r.id}\n  入力=${JSON.stringify(r.in)}\n  期待=${JSON.stringify(r.out)}\n  実際=${JSON.stringify(got)}`);
        }
      }
      asserts.check("固定表と一致しないケース数", bad.length, 0);
      if (bad.length) asserts.failures.push(bad.slice(0, 8).join("\n"));
    },
  },
  {
    id: "A5-F24-drop-cases",
    name: "F-24 A5：決定表の入力に drop未定・LO未入力 を加えた402ケースを、固定した期待値の表と突き合わせる",
    expect: "402件（drop未定186・LO未入力216）がすべて固定表と一致。drop未定は全件「要」・予告なし・drop済みにならない／LO未入力は全件「判定不能」",
    run: async ({ asserts }) => {
      const U = DROP_CASES.filter((r) => r.id.startsWith("U")), L = DROP_CASES.filter((r) => r.id.startsWith("L"));
      asserts.check("ケース数（drop未定・LO未入力）", [DROP_CASES.length, U.length, L.length], [402, 186, 216]);
      asserts.check("drop未定の入力は drop が空・LOあり", U.every((r) => r.in.drop === "" && r.in.lo !== ""), true);
      asserts.check("LO未入力の入力は LO が空（drop空を含む）",
        [L.every((r) => r.in.lo === ""), L.some((r) => r.in.drop === ""), L.some((r) => r.in.drop !== "")], [true, true, true]);
      const pickF24 = (o) => ({ ...pick(o), drop未定: o.drop未定 });
      const bad = [];
      for (const r of DROP_CASES) {
        const got = pickF24(decideCell({ ...r.in }));
        if (JSON.stringify(got) !== JSON.stringify(r.out))
          bad.push(`${r.id}\n  入力=${JSON.stringify(r.in)}\n  期待=${JSON.stringify(r.out)}\n  実際=${JSON.stringify(got)}`);
      }
      asserts.check("固定表と一致しないケース数", bad.length, 0);
      if (bad.length) asserts.failures.push(bad.slice(0, 8).join("\n"));
      // 表の性質（期待値の表そのものの点検。A1・A3・B2）
      asserts.check("drop未定は全件「要」", U.every((r) => r.out.要否 === "要"), true);
      asserts.check("drop未定に予告・drop済み・過去に不適合は無い",
        U.some((r) => r.out.黄色予告 || r.out.生産フェーズ === "drop済み" || r.out.過去に法規不適合), false);
      asserts.check("LO未入力は全件「判定不能」・危険の2条件に当たらない",
        L.every((r) => r.out.表示 === "判定不能" && !r.out.現在法規不適合 && !r.out.黄色予告), true);
      asserts.check("どのケースも「否」を出さない（B2）", DROP_CASES.some((r) => r.out.要否 === "否" || r.out.表示.startsWith("否")), false);
      // 空の書き方の違い（undefined・null・空白だけ）も同じ扱い
      const inp = { lo: "2040-01-01", shin: "2039-01-01", kei: "2041-01-01", today: "2040-06-01", side: "継" };
      asserts.check("dropの空の書き方（'' / 空白 / undefined / null）",
        ["", "  ", undefined, null].map((drop) => [decideCell({ ...inp, drop }).要否, decideCell({ ...inp, drop }).drop未定]),
        [["要", true], ["要", true], ["要", true], ["要", true]]);
      asserts.check("LOの空の書き方（'' / 空白 / undefined / null）",
        ["", "  ", undefined, null].map((lo) => decideCell({ ...inp, lo, drop: "2045-01-01" }).表示),
        ["判定不能", "判定不能", "判定不能", "判定不能"]);
      asserts.check("LOもdropも空なら判定不能を優先（drop未定の印は付けない）",
        [decideCell({ ...inp, lo: "", drop: "" }).表示, decideCell({ ...inp, lo: "", drop: "" }).drop未定], ["判定不能", false]);
      asserts.check("LO・dropが両方入っていれば drop未定 は付かない", decideCell({ ...inp, drop: "2045-01-01" }).drop未定, false);
      // B1：LO・dropが両方入っている852件には、印も判定不能も1件も出ない（852件の中身の一致は C2-all-852）
      asserts.check("852件に drop未定・判定不能が出ない",
        DECISION_CASES.filter((r) => { const d = decideCell({ ...r.in }); return d.drop未定 !== false || d.表示 === "判定不能"; }).length, 0);
      // evalCellWith の状態：判定不能は否（off）と区別する
      asserts.check("evalCellWith の状態（判定不能・drop未定）",
        [evalCellWith({}, { key: "x", sk: "継", lo: "", drop: "2045-01-01" }, { rid: "g1", shin: inp.shin, kei: inp.kei }, null, inp.today).status,
         evalCellWith({}, { key: "x", sk: "継", lo: inp.lo, drop: "" }, { rid: "g1", shin: inp.shin, kei: inp.kei }, null, inp.today).status],
        ["unknown", "leak"]);
    },
  },
  {
    id: "C2-tally",
    name: "C2：852ケースの分布が、Notionの独立した試算値と一致する",
    expect: "生産中408/drop済み252/開発中192、要456/否396、新型228/継続228/なし396、現在112/過去56/適合必要136、黄色100（継62・新38）",
    run: async ({ asserts }) => {
      const t = { 生産中: 0, drop済み: 0, 開発中: 0, 要: 0, 否: 0, 新型: 0, 継続: 0, なし: 0,
        現在法規不適合: 0, 過去に法規不適合: 0, 法規適合必要: 0, 黄色予告: 0, 黄色継: 0, 黄色新: 0 };
      for (const r of DECISION_CASES) {
        const d = decideCell({ ...r.in });
        t[d.生産フェーズ]++; t[d.要否]++; t[d.適用した規制]++;
        if (d.現在法規不適合) t.現在法規不適合++;
        if (d.過去に法規不適合) t.過去に法規不適合++;
        if (d.法規適合必要) t.法規適合必要++;
        if (d.黄色予告) { t.黄色予告++; t["黄色" + r.in.side]++; }
      }
      asserts.check("分布", t, NOTION_TALLY);
    },
  },
  {
    id: "C2-invariants",
    name: "C2：852ケースで決定表の矛盾が1件も起きない",
    expect: "否なのに不適合0件／現在と過去の不適合が同時0件／要+実績なしで状態が付かない0件／開発中なのに超過0件",
    run: async ({ asserts }) => {
      let 否なのに不適合 = 0, 現在と過去同時 = 0, 要実績なしで状態なし = 0, 開発中なのに超過 = 0, 表示の値域外 = 0;
      for (const r of DECISION_CASES) {
        const d = decideCell({ ...r.in });
        const 状態あり = d.現在法規不適合 || d.過去に法規不適合 || d.法規適合必要;
        if (d.要否 === "否" && 状態あり) 否なのに不適合++;
        if (d.現在法規不適合 && d.過去に法規不適合) 現在と過去同時++;
        if (d.要否 === "要" && r.in.certPlan !== "実績あり" && !状態あり) 要実績なしで状態なし++;
        if (d.生産フェーズ === "開発中" && d.超過) 開発中なのに超過++;
        if (!CELL_DISPLAYS.includes(d.表示)) 表示の値域外++;
      }
      asserts.check("矛盾の件数", [否なのに不適合, 現在と過去同時, 要実績なしで状態なし, 開発中なのに超過, 表示の値域外],
        [0, 0, 0, 0, 0]);
    },
  },
  {
    id: "C3-effective-side",
    name: "C3：実効の適用区分を、指定区分と同一性から決定表どおりに決める",
    expect: "同一→継／同一でない→新／未確認→新＋根拠未確認はい／比較元なし→指定区分そのまま・根拠未確認いいえ",
    run: async ({ asserts }) => {
      const 新ラン = { sk: "新" }, 継ラン = { sk: "継" };
      asserts.check("同一は継", effectiveSideOf(新ラン, "同一"), { side: "継", 根拠未確認: false });
      asserts.check("同一でないは新", effectiveSideOf(継ラン, "同一でない"), { side: "新", 根拠未確認: false });
      asserts.check("未確認は新＋根拠未確認", effectiveSideOf(継ラン, "未確認"), { side: "新", 根拠未確認: true });
      asserts.check("比較元なし（null）は指定区分",
        [effectiveSideOf(新ラン, null), effectiveSideOf(継ラン, null)],
        [{ side: "新", 根拠未確認: false }, { side: "継", 根拠未確認: false }]);
      asserts.check("比較元なし（省略）も指定区分",
        [effectiveSideOf(新ラン).side, effectiveSideOf(継ラン).side], ["新", "継"]);
      asserts.check("比較元なしは根拠未確認にしない",
        [effectiveSideOf(新ラン, null).根拠未確認, effectiveSideOf(継ラン, undefined).根拠未確認], [false, false]);
      // evalCellWith を通しても同じ：未確認の継ランが新型車側で判定される
      const run = { typeId: "T", sk: "継", lo: "2020-01-01", drop: "2021-12-31" };
      const reg = { id: "G", shin: "2019-01-01", kei: "2030-01-01" };
      asserts.check("未確認の継ランは新型車側で要になる",
        [evalCellWith({}, run, reg, "未確認").kind, effectiveSideOf(run, "未確認").根拠未確認], ["新型", true]);
      asserts.check("比較元なしの継ランは従来どおり否",
        [evalCellWith({}, run, reg).kind, effectiveSideOf(run, null).根拠未確認], ["", false]);
      // evalCellWith の戻り値の形は従来のまま（決定表の出力は載せない）
      asserts.check("戻り値の項目は従来どおり", Object.keys(evalCellWith({}, run, reg)).sort(),
        ["applied", "ck", "dueDate", "kind", "required", "status"]);
      asserts.check("認証の読み替え", [certPlanOf("CK-1"), certPlanOf(null), certPlanOf("")],
        ["実績あり", "実績なし+予定なし", "実績なし+予定なし"]);
    },
  },
  {
    id: "C4-cell-display",
    name: "C4：セルの見た目が決定表の「表示」から決まる（実績あり＝濃い緑／引き継ぎ確認中＝薄い緑・破線）",
    expect: "5つの表示区分が枠色・枠線の形・文言で区別できる。引き継ぎ確認中だけが破線で、背景が薄い",
    run: async ({ mountNode, asserts }) => {
      const base = { lo: "2020-01-01", drop: "2025-12-31", shin: "2019-01-01", kei: "2021-01-01", today: "2026-01-01", side: "新" };
      asserts.check("実績あり", decideCell({ ...base, certPlan: "実績あり" }).表示, "実績あり");
      asserts.check("引き継ぎ確認中", decideCell({ ...base, certPlan: "実績あり", handover: true }).表示, "引き継ぎ確認中");
      asserts.check("申請発生", decideCell({ ...base, certPlan: "実績なし+予定なし" }).表示, "申請発生");
      asserts.check("否", decideCell({ lo: "2020-01-01", drop: "2025-12-31", shin: "2021-01-01", kei: "2030-01-01", today: "2026-01-01", side: "新" }).表示, "否");
      asserts.check("否・予告", decideCell({ lo: "2020-01-01", drop: "2026-01-10", shin: "2021-01-01", kei: "2026-01-20", today: "2026-01-01", side: "新" }).表示, "否・予告");

      // 画面：引き継ぎ確認中は、いまの認証実績（型式×法規）では実データから作れない（F-19 未決事項）。
      // そこで MatrixView へ渡す evalCell のほうで handover を立て、見た目だけを確かめる。
      // 製品の経路（StandaloneApp・IListApp）は常に handover=false を渡すので、ここは見た目専用のダミーである。
      // ダミーの認証実績は旧形式で書いてある。読み込み時と同じ規則（F-22 A5）で型式ラン × 法規行へ移して渡す。
      const runs = DISPLAY_DUMMY.runs, regs = DISPLAY_DUMMY.regs, cert = migrateLegacyCert(DISPLAY_DUMMY.cert, runs, regs);
      const evalCellHandover = (run, r) => {
        const e = evalCellWith(cert, run, r);
        return run.key === "r612" ? { ...e, handover: true } : e;
      };
      const h = mountNode(<MatrixView runs={runs} regs={regs} evalCell={evalCellHandover}
        summary={summarize(runs, regs, cert)} colorOf={() => "#4dd6e0"} />);
      await sleep(60);
      const c = h.container;
      //   列0 r611 実績あり（濃い緑・実線）／列1 r612 引き継ぎ確認中（薄い緑・破線）
      //   列2 r613 申請発生（赤・実線）／列3 r614 否（灰・実線）／列4 r615 否・予告（黄・実線）
      asserts.check("枠の色", [0, 1, 2, 3, 4].map((i) => cellBox(c, 0, i).borderTopColor),
        [GREEN_RGB, GREEN_RGB, RED_RGB, LINE_RGB, AMBER_RGB]);
      asserts.check("破線は引き継ぎ確認中だけ", [0, 1, 2, 3, 4].map((i) => cellBox(c, 0, i).borderTopStyle),
        ["solid", "dashed", "solid", "solid", "solid"]);
      asserts.check("実績ありのほうが背景が濃い",
        alphaOf(cellBox(c, 0, 0).backgroundColor) > alphaOf(cellBox(c, 0, 1).backgroundColor), true);
      asserts.check("文言", [cellText(c, 0, 0).includes("CK-611"), cellText(c, 0, 1).includes("引き継ぎ確認中"),
        cellText(c, 0, 2).includes("申請発生"), cellText(c, 0, 4).includes("否・要再確認")],
        [true, true, true, true]);
      asserts.check("引き継ぎ確認中も「要」のまま（判定は動かない）",
        [cellText(c, 0, 1).includes("要"), cellText(c, 0, 1).includes("申請発生")], [true, false]);
    },
  },
  {
    id: "C5-header-phase",
    name: "C5：型式ランの列見出しに生産フェーズが1語だけ出る",
    expect: "開発中／生産中／drop済み が列見出しに出る。セルの状態名には混ざらない",
    run: async ({ mount, asserts }) => {
      const c = await mountWith(mount, PHASE_DUMMY);
      asserts.check("列見出しのフェーズ", [0, 1, 2].map((i) => {
        const t = headerCell(c, i).textContent;
        return PRODUCTION_PHASES.find((p) => t.includes(p)) || "(なし)";
      }), ["開発中", "生産中", "drop済み"]);
      asserts.check("純関数と一致", PHASE_DUMMY.runs.map((r) => productionPhaseOf(r.lo, r.drop, TODAY_D)),
        ["開発中", "生産中", "drop済み"]);
      // セルの状態名にフェーズの語が混ざっていないこと（drop済み は「drop済み（対応対象外）」とは別物）
      asserts.check("セルに素の「開発中」「生産中」は出ない",
        [0, 1, 2].map((i) => /開発中|(?<!drop)生産中/.test(cellText(c, 0, i))), [false, false, false]);
    },
  },
  {
    id: "C6-deadline-max",
    name: "C6：期限が max（適用した規制日、LO）になり、開発中のランに超過・法規不適合が出ない",
    expect: "規制日が先でもLOがもっと先ならLOが期限。LO未到来のランは超過にならず、橙の「要対応｜LOまで」になる",
    run: async ({ mount, asserts }) => {
      // 規制日もLOもこれからで、LOのほうが後 → 期限はLO（F-19で変わった点）
      const dl = (r, l, t) => { const x = deadlineOf(r, l, t); return [x.期限, x.期限日, x.超過]; };
      asserts.check("両方これからならmaxを取る", dl("2026-02-01", "2026-06-01", "2026-01-01"), ["LO", "2026-06-01", false]);
      asserts.check("LOが規制日より前なら規制日", dl("2026-06-01", "2026-02-01", "2026-01-01"), ["規制日", "2026-06-01", false]);
      asserts.check("同日は規制日側", dl("2026-06-01", "2026-06-01", "2026-01-01"), ["規制日", "2026-06-01", false]);
      asserts.check("両方過ぎていれば超過", dl("2020-01-01", "2021-01-01", "2026-01-01"), ["LO", "2021-01-01", true]);
      asserts.check("規制日は過ぎたがLOがまだなら超過にしない", dl("2020-01-01", "2026-06-01", "2026-01-01"), ["LO", "2026-06-01", false]);
      // 852ケース全体で「開発中なら超過しない」ことは C2-invariants で確認済み。ここは画面で見る。
      const c = await mountWith(mount, PHASE_DUMMY);
      asserts.check("開発中のランは法規不適合にしない",
        [cellText(c, 0, 0).includes("法規不適合"), cellText(c, 0, 0).includes(`要対応｜${fmt(LO_SOON)}まで`)],
        [false, true]);
      asserts.check("生産中のランは法規不適合", cellText(c, 0, 1).includes("法規不適合"), true);
      asserts.check("drop済みのランは過去に法規不適合", cellText(c, 0, 2).includes("過去に法規不適合（drop済み）"), true);
      // complianceStateOf も同じ期限の見方を使う
      asserts.check("状態表示もmaxを使う",
        complianceStateOf({ dueDate: "2026-02-01", drop: "2030-01-01", lo: "2026-06-01", today: "2026-01-01" }).label,
        `要対応｜${fmt("2026-06-01")}まで`);
    },
  },
  {
    id: "C1-review-1-state-from-decision",
    name: "C1（レビュー指摘1）：申請発生セルの4状態も決定表の出力から作る。表示側で日付から再判定しない",
    expect: "前提外のデータ（LO > drop）でも、決定表の不適合フラグと画面の状態名が食い違わない",
    run: async ({ asserts }) => {
      // 指摘1の再現入力：LO=2027-01-01 / drop=2025-12-31（LOがdropより後）/ 新型車日=2020-01-01 /
      //                  継続車日=2030-01-01 / 今日=2026-09-22 / 新・実績なし
      const IN = { lo: "2027-01-01", drop: "2025-12-31", shin: "2020-01-01", kei: "2030-01-01",
        today: "2026-09-22", side: "新", certPlan: "実績なし+予定なし" };
      const d = decideCell(IN);
      asserts.check("決定表の出力", [d.生産フェーズ, d.要否, d.超過, d.現在法規不適合, d.過去に法規不適合, d.法規適合必要],
        ["開発中", "要", false, false, false, true]);
      const view = complianceOfDecision(d, { lo: IN.lo, drop: IN.drop, dueDate: d.規制日 });
      asserts.check("画面の状態名は決定表と同じ側（過去不適合にしない）", view.state, "要対応");
      asserts.check("期限はLO（max）", view.label, `要対応｜${fmt(IN.lo)}まで`);
      // 決定表を持たない入口（complianceStateOf）も同じ答えになる
      asserts.check("complianceStateOf も一致",
        complianceStateOf({ dueDate: d.規制日, drop: IN.drop, lo: IN.lo, today: IN.today }).label, view.label);
      // 852ケース全体でも、決定表の3フラグと画面の状態名が1対1で対応する
      const bad = [];
      for (const r of DECISION_CASES) {
        const dd = decideCell({ ...r.in });
        if (dd.要否 !== "要" || r.in.certPlan === "実績あり") continue;
        const v = complianceOfDecision(dd, { lo: r.in.lo, drop: r.in.drop, dueDate: dd.規制日 });
        const 期待 = dd.現在法規不適合 ? "法規不適合" : dd.過去に法規不適合 ? "過去不適合" : "要対応";
        if (v.state !== 期待) bad.push(`${r.id}: 期待=${期待} 実際=${v.state}`);
      }
      asserts.check("852ケースで決定表と状態名が食い違う件数", bad.length, 0);
      if (bad.length) asserts.failures.push(bad.slice(0, 5).join("\n"));
    },
  },
  {
    id: "C3-review-23-unconfirmed-text",
    name: "C3（レビュー指摘2・3）：未確認のセルに「安全側で新型車側にした」ことが出る",
    expect: "指定区分が継でも「新継どおり」とは書かず、未確認のため新型車側で判定したことが画面に出る",
    run: async ({ mountNode, asserts }) => {
      // 指摘2・3の再現入力：指定区分=継、有効な比較元あり、同一性未回答、
      //   LO=2023-01-01 / drop=2028-01-01 / 新型車日=2020-01-01 / 継続車日=2030-01-01
      const runs = [
        { key: "r621", typeId: "DEMO-M1", gen: "PJ-M", sk: "新", lo: "2023-01-01", drop: "2028-01-01" },
        { key: "r622", typeId: "DEMO-M2", gen: "PJ-M", sk: "継", lo: "2023-01-01", drop: "2028-01-01" },
      ];
      const regs = [{ rid: "g621", id: "REG-M", label: "ダミー法規M", shin: "2020-01-01", kei: "2030-01-01", parent: "" }];
      const bases = [{ runKey: "r622", baseRunKey: "r621", decidedAt: "2026-09-22 10:00" }];
      const sameCtx = makeSamenessContext(runs, bases, []);   // 同一性は未回答（レコード無し）
      asserts.check("決定表は根拠未確認＝はい・新型車側",
        [sameCtx.effective(runs[1], regs[0]), effectiveSideOf(runs[1], sameCtx.effective(runs[1], regs[0]))],
        ["未確認", { side: "新", 根拠未確認: true }]);
      const evalCell = (run, r) => evalCellWith({}, run, r, sameCtx.effective(run, r));
      asserts.check("指定区分は継だが新型で要になる", [evalCell(runs[1], regs[0]).kind, evalCell(runs[1], regs[0]).status],
        ["新型", "leak"]);
      const h = mountNode(<MatrixView runs={runs} regs={regs} evalCell={evalCell}
        summary={summarize(runs, regs, {}, sameCtx.effective)} colorOf={() => "#4dd6e0"}
        sameCtx={sameCtx} onSaveSameness={() => {}} />);
      await sleep(60);
      const t = cellText(h.container, 0, 1);
      asserts.check("「新継どおり」とは書かない", t.includes("新継どおり"), false);
      asserts.check("未確認のため安全側であることが出る",
        [t.includes("未確認のため安全側"), t.includes("新型車日を適用"), t.includes("同一性")], [true, true, true]);
    },
  },
  {
    id: "C6-unchanged",
    name: "C6：要否・色・認可書番号は変わらない（変わるのは期限の表示と列見出しだけ）",
    expect: "要否と黄色予告の入口（evalCellWith・approachingNoticeFor）が従来どおりの形の値を返す",
    run: async ({ mount, asserts }) => {
      // F-22：認証実績は型式ラン × 法規行で引くので、ダミーのラン・法規行にキー（key・rid）を持たせる
      const run = { key: "r699", typeId: "DEMO-Q", sk: "継", lo: LONG_AGO, drop: FAR };
      const reg = { rid: "g699", id: "REG-P", shin: LONG_AGO, kei: LONG_AGO };
      const e = evalCellWith([{ runKey: "r699", rid: "g699", ck: "CK-1", planned: false }], run, reg);
      asserts.check("認可書ありは緑のまま", [e.required, e.kind, e.ck, e.status], [true, "継続", "CK-1", "ok"]);
      const e2 = evalCellWith({}, run, reg);
      asserts.check("認可書なしは申請発生のまま", [e2.required, e2.kind, e2.ck, e2.status], [true, "継続", null, "leak"]);
      asserts.check("期日は適用した規制日のまま", [e.dueDate, e2.dueDate], [LONG_AGO, LONG_AGO]);
      // 黄色予告：窓の中・これから来る継続車日なら出る／今日以前なら出ない（F-15を維持）
      // F-24：LOが空のランは判定不能で予告も出ないので、ダミーのランには過去のLOを持たせる（LOは予告の条件に効かない）。
      asserts.check("窓の中でこれからは出る",
        approachingNoticeFor("off", { lo: LONG_AGO, drop: shift(5) }, { kei: shift(15) }), { days: 10, keiDate: shift(15) });
      asserts.check("継続車日が今日以前は出ない",
        [approachingNoticeFor("off", { lo: LONG_AGO, drop: shift(-11) }, { kei: YESTERDAY }),
         approachingNoticeFor("off", { lo: LONG_AGO, drop: shift(-10) }, { kei: TODAY_D })], [null, null]);
      asserts.check("実績ありのセルには出さない（決定表のゲート）",
        decideCell({ lo: LONG_AGO, drop: shift(5), shin: LONG_AGO, kei: shift(15), today: TODAY_D, side: "継", certPlan: "実績あり" }).黄色予告,
        null);
      asserts.check("実績なしなら出す",
        decideCell({ lo: LONG_AGO, drop: shift(5), shin: LONG_AGO, kei: shift(15), today: TODAY_D, side: "継", certPlan: "実績なし+予定なし" }).黄色予告,
        { days: 10, keiDate: shift(15) });
    },
  },
];

// ───────────────────────────────────────────────
function Runner() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const runAll = async () => {
    if (window.__DTVERIFY_RUNNING__) return;
    window.__DTVERIFY_RUNNING__ = true;
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
          await s.run({ mount: mgr.mount, mountNode: mgr.mountNode, asserts });
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
      window.__DTVERIFY_RESULT__ = {
        finished: true,
        pass: vals.filter((r) => r.pass).length,
        fail: vals.filter((r) => !r.pass).length,
        total: SCENARIOS.length,
        cases: DECISION_CASES.length,
        residualNodes: document.getElementById("sandbox").childElementCount,
        scenarios: SCENARIOS.map((s) => ({ id: s.id, name: s.name, pass: collected[s.id]?.pass, actual: collected[s.id]?.actual, detail: collected[s.id]?.detail })),
      };
      window.__DTVERIFY_RUNNING__ = false;
    }
  };
  useEffect(() => {
    window.__runDecisionTableVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);
  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>判定の決定表（F-19） 検証ハーネス</h1>
      <p style={{ color: "#5a6b7d", fontSize: 12.5, lineHeight: 1.7, marginTop: 0 }}>
        852ケースの入力と期待値は <code>verify/decision-table-cases.js</code> に固定してあります（製品コードを呼ばずに作った表）。
        「今日」も入力として渡すため、純関数のケースは端末の日付に依存しません。<br />
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
          総合結果: PASS {pass} / FAIL {fail}（全 {SCENARIOS.length} 件・決定表 {DECISION_CASES.length} ケース）
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
