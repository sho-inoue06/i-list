// ───────────────────────────────────────────────
// 人の適用判断・理由メモ（decisions）の検証ハーネス
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない
// （API版のケースでは window.fetch をモックし、PUTの発生回数と本文を実測する）。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/decisions.html
//
// 確認する主なこと：
//   ・判断が型式ラン×法規行で独立する（同型式の別ランへ漏れない）
//   ・人の判断が自動判定・黄色予告・認証実績を書き換えない（対象外を緑にしない）
//   ・対象外の理由必須／メモ編集だけでは確定日時も要再確認も動かさない
//   ・条件変更（reg.id・親リンク含む）で該当判断だけが要再確認になり、
//     元に戻す・メモ編集・再読込では解除されず、明示再確定でだけ解除される
//   ・行削除で対応する判断だけが消え、削除→保存→再読込→行追加でIDが再利用・誤結合しない
//   ・JSON／保存版HTMLの埋め込みで全項目が往復し、HTML風文字列が実行されない
//   ・壊れたdecisionsは現在データを一切置換せずに拒否される
//   ・API版はdecisions付きJSONをstate置換前に拒否し、それを原因とするPUTを発生させない
//   ・API版で判断propsを省略したときに判断UIが出ず、従来表示が保たれる
// ───────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import IListApp, {
  parseImportedData, replaceBootData, readBootData,
  parentLinkOf, condOf, condEquals, sweepRecheck, normalizeDecisions,
  markRunNeedsRecheck, pruneDecisionsByRun, pruneDecisionsByReg, upsertDecision,
  DECISION_STATES, peekIds, resetIds,
} from "../src/IListApp.jsx";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── ケースから制御できる alert / confirm ──
// 素のダイアログはヘッドレスで止まるため差し替える。自動承認の既定値はケース側で変える。
window.__ALERTS__ = [];
let confirmAnswer = true;
window.alert = (m) => { window.__ALERTS__.push(String(m)); };
window.confirm = (m) => { window.__ALERTS__.push("confirm:" + String(m)); return confirmAnswer; };

// ── アサーション ──
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

// ── ダミーデータ（架空。実車・実法規・実認可番号とは無関係） ──
// 同じ型式(DEMO-X)を2つのラン（PJ-A / PJ-B）が使う＝判断の独立性と実績共有の両方を見るため。
//
// 黄色の30日接近予告を見るセル（r103 × REG-4）の2つの日付だけは、実行時の端末ローカル日付から作る。
// F-15で「継続車日 ≤ 今日」には予告を出さなくなったため、固定日付のままだと
// 時間の経過でこのハーネスの前提（黄色セル）が勝手に消えてしまう。
// 21日という間隔と、他セルの判定（下の「期待する自動判定」）は変えない。
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
const YELLOW_DROP = shift(10);   // これからドロップする（今日＋10日）
const YELLOW_KEI = shift(31);    // その21日後に継続車規制が来る（今日＋31日＝これから）
const DUMMY = {
  runs: [
    { key: "r101", typeId: "DEMO-X", gen: "PJ-A", sk: "新", lo: "2024-01-01", drop: "2027-12-31" },
    { key: "r102", typeId: "DEMO-X", gen: "PJ-B", sk: "継", lo: "2028-01-01", drop: "2030-12-31" },
    { key: "r103", typeId: "DEMO-Y", gen: "PJ-C", sk: "新", lo: "2024-01-01", drop: YELLOW_DROP },
  ],
  regs: [
    { rid: "g101", id: "REG-1", label: "ダミー法規1", shin: "2023-01-01", kei: "2025-01-01", parent: "" },
    { rid: "g102", id: "REG-2", label: "ダミー法規2", shin: "2023-01-01", kei: "2026-02-10", parent: "REG-1" },
    { rid: "g103", id: "REG-3", label: "ダミー法規3", shin: "2029-01-01", kei: "2030-01-01", parent: "" },
    { rid: "g104", id: "REG-4", label: "ダミー法規4", shin: "2029-01-01", kei: YELLOW_KEI, parent: "" },
  ],
  cert: { "DEMO-X": { "REG-1": "CK-1" } },
};
const clone = (o) => JSON.parse(JSON.stringify(o));
// 期待する自動判定（このハーネスの前提が崩れたら気づけるように明示しておく）
//   行0 REG-1: [ok, ok, leak]   ← r102 は同型式 DEMO-X の実績 CK-1 を共有する
//   行1 REG-2: [leak, leak, leak]
//   行2 REG-3: [off, leak, off]
//   行3 REG-4: [leak, leak, off＋黄色21日]

const REASON_TRICKY =
  "対象外の理由（ダミー）\n<b>太字にはならない</b> </script><script>window.__PWNED__=1</script>\n<!-- コメント --> & \" ' 日本語テスト";

// ── 画面ユーティリティ ──
const STATUS_TEXTS = [
  "変更なし（未書き出しの変更はありません）",
  "未書き出しの変更があります（書き出してください）",
  "JSONの書き出しを開始しました（保存先はブラウザの動作に従います）",
  "JSONから読み込みました",
  "データ入りHTMLの書き出しを開始しました（保存先はブラウザの動作に従います）",
  "保存済みのHTMLから起動しました（この時点のデータで再開しています）",
];
function readStatus(container) {
  if (!container?.isConnected) return "(コンテナが破棄済み)";
  for (const s of container.querySelectorAll("span")) {
    const t = s.textContent.trim();
    if (STATUS_TEXTS.includes(t)) return t;
  }
  return "(保存状態の表示が見つかりません)";
}
const setNativeValue = (el, value) => {
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
async function clickByText(container, re) {
  const b = [...container.querySelectorAll("button")].find((x) => re.test(x.textContent));
  if (!b) throw new Error(`ボタンが見つかりません: ${re}`);
  b.click();
  await sleep(0);
  return b;
}
const openTab = (container, name) => clickByText(container, new RegExp(name));

// 帳票のセル（行＝法規、列＝型式ラン）。先頭tdは法規名なので +1 する。
function cellAt(container, regRow, runCol) {
  const tbody = container.querySelector("table tbody");
  if (!tbody) throw new Error("帳票のテーブルが見つかりません");
  const tr = tbody.children[regRow];
  if (!tr) throw new Error(`帳票の行がありません: ${regRow}`);
  const td = tr.children[runCol + 1];
  if (!td) throw new Error(`帳票のセルがありません: ${regRow},${runCol}`);
  return td;
}
const cellText = (container, r, c) => cellAt(container, r, c).textContent;
const cellBorder = (container, r, c) =>
  getComputedStyle(cellAt(container, r, c).querySelector("div")).borderTopColor;
const RED_RGB = "rgb(255, 107, 87)", GREEN_RGB = "rgb(63, 191, 143)", AMBER_RGB = "rgb(224, 178, 77)";

// セルの判断を編集する。action を省略すると通常の保存ボタンを押す。
async function editDecision(container, r, c, { state, reason, action } = {}) {
  const open = cellAt(container, r, c).querySelector('button[title="適用判断・理由メモを編集"]');
  if (!open) throw new Error("判断の編集ボタンが見つかりません");
  open.click();
  await sleep(5);
  if (state !== undefined) {
    const radios = cellAt(container, r, c).querySelectorAll('input[type="radio"]');
    const i = DECISION_STATES.indexOf(state);
    if (!radios[i]) throw new Error("判断のラジオが見つかりません");
    radios[i].click();
    await sleep(5);
  }
  if (reason !== undefined) {
    const ta = cellAt(container, r, c).querySelector("textarea");
    if (!ta) throw new Error("理由の入力欄が見つかりません");
    setNativeValue(ta, reason);
    await sleep(5);
  }
  const btns = [...cellAt(container, r, c).querySelectorAll("button")];
  const btn = action
    ? btns.find((b) => b.textContent.includes(action))
    : btns.find((b) => /メモを保存|未確認に戻す|この判断で確定/.test(b.textContent));
  if (!btn) throw new Error(`保存ボタンが見つかりません（候補: ${btns.map((b) => b.textContent).join(" | ")}）`);
  btn.click();
  await sleep(15);
}
// 編集領域を「開くだけ」。保存ボタンは押さない（表示内容を読むためのヘルパ）。
async function openEditorOnly(container, r, c) {
  const open = cellAt(container, r, c).querySelector('button[title="適用判断・理由メモを編集"]');
  if (!open) throw new Error("判断の編集ボタンが見つかりません");
  open.click();
  await sleep(10);
}
const isEditorOpen = (container, r, c) => !!cellAt(container, r, c).querySelector("textarea");
// 閉じているときだけ開く（開いている間はセルに鉛筆ボタンが無いため）
async function ensureEditorOpen(container, r, c) {
  if (!isEditorOpen(container, r, c)) await openEditorOnly(container, r, c);
}
async function closeEditor(container, r, c) {
  const b = [...cellAt(container, r, c).querySelectorAll("button")].find((x) => x.textContent.includes("キャンセル"));
  if (b) { b.click(); await sleep(5); }
}

// 「JSONに書き出し」を押して、いまアプリが保持している内容を丸ごと取り出す。
async function snapshotAll(container) {
  const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL;
  const realClick = HTMLAnchorElement.prototype.click;
  let blob = null;
  URL.createObjectURL = (b) => { blob = b; return "blob:dummy"; };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () {};   // 実ダウンロードは起こさない
  try {
    await clickByText(container, /JSONに書き出し/);
    await sleep(60);
    if (!blob) throw new Error("書き出しのBlobを取得できませんでした");
    return JSON.parse(await blob.text());
  } finally {
    URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke;
    HTMLAnchorElement.prototype.click = realClick;
  }
}

// 「JSONに書き出し」は保存状態を exported に変える**副作用のある**観測である。
// 未書き出し表示・dirtyを見たいときは、先に readStatus() など副作用のない方法で観測すること
// （snapshotAll を先に呼ぶと、検証したかった dirty がその操作自身で消えてしまう）。

// 終了時警告ハンドラが登録されているかを、ダイアログを出さずに観測する。
// StandaloneApp は dirty のときだけ beforeunload を登録し、ハンドラ内で preventDefault する。
// 実ブラウザの確認ダイアログそのものはヘッドレスでは出せないため、これは
// 「ハンドラが登録され、キャンセル扱いにしている」ことの検証であり、ダイアログ表示の実測ではない。
function beforeUnloadArmed() {
  const ev = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

// 検証専用の読み取り。書き出しをせず、現在commit済みのstateとdirtyRefを直接観測する。
// React 18の内部構造とStandaloneAppのHook順に依存するため、形が変わったら失敗させる。
// 本体への観測フック追加やstate書き換えはしない。置換confirmによる行動検証も併用する。
function readStandaloneState(container) {
  const key = Object.keys(container).find((k) => k.startsWith("__reactContainer$"));
  const root = container[key]?.stateNode?.current;
  const find = (node) => {
    if (!node) return null;
    if (node.type === StandaloneApp) return node;
    return find(node.child) || find(node.sibling);
  };
  const fiber = find(root);
  const hooks = [];
  for (let h = fiber?.memoizedState; h; h = h.next) hooks.push(h.memoizedState);
  if (!Array.isArray(hooks[0]) || !Array.isArray(hooks[3]) ||
      typeof hooks[10] !== "number" || typeof hooks[11]?.current !== "boolean") {
    throw new Error("StandaloneAppのHook観測が不成立（構造・順序を要確認）");
  }
  return clone({ data: { runs: hooks[0], regs: hooks[1], cert: hooks[2], decisions: hooks[3] },
    saveState: hooks[5], dataGen: hooks[10], dirtyRef: hooks[11].current });
}

// 時計を固定して処理を実行する。nowStamp() は内部で new Date() を呼ぶため、
// 「待つ」のではなく時刻そのものを与えて、分精度の日時が変わる／変わらないを確実に検証する。
async function withFakeClock(iso, fn) {
  const Real = window.Date;
  class Fake extends Real {
    constructor(...a) { if (a.length === 0) super(iso); else super(...a); }
    static now() { return new Real(iso).getTime(); }
  }
  window.Date = Fake;
  try { return await fn(); } finally { window.Date = Real; }
}

// 直近に記録された confirm 呼び出し（置換確認）の件数
const confirmCount = () => window.__ALERTS__.filter((m) => m.startsWith("confirm:")).length;

function selectFile(container, text, name = "d.json") {
  const inp = container.querySelector('input[type="file"]');
  if (!inp) throw new Error("file input が見つかりません");
  const dt = new DataTransfer();
  dt.items.add(new File([text], name, { type: "application/json" }));
  Object.defineProperty(inp, "files", { value: dt.files, configurable: true });
  inp.dispatchEvent(new Event("change", { bubbles: true }));
}

// 型式ラン／法規DBタブの入力欄
const runTypeInputs = (c) => [...c.querySelectorAll('input[placeholder="DEMO-0001"]')];
const regIdInputs = (c) => [...c.querySelectorAll('input[placeholder="DEMO-REG-A2"]')];
const runGenInputs = (c) => [...c.querySelectorAll('input[placeholder="000A"]')];
const regLabelInputs = (c) => [...c.querySelectorAll('input[placeholder="ダミー法規 SU"]')];
const dateInputs = (c) => [...c.querySelectorAll('input[type="date"]')];
function deleteRow(container, index) {
  const rows = [...container.querySelectorAll("tbody tr")];
  const btn = rows[index]?.querySelector("button");
  if (!btn) throw new Error(`削除ボタンが見つかりません: 行${index}`);
  btn.click();
}

// ── API版のfetchモック（実サーバ・実DBには触れない） ──
function installApiMock(data) {
  const real = window.fetch;
  const puts = [];
  window.fetch = async (url, opts) => {
    if (String(url) !== "/api/data") throw new Error("想定外のfetch: " + url);
    if (!opts || !opts.method || opts.method === "GET") {
      return { ok: true, json: async () => clone(data) };
    }
    if (opts.method === "PUT") {
      puts.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ ok: true }) };
    }
    throw new Error("想定外のmethod: " + opts.method);
  };
  return { puts, restore() { window.fetch = real; } };
}

