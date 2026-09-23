// ───────────────────────────────────────────────
// 主要状態が消えないデモデータ（F-20）の検証ハーネス
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない
// （API版のケースでは window.fetch をモックする）。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/seed-demo.html
//
// 完成条件 A0〜A10（Notion「Iリスト｜バックログ」F-20）を、ケースIDの先頭で対応づける。
// A0（着手時の確認とSEED参照の洗い出し）・A9の両build成功はこのページの対象外。
//
// 期待値に固定日付を書かない。F-13と同じく、実行時の端末ローカル日付から相対日付を作る。
// ───────────────────────────────────────────────
import React from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import IListApp, {
  SEED, buildSeed, TODAY, seedDate, parseImportedData, decideCell, riskOfCell, riskRunRows,
  buildCellModel, evalCellWith, makeSamenessContext,
} from "../src/IListApp.jsx";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));
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
const isRealDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

// ───────────────────────────────────────────────
// SEEDの対応表（A1）。**これがF-20の契約そのもの**である。
//
// 「どの業務状態が、どの型式ラン×どの法規で出るか」を検証側に独立して書き、
// 製品のSEEDから求めた実際の集合と突き合わせる。崩れてもFAIL、増えてもFAILする（A8）。
// 状態の呼び名は decideCell（F-19の決定表）の出力名に合わせてある。
// ───────────────────────────────────────────────
const STATE_MAP = {
  現在法規不適合: ["r6×DEMO-REG-C"],
  黄色予告: ["r6×DEMO-REG-E"],
  法規適合必要: ["r7×DEMO-REG-B", "r7×DEMO-REG-C", "r7×DEMO-REG-E"],
  過去に法規不適合: ["r5×DEMO-REG-B"],
  実績あり: [
    "r1×DEMO-REG-A", "r2×DEMO-REG-A", "r2×DEMO-REG-D", "r3×DEMO-REG-A", "r3×DEMO-REG-D",
    "r4×DEMO-REG-A", "r4×DEMO-REG-B", "r4×DEMO-REG-D", "r5×DEMO-REG-A", "r5×DEMO-REG-D",
    "r6×DEMO-REG-A", "r6×DEMO-REG-A2", "r6×DEMO-REG-B", "r6×DEMO-REG-D",
    "r7×DEMO-REG-A", "r7×DEMO-REG-A2", "r7×DEMO-REG-D",
  ],
  否: [
    "r1×DEMO-REG-A2", "r1×DEMO-REG-B", "r1×DEMO-REG-C", "r1×DEMO-REG-D", "r1×DEMO-REG-E",
    "r2×DEMO-REG-A2", "r2×DEMO-REG-B", "r2×DEMO-REG-C", "r2×DEMO-REG-E",
    "r3×DEMO-REG-A2", "r3×DEMO-REG-B", "r3×DEMO-REG-C", "r3×DEMO-REG-E",
    "r4×DEMO-REG-A2", "r4×DEMO-REG-C", "r4×DEMO-REG-E",
    "r5×DEMO-REG-A2", "r5×DEMO-REG-C", "r5×DEMO-REG-E",
  ],
};
const STATE_NAMES = Object.keys(STATE_MAP);

// SEEDが使っている「今日からの日数」。検証側に独立して書く（製品の値と一致することも確かめる）。
const SEED_OFFSETS = {
  runs: {
    r1: [-3300, -2450], r2: [-2440, -1350], r3: [-1990, -1350], r4: [-1340, -365],
    r5: [-1340, -365], r6: [-190, 150], r7: [120, 1550],
  },
  regs: {
    g1: [-3400, -2800], g2: [-700, 200], g3: [-2000, -1200],
    g4: [-300, 5], g5: [-2400, -1700], g6: [130, 165],
  },
};
const EXPECTED_PHASES = ["drop済み", "drop済み", "drop済み", "drop済み", "drop済み", "生産中", "開発中"];

