// ───────────────────────────────────────────────
// 保存保護の検証ハーネス（ダミーデータのみ・実サーバ/実DBには一切接続しない）
//
// 目的：実際の IListApp コンポーネントをマウントし、window.fetch をモックして
//       「初回読込が成功しない限り PUT が発生しない」ことなどを実測で確認する。
//
// 実行方法（重要：npm run dev は使わない）：
//   npm run dev は APIサーバも起動し、既存DB(data/ilist.db)を開いてしまう。
//   モック検証では実APIも実DBも不要なので、Vite だけを単独で起動する。
//
//   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
//   →  http://127.0.0.1:5173/verify/save-guard.html
//
//   （--strictPort により、ポートが埋まっていれば黙って別ポートに移らず失敗する。
//     その場合は既に起動しているプロセスを停止してから実行すること）
//
// 判定：各シナリオは PUT の発生回数・送信内容・画面の保存状態表示を実測し、
//       期待結果と突き合わせて PASS / FAIL を表示する。
//       「出力するだけ」ではなく、すべて assert して PASS 条件に含めている。
// ───────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import IListApp, { isValidData } from "../src/IListApp.jsx";

// 自動保存のデバウンス(800ms)を確実に超えて待つための待機時間
const DEBOUNCE_MS = 800;
const WAIT_PAST_DEBOUNCE = 1600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── ダミーの「サーバ保存済みデータ」（実データではない） ──
const STORED = {
  runs: [{ key: "r900", typeId: "TESTPRE-0001", gen: "事前保存", sk: "新", lo: "2020-01-01", drop: "2021-01-01" }],
  regs: [{ id: "TESTPRE-REG", label: "事前保存法規", shin: "2019-01-01", kei: "2020-01-01", parent: "" }],
  cert: { "TESTPRE-0001": { "TESTPRE-REG": "TESTPRE-CK-01" } },
};

// IListApp の SEED（空応答時にPUTされる期待本文の検証に使う。実データではない）
const EXPECTED_SEED_TYPE_IDS = ["DEMO-0001", "DEMO-0002", "DEMO-0003"];
const EXPECTED_SEED_REG_IDS = ["DEMO-REG-A", "DEMO-REG-A2", "DEMO-REG-B", "DEMO-REG-C", "DEMO-REG-D", "DEMO-REG-E"];

// ───────────────────────────────────────────────
// アサーション（失敗した条件を集めてPASS/FAILを決める）
// ───────────────────────────────────────────────
function createAsserts() {
  const failures = [];
  const notes = [];
  const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures.push(`${label}: 期待=${JSON.stringify(expected)} 実際=${JSON.stringify(actual)}`);
    notes.push(`${label}=${JSON.stringify(actual)}${ok ? "" : " ← NG"}`);
    return ok;
  };
  const checkTrue = (label, actual) => check(label, !!actual, true);
  return { check, checkTrue, failures, notes };
}

// ───────────────────────────────────────────────
// fetch モック
//   getBehavior/putBehavior を差し替えてAPIの故障・復旧・遅延を再現する。
//   PUTは「応答を保留して後から解決する」ことができる（古い応答の追い越しを再現するため）。
// ───────────────────────────────────────────────
const realFetch = window.fetch;

function createFetchMock() {
  const state = {
    log: [],                       // {method, url, body, at}
    getBehavior: () => ({ ok: true, json: { runs: [], regs: [], cert: {} } }),
    putBehavior: () => ({ ok: true, json: { ok: true } }),
    pending: [],                   // 保留中の応答を後から解決するための控え
  };

  window.fetch = async (url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    const entry = { method, url: String(url), body: opts.body ? JSON.parse(opts.body) : null, at: Date.now() };
    state.log.push(entry);

    const behavior = (method === "PUT" ? state.putBehavior(entry) : state.getBehavior(entry)) || {};

    const makeResponse = () => {
      if (behavior.networkError) throw new TypeError("Failed to fetch");
      return {
        ok: behavior.ok !== false,
        status: behavior.status ?? (behavior.ok === false ? 500 : 200),
        json: async () => {
          if (behavior.invalidJson) throw new SyntaxError("Unexpected token '<', \"<html>not \"... is not valid JSON");
          return behavior.json;
        },
      };
    };

    // deferred: 応答を保留し、テスト側が任意のタイミングで解決する
    if (behavior.deferred) {
      return new Promise((resolve, reject) => {
        state.pending.push({
          entry,
          release: () => { try { resolve(makeResponse()); } catch (e) { reject(e); } },
        });
      });
    }
    return makeResponse();
  };

  state.restore = () => { window.fetch = realFetch; };
  return state;
}

let mock = createFetchMock();

const puts = () => mock.log.filter((e) => e.method === "PUT");
const gets = () => mock.log.filter((e) => e.method === "GET");
const resetMock = () => {
  mock.log.length = 0;
  mock.pending.length = 0;
  mock.getBehavior = () => ({ ok: true, json: { runs: [], regs: [], cert: {} } });
  mock.putBehavior = () => ({ ok: true, json: { ok: true } });
};

const SAVE_TEXTS = ["読み込み中…", "保存中…", "サーバに保存済み", "初回読込に失敗（保存は行われません）", "保存に失敗（変更は未保存です）"];

// 画面に出ている保存状態テキストを読む（表示と実動作の一致を確認するため）
function readSaveStatusText(container) {
  if (!container || !container.isConnected) return "(コンテナが破棄済み)";
  for (const s of container.querySelectorAll("span")) {
    const t = s.textContent.trim();
    if (SAVE_TEXTS.includes(t)) return t;
  }
  return "(保存状態の表示が見つかりません)";
}