// ── マウント管理（ケースごとに必ず後始末する） ──
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

// 単体版を DUMMY の状態で立ち上げる（保存版HTMLから起動したのと同じ経路を使う）
async function mountWithDummy(mount, extra = {}) {
  const parsed = parseImportedData({ ...clone(DUMMY), ...extra });
  if (!parsed.ok) throw new Error("ダミーデータが不正です: " + parsed.error);
  const app = mount({ present: true, ok: true, data: parsed.data, maxId: parsed.maxId, maxRid: parsed.maxRid });
  await sleep(60);
  return app;
}

const findDec = (snap, runKey, rid) => (snap.decisions || []).find((d) => d.runKey === runKey && d.rid === rid) || null;

// ───────────────────────────────────────────────
// 検証ケース
// ───────────────────────────────────────────────
const SCENARIOS = [
  ...["mismatch", "null", "matched"].map((kind, i) => ({
    id: `D${24 + i}-json-import-${kind}`,
    name: `【P1 JSON読込】cond=${kind} の保存保護・キャンセル・入力保持`,
    expect: "sweep変更時だけdirty。書出し前に直接state/refと終了時保護・置換確認を検証する",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      const matched = condOf(DUMMY.runs[0], DUMMY.regs[1], DUMMY.regs);
      const decision = { runKey: "r101", rid: "g102", state: "対象外", reason: REASON_TRICKY,
        decidedAt: "2026-09-01 10:00", needsRecheck: false,
        cond: kind === "null" ? null : kind === "mismatch" ? { ...matched, lo: "2001-01-01" } : matched };
      const input = { ...clone(DUMMY), decisions: [decision] };
      const changed = kind !== "matched";
      const expected = { ...clone(input), decisions: [{ ...decision, needsRecheck: changed }] };
      asserts.check("観測の初期値", readStandaloneState(c).dirtyRef, false);
      selectFile(c, JSON.stringify(input));
      await sleep(140);
      const before = readStandaloneState(c);
      asserts.check("書出し前の全データ", before.data, expected);
      asserts.check("成功読込だけdataGenを進める", before.dataGen, 1);
      asserts.check("書出し前のdirtyRef", before.dirtyRef, changed);
      asserts.check("書出し前のsaveState", before.saveState, changed ? "dirty" : "imported");
      asserts.check("書出し前の表示", readStatus(c), changed ? STATUS_TEXTS[1] : STATUS_TEXTS[3]);
      asserts.check("終了時ハンドラ", beforeUnloadArmed(), changed);
      await openEditorOnly(c, 1, 0);
      setNativeValue(cellAt(c, 1, 0).querySelector("textarea"), "DUMMY-IN-PROGRESS");
      await sleep(20);
      const assertPreserved = (label) => {
        asserts.check(`${label}: データ・dirtyRef・dataGen`, readStandaloneState(c), before);
        asserts.check(`${label}: 編集中入力`, cellAt(c, 1, 0).querySelector("textarea")?.value, "DUMMY-IN-PROGRESS");
      };
      window.__ALERTS__ = [];
      selectFile(c, "{ invalid dummy JSON");
      await sleep(100);
      asserts.check("不正JSONを拒否", window.__ALERTS__.length, 1);
      assertPreserved("不正読込");

      // FileReaderの完了順を制御し、最新の失敗後に古い成功/失敗が届いても保持する。
      const RealReader = window.FileReader;
      const pending = [];
      window.FileReader = class { readAsText() { pending.push(this); } };
      try {
        selectFile(c, "old dummy");
        selectFile(c, "latest invalid dummy");
        pending[1].result = "{"; pending[1].onload();
        pending[0].result = JSON.stringify({ ...clone(DUMMY), decisions: [] }); pending[0].onload();
        pending[0].onerror();
        await sleep(40);
        assertPreserved("古い非同期読込");
      } finally { window.FileReader = RealReader; }

      window.__ALERTS__ = [];
      confirmAnswer = false;
      selectFile(c, JSON.stringify(changed ? { ...clone(DUMMY), decisions: [] } : input));
      await sleep(140);
      asserts.check("次JSON読込の置換確認", confirmCount(), changed ? 1 : 0);
      if (changed) {
        assertPreserved("置換キャンセル");
        asserts.check("キャンセル後も終了時保護", beforeUnloadArmed(), true);
      } else {
        asserts.check("正常読込はエディタを閉じる", isEditorOpen(c, 1, 0), false);
        asserts.check("正常読込のdataGen", readStandaloneState(c).dataGen, 2);
        asserts.check("正常読込はimportedのまま", readStandaloneState(c).saveState, "imported");
      }
      // 保護の観測が全て終わってから初めて書き出す。
      // 書き出しには F-04 の比較元・同一性（このケースでは空）も常に入る
      asserts.check("JSON全項目の値が一致", await snapshotAll(c), { ...expected, bases: [], sameness: [] });
      await sleep(250);
      asserts.check("保存直後にdirtyへ戻らない", readStandaloneState(c).dirtyRef, false);
      asserts.check("保存後の表示", readStatus(c), STATUS_TEXTS[2]);
      asserts.check("保存後は終了時保護解除", beforeUnloadArmed(), false);
    },
  })),
  {
    id: "D1-independence",
    name: "同型式の別ランへ判断が漏れない／認証実績の共有は変わらない",
    expect: "r101を対象外にしてもr102は未確認のまま。r102はDEMO-Xの実績CK-1を参照し続ける（緑）",
    async run({ mount, asserts }) {
      const app = mountWithDummy ? await mountWithDummy(mount) : null;
      const c = app.container;
      // 前提：行0(REG-1)は r101/r102 とも実績ありで緑、r103は実績なしで赤
      asserts.check("前提 行0の枠色", [cellBorder(c,0,0), cellBorder(c,0,1), cellBorder(c,0,2)], [GREEN_RGB, GREEN_RGB, RED_RGB]);
      asserts.checkTrue("前提 r102が同型式の実績を共有", cellText(c,0,1).includes("CK-1"));

      await editDecision(c, 1, 0, { state: "対象外", reason: "PJ-Aは該当装備なし（ダミー）" });
      asserts.checkTrue("r101×REG-2が対象外", cellText(c,1,0).includes("人：対象外"));
      asserts.checkTrue("r102×REG-2は未確認のまま", cellText(c,1,1).includes("人：未確認"));
      asserts.checkTrue("r103×REG-2は未確認のまま", cellText(c,1,2).includes("人：未確認"));
      asserts.check("実績共有は不変（行0の枠色）", [cellBorder(c,0,0), cellBorder(c,0,1), cellBorder(c,0,2)], [GREEN_RGB, GREEN_RGB, RED_RGB]);

      const snap = await snapshotAll(c);
      asserts.check("保存される判断は1件だけ", snap.decisions.length, 1);
      asserts.check("その1件の参照", [snap.decisions[0].runKey, snap.decisions[0].rid], ["r101", "g102"]);
      asserts.check("cert は不変", snap.cert, DUMMY.cert);
    },
  },
  {
    id: "D2-reason-required",
    name: "対象外は理由必須／メモ編集だけでは確定日時も要再確認も動かない",
    expect: "空白理由の対象外は保存されず編集領域が開いたまま。メモだけの保存でdecidedAtが変わらない",
    async run({ mount, asserts }) {
      const app = await mountWithDummy(mount);
      const c = app.container;

      await editDecision(c, 1, 0, { state: "対象外", reason: "   " });
      asserts.checkTrue("編集領域が開いたまま", isEditorOpen(c, 1, 0));
      asserts.checkTrue("理由必須のメッセージ", cellText(c,1,0).includes("理由が必要です"));
      await closeEditor(c, 1, 0);
      asserts.checkTrue("保存されていない（未確認のまま）", cellText(c,1,0).includes("人：未確認"));

      // 確定日時は分精度なので「待つ」検証では検出できない。時計そのものを別の時刻に固定する。
      await withFakeClock("2026-01-02T03:04:30", () =>
        editDecision(c, 1, 0, { state: "対象", reason: "初回の確定（ダミー）" }));
      const s1 = await snapshotAll(c);
      const d1 = findDec(s1, "r101", "g102");
      asserts.check("確定日時は固定した時計の値", d1.decidedAt, "2026-01-02 03:04");
      asserts.check("確定時条件が入る", typeof d1.cond, "object");

      // 時計を別の時刻へ進めたうえでメモだけ保存する（日時が動くなら必ず違う値になる）
      await withFakeClock("2027-11-12T13:14:50", () =>
        editDecision(c, 1, 0, { reason: "メモだけ書き換え（ダミー）" }));
      const s2 = await snapshotAll(c);
      const d2 = findDec(s2, "r101", "g102");
      asserts.check("メモだけ保存で状態は不変", d2.state, "対象");
      asserts.check("メモだけ保存で確定日時は不変", d2.decidedAt, "2026-01-02 03:04");
      asserts.check("メモだけ保存で確定時条件は不変", d2.cond, d1.cond);
      asserts.check("メモだけ保存で要再確認は不変", d2.needsRecheck, false);
      asserts.check("理由は更新される", d2.reason, "メモだけ書き換え（ダミー）");

      // 陽性確認：同じ時計制御で明示確定すると、日時は確かに新しい値へ動く
      await withFakeClock("2027-11-12T13:14:50", () =>
        editDecision(c, 1, 0, { state: "対象外", reason: "明示確定（ダミー）" }));
      const d3 = findDec(await snapshotAll(c), "r101", "g102");
      asserts.check("明示確定では日時が動く（時計制御が効いている陽性確認）", d3.decidedAt, "2027-11-12 13:14");
    },
  },
  {
    id: "D3-auto-untouched",
    name: "人の判断が自動判定・黄色予告・色を書き換えない",
    expect: "対象外にしても赤は赤のまま／緑にならない。黄色セルの予告文と日数も変わらない",
    async run({ mount, asserts }) {
      const app = await mountWithDummy(mount);
      const c = app.container;
      const before = { b10: cellBorder(c,1,0), t10: cellText(c,1,0), b32: cellBorder(c,3,2), t32: cellText(c,3,2) };
      asserts.check("前提 黄色セルの枠色", before.b32, AMBER_RGB);
      asserts.checkTrue("前提 黄色の予告文", before.t32.includes("継続規制まで21日"));

      await editDecision(c, 1, 0, { state: "対象外", reason: "対象外にしても赤は消えない（ダミー）" });
      await editDecision(c, 3, 2, { state: "対象外", reason: "黄色セルでも予告は残る（ダミー）" });

      asserts.check("赤セルの枠色は不変", cellBorder(c,1,0), RED_RGB);
      asserts.checkTrue("赤セルの自動表示は残る", cellText(c,1,0).includes("申請発生"));
      asserts.checkTrue("緑にはならない", cellBorder(c,1,0) !== GREEN_RGB);
      asserts.check("黄色セルの枠色は不変", cellBorder(c,3,2), AMBER_RGB);
      asserts.checkTrue("黄色の予告文・日数は不変", cellText(c,3,2).includes("継続規制まで21日"));
      asserts.checkTrue("黄色セルの自動表示は残る", cellText(c,3,2).includes("否・要再確認"));
    },
  },
  {
    id: "D4-new-run-untouched",
    name: "新しい型式ランは未確認・理由空・日時空（判断を引き継がない）",
    expect: "既存ランに判断があっても、追加したランのセルは未確認で判断レコードが増えない",
    async run({ mount, asserts }) {
      const app = await mountWithDummy(mount);
      const c = app.container;
      await editDecision(c, 1, 0, { state: "対象外", reason: "既存ランの判断（ダミー）" });

      await openTab(c, "型式ラン");
      await clickByText(c, /ランを追加/);
      await sleep(20);
      const keys = (await snapshotAll(c)).runs.map((r) => r.key);
      asserts.check("追加後のキー", keys, ["r101", "r102", "r103", "r104"]);

      await openTab(c, "帳票");
      await sleep(20);
      asserts.checkTrue("追加ラン×REG-2は未確認", cellText(c, 1, 3).includes("人：未確認"));
      const snap = await snapshotAll(c);
      asserts.check("判断レコードは増えない", snap.decisions.length, 1);
      asserts.check("追加ランの判断は無い", findDec(snap, "r104", "g102"), null);
    },
  },
  {
    id: "D5-recheck-conditions",
    name: "条件変更で該当判断だけ要再確認／元に戻す・メモ編集では解除されない／明示再確定で解除",
    expect: "LO変更で要再確認。gen・label変更では立たない。元に戻しても解除されず、再確定でだけ解除",
    async run({ mount, asserts }) {
      const app = await mountWithDummy(mount);
      const c = app.container;
      // 同じラン(r101)に複数の法規で判断を持たせ、別ラン(r102)も用意して影響範囲を見る
      await editDecision(c, 0, 0, { state: "対象", reason: "r101×REG-1（ダミー）" });
      await editDecision(c, 1, 0, { state: "対象外", reason: "条件変更の検知テスト（ダミー）" });
      await editDecision(c, 2, 0, { state: "対象", reason: "r101×REG-3（ダミー）" });
      await editDecision(c, 1, 1, { state: "対象", reason: "別ランの判断（ダミー）" });
      asserts.check("初期はどれも要再確認でない",
        [cellText(c,0,0), cellText(c,1,0), cellText(c,2,0), cellText(c,1,1)].map((t) => t.includes("要再確認")),
        [false, false, false, false]);

      // 表示名だけの変更（gen / label）では立たない
      await openTab(c, "型式ラン");
      setNativeValue(runGenInputs(c)[0], "PJ-A2");
      await sleep(30);
      await openTab(c, "法規DB");
      setNativeValue(regLabelInputs(c)[1], "名称だけ変更");
      await sleep(30);
      await openTab(c, "帳票"); await sleep(20);
      asserts.checkTrue("gen/label変更では要再確認にならない", !cellText(c,1,0).includes("要再確認"));

      // LO を変更 → r101 の判断だけ要再確認
      await openTab(c, "型式ラン");
      setNativeValue(dateInputs(c)[0], "2029-01-01");     // 1行目のLO
      await sleep(40);
      await openTab(c, "帳票"); await sleep(20);
      // LOはすべての判断のcondに入るので、r101の3件すべてが要再確認になる。r102は無関係。
      asserts.check("r101の判断3件すべてが要再確認",
        [cellText(c,0,0), cellText(c,1,0), cellText(c,2,0)].map((t) => t.includes("要再確認")),
        [true, true, true]);
      asserts.checkTrue("別ランr102の判断は無関係", !cellText(c,1,1).includes("要再確認"));
      let snap = await snapshotAll(c);
      asserts.check("要再確認が保存される", findDec(snap,"r101","g102").needsRecheck, true);
      asserts.check("理由は消えない", findDec(snap,"r101","g102").reason, "条件変更の検知テスト（ダミー）");

      // 条件を元に戻しても解除されない
      await openTab(c, "型式ラン");
      setNativeValue(dateInputs(c)[0], "2024-01-01");
      await sleep(40);
      await openTab(c, "帳票"); await sleep(20);
      asserts.checkTrue("条件を戻しても要再確認のまま", cellText(c,1,0).includes("要再確認"));

      // メモだけ編集しても解除されない
      await editDecision(c, 1, 0, { reason: "メモを直しただけ（ダミー）" });
      asserts.checkTrue("メモ編集でも要再確認のまま", cellText(c,1,0).includes("要再確認"));

      // 明示再確定で解除
      await editDecision(c, 1, 0, { action: "この内容で再確定" });
      asserts.checkTrue("再確定で解除", !cellText(c,1,0).includes("要再確認"));
      snap = await snapshotAll(c);
      const d = findDec(snap, "r101", "g102");
      asserts.check("再確定後のフラグ", d.needsRecheck, false);
      asserts.check("再確定後も対象外のまま", d.state, "対象外");
      asserts.check("確定時条件が現在値に更新される", d.cond.lo, "2024-01-01");
    },
  },
  {
    id: "D6-regid-change",
    name: "法規ID(reg.id)の変更で要再確認になり、認証実績の参照も外れる",
    expect: "REG-1をREG-1Xに変えると、その法規の判断が要再確認になり、緑だったセルが赤へ変わる",
    async run({ mount, asserts }) {
      const app = await mountWithDummy(mount);
      const c = app.container;
      await editDecision(c, 0, 0, { state: "対象", reason: "REG-1の判断（ダミー）" });
      asserts.check("前提 緑", cellBorder(c,0,0), GREEN_RGB);

      await openTab(c, "法規DB");
      setNativeValue(regIdInputs(c)[0], "REG-1X");
      await sleep(40);
      await openTab(c, "帳票"); await sleep(20);

      asserts.checkTrue("要再確認になる", cellText(c,0,0).includes("要再確認"));
      asserts.check("実績参照が外れて赤へ", cellBorder(c,0,0), RED_RGB);
      const snap = await snapshotAll(c);
      asserts.check("cert 自体は書き換えていない", snap.cert, DUMMY.cert);
      asserts.check("確定時条件のregIdは確定時のまま", findDec(snap,"r101","g101").cond.regId, "REG-1");
    },
  },
  {
    id: "D7-parent-link-unit",
    name: "親リンクの解決（純関数）：先頭一致で決めない／なし・一意・未解決・複数候補を区別",
    expect: "完全一致のみ。REG-1に対してREG-10は親候補にならない。複数一致はambiguous",
    async run({ asserts }) {
      const base = [
        { rid: "g1", id: "REG-1", label: "", shin: "", kei: "", parent: "" },
        { rid: "g2", id: "REG-2", label: "", shin: "", kei: "", parent: "REG-1" },
      ];
      asserts.check("親指定なし", parentLinkOf(base[0], base), { link: "none", rid: "" });
      asserts.check("一意に解決", parentLinkOf(base[1], base), { link: "one", rid: "g1" });

      const prefixOnly = [
        { rid: "g1", id: "REG-10", label: "", shin: "", kei: "", parent: "" },
        { rid: "g2", id: "REG-2", label: "", shin: "", kei: "", parent: "REG-1" },
      ];
      asserts.check("先頭一致では親にしない", parentLinkOf(prefixOnly[1], prefixOnly), { link: "unresolved", rid: "" });

      const dup = [
        { rid: "g1", id: "REG-1", label: "", shin: "", kei: "", parent: "" },
        { rid: "g3", id: "REG-1", label: "", shin: "", kei: "", parent: "" },
        { rid: "g2", id: "REG-2", label: "", shin: "", kei: "", parent: "REG-1" },
      ];
      asserts.check("複数候補は解決しない", parentLinkOf(dup[2], dup), { link: "ambiguous", rid: "" });

      const selfOnly = [{ rid: "g2", id: "REG-1", label: "", shin: "", kei: "", parent: "REG-1" }];
      asserts.check("自分自身は親候補にしない", parentLinkOf(selfOnly[0], selfOnly), { link: "unresolved", rid: "" });

      const run = { key: "r1", typeId: "T", gen: "G", sk: "新", lo: "2024-01-01", drop: "2026-01-01" };
      const cond = condOf(run, base[1], base);
      asserts.check("condに親の解決結果が入る", [cond.parentLink, cond.parentRid], ["one", "g1"]);
      asserts.check("condはgen/labelを含まない", Object.keys(cond).includes("gen"), false);
      asserts.check("同じ条件は等しい", condEquals(cond, condOf(run, base[1], base)), true);
    },
  },
  {
    id: "D8-parent-link-ui",
    name: "親IDの変更・親の削除・重複候補の出現を要再確認として可視化する",
    expect: "親改名/削除→未解決、同じIDの法規追加→複数候補。複数候補のあいだは再確定しても解除されない",
    async run({ mount, asserts }) {
      // 親の改名
      let app = await mountWithDummy(mount);
      let c = app.container;
      await editDecision(c, 1, 0, { state: "対象", reason: "親リンクのテスト（ダミー）" });
      let snap = await snapshotAll(c);
      asserts.check("確定時は親が一意", [findDec(snap,"r101","g102").cond.parentLink, findDec(snap,"r101","g102").cond.parentRid], ["one", "g101"]);

      await openTab(c, "法規DB");
      setNativeValue(regIdInputs(c)[0], "REG-9");        // 親の改名（子のparent文字列は追随しない）
      await sleep(40);
      await openTab(c, "帳票"); await sleep(20);
      asserts.checkTrue("親改名で要再確認", cellText(c,1,0).includes("要再確認"));
      await openEditorOnly(c, 1, 0);                      // 編集領域を開いて理由文言を確認（保存はしない）
      asserts.checkTrue("未解決と表示", cellText(c,1,0).includes("シリーズアップ元の法規が見つかりません"));
      await closeEditor(c, 1, 0);
      app.unmount();

      // 親の削除
      app = await mountWithDummy(mount);
      c = app.container;
      await editDecision(c, 1, 0, { state: "対象", reason: "親削除のテスト（ダミー）" });
      await openTab(c, "法規DB");
      deleteRow(c, 0);                                    // REG-1 の行を削除
      await sleep(40);
      await openTab(c, "帳票"); await sleep(20);
      asserts.checkTrue("親削除で要再確認", cellText(c,0,0).includes("要再確認"));
      app.unmount();

      // 複数候補
      app = await mountWithDummy(mount);
      c = app.container;
      await editDecision(c, 1, 0, { state: "対象", reason: "重複候補のテスト（ダミー）" });
      await openTab(c, "法規DB");
      await clickByText(c, /法規を追加/);
      await sleep(20);
      setNativeValue(regIdInputs(c)[4], "REG-1");         // 親と同じIDの行を増やす
      await sleep(40);
      await openTab(c, "帳票"); await sleep(20);
      asserts.checkTrue("重複候補で要再確認", cellText(c,1,0).includes("要再確認"));
      await editDecision(c, 1, 0, { action: "この内容で再確定" });
      asserts.checkTrue("候補が複数のままなら再確定しても解除されない", cellText(c,1,0).includes("要再確認"));
      await openEditorOnly(c, 1, 0);
      asserts.checkTrue("複数候補と表示", cellText(c,1,0).includes("シリーズアップ元の候補が複数あります"));
      await closeEditor(c, 1, 0);
    },
  },
  {
    id: "D9-delete-integrity",
    name: "行削除で対応する判断だけを除去し、他の判断に触れない",
    expect: "r101削除でr101の判断だけ消える。法規行削除も同様。孤立参照が残らない",
    async run({ mount, asserts }) {
      const app = await mountWithDummy(mount);
      const c = app.container;
      await editDecision(c, 1, 0, { state: "対象外", reason: "消える側（ダミー）" });
      await editDecision(c, 1, 1, { state: "対象", reason: "残る側（ダミー）" });
      await editDecision(c, 2, 1, { state: "対象外", reason: "法規削除で消える側（ダミー）" });
      asserts.check("前提の件数", (await snapshotAll(c)).decisions.length, 3);

      await openTab(c, "型式ラン");
      deleteRow(c, 0);                       // r101
      await sleep(40);
      let snap = await snapshotAll(c);
      asserts.check("r101の判断だけ消える", snap.decisions.map((d) => `${d.runKey}|${d.rid}`), ["r102|g102", "r102|g103"]);
      asserts.check("残った判断の理由は不変", findDec(snap, "r102", "g102").reason, "残る側（ダミー）");
      asserts.check("runsからr101が消えている", snap.runs.map((r) => r.key), ["r102", "r103"]);

      await openTab(c, "法規DB");
      deleteRow(c, 2);                       // REG-3 (g103)
      await sleep(40);
      snap = await snapshotAll(c);
      asserts.check("g103の判断だけ消える", snap.decisions.map((d) => `${d.runKey}|${d.rid}`), ["r102|g102"]);
      // 自分で書き出したものを読み戻せる＝孤立参照が残っていない
      asserts.check("書き出したJSONを読み戻せる", parseImportedData(snap).ok, true);
    },
  },
  {
    id: "D10-delete-save-reload-add",
    name: "行削除→書き出し→読み込み→行追加でIDが再利用されず誤結合しない",
    expect: "削除したr101のキーは再利用されない。追加行に古い判断が付かない",
    async run({ mount, asserts }) {
      const app = await mountWithDummy(mount);
      const c = app.container;
      await editDecision(c, 1, 0, { state: "対象外", reason: "削除される判断（ダミー）" });
      await editDecision(c, 1, 1, { state: "対象", reason: "残る判断（ダミー）" });

      await openTab(c, "型式ラン");
      deleteRow(c, 0);
      await sleep(40);
      const exported = await snapshotAll(c);
      asserts.check("書き出しに削除済みの参照はない", exported.decisions.map((d) => d.runKey), ["r102"]);

      confirmAnswer = true;
      selectFile(c, JSON.stringify(exported));
      await sleep(120);
      asserts.check("読み込めた", readStatus(c), "JSONから読み込みました");

      await openTab(c, "型式ラン");
      await clickByText(c, /ランを追加/);
      await sleep(30);
      const after = await snapshotAll(c);
      const keys = after.runs.map((r) => r.key);
      asserts.check("削除済みキーは再利用されない", keys.includes("r101"), false);
      asserts.check("追加後のキー", keys, ["r102", "r103", "r104"]);
      asserts.check("追加行に判断は付かない", after.decisions.map((d) => `${d.runKey}|${d.rid}`), ["r102|g102"]);
      asserts.check("残った判断の内容は不変", findDec(after, "r102", "g102").reason, "残る判断（ダミー）");
    },
  },
  {
    id: "D11-json-roundtrip",
    name: "JSON往復で判断・理由・確定日時・要再確認・確定時条件とIDが保持される",
    expect: "書き出し→読み込みで decisions が完全に一致し、画面表示も一致する",
    async run({ mount, asserts }) {
      const app = await mountWithDummy(mount);
      const c = app.container;
      await editDecision(c, 1, 0, { state: "対象外", reason: REASON_TRICKY });
      await editDecision(c, 1, 1, { state: "対象", reason: "往復テスト（ダミー）" });
      // 片方を要再確認にしてから書き出す
      await openTab(c, "帳票"); await sleep(10);
      await clickByText(c, /要再確認にする/);
      await sleep(30);
      const exported = await snapshotAll(c);
      asserts.check("要再確認が立っている", findDec(exported, "r101", "g102").needsRecheck, true);

      const parsed = parseImportedData(exported);
      asserts.check("書き出したJSONを読み戻せる", parsed.ok, true);
      asserts.check("decisionsが完全一致", parsed.data.decisions, exported.decisions);
      asserts.check("runs/regs/certも一致", [parsed.data.runs, parsed.data.regs, parsed.data.cert], [exported.runs, exported.regs, exported.cert]);

      const app2 = await mountWithDummy(mount, {});   // 別インスタンスへ読み込む
      confirmAnswer = true;
      selectFile(app2.container, JSON.stringify(exported));
      await sleep(140);
      const c2 = app2.container;
      asserts.checkTrue("復元後も対象外", cellText(c2,1,0).includes("人：対象外"));
      asserts.checkTrue("復元後も要再確認", cellText(c2,1,0).includes("要再確認"));
      asserts.checkTrue("復元後も対象", cellText(c2,1,1).includes("人：対象"));
      const again = await snapshotAll(c2);
      asserts.check("再書き出しでも一致", again.decisions, exported.decisions);
    },
  },
  {
    id: "D12-html-embed-roundtrip",
    name: "保存版HTMLの埋め込みで往復し、HTML風文字列がコードとして実行されない",
    expect: "</script>や<!--を含む理由が原文のまま復元。scriptは1個のまま増えず、実行もされない",
    async run({ mount, asserts }) {
      const data = {
        ...clone(DUMMY),
        decisions: [{
          runKey: "r101", rid: "g102", state: "対象外", reason: REASON_TRICKY,
          decidedAt: "2026-09-09 00:30", needsRecheck: true,
          cond: condOf(DUMMY.runs[0], DUMMY.regs[1], DUMMY.regs),
        }],
      };
      const tpl = [
        "<!doctype html><html><head><title>t</title></head><body>",
        "<!--ILIST_BOOT_DATA_START-->",
        '<script type="application/json" id="ilist-boot-data">null</script>',
        "<!--ILIST_BOOT_DATA_END-->",
        "</body></html>",
      ].join("\n");

      const built = replaceBootData(tpl, data);
      asserts.check("埋め込みに成功", built.ok, true);
      // 生のHTMLに現れる "</script" は、埋め込み枠そのものの終了タグ1個だけであること。
      // 理由に含まれる "</script>" が素で出ていればここが2以上になり、要素が早期終端する。
      asserts.check("</script は正規の1個だけ", (built.html.match(/<\/script/gi) || []).length, 1);
      asserts.check("理由側はエスケープされている", built.html.includes("\\u003c/script"), true);
      asserts.check("HTMLコメント終端も素で出ない", built.html.includes("<!--"), true);   // マーカー自体は残る
      asserts.check("理由の <!-- はエスケープされている", built.html.includes("\\u003c!--"), true);

      window.__PWNED__ = undefined;
      const doc = new DOMParser().parseFromString(built.html, "text/html");
      asserts.check("script要素は1個のまま", doc.querySelectorAll("script").length, 1);
      asserts.check("スクリプトは実行されていない", window.__PWNED__, undefined);

      const boot = readBootData(doc);
      asserts.check("埋め込みを読める", [boot.present, boot.ok], [true, true]);
      asserts.check("判断が原文のまま復元", boot.data.decisions, data.decisions);
      asserts.check("理由の文字列が完全一致", boot.data.decisions[0].reason, REASON_TRICKY);

      const app = mount(boot);
      await sleep(80);
      const c = app.container;
      asserts.checkTrue("起動時から対象外", cellText(c,1,0).includes("人：対象外"));
      asserts.checkTrue("起動時から要再確認", cellText(c,1,0).includes("要再確認"));
      await openEditorOnly(c, 1, 0);
      const ta = cellAt(c, 1, 0).querySelector("textarea");
      asserts.check("編集領域に原文が入る", ta.value, REASON_TRICKY);
      asserts.check("編集領域にscript要素は無い", cellAt(c,1,0).querySelectorAll("script").length, 0);
      await closeEditor(c, 1, 0);
      // 編集領域を閉じた状態のセル。理由は文字として表示されるだけで、要素にはならない
      // （閉じている間は見出し用の <b> も無いので、<b> が1つでもあれば注入されたことになる）。
      asserts.check("理由が要素として注入されていない", cellAt(c,1,0).querySelectorAll("script, b, i").length, 0);
      asserts.checkTrue("理由が文字として表示される", cellAt(c,1,0).textContent.includes("<b>太字にはならない</b>"));
      asserts.check("実行されていない", window.__PWNED__, undefined);
    },
  },
  {
    id: "D13-legacy-json",
    name: "decisions を持たない旧JSONは全件未確認として受け入れる",
    expect: "旧形式でも読み込め、rid補完も従来どおり。判断は0件",
    async run({ mount, asserts }) {
      const legacyWithRid = clone(DUMMY);
      const parsed = parseImportedData(legacyWithRid);
      asserts.check("旧形式を受理", parsed.ok, true);
      asserts.check("判断は空", parsed.data.decisions, []);

      const legacyNoRid = { runs: clone(DUMMY.runs), regs: DUMMY.regs.map(({ rid, ...r }) => r), cert: clone(DUMMY.cert) };
      const p2 = parseImportedData(legacyNoRid);
      asserts.check("rid無しの旧形式も受理", p2.ok, true);
      asserts.check("ridが補完される", p2.data.regs.every((r) => /^g\d+$/.test(r.rid)), true);
      asserts.check("判断は空", p2.data.decisions, []);

      const app = await mountWithDummy(mount);
      confirmAnswer = true;
      selectFile(app.container, JSON.stringify(legacyNoRid));
      await sleep(140);
      asserts.check("読み込めた", readStatus(app.container), "JSONから読み込みました");
      await openTab(app.container, "帳票"); await sleep(20);
      asserts.checkTrue("全件未確認", cellText(app.container, 1, 0).includes("人：未確認"));
      asserts.check("判断0件", (await snapshotAll(app.container)).decisions.length, 0);
    },
  },
  {
    id: "D14-broken-decisions-rejected",
    name: "壊れたdecisionsは現在のデータを一切置換せずに拒否する",
    expect: "型不正・孤立参照・重複・不正state・対象外の理由欠落・cond不正・rid欠落をすべて拒否",
    async run({ mount, asserts }) {
      const ok = {
        runKey: "r101", rid: "g102", state: "対象外", reason: "理由（ダミー）",
        decidedAt: "2026-09-09 00:30", needsRecheck: false,
        cond: condOf(DUMMY.runs[0], DUMMY.regs[1], DUMMY.regs),
      };
      const wrap = (decisions, over = {}) => ({ ...clone(DUMMY), decisions, ...over });
      const bad = [
        ["decisionsが配列でない", wrap({})],
        ["要素がオブジェクトでない", wrap([null])],
        ["存在しないランを参照", wrap([{ ...ok, runKey: "r999" }])],
        ["存在しない法規行を参照", wrap([{ ...ok, rid: "g999" }])],
        ["同じ組が重複", wrap([ok, { ...ok, reason: "別の理由" }])],
        ["state不正", wrap([{ ...ok, state: "たぶん対象" }])],
        ["対象外なのに理由が空白のみ", wrap([{ ...ok, reason: "   " }])],
        ["needsRecheckが真偽値でない", wrap([{ ...ok, needsRecheck: "yes" }])],
        ["decidedAtが文字列でない", wrap([{ ...ok, decidedAt: 1 }])],
        ["未確認なのに確定日時を持つ", wrap([{ ...ok, state: "未確認", reason: "", cond: null }])],
        ["condの項目が欠ける", wrap([{ ...ok, cond: { ...ok.cond, parentRid: undefined } }])],
        ["parentLinkが不正", wrap([{ ...ok, cond: { ...ok.cond, parentLink: "maybe" } }])],
        ["一意でないのにparentRidを持つ", wrap([{ ...ok, cond: { ...ok.cond, parentLink: "ambiguous", parentRid: "g101" } }])],
        ["parentRidの形式が不正", wrap([{ ...ok, cond: { ...ok.cond, parentLink: "one", parentRid: "gX" } }])],
        ["decisions付きでridが欠けている", wrap([ok], { regs: DUMMY.regs.map(({ rid, ...r }) => r) })],
      ];
      for (const [label, payload] of bad) {
        asserts.check(`拒否: ${label}`, parseImportedData(payload).ok, false);
      }
      asserts.check("正常なものは受理", parseImportedData(wrap([ok])).ok, true);

      // 画面から読み込んでも現在のデータ・判断・採番が変わらないこと
      const app = await mountWithDummy(mount);
      const c = app.container;
      await editDecision(c, 1, 0, { state: "対象", reason: "維持されるべき判断（ダミー）" });
      const before = await snapshotAll(c);
      const beforeIds = peekIds();
      confirmAnswer = true;
      for (const [, payload] of bad) {
        window.__ALERTS__ = [];
        selectFile(c, JSON.stringify(payload));
        await sleep(60);
        const now = await snapshotAll(c);
        if (JSON.stringify(now) !== JSON.stringify(before)) {
          asserts.check("拒否後もデータ不変", now, before);
          break;
        }
      }
      asserts.check("すべて拒否してもデータ不変", await snapshotAll(c), before);
      asserts.check("採番も不変", peekIds(), beforeIds);
      asserts.check("不正JSONそのものも拒否", await (async () => {
        selectFile(c, "{ これはJSONではない");
        await sleep(60);
        return JSON.stringify(await snapshotAll(c)) === JSON.stringify(before);
      })(), true);
    },
  },
  {
    id: "D15-api-misload-guard",
    name: "API版はdecisions付きJSONをstate置換前に拒否し、それを原因とするPUTを出さない",
    expect: "誤投入でstateは変わらず、増えるPUTは直前の編集に由来する1件だけ（本文にdecisionsを含まない）",
    async run({ mountApi, asserts }) {
      const api = installApiMock({ runs: clone(DUMMY.runs), regs: DUMMY.regs.map(({ rid, ...r }) => r), cert: clone(DUMMY.cert) });
      try {
        const app = mountApi();
        await sleep(1300);                       // 初回読込＋最初の自動保存を通過させる
        const base = api.puts.length;
        asserts.checkTrue("初回読込後にPUTが1回以上", base >= 1);

        await openTab(app.container, "型式ラン");
        setNativeValue(runTypeInputs(app.container)[0], "EDITED-BEFORE-IMPORT");
        await sleep(60);                          // 予約済みPUT（800ms後）を待たずに誤投入する
        const beforeImport = api.puts.length;
        asserts.check("この時点ではまだ送られていない", beforeImport, base);

        window.__ALERTS__ = [];
        const payload = {
          ...clone(DUMMY),
          decisions: [{ runKey: "r101", rid: "g102", state: "対象外", reason: "誤投入テスト（ダミー）", decidedAt: "2026-09-09 00:30", needsRecheck: false, cond: null }],
        };
        selectFile(app.container, JSON.stringify(payload));
        await sleep(120);
        asserts.check("拒否の案内が出る", window.__ALERTS__.some((m) => m.includes("判断データ")), true);
        asserts.check("stateが置き換わっていない", runTypeInputs(app.container)[0].value, "EDITED-BEFORE-IMPORT");

        await sleep(1400);                        // 予約済みPUTの発火を待つ
        const added = api.puts.length - beforeImport;
        asserts.check("増えたPUTは予約済みの1件だけ", added, 1);
        const last = api.puts[api.puts.length - 1];
        asserts.check("PUT本文は編集内容", last.runs[0].typeId, "EDITED-BEFORE-IMPORT");
        asserts.check("PUT本文にdecisionsは無い", last.decisions, undefined);
        asserts.check("PUT本文は誤投入データで置き換わっていない", last.runs.length, DUMMY.runs.length);

        await sleep(600);
        asserts.check("その後もPUTは増えない", api.puts.length - beforeImport, 1);
      } finally {
        api.restore();
      }
    },
  },
  {
    id: "D16-api-ui-regression",
    name: "API版で判断propsを省略したとき、判断UIが出ず従来表示が保たれる",
    expect: "判断の編集ボタン・「人：」行・要再確認ボタン・判断の凡例が出ない。赤緑黄と実績表示は従来どおり",
    async run({ mountApi, asserts }) {
      const api = installApiMock({ runs: clone(DUMMY.runs), regs: DUMMY.regs.map(({ rid, ...r }) => r), cert: clone(DUMMY.cert) });
      try {
        const app = mountApi();
        await sleep(1300);
        const c = app.container;
        asserts.check("判断の編集ボタンが無い", c.querySelectorAll('button[title="適用判断・理由メモを編集"]').length, 0);
        asserts.check("textareaが無い", c.querySelectorAll("textarea").length, 0);
        asserts.check("「人：」行が無い", c.textContent.includes("人："), false);
        asserts.check("手動要再確認ボタンが無い", [...c.querySelectorAll("button")].some((b) => b.textContent.includes("要再確認にする")), false);
        asserts.check("判断の凡例が無い", c.textContent.includes("下段「人：」＝人の適用判断"), false);

        // 既存の帳票表示は従来どおり
        asserts.check("セル数（法規4×ラン3）", c.querySelectorAll("tbody tr td").length, 4 * (3 + 1));
        asserts.check("行0の枠色", [cellBorder(c,0,0), cellBorder(c,0,1), cellBorder(c,0,2)], [GREEN_RGB, GREEN_RGB, RED_RGB]);
        asserts.check("行3の枠色（黄色を含む）", [cellBorder(c,3,0), cellBorder(c,3,1), cellBorder(c,3,2)], [RED_RGB, RED_RGB, AMBER_RGB]);
        asserts.checkTrue("同型式の実績を共有して表示", cellText(c,0,1).includes("CK-1"));
        asserts.checkTrue("黄色の予告文", cellText(c,3,2).includes("継続規制まで21日"));
        asserts.checkTrue("申請発生の表示", cellText(c,1,0).includes("申請発生"));
        asserts.checkTrue("保存状態の表示（サーバ保存済み）", c.textContent.includes("サーバに保存済み"));
      } finally {
        api.restore();
      }
    },
  },
  {
    id: "D17-pure-functions",
    name: "判断まわりの純関数の境界（掃き出し・正規化・手動再確認・削除・登録）",
    expect: "sweepRecheckは立てるだけで下ろさない。未確認・他ランには触れない",
    async run({ asserts }) {
      const run = DUMMY.runs[0], reg = DUMMY.regs[1], regs = DUMMY.regs;
      const cond = condOf(run, reg, regs);
      const decided = { runKey: "r101", rid: "g102", state: "対象外", reason: "R", decidedAt: "2026-09-09 00:00", needsRecheck: false, cond };
      const unconfirmed = { runKey: "r102", rid: "g102", state: "未確認", reason: "メモ", decidedAt: "", needsRecheck: false, cond: null };

      // 条件が一致していれば何も起きず、同じ配列参照が返る
      const input = [decided, unconfirmed];
      const same = sweepRecheck(input, DUMMY.runs, regs);
      asserts.check("変化なしなら同一の配列参照を返す", same === input, true);
      asserts.check("要素も同一参照", same[0] === decided && same[1] === unconfirmed, true);
      asserts.check("フラグは立たない", same[0].needsRecheck, false);

      // 条件が変わると立つ
      const movedRuns = [{ ...run, lo: "2029-01-01" }, ...DUMMY.runs.slice(1)];
      const swept = sweepRecheck([decided, unconfirmed], movedRuns, regs);
      asserts.check("確定判断に立つ", swept[0].needsRecheck, true);
      asserts.check("未確認には立たない", swept[1].needsRecheck, false);
      asserts.check("理由・確定日時は保持", [swept[0].reason, swept[0].decidedAt], ["R", "2026-09-09 00:00"]);

      // いちど立ったら、条件が戻っても下りない
      const back = sweepRecheck(swept, DUMMY.runs, regs);
      asserts.check("条件が戻っても下ろさない", back[0].needsRecheck, true);

      // 確定時条件が欠けている判断は安全側で立てる
      const noCond = [{ ...decided, cond: null }];
      asserts.check("cond欠落は要再確認", sweepRecheck(noCond, DUMMY.runs, regs)[0].needsRecheck, true);

      // 手動の要再確認は対象ランの確定判断だけ
      const marked = markRunNeedsRecheck([decided, unconfirmed, { ...decided, runKey: "r103" }], "r101");
      asserts.check("対象ランだけ立つ", marked.map((d) => d.needsRecheck), [true, false, false]);

      // 削除の伝播
      asserts.check("ラン削除", pruneDecisionsByRun([decided, unconfirmed], "r101").map((d) => d.runKey), ["r102"]);
      asserts.check("法規行削除", pruneDecisionsByReg([decided, unconfirmed], "g102").length, 0);

      // 登録・更新
      const up = upsertDecision([decided], { ...decided, reason: "更新" });
      asserts.check("同じ組は置き換え", [up.length, up[0].reason], [1, "更新"]);
      asserts.check("違う組は追加", upsertDecision([decided], { ...decided, rid: "g103" }).length, 2);

      // 正規化：情報を持たない未確認は落とす／メモ付き未確認は残す
      asserts.check("空の未確認は落とす", normalizeDecisions([{ ...unconfirmed, reason: "" }]).length, 0);
      asserts.check("メモ付き未確認は残す", normalizeDecisions([unconfirmed]).length, 1);
      asserts.check("確定判断は残す", normalizeDecisions([decided]).length, 1);
    },
  },
  {
    id: "D18-autorecheck-marks-unsaved",
    name: "【P1】boot で要再確認が自動で立ったら、未書き出し保護へ一貫して反映する",
    expect: "未書き出し表示・終了時ハンドラ・次の読込の置換確認がすべて働き、条件を戻しても保持される",
    async run({ mount, asserts }) {
      // 確定時条件が現在と食い違う判断（cond.lo が実際の run.lo と違う）を持つ保存版HTMLから起動する
      const mismatched = {
        runKey: "r101", rid: "g102", state: "対象外", reason: "条件が変わっている判断（ダミー）",
        decidedAt: "2026-09-01 10:00", needsRecheck: false,
        cond: { ...condOf(DUMMY.runs[0], DUMMY.regs[1], DUMMY.regs), lo: "2001-01-01" },
      };
      const app = await mountWithDummy(mount, { decisions: [mismatched] });
      const c = app.container;
      await sleep(60);

      // ここは書き出さずに観測する（snapshotAll を先に呼ぶと dirty がその操作で消えてしまう）
      asserts.checkTrue("要再確認が立っている", cellText(c, 1, 0).includes("要再確認"));
      asserts.check("未書き出し表示になる", readStatus(c), "未書き出しの変更があります（書き出してください）");
      asserts.check("終了時警告ハンドラが登録されている", beforeUnloadArmed(), true);

      // 次の読込で置換確認が働き、キャンセルすれば現在のデータと dirty を維持する
      window.__ALERTS__ = [];
      confirmAnswer = false;
      const other = { ...clone(DUMMY), decisions: [] };
      selectFile(c, JSON.stringify(other));
      await sleep(140);
      asserts.check("置換確認が出る", confirmCount(), 1);
      asserts.checkTrue("キャンセルで判断が残る", cellText(c, 1, 0).includes("人：対象外"));
      asserts.check("キャンセルで未書き出しのまま", readStatus(c), "未書き出しの変更があります（書き出してください）");

      // 条件を元に戻しても要再確認は解除されない
      await openTab(c, "型式ラン");
      setNativeValue(dateInputs(c)[0], "2001-01-01");
      await sleep(40);
      await openTab(c, "帳票"); await sleep(20);
      asserts.checkTrue("条件を戻しても要再確認のまま", cellText(c, 1, 0).includes("要再確認"));

      // 書き出しにフラグが入る／書き出し直後に理由なく dirty へ戻らない
      const exported = await snapshotAll(c);
      asserts.check("書き出しに要再確認が入る", findDec(exported, "r101", "g102")?.needsRecheck ?? "判断が消えている", true);
      await sleep(250);
      asserts.check("保存後に理由なくdirtyへ戻らない", readStatus(c), "JSONの書き出しを開始しました（保存先はブラウザの動作に従います）");
      asserts.check("保存後は終了時ハンドラも外れる", beforeUnloadArmed(), false);

      // 明示承認した置換は成立する
      window.__ALERTS__ = [];
      confirmAnswer = true;
      selectFile(c, JSON.stringify(other));
      await sleep(140);
      asserts.check("承認した置換は成立", readStatus(c), "JSONから読み込みました");
      asserts.checkTrue("置換後は判断なし", cellText(c, 1, 0).includes("人：未確認"));
    },
  },
  {
    id: "D19-no-spurious-dirty",
    name: "【P1】条件が一致していれば、起動しただけで未書き出しにならない",
    expect: "cond一致・needsRecheck falseの保存版から起動すると保存状態は変わらず、Effectも空回りしない",
    async run({ mount, asserts }) {
      const matched = {
        runKey: "r101", rid: "g102", state: "対象", reason: "条件が一致している判断（ダミー）",
        decidedAt: "2026-09-01 10:00", needsRecheck: false,
        cond: condOf(DUMMY.runs[0], DUMMY.regs[1], DUMMY.regs),
      };
      const app = await mountWithDummy(mount, { decisions: [matched] });
      const c = app.container;
      await sleep(200);
      asserts.check("起動直後の保存状態", readStatus(c), "保存済みのHTMLから起動しました（この時点のデータで再開しています）");
      asserts.check("終了時ハンドラは登録されない", beforeUnloadArmed(), false);
      asserts.checkTrue("要再確認は立たない", !cellText(c, 1, 0).includes("要再確認"));
      await sleep(400);
      asserts.check("時間が経っても保存状態は変わらない（Effectループなし）", readStatus(c), "保存済みのHTMLから起動しました（この時点のデータで再開しています）");

      // 読込でも同じ：条件一致のデータを読んでも dirty にしない
      window.__ALERTS__ = [];
      confirmAnswer = true;
      selectFile(c, JSON.stringify({ ...clone(DUMMY), decisions: [matched] }));
      await sleep(200);
      asserts.check("置換確認は出ない（dirtyでないため）", confirmCount(), 0);
      asserts.check("読込後の保存状態", readStatus(c), "JSONから読み込みました");
      await sleep(300);
      asserts.check("読込後も理由なくdirtyにならない", readStatus(c), "JSONから読み込みました");
    },
  },
  {
    id: "D20-editor-after-import",
    name: "【P2】読込成功後に古い判断エディタを残さない／失敗・キャンセルでは編集中の入力を維持",
    expect: "正常置換でエディタを閉じ、旧理由を新しい判断へ書き戻せない。不正・キャンセルでは入力を保つ",
    async run({ mount, asserts }) {
      const oldDec = {
        runKey: "r101", rid: "g102", state: "対象", reason: "OLD-REASON",
        decidedAt: "2026-09-01 10:00", needsRecheck: false,
        cond: condOf(DUMMY.runs[0], DUMMY.regs[1], DUMMY.regs),
      };
      const newDec = { ...oldDec, reason: "NEW-REASON", decidedAt: "2026-09-02 11:11" };
      const app = await mountWithDummy(mount, { decisions: [oldDec] });
      const c = app.container;

      // 編集中（未保存）の入力を持ったままにする
      await openEditorOnly(c, 1, 0);
      setNativeValue(cellAt(c, 1, 0).querySelector("textarea"), "TYPING-IN-PROGRESS");
      await sleep(20);
      asserts.check("編集中の入力", cellAt(c, 1, 0).querySelector("textarea").value, "TYPING-IN-PROGRESS");

      // (1) 不正ファイル：現在のデータも編集中の入力も維持する
      window.__ALERTS__ = [];
      selectFile(c, "{ これはJSONではない");
      await sleep(120);
      asserts.checkTrue("不正ファイルでエディタは開いたまま", isEditorOpen(c, 1, 0));
      asserts.check("不正ファイルで入力を維持", cellAt(c, 1, 0).querySelector("textarea").value, "TYPING-IN-PROGRESS");

      // (2) 置換キャンセル：同じく維持する（dirtyにしてから確認を出させる）
      await clickByText(c, /要再確認にする/);          // r101 の見出しから手動要再確認 → dirty
      await sleep(40);
      await ensureEditorOpen(c, 1, 0);
      setNativeValue(cellAt(c, 1, 0).querySelector("textarea"), "TYPING-AGAIN");
      await sleep(20);
      window.__ALERTS__ = [];
      confirmAnswer = false;
      selectFile(c, JSON.stringify({ ...clone(DUMMY), decisions: [newDec] }));
      await sleep(140);
      asserts.check("キャンセル時に置換確認は出ている", confirmCount(), 1);
      asserts.checkTrue("キャンセルでエディタは開いたまま", isEditorOpen(c, 1, 0));
      asserts.check("キャンセルで入力を維持", cellAt(c, 1, 0).querySelector("textarea").value, "TYPING-AGAIN");

      // (3) 正常置換：エディタを閉じ、古い入力を新しい判断へ書き戻せない
      window.__ALERTS__ = [];
      confirmAnswer = true;
      selectFile(c, JSON.stringify({ ...clone(DUMMY), decisions: [newDec] }));
      await sleep(180);
      asserts.check("正常置換でエディタが閉じる", isEditorOpen(c, 1, 0), false);
      asserts.checkTrue("新しい理由が表示される", cellText(c, 1, 0).includes("NEW-REASON"));
      await ensureEditorOpen(c, 1, 0);
      asserts.check("開き直すと新しい理由が入っている", cellAt(c, 1, 0).querySelector("textarea").value, "NEW-REASON");
      await closeEditor(c, 1, 0);
      const after = await snapshotAll(c);
      asserts.check("保存内容も新しい理由", findDec(after, "r101", "g102").reason, "NEW-REASON");
      asserts.check("古い確定日時で上書きされていない", findDec(after, "r101", "g102").decidedAt, "2026-09-02 11:11");

      // (4) 通常のメモ編集・保存までは再初期化しない
      await editDecision(c, 1, 0, { reason: "AFTER-IMPORT-MEMO" });
      const after2 = await snapshotAll(c);
      asserts.check("読込後も通常のメモ保存は効く", findDec(after2, "r101", "g102").reason, "AFTER-IMPORT-MEMO");
      asserts.check("メモ保存で日時は動かない", findDec(after2, "r101", "g102").decidedAt, "2026-09-02 11:11");
    },
  },
  {
    id: "D21-decidedAt-validation",
    name: "【P2】確定日時の空・不正・存在しない日時を拒否する（未確認は空のまま）",
    expect: "対象/対象外は YYYY-MM-DD HH:MM の実在する日時のみ受理。拒否時はデータ・dirty・採番・入力を変えない",
    async run({ mount, asserts }) {
      const base = {
        runKey: "r101", rid: "g102", state: "対象外", reason: "理由（ダミー）",
        decidedAt: "2026-09-09 00:30", needsRecheck: false,
        cond: condOf(DUMMY.runs[0], DUMMY.regs[1], DUMMY.regs),
      };
      const wrap = (d) => ({ ...clone(DUMMY), decisions: [d] });
      const accept = [
        ["アプリが生成する形式", "2026-09-09 00:30"],
        ["境界（元日0時0分）", "2026-01-01 00:00"],
        ["境界（大晦日23時59分）", "2026-12-31 23:59"],
        ["閏年2月29日", "2024-02-29 23:59"],
        ["400年閏年", "2000-02-29 00:00"],
      ];
      for (const [label, v] of accept) {
        asserts.check(`受理: ${label}`, parseImportedData(wrap({ ...base, decidedAt: v })).ok, true);
      }
      const reject = [
        ["空文字", ""],
        ["空白のみ", "   "],
        ["日本語混じり", "２０２６年９月９日"],
        ["文字列", "not a date"],
        ["13月", "2026-13-01 00:00"],
        ["0月", "2026-00-10 00:00"],
        ["存在しない2月30日", "2026-02-30 10:00"],
        ["平年の2月29日", "2023-02-29 00:00"],
        ["100年非閏年の2月29日", "2100-02-29 00:00"],
        ["31日のない月", "2026-04-31 00:00"],
        ["24時", "2026-09-09 24:00"],
        ["60分", "2026-09-09 10:60"],
        ["0日", "2026-09-00 10:00"],
        ["桁が足りない", "2026-9-9 1:2"],
        ["ISO風のT区切り", "2026-09-09T00:30"],
        ["秒が付いている", "2026-09-09 00:30:15"],
        ["前後に空白", " 2026-09-09 00:30 "],
        ["日付だけ", "2026-09-09"],
      ];
      for (const [label, v] of reject) {
        asserts.check(`拒否: ${label}`, parseImportedData(wrap({ ...base, decidedAt: v })).ok, false);
      }
      // 「対象」でも同じ規則。未確認は空という契約を維持する
      asserts.check("対象でも空日時は拒否", parseImportedData(wrap({ ...base, state: "対象", decidedAt: "" })).ok, false);
      asserts.check("未確認は空日時のみ受理",
        parseImportedData(wrap({ runKey: "r101", rid: "g102", state: "未確認", reason: "メモ", decidedAt: "", needsRecheck: false, cond: null })).ok, true);
      asserts.check("未確認が日時を持てば拒否",
        parseImportedData(wrap({ runKey: "r101", rid: "g102", state: "未確認", reason: "メモ", decidedAt: "2026-09-09 00:30", needsRecheck: false, cond: null })).ok, false);
      // 既存のLO・規制日の受理仕様は変えていない（日付欄は従来どおり文字列として受ける）
      const looseDates = clone(DUMMY);
      looseDates.runs[0].lo = "";
      looseDates.regs[0].shin = "2026-13-45";
      asserts.check("既存の日付欄の受理仕様は不変", parseImportedData(looseDates).ok, true);

      // 画面から読み込んでも、データ・dirty・採番・編集中の入力を変えない
      const app = await mountWithDummy(mount, { decisions: [base] });
      const c = app.container;
      await openEditorOnly(c, 1, 0);
      setNativeValue(cellAt(c, 1, 0).querySelector("textarea"), "TYPING-DURING-REJECT");
      await sleep(20);
      const statusBefore = readStatus(c);
      const idsBefore = peekIds();
      window.__ALERTS__ = [];
      confirmAnswer = true;
      selectFile(c, JSON.stringify(wrap({ ...base, decidedAt: "2026-02-30 10:00" })));
      await sleep(140);
      asserts.check("拒否の案内が出る", window.__ALERTS__.some((m) => m.includes("読み込めません")), true);
      asserts.check("保存状態は変わらない", readStatus(c), statusBefore);
      asserts.check("採番は変わらない", peekIds(), idsBefore);
      asserts.checkTrue("編集中の入力を維持", isEditorOpen(c, 1, 0));
      asserts.check("入力内容も維持",
        cellAt(c, 1, 0).querySelector("textarea")?.value ?? "(編集領域が閉じている)", "TYPING-DURING-REJECT");
      await closeEditor(c, 1, 0);
      asserts.checkTrue("元の判断が残っている", cellText(c, 1, 0).includes("人：対象外"));
    },
  },
  {
    id: "D22-recheck-scope-by-reg",
    name: "法規側の条件変更は、その法規の判断だけに及ぶ（ランをまたいで正しく波及する）",
    expect: "REG-2のkei変更でr101×REG-2とr102×REG-2だけが要再確認。他の法規の判断は変わらない",
    async run({ mount, asserts }) {
      const app = await mountWithDummy(mount);
      const c = app.container;
      await editDecision(c, 0, 0, { state: "対象", reason: "r101×REG-1（ダミー）" });
      await editDecision(c, 1, 0, { state: "対象", reason: "r101×REG-2（ダミー）" });
      await editDecision(c, 1, 1, { state: "対象", reason: "r102×REG-2（ダミー）" });
      await editDecision(c, 2, 1, { state: "対象", reason: "r102×REG-3（ダミー）" });
      asserts.check("初期はどれも要再確認でない",
        [cellText(c,0,0), cellText(c,1,0), cellText(c,1,1), cellText(c,2,1)].map((t) => t.includes("要再確認")),
        [false, false, false, false]);

      await openTab(c, "法規DB");
      // REG-2（2行目）の継続適用日を変更する。日付欄は 新型/継続 の順に2つずつ並ぶ
      setNativeValue(dateInputs(c)[3], "2026-03-15");
      await sleep(40);
      await openTab(c, "帳票"); await sleep(20);
      asserts.check("REG-2の判断だけが要再確認（ランをまたぐ）",
        [cellText(c,0,0), cellText(c,1,0), cellText(c,1,1), cellText(c,2,1)].map((t) => t.includes("要再確認")),
        [false, true, true, false]);
      const snap = await snapshotAll(c);
      asserts.check("保存側の内訳も一致",
        snap.decisions.map((d) => `${d.runKey}|${d.rid}|${d.needsRecheck}`),
        ["r101|g101|false", "r101|g102|true", "r102|g102|true", "r102|g103|false"]);
    },
  },
  {
    id: "D23-snapshot-not-effect-dependent",
    name: "【P1】書き出し内容が掃き出しEffectの反映待ちに依存しない",
    expect: "起動直後（Effectの反映を待たずに）書き出しても、要再確認が入った内容が書き出される",
    async run({ mount, asserts }) {
      const mismatched = {
        runKey: "r101", rid: "g102", state: "対象外", reason: "条件が変わっている判断（ダミー）",
        decidedAt: "2026-09-01 10:00", needsRecheck: false,
        cond: { ...condOf(DUMMY.runs[0], DUMMY.regs[1], DUMMY.regs), lo: "2001-01-01" },
      };
      const parsed = parseImportedData({ ...clone(DUMMY), decisions: [mismatched] });
      asserts.check("前提のデータが妥当", parsed.ok, true);
      const app = mount({ present: true, ok: true, data: parsed.data, maxId: parsed.maxId, maxRid: parsed.maxRid });
      // 描画されるまでだけ待つ（掃き出しEffectの反映を明示的には待たない）。
      // なお「描画完了からEffect反映までの隙間で保存する」という競合そのものは、
      // ボタンが現れるのを待つ時点でEffectも流れてしまうため、この経路では再現できなかった。
      // このケースの意義は競合の再現ではなく、書き出し内容がEffectの反映に依存しない
      // という不変条件の常設確認である（掃き出しEffectを止めた対照実験で有効性を確認している）。
      for (let i = 0; i < 100 && !app.container.querySelector("button"); i++) await sleep(1);
      const exported = await snapshotAll(app.container);
      asserts.check("書き出しに要再確認が入る", findDec(exported, "r101", "g102")?.needsRecheck ?? "判断が消えている", true);
      asserts.check("理由・確定日時・確定時条件はそのまま",
        [findDec(exported, "r101", "g102")?.reason, findDec(exported, "r101", "g102")?.decidedAt, findDec(exported, "r101", "g102")?.cond?.lo],
        [mismatched.reason, mismatched.decidedAt, "2001-01-01"]);
    },
  },
];