// 写しの認証実績を「型式 × 法規ID」の単位でまとめて書き換える（対照実験用）。
// F-22 で認証実績は型式ラン×法規行になったので、その型式の全ランの該当法規行へ同じ変更をかける
// （F-22 より前の「型式×法規の値を1つ変える」と同じ効き方にするため）。ck=null は削除。
function setTypeCk(data, typeId, regId, ck) {
  const keys = data.runs.filter((r) => r.typeId === typeId).map((r) => r.key);
  const rids = data.regs.filter((r) => r.id === regId).map((r) => r.rid);
  data.cert = data.cert.filter((c) => !(keys.includes(c.runKey) && rids.includes(c.rid)));
  if (ck !== null) for (const k of keys) for (const g of rids) data.cert.push({ runKey: k, rid: g, ck, planned: false });
}

// データ1つから「状態 → セル」の対応表を作る。画面を通さず、製品と同じ入口（buildCellModel）で求める。
function stateMapOf(data, today = TODAY) {
  const { runs, regs, cert, bases, sameness } = data;
  const sameCtx = makeSamenessContext(runs, bases, sameness);
  const evalCell = (run, reg) => evalCellWith(cert, run, reg, sameCtx.effective(run, reg), today);
  const model = buildCellModel({ runs, regs, evalCell, sameCtx, today });
  const out = {}; for (const k of STATE_NAMES) out[k] = [];
  for (const m of model.list) {
    const d = m.decision;
    const s = d.現在法規不適合 ? "現在法規不適合"
      : (d.黄色予告 && m.notice) ? "黄色予告"
      : d.法規適合必要 ? "法規適合必要"
      : d.過去に法規不適合 ? "過去に法規不適合"
      : d.表示 === "実績あり" ? "実績あり" : "否";
    out[s].push(`${m.run.key}×${m.reg.id}`);
  }
  for (const k of STATE_NAMES) out[k].sort();
  return { map: out, model, runs, regs };
}
// 対応表との差分（余り・欠けの両方を出す）。空配列＝一致。
function diffStateMap(actual, expected = STATE_MAP) {
  const out = [];
  for (const k of STATE_NAMES) {
    const a = new Set(actual[k] || []), e = new Set(expected[k] || []);
    for (const x of e) if (!a.has(x)) out.push(`${k}に無い: ${x}`);
    for (const x of a) if (!e.has(x)) out.push(`${k}に余分: ${x}`);
  }
  return out;
}
// SEEDの日付が、offset表どおりに「その日」から作られているか（固定日付が1つも混ざっていないか）。
// **製品の buildSeed をその日で呼び直して**確かめるので、たまたま今日の値と一致する固定日付も見つかる。
function offsetMismatches(today) {
  const s = buildSeed(today), out = [];
  for (const r of s.runs) {
    const [lo, drop] = SEED_OFFSETS.runs[r.key];
    if (r.lo !== shift(lo, today)) out.push(`${today} ${r.key}.lo=${r.lo}（期待 ${shift(lo, today)}）`);
    if (r.drop !== shift(drop, today)) out.push(`${today} ${r.key}.drop=${r.drop}（期待 ${shift(drop, today)}）`);
  }
  for (const r of s.regs) {
    const [shin, kei] = SEED_OFFSETS.regs[r.rid];
    if (r.shin !== shift(shin, today)) out.push(`${today} ${r.id}.shin=${r.shin}（期待 ${shift(shin, today)}）`);
    if (r.kei !== shift(kei, today)) out.push(`${today} ${r.id}.kei=${r.kei}（期待 ${shift(kei, today)}）`);
  }
  // 同一性・比較元の記録日時も相対（日付部分だけ見る）
  for (const b of [...s.bases, ...s.sameness]) {
    if (b.decidedAt && b.decidedAt.slice(0, 10) !== shift(-3, today))
      out.push(`${today} decidedAt=${b.decidedAt}（期待 ${shift(-3, today)}）`);
  }
  return out;
}

// ── 画面ユーティリティ（F-10のパネル。risk.html と同じ読み方） ──
function panelEl(c) {
  const b = [...c.querySelectorAll("button")].find((x) => x.textContent.includes("危険な型式ラン"));
  if (!b) throw new Error("危険一覧のパネルが見つかりません");
  return b.parentElement.parentElement;
}
const panelToggle = (c) => [...c.querySelectorAll("button")].find((x) => x.textContent.includes("危険な型式ラン"));
const riskCountText = (c) => panelEl(c).children[0].children[1].textContent.trim();
async function openPanel(c) { panelToggle(c).click(); await sleep(40); }
async function clickInPanel(c, re) {
  const b = [...panelEl(c).querySelectorAll("button")].find((x) => re.test(x.textContent));
  if (!b) throw new Error(`パネル内のボタンが見つかりません: ${re}`);
  b.click(); await sleep(40);
}
function riskGroups(c) {
  const t = panelEl(c).querySelector("table");
  if (!t) return [];
  const out = [];
  for (const tr of t.querySelectorAll("tbody > tr")) {
    if (tr.children.length === 1) out.push({ head: tr, regs: [] });
    else if (out.length) out[out.length - 1].regs.push(tr);
  }
  return out;
}

