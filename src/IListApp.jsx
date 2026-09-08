import React, { useState, useMemo, useRef, useEffect } from "react";
import { AlertTriangle, ShieldCheck, Minus, Activity, Pencil, Cpu, Plus, Trash2, Download, Upload, Table2, Scale, FileCheck } from "lucide-react";

// ───────────────────────────────────────────────
// Iリスト 帳票アプリ（段階2：サーバ保存）
//   入力＝法規DB・型式ラン・認可書実績（人間が手入れ）／ 帳票＝自動算出
//   要否：新型ラン 要⇔(新型適用≤LO)or(継続適用≤ドロップ)、継続ラン 要⇔継続適用≤ドロップ
//   データは起動時にサーバ(SQLite)から読み込み、編集すると自動保存される
//   JSONの書き出し/読み込みはバックアップ・持ち運び用として残している
// ───────────────────────────────────────────────

export const INK="#0c1623", PANEL="#13202f", LINE="#22303f", CYAN="#4dd6e0", GREEN="#3fbf8f",
      RED="#ff6b57", MUTE="#5a6b7d", AMBER="#e0b24d";
export const PALETTE=[CYAN,"#9d8cff",AMBER,GREEN,"#ff9e7d","#6db5ff","#d98cff"];
export const TODAY="2026-06-28";

// ダミーデータ（架空の型式・法規・認可書番号。実車・実データとは無関係）
export const SEED = {
  runs:[
    {key:"r1",typeId:"DEMO-0001", gen:"初代",     sk:"新",lo:"2017-07-01",drop:"2019-12-31"},
    {key:"r2",typeId:"DEMO-0001", gen:"改良MC",   sk:"継",lo:"2020-01-01",drop:"2022-12-31"},
    {key:"r3",typeId:"DEMO-0001", gen:"改良MC2",  sk:"継",lo:"2023-01-01",drop:"2023-12-31"},
    {key:"r4",typeId:"DEMO-0002",gen:"ビッグMC", sk:"新",lo:"2024-01-01",drop:"2025-12-31"},
    {key:"r5",typeId:"DEMO-0003",gen:"FMC2026", sk:"新",lo:"2026-01-01",drop:"2030-12-31"},
  ],
  regs:[
    {rid:"g1", id:"DEMO-REG-A",   label:"ダミー法規A",   shin:"2016-01-01",kei:"2018-01-01",parent:""},
    {rid:"g2", id:"DEMO-REG-A2",  label:"ダミー法規A SU",shin:"2024-06-01",kei:"2026-06-01",parent:"DEMO-REG-A"},
    {rid:"g3", id:"DEMO-REG-B",   label:"ダミー法規B",   shin:"2022-01-01",kei:"2024-01-01",parent:""},
    {rid:"g4", id:"DEMO-REG-C",   label:"ダミー法規C",   shin:"2025-01-01",kei:"2027-01-01",parent:""},
    {rid:"g5", id:"DEMO-REG-D",   label:"ダミー法規D",   shin:"2020-01-01",kei:"2022-01-01",parent:""},
    {rid:"g6", id:"DEMO-REG-E",   label:"ダミー法規E",   shin:"2028-01-01",kei:"2029-01-01",parent:""},
  ],
  cert:{
    "DEMO-0001": {"DEMO-REG-A":"DEMO*A00/00*01","DEMO-REG-D":"DEMO*D00/00*01"},
    "DEMO-0002": {"DEMO-REG-A":"DEMO*A00/00*02","DEMO-REG-B":"DEMO*B00/00*01","DEMO-REG-D":"DEMO*D00/00*02"},
    "DEMO-0003": {"DEMO-REG-A":"DEMO*A00/00*03","DEMO-REG-A2":"DEMO*A02/00*01","DEMO-REG-B":"DEMO*B00/00*02","DEMO-REG-D":"DEMO*D00/00*03","DEMO-REG-C":"DEMO*C00/00*01"},
  },
};

// サーバ応答が期待するデータ形 { runs:[], regs:[], cert:{} } かを判定する。
// 配列も typeof は "object" になるため、cert は「nullでない・配列でないオブジェクト」であることまで確認する。
// （cert:[] を通してしまうと、SEEDを保持したまま読込成功と誤認して保存に進む）
export const isValidData = (d) =>
  !!d && Array.isArray(d.runs) && Array.isArray(d.regs) &&
  typeof d.cert === "object" && d.cert !== null && !Array.isArray(d.cert);

// ───────────────────────────────────────────────
// 業務ロジック（判定式）。API版・単体版の両方がここを参照する（二重管理をしないため）。
// 要否：新型ラン 要⇔(新型適用≤LO)or(継続適用≤ドロップ)、継続ラン 要⇔継続適用≤ドロップ
// ───────────────────────────────────────────────
export const evalCellWith = (cert, run, r) => {
  const { sk, lo, drop } = run;
  let required=false, kind="";
  if (sk==="新") {
    if (r.shin && r.shin<=lo) { required=true; kind="新型"; }
    else if (r.kei && r.kei<=drop) { required=true; kind="継続"; }
  } else {
    if (r.kei && r.kei<=drop) { required=true; kind="継続"; }
  }
  const ck = cert[run.typeId]?.[r.id] || null;
  const status = !required ? "off" : ck ? "ok" : "leak";
  return { required, kind, ck, status, dueDate: kind==="新型" ? r.shin : r.kei };
};

