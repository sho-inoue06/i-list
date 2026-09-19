// ───────────────────────────────────────────────
// 帳票の列（型式ラン）表示フィルターの検証ハーネス
//
// ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しない
// （API版のケースでは window.fetch をモックする）。
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/filter.html
//
// 確認する主なこと：
//   ・初期は全件表示。欄内の複数選択はOR、プロジェクト欄と型式欄のあいだはAND、完全一致。
//   ・未選択の欄は制限なし。「すべて表示」で両欄解除。該当0件は0件のまま自動で全件に戻さない。
//   ・「絞り込み中：表示N／全M列」を表示。列は型式ラン単位・元の列順を維持。
//   ・同一コード×複数型式／同一型式×複数コード／同じコード・型式に複数ラン、をすべて正しく出す。
//   ・絞り込みだけでは runs/regs/cert/decisions と dirty が変わらない。非表示列もJSONへ保存される。
//   ・フィルター中の編集は runKey×rid で正しい判断だけを更新する。
//   ・成功したJSON読込で条件を全解除。不正読込・置換キャンセルでは条件・データ・編集中入力を保持。
//   ・選択中の値が現データから消えても自動解除しない（「対象なし」表示・手動解除できる）。
//   ・API版（columnFilter を渡さない）にはフィルターUIが出ず、従来表示のまま。
// ───────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import IListApp from "../src/IListApp.jsx";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

