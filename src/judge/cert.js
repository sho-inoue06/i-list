// 認証実績（cert）の保存単位：型式ラン × 法規行で1件。引く・書き換える・移し替える・行の削除に追従する。

// ───────────────────────────────────────────────
// 認証実績（cert）の保存単位（F-22）
//
// 認証実績は「型式ラン × 法規行」で1件持つ。結合キーは run.key と reg.rid の2つ
// （人の適用判断 decisions・同一性 sameness と同じ単位・同じ持ち方）。
//
//   cert … 配列。1件＝{ runKey, rid, ck, planned }
//     runKey  … 型式ランの run.key
//     rid     … 法規行の内部キー reg.rid（利用者が入力する法規ID reg.id ではない）
//     ck      … 管理番号（文字列）。認可番号とPACT番号を区別せず1欄で持つ。空文字＝番号なし
//     planned … 取得予定（真偽値）。F-22では器だけ用意し、画面からは常に false のまま
//               （判定にも使わない。入力UIと表示はF-23）
//   レコードが無い＝番号なし・予定なし。組 (runKey, rid) の重複は持たない。
//
// runKey と rid を1本の文字列へ連結しない（run.key は外部JSON経由で任意の文字列になりうるため。
// decisions と同じ理由）。型式記号・法規IDは結合に使わないので、それらを変えても実績は付いてくる。
//
// 保存データの版（schemaVersion）
//   版なし … 旧形式。cert = { [typeId]: { [regId]: 認可番号(文字列) } }（型式 × 法規ID）
//   2      … この形式
// 旧形式は読み込み時に migrateLegacyCert で移し替える（下の規則）。
// ───────────────────────────────────────────────
// 版の値（SCHEMA_VERSION）は src/judge/data.js に置いている。

// 旧形式（型式 × 法規ID）から新形式（型式ラン × 法規行）への移し替え（F-22 A5）。
//   ・旧 cert[typeId][regId] の値を、その型式の *すべての* 型式ランへ複製する
//     （旧形式では同じ型式のランが全部同じ実績を読んでいたので、見え方がそのまま保たれる）。
//   ・同じ reg.id を持つ法規行が複数あれば、そのすべてへ複製する（旧形式でも全行が同じ値を読んでいた）。
//   ・付け先の型式ラン・法規行が無いエントリは破棄する（旧形式でも画面・判定のどこからも読まれていなかった）。
//   ・取得予定は全件 false で始まる（旧形式は予定を持たない）。
//   ・空文字の番号もそのまま移す（旧形式でも空文字は「実績なし」と読まれていた＝見え方は変わらない）。
// 同じ型式の中の複製だけで、別の型式の実績は読まない・写さない（決定B）。
// 並びは runs の順 × regs の順（入力が同じなら出力も同じ）。
// ※ SEED の組み立て（src/IListApp.jsx）からも呼ぶので、このファイルの後ろで定義する定数を参照しないこと。
export function migrateLegacyCert(legacy, runs, regs) {
  const out = [];
  const own = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
  for (const run of runs || []) {
    if (!own(legacy, run.typeId)) continue;
    const byReg = legacy[run.typeId];
    for (const reg of regs || []) {
      if (!own(byReg, reg.id)) continue;
      const ck = byReg[reg.id];
      if (typeof ck !== "string") continue;
      out.push({ runKey: run.key, rid: reg.rid, ck, planned: false });
    }
  }
  return out;
}

// (runKey, rid) で認証実績を引くための索引。decisionIndex と同じく入れ子のMapにする。
// 判定はセルごとに呼ばれるので、同じ配列に対しては1回だけ作って使い回す
// （state の配列は変更のたびに作り直されるので、配列そのものをキーにしてよい）。
const certIndexCache = new WeakMap();
export function certIndex(cert) {
  if (!Array.isArray(cert)) return new Map();
  let m = certIndexCache.get(cert);
  if (m) return m;
  m = new Map();
  for (const c of cert) {
    if (!m.has(c.runKey)) m.set(c.runKey, new Map());
    m.get(c.runKey).set(c.rid, c);
  }
  certIndexCache.set(cert, m);
  return m;
}
export function findCert(cert, runKey, rid) {
  return certIndex(cert).get(runKey)?.get(rid) || null;
}

// 管理番号を1件書き換える（認可書実績の編集画面）。
// 番号が空で予定も無いレコードは持たない（レコードが無い＝番号なし・予定なし）。
// 既存レコードは並びの位置を保ったまま書き換える。変化が無ければ同じ配列を返す。
export function setCertNumber(cert, runKey, rid, ck) {
  const list = Array.isArray(cert) ? cert : [];
  const i = list.findIndex((c) => c.runKey === runKey && c.rid === rid);
  if (i === -1) {
    if (ck === "") return list;
    return [...list, { runKey, rid, ck, planned: false }];
  }
  const cur = list[i];
  if (cur.ck === ck) return list;
  if (ck === "" && !cur.planned) return list.filter((_, j) => j !== i);
  const next = list.slice();
  next[i] = { ...cur, ck };
  return next;
}

// 行の削除と同じ操作で、その行を参照する認証実績を取り除く（F-22 A7）。変化が無ければ同じ配列を返す。
export const pruneCertByRun = (cert, runKey) => {
  const list = Array.isArray(cert) ? cert : [];
  return list.some((c) => c.runKey === runKey) ? list.filter((c) => c.runKey !== runKey) : list;
};
export const pruneCertByReg = (cert, rid) => {
  const list = Array.isArray(cert) ? cert : [];
  return list.some((c) => c.rid === rid) ? list.filter((c) => c.rid !== rid) : list;
};