// ───────────────────────────────────────────────
// 黄色の30日接近予告（要否判定式は一切変更しない。表示の注記のみを追加する）。
//
// 対象：evalCellWith の status が "off"（否）のセルのみ。
// ok（緑）・leak（赤）には一切適用しない＝既存の要判定・赤警告を黄色で弱めない。
//
// 条件：ドロップ日(run.drop)の後、1〜30暦日以内に継続車規制日(r.kei)が来る場合。
//   ・0日（同日）・負数（ドロップ日以前）・31日以上は対象外（黄色にしない）。
//   ・drop・kei のいずれかが欠落／不正な日付形式なら「対象外」として扱う
//     （安全側＝黄色を出さない。欠落・不正日付を「安全」とは表示しない＝
//      呼び出し側は notice=null のとき何も表示しないだけで、
//      「問題なし」の意味を持つ表示は一切出さない）。
// ───────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// YYYY-MM-DD を UTC 日付として解釈し、その日数値を返す（タイムゾーンに依存させないため）。
// 形式が不正、または実在しない日付（例：2024-02-30）なら null。
const dateDayNumber = (s) => {
  if (typeof s !== "string" || !DATE_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  // Date.UTCは月・日の繰り上がりを黙って許容する（例：2024-02-30→2024-03-01）ため、
  // 実在しない日付は往復して値が変わることで検出する
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return Math.floor(t / 86400000);
};

// ドロップ日から継続車規制日までの暦日数を返す（1〜30なら黄色対象）。
// 対象外・不正のときは null（＝「安全」ではなく「注記なし」を意味する。呼び出し側で判定すること）。
export function approachingKeiDays(dropStr, keiStr) {
  const dropDay = dateDayNumber(dropStr);
  const keiDay = dateDayNumber(keiStr);
  if (dropDay === null || keiDay === null) return null;
  const diff = keiDay - dropDay;
  if (diff < 1 || diff > 30) return null;
  return diff;
}

// セル1つぶんの黄色注記。status が "off" 以外（ok/leak）には常に null を返す
// （赤・緑の判定を黄色で弱めない）。
export function approachingNoticeFor(cellStatus, run, r) {
  if (cellStatus !== "off") return null;
  const days = approachingKeiDays(run?.drop, r?.kei);
  if (days === null) return null;
  return { days, keiDate: r.kei };
}

// 帳票の集計（漏れ一覧と実効ドロップ）。判定は evalCellWith を使う。
export const summarize = (runs, regs, cert) => {
  const leaks=[], effDrop={};
  for (const run of runs) {
    let earliest=null;
    for (const r of regs) {
      const c = evalCellWith(cert, run, r);
      if (c.status==="leak") {
        leaks.push({ run, reg:r.id, kind:c.kind, dueDate:c.dueDate });
        if (!earliest || c.dueDate<earliest) earliest=c.dueDate;
      }
    }
    if (earliest) effDrop[run.key]=earliest;
  }
  return { leaks, effDrop };
};

// 採番の上限。生成できる範囲と読み込める範囲を同じ値にそろえる。
// ここがずれると「自分が書き出したJSONを読み戻せない」ことが起きる。
// 上限そのものは読み込めるが、それを超える追加はできない（＝追加時に上限エラー）。
export const MAX_KEY_NUMBER = Number.MAX_SAFE_INTEGER - 1;

// ───────────────────────────────────────────────
// キー文字列（"r123" / "g45"）の数値部分の解釈。
//
// 検証・採番計画・反映がそれぞれ別の解釈をすると、
// 「検証は素通りしたのに採番だけが巨大値を採用する」といった食い違いが起きる。
//   例）"g9007199254740992x" は /^\d+$/ には一致しないが、parseInt は末尾xを無視して
//       9007199254740992 を返してしまう。
// そこで解釈をこの関数に統一し、どこから見ても同じ結果になるようにする。
//
//   接頭辞 + 数字のみ … その数値（採番の対象）
//   接頭辞 + それ以外 … null（採番の対象にしない）
// 数字以外が混ざったものを「数値」とは解釈しない（部分解釈をしない）。
// ───────────────────────────────────────────────
//   戻り値 { numbered, value }
//     numbered=false … 「接頭辞＋数字」の形ではない＝採番の対象外（不正ではない）
//     numbered=true  … 数字列である。value はその数値（安全な整数で表せなければ null）
const keyNumberOf = (value, prefix) => {
  if (typeof value !== "string" || !value.startsWith(prefix)) return { numbered: false, value: null };
  const body = value.slice(prefix.length);
  if (!/^\d+$/.test(body)) return { numbered: false, value: null };   // 部分解釈をしない
  const n = Number(body);
  // 数字列ではあるが安全な整数で表せない（＝桁が大きすぎる）場合は value=null にして
  // 「採番に使えない数字列」であることを numbered=true 側で示す
  return { numbered: true, value: Number.isSafeInteger(n) ? n : null };
};
// 採番に使える値かどうか。
//   採番の対象外（numbered=false）… 使わないだけなので受理する
//   数字列（numbered=true）… 安全な整数で、かつ上限以内であること
const isUsableKeyNumber = (k) =>
  !k.numbered || (k.value !== null && k.value <= MAX_KEY_NUMBER);
// 採番の底上げに使う数値（対象外・範囲外は null）
const usableNumberOf = (value, prefix) => {
  const k = keyNumberOf(value, prefix);
  return k.numbered && k.value !== null && k.value <= MAX_KEY_NUMBER ? k.value : null;
};

let _id = 100;
// 採番はインクリメントで進むため、安全な整数の上限に達すると値が増えず、
// 同じキーを何度も返してしまう（＝行の同一性が壊れる）。
// 黙って重複を作らないよう、上限に達したら例外にする。
// 読込側（parseImportedData）は、この上限に達しない範囲だけを受理する。

// 採番できる上限に達したことを表すエラー。呼び出し側が利用者への通知に使う。
export class KeyLimitError extends Error {
  constructor(message) { super(message); this.name = "KeyLimitError"; }
}

export const nextKey = () => {
  if (_id + 1 > MAX_KEY_NUMBER) {
    throw new KeyLimitError("型式ランの採番できる上限に達しました。これ以上行を追加できません。");
  }
  return "r" + (++_id);
};
// サーバから読んだランのキー(r101など)と新規追加のキーがぶつからないよう底上げする
// 法規行の内部キー（rid）。法規ID（id）は利用者が入力する表示・cert参照用の値であり、
// 空や重複がありうるため、行の同一性には使えない。そこで機械が付ける rid を別に持つ。
let _rid = 6;   // SEEDのregsが g1〜g6 を使っているため、その次から採番する
export const nextRegKey = () => {
  if (_rid + 1 > MAX_KEY_NUMBER) {
    throw new KeyLimitError("法規行の採番できる上限に達しました。これ以上行を追加できません。");
  }
  return "g" + (++_rid);
};
// 現在の採番値（テスト・検証から状態を壊さずに読むため）
export const peekIds = () => ({ id: _id, rid: _rid });
// 採番値を起動時の状態に戻す。検証ハーネスがケース間の独立性を保つために使う。
// 採番はモジュール共有の状態なので、上限付近を扱ったケースの影響を次のケースへ持ち越さない。
export const resetIds = ({ id = 100, rid = 6 } = {}) => { _id = id; _rid = rid; };

// ───────────────────────────────────────────────
// rid の補完（共有カウンタを変更しない純粋な処理）
//
// 既存の rid をすべて先に予約してから、衝突しない値だけを割り当てる。
// 共有カウンタ(_rid)は触らないので、検証だけして取りやめても採番は変わらない。
// 行順に依存しない（先に全行の rid を集めてから補完する）。
// ───────────────────────────────────────────────
export function planRegKeys(regs, startRid) {
  // 1) すでに使われている rid をすべて予約する（行順に関係なく先に集める）
  const taken = new Set();
  for (const r of regs) {
    if (typeof r?.rid === "string" && r.rid !== "") taken.add(r.rid);
  }
  // 2) 予約済みと、読み込んだ rid の最大値を踏まえた位置から採番する
  let next = startRid;
  for (const r of regs) {
    const n = usableNumberOf(r?.rid, "g");     // 部分解釈をしない統一の解釈
    if (n !== null && n > next) next = n;
  }
  // 3) 衝突しない値だけを割り当てる
  const filled = [];
  for (const r of regs) {
    if (typeof r?.rid === "string" && r.rid !== "") { filled.push(r); continue; }
    let candidate;
    do {
      if (next + 1 > MAX_KEY_NUMBER) {
        return { ok: false, error: "法規行の内部キーを採番できる上限に達しました。" };
      }
      candidate = "g" + (++next);
    } while (taken.has(candidate));      // 既存ridと衝突しない値になるまで進める
    taken.add(candidate);
    filled.push({ ...r, rid: candidate });
  }
  return { ok: true, regs: filled, maxRid: next };
}

export const bumpIdFrom = (runs) => {
  for (const r of runs) {
    const n = usableNumberOf(r?.key, "r");     // 部分解釈をしない統一の解釈
    if (n !== null && n > _id) _id = n;
  }
};

// ───────────────────────────────────────────────
// JSON読込用の厳密な検証（単体版の読込境界で使う）。
//
// isValidData は「外側の形」だけを見るため、{runs:[null],regs:[],cert:{}} のような
// 中身が壊れたデータを通してしまい、state更新を予約したあとの描画で例外になる。
// そこで「現行の描画・編集・判定処理が実際に必要とする構造」まで、置換前に検証する。
//
// 実際に必要とされるもの（コード上の使用箇所から確認したもの）：
//   run : key（更新・削除の識別子／nextKeyの採番元）, typeId, gen, sk, lo, drop
//   reg : id（更新・削除の識別子）, label, shin, kei, parent
//   cert: { [typeId]: { [regId]: 認可書番号(文字列) } } の2段の入れ子
//   key / id は行の同一性判定に使うため、重複していると更新・削除が誤動作する
//
// 空文字は許可する（編集で行を追加した直後は各欄が "" のため、正規の書き出しに含まれる）。
// 業務ルール（日付の妥当性や必須入力など）はここでは判定しない。無言の補正もしない。
// ───────────────────────────────────────────────
const RUN_FIELDS = ["key", "typeId", "gen", "sk", "lo", "drop"];
const REG_FIELDS = ["id", "label", "shin", "kei", "parent"];
// 画面の入力欄は文字列を書き込む。number等を無言で変換せず、文字列でなければ拒否する。
const isStr = (v) => typeof v === "string";

export function parseImportedData(d) {
  const err = (message) => ({ ok: false, error: message });
  if (!d || typeof d !== "object" || Array.isArray(d)) return err("JSONの中身がオブジェクトではありません。");
  if (!Array.isArray(d.runs)) return err("runs が配列ではありません。");
  if (!Array.isArray(d.regs)) return err("regs が配列ではありません。");
  if (typeof d.cert !== "object" || d.cert === null || Array.isArray(d.cert)) return err("cert がオブジェクトではありません。");

  // runs：行要素と必要な値の型、キーの重複
  const runKeys = new Set();
  for (let i = 0; i < d.runs.length; i++) {
    const r = d.runs[i];
    if (!r || typeof r !== "object" || Array.isArray(r)) return err(`runs[${i}] が行オブジェクトではありません。`);
    for (const f of RUN_FIELDS) {
      if (!isStr(r[f])) return err(`runs[${i}].${f} が文字列ではありません。`);
    }
    if (r.key === "") return err(`runs[${i}].key が空です。`);
    if (runKeys.has(r.key)) return err(`runs の key "${r.key}" が重複しています。`);
    runKeys.add(r.key);
  }

  // regs：行要素と必要な値の型。
  // 法規ID(id)は利用者が入力する値なので、空でも重複していても受け入れる
  // （画面では法規を何行でも追加でき、ID未入力のまま書き出せるため、
  //   ここで拒否すると「自分が書き出したJSONを読み戻せない」ことになる）。
  // 行の同一性は内部キー rid が担うので、重複してはいけないのは rid のほうである。
  const regRids = new Set();
  for (let i = 0; i < d.regs.length; i++) {
    const r = d.regs[i];
    if (!r || typeof r !== "object" || Array.isArray(r)) return err(`regs[${i}] が行オブジェクトではありません。`);
    for (const f of REG_FIELDS) {
      if (!isStr(r[f])) return err(`regs[${i}].${f} が文字列ではありません。`);
    }
    // rid は旧形式のJSONには無いので、あるときだけ検証する（無い場合はあとで補う）
    if (r.rid !== undefined) {
      if (!isStr(r.rid) || r.rid === "") return err(`regs[${i}].rid が文字列ではありません。`);
      if (regRids.has(r.rid)) return err(`regs の rid "${r.rid}" が重複しています。`);
      regRids.add(r.rid);
      // rid はアプリが生成する内部キーで、必ず "g" + 数字 の形になる
      // （nextRegKey() 以外に発生源はなく、画面に入力欄もない）。
      // 形が違うものは、採番の解釈が食い違う原因になるため反映前に拒否する
      // （例："g9007199254740992x" は厳密一致では弾かれないが parseInt では巨大値になり、
      //   検証を素通りしたまま共有カウンタだけを壊す）。
      // rid を持たない旧JSONは、この検証を通らず後段で補完される（従来どおり）。
      const rk = keyNumberOf(r.rid, "g");
      if (!rk.numbered) {
        return err(`regs の rid "${r.rid}" の形式が不正です（"g" と数字のみで構成されている必要があります）。`);
      }
      if (!isUsableKeyNumber(rk)) {
        return err(`regs の rid "${r.rid}" は採番できる範囲を超えています。`);
      }
    }
  }

  // cert：2段の入れ子と、認可書番号が文字列であること
  for (const [typeId, byReg] of Object.entries(d.cert)) {
    if (!byReg || typeof byReg !== "object" || Array.isArray(byReg)) {
      return err(`cert["${typeId}"] がオブジェクトではありません。`);
    }
    for (const [regId, ck] of Object.entries(byReg)) {
      if (!isStr(ck)) return err(`cert["${typeId}"]["${regId}"] が文字列ではありません。`);
    }
  }

  // 追加行の採番に必要な情報（keyの数値部分）を、置換前にここで確定させておく。
  // 検証に失敗した場合は採番状態を一切変えないため、_id はまだ更新しない。
  //
  // 採番は nextKey() の ++_id で進むため、安全な整数の範囲を超える値を取り込むと
  // インクリメントしても値が増えず、追加行のキーが既存行と重複する。
  // そこで「採番に使える範囲か」を置換前に検証し、範囲外は拒否する（データも採番も変更しない）。
  let maxId = 0;
  for (const r of d.runs) {
    // 検証・採番計画・反映で同じ解釈を使う（食い違うと採番だけが壊れる）
    const k = keyNumberOf(r.key, "r");
    // 生成できる範囲と同じ上限で判定する（ずれていると自分の書き出しを読み戻せない）。
    // 上限値そのものは読み込める。上限に達したあとの「追加」だけができない。
    if (!isUsableKeyNumber(k)) {
      return err(`runs の key "${r.key}" は採番できる範囲を超えています。`);
    }
    if (k.numbered && k.value !== null && k.value > maxId) maxId = k.value;
  }

  // 反映用のデータをここで作り終える（置換は呼び出し側が一度に行う）。
  // rid を持たない旧形式のJSONには rid を補う。既存の値は削除・統合・改名せず、付け足すだけ。
  //
  // 補完は planRegKeys（共有カウンタを変更しない純粋な処理）で行う。
  // そのため、検証だけして取りやめた場合・キャンセルした場合・古い結果を破棄した場合に
  // 採番が動いてしまうことがない。反映は呼び出し側が applyImported で行う。
  const planned = planRegKeys(d.regs, peekIds().rid);
  if (!planned.ok) return err(planned.error);

  return {
    ok: true,
    data: { runs: d.runs, regs: planned.regs, cert: d.cert },
    maxId,
    maxRid: planned.maxRid,
  };
}

// parseImportedData が確定させた採番情報を、置換が確定したあとに反映する。
// 置換確認と最新世代の確認を通過した「反映時だけ」呼ぶこと。
// runs 側(_id)と rid 側(_rid)の両方をまとめて整合させる。
export const applyImported = ({ maxId, maxRid }) => {
  if (typeof maxId === "number" && maxId > _id) _id = maxId;
  if (typeof maxRid === "number" && maxRid > _rid) _rid = maxRid;
};

// ───────────────────────────────────────────────
// 「データ入りHTML」書き出し（単体版専用）。
//
// 起動時データを埋め込むための場所は、standalone/index.html に置いた
// 制御されたマーカーの間（<!--ILIST_BOOT_DATA_START--> 〜 <!--ILIST_BOOT_DATA_END-->）
// にある <script type="application/json" id="ilist-boot-data"> 1個所に限定する。
// 描画済みDOMの丸ごと保存はしない（テンプレートは常にビルド済みのアプリコードのまま）。
//
// type="application/json" のscriptはブラウザに実行されない（構文チェックもされない）ため、
// ここで気を付けるべきはJSON構文そのものではなく「HTML側のトークン化を壊さないこと」。
//   ・"</script" を含む文字列 → そのscript要素が早期に終端してしまう
//   ・"<!--" を含む文字列 → 直後のHTMLコメント終端(-->)がここで閉じてしまう場合がある
// この2つをJSON文字列化のあとにエスケープする（内容は変えず、区切りとして解釈されなくする）。
// ───────────────────────────────────────────────
export const BOOT_DATA_START = "<!--ILIST_BOOT_DATA_START-->";
export const BOOT_DATA_END = "<!--ILIST_BOOT_DATA_END-->";

// JSON文字列をHTMLの<script>要素へ安全に埋め込むためのエスケープ。
// JSONの構文・値は変えない（< 等はJSON.parseで通常の文字へ戻る）。
const escapeForInlineScript = (jsonText) =>
  jsonText
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

// html中の <script ...>〜</script> の中身を、同じ長さの空白で覆い隠す。
// 「起動データのマーカーはHTML側に1個所だけ存在する」ことを確認したいが、
// この単体版はページ自身の雛形（HTML全文）を文字列としてscriptの中に持つため、
// script本文の中にも同じマーカー文字列が（データとして）現れる。
// マーカーの位置を数えるときはscript本文を除外し、実際のHTML構造だけを見る。
// 置換そのものは、この関数が返す位置に対して「元のhtml」へ行うため、内容は変えない。
const maskScriptBodies = (html) =>
  html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_m, open, body, close) =>
    open + " ".repeat(body.length) + close
  );