function installApiMock(data, captured) {
  const real = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url) !== "/api/data") throw new Error("想定外のfetch: " + url);
    if (!opts || !opts.method || opts.method === "GET") return { ok: true, json: async () => clone(data) };
    if (opts.method === "PUT") { captured.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ ok: true }) }; }
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
// 単体版の「JSONに書き出し」を横取りして、いま画面が持っているデータを取り出す。
async function snapshotAll(container) {
  const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL;
  const realClick = HTMLAnchorElement.prototype.click;
  let blob = null;
  URL.createObjectURL = (b) => { blob = b; return "blob:dummy"; };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () {};
  try {
    const b = [...container.querySelectorAll("button")].find((x) => /JSONに書き出し/.test(x.textContent));
    if (!b) throw new Error("書き出しボタンが見つかりません");
    b.click();
    await sleep(60);
    if (!blob) throw new Error("書き出しのBlobを取得できませんでした");
    return JSON.parse(await blob.text());
  } finally {
    URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke;
    HTMLAnchorElement.prototype.click = realClick;
  }
}
function selectFile(container, text, name = "d.json") {
  const inp = container.querySelector('input[type="file"]');
  if (!inp) throw new Error("file input が見つかりません");
  const dt = new DataTransfer();
  dt.items.add(new File([text], name, { type: "application/json" }));
  Object.defineProperty(inp, "files", { value: dt.files, configurable: true });
  inp.dispatchEvent(new Event("change", { bubbles: true }));
}

// 絶対日付のダミー（A4用）。相対日付に書き換えられないことを確かめるので、固定値でよい
// （検証対象は「この値がそのまま残るか」であり、今日との関係を見ない）。
const ABSOLUTE_DUMMY = {
  runs: [
    { key: "r601", typeId: "TYPE-ABS1", gen: "PJ-ABS", sk: "新", lo: "2001-02-03", drop: "2009-08-07" },
    { key: "r602", typeId: "TYPE-ABS2", gen: "PJ-ABS", sk: "継", lo: "2003-04-05", drop: "2011-10-09" },
  ],
  regs: [{ rid: "g601", id: "REG-ABS", label: "ダミー法規（絶対日付）", shin: "2000-01-01", kei: "2002-01-01", parent: "" }],
  cert: {},
};

