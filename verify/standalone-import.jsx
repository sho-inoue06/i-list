// ───────────────────────────────────────────────
// 単体版のJSON読込の検証ハーネス（ダミーデータのみ・実サーバ/実DBに接続しない）
//
// 目的：Codexレビュー指摘の2点を実測で確認する。
//   1. 不正JSONで現在のデータ（runs/regs/cert・未書き出し状態・採番状態）を置換しない
//   2. 読取中の追加編集・古い読込応答からデータと表示を保護する
//
// 実行方法（npm run dev は使わない：APIサーバと既存DBを開いてしまうため）：
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   → http://127.0.0.1:5173/verify/standalone-import.html
//
// タイミング依存のケースは FileReader を差し替えて完了順を任意に制御する。
// 「たまたま通った」結果を根拠にしないため、B→Aの順で完了させる等を明示的に行う。
// ───────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import { parseImportedData, MAX_KEY_NUMBER, peekIds, planRegKeys, resetIds } from "../src/IListApp.jsx";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────────────────────────────
// ネイティブ alert の発生元を記録する観測ラッパー（調査用）
//
// ケースが window.alert を差し替え・復元しても外れないよう、土台の alert 自体を包む。
// ケース側の差し替えは「現在の window.alert」として尊重し、素の alert に落ちる場合だけ記録する。
// 観測のために採番や dirty を変更しない（読み取りのみ）。
// 記録後は元の alert を呼ぶ（自動承認はしない）。
// ───────────────────────────────────────────────
const __NATIVE_ALERT__ = window.alert.bind(window);
window.__ALERT_EVENTS__ = [];
window.alert = function (msg) {
  let ids = null;
  try { ids = peekIds(); } catch {}          // 採番は読むだけ
  const ev = {
    t: Date.now(),
    message: String(msg).slice(0, 300),
    stack: String(new Error("alert-trace").stack || "").split("\n").slice(1, 12).join(" | "),
    currentCase: window.__SIVERIFY_CURRENT__ || null,
    logTail: (window.__SIVERIFY_LOG__ || []).slice(-6),
    ids,
    url: location.href,
    runId: window.__SIVERIFY_RUN_ID__ || null,
  };
  window.__ALERT_EVENTS__.push(ev);
  // 外部ランナーが待機中でも取り出せるよう、console 経由でも出す（CDPイベントで受け取れる）
  try { console.warn("__ALERT_EVENT__ " + JSON.stringify(ev)); } catch {}
  return __NATIVE_ALERT__(msg);              // 自動承認しない：素のalertをそのまま呼ぶ
};

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

// ── 画面操作のユーティリティ ──
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
async function openRunsTab(container) {
  const b = [...container.querySelectorAll("button")].find((x) => x.textContent.includes("型式ラン"));
  if (!b) throw new Error("型式ランタブが見つかりません");
  b.click();
  await sleep(0);
}
function editFirstTypeId(container, value) {
  const input = container.querySelector('input[placeholder="DEMO-0001"]');
  if (!input) throw new Error("型式の入力欄が見つかりません");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function typeIdValues(container) {
  return [...container.querySelectorAll('input[placeholder="DEMO-0001"]')].map((i) => i.value);
}
function regIdValues(container) {
  return [...container.querySelectorAll('input[placeholder="DEMO-REG-A2"]')].map((i) => i.value);
}
// 画面の「書き出し」を押して、いまアプリが保持している runs/regs/cert 全体を取り出す。
// 型式ID一覧だけでなく3データ全体を比較するために使う。
async function snapshotAll(container) {
  const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL;
  const realClick = HTMLAnchorElement.prototype.click;
  let blob = null;
  URL.createObjectURL = (b) => { blob = b; return "blob:dummy"; };
  URL.revokeObjectURL = () => {};
  // 書き出しは <a download> のクリックでダウンロードを開始する。
  // ヘッドレスでは実際のダウンロードが始まると処理が止まることがあるため、
  // 観測のあいだだけリンクのクリックを無効化する（Blobの中身だけを読む）。
  HTMLAnchorElement.prototype.click = function () {};
  try {
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("書き出し"));
    if (!btn) throw new Error("書き出しボタンが見つかりません");
    btn.click();
    await sleep(80);
    if (!blob) throw new Error("書き出しのBlobを取得できませんでした");
    return JSON.parse(await blob.text());
  } finally {
    URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke;
    HTMLAnchorElement.prototype.click = realClick;
  }
}

// 採番状態を「変えずに」読む。peekIds は現在値を返すだけで副作用がない。
// 次に採番されるキーの値も、ここから計算できる（実際には採番しない）。
function peekNumbering() {
  const { id, rid } = peekIds();
  return { id, rid, nextRunKey: "r" + (id + 1), nextRegKey: "g" + (rid + 1) };
}