// ───────────────────────────────────────────────
// マウント管理：ケース単位で必ず後始末する（指摘4）
// ───────────────────────────────────────────────
function createMountManager() {
  const mounted = [];
  const mount = ({ strict = false } = {}) => {
    const container = document.createElement("div");
    document.getElementById("sandbox").appendChild(container);
    const root = createRoot(container);
    root.render(strict ? <React.StrictMode><IListApp /></React.StrictMode> : <IListApp />);
    const handle = {
      container,
      unmount() {
        if (handle._done) return;
        handle._done = true;
        try { root.unmount(); } catch { /* 後始末中の例外は無視 */ }
        try { container.remove(); } catch { /* 同上 */ }
      },
    };
    mounted.push(handle);
    return handle;
  };
  // ケース終了時に、明示的にunmountされなかったものも含めて全部片付ける
  const cleanupAll = () => { for (const h of mounted.slice().reverse()) h.unmount(); mounted.length = 0; };
  return { mount, cleanupAll };
}

// 画面上に編集値が保持されているかを見る。
// 型式IDは「型式ラン」タブでは <input value> に入るため textContent には現れない。
// input の実値とテキスト表示の両方を対象にする。
function screenHasValue(container, value) {
  if (!container || !container.isConnected) return false;
  for (const input of container.querySelectorAll("input")) {
    if (input.value === value) return true;
  }
  return container.textContent.includes(value);
}

// 画面上の入力を実際に操作して編集を起こす（state直接操作ではなく本物のUI経由）
async function editFirstRunTypeId(container, value) {
  const tabs = [...container.querySelectorAll("button")];
  const runsTab = tabs.find((b) => b.textContent.includes("型式ラン"));
  if (!runsTab) throw new Error("型式ランタブが見つかりません");
  runsTab.click();
  await sleep(0);
  const input = container.querySelector('input[placeholder="DEMO-0001"]');
  if (!input) throw new Error("型式の入力欄が見つかりません");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(0);
  return true;
}