// 現在のHTML文字列から、起動データのマーカー区間を1個所だけ置き換える。
// マーカーはHTML構造上（script本文を除いて）1個所（開始・終了とも1回ずつ）でなければ拒否する
// （テンプレート構造の想定外を検出するため。script本文中に同じ文字列が現れても数えない）。
export function replaceBootData(html, data) {
  const masked = maskScriptBodies(html);
  const startCount = masked.split(BOOT_DATA_START).length - 1;
  const endCount = masked.split(BOOT_DATA_END).length - 1;
  if (startCount !== 1 || endCount !== 1) {
    return { ok: false, error: "起動データの埋め込み場所を特定できませんでした（テンプレートの構造が想定と異なります）。" };
  }
  const startIdx = masked.indexOf(BOOT_DATA_START);
  const endIdx = masked.indexOf(BOOT_DATA_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { ok: false, error: "起動データの埋め込み場所を特定できませんでした（マーカーの順序が想定と異なります）。" };
  }
  // masked と html は同じ長さ・同じオフセットなので、位置だけをそのまま元のhtmlへ流用できる
  const json = escapeForInlineScript(JSON.stringify(data));
  const block =
    BOOT_DATA_START +
    `\n    <script type="application/json" id="ilist-boot-data">${json}</script>\n    ` +
    BOOT_DATA_END;
  const next = html.slice(0, startIdx) + block + html.slice(endIdx + BOOT_DATA_END.length);
  return { ok: true, html: next };
}