// ───────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "A1-state-map",
    name: "状態→型式ラン×法規の対応表が、SEEDの実際の集合と一致する",
    expect: "6状態それぞれについて、対応表に書いたセルだけが出る。欠けても余分に出てもFAIL",
    async run({ asserts }) {
      const { map } = stateMapOf(SEED);
      asserts.check("対応表との差分", diffStateMap(map), []);
      asserts.check("全セル数（7ラン×6法規）", Object.values(map).reduce((n, a) => n + a.length, 0), 42);
    },
  },
  {
    id: "A1-six-states-present",
    name: "6つの業務状態が、JSON読込なしの初期表示に少なくとも1セルずつある",
    expect: "現在法規不適合1・黄色予告1・法規適合必要3・過去に法規不適合1・実績あり17・否19。どれも0件でない",
    async run({ asserts }) {
      const { map, model, runs } = stateMapOf(SEED);
      asserts.check("状態ごとの件数", STATE_NAMES.map((k) => map[k].length), [1, 1, 3, 1, 17, 19]);
      asserts.checkTrue("6状態すべてが1件以上", STATE_NAMES.every((k) => map[k].length > 0));
      asserts.check("生産フェーズ（開発中・生産中・drop済みが全部ある）", runs.map((r) => model.phaseOf(r)), EXPECTED_PHASES);
      asserts.check("フェーズの種類", [...new Set(runs.map((r) => model.phaseOf(r)))].sort(), ["drop済み", "生産中", "開発中"]);
    },
  },
  {
    id: "A2-risk-panel",
    name: "F-10のパネルが、JSON読込なしで件数を出し、開くと drop前のランの不適合と予告だけが見える",
    expect: "閉じたパネルに「1 ラン・2 件」。開くと DEMO-0003（生産中・不適合1・予告1）だけ。法規適合必要・過去に法規不適合・drop済みランの予告は出ない",
    async run({ mount, asserts }) {
      const c = mount(undefined).container;
      await sleep(80);
      asserts.check("閉じたパネルの件数", riskCountText(c), "1 ラン・2 件");
      asserts.checkTrue("『該当なし』ではない", !c.textContent.includes("危険な型式ランはありません。"));
      await openPanel(c);
      await clickInPanel(c, /すべて展開/);
      const groups = riskGroups(c);
      asserts.check("一覧に出るラン", groups.map((g) => g.head.textContent.match(/DEMO-\d{4}/)?.[0]), ["DEMO-0003"]);
      asserts.check("先頭ランの内訳", groups[0].head.textContent.includes("不適合 1 件・予告 1 件"), true);
      asserts.check("先頭ランの法規行", groups[0].regs.map((tr) => tr.children[0].textContent.match(/DEMO-REG-[A-Z0-9]+/)?.[0]),
        ["DEMO-REG-C", "DEMO-REG-E"]);
      asserts.checkTrue("不適合が見える（期限を過ぎてn日）", /期限を過ぎて \d+ 日/.test(groups[0].regs[0].textContent));
      asserts.checkTrue("予告が見える（継続車規制日まで n 日）", /継続車規制日まで \d+ 日（dropの \d+ 日後）/.test(groups[0].regs[1].textContent));
      // 一覧に並ぶランはすべて drop前（生産中・開発中）であること。**これがF-20の差し戻しで加わった条件**
      const { model, runs } = stateMapOf(SEED);
      const rows = riskRunRows(model, { runs });
      asserts.check("一覧のラン（キーと生産フェーズ）", rows.map((r) => [r.run.key, r.phase]), [["r6", "生産中"]]);
      asserts.check("drop済みのランは1つも並ばない", rows.filter((r) => r.phase === "drop済み").length, 0);
      asserts.checkTrue("drop済みのランは元データには居る（消したのではなく一覧に出ないだけ）",
        runs.some((r) => model.phaseOf(r) === "drop済み"));
      // 出さないもの（F-10の定義どおり）
      const panelText = panelEl(c).textContent;
      asserts.check("法規適合必要（r7）は一覧に出ない", panelText.includes("DEMO-0004"), false);
      asserts.check("過去に法規不適合（r5×REG-B）の 000C は一覧に出ない", panelText.includes("000C"), false);
      // 帳票側には残っている
      asserts.checkTrue("過去に法規不適合はマトリクスには残る", c.textContent.includes("過去に法規不適合（drop済み）"));
    },
  },
  {
    id: "A3-seed-date",
    name: "相対日付は必ず実在する日付になり、同じ日なら同じ値になる",
    expect: "前後4000日すべてが実在するYYYY-MM-DD。月末・年末・うるう年をまたいでも正しい。2回呼べば同じ値",
    async run({ asserts }) {
      let bad = 0;
      for (let n = -4000; n <= 4000; n++) if (!isRealDate(seedDate(n))) bad++;
      asserts.check("実在しない日付の数（±4000日）", bad, 0);
      asserts.check("うるう年（2028-02-28の翌日）", seedDate(1, "2028-02-28"), "2028-02-29");
      asserts.check("うるう年の翌日", seedDate(1, "2028-02-29"), "2028-03-01");
      asserts.check("平年の2月28日の翌日", seedDate(1, "2027-02-28"), "2027-03-01");
      asserts.check("年末をまたぐ", seedDate(1, "2026-12-31"), "2027-01-01");
      asserts.check("年始から前日へ", seedDate(-1, "2027-01-01"), "2026-12-31");
      asserts.check("100年先のうるう年（2100年は平年）", seedDate(1, "2100-02-28"), "2100-03-01");
      asserts.check("同じ日なら同じ値", [seedDate(-1340), seedDate(-1340)], [seedDate(-1340), seedDate(-1340)]);
      asserts.check("0日は今日そのもの", seedDate(0), TODAY);
      asserts.check("製品のTODAYは検証側で独立に求めた今日と一致", TODAY, LOCAL_TODAY);
      // SEEDの日付が、検証側のoffset表どおりに作られている（今日の分）
      asserts.check("今日のSEEDがoffset表と一致", offsetMismatches(LOCAL_TODAY), []);
      asserts.check("SEEDは buildSeed(今日) と同じ", JSON.stringify(SEED), JSON.stringify(buildSeed(LOCAL_TODAY)));
      // **別の日で組み直しても**全部の日付が同じだけ動く＝固定日付が1つも混ざっていない。
      // （たまたま今日の値と一致する固定日付を、その日のうちに見つけるための確認）
      asserts.check("別の日で組み直しても全部の日付が動く",
        [shift(1), shift(-1), shift(37), shift(-400), "2032-02-29"].flatMap((t) => offsetMismatches(t)), []);
    },
  },
  {
    id: "A3-time-travel",
    name: "日が進んでも対応表が変わらない（主要状態が消えない）",
    expect: "翌日・1か月後・1年後・4年後・27年後に開いても、6状態の対応表とF-10の一覧（1ラン・2件・drop前だけ）が今日と同じになる",
    async run({ asserts }) {
      const base = stateMapOf(SEED).map;
      const days = [1, 2, 7, 29, 30, 31, 40, 151, 166, 200, 365, 366, 1000, 1461, 10000];
      const broken = [];
      for (const n of days) {
        const t = seedDate(n);
        const { map, model, runs } = stateMapOf(buildSeed(t), t);
        if (diffStateMap(map, base).length) broken.push(`${n}日後: ${diffStateMap(map, base).join(" / ")}`);
        const rows = riskRunRows(model, { runs });
        if (rows.length !== 1 || rows.reduce((n2, r) => n2 + r.cells.length, 0) !== 2)
          broken.push(`${n}日後の一覧: ${rows.length}ラン・${rows.reduce((n2, r) => n2 + r.cells.length, 0)}件`);
        if (rows.some((r) => r.phase === "drop済み")) broken.push(`${n}日後の一覧にdrop済みのランが出た`);
      }
      asserts.check("対応表が変わった日", broken, []);
      asserts.check("確認した日数", days.length, 15);
    },
  },
  {
    id: "A4-boot-and-import",
    name: "埋め込み起動データ・読み込んだJSONの絶対日付は書き換えない",
    expect: "保存版HTML（埋め込み）で開いた画面もJSON読込後の画面も、渡した絶対日付のまま。SEEDへ戻らない",
    async run({ mount, asserts }) {
      const c = await mountWith(mount, ABSOLUTE_DUMMY);
      const snap = await snapshotAll(c);
      asserts.check("埋め込み起動データの日付（runs）", snap.runs.map((r) => [r.lo, r.drop]),
        ABSOLUTE_DUMMY.runs.map((r) => [r.lo, r.drop]));
      asserts.check("埋め込み起動データの日付（regs）", snap.regs.map((r) => [r.shin, r.kei]),
        ABSOLUTE_DUMMY.regs.map((r) => [r.shin, r.kei]));
      asserts.check("SEEDの型式は現れない", snap.runs.some((r) => String(r.typeId).startsWith("DEMO-")), false);
      // 通常起動（SEED）から、絶対日付のJSONを読み込む経路
      const c2 = mount(undefined).container;
      await sleep(60);
      selectFile(c2, JSON.stringify(ABSOLUTE_DUMMY));
      await sleep(140);
      const snap2 = await snapshotAll(c2);
      asserts.check("読み込んだJSONの日付（runs）", snap2.runs.map((r) => [r.lo, r.drop]),
        ABSOLUTE_DUMMY.runs.map((r) => [r.lo, r.drop]));
      asserts.check("読み込んだJSONの日付（regs）", snap2.regs.map((r) => [r.shin, r.kei]),
        ABSOLUTE_DUMMY.regs.map((r) => [r.shin, r.kei]));
    },
  },
  {
    id: "A4-api-first-save",
    name: "空のサーバDBにはその日の絶対日付でSEEDが入り、既存DBのデータは書き換えない",
    expect: "空応答→PUT本文の日付＝いまのSEEDの値（絶対日付の文字列）。既存データを返すサーバでは、その日付のまま使う",
    async run({ mountApi, asserts }) {
      const put = [];
      const mock = installApiMock({ runs: [], regs: [], cert: {} }, put);
      try {
        mountApi();
        await sleep(300);
        await sleep(1600);   // 自動保存のデバウンスを越えるまで待つ（save-guard と同じ待ち方）
        asserts.check("空応答のときPUTは1回", put.length, 1);
        asserts.check("PUT本文のrunsの日付＝SEEDの値", put[0]?.runs.map((r) => [r.lo, r.drop]), SEED.runs.map((r) => [r.lo, r.drop]));
        asserts.check("PUT本文のregsの日付＝SEEDの値", put[0]?.regs.map((r) => [r.shin, r.kei]), SEED.regs.map((r) => [r.shin, r.kei]));
        asserts.checkTrue("保存された日付は絶対日付の文字列", put[0]?.runs.every((r) => isRealDate(r.lo) && isRealDate(r.drop)));
      } finally { mock.restore(); }
      const put2 = [];
      const mock2 = installApiMock(ABSOLUTE_DUMMY, put2);
      try {
        const c = mountApi().container;
        await sleep(300);
        await sleep(1600);
        asserts.checkTrue("既存の絶対日付をそのまま使う", c.textContent.includes("TYPE-ABS1"));
        asserts.check("SEEDへ戻さない", c.textContent.includes("DEMO-0001"), false);
        // 既存仕様：読込成功の直後に1回だけ書き戻す（F-20で変えていない）。
        // ここで見たいのは「書き戻す内容が読み込んだ絶対日付のままで、相対日付へ作り直されていない」こと。
        asserts.check("読込直後の書き戻しは1回", put2.length, 1);
        asserts.check("書き戻した日付＝読み込んだ絶対日付", put2[0]?.runs.map((r) => [r.lo, r.drop]),
          ABSOLUTE_DUMMY.runs.map((r) => [r.lo, r.drop]));
        asserts.check("書き戻しにSEEDの型式は混ざらない", put2[0]?.runs.some((r) => String(r.typeId).startsWith("DEMO-")), false);
      } finally { mock2.restore(); }
    },
  },
  {
    id: "A5-cert-shared",
    name: "同じ型式の全ランに同じ認可番号を入れてあり、プロジェクトが違っても実績ありになる",
    expect: "DEMO-0001×REG-A は 000A・000B・000C の3ランとも実績あり。認証実績は型式ラン×法規行で持ち（F-22）、ダミーでは同じ型式の全ランに同じ番号を入れてある",
    async run({ asserts }) {
      const { model, runs, regs } = stateMapOf(SEED);
      const A = regs.find((r) => r.id === "DEMO-REG-A");
      const cells = runs.filter((r) => r.typeId === "DEMO-0001").map((r) => [r.gen, model.get(r, A).decision.表示]);
      asserts.check("DEMO-0001×REG-A の3プロジェクト", cells, [["000A", "実績あり"], ["000B", "実績あり"], ["000C", "実績あり"]]);
      // F-22：認証実績は型式ラン×法規行のレコード。ダミーでは同じ型式の全ランが同じ番号を持つ。
      const onA = SEED.cert.filter((c) => c.rid === A.rid && runs.find((r) => r.key === c.runKey)?.typeId === "DEMO-0001");
      asserts.check("DEMO-0001×REG-A はランごとに1件ずつ・同じ番号", onA.map((c) => [c.runKey, c.ck]),
        [["r1", "DEMO*A00/00*01"], ["r2", "DEMO*A00/00*01"], ["r4", "DEMO*A00/00*01"]]);
      asserts.checkTrue("同じ型式のランは全部同じ番号の組を持つ（ダミーの作り方）",
        ["DEMO-0001", "DEMO-0002", "DEMO-0003", "DEMO-0004"].every((t) => {
          const sig = (k) => JSON.stringify(SEED.cert.filter((c) => c.runKey === k).map((c) => [c.rid, c.ck]));
          const ks = runs.filter((r) => r.typeId === t).map((r) => r.key);
          return ks.every((k) => sig(k) === sig(ks[0]));
        }));
      asserts.check("cert の各件は { runKey, rid, ck, planned } だけ",
        [...new Set(SEED.cert.map((c) => Object.keys(c).sort().join(",")))], ["ck,planned,rid,runKey"]);
      asserts.check("取得予定は全件なし（F-22 B3）", SEED.cert.some((c) => c.planned !== false), false);
      asserts.check("引き継ぎ確認中は製品データでは起きない",
        model.list.some((m) => m.decision.表示 === "引き継ぎ確認中"), false);
    },
  },
  {
    id: "A6-judgement-untouched",
    name: "判定そのものは変えていない（固定入力で決定表の出力が従来どおり）",
    expect: "SEEDと無関係な固定入力に対し、decideCell と riskOfCell が従来と同じ値を返す",
    async run({ asserts }) {
      const d1 = decideCell({ lo: "2015-01-01", drop: "2030-01-01", shin: "2000-01-01", kei: "2020-01-01", today: "2026-01-01", side: "継" });
      asserts.check("要・継続・期限=規制日（規制日がLOより後）・超過・生産中",
        [d1.要否, d1.適用した規制, d1.期限, d1.期限日, d1.超過, d1.生産フェーズ, d1.現在法規不適合],
        ["要", "継続", "規制日", "2020-01-01", true, "生産中", true]);
      const d1b = decideCell({ lo: "2020-01-01", drop: "2030-01-01", shin: "2019-01-01", kei: "2021-01-01", today: "2026-01-01", side: "新" });
      asserts.check("規制日よりLOが後なら期限はLO（C6）",
        [d1b.適用した規制, d1b.期限, d1b.期限日, d1b.現在法規不適合], ["新型", "LO", "2020-01-01", true]);
      const d2 = decideCell({ lo: "2028-01-01", drop: "2030-01-01", shin: "2019-01-01", kei: "2021-01-01", today: "2026-01-01", side: "新" });
      asserts.check("LOがまだ＝期限はLO・超過しない（C6）",
        [d2.期限, d2.期限日, d2.超過, d2.生産フェーズ, d2.法規適合必要], ["LO", "2028-01-01", false, "開発中", true]);
      const d3 = decideCell({ lo: "2010-01-01", drop: "2026-01-10", shin: "2000-01-01", kei: "2026-02-01", today: "2026-01-01", side: "継" });
      asserts.check("否・黄色予告（dropの22日後）", [d3.要否, d3.黄色予告?.days, d3.黄色予告?.keiDate], ["否", 22, "2026-02-01"]);
      asserts.check("riskOfCell は2条件だけ",
        [riskOfCell(d1, "2026-01-01").kind, riskOfCell(d2, "2026-01-01"), riskOfCell(d3, "2026-01-01").kind], ["不適合", null, "予告"]);
    },
  },
  {
    id: "A8-counter",
    name: "対照実験：意図した状態を崩すと落ち、意図しない危険セルが増えても落ちる",
    expect: "SEEDの写しを1点だけ変えると、A1の対応表チェックが必ず差分を出す（検証が素通りしない証拠）。drop済みのランが一覧へ戻る崩し方も入れてある",
    async run({ asserts }) {
      // 1. 不適合を消す（DEMO-0003にREG-Cの認可番号を足す）
      const d1 = clone(SEED);
      setTypeCk(d1, "DEMO-0003", "DEMO-REG-C", "DEMO*C00/00*99");
      asserts.checkTrue("不適合が消えると差分が出る", diffStateMap(stateMapOf(d1).map).length > 0);
      // 2. 予告を消す（REG-Eの継続車規制日をdropから31日後へ動かす＝窓の外）
      const d2 = clone(SEED);
      d2.regs.find((r) => r.rid === "g6").kei = seedDate(181);
      asserts.checkTrue("予告が消えると差分が出る", diffStateMap(stateMapOf(d2).map).length > 0);
      // 3. 危険セルが増える（DEMO-0001のREG-Dの認可番号を消す＝000Cが生産中でないので過去不適合が増える）
      const d3 = clone(SEED);
      setTypeCk(d3, "DEMO-0003", "DEMO-REG-D", null);
      const diff3 = diffStateMap(stateMapOf(d3).map);
      asserts.checkTrue("意図しない不適合が増えると差分が出る", diff3.some((x) => x.includes("現在法規不適合に余分")));
      // 4. **drop済みのランが危険一覧へ戻る**（000Cのドロップを REG-C の継続車規制日の30日窓へ動かす）。
      //    差し戻しの直接の原因なので、対応表の差分と一覧の中身の両方で捕まえる。
      const d4 = clone(SEED);
      for (const k of ["r4", "r5"]) d4.runs.find((r) => r.key === k).drop = seedDate(-15);
      const s4 = stateMapOf(d4);
      asserts.check("drop済みの予告が増えると差分が出る",
        diffStateMap(s4.map).filter((x) => x.startsWith("黄色予告に余分")).sort(),
        ["黄色予告に余分: r4×DEMO-REG-C", "黄色予告に余分: r5×DEMO-REG-C"]);
      asserts.checkTrue("そのとき一覧にdrop済みのランが並ぶ（＝この確認が効いている証拠）",
        riskRunRows(s4.model, { runs: s4.runs }).some((r) => r.phase === "drop済み"));
      // 5. 過去に法規不適合を消す（DEMO-0002にREG-Bの認可番号を足す＝実績ありに変わる）
      const d5 = clone(SEED);
      setTypeCk(d5, "DEMO-0002", "DEMO-REG-B", "DEMO*B00/00*99");
      asserts.checkTrue("過去に法規不適合が消えると差分が出る",
        diffStateMap(stateMapOf(d5).map).some((x) => x.includes("過去に法規不適合に無い")));
      // 6. 実績ありの共有（A5）を崩す
      const d6 = clone(SEED);
      setTypeCk(d6, "DEMO-0001", "DEMO-REG-A", null);
      asserts.checkTrue("実績ありが減ると差分が出る", diffStateMap(stateMapOf(d6).map).some((x) => x.includes("実績ありに無い")));
      // 7. 変えていない写しは差分なし（対照実験そのものが常にFAILしていないことの確認）
      asserts.check("写したままなら差分なし", diffStateMap(stateMapOf(clone(SEED)).map), []);
    },
  },
  {
    id: "A10-dummy-only",
    name: "すべて架空のプロジェクト・型式・法規・認可番号だけを使っている",
    expect: "型式はDEMO-0001〜0004、法規IDはDEMO-REG-*、認可番号はDEMO*で始まる。会社名・実型式・個人情報は含まない",
    async run({ asserts }) {
      asserts.check("型式記号", [...new Set(SEED.runs.map((r) => r.typeId))].sort(), ["DEMO-0001", "DEMO-0002", "DEMO-0003", "DEMO-0004"]);
      asserts.check("プロジェクトコード", [...new Set(SEED.runs.map((r) => r.gen))].sort(), ["000A", "000B", "000C", "001A"]);
      asserts.checkTrue("法規IDはすべて DEMO-REG- で始まる", SEED.regs.every((r) => /^DEMO-REG-[A-Z0-9]+$/.test(r.id)));
      asserts.checkTrue("法規名はすべて『ダミー法規』", SEED.regs.every((r) => r.label.startsWith("ダミー法規")));
      const cks = SEED.cert.map((c) => c.ck);
      asserts.checkTrue("認可番号はすべて DEMO* 形式", cks.every((v) => /^DEMO\*[A-Z0-9]+\/\d+\*\d+$/.test(v)));
      asserts.checkTrue("同一性の理由はすべて『ダミー：』", SEED.sameness.every((s) => s.reason.startsWith("ダミー：")));
      asserts.check("メールアドレス・電話番号らしき文字列", /[\w.]+@[\w.]+|\d{2,4}-\d{2,4}-\d{4}/.test(JSON.stringify(SEED)), false);
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
    window.__SEEDVERIFY_RUNNING__ = true;
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
      window.__SEEDVERIFY_RESULT__ = {
        finished: true,
        today: TODAY,
        pass: vals.filter((r) => r.pass).length,
        fail: vals.filter((r) => !r.pass).length,
        total: SCENARIOS.length,
        residualNodes: document.getElementById("sandbox").childElementCount,
        scenarios: SCENARIOS.map((s) => ({ id: s.id, name: s.name, pass: collected[s.id]?.pass, actual: collected[s.id]?.actual, detail: collected[s.id]?.detail })),
      };
      window.__SEEDVERIFY_RUNNING__ = false;
    }
  };
  React.useEffect(() => {
    window.__runSeedVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);
  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>主要状態が消えないデモデータ（F-20） 検証ハーネス</h1>
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