// 編集を起こすが「待たない」版。
// dispatchEvent から戻った直後は、Reactがcommit済みでも保存Effectの本体はまだ走っていない
// ことがある。その一瞬（＝旧応答が最新扱いされうる窓）をテストから狙うために使う。
// awaitを一切挟まないので、呼び出し側は戻り値の直後に好きな処理を差し込める。
function editFirstRunTypeIdSync(container, value) {
  const input = container.querySelector('input[placeholder="DEMO-0001"]');
  if (!input) throw new Error("型式の入力欄が見つかりません（先に型式ランタブを開くこと）");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// 「型式ラン」タブを開くだけ（editFirstRunTypeIdSync の前提を作る）
async function openRunsTab(container) {
  const tabs = [...container.querySelectorAll("button")];
  const runsTab = tabs.find((b) => b.textContent.includes("型式ラン"));
  if (!runsTab) throw new Error("型式ランタブが見つかりません");
  runsTab.click();
  await sleep(0);
}

// JSON読込（importJSON）をUI経路で起こす。
// この経路のstate更新は FileReader.onload の中＝Reactのdiscreteイベント外で起きるため、
// 手入力と違い「変更受付 → 保存Effect実行」の間に割り込む余地がある。
// onHandled が渡されていれば、setRuns/setRegs/setCert の直後・保存Effectの実行前に呼ばれる。
function importJSONViaUI(container, data, onHandled) {
  const fileInput = container.querySelector('input[type="file"]');
  if (!fileInput) throw new Error("読み込み用の file input が見つかりません");

  const RealFR = window.FileReader;
  if (onHandled) {
    window.FileReader = class extends RealFR {
      set onload(fn) {
        super.onload = (ev) => {
          fn.call(this, ev);   // ここで setRuns/setRegs/setCert が呼ばれる（＝変更の受付）
          try { onHandled(); } finally { window.FileReader = RealFR; }
        };
      }
      get onload() { return super.onload; }
    };
  }

  const file = new File([JSON.stringify(data)], "dummy.json", { type: "application/json" });
  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(fileInput, "files", { value: dt.files, configurable: true });
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
}

// 保存Effectが実行された瞬間の保存状態表示を記録する。
// 「変更受付 → 旧応答の到着 → 保存Effect実行」の窓で起きた誤反映は、
// 直後に新しいEffectが表示を"保存中…"へ戻してしまうため、あとから見ても分からない。
// そこでEffect本体（デバウンス800msのsetTimeoutを張る箇所）の実行時点で表示を採取する。
function watchSaveEffect(container) {
  const realSetTimeout = window.setTimeout;
  const seen = [];
  window.setTimeout = function (fn, ms, ...rest) {
    if (ms === DEBOUNCE_MS) seen.push(readSaveStatusText(container));
    return realSetTimeout.call(window, fn, ms, ...rest);
  };
  return {
    seen,
    stop() { window.setTimeout = realSetTimeout; return seen; },
  };
}

// JSON読込で流し込むダミーデータ（実データではない）
const IMPORTED = (typeId) => ({
  runs: [{ key: "r950", typeId, gen: "取込", sk: "新", lo: "2020-01-01", drop: "2021-01-01" }],
  regs: [{ id: "IMP-REG", label: "取込法規", shin: "2019-01-01", kei: "2020-01-01", parent: "" }],
  cert: {},
});

// ───────────────────────────────────────────────
// シナリオ定義
//   run(ctx) で ctx.mount / ctx.asserts を使う。後始末はランナーが finally で保証する。
// ───────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "A-cert-array",
    name: "cert が配列の不正応答 → 復旧しても、正常読込前は PUT ゼロ",
    expect: "PUT回数=0 / 表示=初回読込に失敗（保存は行われません）",
    async run({ mount, asserts }) {
      mock.getBehavior = () => ({ ok: true, json: { runs: [], regs: [], cert: [] } });
      const app = mount();
      await sleep(300);
      // APIを「正常化」する。正常な読込が完了していない以上、PUTは発生してはならない
      mock.getBehavior = () => ({ ok: true, json: STORED });
      await sleep(WAIT_PAST_DEBOUNCE);

      asserts.check("PUT回数", puts().length, 0);
      asserts.check("表示", readSaveStatusText(app.container), "初回読込に失敗（保存は行われません）");
    },
  },
  {
    id: "B-network-error",
    name: "通信失敗（ネットワークエラー） → PUT ゼロ",
    expect: "PUT回数=0 / 表示=初回読込に失敗（保存は行われません）",
    async run({ mount, asserts }) {
      mock.getBehavior = () => ({ networkError: true });
      const app = mount();
      await sleep(300);
      mock.getBehavior = () => ({ ok: true, json: STORED });
      await sleep(WAIT_PAST_DEBOUNCE);

      asserts.check("PUT回数", puts().length, 0);
      asserts.check("表示", readSaveStatusText(app.container), "初回読込に失敗（保存は行われません）");
    },
  },
  {
    id: "C-http-error",
    name: "HTTPエラー(500) → PUT ゼロ",
    expect: "PUT回数=0 / 表示=初回読込に失敗（保存は行われません）",
    async run({ mount, asserts }) {
      mock.getBehavior = () => ({ ok: false, status: 500, json: { error: "internal" } });
      const app = mount();
      await sleep(300);
      mock.getBehavior = () => ({ ok: true, json: STORED });
      await sleep(WAIT_PAST_DEBOUNCE);

      asserts.check("PUT回数", puts().length, 0);
      asserts.check("表示", readSaveStatusText(app.container), "初回読込に失敗（保存は行われません）");
    },
  },
  {
    id: "D-invalid-json",
    name: "不正JSON（JSONとして解釈できない応答） → PUT ゼロ",
    expect: "PUT回数=0 / 表示=初回読込に失敗（保存は行われません）",
    async run({ mount, asserts }) {
      mock.getBehavior = () => ({ ok: true, invalidJson: true });
      const app = mount();
      await sleep(300);
      mock.getBehavior = () => ({ ok: true, json: STORED });
      await sleep(WAIT_PAST_DEBOUNCE);

      asserts.check("PUT回数", puts().length, 0);
      asserts.check("表示", readSaveStatusText(app.container), "初回読込に失敗（保存は行われません）");
    },
  },
  {
    id: "E-normal-edit-save",
    name: "正常読込 → 画面で編集 → 期待する内容で PUT → 再読込",
    expect: "PUT本文に編集内容(EDIT-TEST-0001) / 既存regs・cert保持 / 表示=サーバに保存済み / 再読込で反映",
    async run({ mount, asserts }) {
      mock.getBehavior = () => ({ ok: true, json: STORED });
      const app = mount();
      await sleep(300);
      await sleep(WAIT_PAST_DEBOUNCE);
      const putsAfterLoad = puts().length;

      await editFirstRunTypeId(app.container, "EDIT-TEST-0001");
      await sleep(WAIT_PAST_DEBOUNCE);

      const lastPut = puts()[puts().length - 1];
      asserts.checkTrue("編集後にPUTが増えた", puts().length > putsAfterLoad);
      asserts.check("PUT本文のtypeId", lastPut?.body.runs.map((r) => r.typeId), ["EDIT-TEST-0001"]);
      asserts.check("既存regsを保持", lastPut?.body.regs.map((r) => r.id), ["TESTPRE-REG"]);
      asserts.check("既存certを保持", lastPut?.body.cert?.["TESTPRE-0001"]?.["TESTPRE-REG"], "TESTPRE-CK-01");
      asserts.check("表示", readSaveStatusText(app.container), "サーバに保存済み");

      // 再読込：保存された内容をサーバが返す想定で再マウントし、反映を確認
      const savedSnapshot = lastPut ? lastPut.body : STORED;
      app.unmount();
      mock.getBehavior = () => ({ ok: true, json: savedSnapshot });
      const app2 = mount();
      await sleep(400);
      asserts.checkTrue("再読込で編集内容が表示される", screenHasValue(app2.container, "EDIT-TEST-0001"));
    },
  },
  {
    id: "F-save-failure-recovery",
    name: "保存失敗 → 表示・編集保持を確認 → 復旧後の次の編集で最新内容を保存",
    expect: "PUT件数増加 / 本文に編集値 / 表示=保存に失敗（変更は未保存です） / 編集は画面に保持 / 復旧後の編集で最新値を保存",
    async run({ mount, asserts }) {
      // 初回保存は成功させる
      mock.getBehavior = () => ({ ok: true, json: STORED });
      const app = mount();
      await sleep(300);
      await sleep(WAIT_PAST_DEBOUNCE);
      const putsAfterFirstSave = puts().length;
      asserts.checkTrue("初回保存が成功している", putsAfterFirstSave > 0);
      asserts.check("初回保存後の表示", readSaveStatusText(app.container), "サーバに保存済み");

      // ここから編集に対するPUTだけ失敗させる
      mock.putBehavior = () => ({ networkError: true });
      await editFirstRunTypeId(app.container, "EDIT-FAIL-0001");
      await sleep(WAIT_PAST_DEBOUNCE);

      const failedPut = puts()[puts().length - 1];
      asserts.checkTrue("失敗する編集でPUT件数が増えた", puts().length > putsAfterFirstSave);
      asserts.check("失敗PUTの本文に編集値", failedPut?.body.runs.map((r) => r.typeId), ["EDIT-FAIL-0001"]);
      asserts.check("失敗時の表示", readSaveStatusText(app.container), "保存に失敗（変更は未保存です）");
      asserts.checkTrue("編集内容が画面に保持されている", screenHasValue(app.container, "EDIT-FAIL-0001"));

      // 復旧：次の編集で最新内容が保存できること
      const putsBeforeRecovery = puts().length;
      mock.putBehavior = () => ({ ok: true, json: { ok: true } });
      await editFirstRunTypeId(app.container, "EDIT-RECOVERED-0001");
      await sleep(WAIT_PAST_DEBOUNCE);

      const recoveredPut = puts()[puts().length - 1];
      asserts.checkTrue("復旧後にPUT件数が増えた", puts().length > putsBeforeRecovery);
      asserts.check("復旧後PUTの本文に最新値", recoveredPut?.body.runs.map((r) => r.typeId), ["EDIT-RECOVERED-0001"]);
      asserts.check("復旧後の表示", readSaveStatusText(app.container), "サーバに保存済み");
    },
  },
  {
    id: "G-empty-vs-invalid",
    name: "正常な空応答と不正応答の区別（空応答のPUT本文・回数もassert）",
    expect: "空応答→PUT=1回・本文はSEED・表示=保存済み / cert:[]→PUT=0回・表示=読込失敗",
    async run({ mount, asserts }) {
      // G-1: 正常な空応答（空DBからの初回起動）→ SEEDがそのまま保存される既存仕様
      mock.getBehavior = () => ({ ok: true, json: { runs: [], regs: [], cert: {} } });
      const app1 = mount();
      await sleep(300);
      await sleep(WAIT_PAST_DEBOUNCE);

      asserts.check("空応答時のPUT回数", puts().length, 1);
      const emptyPut = puts()[0];
      asserts.check("空応答時のPUT本文 runs.typeId", [...new Set(emptyPut?.body.runs.map((r) => r.typeId))], EXPECTED_SEED_TYPE_IDS);
      asserts.check("空応答時のPUT本文 regs.id", emptyPut?.body.regs.map((r) => r.id), EXPECTED_SEED_REG_IDS);
      asserts.check("空応答時のPUT本文 certキー", Object.keys(emptyPut?.body.cert ?? {}), EXPECTED_SEED_TYPE_IDS);
      asserts.check("空応答時の表示", readSaveStatusText(app1.container), "サーバに保存済み");
      app1.unmount();

      // G-2: 不正応答（cert が配列）
      mock.log.length = 0;
      mock.getBehavior = () => ({ ok: true, json: { runs: [], regs: [], cert: [] } });
      const app2 = mount();
      await sleep(300);
      await sleep(WAIT_PAST_DEBOUNCE);
      asserts.check("不正応答(cert:[])時のPUT回数", puts().length, 0);
      asserts.check("不正応答時の表示", readSaveStatusText(app2.container), "初回読込に失敗（保存は行われません）");

      // isValidData 単体の境界
      asserts.check("isValidData {cert:{}}", isValidData({ runs: [], regs: [], cert: {} }), true);
      asserts.check("isValidData {cert:[]}", isValidData({ runs: [], regs: [], cert: [] }), false);
      asserts.check("isValidData {cert:null}", isValidData({ runs: [], regs: [], cert: null }), false);
      asserts.check("isValidData {runs:'x'}", isValidData({ runs: "x", regs: [], cert: {} }), false);
      asserts.check("isValidData null", isValidData(null), false);
    },
  },
  {
    id: "H-unmount-before-debounce",
    name: "編集直後、保存タイマー発火前にアンマウント → その後もPUTが増えない",
    expect: "アンマウント後にPUT件数が増加しない（clearTimeoutのcleanupが効く）",
    async run({ mount, asserts }) {
      mock.getBehavior = () => ({ ok: true, json: STORED });
      const app = mount();
      await sleep(300);
      await sleep(WAIT_PAST_DEBOUNCE);
      const baseline = puts().length;

      // 編集した直後、800msのタイマーが発火する前にアンマウントする
      await editFirstRunTypeId(app.container, "EDIT-UNMOUNT-0001");
      await sleep(200); // デバウンス(800ms)未満
      const atUnmount = puts().length;
      asserts.check("アンマウント時点でPUTは未発火", atUnmount, baseline);
      app.unmount();

      // タイマーが発火するはずだった時刻を十分に過ぎるまで待つ
      await sleep(WAIT_PAST_DEBOUNCE);
      asserts.check("アンマウント後のPUT件数", puts().length, atUnmount);
      asserts.checkTrue("編集内容のPUTが送信されていない",
        !puts().some((p) => p.body?.runs?.some?.((r) => r.typeId === "EDIT-UNMOUNT-0001")));
    },
  },
  {
    id: "I-strictmode-stale-get",
    name: "StrictMode：古いGETが遅れて解決しても、新しい状態を上書きしない",
    expect: "GET=2回(二重実行) / 遅延解決した古いGETの内容が画面に出ない / 表示=サーバに保存済み",
    async run({ mount, asserts }) {
      // StrictModeの1回目のGETは保留（後から遅れて解決させる）、2回目は最新データを返す
      const STALE = {
        runs: [{ key: "r800", typeId: "STALE-0001", gen: "古い応答", sk: "新", lo: "2010-01-01", drop: "2011-01-01" }],
        regs: [{ id: "STALE-REG", label: "古い法規", shin: "2009-01-01", kei: "2010-01-01", parent: "" }],
        cert: {},
      };
      let getCount = 0;
      mock.getBehavior = () => {
        getCount += 1;
        // 1回目（StrictModeでcleanupされる方）は保留＋古いデータ
        if (getCount === 1) return { deferred: true, ok: true, json: STALE };
        return { ok: true, json: STORED };
      };

      const app = mount({ strict: true });
      await sleep(400);

      // 2回目のGET（最新）が解決して画面に反映された後で、保留していた1回目を解決させる
      asserts.checkTrue("最新データが画面に出ている", screenHasValue(app.container, "TESTPRE-0001"));
      for (const p of mock.pending.splice(0)) p.release();
      await sleep(400);

      asserts.check("GET回数(StrictModeの二重実行)", gets().length, 2);
      asserts.checkTrue("古い応答(STALE-0001)が画面に出ていない", !screenHasValue(app.container, "STALE-0001"));
      asserts.checkTrue("最新データが維持されている", screenHasValue(app.container, "TESTPRE-0001"));

      await sleep(WAIT_PAST_DEBOUNCE);
      asserts.check("表示", readSaveStatusText(app.container), "サーバに保存済み");
      // 古い応答で上書きされていれば、PUT本文にSTALEが混じるはず
      asserts.checkTrue("PUT本文に古い応答が混入していない",
        !puts().some((p) => p.body?.runs?.some?.((r) => r.typeId === "STALE-0001")));
    },
  },
  {
    id: "J-stale-put-status",
    name: "遅延PUT中に追加編集 → 古いPUTの成功で「保存済み」にならない",
    expect: "最新編集が未送信の間は「保存済み」表示にならない / 最新編集は最終的に保存される",
    async run({ mount, asserts }) {
      mock.getBehavior = () => ({ ok: true, json: STORED });
      const app = mount();
      await sleep(300);
      await sleep(WAIT_PAST_DEBOUNCE);

      // 次のPUT（1回目の編集）を保留させる
      mock.putBehavior = () => ({ deferred: true, ok: true, json: { ok: true } });
      await editFirstRunTypeId(app.container, "EDIT-GEN1");
      await sleep(WAIT_PAST_DEBOUNCE); // PUTは送信されたが応答は保留中
      const pendingAfterFirst = mock.pending.length;
      asserts.checkTrue("1回目の編集のPUTが保留中", pendingAfterFirst > 0);

      // 応答が返らないうちに追加編集する（＝最新編集はまだ未送信）
      await editFirstRunTypeId(app.container, "EDIT-GEN2");
      await sleep(100); // デバウンス中。2回目のPUTはまだ出ていない

      // ここで古い（1回目の）PUTを成功させる
      for (const p of mock.pending.splice(0)) p.release();
      await sleep(200);

      // 最新編集(GEN2)は未送信なので「保存済み」であってはならない
      asserts.check("古いPUT成功直後の表示", readSaveStatusText(app.container), "保存中…");

      // 2回目のPUTは通常どおり成功させ、最終的に保存済みになること
      mock.putBehavior = () => ({ ok: true, json: { ok: true } });
      await sleep(WAIT_PAST_DEBOUNCE);
      const lastPut = puts()[puts().length - 1];
      asserts.check("最終PUT本文に最新編集", lastPut?.body.runs.map((r) => r.typeId), ["EDIT-GEN2"]);
      asserts.check("最終的な表示", readSaveStatusText(app.container), "サーバに保存済み");
    },
  },
  {
    id: "K-stale-put-success-at-edit",
    name: "編集を受け付けた直後（保存Effect実行前）に古いPUTが成功しても「保存済み」にしない",
    expect: "旧PUT成功の到着が編集受付より後なら、最新編集の保存表示を「サーバに保存済み」にしない",
    async run({ mount, asserts }) {
      mock.getBehavior = () => ({ ok: true, json: STORED });
      const app = mount();
      await sleep(300);
      await sleep(WAIT_PAST_DEBOUNCE);
      await openRunsTab(app.container);

      // 1回目の編集のPUTを保留させる
      mock.putBehavior = () => ({ deferred: true, ok: true, json: { ok: true } });
      editFirstRunTypeIdSync(app.container, "EDIT-K1");
      await sleep(WAIT_PAST_DEBOUNCE);
      asserts.checkTrue("1回目編集のPUTが保留中", mock.pending.length > 0);

      // ここが要点：編集を受け付けた「直後」（保存Effectがまだ走っていない同一タスク内）で
      // 保留していた古いPUTを解決させる。await を挟まずに release する。
      editFirstRunTypeIdSync(app.container, "EDIT-K2");
      const releasedInWindow = mock.pending.splice(0);
      asserts.checkTrue("編集受付直後に解決させた旧PUTがある", releasedInWindow.length > 0);
      for (const pnd of releasedInWindow) pnd.release();

      await sleep(200); // 旧PUTの .then が走りきるのを待つ（まだデバウンス中＝新PUTは未送信）
      asserts.check("旧PUT成功直後の表示", readSaveStatusText(app.container), "保存中…");

      // 最新編集は通常どおり保存され、最終的に保存済みになること
      mock.putBehavior = () => ({ ok: true, json: { ok: true } });
      await sleep(WAIT_PAST_DEBOUNCE);
      const lastPut = puts()[puts().length - 1];
      asserts.check("最終PUT本文に最新編集", lastPut?.body.runs.map((r) => r.typeId), ["EDIT-K2"]);
      asserts.check("最終的な表示", readSaveStatusText(app.container), "サーバに保存済み");
    },
  },
  {
    id: "L-stale-put-failure-at-edit",
    name: "編集を受け付けた直後に古いPUTが失敗しても、最新状態を古いエラーで上書きしない",
    expect: "旧PUTの失敗が「保存に失敗」表示にならず、最新編集は保存済みになる",
    async run({ mount, asserts }) {
      mock.getBehavior = () => ({ ok: true, json: STORED });
      const app = mount();
      await sleep(300);
      await sleep(WAIT_PAST_DEBOUNCE);
      await openRunsTab(app.container);

      // 1回目の編集のPUTを保留（解決時は失敗＝HTTP500にする）
      mock.putBehavior = () => ({ deferred: true, ok: false, status: 500 });
      editFirstRunTypeIdSync(app.container, "EDIT-L1");
      await sleep(WAIT_PAST_DEBOUNCE);
      asserts.checkTrue("1回目編集のPUTが保留中", mock.pending.length > 0);

      // 編集受付の直後に、保留していた古いPUTを「失敗」で解決させる
      editFirstRunTypeIdSync(app.container, "EDIT-L2");
      const releasedInWindow = mock.pending.splice(0);
      asserts.checkTrue("編集受付直後に解決させた旧PUTがある", releasedInWindow.length > 0);
      for (const pnd of releasedInWindow) pnd.release();

      await sleep(200);
      asserts.check("旧PUT失敗直後の表示", readSaveStatusText(app.container), "保存中…");

      // 最新編集は成功させる。古い失敗が残って「保存に失敗」にならないこと
      mock.putBehavior = () => ({ ok: true, json: { ok: true } });
      await sleep(WAIT_PAST_DEBOUNCE);
      asserts.check("最終的な表示", readSaveStatusText(app.container), "サーバに保存済み");
      asserts.checkTrue("画面に最新編集が保持されている", screenHasValue(app.container, "EDIT-L2"));
    },
  },
  {
    id: "M-unmount-inflight-put",
    name: "PUT送信後にアンマウント → 成功/失敗どちらの応答が来ても状態更新の経路へ進まない",
    expect: "アンマウント後に到着した応答が setSave を一度も呼ばないこと",
    // ── SKIP（未検証）──
    // このケースは有効な観測手段が無いため実行しない。PASSにもFAILにもしない。
    //
    // 経緯：以前は React.useState を差し替えて setSave の呼出を数えていたが、
    // 本体は名前付きimportの useState を使っており、差し替えが本体の参照に届いていなかった。
    // 陽性確認（正常保存で setSave を捕捉できるか）を行ったところ捕捉数0で、
    // 観測自体が機能していなかった。したがって当時の「呼出ゼロ→PASS」は
    // 「呼ばれていない」ではなく「観測できていない」を意味していた。
    //
    // 代替手段も成立しなかった：
    //  - 名前空間側(NS.useState)の差し替え … ラッパが一度も呼ばれない（Viteの事前バンドルにより束縛が確定）
    //  - DOM(MutationObserver)観測 … アンマウント後は何も記録されず、dropped の有無で差が出ない
    //    （「呼ばれていない」と「アンマウント済みで描画されない」を区別できない）
    //  - React DevToolsフック … フックが読まれず不成立。React内部への依存を広げる方向でもある
    //
    // 本体にテスト用の観測フックを追加すれば判定できるが、その本体変更は承認されていない。
    // よってアンマウント後の setSave 抑止は「コード確認のみ」の扱いとする。
    skip: true,
    skipReason: "有効な観測手段が無いため未検証（本体変更なしでは setSave 到達を判定できない）。コード上は applySave の dropped フラグで抑止している。",
  },
  {
    id: "N-latest-save-result-applies",
    name: "最新編集に対応する保存結果は、成功・失敗とも正常に反映する",
    expect: "最新PUTの成功→「サーバに保存済み」／最新PUTの失敗→「保存に失敗（変更は未保存です）」",
    async run({ mount, asserts }) {
      mock.getBehavior = () => ({ ok: true, json: STORED });
      const app = mount();
      await sleep(300);
      await sleep(WAIT_PAST_DEBOUNCE);
      await openRunsTab(app.container);

      // 最新編集の保存が成功する経路
      mock.putBehavior = () => ({ ok: true, json: { ok: true } });
      editFirstRunTypeIdSync(app.container, "EDIT-N-OK");
      await sleep(WAIT_PAST_DEBOUNCE);
      asserts.check("最新PUT成功時の表示", readSaveStatusText(app.container), "サーバに保存済み");

      // 最新編集の保存が失敗する経路（無効化しすぎて反映されなくなっていないかの確認）
      mock.putBehavior = () => ({ ok: false, status: 500 });
      editFirstRunTypeIdSync(app.container, "EDIT-N-NG");
      await sleep(WAIT_PAST_DEBOUNCE);
      asserts.check("最新PUT失敗時の表示", readSaveStatusText(app.container), "保存に失敗（変更は未保存です）");
      asserts.checkTrue("編集内容は画面に保持", screenHasValue(app.container, "EDIT-N-NG"));

      // 復旧後の編集で保存済みに戻る
      mock.putBehavior = () => ({ ok: true, json: { ok: true } });
      editFirstRunTypeIdSync(app.container, "EDIT-N-RECOVERED");
      await sleep(WAIT_PAST_DEBOUNCE);
      asserts.check("復旧後の表示", readSaveStatusText(app.container), "サーバに保存済み");
      const lastPut = puts()[puts().length - 1];
      asserts.check("最終PUT本文", lastPut?.body.runs.map((r) => r.typeId), ["EDIT-N-RECOVERED"]);
    },
  },
  {
    id: "O-stale-put-at-import-accept",
    name: "JSON読込でデータ変更を受け付けた直後（保存Effect実行前）に旧PUTが成功しても反映しない",
    expect: "変更受付〜Effect実行の窓で旧PUTが成功しても、保存表示が「サーバに保存済み」にならない",
    async run({ mount, asserts }) {
      mock.getBehavior = () => ({ ok: true, json: STORED });
      const app = mount();
      await sleep(300);
      await sleep(WAIT_PAST_DEBOUNCE);
      await openRunsTab(app.container);

      // 1回目の編集のPUTを保留させる（これが「古いPUT」になる）
      mock.putBehavior = () => ({ deferred: true, ok: true, json: { ok: true } });
      editFirstRunTypeIdSync(app.container, "EDIT-O1");
      await sleep(WAIT_PAST_DEBOUNCE);
      asserts.checkTrue("旧PUTが送信済みで応答保留中", mock.pending.length > 0);

      // JSON読込でデータ変更を受け付けた直後（保存Effectの実行前）に旧PUTを成功させる。
      // 誤反映は次のEffectが表示を戻すまでの一瞬なので、Effect実行時点の表示を採取して判定する。
      const watch = watchSaveEffect(app.container);
      let releasedCount = 0;
      let statusAtAccept = null;
      try {
        importJSONViaUI(app.container, IMPORTED("IMPORTED-O2"), () => {
          statusAtAccept = readSaveStatusText(app.container);
          const rel = mock.pending.splice(0);
          releasedCount = rel.length;
          for (const pnd of rel) pnd.release();
        });
        await sleep(300); // 旧PUTの .then と、続く保存Effectが走るのを待つ
      } finally {
        watch.stop();
      }

      asserts.checkTrue("変更受付の窓で旧PUTを解決できた", releasedCount > 0);
      asserts.check("変更受付時点の表示", statusAtAccept, "保存中…");
      asserts.checkTrue("窓の直後に保存Effectが実行された", watch.seen.length > 0);
      // ここが本命：旧PUTの成功が、最新データの保存表示として反映されていないこと
      asserts.checkTrue("保存Effect実行時点で「サーバに保存済み」になっていない",
        !watch.seen.includes("サーバに保存済み"));
      asserts.checkTrue("JSON読込の内容が画面に反映されている", screenHasValue(app.container, "IMPORTED-O2"));

      // 最新データは通常どおり保存され、最終的に保存済みになること
      mock.putBehavior = () => ({ ok: true, json: { ok: true } });
      await sleep(WAIT_PAST_DEBOUNCE);
      const lastPut = puts()[puts().length - 1];
      asserts.check("最終PUT本文", lastPut?.body.runs.map((r) => r.typeId), ["IMPORTED-O2"]);
      asserts.check("最終的な表示", readSaveStatusText(app.container), "サーバに保存済み");
    },
  },
  {
    id: "P-stale-put-failure-at-import-accept",
    name: "JSON読込でデータ変更を受け付けた直後に旧PUTが失敗しても、古いエラーで上書きしない",
    expect: "変更受付〜Effect実行の窓で旧PUTが失敗しても「保存に失敗」表示にならない",
    async run({ mount, asserts }) {
      mock.getBehavior = () => ({ ok: true, json: STORED });
      const app = mount();
      await sleep(300);
      await sleep(WAIT_PAST_DEBOUNCE);
      await openRunsTab(app.container);

      // 旧PUTは保留したうえで、解決時は失敗（通信エラー）にする
      mock.putBehavior = () => ({ deferred: true, networkError: true });
      editFirstRunTypeIdSync(app.container, "EDIT-P1");
      await sleep(WAIT_PAST_DEBOUNCE);
      asserts.checkTrue("旧PUTが送信済みで応答保留中", mock.pending.length > 0);

      const watch = watchSaveEffect(app.container);
      let releasedCount = 0;
      try {
        importJSONViaUI(app.container, IMPORTED("IMPORTED-P2"), () => {
          const rel = mock.pending.splice(0);
          releasedCount = rel.length;
          for (const pnd of rel) pnd.release();
        });
        await sleep(300);
      } finally {
        watch.stop();
      }

      asserts.checkTrue("変更受付の窓で旧PUTを解決できた", releasedCount > 0);
      asserts.checkTrue("窓の直後に保存Effectが実行された", watch.seen.length > 0);
      asserts.checkTrue("保存Effect実行時点で「保存に失敗」になっていない",
        !watch.seen.includes("保存に失敗（変更は未保存です）"));
      asserts.check("その後の表示も古いエラーではない", readSaveStatusText(app.container), "保存中…");

      // 最新データの保存は成功させる。古い失敗が残っていないこと
      mock.putBehavior = () => ({ ok: true, json: { ok: true } });
      await sleep(WAIT_PAST_DEBOUNCE);
      asserts.check("最終的な表示", readSaveStatusText(app.container), "サーバに保存済み");
      asserts.checkTrue("JSON読込の内容が保持されている", screenHasValue(app.container, "IMPORTED-P2"));
    },
  },
];