window.__ALERTS__ = [];
let confirmAnswer = true;
window.alert = (m) => { window.__ALERTS__.push(String(m)); };
window.confirm = (m) => { window.__ALERTS__.push("confirm:" + String(m)); return confirmAnswer; };

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
//   PJX … DEMO-A, DEMO-B（同一コード×複数型式：2駆/4駆・HEV/PHEV 相当）
//   DEMO-A … PJX, PJY（同一型式×複数コード）
//   PJZ × DEMO-C … r4, r5（同じコード・型式にランが複数）
const DUMMY = {
  runs: [
    { key: "r1", typeId: "DEMO-A", gen: "PJX", sk: "新", lo: "2019-01-01", drop: "2030-12-31" },
    { key: "r2", typeId: "DEMO-B", gen: "PJX", sk: "新", lo: "2019-01-01", drop: "2030-12-31" },
    { key: "r3", typeId: "DEMO-A", gen: "PJY", sk: "新", lo: "2019-01-01", drop: "2030-12-31" },
    { key: "r4", typeId: "DEMO-C", gen: "PJZ", sk: "新", lo: "2019-01-01", drop: "2030-12-31" },
    { key: "r5", typeId: "DEMO-C", gen: "PJZ", sk: "継", lo: "2019-01-01", drop: "2030-12-31" },
  ],
  regs: [
    { rid: "g1", id: "R1", label: "ダミー法規1", shin: "2018-01-01", kei: "2020-01-01", parent: "" },
    { rid: "g2", id: "R2", label: "ダミー法規2", shin: "2018-01-01", kei: "2020-01-01", parent: "" },
  ],
  cert: { "DEMO-A": { "R1": "CK-A1" } },
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const OTHER = {   // 別データ（読込テスト用）。コード・型式とも DUMMY と重ならない
  runs: [
    { key: "r9", typeId: "OTHER-X", gen: "QP1", sk: "新", lo: "2019-01-01", drop: "2030-12-31" },
    { key: "r8", typeId: "OTHER-Y", gen: "QP2", sk: "新", lo: "2019-01-01", drop: "2030-12-31" },
  ],
  regs: [{ id: "OR1", label: "別法規", shin: "2018-01-01", kei: "2020-01-01", parent: "" }],
  cert: {},
};

const setNativeValue = (el, value) => {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter ? setter.call(el, value) : (el.value = value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

function createMountManager() {
  const mounted = [];
  const mkRoot = () => { const el = document.createElement("div"); document.getElementById("sandbox").appendChild(el); return el; };
  const mount = () => {
    const container = mkRoot();
    const root = createRoot(container);
    root.render(<StandaloneApp />);
    const h = { container, unmount() { if (h._d) return; h._d = true; try { root.unmount(); } catch {} try { container.remove(); } catch {} } };
    mounted.push(h); return h;
  };
  const mountApi = () => {
    const container = mkRoot();
    const root = createRoot(container);
    root.render(<IListApp />);
    const h = { container, unmount() { if (h._d) return; h._d = true; try { root.unmount(); } catch {} try { container.remove(); } catch {} } };
    mounted.push(h); return h;
  };
  return { mount, mountApi, cleanupAll() { for (const h of mounted.slice().reverse()) h.unmount(); mounted.length = 0; } };
}

async function mountWithDummy(mount, data = DUMMY) {
  const h = mount();
  await sleep(30);
  // 埋め込み起動データではなく、JSON読込経路で確定的にダミーを入れる
  selectFile(h.container, JSON.stringify(data));
  await sleep(120);
  return h;
}

function selectFile(container, text, name = "d.json") {
  const inp = container.querySelector('input[type="file"]');
  if (!inp) throw new Error("file input が見つかりません");
  const dt = new DataTransfer();
  dt.items.add(new File([text], name, { type: "application/json" }));
  Object.defineProperty(inp, "files", { value: dt.files, configurable: true });
  inp.dispatchEvent(new Event("change", { bubbles: true }));
}

async function snapshotAll(container) {
  const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL;
  const realClick = HTMLAnchorElement.prototype.click;
  let blob = null;
  URL.createObjectURL = (b) => { blob = b; return "blob:dummy"; };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () {};
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
  return { dataGen: hooks[10], dirtyRef: hooks[11]?.current, saveState: hooks[5], runsLen: hooks[0]?.length };
}
function beforeUnloadArmed() {
  const ev = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

async function clickByText(container, re) {
  const b = [...container.querySelectorAll("button")].find((x) => re.test(x.textContent));
  if (!b) throw new Error(`ボタンが見つかりません: ${re}`);
  b.click(); await sleep(40); return b;
}
const openTab = (c, name) => clickByText(c, new RegExp(name));

// 帳票の thead から、表示中の型式ランの typeId 列を順に読む（先頭thは「法規 \ 型式ラン」なので除く）
function visibleTypeIds(container) {
  const ths = [...container.querySelectorAll("table thead th")];
  // 各thの span: [0]=色スウォッチ(空) / [1]=型式 / [2]=プロジェクトコード
  return ths.slice(1).map((th) => th.querySelectorAll("span")[1]?.textContent || "");
}
function visibleColCount(container) {
  const head = container.querySelector("table thead tr");
  return head ? head.children.length - 1 : 0;
}
function filterStatusText(container) {
  const el = [...container.querySelectorAll("span")].find((s) => /全 \d+ 列を表示中|絞り込み中：表示 \d+ ／ 全 \d+ 列/.test(s.textContent));
  return el ? el.textContent.trim() : "(なし)";
}
function hasFilterBar(container) {
  return [...container.querySelectorAll("span")].some((s) => s.textContent.trim() === "表示フィルター");
}
function chip(container, label) {
  const b = [...container.querySelectorAll("button")].find((x) => {
    const t = x.textContent.trim();
    return t === label || t === label + "（対象なし）";
  });
  if (!b) throw new Error(`チップが見つかりません: ${label}（候補: ${[...container.querySelectorAll("button")].map((x) => x.textContent.trim()).join(" | ")}）`);
  return b;
}
async function toggleChip(container, label) { chip(container, label).click(); await sleep(40); }
function zeroHitShown(container) {
  return container.textContent.includes("絞り込み条件に一致する型式ランがありません") && container.textContent.includes("0 件");
}

// セル（行＝法規、列＝表示中の型式ラン）。先頭tdは法規名なので +1。
function cellAt(container, regRow, runCol) {
  const tr = container.querySelector("table tbody").children[regRow];
  return tr.children[runCol + 1];
}
const findDec = (snap, runKey, rid) => (snap.decisions || []).find((d) => d.runKey === runKey && d.rid === rid) || null;

// 判断エディタ観測ヘルパ（帳票セル）
const editorOpen = (c, r, col) => !!cellAt(c, r, col).querySelector("textarea");
const editorReason = (c, r, col) => cellAt(c, r, col).querySelector("textarea")?.value ?? null;
const editorCheckedIdx = (c, r, col) => [...cellAt(c, r, col).querySelectorAll('input[type="radio"]')].findIndex((x) => x.checked);
async function openEditor(c, r, col) {
  const b = cellAt(c, r, col).querySelector('button[title="適用判断・理由メモを編集"]');
  if (!b) throw new Error(`編集ボタンが無い: ${r},${col}`);
  b.click(); await sleep(20);
}
async function editorSetReason(c, r, col, text) {
  const ta = cellAt(c, r, col).querySelector("textarea");
  if (!ta) throw new Error("textarea が無い");
  setNativeValue(ta, text); await sleep(10);
}
async function editorPickState(c, r, col, idx) {
  const radios = cellAt(c, r, col).querySelectorAll('input[type="radio"]');
  radios[idx].click(); await sleep(10);
}
async function editorSave(c, r, col) {
  const b = [...cellAt(c, r, col).querySelectorAll("button")].find((x) => /メモを保存|未確認に戻す|この判断で確定/.test(x.textContent));
  if (!b) throw new Error("保存ボタンが無い");
  b.click(); await sleep(40);
}
async function editorCancel(c, r, col) {
  const b = [...cellAt(c, r, col).querySelectorAll("button")].find((x) => x.textContent.includes("キャンセル"));
  b.click(); await sleep(20);
}

// ───────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "F1-initial-all",
    name: "初期状態は全件表示・絞り込み表示は出ない",
    expect: "5列すべて表示、状態は「全 5 列を表示中」、0件表示は出ない",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      asserts.checkTrue("フィルターバーが出る", hasFilterBar(c));
      asserts.check("初期の表示列数", visibleColCount(c), 5);
      asserts.check("状態表示", filterStatusText(c), "全 5 列を表示中");
      asserts.checkTrue("0件表示は出ていない", !zeroHitShown(c));
    },
  },
  {
    id: "F2-project-single",
    name: "プロジェクトコード単一選択",
    expect: "PJX を選ぶと DEMO-A/DEMO-B の2列、状態は「絞り込み中：表示 2 ／ 全 5 列」",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "PJX");
      asserts.check("表示列数", visibleColCount(c), 2);
      asserts.check("表示中の型式", visibleTypeIds(c), ["DEMO-A", "DEMO-B"]);
      asserts.check("件数表示", filterStatusText(c), "絞り込み中：表示 2 ／ 全 5 列");
    },
  },
  {
    id: "F3-project-OR",
    name: "同じ欄の複数選択はOR",
    expect: "PJX + PJY で r1,r2,r3 の3列",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "PJX"); await toggleChip(c, "PJY");
      asserts.check("表示列数", visibleColCount(c), 3);
      asserts.check("列順は元のrun順", visibleTypeIds(c), ["DEMO-A", "DEMO-B", "DEMO-A"]);
    },
  },
  {
    id: "F4-cross-AND",
    name: "プロジェクト欄と型式欄のあいだはAND",
    expect: "(PJX,PJY) かつ DEMO-A → r1,r3 の2列（r2=PJX×DEMO-B は除外）",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "PJX"); await toggleChip(c, "PJY"); await toggleChip(c, "DEMO-A");
      asserts.check("表示列数", visibleColCount(c), 2);
      asserts.check("型式はDEMO-Aのみ", visibleTypeIds(c), ["DEMO-A", "DEMO-A"]);
      asserts.check("件数表示", filterStatusText(c), "絞り込み中：表示 2 ／ 全 5 列");
    },
  },
  {
    id: "F5-same-code-multi-type",
    name: "同一コードに複数型式：全型式ランが候補になる",
    expect: "PJX 選択で DEMO-A・DEMO-B の両方が出る",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "PJX");
      asserts.check("両型式が出る", [...visibleTypeIds(c)].sort(), ["DEMO-A", "DEMO-B"]);
    },
  },
  {
    id: "F6-same-type-multi-code",
    name: "同一型式に複数コード：型式選択で全コード分が出る",
    expect: "型式 DEMO-A 選択で PJX(r1)・PJY(r3) が出る",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "DEMO-A");
      asserts.check("表示列数", visibleColCount(c), 2);
      asserts.check("該当は r1,r3（type順表示）", visibleTypeIds(c), ["DEMO-A", "DEMO-A"]);
    },
  },
  {
    id: "F7-same-code-type-multi-run",
    name: "同じコード・型式に該当ランが複数でも全列表示",
    expect: "PJZ（＝DEMO-C×2ラン r4,r5）選択で2列",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "PJZ");
      asserts.check("2ランとも出る", visibleColCount(c), 2);
      asserts.check("両方 DEMO-C", visibleTypeIds(c), ["DEMO-C", "DEMO-C"]);
      await toggleChip(c, "DEMO-C");
      asserts.check("型式も足しても2列のまま", visibleColCount(c), 2);
    },
  },
  {
    id: "F8-column-order",
    name: "列順は選択順ではなく元のrun順",
    expect: "PJZ→PJX の順に押しても表示は r1,r2,r4,r5 の順",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "PJZ"); await toggleChip(c, "PJX");
      asserts.check("元順を維持", visibleTypeIds(c), ["DEMO-A", "DEMO-B", "DEMO-C", "DEMO-C"]);
    },
  },
  {
    id: "F9-zero-hit",
    name: "該当0件は0件のまま・自動で全件に戻さない",
    expect: "PJX かつ 型式DEMO-C → 0件表示、表は出ない、選択は残る",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "PJX"); await toggleChip(c, "DEMO-C");
      asserts.checkTrue("0件表示が出る", zeroHitShown(c));
      asserts.check("帳票テーブルは出ていない", !!c.querySelector("table thead"), false);
      asserts.check("件数表示は 0", filterStatusText(c), "絞り込み中：表示 0 ／ 全 5 列");
      asserts.checkTrue("選択チップ PJX は残っている", !!chip(c, "PJX"));
      asserts.checkTrue("フィルターバーは残っている", hasFilterBar(c));
      // 手動で解除できる
      await clickByText(c, /すべて表示/);
      asserts.check("すべて表示で全件に戻る", visibleColCount(c), 5);
    },
  },
  {
    id: "F10-clear-all",
    name: "「すべて表示」で両欄解除",
    expect: "両欄選択後、すべて表示 → 5列・状態「全 5 列を表示中」",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "PJX"); await toggleChip(c, "DEMO-A");
      await clickByText(c, /すべて表示/);
      asserts.check("全列", visibleColCount(c), 5);
      asserts.check("状態", filterStatusText(c), "全 5 列を表示中");
    },
  },
  {
    id: "F11-no-mutate-no-dirty",
    name: "絞り込みだけでは元データと dirty が変わらない",
    expect: "フィルター前後で JSON 全体が一致、dirtyRef=false、beforeunload 未登録",
    async run({ mount, asserts }) {
      const h = await mountWithDummy(mount);
      const c = h.container;
      const before = await snapshotAll(c);
      await toggleChip(c, "PJX"); await toggleChip(c, "DEMO-A");
      // 書き出し（snapshotAll）は保存状態を変える副作用があるため、dirty はフィルター直後に観測する
      const st = readStandaloneState(c);
      asserts.check("フィルター直後も dirtyRef は false", st.dirtyRef, false);
      asserts.checkTrue("保存状態は dirty ではない", st.saveState !== "dirty");
      asserts.check("beforeunload は登録されない", beforeUnloadArmed(), false);
      const after = await snapshotAll(c);
      asserts.check("runs/regs/cert/decisions が不変", after, before);
    },
  },
  {
    id: "F12-hidden-cols-saved",
    name: "非表示の列も JSON に保存される",
    expect: "2列に絞った状態で書き出しても runs は5件すべて含む",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "PJX");
      asserts.check("表示は2列", visibleColCount(c), 2);
      const snap = await snapshotAll(c);
      asserts.check("保存 runs は5件", snap.runs.map((r) => r.key), ["r1", "r2", "r3", "r4", "r5"]);
      asserts.check("保存 regs は2件", snap.regs.length, 2);
    },
  },
  {
    id: "F13-edit-while-filtered",
    name: "フィルター中の編集は runKey×rid で正しい判断だけ更新",
    expect: "PJY だけ表示（r3のみ）→ その行0セルを対象外に → decisions は (r3,g1) だけ",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "PJY");
      asserts.check("表示は r3 の1列", visibleTypeIds(c), ["DEMO-A"]);
      const open = cellAt(c, 0, 0).querySelector('button[title="適用判断・理由メモを編集"]');
      open.click(); await sleep(20);
      const radios = cellAt(c, 0, 0).querySelectorAll('input[type="radio"]');
      radios[2].click(); await sleep(10);   // 未確認/対象/対象外 の3番目
      setNativeValue(cellAt(c, 0, 0).querySelector("textarea"), "フィルター中の確定（ダミー）");
      await sleep(10);
      const saveBtn = [...cellAt(c, 0, 0).querySelectorAll("button")].find((b) => /この判断で確定/.test(b.textContent));
      saveBtn.click(); await sleep(40);
      const snap = await snapshotAll(c);
      asserts.check("判断は1件だけ", (snap.decisions || []).length, 1);
      asserts.check("その参照は r3 × g1", [snap.decisions[0].runKey, snap.decisions[0].rid], ["r3", "g1"]);
      asserts.check("状態は対象外", snap.decisions[0].state, "対象外");
      // 解除して他ランに判断が付いていないこと
      await clickByText(c, /すべて表示/);
      asserts.check("r1×g1 には判断なし", findDec(snap, "r1", "g1"), null);
    },
  },
  {
    id: "F14-import-clears-filter",
    name: "成功した別データ読込で表示条件を全解除",
    expect: "PJX で絞った後に有効な別JSONを読み込む → 条件解除・全件表示",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "PJX");
      asserts.check("絞り込み中", visibleColCount(c), 2);
      confirmAnswer = true;
      selectFile(c, JSON.stringify(OTHER));
      await sleep(150);
      asserts.check("読込後は全件表示", filterStatusText(c), "全 2 列を表示中");
      asserts.checkTrue("0件表示は出ていない", !zeroHitShown(c));
      const snap = await snapshotAll(c);
      asserts.check("データは別JSONに置き換わっている", snap.runs.map((r) => r.typeId).sort(), ["OTHER-X", "OTHER-Y"]);
    },
  },
  {
    id: "F15-invalid-import-keeps-filter",
    name: "不正読込では表示条件・データ・編集中入力を保持",
    expect: "PJX で絞った後に壊れたJSON → 拒否され、絞り込み・データ・編集中textareaは維持",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "PJX");
      // 編集領域を開いて入力中にする
      const open = cellAt(c, 0, 0).querySelector('button[title="適用判断・理由メモを編集"]');
      open.click(); await sleep(20);
      setNativeValue(cellAt(c, 0, 0).querySelector("textarea"), "入力中（ダミー）");
      await sleep(10);
      window.__ALERTS__ = [];
      selectFile(c, "{ this is not json ");
      await sleep(120);
      asserts.checkTrue("拒否の案内が出る", window.__ALERTS__.some((m) => m.includes("読み込めません")));
      asserts.check("絞り込みは維持（2列）", visibleColCount(c), 2);
      asserts.check("編集中の入力は維持", cellAt(c, 0, 0).querySelector("textarea")?.value, "入力中（ダミー）");
      const snap = await snapshotAll(c);
      asserts.check("データは DUMMY のまま", snap.runs.length, 5);
    },
  },
  {
    id: "F16-cancel-replace-keeps-filter",
    name: "置換キャンセルでは表示条件とデータを保持",
    expect: "dirtyにして絞り込み → 読込confirmをキャンセル → 絞り込み・データ維持",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      // 何か編集して dirty にする（型式ランタブでコードを1つ変更）
      await openTab(c, "型式ラン");
      const genInputs = [...c.querySelectorAll('input[placeholder="000A"]')];
      setNativeValue(genInputs[3], "PJZ-EDIT");   // r4 のコード
      await sleep(20);
      await openTab(c, "帳票");
      await toggleChip(c, "PJX");
      asserts.check("絞り込み中（2列）", visibleColCount(c), 2);
      confirmAnswer = false;   // 置換確認をキャンセル
      window.__ALERTS__ = [];
      selectFile(c, JSON.stringify(OTHER));
      await sleep(150);
      asserts.checkTrue("置換確認が出た", window.__ALERTS__.some((m) => m.startsWith("confirm:")));
      asserts.check("絞り込みは維持", visibleColCount(c), 2);
      const snap = await snapshotAll(c);
      asserts.check("データは維持（編集含む DUMMY）", snap.runs.find((r) => r.key === "r4")?.gen, "PJZ-EDIT");
      confirmAnswer = true;
    },
  },
  {
    id: "F17-stale-selection",
    name: "選択中の値が消えても自動解除しない（対象なし表示・手動解除）",
    expect: "PJX 選択 → r1,r2 のコードを変更 → PJX が対象なし・0件のまま・手動で解除できる",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "PJX");
      asserts.check("最初は2列", visibleColCount(c), 2);
      await openTab(c, "型式ラン");
      const genInputs = [...c.querySelectorAll('input[placeholder="000A"]')];
      setNativeValue(genInputs[0], "PJW");   // r1
      setNativeValue(genInputs[1], "PJW");   // r2
      await sleep(30);
      await openTab(c, "帳票");
      asserts.checkTrue("PJX を選んだまま0件表示", zeroHitShown(c));
      asserts.check("自動で全件に戻っていない", filterStatusText(c), "絞り込み中：表示 0 ／ 全 5 列");
      const staleChip = [...c.querySelectorAll("button")].find((b) => b.textContent.trim() === "PJX（対象なし）");
      asserts.checkTrue("『対象なし』のチップが出る", !!staleChip);
      staleChip.click(); await sleep(40);   // 手動解除
      asserts.check("手動解除で全件に戻る", visibleColCount(c), 5);
    },
  },
  {
    id: "F17b-empty-data-keeps-filter-ui",
    name: "型式ラン・法規を全削除しても、保持中の選択は見せて手動解除できる",
    expect: "PJX 選択 → 全ランを削除 → 帳票は空だがフィルターバーは残り「すべて表示」で解除できる",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "PJX");
      await openTab(c, "型式ラン");
      // 全ランを削除（毎回先頭行の削除ボタンを押す）
      for (let i = 0; i < 5; i++) {
        const del = [...c.querySelectorAll("tbody tr")][0]?.querySelector("button");
        if (del) { del.click(); await sleep(20); }
      }
      await openTab(c, "帳票");
      asserts.checkTrue("フィルターバーは残っている", hasFilterBar(c));
      asserts.checkTrue("PJX の選択チップも残っている", !!chip(c, "PJX"));
      asserts.check("帳票テーブルは無い", !!c.querySelector("table thead"), false);
      await clickByText(c, /すべて表示/);
      asserts.check("すべて表示で選択が消える", [...c.querySelectorAll("button")].some((b) => b.textContent.trim().startsWith("PJX")), false);
    },
  },
  {
    id: "F17c-empty-regs-keeps-filter-ui",
    name: "法規を全削除した場合も、保持中の選択を見せて手動解除できる",
    expect: "DEMO-A 選択 → 法規を全削除 → 帳票は空だがフィルターバーは残り解除できる",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "DEMO-A");
      await openTab(c, "法規DB");
      for (let i = 0; i < 2; i++) {
        const del = [...c.querySelectorAll("tbody tr")][0]?.querySelector("button");
        if (del) { del.click(); await sleep(20); }
      }
      await openTab(c, "帳票");
      asserts.checkTrue("フィルターバーは残っている", hasFilterBar(c));
      asserts.checkTrue("DEMO-A の選択チップも残っている", !!chip(c, "DEMO-A"));
      asserts.check("帳票テーブルは無い", !!c.querySelector("table thead"), false);
      await clickByText(c, /すべて表示/);
      asserts.check("すべて表示で選択が消える", [...c.querySelectorAll("button")].some((b) => b.textContent.trim().startsWith("DEMO-A")), false);
    },
  },
  {
    id: "F19-hide-editing-column-keeps-input",
    name: "編集中の列をフィルターで隠して再表示すると、入力途中の理由・判断選択が保持される",
    expect: "DEMO-A表示→r3セルで対象外＋理由入力→PJXも選んでr3を隠す→PJX解除で再表示→理由と選択が残る",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "DEMO-A");                 // 列: r1, r3
      asserts.check("前提 2列", visibleTypeIds(c), ["DEMO-A", "DEMO-A"]);
      await openEditor(c, 0, 1);                      // r3 × g1
      await editorPickState(c, 0, 1, 2);             // 対象外
      await editorSetReason(c, 0, 1, "入力途中の理由（ダミー）");
      await toggleChip(c, "PJX");                    // DEMO-A ∩ PJX → r1 のみ。r3 は隠れる
      asserts.check("編集中の列は隠れた", visibleColCount(c), 1);
      asserts.check("残った列に編集エディタは無い（別セルに漏れない）", editorOpen(c, 0, 0), false);
      await toggleChip(c, "PJX");                    // 解除 → r1, r3 に戻る
      asserts.checkTrue("再表示でエディタが開いている", editorOpen(c, 0, 1));
      asserts.check("理由が保持されている", editorReason(c, 0, 1), "入力途中の理由（ダミー）");
      asserts.check("判断選択（対象外＝idx2）が保持されている", editorCheckedIdx(c, 0, 1), 2);
      asserts.check("隣の列に理由が漏れていない", editorOpen(c, 0, 0), false);
    },
  },
  {
    id: "F20-zero-hit-keeps-input",
    name: "編集中に該当0件になっても、条件を戻せば入力が保持される",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "DEMO-A");
      await openEditor(c, 0, 1);
      await editorSetReason(c, 0, 1, "0件をまたぐ入力（ダミー）");
      await toggleChip(c, "PJZ");                    // DEMO-A ∩ PJZ → 0件
      asserts.checkTrue("0件表示", zeroHitShown(c));
      await toggleChip(c, "PJZ");                    // 戻す
      asserts.check("入力が保持されている", editorReason(c, 0, 1), "0件をまたぐ入力（ダミー）");
    },
  },
  {
    id: "F21-restored-input-binds-correct-key",
    name: "隠す→再表示→保存で、正しい run.key×rid にだけ反映される",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "DEMO-A");
      await openEditor(c, 0, 1);                      // r3 × g1
      await editorPickState(c, 0, 1, 2);
      await editorSetReason(c, 0, 1, "隠して戻して確定（ダミー）");
      await toggleChip(c, "PJX"); await toggleChip(c, "PJX");   // 隠す→戻す
      await editorSave(c, 0, 1);
      const snap = await snapshotAll(c);
      asserts.check("判断は1件だけ", (snap.decisions || []).length, 1);
      asserts.check("参照は r3 × g1", [snap.decisions[0].runKey, snap.decisions[0].rid], ["r3", "g1"]);
      asserts.check("状態と理由", [snap.decisions[0].state, snap.decisions[0].reason], ["対象外", "隠して戻して確定（ダミー）"]);
      asserts.check("r1×g1 には判断が付いていない", findDec(snap, "r1", "g1"), null);
    },
  },
  {
    id: "F22-cancel-discards-restored-input",
    name: "隠す→再表示→キャンセルで、復元された入力は破棄される",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      await toggleChip(c, "DEMO-A");
      await openEditor(c, 0, 1);
      await editorSetReason(c, 0, 1, "破棄されるべき入力（ダミー）");
      await toggleChip(c, "PJX"); await toggleChip(c, "PJX");
      await editorCancel(c, 0, 1);
      asserts.check("エディタは閉じた", editorOpen(c, 0, 1), false);
      const snap = await snapshotAll(c);
      asserts.check("判断は保存されていない", (snap.decisions || []).length, 0);
      // もう一度開くと、破棄済みなので保存値（未確認・空）から始まる
      await openEditor(c, 0, 1);
      asserts.check("再オープンは空から", editorReason(c, 0, 1), "");
      asserts.check("再オープンは未確認（idx0）", editorCheckedIdx(c, 0, 1), 0);
    },
  },
  {
    id: "F23-import-clears-draft-invalid-keeps",
    name: "編集中に隠した下書きは、成功読込で消え、不正読込・置換キャンセルでは残る",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      // 先に dirty にしておく（置換確認を発火させるため）。タブ切替はエディタを開く前に済ませる。
      await openTab(c, "型式ラン");
      setNativeValue([...c.querySelectorAll('input[placeholder="000A"]')][3], "PJZ-X");
      await sleep(20);
      await openTab(c, "帳票");
      await toggleChip(c, "DEMO-A");
      await openEditor(c, 0, 1);
      await editorSetReason(c, 0, 1, "読込をまたぐ下書き（ダミー）");
      // (1) 不正読込：r3 を隠している間に実行 → 戻すと下書きは残る
      await toggleChip(c, "PJX");
      window.__ALERTS__ = [];
      selectFile(c, "{ broken ");
      await sleep(120);
      await toggleChip(c, "PJX");
      asserts.checkTrue("不正読込の案内", window.__ALERTS__.some((m) => m.includes("読み込めません")));
      asserts.check("不正読込では下書き保持", editorReason(c, 0, 1), "読込をまたぐ下書き（ダミー）");
      // (2) 置換キャンセル → 残る
      await toggleChip(c, "PJX");
      confirmAnswer = false;
      window.__ALERTS__ = [];
      selectFile(c, JSON.stringify(OTHER));
      await sleep(150);
      await toggleChip(c, "PJX");
      asserts.checkTrue("置換確認が出た", window.__ALERTS__.some((m) => m.startsWith("confirm:")));
      asserts.check("置換キャンセルでも下書き保持", editorReason(c, 0, 1), "読込をまたぐ下書き（ダミー）");
      // (3) 成功読込 → 下書きも editing も消える
      confirmAnswer = true;
      selectFile(c, JSON.stringify(OTHER));
      await sleep(160);
      asserts.check("成功読込後は編集エディタが残らない", c.querySelectorAll("textarea").length, 0);
      asserts.check("成功読込後は全件表示（フィルターも解除）", filterStatusText(c), "全 2 列を表示中");
    },
  },
  {
    id: "F24-draft-path-no-mutate-no-dirty",
    name: "編集下書き＋フィルター操作だけでは元データ・dirty が変わらない",
    async run({ mount, asserts }) {
      const c = (await mountWithDummy(mount)).container;
      const before = await snapshotAll(c);
      await toggleChip(c, "DEMO-A");
      await openEditor(c, 0, 1);
      await editorSetReason(c, 0, 1, "保存しない下書き（ダミー）");
      await toggleChip(c, "PJX"); await toggleChip(c, "PJX");
      const st = readStandaloneState(c);
      asserts.check("dirtyRef は false", st.dirtyRef, false);
      asserts.checkTrue("保存状態は dirty ではない", st.saveState !== "dirty");
      asserts.check("beforeunload 未登録", beforeUnloadArmed(), false);
      await editorCancel(c, 0, 1);
      const after = await snapshotAll(c);
      asserts.check("元データ不変", after, before);
    },
  },
  {
    id: "F18-api-no-filter-ui",
    name: "API版（columnFilter なし）にはフィルターUIが出ない",
    expect: "IListApp では『表示フィルター』が無く、帳票は従来どおり全列表示",
    async run({ mountApi, asserts }) {
      const real = window.fetch;
      window.fetch = async (u) => {
        if (String(u) !== "/api/data") throw new Error("想定外fetch:" + u);
        return { ok: true, json: async () => ({ runs: DUMMY.runs, regs: DUMMY.regs.map(({ rid, ...r }) => r), cert: DUMMY.cert }) };
      };
      try {
        const c = mountApi().container;
        await sleep(300);
        asserts.check("フィルターバーは無い", hasFilterBar(c), false);
        asserts.check("『すべて表示』ボタンも無い", [...c.querySelectorAll("button")].some((b) => b.textContent.trim() === "すべて表示"), false);
        asserts.check("帳票は5列（従来どおり）", visibleColCount(c), 5);
        asserts.checkTrue("「人：」行も出ない（判断UI無効のまま）", !c.textContent.includes("人："));
      } finally { window.fetch = real; }
    },
  },
];