// ───────────────────────────────────────────────
// ランナー
// ───────────────────────────────────────────────
function Runner() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const runAll = async () => {
    if (window.__DVERIFY_RUNNING__) return;
    window.__DVERIFY_RUNNING__ = true;
    window.__DVERIFY_RESULT__ = { finished: false };
    setRunning(true); setDone(false); setResults({});
    const collected = {};
    const only = new URLSearchParams(location.search).get("only");
    const targets = only ? SCENARIOS.filter((x) => only.split(",").some((k) => x.id.startsWith(k))) : SCENARIOS;
    try {
      for (const s of targets) {
        setResults((p) => ({ ...p, [s.id]: { state: "running" } }));
        resetIds();                 // 採番はモジュール共有なのでケース間で持ち越さない
        confirmAnswer = true;
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
        await sleep(60);
      }
    } finally {
      setRunning(false); setDone(true);
      const vals = Object.values(collected);
      window.__DVERIFY_RESULT__ = {
        finished: true,
        pass: vals.filter((r) => r.pass).length,
        fail: vals.filter((r) => !r.pass).length,
        total: targets.length,
        residualNodes: document.getElementById("sandbox")?.childElementCount ?? -1,
        scenarios: targets.map((s) => ({ id: s.id, name: s.name, expect: s.expect, pass: collected[s.id]?.pass, actual: collected[s.id]?.actual, detail: collected[s.id]?.detail })),
      };
      window.__DVERIFY_RUNNING__ = false;
    }
  };

  useEffect(() => {
    window.__runDecisionVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);

  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;

  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>適用判断・理由メモ 検証ハーネス</h1>
      <p style={{ color: "#5a6b7d", fontSize: 12.5, lineHeight: 1.7, marginTop: 0 }}>
        実際の <code>StandaloneApp</code> / <code>IListApp</code> をマウントして実測します。<br />
        <strong style={{ color: "#e0b24d" }}>ダミーデータのみ。実APIサーバ・実DBには接続しません（fetchはモック）。</strong>
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
                <span style={{ fontSize: 12, fontWeight: 800, color }}>
                  {!r ? "未実行" : r.state === "running" ? "実行中…" : r.pass ? "PASS" : "FAIL"}
                </span>
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
      <div id="sandbox" style={{ position: "absolute", left: -99999, top: 0, width: 1200, height: 900, overflow: "hidden" }} />
    </div>
  );
}

createRoot(document.getElementById("runner")).render(<Runner />);
