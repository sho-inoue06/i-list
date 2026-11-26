// 読込の検証と採番：保存データの版（SCHEMA_VERSION）、サーバ応答の形の確認、キーの採番、
// 読み込んだJSONの検証（parseImportedData）と、その結果の反映（certOfLoaded・applyImported）。

import { migrateLegacyCert } from "./cert.js";
import { COND_FIELDS, DECISION_STATES, PARENT_LINKS, hasReason, isValidDecidedAt } from "./decisions.js";
import { SAMENESS_VALUES } from "./sameness.js";

// 保存データの版。版ごとの形は src/judge/cert.js 冒頭の「保存データの版（schemaVersion）」を参照。
export const SCHEMA_VERSION = 2;

// サーバ応答が期待するデータ形かを判定する（外側の形だけ）。受け付けるのは次の2つ：
//   版なし（旧形式） … { runs:[], regs:[], cert:{} }。cert は「nullでない・配列でないオブジェクト」
//     （配列も typeof は "object" になる。版なしで cert:[] を通すと、SEEDを保持したまま読込成功と誤認して保存に進む）
//   schemaVersion 2 … { schemaVersion:2, runs:[], regs:[], cert:[] }（F-22）
// それ以外の版は受け付けない（知らない版を旧形式として読み違えないため）。
export const isValidData = (d) => {
  if (!d || !Array.isArray(d.runs) || !Array.isArray(d.regs)) return false;
  if (d.schemaVersion === undefined) return typeof d.cert === "object" && d.cert !== null && !Array.isArray(d.cert);
  return d.schemaVersion === SCHEMA_VERSION && Array.isArray(d.cert);
};

const RID_FORMAT = /^g\d+$/;

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
// 法規行の内部キー（rid）。法規ID（id）は利用者が入力する表示用の値であり、
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
//   cert: 版なし（旧形式）… { [typeId]: { [regId]: 認可書番号(文字列) } } の2段の入れ子 → 読み込み時に移行する
//         schemaVersion 2 … [{ runKey, rid, ck, planned }]（F-22。validateCertRecords を参照）
//   key / id は行の同一性判定に使うため、重複していると更新・削除が誤動作する
//
// 空文字は許可する（編集で行を追加した直後は各欄が "" のため、正規の書き出しに含まれる）。
// 業務ルール（日付の妥当性や必須入力など）はここでは判定しない。無言の補正もしない。
// ───────────────────────────────────────────────
const RUN_FIELDS = ["key", "typeId", "gen", "sk", "lo", "drop"];
// 旧形式（版なし）の cert の形。問題があればエラー文、無ければ null。
export function validateLegacyCert(cert) {
  for (const [typeId, byReg] of Object.entries(cert)) {
    if (!byReg || typeof byReg !== "object" || Array.isArray(byReg)) {
      return `cert["${typeId}"] がオブジェクトではありません。`;
    }
    for (const [regId, ck] of Object.entries(byReg)) {
      if (typeof ck !== "string") return `cert["${typeId}"]["${regId}"] が文字列ではありません。`;
    }
  }
  return null;
}
// 版2の cert（型式ラン × 法規行のレコード配列）。問題があればエラー文、無ければ null。
//   ・各レコードは { runKey, rid, ck, planned } の4項目だけ（書き出して読み直したとき完全一致させるため、未知の項目を持ち込まない）
//   ・runKey / rid は存在する型式ラン・法規行を指す（孤立参照は勝手に修復せず拒否する。decisions と同じ）
//   ・組 (runKey, rid) の重複は拒否する
//   ・ck は文字列（空文字可・空白だけも可＝trimしない）、planned は真偽値
const CERT_FIELDS = ["runKey", "rid", "ck", "planned"];
export function validateCertRecords(cert, runKeys, regRids) {
  const seenByRun = new Map();
  for (let i = 0; i < cert.length; i++) {
    const c = cert[i];
    if (!c || typeof c !== "object" || Array.isArray(c)) return `cert[${i}] が認証実績オブジェクトではありません。`;
    const extra = Object.keys(c).filter((k) => !CERT_FIELDS.includes(k));
    if (extra.length) return `cert[${i}] に不明な項目があります（${extra.join(", ")}）。`;
    if (typeof c.runKey !== "string" || c.runKey === "") return `cert[${i}].runKey が文字列ではありません。`;
    if (typeof c.rid !== "string" || c.rid === "") return `cert[${i}].rid が文字列ではありません。`;
    if (!runKeys.has(c.runKey)) return `cert[${i}] が存在しない型式ラン "${c.runKey}" を参照しています。`;
    if (!regRids.has(c.rid)) return `cert[${i}] が存在しない法規行 "${c.rid}" を参照しています。`;
    if (!seenByRun.has(c.runKey)) seenByRun.set(c.runKey, new Set());
    if (seenByRun.get(c.runKey).has(c.rid)) return `cert に同じ型式ラン×法規行が重複しています（${c.runKey} × ${c.rid}）。`;
    seenByRun.get(c.runKey).add(c.rid);
    if (typeof c.ck !== "string") return `cert[${i}].ck が文字列ではありません。`;
    if (typeof c.planned !== "boolean") return `cert[${i}].planned が真偽値ではありません。`;
  }
  return null;
}

