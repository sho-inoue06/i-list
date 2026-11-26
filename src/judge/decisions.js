// 人の適用判断・理由メモ（decisions）：判断レコードの持ち方・要再確認・確定日時の検証。

// ───────────────────────────────────────────────
// 人の適用判断・理由メモ（decisions）
//
// 自動の日程判定（evalCellWith）・黄色の接近予告（approachingNoticeFor）・
// 認証実績（cert。型式ラン × 法規行）とは完全に別のデータとして持つ。
// 判断の状態を予定・実績へ流用せず、判断が自動判定を上書きすることもない。
//
// 判断の単位＝「型式ラン × 法規行」。結合キーは run.key と reg.rid の2つ。
//   ・run.key … 外部JSON経由では「空でない一意な文字列」であればよく、"r"+数字とは限らない。
//   ・reg.rid … アプリが生成する内部キーで、必ず "g"+数字（parseImportedDataが強制する）。
// この2つを1本の文字列へ連結すると、run.key 側に区切り文字が入りうる。
// そのため decisions は「runKey と rid を別フィールドに持つ配列」とし、連結キーを作らない。
// 組 (runKey, rid) の重複は読込時に拒否する。
//
// 判断レコード：
//   { runKey, rid, state, reason, decidedAt, needsRecheck, cond }
//     state        … "未確認" / "対象" / "対象外"（レコードが無い＝未確認・理由空・日時空）
//     reason       … 自由記述。state="対象外" は空白のみ不可
//     decidedAt    … 対象／対象外を明示確定した端末時刻。未確認は ""
//     needsRecheck … 要再確認フラグ。判断3択とは別。いちど立つと人の明示再確定でしか下りない
//     cond         … 確定時の条件スナップショット（未確認は null）
// ───────────────────────────────────────────────
export const DECISION_STATES = ["未確認", "対象", "対象外"];
export const PARENT_LINKS = ["none", "one", "unresolved", "ambiguous"];


// 法規行の「親（シリーズアップ元）」の解決状態。
//
// reg.parent は親法規の *reg.id 文字列* を持つ（rid ではない）。
// reg.id は利用者が入力する値で空・重複がありうるため、親は一意に決まるとは限らない。
// 先頭一致や「最初に見つかった行」で親を決めない（任意の親を選んで確定扱いにしない）。
//
//   none       … 親指定なし（parent が空）
//   one        … parent と id が完全一致する行がちょうど1件＝一意に解決
//   unresolved … 親指定はあるが一致する行が無い（親の改名・削除で切れた）
//   ambiguous  … 一致する行が複数ある（どれが親か決められない）
// unresolved / ambiguous は「解決できていない」ことを表し、rid は空のままにする。
export function parentLinkOf(reg, regs) {
  const parent = typeof reg?.parent === "string" ? reg.parent : "";
  if (parent === "") return { link: "none", rid: "" };
  const list = Array.isArray(regs) ? regs : [];
  const hits = list.filter((x) => x && x.rid !== reg.rid && x.id === parent);
  if (hits.length === 1) return { link: "one", rid: hits[0].rid };
  if (hits.length === 0) return { link: "unresolved", rid: "" };
  return { link: "ambiguous", rid: "" };
}

// 判断を確定した時点の条件。ここに含めた項目が変わると要再確認になる。
//
// 含める（同一性・適用可否に効く）：
//   run … typeId / sk（新継） / lo / drop
//   reg … id（法規ID） / shin / kei / parent / 親の解決状態
// 含めない（表示名だけの変更）：
//   run.gen（プロジェクト/世代）、reg.label（名称）
// ※ 名称を変えて別プロジェクト・別法規へ行を流用する運用は想定しない（新規行を使う）。
export const COND_FIELDS = ["typeId", "sk", "lo", "drop", "regId", "shin", "kei", "parent", "parentLink", "parentRid"];
export function condOf(run, reg, regs) {
  const p = parentLinkOf(reg, regs);
  return {
    typeId: run?.typeId ?? "", sk: run?.sk ?? "", lo: run?.lo ?? "", drop: run?.drop ?? "",
    regId: reg?.id ?? "", shin: reg?.shin ?? "", kei: reg?.kei ?? "", parent: reg?.parent ?? "",
    parentLink: p.link, parentRid: p.rid,
  };
}
export function condEquals(a, b) {
  if (!a || !b) return false;
  return COND_FIELDS.every((f) => a[f] === b[f]);
}

// (runKey, rid) で判断を引くための索引。
// 連結キーを作らず入れ子のMapにするので、runKeyにどんな文字が入っていても衝突しない。
export function decisionIndex(decisions) {
  const m = new Map();
  for (const d of decisions || []) {
    if (!m.has(d.runKey)) m.set(d.runKey, new Map());
    m.get(d.runKey).set(d.rid, d);
  }
  return m;
}
export function findDecision(index, runKey, rid) {
  return index.get(runKey)?.get(rid) || null;
}