// ページに埋め込まれた起動データ（#ilist-boot-data）を読み取る。
// 「無い」（初回配布のテンプレートそのもの）と「あるが壊れている」を区別して返す。
//   present=false … 埋め込みが無い（通常のテンプレート起動。SEEDを使ってよい）
//   present=true, ok=false … 埋め込みはあるが読めない（黙ってSEEDへ置き換えてはいけない）
//   present=true, ok=true  … 埋め込みを読めた
export function readBootData(doc = document) {
  const el = doc.getElementById("ilist-boot-data");
  if (!el) return { present: false };
  const text = el.textContent;
  if (text == null || text.trim() === "" || text.trim() === "null") return { present: false };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { present: true, ok: false, error: "埋め込みデータのJSONを解析できませんでした。" };
  }
  const parsed = parseImportedData(raw);
  if (!parsed.ok) return { present: true, ok: false, error: parsed.error };
  return { present: true, ok: true, data: parsed.data, maxId: parsed.maxId, maxRid: parsed.maxRid };
}

// ページ自身に埋め込まれた「まっさらな雛形」（#ilist-template）を読み取る。
//
// file:// で開いたページは自分自身を fetch/XMLHttpRequest で読み直せない
// （Chromeで実測して確認済み：どちらも失敗する）。そのため、ビルド時点の雛形HTMLを
// あらかじめ文字列としてページに持たせておき、保存時はその文字列を使う。
// 描画済みDOMを読むわけではない（document.documentElement.outerHTMLは使わない）。
//
// 雛形文字列そのものは「雛形枠（#ilist-template）が空文字のままの状態」で保存されている
// （ビルド時に scripts/inline-standalone.mjs が埋め込む。自己参照で際限なく入れ子にしないため）。
const TEMPLATE_START = "<!--ILIST_TEMPLATE_START-->";
const TEMPLATE_END = "<!--ILIST_TEMPLATE_END-->";

// 雛形はBase64で運ぶ（"<" 等のHTML特殊文字を一切含まない文字列になるため、
// HTML側のトークン化を壊す心配がなく、手作りのエスケープ／アンエスケープも不要になる）。
// UTF-8（日本語を含む）を経由するため TextEncoder/TextDecoder を使う。
function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function base64ToUtf8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function readTemplateHtml(doc = document) {
  const el = doc.getElementById("ilist-template");
  if (!el) return { ok: false, error: "雛形（#ilist-template）が見つかりません。" };
  const text = el.textContent;
  if (!text || text.trim() === "") {
    return { ok: false, error: "雛形が空です。このページは「データ入りHTMLを保存」に対応していないビルドの可能性があります。" };
  }
  let html;
  try {
    html = base64ToUtf8(text.trim());
  } catch {
    return { ok: false, error: "雛形（Base64）を解読できませんでした。" };
  }
  return { ok: true, html };
}

// html中の雛形マーカー区間へ、雛形文字列そのもの（Base64化して）を書き込む。
// 保存のたびに「雛形は不変の定数として次のファイルへそのままコピーする」ことで、
// 保存版から編集→再保存→さらに新しく開く、という連鎖を成立させる
// （このコピーをしないと、保存版には空の雛形枠しか残らず、次の保存ができなくなる）。
function embedTemplateSlot(html, templateText) {
  const masked = maskScriptBodies(html);
  const startCount = masked.split(TEMPLATE_START).length - 1;
  const endCount = masked.split(TEMPLATE_END).length - 1;
  if (startCount !== 1 || endCount !== 1) {
    return { ok: false, error: "雛形の埋め込み場所を特定できませんでした（テンプレートの構造が想定と異なります）。" };
  }
  const startIdx = masked.indexOf(TEMPLATE_START);
  const endIdx = masked.indexOf(TEMPLATE_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { ok: false, error: "雛形の埋め込み場所を特定できませんでした（マーカーの順序が想定と異なります）。" };
  }
  const b64 = utf8ToBase64(templateText);
  const block =
    TEMPLATE_START +
    `\n    <script type="text/plain" id="ilist-template">${b64}</script>\n    ` +
    TEMPLATE_END;
  const next = html.slice(0, startIdx) + block + html.slice(endIdx + TEMPLATE_END.length);
  return { ok: true, html: next };
}