// ───────────────────────────────────────────────
// 検証ランナーUI
// ───────────────────────────────────────────────
function Runner() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const runAll = async () => {
    // 多重実行の防止（実行中の再入を弾く）
    if (window.__VERIFY_RUNNING__) return;
    window.__VERIFY_RUNNING__ = true;
    // 開始時に公開結果を「未完了」へ戻す（前回の結果が残って混ざらないように）
    window.__VERIFY_RESULT__ = { finished: false };

    setRunning(true); setDone(false); setResults({});
    const collected = {};

    try {
      for (const s of SCENARIOS) {
        // SKIP：有効な観測手段が無いケースは実行せず、PASS/FAILのどちらにも数えない
        if (s.skip) {
          const skipped = { state: "done", skip: true, pass: false, actual: s.skipReason || "未検証（SKIP）", detail: "" };
          collected[s.id] = skipped;
          setResults((prev) => ({ ...prev, [s.id]: skipped }));
          continue;
        }

        setResults((prev) => ({ ...prev, [s.id]: { state: "running" } }));

        // ケースごとにモック・マウント管理を作り直す
        resetMock();
        const mgr = createMountManager();
        const asserts = createAsserts();
        let outcome;
        try {
          await s.run({ mount: mgr.mount, asserts });
          outcome = { state: "done", pass: asserts.failures.length === 0, actual: asserts.notes.join(" / "), detail: asserts.failures.join("\n") };
        } catch (e) {
          outcome = { state: "done", pass: false, actual: `例外: ${e.message}`, detail: [...asserts.failures, String(e.stack || "")].join("\n") };
        } finally {
          // 例外の有無にかかわらず必ず後始末する（root.unmount / コンテナ削除 / モック復帰）
          mgr.cleanupAll();
          resetMock();
        }

        collected[s.id] = outcome;
        setResults((prev) => ({ ...prev, [s.id]: outcome }));
        await sleep(100);
      }
    } finally {
      setRunning(false); setDone(true);
      const vals = Object.values(collected);
      window.__VERIFY_RESULT__ = {
        finished: true,
        // SKIPはPASSにもFAILにも数えない（「全件PASS」と誤読させないため）
        pass: vals.filter((r) => !r.skip && r.pass).length,
        fail: vals.filter((r) => !r.skip && !r.pass).length,
        skip: vals.filter((r) => r.skip).length,
        total: SCENARIOS.length,
        allVerified: false, // SKIPが存在する限り「すべて検証済み」ではない
        scenarios: SCENARIOS.map((s) => ({
          id: s.id, name: s.name, expect: s.expect,
          skip: !!collected[s.id]?.skip,
          skipReason: collected[s.id]?.skip ? (s.skipReason || "") : undefined,
          pass: collected[s.id]?.skip ? undefined : collected[s.id]?.pass,
          actual: collected[s.id]?.actual, detail: collected[s.id]?.detail,
        })),
      };
      window.__VERIFY_RUNNING__ = false;
    }
  };

  useEffect(() => {
    window.__runVerification = runAll;
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);

  const passCount = Object.values(results).filter((r) => r.state === "done" && !r.skip && r.pass).length;
  const failCount = Object.values(results).filter((r) => r.state === "done" && !r.skip && !r.pass).length;
  const skipCount = Object.values(results).filter((r) => r.state === "done" && r.skip).length;

  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#cdd9e5", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, color: "#eef4fa", marginBottom: 4 }}>保存保護 検証ハーネス</h1>
      <p style={{ color: "#5a6b7d", fontSize: 12.5, lineHeight: 1.7, marginTop: 0 }}>
        実際の <code>IListApp</code> コンポーネントをマウントし、<code>window.fetch</code> をモックして保存保護の挙動を実測します。<br />
        <strong style={{ color: "#e0b24d" }}>ダミーデータのみ。実APIサーバ・実DB（data/ilist.db）には接続しません（fetchはすべてモックが横取り）。</strong>
      </p>
      <div style={{ background: "rgba(224,178,77,0.08)", border: "1px solid rgba(224,178,77,0.35)", borderRadius: 8, padding: "9px 13px", fontSize: 11.5, color: "#e0b24d", lineHeight: 1.75, marginBottom: 16 }}>
        起動は <strong>Vite単独</strong>で行ってください（<code>npm run dev</code> はAPIサーバも起動し、既存DBを開きます）：<br />
        <code style={{ color: "#eef4fa" }}>node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort</code>
      </div>

      <button onClick={runAll} disabled={running}
        style={{ background: running ? "#22303f" : "#4dd6e0", color: running ? "#5a6b7d" : "#0c1623", border: "none", borderRadius: 7, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: running ? "default" : "pointer" }}>
        {running ? "検証を実行中…" : "すべての検証を実行"}
      </button>

      {done && (
        <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, fontSize: 13, fontWeight: 700,
          background: failCount > 0 ? "rgba(255,107,87,0.16)" : skipCount > 0 ? "rgba(224,178,77,0.10)" : "rgba(63,191,143,0.13)",
          border: `1px solid ${failCount > 0 ? "#ff6b57" : skipCount > 0 ? "#e0b24d" : "#3fbf8f"}`,
          color: failCount > 0 ? "#ff6b57" : skipCount > 0 ? "#e0b24d" : "#3fbf8f" }}>
          総合結果: PASS {passCount} / FAIL {failCount} / SKIP {skipCount}（全 {SCENARIOS.length} 件）
          {skipCount > 0 && (
            <div style={{ fontWeight: 500, fontSize: 11.5, marginTop: 4, color: "#e0b24d" }}>
              SKIP {skipCount} 件は有効な観測手段が無く未検証です。「全件PASS」「すべて検証済み」ではありません。
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        {SCENARIOS.map((s) => {
          const r = results[s.id];
          const color = !r ? "#22303f" : r.state === "running" ? "#e0b24d" : r.skip ? "#8a7a4d" : r.pass ? "#3fbf8f" : "#ff6b57";
          return (
            <div key={s.id} style={{ background: "#13202f", border: `1px solid ${color}`, borderRadius: 10, padding: "12px 15px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#5a6b7d" }}>{s.id}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#eef4fa", flex: 1 }}>{s.name}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color }}>
                  {!r ? "未実行" : r.state === "running" ? "実行中…" : r.skip ? "SKIP（未検証）" : r.pass ? "PASS" : "FAIL"}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "#8fa3b8", lineHeight: 1.7 }}>
                <div><span style={{ color: "#5a6b7d" }}>期待結果：</span>{s.expect}</div>
                {r?.state === "done" && <div><span style={{ color: "#5a6b7d" }}>{r.skip ? "SKIP理由：" : "実測："}</span>{r.actual}</div>}
                {r?.state === "done" && r.detail && (
                  <div style={{ marginTop: 4, fontFamily: "ui-monospace, monospace", fontSize: 10.5, color: "#ff9e7d", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{r.detail}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 検証対象コンポーネントのマウント先（画面外に隠す） */}
      <div id="sandbox" style={{ position: "absolute", left: -99999, top: 0, width: 1200, height: 800, overflow: "hidden" }} />
    </div>
  );
}

createRoot(document.getElementById("runner")).render(<Runner />);