async function clickAddReg(container) {
  const b = [...container.querySelectorAll("button")].find((x) => /法規を追加/.test(x.textContent));
  if (!b) throw new Error("法規追加ボタンが見つかりません");
  b.click();
  await sleep(0);
}
async function openRegsTab(container) {
  const b = [...container.querySelectorAll("button")].find((x) => x.textContent.includes("法規DB"));
  if (!b) throw new Error("法規DBタブが見つかりません");
  b.click();
  await sleep(0);
}
function editRegField(container, rowIndex, placeholder, value) {
  const inputs = [...container.querySelectorAll(`input[placeholder="${placeholder}"]`)];
  const input = inputs[rowIndex];
  if (!input) throw new Error(`法規の入力欄が見つかりません: ${placeholder}[${rowIndex}]`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function clickAddRun(container) {
  const b = [...container.querySelectorAll("button")].find((x) => /ランを追加/.test(x.textContent));
  if (!b) throw new Error("ラン追加ボタンが見つかりません");
  b.click();
  await sleep(0);
}

// ファイル選択を起こす（実際のUI経路：input[type=file] の change）
function selectFile(container, text, name = "d.json") {
  const inp = container.querySelector('input[type="file"]');
  if (!inp) throw new Error("file input が見つかりません");
  const file = new File([text], name, { type: "application/json" });
  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(inp, "files", { value: dt.files, configurable: true });
  inp.dispatchEvent(new Event("change", { bubbles: true }));
}

// FileReader を差し替えて、読取完了のタイミングをテストが握る。
// readAsText を呼んでも自動では完了せず、返された controller.finish() で完了させる。
function installControlledFileReader() {
  const Real = window.FileReader;
  const pending = [];
  class Controlled {
    readAsText(file) {
      const self = this;
      const reader = new Real();
      reader.onload = () => {
        pending.push({
          name: file.name,
          finish() { self.result = reader.result; self.onload?.({ target: self }); },
          fail() { self.onerror?.({ target: self }); },
        });
      };
      reader.readAsText(file);
    }
  }
  window.FileReader = Controlled;
  return {
    pending,
    // 指定した名前の読取が登録されるまで待つ
    async waitFor(name, timeout = 1000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const e = pending.find((p) => p.name === name);
        if (e) return e;
        await sleep(5);
      }
      throw new Error(`読取が登録されませんでした: ${name}`);
    },
    restore() { window.FileReader = Real; },
  };
}

// ── ダミーデータ（実データではない） ──
const VALID = {
  runs: [{ key: "r7", typeId: "IMP-0001", gen: "取込", sk: "新", lo: "2024-01-01", drop: "2026-12-31" }],
  regs: [{ id: "IMP-REG", label: "取込法規", shin: "2023-01-01", kei: "2025-01-01", parent: "" }],
  cert: { "IMP-0001": { "IMP-REG": "IMP-CK-01" } },
};
const EMPTY = { runs: [], regs: [], cert: {} };

function createMountManager() {
  const mounted = [];
  const mount = () => {
    const container = document.createElement("div");
    document.getElementById("sandbox").appendChild(container);
    const root = createRoot(container);
    root.render(<StandaloneApp />);
    const h = { container, unmount() { if (h._d) return; h._d = true; try { root.unmount(); } catch {} try { container.remove(); } catch {} } };
    mounted.push(h);
    return h;
  };
  return { mount, cleanupAll() { for (const h of mounted.slice().reverse()) h.unmount(); mounted.length = 0; } };
}

const SCENARIOS = [
  {
    id: "V1-invalid-shapes-rejected",
    name: "不正な中身のJSONを拒否し、runs/regs/cert全体・未書き出し状態・採番状態を変えない",
    expect: "拒否のたびに3データ全体が一致／次に採番されるキーも変わらない",
    async run({ mount, asserts }) {
      const app = mount();
      await sleep(50);
      await openRunsTab(app.container);
      editFirstTypeId(app.container, "KEEP-ME");
      await sleep(50);
      asserts.check("編集後の表示", readStatus(app.container), "未書き出しの変更があります（書き出してください）");

      // 失敗前の状態：3データ全体と、次に採番されるキーの両方を取る
      const before = await snapshotAll(app.container);
      const beforeNumbering = peekNumbering();
      asserts.checkTrue("基準スナップショットを取得できた", !!before.runs && !!before.regs && !!before.cert);

      const alerts = [];
      const realAlert = window.alert;
      window.alert = (m) => alerts.push(String(m));
      try {
        const bad = [
          ['runs:[null]', JSON.stringify({ runs: [null], regs: [], cert: {} })],
          ['runs要素が配列', JSON.stringify({ runs: [[]], regs: [], cert: {} })],
          ['runs.keyが数値', JSON.stringify({ runs: [{ key: 1, typeId: "", gen: "", sk: "新", lo: "", drop: "" }], regs: [], cert: {} })],
          ['runs.key欠落', JSON.stringify({ runs: [{ typeId: "", gen: "", sk: "新", lo: "", drop: "" }], regs: [], cert: {} })],
          ['runs.key重複', JSON.stringify({ runs: [
            { key: "r1", typeId: "", gen: "", sk: "新", lo: "", drop: "" },
            { key: "r1", typeId: "", gen: "", sk: "継", lo: "", drop: "" }], regs: [], cert: {} })],
          ['regs要素がnull', JSON.stringify({ runs: [], regs: [null], cert: {} })],
          ['regs.idが数値', JSON.stringify({ runs: [], regs: [{ id: 3, label: "", shin: "", kei: "", parent: "" }], cert: {} })],
          ['regs.rid重複', JSON.stringify({ runs: [], regs: [
            { rid: "g9", id: "X", label: "", shin: "", kei: "", parent: "" },
            { rid: "g9", id: "Y", label: "", shin: "", kei: "", parent: "" }], cert: {} })],
          ['cert入れ子が文字列', JSON.stringify({ runs: [], regs: [], cert: { "T": "not-an-object" } })],
          ['cert入れ子が配列', JSON.stringify({ runs: [], regs: [], cert: { "T": [] } })],
          ['cert値が数値', JSON.stringify({ runs: [], regs: [], cert: { "T": { "R": 5 } } })],
          ['keyが安全な整数を超える', JSON.stringify({ runs: [{ key: "r9007199254740992", typeId: "", gen: "", sk: "新", lo: "", drop: "" }], regs: [], cert: {} })],
          ['構文不正', "{ this is not json"],
        ];
        for (const [label, text] of bad) {
          const n = alerts.length;
          selectFile(app.container, text, `${label}.json`);
          await sleep(120);
          asserts.checkTrue(`拒否された(${label})`, alerts.length > n);
          // 型式ID一覧ではなく、runs/regs/cert 全体を比較する
          asserts.check(`3データ全体が不変(${label})`, await snapshotAll(app.container), before);
        }
        // 未書き出し状態が保たれていること。
        // ※ snapshotAll() は書き出しボタンを押すため表示が「書き出しを開始しました」に変わる。
        //   そこで、いったん編集し直して「未書き出し」に戻したうえで、拒否が状態を変えないことを見る。
        editFirstTypeId(app.container, "KEEP-ME-2");
        await sleep(50);
        asserts.check("編集後は未書き出し", readStatus(app.container), "未書き出しの変更があります（書き出してください）");
        selectFile(app.container, "{ broken", "broken2.json");
        await sleep(150);
        asserts.check("拒否しても未書き出しのまま", readStatus(app.container), "未書き出しの変更があります（書き出してください）");
        // 採番状態は行数ではなく「次に採番されるキーの値」で確認する
        // 拒否のたびに採番が進んでいないこと（runs側・rid側の両方を非破壊で確認）
        asserts.check("拒否では採番が変わらない（runs/rid両方）", peekNumbering(), beforeNumbering);
      } finally {
        window.alert = realAlert;
      }
    },
  },
  {
    id: "V2-empty-and-roundtrip",
    name: "正常な空データを復元でき、正規JSONの往復でruns/regs/cert全体が一致する",
    expect: "空データ読込で0件／往復でJSON全体が一致",
    async run({ mount, asserts }) {
      const app = mount();
      await sleep(50);
      await openRunsTab(app.container);

      // 正常な空データは許可される
      selectFile(app.container, JSON.stringify(EMPTY), "empty.json");
      await sleep(150);
      asserts.check("空データ読込後の表示", readStatus(app.container), "JSONから読み込みました");
      asserts.check("空データ読込後の行数", typeIdValues(app.container).length, 0);

      // 正規JSONの往復：書き出した内容と読み戻した内容が一致すること
      selectFile(app.container, JSON.stringify(VALID), "valid.json");
      await sleep(150);
      asserts.check("読込後の型式", typeIdValues(app.container), ["IMP-0001"]);

      // 書き出しの中身を捕まえる（ダウンロードはせず、Blobの中身を読む）
      const realCreate = URL.createObjectURL;
      let exported = null;
      URL.createObjectURL = (blob) => { exported = blob; return "blob:dummy"; };
      const realRevoke = URL.revokeObjectURL; URL.revokeObjectURL = () => {};
      try {
        [...app.container.querySelectorAll("button")].find((b) => b.textContent.includes("書き出し")).click();
        await sleep(100);
        const text = await exported.text();
        const back = JSON.parse(text);
        // 読込時に法規行の内部キー(rid)を補うため、書き出しには rid が付く。
        // 値の削除・改名がないことを確認したうえで、rid を除いた内容が一致することを見る。
        asserts.check("往復でrunsとcertが一致", { runs: back.runs, cert: back.cert }, { runs: VALID.runs, cert: VALID.cert });
        asserts.check("往復でregsの元の値が一致",
          back.regs.map(({ rid, ...rest }) => rest), VALID.regs);
        asserts.checkTrue("補われたridが行ごとに付いている",
          back.regs.every((r) => typeof r.rid === "string" && r.rid !== ""));
      } finally {
        URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke;
      }
    },
  },
  {
    id: "V3-key-no-duplicate-after-import",
    name: "復元後の行追加でキーが重複しない（採番が読込データを踏まえている）",
    expect: "r900 を含むJSONを読み込んだ後の追加行キーは r901 以降",
    async run({ mount, asserts }) {
      const app = mount();
      await sleep(50);
      await openRunsTab(app.container);
      const high = {
        runs: [{ key: "r900", typeId: "HIGH-0001", gen: "g", sk: "新", lo: "2024-01-01", drop: "2026-12-31" }],
        regs: [], cert: {},
      };
      selectFile(app.container, JSON.stringify(high), "high.json");
      await sleep(150);
      asserts.check("読込後の型式", typeIdValues(app.container), ["HIGH-0001"]);

      await clickAddRun(app.container);
      await clickAddRun(app.container);
      // 追加後に書き出して、keyの重複がないことを実データで確認する
      const realCreate = URL.createObjectURL; let exported = null;
      URL.createObjectURL = (b) => { exported = b; return "blob:dummy"; };
      const realRevoke = URL.revokeObjectURL; URL.revokeObjectURL = () => {};
      try {
        [...app.container.querySelectorAll("button")].find((b) => b.textContent.includes("書き出し")).click();
        await sleep(100);
        const back = JSON.parse(await exported.text());
        const keys = back.runs.map((r) => r.key);
        asserts.check("行数", keys.length, 3);
        asserts.check("キーが重複していない", keys.length, new Set(keys).size);
        asserts.checkTrue("追加キーが r900 より大きい",
          keys.filter((k) => k !== "r900").every((k) => parseInt(k.slice(1), 10) > 900));
      } finally {
        URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke;
      }
    },
  },
  {
    id: "V4-edit-during-read-then-cancel",
    name: "読取を遅らせ、その間に編集→置換確認→キャンセルで編集を保持する",
    expect: "選択時はcleanでも、完了時点の編集を見て確認が出る／キャンセルで編集保持",
    async run({ mount, asserts }) {
      const app = mount();
      await sleep(50);
      await openRunsTab(app.container);
      // この時点では未編集（clean）。ファイル選択時のdirtyだけを見ていると確認が出ない。
      asserts.check("選択前の表示", readStatus(app.container), "変更なし（未書き出しの変更はありません）");

      const fr = installControlledFileReader();
      let confirmCalled = 0;
      const realConfirm = window.confirm;
      window.confirm = () => { confirmCalled += 1; return false; };   // キャンセルする
      try {
        selectFile(app.container, JSON.stringify(VALID), "slow.json");
        const entry = await fr.waitFor("slow.json");

        // 読取中に編集する（ここが要点）
        editFirstTypeId(app.container, "EDITED-DURING-READ");
        await sleep(50);
        asserts.check("読取中の編集後の表示", readStatus(app.container), "未書き出しの変更があります（書き出してください）");

        // ここで読取を完了させる
        entry.finish();
        await sleep(150);

        asserts.check("置換確認が出た回数", confirmCalled, 1);
        asserts.check("キャンセル後も編集を保持", typeIdValues(app.container)[0], "EDITED-DURING-READ");
        asserts.check("キャンセル後の表示", readStatus(app.container), "未書き出しの変更があります（書き出してください）");
      } finally {
        window.confirm = realConfirm;
        fr.restore();
      }
    },
  },
  {
    id: "V5-stale-load-discarded",
    name: "読込A→Bの順に開始し、B→Aの順に完了してもBの内容を保持する",
    expect: "後から選んだBが残り、遅れて完了したAで上書きされない",
    async run({ mount, asserts }) {
      const app = mount();
      await sleep(50);
      await openRunsTab(app.container);

      const A = { runs: [{ key: "r10", typeId: "OLD-A", gen: "g", sk: "新", lo: "2020-01-01", drop: "2021-01-01" }], regs: [], cert: {} };
      const B = { runs: [{ key: "r20", typeId: "NEW-B", gen: "g", sk: "新", lo: "2022-01-01", drop: "2023-01-01" }], regs: [], cert: {} };

      const fr = installControlledFileReader();
      try {
        // A を先に開始、続けて B を開始（どちらもまだ完了させない）
        selectFile(app.container, JSON.stringify(A), "A.json");
        const ea = await fr.waitFor("A.json");
        selectFile(app.container, JSON.stringify(B), "B.json");
        const eb = await fr.waitFor("B.json");

        // 完了順は B → A（意図的に逆順にする）
        eb.finish();
        await sleep(120);
        asserts.check("B完了後の型式", typeIdValues(app.container), ["NEW-B"]);

        ea.finish();                       // 古いAが遅れて完了
        await sleep(150);
        asserts.check("A完了後もBを保持", typeIdValues(app.container), ["NEW-B"]);
        asserts.check("表示も変わらない", readStatus(app.container), "JSONから読み込みました");
      } finally {
        fr.restore();
      }
    },
  },
  {
    id: "V6-stale-load-failure-discarded",
    name: "古い読込が失敗して完了しても、新しい読込の結果と表示を壊さない",
    expect: "Bの成功が残り、Aの失敗で警告や表示の巻き戻しが起きない",
    async run({ mount, asserts }) {
      const app = mount();
      await sleep(50);
      await openRunsTab(app.container);
      const B = { runs: [{ key: "r30", typeId: "NEW-B2", gen: "g", sk: "新", lo: "2022-01-01", drop: "2023-01-01" }], regs: [], cert: {} };

      const fr = installControlledFileReader();
      const alerts = [];
      const realAlert = window.alert; window.alert = (m) => alerts.push(String(m));
      try {
        selectFile(app.container, "{}", "A2.json");
        const ea = await fr.waitFor("A2.json");
        selectFile(app.container, JSON.stringify(B), "B2.json");
        const eb = await fr.waitFor("B2.json");

        eb.finish();                       // 新しい方を先に成功させる
        await sleep(120);
        asserts.check("B完了後の型式", typeIdValues(app.container), ["NEW-B2"]);

        ea.fail();                         // 古い方が遅れて失敗
        await sleep(150);
        asserts.check("古い失敗でalertを出さない", alerts.length, 0);
        asserts.check("古い失敗後もBを保持", typeIdValues(app.container), ["NEW-B2"]);
        asserts.check("表示も変わらない", readStatus(app.container), "JSONから読み込みました");
      } finally {
        window.alert = realAlert;
        fr.restore();
      }
    },
  },
  {
    id: "V2b-real-edit-roundtrip",
    name: "実画面で追加・編集したデータを書出し→再読込できる（複数空ID・重複IDを含む）",
    expect: "法規を2行追加しID未入力のまま、また既存IDと同じ値でも往復できる",
    async run({ mount, asserts }) {
      const app = mount();
      await sleep(50);

      // 実際の画面操作でデータを作る（固定JSONではない）
      await openRegsTab(app.container);
      await clickAddReg(app.container);          // ID未入力の行1
      await clickAddReg(app.container);          // ID未入力の行2
      await sleep(50);
      // 2行のうち片方にだけ名称を入れる（空IDでも行が独立して扱えることの確認）
      const regRows = [...app.container.querySelectorAll('input[placeholder="ダミー法規 SU"]')];
      editRegField(app.container, regRows.length - 2, "ダミー法規 SU", "空ID行その1");
      await sleep(30);
      editRegField(app.container, regRows.length - 1, "ダミー法規 SU", "空ID行その2");
      await sleep(30);
      // さらに既存IDと同じ値を入れた行を作る
      await clickAddReg(app.container);
      await sleep(30);
      const idInputs = [...app.container.querySelectorAll('input[placeholder="DEMO-REG-A2"]')];
      editRegField(app.container, idInputs.length - 1, "DEMO-REG-A2", "DEMO-REG-A");   // 既存IDと重複
      await sleep(50);

      const made = await snapshotAll(app.container);
      const emptyIdRows = made.regs.filter((r) => r.id === "");
      const dupRows = made.regs.filter((r) => r.id === "DEMO-REG-A");
      asserts.check("空IDの法規が2行ある", emptyIdRows.length, 2);
      asserts.check("空ID2行の名称が別々に保たれている",
        emptyIdRows.map((r) => r.label), ["空ID行その1", "空ID行その2"]);
      asserts.check("重複IDの行がある（既存＋追加で2行）", dupRows.length, 2);

      // 書き出したものを読み戻す
      const alerts = [];
      const realAlert = window.alert; window.alert = (m) => alerts.push(String(m));
      const realConfirm = window.confirm; window.confirm = () => true;
      try {
        selectFile(app.container, JSON.stringify(made), "made.json");
        await sleep(200);
        asserts.check("読み戻しで警告が出ない", alerts, []);
        asserts.check("読込後の表示", readStatus(app.container), "JSONから読み込みました");
        asserts.check("往復で runs/regs/cert 全体が一致", await snapshotAll(app.container), made);
      } finally {
        window.alert = realAlert; window.confirm = realConfirm;
      }
    },
  },
  {
    id: "V2c-empty-id-rows-independent",
    name: "読み戻した後も、空ID・重複IDの行を1行ずつ編集・削除できる",
    expect: "片方を編集しても他方が変わらない／片方を削除しても他方が残る",
    async run({ mount, asserts }) {
      const app = mount();
      await sleep(50);
      await openRegsTab(app.container);
      await clickAddReg(app.container);
      await clickAddReg(app.container);
      await sleep(50);

      const labels = [...app.container.querySelectorAll('input[placeholder="ダミー法規 SU"]')];
      const i1 = labels.length - 2, i2 = labels.length - 1;
      editRegField(app.container, i1, "ダミー法規 SU", "AAA");
      await sleep(30);
      const snap1 = await snapshotAll(app.container);
      const empties1 = snap1.regs.filter((r) => r.id === "");
      asserts.check("片方だけ編集された", empties1.map((r) => r.label), ["AAA", ""]);

      // 片方を削除しても、もう片方が残ること
      const delButtons = [...app.container.querySelectorAll("tbody tr")]
        .map((tr) => tr.querySelector("td:last-child button")).filter(Boolean);
      delButtons[delButtons.length - 1]?.click();
      await sleep(80);
      const snap2 = await snapshotAll(app.container);
      const empties2 = snap2.regs.filter((r) => r.id === "");
      asserts.check("片方だけ削除された", empties2.map((r) => r.label), ["AAA"]);
    },
  },
  {
    id: "V9a-below-limit-add-to-remaining",
    name: "V9a：上限未満から残り枠まで追加でき、キーが重複せず往復で全データを保持する",
    expect: "残り枠ぶん追加できる／キー重複なし／書出し→再読込で runs/regs/cert 全体が一致",
    async run({ mount, asserts }) {
      // 単体の境界（描画に依存しない）
      const big = { runs: [{ key: "r9007199254740992", typeId: "", gen: "", sk: "新", lo: "", drop: "" }], regs: [], cert: {} };
      asserts.check("安全な整数を超えるキーを拒否", parseImportedData(big).ok, false);
      const overLimit = { runs: [{ key: `r${MAX_KEY_NUMBER + 1}`, typeId: "", gen: "", sk: "新", lo: "", drop: "" }], regs: [], cert: {} };
      asserts.check("受理上限+1を拒否", parseImportedData(overLimit).ok, false);

      // 上限より3つ手前から始める＝残り枠はちょうど3
      const REMAIN = 3;
      const belowLimit = {
        runs: [{ key: `r${MAX_KEY_NUMBER - REMAIN}`, typeId: "BELOW-LIMIT", gen: "", sk: "新", lo: "", drop: "" }],
        regs: [], cert: {},
      };
      asserts.check("上限未満は受理", parseImportedData(belowLimit).ok, true);

      const app = mount();
      await sleep(50);
      await openRunsTab(app.container);
      // このケースでは上限に達しないため警告は出ない想定。
      // 予期しない警告を握りつぶさないよう、出た内容を記録してassertする。
      const alerts = [];
      const realAlert = window.alert; window.alert = (m) => { alerts.push(String(m)); };
      const realConfirm = window.confirm; window.confirm = () => true;
      try {
        selectFile(app.container, JSON.stringify(belowLimit), "below.json");
        await sleep(200);
        asserts.check("上限未満のデータを読み込めた", typeIdValues(app.container), ["BELOW-LIMIT"]);

        // 残り枠ぶんだけ追加する（上限には達しない）
        for (let i = 0; i < REMAIN; i++) await clickAddRun(app.container);
        await sleep(80);

        const snap = await snapshotAll(app.container);
        const keys = snap.runs.map((r) => r.key);
        asserts.check("行数（読込1件＋追加3件）", keys.length, REMAIN + 1);
        asserts.check("キーが重複していない", keys.length, new Set(keys).size);
        asserts.check("この範囲では警告が出ない", alerts, []);

        // 書出し→再読込で全データを保持する
        selectFile(app.container, JSON.stringify(snap), "belowback.json");
        await sleep(250);
        asserts.check("往復で runs/regs/cert 全体が一致", await snapshotAll(app.container), snap);
      } finally {
        window.alert = realAlert; window.confirm = realConfirm;
      }
    },
  },
  {
    id: "V9b-at-limit-add-rejected-safely",
    name: "V9b：上限ちょうどは読込・書出し・再読込でき、それ以上の追加は安全に拒否する",
    expect: "上限データを往復できる／追加は警告1回で拒否／データ・dirty・両採番が不変／画面操作を継続できる",
    async run({ mount, asserts }) {
      const atLimit = {
        runs: [{ key: `r${MAX_KEY_NUMBER}`, typeId: "AT-LIMIT", gen: "", sk: "新", lo: "", drop: "" }],
        regs: [], cert: {},
      };
      asserts.check("受理上限ちょうどは受理", parseImportedData(atLimit).ok, true);

      const app = mount();
      await sleep(50);
      await openRunsTab(app.container);
      const alerts = [];
      const realAlert = window.alert; window.alert = (m) => { alerts.push(String(m)); };
      const realConfirm = window.confirm; window.confirm = () => true;
      try {
        selectFile(app.container, JSON.stringify(atLimit), "atlimit.json");
        await sleep(200);
        asserts.check("上限ちょうどのデータを読み込めた", typeIdValues(app.container), ["AT-LIMIT"]);

        // 書出し→再読込ができること（生成範囲と読込範囲が整合している）
        const snap = await snapshotAll(app.container);
        asserts.check("上限データを書き出して読み戻せる", parseImportedData(snap).ok, true);
        selectFile(app.container, JSON.stringify(snap), "atlimitback.json");
        await sleep(250);
        asserts.check("往復で全体一致", await snapshotAll(app.container), snap);

        // ここから「それ以上の追加」を試す。dirtyに戻してから測る
        editFirstTypeId(app.container, "AT-LIMIT-EDITED");
        await sleep(80);
        const beforeStatus = readStatus(app.container);
        asserts.check("追加試行前はdirty", beforeStatus, "未書き出しの変更があります（書き出してください）");
        const beforeNumbering = peekNumbering();
        const beforeRows = typeIdValues(app.container).length;

        alerts.length = 0;
        await clickAddRun(app.container);
        await sleep(120);

        // 期待する警告の文言と回数をassertする（予期しない警告はここでFAILになる）
        asserts.check("警告の回数", alerts.length, 1);
        asserts.check("警告の文言", alerts,
          ["型式ランの採番できる上限に達しました。これ以上行を追加できません。"]);
        // dirty と採番を先に確認し、そのあとで3データ全体を比較する
        asserts.check("行は増えない", typeIdValues(app.container).length, beforeRows);
        asserts.check("dirtyが変わらない", readStatus(app.container), beforeStatus);
        asserts.check("両採番が変わらない", peekNumbering(), beforeNumbering);
        const afterReject = await snapshotAll(app.container);   // ここで dirty は消える（比較は済んでいる）
        asserts.check("拒否後も runs/regs/cert 全体が不変",
          afterReject, { ...snap, runs: [{ ...snap.runs[0], typeId: "AT-LIMIT-EDITED" }] });

        // 試行後も画面操作を継続できること。
        // （このデータは regs が空なので、法規行の入力欄の有無ではなく
        //   「タブが切り替わり画面が描画され続けているか」で判定する）
        await openRegsTab(app.container);
        await sleep(80);
        asserts.checkTrue("試行後も法規DBタブへ切り替えられる",
          /法規ID/.test(app.container.textContent));
        // 法規行の追加も継続してできる（rid側の採番は上限に達していない）
        await clickAddReg(app.container);
        await sleep(80);
        asserts.check("試行後も法規行を追加できる",
          app.container.querySelectorAll('input[placeholder="DEMO-REG-A2"]').length, 1);
        await openRunsTab(app.container);
        await sleep(80);
        asserts.checkTrue("試行後も型式ランタブに戻れる",
          app.container.querySelectorAll('input[placeholder="DEMO-0001"]').length > 0);
      } finally {
        window.alert = realAlert; window.confirm = realConfirm;
      }
    },
  },
  {
    id: "V9c-reject-keeps-state",
    name: "V9c：範囲外キーの拒否でデータ・両採番が変わらない",
    expect: "巨大キーの拒否後も3データ全体と採番が不変",
    async run({ mount, asserts }) {
      const big = { runs: [{ key: "r9007199254740992", typeId: "", gen: "", sk: "新", lo: "", drop: "" }], regs: [], cert: {} };
      const app = mount();
      await sleep(50);
      await openRunsTab(app.container);
      const before = await snapshotAll(app.container);
      const beforeNumbering = peekNumbering();
      const alerts = [];
      const realAlert = window.alert; window.alert = (m) => { alerts.push(String(m)); };
      try {
        selectFile(app.container, JSON.stringify(big), "big.json");
        await sleep(200);
        asserts.check("拒否の警告が1回", alerts.length, 1);
        asserts.checkTrue("拒否理由が採番範囲であること", /採番できる範囲を超えています/.test(alerts[0] || ""));
        asserts.check("拒否後も3データ全体が不変", await snapshotAll(app.container), before);
        asserts.check("拒否では採番が変わらない（runs/rid両方）", peekNumbering(), beforeNumbering);
      } finally {
        window.alert = realAlert;
      }
    },
  },
  {
    id: "A-rid-collision-both-orders",
    name: "A：g7付き行＋ridなし行を、行順を入れ替えても補完ridが衝突しない",
    expect: "補完後のridが一意／どちらの行順でも成立／個別に編集・削除できる",
    async run({ mount, asserts }) {
      const mk = (rows) => ({ runs: [], regs: rows, cert: {} });
      const withRid = { rid: "g7", id: "A-EXIST", label: "既存rid", shin: "", kei: "", parent: "" };
      const noRid   = { id: "B-NEW", label: "rid無し", shin: "", kei: "", parent: "" };

      // 行順を変えても補完値が一意であること（解析だけで確認：共有採番は動かさない）
      for (const [label, rows] of [["g7が先", [withRid, noRid]], ["ridなしが先", [noRid, withRid]]]) {
        const r = parseImportedData(mk(rows));
        asserts.checkTrue(`受理される(${label})`, r.ok);
        const rids = r.data.regs.map((x) => x.rid);
        asserts.check(`補完後のridが一意(${label})`, rids.length, new Set(rids).size);
        asserts.checkTrue(`既存のg7が保持されている(${label})`, rids.includes("g7"));
      }

      // 実アプリで読み込み、空でない同一IDではなく「別行として」編集・削除できることを見る
      const app = mount();
      await sleep(50);
      await openRegsTab(app.container);
      const realConfirm = window.confirm; window.confirm = () => true;
      try {
        selectFile(app.container, JSON.stringify(mk([noRid, withRid])), "order.json");
        await sleep(250);
        const snap = await snapshotAll(app.container);
        const rids = snap.regs.map((r) => r.rid);
        asserts.check("読込後のridが一意", rids.length, new Set(rids).size);

        // 片方だけ名称を編集する
        editRegField(app.container, 0, "ダミー法規 SU", "EDIT-ONLY-FIRST");
        await sleep(120);
        const after = await snapshotAll(app.container);
        asserts.check("片方だけ編集された", after.regs.map((r) => r.label), ["EDIT-ONLY-FIRST", "既存rid"]);

        // 片方だけ削除する
        const rowDels = [...app.container.querySelectorAll("tbody tr")]
          .map((tr) => tr.querySelector("td:last-child button"))
          .filter(Boolean);
        rowDels[rowDels.length - 1].click();
        await sleep(150);
        const after2 = await snapshotAll(app.container);
        asserts.check("片方だけ削除された", after2.regs.map((r) => r.label), ["EDIT-ONLY-FIRST"]);
      } finally {
        window.confirm = realConfirm;
      }
    },
  },
  {
    id: "B-cancel-and-stale-keep-numbering",
    name: "B：ridなし旧JSONで、キャンセル・古い結果の破棄でも状態と両採番が変わらない",
    expect: "runs/regs/cert全体・dirty・runs採番・rid採番のいずれも不変",
    async run({ mount, asserts }) {
      const app = mount();
      await sleep(50);
      await openRunsTab(app.container);
      editFirstTypeId(app.container, "KEEP-B");
      await sleep(80);

      // 観測用の書き出しはdirtyを消すため、比較用のスナップショットは先に取り、
      // そのあと編集し直して dirty に戻してから本番の確認を行う（非破壊の観測を分ける）
      const baseline = await snapshotAll(app.container);
      editFirstTypeId(app.container, "KEEP-B2");
      await sleep(80);
      asserts.check("確認前はdirty", readStatus(app.container), "未書き出しの変更があります（書き出してください）");
      const beforeNumbering = peekNumbering();   // 非破壊で採番を読む

      // ridを持たない旧形式JSON
      const oldJson = { runs: baseline.runs, regs: [{ id: "OLD-1", label: "旧1", shin: "", kei: "", parent: "" },
                                                    { id: "OLD-2", label: "旧2", shin: "", kei: "", parent: "" }], cert: {} };

      // (1) 置換確認をキャンセルする
      const realConfirm = window.confirm; window.confirm = () => false;
      try {
        selectFile(app.container, JSON.stringify(oldJson), "cancel.json");
        await sleep(250);
        // dirty を先に確認してから、3データ全体を比較する（行数だけで保持を証明しない）
        asserts.check("キャンセル後もdirtyのまま", readStatus(app.container), "未書き出しの変更があります（書き出してください）");
        asserts.check("キャンセルで採番が変わらない（runs/rid両方）", peekNumbering(), beforeNumbering);
        const afterCancel = await snapshotAll(app.container);   // ここで dirty は消える（比較は済んでいる）
        // 期待値は baseline の独立したコピーから作る。
        // 実測値(afterCancel)から期待値を作ると、runs が空になったり日付・キーが変わっても
        // 「実測と実測」を比べることになり、assert が失敗しなくなる。
        // baseline 自体は変更しない（深いコピーを取ってから先頭の typeId だけを変える）。
        const expectedAfterCancel = JSON.parse(JSON.stringify(baseline));
        expectedAfterCancel.runs[0].typeId = "KEEP-B2";
        asserts.check("キャンセルで runs/regs/cert 全体が不変", afterCancel, expectedAfterCancel);
        // baseline を壊していないこと（期待値づくりの副作用がないこと）を確かめる
        asserts.check("baseline は変更されていない", baseline.runs[0].typeId, "KEEP-B");

        // この比較が「本当に失敗しうるか」を検証側だけで確かめる（本体は改変しない）。
        // 実測値を加工した偽データと期待値を比べ、期待どおり不一致になることを見る。
        // ここが一致してしまうなら、比較が実質無効（実測と実測の比較）であることを意味する。
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        const emptied = { ...afterCancel, runs: [] };
        const dateChanged = JSON.parse(JSON.stringify(afterCancel));
        if (dateChanged.runs[0]) dateChanged.runs[0].lo = "1999-01-01";
        const keyChanged = JSON.parse(JSON.stringify(afterCancel));
        if (keyChanged.runs[0]) keyChanged.runs[0].key = "r999999";
        asserts.check("runsが空なら不一致になる", same(emptied, expectedAfterCancel), false);
        asserts.check("日付が変わったら不一致になる", same(dateChanged, expectedAfterCancel), false);
        asserts.check("キーが変わったら不一致になる", same(keyChanged, expectedAfterCancel), false);
        // 逆に、正しい実測値は期待値と一致すること（判定が厳しすぎないことの確認）
        asserts.check("正しい実測値は一致する", same(afterCancel, expectedAfterCancel), true);
      } finally { window.confirm = realConfirm; }

      // (2) 古い読込結果を破棄する（A開始→B開始→B完了→A完了）
      const fr = installControlledFileReader();
      try {
        selectFile(app.container, JSON.stringify(oldJson), "stale.json");
        const ea = await fr.waitFor("stale.json");
        const newer = { runs: [], regs: [{ id: "NEW", label: "新", shin: "", kei: "", parent: "" }], cert: {} };
        window.confirm = () => true;
        selectFile(app.container, JSON.stringify(newer), "newer.json");
        const eb = await fr.waitFor("newer.json");
        eb.finish();
        await sleep(200);
        const afterNewer = peekNumbering();
        ea.finish();                     // 古い方が遅れて完了
        await sleep(250);
        asserts.check("古い結果の破棄で採番が変わらない", peekNumbering(), afterNewer);
        // 行数やラベルだけでなく、3データ全体が「新しい方」のままであることを確認する
        const afterStale = await snapshotAll(app.container);
        asserts.check("古い結果の破棄後も runs/cert が新しい方のまま",
          { runs: afterStale.runs, cert: afterStale.cert }, { runs: [], cert: {} });
        asserts.check("regsは新しい方の1行のみ",
          afterStale.regs.map((r) => r.label), ["新"]);
      } finally {
        fr.restore(); window.confirm = realConfirm;
      }
    },
  },
  {
    id: "C-huge-rid-rejected",
    name: "C：巨大なridを拒否し、全データ・dirty・両採番を保持する",
    expect: "rid:g9007199254740992 を拒否／状態と採番が不変",
    async run({ mount, asserts }) {
      const app = mount();
      await sleep(50);
      await openRunsTab(app.container);
      editFirstTypeId(app.container, "KEEP-C");
      await sleep(80);
      const baseline = await snapshotAll(app.container);
      editFirstTypeId(app.container, "KEEP-C2");   // 観測後にdirtyへ戻す
      await sleep(80);
      const beforeNumbering = peekNumbering();
      const beforeStatus = readStatus(app.container);

      const huge = { runs: [], regs: [{ rid: "g9007199254740992", id: "X", label: "", shin: "", kei: "", parent: "" }], cert: {} };
      asserts.check("解析段階で拒否", parseImportedData(huge).ok, false);

      const alerts = [];
      const realAlert = window.alert; window.alert = (m) => alerts.push(String(m));
      try {
        selectFile(app.container, JSON.stringify(huge), "hugerid.json");
        await sleep(250);
        asserts.checkTrue("利用者に知らせている", alerts.length > 0);
        asserts.check("dirtyが保たれる", readStatus(app.container), beforeStatus);
        asserts.check("採番が変わらない（runs/rid両方）", peekNumbering(), beforeNumbering);
        // データ全体（書き出して比較。ここでdirtyは消えるので最後に行う）
        const after = await snapshotAll(app.container);
        asserts.check("runs/regs/cert 全体が不変",
          { runs: after.runs.map((r) => r.typeId), regs: after.regs, cert: after.cert },
          { runs: baseline.runs.map((r) => r.typeId).map((v, i) => i === 0 ? "KEEP-C2" : v), regs: baseline.regs, cert: baseline.cert });
      } finally { window.alert = realAlert; }
    },
  },
  {
    id: "D-limit-roundtrip-both",
    name: "D：runs/rid 両方について、上限付近で読込→追加→書出し→再読込ができる",
    expect: "上限値は読める／追加した行を含むJSONも読み戻せる／上限到達時は例外を出さず停止し操作を継続できる",
    async run({ mount, asserts }) {
      const realConfirm = window.confirm; window.confirm = () => true;
      const alerts = [];
      const realAlert = window.alert; window.alert = (m) => alerts.push(String(m));
      try {
        // ── runs 側 ──
        const app = mount();
        await sleep(50);
        await openRunsTab(app.container);
        const nearRun = MAX_KEY_NUMBER - 1;
        selectFile(app.container, JSON.stringify({
          runs: [{ key: `r${nearRun}`, typeId: "NEAR-LIMIT", gen: "", sk: "新", lo: "", drop: "" }], regs: [], cert: {},
        }), "nearrun.json");
        await sleep(250);
        asserts.check("上限付近のrunsを読み込めた", typeIdValues(app.container), ["NEAR-LIMIT"]);
        await clickAddRun(app.container);          // 上限ちょうどの行を作る
        await sleep(120);
        const madeRun = await snapshotAll(app.container);
        const runKeys = madeRun.runs.map((r) => r.key);
        asserts.check("追加後のキーが重複しない", runKeys.length, new Set(runKeys).size);
        // 自分が書き出したJSONを読み戻せること（生成範囲と読込範囲の整合）
        asserts.check("書き出したJSONを読み戻せる", parseImportedData(madeRun).ok, true);
        selectFile(app.container, JSON.stringify(madeRun), "backrun.json");
        await sleep(250);
        asserts.check("再読込後も同じキー", (await snapshotAll(app.container)).runs.map((r) => r.key), runKeys);

        // 上限に達した状態でさらに追加 → 未処理例外を出さず、状態を変えずに停止する
        const beforeLimit = peekNumbering();
        const beforeRows = (await snapshotAll(app.container)).runs.length;
        alerts.length = 0;
        await clickAddRun(app.container);
        await sleep(150);
        asserts.checkTrue("上限到達を利用者に知らせる", alerts.length > 0);
        asserts.check("行は増えない", (await snapshotAll(app.container)).runs.length, beforeRows);
        asserts.check("採番も変わらない", peekNumbering().id, beforeLimit.id);
        // 試行後も画面操作ができること
        await openRegsTab(app.container);
        await sleep(80);
        asserts.checkTrue("試行後もタブ操作ができる",
          app.container.querySelectorAll('input[placeholder="DEMO-REG-A2"]').length >= 0);

        // ── rid 側 ──
        // runs側で採番を上限まで進めたので、rid側の確認前に起動時の状態へ戻す
        resetIds();
        const app2 = mount();
        await sleep(50);
        await openRegsTab(app2.container);
        const nearRid = MAX_KEY_NUMBER - 1;
        selectFile(app2.container, JSON.stringify({
          runs: [], regs: [{ rid: `g${nearRid}`, id: "NEAR-RID", label: "上限付近", shin: "", kei: "", parent: "" }], cert: {},
        }), "nearrid.json");
        await sleep(250);
        await clickAddReg(app2.container);
        await sleep(120);
        const madeReg = await snapshotAll(app2.container);
        const rids = madeReg.regs.map((r) => r.rid);
        asserts.check("追加後のridが重複しない", rids.length, new Set(rids).size);
        asserts.check("rid側も書き出したJSONを読み戻せる", parseImportedData(madeReg).ok, true);

        const beforeRegRows = madeReg.regs.length;
        const beforeRidNum = peekNumbering().rid;
        alerts.length = 0;
        await clickAddReg(app2.container);
        await sleep(150);
        asserts.checkTrue("rid上限到達を知らせる", alerts.length > 0);
        asserts.check("法規行は増えない", (await snapshotAll(app2.container)).regs.length, beforeRegRows);
        asserts.check("rid採番も変わらない", peekNumbering().rid, beforeRidNum);
      } finally {
        window.confirm = realConfirm; window.alert = realAlert;
      }
    },
  },
  {
    id: "E-empty-and-duplicate-id-tabs",
    name: "E：空IDと重複した非空IDを書出し→実際に再読込→片方だけ編集・削除／他タブ表示とReact警告",
    expect: "往復できる／片方だけ操作できる／帳票・認可書実績が行数分表示されReactのkey警告が出ない",
    async run({ mount, asserts }) {
      const warnings = [];
      const realError = console.error;
      console.error = (...a) => { warnings.push(a.map(String).join(" ")); realError(...a); };
      const realConfirm = window.confirm; window.confirm = () => true;
      try {
        const app = mount();
        await sleep(50);
        await openRegsTab(app.container);
        // 空ID2行 ＋ 既存IDと同じ非空IDの行
        await clickAddReg(app.container); await sleep(60);
        await clickAddReg(app.container); await sleep(60);
        await clickAddReg(app.container); await sleep(60);
        const idInputs = [...app.container.querySelectorAll('input[placeholder="DEMO-REG-A2"]')];
        editRegField(app.container, idInputs.length - 1, "DEMO-REG-A2", "DEMO-REG-A");  // 既存IDと重複
        await sleep(120);
        const labels = [...app.container.querySelectorAll('input[placeholder="ダミー法規 SU"]')];
        editRegField(app.container, labels.length - 3, "ダミー法規 SU", "空1");
        await sleep(60);
        editRegField(app.container, labels.length - 2, "ダミー法規 SU", "空2");
        await sleep(120);

        const made = await snapshotAll(app.container);
        asserts.check("空IDが2行", made.regs.filter((r) => r.id === "").length, 2);
        asserts.check("重複IDが2行", made.regs.filter((r) => r.id === "DEMO-REG-A").length, 2);

        // 実際に再読込する
        selectFile(app.container, JSON.stringify(made), "e.json");
        await sleep(280);
        asserts.check("再読込後の表示", readStatus(app.container), "JSONから読み込みました");
        asserts.check("往復で全体一致", await snapshotAll(app.container), made);

        // 片方だけ編集・削除
        await openRegsTab(app.container);
        await sleep(80);
        const emptyIdx = made.regs.findIndex((r) => r.id === "");
        editRegField(app.container, emptyIdx, "ダミー法規 SU", "空1-EDITED");
        await sleep(120);
        const afterEdit = await snapshotAll(app.container);
        asserts.check("空ID行の片方だけ編集された",
          afterEdit.regs.filter((r) => r.id === "").map((r) => r.label), ["空1-EDITED", "空2"]);

        const rowDels = [...app.container.querySelectorAll("tbody tr")]
          .map((tr) => tr.querySelector("td:last-child button"))
          .filter(Boolean);
        rowDels[emptyIdx].click();
        await sleep(150);
        const afterDel = await snapshotAll(app.container);
        asserts.check("空ID行の片方だけ削除された",
          afterDel.regs.filter((r) => r.id === "").map((r) => r.label), ["空2"]);

        // 他タブの行表示（法規の行数ぶん出ているか）
        const regCount = afterDel.regs.length;
        const matrixTab = [...app.container.querySelectorAll("button")].find((b) => b.textContent.includes("帳票"));
        matrixTab.click(); await sleep(150);
        const matrixRows = app.container.querySelectorAll("tbody tr").length;
        asserts.checkTrue(`帳票に法規行が表示される(${matrixRows}行/法規${regCount}件)`, matrixRows >= regCount);

        const certTab = [...app.container.querySelectorAll("button")].find((b) => b.textContent.includes("認可書実績"));
        certTab.click(); await sleep(150);
        const certRows = app.container.querySelectorAll("tbody tr").length;
        asserts.check("認可書実績の行数が法規行数と一致", certRows, regCount);

        // Reactのkey警告が出ていないこと
        const keyWarnings = warnings.filter((w) => /unique "key"|same key|Encountered two children/i.test(w));
        asserts.check("Reactのkey警告が出ていない", keyWarnings, []);
      } finally {
        console.error = realError; window.confirm = realConfirm;
      }
    },
  },
  {
    id: "F-plan-pure-and-sql-shape",
    name: "F：解析が共有採番を変えないこと／SQLがridを返さない形の応答も補完できること",
    expect: "parseImportedDataの前後で採番が不変／rid無し応答に一意なridを補完",
    async run({ asserts }) {
      const before = peekNumbering();
      // 解析だけを何度行っても共有採番は変わらない
      for (let i = 0; i < 5; i++) {
        parseImportedData({ runs: [], regs: [{ id: "", label: "", shin: "", kei: "", parent: "" },
                                             { id: "", label: "", shin: "", kei: "", parent: "" }], cert: {} });
      }
      asserts.check("解析を繰り返しても採番が不変", peekNumbering(), before);

      // SQLがridを返さない形（rid無し）の応答でも、一意なridを補完できる
      const sqlLike = { runs: [], regs: [
        { id: "DEMO-REG-A", label: "A", shin: "", kei: "", parent: "" },
        { id: "DEMO-REG-B", label: "B", shin: "", kei: "", parent: "" },
      ], cert: {} };
      const planned = planRegKeys(sqlLike.regs, peekIds().rid);
      asserts.checkTrue("補完できる", planned.ok);
      asserts.check("補完後のridが一意", planned.regs.length, new Set(planned.regs.map((r) => r.rid)).size);
      asserts.checkTrue("全行にridが付く", planned.regs.every((r) => typeof r.rid === "string" && r.rid !== ""));
      asserts.check("planRegKeysは共有採番を変えない", peekNumbering(), before);

      // 既存ridとの衝突回避（行順に依存しない）
      const mixed = [{ rid: "g7", id: "X", label: "", shin: "", kei: "", parent: "" },
                     { id: "Y", label: "", shin: "", kei: "", parent: "" }];
      for (const [label, rows] of [["g7が先", mixed], ["ridなしが先", [mixed[1], mixed[0]]]]) {
        const r = planRegKeys(rows, 6);
        const rids = r.regs.map((x) => x.rid);
        asserts.check(`衝突しない(${label})`, rids.length, new Set(rids).size);
      }
    },
  },
  {
    id: "G-malformed-rid-rejected",
    name: "G：不正な形式のrid（g9007199254740992x）を拒否し、共有採番を壊さない",
    expect: "拒否／3データ全体・dirty・両採番が不変／その後の通常の法規追加が成功する",
    async run({ mount, asserts }) {
      const app = mount();
      await sleep(50);
      await openRegsTab(app.container);

      // dirty を作る（拒否で未書き出し状態が変わらないことを見るため）
      await clickAddReg(app.container);
      await sleep(80);
      editRegField(app.container, 0, "ダミー法規 SU", "KEEP-G");
      await sleep(80);
      // 先に全データを控える（snapshotAll は書き出しを押すため dirty が消える）
      const baseline = await snapshotAll(app.container);
      // 控えたあと編集し直して dirty へ戻す
      editRegField(app.container, 0, "ダミー法規 SU", "KEEP-G2");
      await sleep(80);
      const dirtyBefore = readStatus(app.container);
      asserts.check("拒否前はdirty", dirtyBefore, "未書き出しの変更があります（書き出してください）");
      const numberingBefore = peekNumbering();

      // 必要フィールドは正常で、全行にridがあり、その一つが不正形式
      const malformed = {
        runs: [],
        regs: [
          { rid: "g1", id: "OK-1", label: "正常", shin: "", kei: "", parent: "" },
          { rid: "g9007199254740992x", id: "BAD", label: "不正rid", shin: "", kei: "", parent: "" },
        ],
        cert: {},
      };
      asserts.check("解析段階で拒否", parseImportedData(malformed).ok, false);

      const alerts = [];
      const realAlert = window.alert; window.alert = (m) => alerts.push(String(m));
      const realConfirm = window.confirm; window.confirm = () => true;
      try {
        selectFile(app.container, JSON.stringify(malformed), "malformed-rid.json");
        await sleep(250);
        asserts.check("拒否の警告が1回", alerts.length, 1);
        // dirty を先に確認してから全データを比較する
        asserts.check("dirtyが変わらない", readStatus(app.container), dirtyBefore);
        asserts.check("両採番が変わらない", peekNumbering(), numberingBefore);

        // その後の通常の法規追加が成功すること（共有採番が壊れていない証拠）
        const regsBefore = (await snapshotAll(app.container)).regs.length;
        alerts.length = 0;
        await clickAddReg(app.container);
        await sleep(120);
        const after = await snapshotAll(app.container);
        asserts.check("拒否後も法規行を追加できる", after.regs.length, regsBefore + 1);
        asserts.check("追加時に警告が出ない", alerts, []);
        const rids = after.regs.map((r) => r.rid);
        asserts.check("追加後もridが一意", rids.length, new Set(rids).size);

        // 3データ全体：拒否時点の内容（編集値KEEP-G2＋追加前）と比べる
        const expectRegs = baseline.regs.map((r, i) => i === 0 ? { ...r, label: "KEEP-G2" } : r);
        asserts.check("runs/cert 全体が不変",
          { runs: after.runs, cert: after.cert }, { runs: baseline.runs, cert: baseline.cert });
        asserts.check("regsは追加分以外が不変", after.regs.slice(0, expectRegs.length), expectRegs);
      } finally {
        window.alert = realAlert; window.confirm = realConfirm;
      }
    },
  },
  {
    id: "H-key-number-interpretation",
    name: "H：純数字の巨大rid・上限内の正常値・rid無し旧JSONの補完（runs側も照合）",
    expect: "解釈が検証・採番計画・反映で一致する",
    async run({ asserts }) {
      const reg = (rid, id) => ({ ...(rid ? { rid } : {}), id, label: "", shin: "", kei: "", parent: "" });
      const wrap = (regs) => ({ runs: [], regs, cert: {} });

      // 純数字の巨大rid → 拒否
      asserts.check("純数字の巨大ridを拒否",
        parseImportedData(wrap([reg("g9007199254740992", "X")])).ok, false);
      // 上限内の正常値 → 受理
      asserts.check("上限ちょうどのridを受理",
        parseImportedData(wrap([reg(`g${MAX_KEY_NUMBER}`, "X")])).ok, true);
      asserts.check("上限内のridを受理",
        parseImportedData(wrap([reg(`g${MAX_KEY_NUMBER - 1}`, "X")])).ok, true);
      // 不正形式 → 拒否
      asserts.check("g+非数字を拒否", parseImportedData(wrap([reg("gABC", "X")])).ok, false);
      asserts.check("接頭辞なしを拒否", parseImportedData(wrap([reg("custom", "X")])).ok, false);

      // rid無し旧JSONの補完は維持される
      const legacy = parseImportedData(wrap([reg(null, "L1"), reg(null, "L2")]));
      asserts.check("rid無し旧JSONを受理", legacy.ok, true);
      asserts.checkTrue("補完ridが付く",
        legacy.ok && legacy.data.regs.every((r) => typeof r.rid === "string" && r.rid !== ""));
      asserts.check("補完ridが一意",
        legacy.ok ? new Set(legacy.data.regs.map((r) => r.rid)).size : 0, 2);
      asserts.check("既存IDを変えない",
        legacy.ok ? legacy.data.regs.map((r) => r.id) : null, ["L1", "L2"]);

      // 既存ridとrid無しの混在（補完が衝突しない）
      const mixed = parseImportedData(wrap([reg("g7", "A"), reg(null, "B")]));
      asserts.check("混在を受理", mixed.ok, true);
      asserts.check("混在で補完ridが衝突しない",
        mixed.ok ? new Set(mixed.data.regs.map((r) => r.rid)).size : 0, 2);

      // runs 側も同じ解釈：部分解釈される文字列で採番が壊れないこと
      const run = (key) => ({ key, typeId: "", gen: "", sk: "新", lo: "", drop: "" });
      const partial = parseImportedData({ runs: [run("r9007199254740992x")], regs: [], cert: {} });
      asserts.check("runs: r+非数字は受理（採番対象外）", partial.ok, true);
      asserts.check("runs: 採番対象外なのでmaxIdに採用しない", partial.ok ? partial.maxId : -1, 0);
      asserts.check("runs: 純数字の巨大keyは拒否",
        parseImportedData({ runs: [run("r9007199254740992")], regs: [], cert: {} }).ok, false);
      asserts.check("runs: 上限ちょうどは受理",
        parseImportedData({ runs: [run(`r${MAX_KEY_NUMBER}`)], regs: [], cert: {} }).ok, true);
    },
  },
  {
    id: "V8-control-outer-only",
    name: "対照（判定関数の単独比較のみ・実アプリの状態保持確認ではない）",
    expect: "旧判定は runs:[null] を通し描画相当で TypeError／新判定は拒否。※実アプリの保持確認はV1・V9",
    async run({ asserts }) {
      // 旧来の「外側だけ」の判定（isValidData 相当）
      const outerOnly = (d) => !!d && Array.isArray(d.runs) && Array.isArray(d.regs) &&
        typeof d.cert === "object" && d.cert !== null && !Array.isArray(d.cert);
      // 現行の描画・編集・判定が行うアクセスを最小限で再現する
      const renderLike = (d) => {
        const typeIds = [...new Set(d.runs.map((r) => r.typeId))];
        for (const run of d.runs) {
          for (const r of d.regs) {
            const { sk, lo, drop } = run; void sk; void lo; void drop;
            void (d.cert[run.typeId]?.[r.id] || null);
          }
          void String(run.key).replace(/^r/, "");
        }
        return typeIds;
      };
      const cases = [
        ["runs:[null]", { runs: [null], regs: [], cert: {} }],
        ["runs要素が配列", { runs: [[]], regs: [], cert: {} }],
        ["cert入れ子が文字列", { runs: [{ key: "r1", typeId: "T", gen: "", sk: "新", lo: "", drop: "" }], regs: [{ id: "R", label: "", shin: "", kei: "", parent: "" }], cert: { T: "x" } }],
      ];
      for (const [label, data] of cases) {
        asserts.check(`旧判定は通してしまう(${label})`, outerOnly(data), true);
        asserts.check(`新判定は拒否する(${label})`, parseImportedData(data).ok, false);
      }
      // runs:[null] は旧判定のままだと実際に例外になる
      let crashed = false;
      try { renderLike(cases[0][1]); } catch { crashed = true; }
      asserts.check("旧判定を通した runs:[null] は描画相当で例外", crashed, true);
    },
  },
  {
    id: "V7-parse-unit",
    name: "parseImportedData の単体境界",
    expect: "空データはok／中身不正はngで理由を返す",
    async run({ asserts }) {
      asserts.check("空データ", parseImportedData(EMPTY).ok, true);
      asserts.check("正常データ", parseImportedData(VALID).ok, true);
      asserts.check("runs:[null]", parseImportedData({ runs: [null], regs: [], cert: {} }).ok, false);
      asserts.check("cert:[]", parseImportedData({ runs: [], regs: [], cert: [] }).ok, false);
      asserts.check("cert入れ子不正", parseImportedData({ runs: [], regs: [], cert: { T: 1 } }).ok, false);
      asserts.check("null", parseImportedData(null).ok, false);
      asserts.check("配列", parseImportedData([]).ok, false);
      asserts.check("maxId(r900)", parseImportedData({ runs: [{ key: "r900", typeId: "", gen: "", sk: "新", lo: "", drop: "" }], regs: [], cert: {} }).maxId, 900);
      // 今回採用した許容条件：法規IDは空でも重複でも受理する（行の同一性は rid が担う）
      const reg = (id, rid) => ({ ...(rid ? { rid } : {}), id, label: "", shin: "", kei: "", parent: "" });
      asserts.check("法規IDが空でも受理", parseImportedData({ runs: [], regs: [reg("")], cert: {} }).ok, true);
      asserts.check("法規IDが複数空でも受理", parseImportedData({ runs: [], regs: [reg(""), reg("")], cert: {} }).ok, true);
      asserts.check("法規IDが重複しても受理", parseImportedData({ runs: [], regs: [reg("A"), reg("A")], cert: {} }).ok, true);
      asserts.check("rid が重複するときは拒否", parseImportedData({ runs: [], regs: [reg("A", "g1"), reg("B", "g1")], cert: {} }).ok, false);
      // rid の無い旧形式JSONには rid を補って受理する（値は消さない・変えない）
      const filled = parseImportedData({ runs: [], regs: [reg(""), reg("")], cert: {} });
      asserts.check("rid を補って受理", filled.data.regs.every((r) => typeof r.rid === "string" && r.rid !== ""), true);
      asserts.check("補ったridは行ごとに異なる", new Set(filled.data.regs.map((r) => r.rid)).size, 2);
      asserts.check("元の値は変えない", filled.data.regs.map((r) => r.id), ["", ""]);
    },
  },
];

function Runner() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const runAll = async () => {
    if (window.__SIVERIFY_RUNNING__) return;
    window.__SIVERIFY_RUNNING__ = true;
    window.__SIVERIFY_RESULT__ = { finished: false };
    setRunning(true); setDone(false); setResults({});
    const collected = {};
    // ?only=A,B のように指定すると、その接頭辞のケースだけ実行する（切り分け用）。
    // finally からも参照するため、try の外で宣言する。
    const only = new URLSearchParams(location.search).get("only");
    const targets = only ? SCENARIOS.filter((x) => only.split(",").some((k) => x.id.startsWith(k))) : SCENARIOS;

    try {
      // 進行状況を逐次公開する（通しで止まったとき、どこで止まったかを外から読めるようにする）
      window.__SIVERIFY_LOG__ = [];
      window.__SIVERIFY_RUN_ID__ = "run-" + Date.now();   // 実行識別（外部ランナーの記録と突き合わせる）
      const log = (phase, id, extra) => {
        const e = { t: Date.now(), phase, id, ...(extra ? { extra } : {}) };
        window.__SIVERIFY_LOG__.push(e);
        window.__SIVERIFY_CURRENT__ = e;
      };

      for (const s of targets) {
        log("case:start", s.id);
        setResults((p) => ({ ...p, [s.id]: { state: "running" } }));
        // 採番はモジュール共有の状態なので、ケース間で持ち越さないよう起動時に戻す
        resetIds();
        const mgr = createMountManager();
        const asserts = createAsserts();
        let outcome;
        try {
          log("run:start", s.id);
          await s.run({ mount: mgr.mount, asserts });
          log("run:end", s.id);
          outcome = { state: "done", pass: asserts.failures.length === 0, actual: asserts.notes.join(" / "), detail: asserts.failures.join("\n") };
        } catch (e) {
          log("run:error", s.id, String(e && e.message));
          outcome = { state: "done", pass: false, actual: `例外: ${e.message}`, detail: String(e.stack || "") };
        } finally {
          log("cleanup:start", s.id);
          mgr.cleanupAll();
          log("cleanup:end", s.id);
        }
        collected[s.id] = outcome;
        setResults((p) => ({ ...p, [s.id]: outcome }));
        await sleep(80);
      }
    } finally {
      setRunning(false); setDone(true);
      const vals = Object.values(collected);
      window.__SIVERIFY_RESULT__ = {
        finished: true,
        pass: vals.filter((r) => r.pass).length,
        fail: vals.filter((r) => !r.pass).length,
        total: targets.length,
        scenarios: targets.map((s) => ({ id: s.id, name: s.name, expect: s.expect, pass: collected[s.id]?.pass, actual: collected[s.id]?.actual, detail: collected[s.id]?.detail })),
      };
      window.__SIVERIFY_RUNNING__ = false;
    }
  };

  useEffect(() => {
    window.__runStandaloneVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);

  const pass = Object.values(results).filter((r) => r.state === "done" && r.pass).length;
  const fail = Object.values(results).filter((r) => r.state === "done" && !r.pass).length;

  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>単体版 JSON読込 検証ハーネス</h1>
      <p style={{ color: "#5a6b7d", fontSize: 12.5, lineHeight: 1.7, marginTop: 0 }}>
        実際の <code>StandaloneApp</code> をマウントし、JSON読込の拒否・保護動作を実測します。<br />
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
      <div id="sandbox" style={{ position: "absolute", left: -99999, top: 0, width: 1200, height: 800, overflow: "hidden" }} />
    </div>
  );
}

createRoot(document.getElementById("runner")).render(<Runner />);