// 現在のデータを埋め込んだ新しいHTML文字列を組み立てる（ダウンロードするのは呼び出し側）。
// 1) 雛形（#ilist-template）を読む
// 2) 雛形の起動データ枠を現在のデータで置き換える
// 3) その結果へ、同じ雛形文字列をもう一度（雛形枠として）書き戻す
//    （そうしないと、生成したHTMLは「次の保存」ができないファイルになってしまう）
export function buildSavedHtml(data) {
  const tpl = readTemplateHtml();
  if (!tpl.ok) return tpl;
  const withData = replaceBootData(tpl.html, data);
  if (!withData.ok) return withData;
  return embedTemplateSlot(withData.html, tpl.html);
}

export default function IListApp() {
  const [runs, _setRuns] = useState(SEED.runs);
  const [regs, _setRegs] = useState(SEED.regs);
  const [cert, _setCert] = useState(SEED.cert);
  const [tab, setTab] = useState("帳票");

  // 編集世代：データ変更を「受け付けた時点」で進める。
  // 送信済みPUTの応答は、返ってきた時点の世代が自分の世代と一致するときだけ保存表示に反映する。
  // useEffect の中で進めるだけでは、変更受付からEffect実行までの間に届いた古い応答が
  // 「最新の応答」と誤認される窓が残るため、受付時点で進めるのが要点。
  const saveGen = useRef(0);
  // データ変更を受け付けたことを記録する（render中やstate updater内では呼ばない）
  const bumpGen = () => { saveGen.current += 1; };
  // runs/regs/cert の変更経路（手入力・JSON読込・初回読込の反映）はすべてこの3つを通す。
  // updater関数もそのまま渡せるように、副作用はupdaterの外（呼び出し時）で済ませている。
  const setRuns = (v) => { bumpGen(); _setRuns(v); };
  const setRegs = (v) => { bumpGen(); _setRegs(v); };
  const setCert = (v) => { bumpGen(); _setCert(v); };
  const fileRef = useRef(null);
  // loaded: 初回読込が「成功」した後にのみ true にする（保存を許可するフラグ）
  // 通信失敗・HTTPエラー・不正な応答（runs/regs/certが揃っていない）は失敗として扱い、loadedをtrueにしない
  const [loaded, setLoaded] = useState(false);
  // loading=読込中 / loadError=初回読込失敗（保存停止中） / saving=保存中 / saved=保存済み / saveError=保存失敗
  // 初回読込失敗(loadError)と保存失敗(saveError)は原因も対処も違うので別状態にする
  const [save, setSave] = useState("loading");

  // 起動時：サーバから読み込む。サーバが空（初回）なら SEED のまま → 読込成功として扱い、直後の自動保存でDBに入る
  useEffect(() => {
    let cancelled = false;
    fetch("/api/data")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => {
        if (cancelled) return;
        if (!isValidData(d)) throw new Error("不正な応答形式です");
        if (d.runs.length || d.regs.length || Object.keys(d.cert).length) {
          // 法規行の内部キー(rid)はサーバ側の既存データ（SQLがridを返さない形）には無いので補う。
          // 受理条件は変えず、値の削除・統合・改名もしない（付け足すだけ）。
          // 補完は共有カウンタを変えない planRegKeys で行い、反映時にまとめて採番を進める。
          const planned = planRegKeys(d.regs, peekIds().rid);
          if (!planned.ok) throw new Error(planned.error);
          setRuns(d.runs); setRegs(planned.regs); setCert(d.cert);
          bumpIdFrom(d.runs);
          applyImported({ maxRid: planned.maxRid });
        }
        setLoaded(true);
        setSave("saved");
      })
      .catch(() => { if (!cancelled) setSave("loadError"); }); // loadedはfalseのまま→保存は行われない
    return () => { cancelled = true; };
  }, []);

  // 編集のたびに自動保存（0.8秒待ってまとめて送る）。初回読込が成功するまでは送らない
  useEffect(() => {
    if (!loaded) return;
    // 世代はデータ変更の受付時（setRuns/setRegs/setCert）に進めてある。ここでは読むだけ。
    const gen = saveGen.current;
    // このEffectが送ったPUTの応答を無効化するためのフラグ。
    // アンマウント時や次の変更時のcleanupで倒し、応答が状態更新の経路へ進まないようにする。
    let dropped = false;
    // 世代が最新で、かつこのEffectが破棄されていないときだけ保存表示を更新する
    const applySave = (next) => { if (!dropped && gen === saveGen.current) setSave(next); };
    setSave("saving");
    const t = setTimeout(() => {
      fetch("/api/data", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runs, regs, cert }),
      })
        .then((r) => {
          if (!r.ok) throw new Error();
          applySave("saved");
        })
        .catch(() => { applySave("saveError"); });
    }, 800);
    return () => { clearTimeout(t); dropped = true; };
  }, [runs, regs, cert, loaded]);

  const typeIds = useMemo(() => [...new Set(runs.map(r => r.typeId))], [runs]);
  const colorOf = (typeId) => PALETTE[typeIds.indexOf(typeId) % PALETTE.length];

  const evalCell = (run, r) => evalCellWith(cert, run, r);
  const summary = useMemo(() => summarize(runs, regs, cert), [runs, regs, cert]);

  // ── JSON 書き出し/読み込み ──
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ runs, regs, cert }, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ilist_data_${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  const importJSON = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (d.runs && d.regs && d.cert) {
          // 法規行の内部キーを補う（受理条件は変えない）。共有カウンタは反映時にだけ進める。
          const planned = planRegKeys(d.regs, peekIds().rid);
          if (!planned.ok) { alert(planned.error); return; }
          setRuns(d.runs); setRegs(planned.regs); setCert(d.cert);
          applyImported({ maxRid: planned.maxRid });
        }
        else alert("形式が違います。runs / regs / cert を含むファイルを選んでください。");
      } catch { alert("読み込めませんでした。JSONファイルを確認してください。"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div style={{ background:INK, minHeight:"100vh", color:"#cdd9e5", fontFamily:"ui-sans-serif, system-ui, sans-serif", padding:"22px 18px 60px" }}>
      <div style={{ maxWidth:1120, margin:"0 auto" }}>
        {/* ヘッダ */}
        <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", marginBottom:14 }}>
          <span style={{ fontFamily:"ui-monospace, monospace", color:CYAN, fontSize:13, letterSpacing:2 }}>I-LIST</span>
          <h1 style={{ fontSize:19, fontWeight:700, margin:0, color:"#eef4fa" }}>自動車型式 適合・認証取得 管理帳票</h1>
          <span style={{ flex:1 }} />
          <SaveStatus save={save} />
          <button onClick={exportJSON} style={btn(CYAN)}><Download size={13}/> データ書き出し</button>
          <button onClick={()=>fileRef.current?.click()} style={btn(MUTE,true)}><Upload size={13}/> 読み込み</button>
          <input ref={fileRef} type="file" accept="application/json" onChange={importJSON} style={{ display:"none" }} />
        </div>

        {/* ダミー専用・検証中の告知 */}
        <div style={{ background:`${AMBER}14`, border:`1px solid ${AMBER}55`, borderRadius:8, padding:"6px 12px", fontSize:11, color:AMBER, marginBottom:14 }}>
          ダミーデータ専用・業務利用未検証（移植中の骨格です）
        </div>

        {/* タブ */}
        <div style={{ display:"flex", gap:4, borderBottom:`1px solid ${LINE}`, marginBottom:16 }}>
          {[["帳票",<Table2 size={13}/>],["型式ラン",<Scale size={13}/>],["法規DB",<Pencil size={13}/>],["認可書実績",<FileCheck size={13}/>]].map(([name,ic])=>(
            <button key={name} onClick={()=>setTab(name)} style={{
              display:"flex", alignItems:"center", gap:5, background:"transparent",
              color: tab===name?"#eef4fa":MUTE, border:"none",
              borderBottom: tab===name?`2px solid ${CYAN}`:"2px solid transparent",
              padding:"8px 14px", fontSize:13, fontWeight: tab===name?700:500, cursor:"pointer", marginBottom:-1 }}>
              {ic}{name}{name==="型式ラン"&&` (${runs.length})`}{name==="法規DB"&&` (${regs.length})`}
            </button>
          ))}
        </div>

        {tab==="帳票" && <MatrixView {...{runs,regs,evalCell,summary,colorOf}} />}
        {tab==="型式ラン" && <RunsEditor {...{runs,setRuns,colorOf,nextKey}} />}
        {tab==="法規DB" && <RegsEditor {...{regs,setRegs}} />}
        {tab==="認可書実績" && <CertEditor {...{typeIds,regs,cert,setCert,colorOf,evalCell,runs}} />}
      </div>
    </div>
  );
}