// この判断が「いま要再確認であるべき理由」。空配列＝理由なし。
// 未確認の判断は確定していないので対象外（要再確認という概念を持たない）。
export function recheckReasons(dec, run, reg, regs) {
  if (!dec || dec.state === "未確認") return [];
  if (!run || !reg) return [];
  const cur = condOf(run, reg, regs);
  const out = [];
  if (!dec.cond) out.push("確定した時の条件が記録されていません");
  else if (!condEquals(dec.cond, cur)) out.push("確定した時から条件が変わりました");
  // 親リンクが解決できていない状態は、条件が変わっていなくても可視化する
  // （どの法規を親として確定したのかを確かめられないため）。
  if (cur.parentLink === "unresolved") out.push("シリーズアップ元の法規が見つかりません");
  if (cur.parentLink === "ambiguous") out.push("シリーズアップ元の候補が複数あります");
  return out;
}

// 要再確認フラグの掃き出し。
//   ・立てるだけで、下ろすことは絶対にしない（＝条件が元に戻っても自動で解除されない）。
//   ・解除は人の明示再確定（saveDecision で対象／対象外を確定し直す）だけ。
// 変化が無ければ *同じ配列参照* を返す（呼び出し側が無限ループにならないように）。
export function sweepRecheck(decisions, runs, regs) {
  const list = decisions || [];
  const runByKey = new Map((runs || []).map((r) => [r.key, r]));
  const regByRid = new Map((regs || []).map((r) => [r.rid, r]));
  let changed = false;
  const next = list.map((d) => {
    if (d.state === "未確認" || d.needsRecheck) return d;
    const reasons = recheckReasons(d, runByKey.get(d.runKey), regByRid.get(d.rid), regs);
    if (reasons.length === 0) return d;
    changed = true;
    return { ...d, needsRecheck: true };
  });
  return changed ? next : list;
}

// 判断1件の登録・更新（同じ (runKey, rid) があれば置き換え、無ければ追加）。
export function upsertDecision(decisions, next) {
  const list = decisions || [];
  const i = list.findIndex((d) => d.runKey === next.runKey && d.rid === next.rid);
  if (i === -1) return [...list, next];
  const out = list.slice();
  out[i] = next;
  return out;
}

// 情報を持たない判断（未確認・理由空・要再確認なし・条件なし）を落とす。
// レコードが無い状態と意味が同じなので、書き出しに含めない。
export function normalizeDecisions(decisions) {
  return (decisions || []).filter(
    (d) => !(d.state === "未確認" && d.reason.trim() === "" && !d.needsRecheck && !d.cond)
  );
}

// 判断の確定日時（decidedAt）の受理規則。
//
// このアプリが生成するのは nowStamp() の "YYYY-MM-DD HH:MM" だけである（分精度・端末のローカル時刻、
// タイムゾーン表記なし）。したがって受理もこの形式ちょうどに限る。
// 前後の空白・秒付き・T区切り・桁の省略（2026-9-9 1:2）は受理しない。
// 「読めればよい」ではなく「このアプリが書いた値か」を確かめるための規則である。
//
// 実在性も見る。Date.parse の成否や Date の自動繰上がり（2026-02-30 → 03-02）に頼ると
// 存在しない日時を通してしまうため、月ごとの日数と閏年を自分で判定する。
//
// これは判断の確定日時だけの規則で、LO・ドロップ・新型／継続規制日など既存の日付欄の
// 受理仕様は変更しない（従来どおり文字列として受ける）。
const DECIDED_AT_FORMAT = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
export function isValidDecidedAt(value) {
  if (typeof value !== "string") return false;
  const m = DECIDED_AT_FORMAT.exec(value);
  if (!m) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const hour = Number(m[4]), minute = Number(m[5]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59) return false;
  return true;
}

// 判断が空でない理由を持つか（対象外の理由必須チェックに使う）
export const hasReason = (s) => typeof s === "string" && s.trim() !== "";

// 判断を確定した端末時刻。本人認証や監査証跡としては保証しない（端末の時計に依存する）。
export function nowStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 型式ラン／法規行を削除したときに、その行を参照する判断だけを取り除く。
// 参照整合性を保つためで、他の判断には触れない
// （通常編集で孤立参照を作ると、自分で書き出したJSONを読み戻せなくなる）。
export const pruneDecisionsByRun = (decisions, runKey) => (decisions || []).filter((d) => d.runKey !== runKey);
export const pruneDecisionsByReg = (decisions, rid) => (decisions || []).filter((d) => d.rid !== rid);

// 指定した型式ランの「確定した判断」だけを手動で要再確認にする。
// アプリに入力していない装備変更などは自動検知できないため、人が明示的に立てるための操作。
// 未確認の判断・他のランの判断には触れない。理由・確定日時・確定時条件は保持する。
export function markRunNeedsRecheck(decisions, runKey) {
  let changed = false;
  const next = (decisions || []).map((d) => {
    if (d.runKey !== runKey || d.state === "未確認" || d.needsRecheck) return d;
    changed = true;
    return { ...d, needsRecheck: true };
  });
  return changed ? next : decisions || [];
}