// ───────────────────────────────────────────────
function Runner() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const runAll = async () => {
    if (window.__FILTERVERIFY_RUNNING__) return;
    window.__FILTERVERIFY_RUNNING__ = true;
    window.__FILTERVERIFY_RESULT__ = { finished: false };
    setRunning(true); setDone(false); setResults({});
    const collected = {};
    try {
      for (const s of SCENARIOS) {
        setResults((p) => ({ ...p, [s.id]: { state: "running" } }));
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
        await sleep(50);
      }
    } finally {
      setRunning(false); setDone(true);
      const vals = Object.values(collected);
      window.__FILTERVERIFY_RESULT__ = {
        finished: true,
        pass: vals.filter((r) => r.pass).length,
        fail: vals.filter((r) => !r.pass).length,
        total: SCENARIOS.length,
        residualNodes: document.getElementById("sandbox")?.childElementCount ?? -1,
        scenarios: SCENARIOS.map((s) => ({ id: s.id, name: s.name, pass: collected[s.id]?.pass, actual: collected[s.id]?.actual, detail: collected[s.id]?.detail })),
      };
      window.__FILTERVERIFY_RUNNING__ = false;
    }
  };

  useEffect(() => {
    window.__runFilterVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);

  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;

  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>プロジェクト・型式 表示フィルター 検証ハーネス</h1>
      <p style={{ color: "#5a6b7d", fontSize: 12.5, lineHeight: 1.7, marginTop: 0 }}>
        実際の <code>StandaloneApp</code> / <code>IListApp</code> をマウントして実測します。<br />
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