// ===== 帳票（マトリクス） =====
export function MatrixView({ runs, regs, evalCell, summary, colorOf }) {
  // 黄色は status="off"（否）の表示だけを差し替える注記であり、要否判定(status)そのものは変えない。
  // ok（緑）・leak（赤）の判定・配色には一切関与しない（既存の赤警告を黄色で弱めないため）。
  const cellStyle=(s, notice)=> s==="ok"?{bg:"rgba(63,191,143,0.13)",bd:GREEN,fg:GREEN}
    : s==="leak"?{bg:"rgba(255,107,87,0.16)",bd:RED,fg:RED}
    : notice?{bg:"rgba(224,178,77,0.14)",bd:AMBER,fg:AMBER}
    : {bg:"rgba(90,107,125,0.07)",bd:LINE,fg:MUTE};
  if (runs.length===0 || regs.length===0)
    return <Empty msg="型式ランと法規を入力すると、ここに適合・実績の帳票が出ます。" />;
  return (
    <>
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:10 }}>
        <Note color={CYAN}><b style={{color:CYAN}}>新型</b> 要⇔(新型適用≤LO)or(継続適用≤ドロップ)　<b style={{color:CYAN}}>継続</b> 要⇔継続適用≤ドロップ</Note>
        <Note color={AMBER}><Pencil size={10} color={AMBER}/> 手入れ＝法規DB・実績　<Cpu size={10} color={GREEN}/> 自動＝要否・申請発生・実効ドロップ</Note>
      </div>
      <div style={{ background:PANEL, borderRadius:12, padding:14, border:`1px solid ${LINE}`, overflowX:"auto" }}>
        <table style={{ borderCollapse:"separate", borderSpacing:5, width:"100%" }}>
          <thead><tr>
            <th style={{ textAlign:"left", padding:"4px 8px", fontSize:10.5, color:MUTE, minWidth:150 }}>法規 \ 型式ラン</th>
            {runs.map(run=>{ const col=colorOf(run.typeId); return (
              <th key={run.key} style={{ padding:"4px 6px", minWidth:138, verticalAlign:"top" }}>
                <div style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                  <span style={{ width:7,height:7,borderRadius:2,background:col }}/>
                  <span style={{ fontFamily:"ui-monospace, monospace", fontSize:12.5, color:"#eef4fa", fontWeight:700, borderBottom:`2px solid ${col}` }}>{run.typeId}</span>
                </div>
                <div style={{ fontSize:9.5, color:"#6b7d90", margin:"2px 0" }}>{run.gen}・{run.sk==="新"?"新型/指定":"継続/既指定"}</div>
                <div style={{ fontSize:9, color:MUTE, fontFamily:"ui-monospace,monospace" }}>LO {fmt(run.lo)}<br/>drop {fmt(run.drop)}</div>
              </th>);})}
          </tr></thead>
          <tbody>
            {/* React行キーは rid を使う。法規IDは空・重複がありうるため行の対応が崩れる。
                cert の参照先は従来どおり法規ID(r.id)のまま（参照モデルは変えない）。 */}
            {regs.map(r=>(
              <tr key={r.rid}>
                <td style={{ padding:"4px 8px", verticalAlign:"top", borderLeft:r.parent?`2px solid ${MUTE}`:"none" }}>
                  <div style={{ fontSize:12.5, fontWeight:700, color:"#eef4fa", paddingLeft:r.parent?8:0 }}>
                    {r.parent && <span style={{ color:MUTE, fontSize:10 }}>↳ </span>}{r.id}
                    <span style={{ color:"#6b7d90", fontWeight:500, fontSize:10, marginLeft:4 }}>{r.label}</span>
                  </div>
                  <div style={{ fontSize:9, color:MUTE, fontFamily:"ui-monospace,monospace", paddingLeft:r.parent?8:0, marginTop:2 }}>新{fmt(r.shin)}・継{fmt(r.kei)}</div>
                </td>
                {runs.map(run=>{
                  const c=evalCell(run,r);
                  // 黄色は判定式(evalCellWith)の外で計算する注記。status="off"以外には出さない。
                  const notice = approachingNoticeFor(c.status, run, r);
                  const st=cellStyle(c.status, !!notice);
                  return (
                  <td key={run.key} style={{ padding:0 }}>
                    <div style={{ background:st.bg, border:`1px solid ${st.bd}`, borderRadius:7, padding:"7px 8px", minHeight:48, display:"flex", flexDirection:"column", justifyContent:"center", gap:2 }}>
                      {c.status==="off" && !notice && <div style={{ display:"flex", alignItems:"center", gap:4, color:st.fg }}><Minus size={12}/><span style={{ fontSize:11 }}>否</span></div>}
                      {c.status==="off" && notice && <>
                        <div style={{ display:"flex", alignItems:"center", gap:4, color:st.fg }}><AlertTriangle size={12}/><span style={{ fontSize:10.5, fontWeight:700 }}>否・要再確認</span></div>
                        <span style={{ fontSize:9, color:st.fg }}>継続規制まで{notice.days}日（{fmt(notice.keiDate)}・延長時は再確認）</span></>}
                      {c.status==="ok" && <>
                        <div style={{ display:"flex", alignItems:"center", gap:4, color:st.fg }}><ShieldCheck size={12}/><span style={{ fontSize:10.5, fontWeight:700 }}>要</span><Badge kind={c.kind}/></div>
                        <span style={{ fontFamily:"ui-monospace,monospace", fontSize:9, color:"#bfe9d8" }}>{c.ck}</span></>}
                      {c.status==="leak" && <>
                        <div style={{ display:"flex", alignItems:"center", gap:4, color:st.fg }}><AlertTriangle size={12}/><span style={{ fontSize:10.5, fontWeight:800 }}>申請発生</span><Badge kind={c.kind}/></div>
                        <span style={{ fontSize:9, color:"#ffb3a8" }}>{c.dueDate<TODAY?"既発効・即対応":`${fmt(c.dueDate)}までに`}</span></>}
                    </div>
                  </td>);})}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display:"flex", gap:16, marginTop:10, fontSize:10.5, color:MUTE, flexWrap:"wrap", alignItems:"center" }}>
        <Leg c={GREEN} t="要・認可書あり"/><Leg c={RED} t="要・実績なし＝申請発生"/><Leg c={MUTE} t="否＝対象外"/>
        <Leg c={AMBER} t="否・ドロップ後30日以内に継続規制＝要再確認"/>
        <span style={{ display:"inline-flex", gap:5 }}><Badge kind="新型"/>指定で適合<Badge kind="継続"/>継続対応</span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:13, marginTop:22 }}>
        <Card title="コンプラ漏れ（自動検出）" icon={<AlertTriangle size={15} color={RED}/>}>
          {summary.leaks.length===0 ? <p style={{ color:GREEN, fontSize:12.5, margin:0 }}>漏れなし。</p> :
            summary.leaks.map((l,i)=>(
              <div key={i} style={{ fontSize:12, padding:"5px 0", borderBottom:i<summary.leaks.length-1?`1px solid ${LINE}`:"none" }}>
                <span style={{ fontFamily:"ui-monospace,monospace", color:"#eef4fa" }}>{l.run.typeId}</span>
                <span style={{ color:"#6b7d90", fontSize:11 }}>（{l.run.gen}）</span> × <span style={{ color:"#eef4fa" }}>{l.reg}</span>
                <Badge kind={l.kind}/><span style={{ color:"#ffb3a8", fontSize:11 }}> {l.dueDate<TODAY?"既発効・即対応":fmt(l.dueDate)+"までに"}</span>
              </div>))}
        </Card>
        <Card title="実効ドロップ（規制で縛られる期限）" icon={<Activity size={15} color={CYAN}/>}>
          {Object.keys(summary.effDrop).length===0 ? <p style={{ color:GREEN, fontSize:12.5, margin:0 }}>計画ドロップまで作れる。</p> :
            Object.entries(summary.effDrop).map(([k,d],i,arr)=>{ const run=runs.find(x=>x.key===k); const risk=d<run.drop; return (
              <div key={k} style={{ fontSize:12, padding:"5px 0", borderBottom:i<arr.length-1?`1px solid ${LINE}`:"none" }}>
                <span style={{ fontFamily:"ui-monospace,monospace", color:"#eef4fa" }}>{run.typeId}</span>
                <span style={{ color:"#6b7d90", fontSize:11 }}>（{run.gen}）</span>
                <span style={{ color:risk?RED:MUTE }}> 実効 {d<TODAY?"既発効":fmt(d)}</span>
                <span style={{ color:MUTE, fontSize:11 }}>（計画 {fmt(run.drop)}）</span>
                {risk && <span style={{ color:RED, fontSize:10 }}> ← 早まる</span>}
              </div>);})}
        </Card>
      </div>
    </>
  );
}