const REG_FIELDS = ["id", "label", "shin", "kei", "parent"];
// 画面の入力欄は文字列を書き込む。number等を無言で変換せず、文字列でなければ拒否する。
const isStr = (v) => typeof v === "string";

export function parseImportedData(d) {
  const err = (message) => ({ ok: false, error: message });
  if (!d || typeof d !== "object" || Array.isArray(d)) return err("JSONの中身がオブジェクトではありません。");
  if (!Array.isArray(d.runs)) return err("runs が配列ではありません。");
  if (!Array.isArray(d.regs)) return err("regs が配列ではありません。");
  // 保存データの版（F-22）。版が無ければ旧形式として読み、あとで cert を移行する。知らない版は読まない。
  const legacy = d.schemaVersion === undefined;
  if (!legacy && d.schemaVersion !== SCHEMA_VERSION) return err(`schemaVersion ${JSON.stringify(d.schemaVersion)} はこのアプリが読めない版です。`);
  if (legacy) {
    if (typeof d.cert !== "object" || d.cert === null || Array.isArray(d.cert)) return err("cert がオブジェクトではありません。");
  } else if (!Array.isArray(d.cert)) return err("cert が配列ではありません。");

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

  // cert
  //   旧形式：2段の入れ子と、認可書番号が文字列であること（移行はあとで rid を補ってから行う）
  //   版2  ：型式ラン × 法規行のレコード。decisions と同じく regs 全行に rid が必要
  if (legacy) {
    const bad = validateLegacyCert(d.cert);
    if (bad) return err(bad);
  } else {
    for (let i = 0; i < d.regs.length; i++) {
      if (d.regs[i].rid === undefined) {
        return err(`schemaVersion 2 のデータでは regs[${i}].rid が必要です（内部キーを補番して認証実績をつなぎ直すことはしません）。`);
      }
    }
    const bad = validateCertRecords(d.cert, runKeys, regRids);
    if (bad) return err(bad);
  }

  // decisions（人の適用判断）。
  //
  //   キーそのものが無い（旧形式）… 受理し「判断データなし」＝全件未確認として扱う。
  //     既存の runs/regs/cert・ID は作り直さない（rid の補完も従来どおり行う）。
  //   キーがあるのに壊れている  … ファイル全体を拒否する（現在のデータを部分置換しない）。
  //
  // 判断付きのデータでは regs 全行に rid が必要。rid が欠けているものを補番して埋めると、
  // 補われた rid と判断の参照が食い違い、既存の判断が別の法規行へ結び付く（誤結合）。
  // 補番でつなぎ直すことはせず、非破壊で拒否する。
  let decisions = [];
  if (d.decisions !== undefined) {
    if (!Array.isArray(d.decisions)) return err("decisions が配列ではありません。");
    for (let i = 0; i < d.regs.length; i++) {
      if (d.regs[i].rid === undefined) {
        return err(`decisions を含むデータでは regs[${i}].rid が必要です（内部キーを補番して判断をつなぎ直すことはしません）。`);
      }
    }
    // (runKey, rid) の重複は、runKeyごとのSetを入れ子にして見る（連結キーを作らない）
    const seenByRun = new Map();
    for (let i = 0; i < d.decisions.length; i++) {
      const rec = d.decisions[i];
      if (!rec || typeof rec !== "object" || Array.isArray(rec)) return err(`decisions[${i}] が判断オブジェクトではありません。`);
      if (!isStr(rec.runKey) || rec.runKey === "") return err(`decisions[${i}].runKey が文字列ではありません。`);
      if (!isStr(rec.rid) || rec.rid === "") return err(`decisions[${i}].rid が文字列ではありません。`);
      // 参照整合性：存在しない行を指す判断（孤立参照）は勝手に修復せず拒否する
      if (!runKeys.has(rec.runKey)) return err(`decisions[${i}] が存在しない型式ラン "${rec.runKey}" を参照しています。`);
      if (!regRids.has(rec.rid)) return err(`decisions[${i}] が存在しない法規行 "${rec.rid}" を参照しています。`);
      if (!seenByRun.has(rec.runKey)) seenByRun.set(rec.runKey, new Set());
      const ridsOfRun = seenByRun.get(rec.runKey);
      if (ridsOfRun.has(rec.rid)) return err(`decisions に同じ型式ラン×法規行の判断が重複しています（${rec.runKey} × ${rec.rid}）。`);
      ridsOfRun.add(rec.rid);

      if (!DECISION_STATES.includes(rec.state)) return err(`decisions[${i}].state が「未確認 / 対象 / 対象外」のいずれかではありません。`);
      if (!isStr(rec.reason)) return err(`decisions[${i}].reason が文字列ではありません。`);
      if (!isStr(rec.decidedAt)) return err(`decisions[${i}].decidedAt が文字列ではありません。`);
      if (typeof rec.needsRecheck !== "boolean") return err(`decisions[${i}].needsRecheck が真偽値ではありません。`);
      // 対象外は「空白だけでない理由」が必須。理由の無い対象外を受理しない
      if (rec.state === "対象外" && !hasReason(rec.reason)) {
        return err(`decisions[${i}] は「対象外」ですが理由がありません。`);
      }
      // 未確認は確定していないので、確定日時・確定時条件を持たない
      if (rec.state === "未確認" && (rec.decidedAt !== "" || rec.cond !== null)) {
        return err(`decisions[${i}] は「未確認」ですが確定日時または確定時条件を持っています。`);
      }
      // 対象／対象外は「いつ確定したか」が必ず要る。空・不正な形式・実在しない日時は受理しない
      // （形だけ確定済みで日時が空、という状態を読み込ませない）。
      if (rec.state !== "未確認" && !isValidDecidedAt(rec.decidedAt)) {
        return err(`decisions[${i}].decidedAt が確定日時の形式（YYYY-MM-DD HH:MM）でないか、実在しない日時です。`);
      }
      if (rec.cond !== null) {
        const c = rec.cond;
        if (!c || typeof c !== "object" || Array.isArray(c)) return err(`decisions[${i}].cond がオブジェクトでも null でもありません。`);
        for (const f of COND_FIELDS) {
          if (!isStr(c[f])) return err(`decisions[${i}].cond.${f} が文字列ではありません。`);
        }
        if (!PARENT_LINKS.includes(c.parentLink)) return err(`decisions[${i}].cond.parentLink の値が不正です。`);
        // 親が一意に解決できたときだけ rid を持つ。それ以外で rid を持たない
        // （＝任意の親を選んで「確定した」ことにしない）
        if (c.parentLink === "one") {
          if (!RID_FORMAT.test(c.parentRid)) return err(`decisions[${i}].cond.parentRid の形式が不正です。`);
        } else if (c.parentRid !== "") {
          return err(`decisions[${i}].cond.parentRid は親が一意に解決したときだけ設定できます。`);
        }
      }
    }
    decisions = d.decisions;
  }

  // bases（比較元・F-04）。キーが無い旧形式は「全ラン未選択」。キーがあって壊れていれば全体を拒否する。
  let bases = [];
  if (d.bases !== undefined) {
    if (!Array.isArray(d.bases)) return err("bases が配列ではありません。");
    const seen = new Set();
    for (let i = 0; i < d.bases.length; i++) {
      const b = d.bases[i];
      if (!b || typeof b !== "object" || Array.isArray(b)) return err(`bases[${i}] が比較元オブジェクトではありません。`);
      if (!isStr(b.runKey) || b.runKey === "") return err(`bases[${i}].runKey が文字列ではありません。`);
      if (!isStr(b.baseRunKey) || b.baseRunKey === "") return err(`bases[${i}].baseRunKey が文字列ではありません。`);
      if (!runKeys.has(b.runKey)) return err(`bases[${i}] が存在しない型式ラン "${b.runKey}" を参照しています。`);
      if (!runKeys.has(b.baseRunKey)) return err(`bases[${i}] の比較元が存在しない型式ラン "${b.baseRunKey}" です。`);
      if (b.runKey === b.baseRunKey) return err(`bases[${i}] は自分自身を比較元にしています。`);
      if (seen.has(b.runKey)) return err(`bases に同じ型式ランの比較元が重複しています（${b.runKey}）。`);
      seen.add(b.runKey);
      if (!isValidDecidedAt(b.decidedAt)) return err(`bases[${i}].decidedAt が確定日時の形式（YYYY-MM-DD HH:MM）でないか、実在しない日時です。`);
    }
    bases = d.bases;
  }

  // sameness（同一性・F-04）。キーが無い旧形式は「全件未確認」。
  // decisions と同じく regs 全行に rid が必要（補番でつなぎ直すと別の法規行へ結び付くため）。
  let sameness = [];
  if (d.sameness !== undefined) {
    if (!Array.isArray(d.sameness)) return err("sameness が配列ではありません。");
    for (let i = 0; i < d.regs.length; i++) {
      if (d.regs[i].rid === undefined) {
        return err(`sameness を含むデータでは regs[${i}].rid が必要です（内部キーを補番して同一性をつなぎ直すことはしません）。`);
      }
    }
    const seenByRun = new Map();
    for (let i = 0; i < d.sameness.length; i++) {
      const s = d.sameness[i];
      if (!s || typeof s !== "object" || Array.isArray(s)) return err(`sameness[${i}] が同一性オブジェクトではありません。`);
      if (!isStr(s.runKey) || s.runKey === "") return err(`sameness[${i}].runKey が文字列ではありません。`);
      if (!isStr(s.rid) || s.rid === "") return err(`sameness[${i}].rid が文字列ではありません。`);
      if (!runKeys.has(s.runKey)) return err(`sameness[${i}] が存在しない型式ラン "${s.runKey}" を参照しています。`);
      if (!regRids.has(s.rid)) return err(`sameness[${i}] が存在しない法規行 "${s.rid}" を参照しています。`);
      if (!seenByRun.has(s.runKey)) seenByRun.set(s.runKey, new Set());
      if (seenByRun.get(s.runKey).has(s.rid)) return err(`sameness に同じ型式ラン×法規行が重複しています（${s.runKey} × ${s.rid}）。`);
      seenByRun.get(s.runKey).add(s.rid);
      if (!SAMENESS_VALUES.includes(s.value)) return err(`sameness[${i}].value が「未確認 / 同一 / 同一でない」のいずれかではありません。`);
      if (!isStr(s.reason)) return err(`sameness[${i}].reason が文字列ではありません。`);
      if (!isStr(s.decidedAt)) return err(`sameness[${i}].decidedAt が文字列ではありません。`);
      if (typeof s.needsRecheck !== "boolean") return err(`sameness[${i}].needsRecheck が真偽値ではありません。`);
      // baseRunKey は回答時点のスナップショット。比較元のランが後で削除されてもよいので、存在までは求めない。
      if (!isStr(s.baseRunKey)) return err(`sameness[${i}].baseRunKey が文字列ではありません。`);
      if (s.value === "未確認") {
        if (s.decidedAt !== "" || s.baseRunKey !== "") return err(`sameness[${i}] は「未確認」ですが確定日時または比較元を持っています。`);
      } else {
        if (!isValidDecidedAt(s.decidedAt)) return err(`sameness[${i}].decidedAt が確定日時の形式（YYYY-MM-DD HH:MM）でないか、実在しない日時です。`);
        if (s.baseRunKey === "") return err(`sameness[${i}] は「${s.value}」ですが、回答した時の比較元がありません。`);
      }
    }
    sameness = d.sameness;
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
  // 同一性の「回答した時の比較元」（baseRunKey）は、比較元のランを削除した後も残るスナップショット。
  // この値を採番の底上げに含めないと、開き直した後に同じキーのランが再発行され、
  // 答え直していない過去の回答が新しいランを比較元にした途端に有効になってしまう。
  for (const s of sameness) {
    if (s.baseRunKey === "") continue;
    const k = keyNumberOf(s.baseRunKey, "r");
    if (!isUsableKeyNumber(k)) {
      return err(`sameness の比較元 "${s.baseRunKey}" は採番できる範囲を超えています。`);
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
  // 旧形式の cert は、rid を補った法規行を使って型式ラン × 法規行へ移す（F-22 A4・A5）。
  const cert = legacy ? migrateLegacyCert(d.cert, d.runs, planned.regs) : d.cert;

  return {
    ok: true,
    // decisions / bases / sameness が無い旧形式は空配列（＝全件未確認・比較元未選択）。runs/regs は従来どおりそのまま返す。
    // 返すデータは常に現行の版（旧形式は上で移行済み）なので、版番号を付けておく（そのまま書き出しても読み直せる形）。
    data: { schemaVersion: SCHEMA_VERSION, runs: d.runs, regs: planned.regs, cert, decisions, bases, sameness },
    maxId,
    maxRid: planned.maxRid,
  };
}

// API版（サーバ保存版）の読込で cert を現行形式にそろえる（F-22）。
// API版の読込は parseImportedData を通らない（runs/regs の受理条件は従来どおり緩い）ので、cert だけをここで検証・移行する。
//   版なし … 旧形式の形を確かめ、rid を補った法規行（regs）を使って移行する
//   版2   … レコードの形・参照先・重複を確かめ、そのまま使う
// 戻り値：{ ok:true, cert } / { ok:false, error }
export function certOfLoaded(d, regs) {
  if (d.schemaVersion === undefined) {
    if (typeof d.cert !== "object" || d.cert === null || Array.isArray(d.cert)) return { ok: false, error: "cert がオブジェクトではありません。" };
    const bad = validateLegacyCert(d.cert);
    if (bad) return { ok: false, error: bad };
    return { ok: true, cert: migrateLegacyCert(d.cert, d.runs, regs) };
  }
  if (d.schemaVersion !== SCHEMA_VERSION) return { ok: false, error: `schemaVersion ${JSON.stringify(d.schemaVersion)} はこのアプリが読めない版です。` };
  if (!Array.isArray(d.cert)) return { ok: false, error: "cert が配列ではありません。" };
  // 版2では法規行の全行に rid が要る（単体版の parseImportedData と同じ）。補番した rid で検証すると、
  // 元のデータでは結び付いていなかった実績が補番された法規行へ結び付いてしまう（Codexレビュー指摘2）。
  const noRid = d.regs.findIndex((r) => r?.rid === undefined);
  if (noRid !== -1) return { ok: false, error: `schemaVersion 2 のデータでは regs[${noRid}].rid が必要です（内部キーを補番して認証実績をつなぎ直すことはしません）。` };
  const bad = validateCertRecords(d.cert, new Set(d.runs.map((r) => r?.key)), new Set(regs.map((r) => r?.rid)));
  if (bad) return { ok: false, error: bad };
  return { ok: true, cert: d.cert };
}

// parseImportedData が確定させた採番情報を、置換が確定したあとに反映する。
// 置換確認と最新世代の確認を通過した「反映時だけ」呼ぶこと。
// runs 側(_id)と rid 側(_rid)の両方をまとめて整合させる。
export const applyImported = ({ maxId, maxRid }) => {
  if (typeof maxId === "number" && maxId > _id) _id = maxId;
  if (typeof maxRid === "number" && maxRid > _rid) _rid = maxRid;
};