// ===== 型式ラン編集 =====
export function RunsEditor({ runs, setRuns, colorOf, nextKey }) {
  const up=(key,field,val)=>setRuns(rs=>rs.map(r=>r.key===key?{...r,[field]:val}:r));
  // キーの確保は updater の外で行う。
  // updater 内で採番すると、StrictMode などで再実行されたときに採番だけが余分に進む
  // （＝副作用のある updater になる）。ここで先に確保し、updater は純粋に保つ。
  const add=()=>{
    let key;
    try { key = nextKey(); }
    catch (e) { alert(e.message); return; }   // 上限到達：データも採番も変えずに知らせる
    setRuns(rs=>[...rs,{key,typeId:"",gen:"",sk:"新",lo:"",drop:""}]);
  };
  const del=(key)=>setRuns(rs=>rs.filter(r=>r.key!==key));
  return (
    <EditorShell title="型式ラン（型式 × プロジェクト）" desc="型式・プロジェクト（世代）・新継・LO・ドロップを入力。同じ型式を複数ランで使える（新→継など）。" onAdd={add} addLabel="ランを追加">
      <table style={tbl}>
        <thead><tr>{["型式","プロジェクト/世代","新継","LO（生産開始）","ドロップ（生産終了）",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {runs.map(r=>(
            <tr key={r.key}>
              <td style={td}><div style={{ display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ width:8,height:8,borderRadius:2,background:colorOf(r.typeId) }}/>
                <input value={r.typeId} placeholder="DEMO-0001" onChange={e=>up(r.key,"typeId",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace", width:120}}/>
              </div></td>
              <td style={td}><input value={r.gen} placeholder="FMC2026" onChange={e=>up(r.key,"gen",e.target.value)} style={inp}/></td>
              <td style={td}><select value={r.sk} onChange={e=>up(r.key,"sk",e.target.value)} style={{...inp, width:64}}><option value="新">新型</option><option value="継">継続</option></select></td>
              <td style={td}><input type="date" value={r.lo} onChange={e=>up(r.key,"lo",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace"}}/></td>
              <td style={td}><input type="date" value={r.drop} onChange={e=>up(r.key,"drop",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace"}}/></td>
              <td style={td}><button onClick={()=>del(r.key)} style={iconBtn}><Trash2 size={14} color={RED}/></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </EditorShell>
  );
}

// ===== 法規DB編集 =====
export function RegsEditor({ regs, setRegs }) {
  // 行の同一性は内部キー rid で判定する。
  // 法規ID(id)は利用者が入力する値で、空や重複がありうるため同一性には使えない
  // （id で判定すると、空ID2行の片方を編集・削除したときに両方が対象になってしまう）。
  const up=(rid,field,val)=>setRegs(rs=>rs.map(r=>r.rid===rid?{...r,[field]:val}:r));
  // キーの確保は updater の外（理由は RunsEditor の add と同じ）
  const add=()=>{
    let rid;
    try { rid = nextRegKey(); }
    catch (e) { alert(e.message); return; }   // 上限到達：データも採番も変えずに知らせる
    setRegs(rs=>[...rs,{rid,id:"",label:"",shin:"",kei:"",parent:""}]);
  };
  const del=(rid)=>setRegs(rs=>rs.filter(r=>r.rid!==rid));
  return (
    <EditorShell title="法規DB" desc="法規ID（UN番号）・名称・新型適用日・継続適用日を入力。シリーズアップは親法規を選ぶと帳票で↳表示される。" onAdd={add} addLabel="法規を追加">
      <table style={tbl}>
        <thead><tr>{["法規ID","名称","新型適用日","継続適用日","シリーズアップ元",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {regs.map((r,idx)=>(
            <tr key={r.rid}>
              <td style={td}><input value={r.id} placeholder="DEMO-REG-A2" onChange={e=>up(r.rid,"id",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace", width:96}}/></td>
              <td style={td}><input value={r.label} placeholder="ダミー法規 SU" onChange={e=>up(r.rid,"label",e.target.value)} style={inp}/></td>
              <td style={td}><input type="date" value={r.shin} onChange={e=>up(r.rid,"shin",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace"}}/></td>
              <td style={td}><input type="date" value={r.kei} onChange={e=>up(r.rid,"kei",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace"}}/></td>
              <td style={td}><select value={r.parent||""} onChange={e=>up(r.rid,"parent",e.target.value)} style={{...inp, width:110}}>
                <option value="">（なし）</option>
                {regs.filter(x=>x.rid!==r.rid&&x.id).map(x=><option key={x.rid} value={x.id}>{x.id}</option>)}
              </select></td>
              <td style={td}><button onClick={()=>del(r.rid)} style={iconBtn}><Trash2 size={14} color={RED}/></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </EditorShell>
  );
}

// ===== 認可書実績編集（型式 × 法規 グリッド）=====
export function CertEditor({ typeIds, regs, cert, setCert, colorOf }) {
  const set=(typeId,regId,val)=>setCert(c=>{
    const next={...c, [typeId]:{...(c[typeId]||{})}};
    if (val) next[typeId][regId]=val; else delete next[typeId][regId];
    return next;
  });
  if (typeIds.length===0 || regs.length===0)
    return <Empty msg="型式ランと法規を入力すると、ここで認可書番号を型式×法規で入力できます。" />;
  return (
    <div>
      <p style={{ color:MUTE, fontSize:12, lineHeight:1.7, margin:"0 0 4px" }}>
        指定装置一覧＝認可書実績の入力。型式 × 法規に認可書番号を入れる（継続ランは型式の実績を共有）。空欄＝実績なし。
      </p>
      <p style={{ color:"#6b7d90", fontSize:10.5, margin:"0 0 14px" }}>※段階2では、この欄を指定装置一覧ファイルから自動で埋める設計（次の相談）。</p>
      <div style={{ background:PANEL, borderRadius:12, padding:14, border:`1px solid ${LINE}`, overflowX:"auto" }}>
        <table style={{ borderCollapse:"separate", borderSpacing:5, width:"100%" }}>
          <thead><tr>
            <th style={{ textAlign:"left", padding:"4px 8px", fontSize:10.5, color:MUTE }}>法規 \ 型式</th>
            {typeIds.map(t=>(
              <th key={t} style={{ padding:"4px 6px", minWidth:150 }}>
                <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                  <span style={{ width:7,height:7,borderRadius:2,background:colorOf(t) }}/>
                  <span style={{ fontFamily:"ui-monospace,monospace", fontSize:12.5, color:"#eef4fa", fontWeight:700 }}>{t}</span>
                </span>
              </th>))}
          </tr></thead>
          <tbody>
            {/* React行キーは rid（cert の参照先は r.id のまま） */}
            {regs.map(r=>(
              <tr key={r.rid}>
                <td style={{ padding:"4px 8px" }}><span style={{ fontSize:12, color:"#eef4fa", fontWeight:600 }}>{r.id}</span></td>
                {typeIds.map(t=>(
                  <td key={t} style={{ padding:0 }}>
                    <input value={cert[t]?.[r.id]||""} placeholder="認可書番号" onChange={e=>set(t,r.id,e.target.value)}
                      style={{ width:"100%", background:cert[t]?.[r.id]?"rgba(63,191,143,0.08)":"transparent", border:`1px solid ${cert[t]?.[r.id]?GREEN:LINE}`, borderRadius:6, color:"#bfe9d8", fontSize:10, fontFamily:"ui-monospace,monospace", padding:"7px 8px", boxSizing:"border-box" }}/>
                  </td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===== 保存ステータス表示 =====
function SaveStatus({ save }) {
  const m = {
    loading:  { c: MUTE,  t: "読み込み中…" },
    saving:   { c: AMBER, t: "保存中…" },
    saved:    { c: GREEN, t: "サーバに保存済み" },
    // 初回読込に失敗＝保存自体を止めている（サーバ側データは保護される）
    loadError:{ c: RED,   t: "初回読込に失敗（保存は行われません）" },
    // 読込は成功したがPUTが失敗＝画面の変更がサーバに入っていない
    saveError:{ c: RED,   t: "保存に失敗（変更は未保存です）" },
  }[save];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, color:m.c }}>
      <span style={{ width:7, height:7, borderRadius:"50%", background:m.c }} />{m.t}
    </span>
  );
}

// ===== 共通パーツ =====
function EditorShell({ title, desc, onAdd, addLabel, children }) {
  return (
    <div>
      <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:12 }}>
        <div style={{ flex:1 }}>
          <h2 style={{ fontSize:14, fontWeight:700, margin:"0 0 3px", color:"#eef4fa" }}>{title}</h2>
          <p style={{ color:MUTE, fontSize:11.5, margin:0, lineHeight:1.6 }}>{desc}</p>
        </div>
        <button onClick={onAdd} style={btn(CYAN)}><Plus size={13}/> {addLabel}</button>
      </div>
      <div style={{ background:PANEL, borderRadius:12, padding:14, border:`1px solid ${LINE}`, overflowX:"auto" }}>{children}</div>
    </div>
  );
}
function Empty({ msg }) {
  return <div style={{ background:PANEL, border:`1px dashed ${LINE}`, borderRadius:12, padding:"40px 20px", textAlign:"center", color:MUTE, fontSize:12.5 }}>{msg}</div>;
}
function Note({ color, children }) {
  return <div style={{ flex:"1 1 300px", background:`${color}0d`, border:`1px solid ${color}33`, borderRadius:9, padding:"8px 12px", fontSize:11.5, lineHeight:1.6 }}>{children}</div>;
}
function Badge({ kind }) {
  const isNew=kind==="新型";
  return <span style={{ fontSize:8.5, fontWeight:700, padding:"0px 4px", borderRadius:3, marginLeft:2, color:isNew?"#0c1623":"#fff", background:isNew?CYAN:"rgba(157,140,255,0.85)" }}>{kind}</span>;
}
function Leg({ c, t }) {
  return <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}><span style={{ width:10,height:10,borderRadius:3,background:c,opacity:0.85 }}/>{t}</span>;
}
function Card({ title, icon, children }) {
  return <div style={{ background:PANEL, border:`1px solid ${LINE}`, borderRadius:12, padding:"13px 15px" }}>
    <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:9 }}>{icon}<h3 style={{ fontSize:12.5, fontWeight:700, margin:0, color:"#eef4fa" }}>{title}</h3><span style={{ flex:1, height:1, background:LINE }}/></div>
    {children}</div>;
}
function fmt(d){ return d ? d.replaceAll("-","/").slice(0,7) : "—"; }
export const btn=(c,ghost)=>({ display:"inline-flex", alignItems:"center", gap:5, background:ghost?"transparent":c, color:ghost?"#aab8c6":"#0c1623", border:ghost?`1px solid ${LINE}`:"none", borderRadius:7, padding:"6px 12px", fontSize:12, fontWeight:600, cursor:"pointer" });
const tbl={ borderCollapse:"collapse", width:"100%" };
const th={ textAlign:"left", padding:"6px 8px", fontSize:10.5, color:MUTE, fontWeight:600, borderBottom:`1px solid ${LINE}` };
const td={ padding:"5px 8px", borderBottom:`1px solid ${LINE}` };
const inp={ background:"#0c1623", border:`1px solid ${LINE}`, borderRadius:6, color:"#cdd9e5", fontSize:11.5, padding:"6px 8px", width:130, boxSizing:"border-box" };
const iconBtn={ background:"transparent", border:"none", cursor:"pointer", padding:4 };
