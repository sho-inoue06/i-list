// 規制再判定のデータ（F-04）：比較元（bases）と同一性（sameness）、比較元の連鎖と根拠（basisOf）。

import { fmt } from "./labels.js";
import { dateDayNumber } from "./dates.js";
import { nowStamp } from "./decisions.js";
import { effectiveSideOf, evalCellWith } from "./decide.js";

// ───────────────────────────────────────────────
// 規制再判定のデータ（F-04）：比較元（bases）と同一性（sameness）
//
// 過渡規定：規制日後の型式指定でも、規制日前に指定を受けた比較元と当該装置の性能が
// 同一なら継続車側の規制日を適用できる。同一でなくなれば新型車側の規制日へ切り替わる。
//
// decisions（人の適用判断）とは別のデータとして持つ。車名・車種名は持たない（会社ルール）。
//
// 比較元（bases）… 型式ラン1件につき0〜1件。
//   { runKey, baseRunKey, decidedAt }
//   ・候補は「同じプロジェクトコード（run.gen、空は対象外）で、型式が違うラン」。人が1件選んで確定する。
//   ・レコードが無い＝未選択。選び直すと上書き、「未選択」に戻すとレコードを消す。
//   ・比較元のランが削除・改名されて候補の条件を外れたら「無効」と表示し、同一性の判定には使わない。
//
// 同一性（sameness）… 型式ラン×法規行（runKey × rid）ごと。
//   { runKey, rid, value, reason, decidedAt, needsRecheck, baseRunKey }
//     value        … "未確認" / "同一" / "同一でない"（レコードが無い＝未確認）
//     decidedAt    … 同一／同一でないを確定した端末時刻。未確認は ""
//     needsRecheck … 要再確認。いちど立つと、同一性を答え直して確定したときにだけ下りる
//     baseRunKey   … 回答した時点の比較元（スナップショット）。比較元が変わると、その回答は使わない
// ───────────────────────────────────────────────
export const SAMENESS_VALUES = ["未確認", "同一", "同一でない"];

// 比較元の候補：同じプロジェクトコード（空でない）・型式が違う・自分以外のラン。LO順に並べる。
export function baseCandidates(run, runs) {
  if (!run || run.gen === "") return [];
  return (runs || [])
    .filter((x) => x.key !== run.key && x.gen === run.gen && x.typeId !== run.typeId)
    .slice()
    .sort((a, b) => (a.lo || "").localeCompare(b.lo || ""));
}

// 比較元の状態。
//   none    … 未選択（レコードなし）
//   ok      … 選択済みで、いまも候補の条件を満たす
//   invalid … 選択済みだが、比較元が見つからない・候補の条件を外れた（判定には使わない）
export function baseOf(run, runs, bases) {
  const rec = (bases || []).find((b) => b.runKey === run?.key) || null;
  if (!rec) return { state: "none", rec: null, baseRun: null, baseRunKey: "" };
  const baseRun = (runs || []).find((x) => x.key === rec.baseRunKey) || null;
  const ok = !!baseRun && baseCandidates(run, runs).some((x) => x.key === baseRun.key);
  return ok
    ? { state: "ok", rec, baseRun, baseRunKey: baseRun.key }
    : { state: "invalid", rec, baseRun, baseRunKey: "" };
}

// 比較元の選択・変更・解除（"" で未選択に戻す）。
export function setBase(bases, runKey, baseRunKey, decidedAt = nowStamp()) {
  const rest = (bases || []).filter((b) => b.runKey !== runKey);
  return baseRunKey === "" ? rest : [...rest, { runKey, baseRunKey, decidedAt }];
}

// 同一性の答えで結論が変わらないセルか（やらないこと：LOが継続車日以降のランへの要再確認）。
// LO・継続車日の両方が正しい日付で、LO ≥ 継続車日なら、同一でも同一でなくても適用が必要になる。
// 日付が欠けている・不正なときは「変わりうる」側（要再確認を出す側）に倒す。
export function samenessMatters(run, reg) {
  const lo = dateDayNumber(run?.lo), kei = dateDayNumber(reg?.kei);
  return !(lo !== null && kei !== null && lo >= kei);
}

// 同一性の答え（同一／同一でない）で、判定が何か変わるセルか（2026-09-20 祥の判断）。
//
// evalCellWith を見ると、両者の違いは「新型車日 ≤ LO」が成り立つときだけ生まれる。
//   成り立つ   … 同一でない→要（種別「新型」・期日＝新型車日）／同一→継続車日で判定。種別も期日も変わる
//   成り立たない … 同一でない も継続車日へ落ちるので、同一とまったく同じ結論になる
// 後者は「そもそも新型車規制が適用されないラン」＝同一かどうかを聞く意味がないセルなので、
// 呼び出し側は同一性の行そのものを出さない（選ばせない）。
//
// これは samenessMatters（要再確認を立てるか＝要否が変わるか）とは別の判定である。
// LO ≥ 継続車日 のセルは要否こそ変わらないが期日は変わるため、ここでは true（選ばせる）になる。
//
// LOが未入力・不正な日付のときは「変わりうる」側（選ばせる側）に倒す。
// 比較は evalCellWith と同じ文字列比較にそろえる（判定と食い違わせないため）。
export function samenessAffects(run, reg) {
  if (dateDayNumber(run?.lo) === null) return true;
  return !!(reg?.shin && reg.shin <= run.lo);
}

export function samenessIndex(sameness) {
  const m = new Map();
  for (const s of sameness || []) {
    if (!m.has(s.runKey)) m.set(s.runKey, new Map());
    m.get(s.runKey).set(s.rid, s);
  }
  return m;
}
export const findSameness = (index, runKey, rid) => index.get(runKey)?.get(rid) || null;

// 判定に使う同一性。比較元が有効でなければ null（＝同一性を使わない。従来の新継どおり）。
// 回答した時の比較元といまの比較元が違う回答は使わず、未確認として扱う。
export function effectiveSameness(rec, base) {
  if (!base || base.state !== "ok") return null;
  if (!rec || rec.value === "未確認") return "未確認";
  return rec.baseRunKey === base.baseRunKey ? rec.value : "未確認";
}

// いま要再確認であるべき理由（保存済みのフラグとは別に、条件から導く）。
export function samenessRecheckReasons(rec, run, reg, base) {
  if (!rec || rec.value === "未確認" || !samenessMatters(run, reg)) return [];
  if (!base || base.state !== "ok") return ["比較元が未選択または無効です"];
  if (rec.baseRunKey !== base.baseRunKey) return ["回答した時から比較元が変わりました"];
  return [];
}

// 要再確認の掃き出し（立てるだけ。下ろさない）。変化が無ければ同じ配列参照を返す。
export function sweepSameness(sameness, runs, regs, bases) {
  const list = sameness || [];
  const runByKey = new Map((runs || []).map((r) => [r.key, r]));
  const regByRid = new Map((regs || []).map((r) => [r.rid, r]));
  let changed = false;
  const next = list.map((s) => {
    if (s.needsRecheck) return s;
    const run = runByKey.get(s.runKey), reg = regByRid.get(s.rid);
    if (!run || !reg) return s;
    if (samenessRecheckReasons(s, run, reg, baseOf(run, runs, bases)).length === 0) return s;
    changed = true;
    return { ...s, needsRecheck: true };
  });
  return changed ? next : list;
}

// セルの編集から保存する1件を作る。
//   action="save"      … 選んだ値で保存する。
//       値が保存済みと同じ … メモだけ保存（確定日時・比較元・要再確認は変えない）
//       値が変わった       … 同一でない／未確認へ変わったら要再確認を立てる。
//                            同一へ答え直したときは要再確認を下ろす（答え直して確定した）。
//   action="reconfirm" … 同一／同一でないを、いまの比較元に対して答え直して確定する（要再確認を下ろす）。
// 結論が変わらないセル（samenessMatters=false）では要再確認を立てない。
export function nextSamenessRecord({ rec, run, reg, base, value, reason, action = "save", now = nowStamp() }) {
  const stored = rec?.value || "未確認";
  const prevEffective = effectiveSameness(rec, base) || "未確認";
  const baseRunKey = base?.state === "ok" ? base.baseRunKey : "";
  const common = { runKey: run.key, rid: reg.rid, reason };
  if (action === "reconfirm") {
    return { ...common, value, decidedAt: now, needsRecheck: false, baseRunKey };
  }
  if (value === stored) {
    const b = rec || { value: "未確認", decidedAt: "", needsRecheck: false, baseRunKey: "" };
    return { ...common, value: b.value, decidedAt: b.decidedAt, needsRecheck: b.needsRecheck, baseRunKey: b.baseRunKey };
  }
  const raise = samenessMatters(run, reg) && value !== "同一" && value !== prevEffective;
  const needsRecheck = raise ? true : value === "同一" ? false : !!rec?.needsRecheck;
  return value === "未確認"
    ? { ...common, value, decidedAt: "", needsRecheck, baseRunKey: "" }
    : { ...common, value, decidedAt: now, needsRecheck, baseRunKey };
}

export function upsertSameness(sameness, next) {
  const list = sameness || [];
  const i = list.findIndex((s) => s.runKey === next.runKey && s.rid === next.rid);
  if (i === -1) return [...list, next];
  const out = list.slice();
  out[i] = next;
  return out;
}
// 情報を持たない同一性（未確認・理由空・要再確認なし）はレコード無しと同じなので書き出さない。
export const normalizeSameness = (sameness) =>
  (sameness || []).filter((s) => !(s.value === "未確認" && s.reason.trim() === "" && !s.needsRecheck));

// 行削除時の参照整合。比較元として参照されているランを消したときは、その比較元選択も消す
// （同一性の回答は残し、掃き出しで要再確認になる）。
export const pruneBasesByRun = (bases, runKey) =>
  (bases || []).filter((b) => b.runKey !== runKey && b.baseRunKey !== runKey);
export const pruneSamenessByRun = (sameness, runKey) => (sameness || []).filter((s) => s.runKey !== runKey);
export const pruneSamenessByReg = (sameness, rid) => (sameness || []).filter((s) => s.rid !== rid);

// 画面・集計から使うためのまとめ。bases/sameness が変わったときだけ作り直す想定。
export function makeSamenessContext(runs, bases, sameness) {
  const idx = samenessIndex(sameness);
  const baseCache = new Map();
  const base = (run) => {
    if (!baseCache.has(run.key)) baseCache.set(run.key, baseOf(run, runs, bases));
    return baseCache.get(run.key);
  };
  const rec = (run, reg) => findSameness(idx, run.key, reg.rid);
  const effective = (run, reg) => effectiveSameness(rec(run, reg), base(run));
  return { base, rec, effective };
}

// ───────────────────────────────────────────────
// 比較元の連鎖と根拠（F-12）
//
// 官報の言い方（「○年○月○日以前に指定を受けた自動車と、当該装置に変更がないもの」）に合わせると、
// 継続車適用日の猶予を使ってよい根拠は「その法規の新型車適用日以前に指定を受けた指定から、
// その装置が変更されていないこと」である。1つ前の型式ランは中継点にすぎず、根ではない。
//
// ここで足すのは判定ではなく **根拠をたどれること** だけ。
// 要否・期日・色・要再確認（F-04のA5）・黄色の予告（F-15）・人の判断・保存データ形式は一切変えない。
//
// ■ どのセルを対象にするか（B2・B5・B9）
// **「継続」表示＝猶予を借りている、ではない。** 新型車扱いでも継続車扱いでも要否が同じセルでは、
// 連鎖がつながっていようと切れていようと結論は動かない。そこへ警告を出すと、要否に影響しない
// 警告で画面が埋まる（停止①の現物確認で、LOが継続車日より後のセルにも根拠未確認が出て分かった）。
// そこで対象は、**継続車扱いにすることで要否が変わるセルだけ**とする。
//   ・要否は既存の判定式（evalCellWith）をそのまま2回使って比べる。F-12用の式は作らない。
//   ・さらに、そのセルが実際に継続車側で判定されていること（＝猶予を使っていること）も要る。
//     同一性が「同一でない」等で新型車側に決まっているセルは、猶予を使っていないので対象外
//     （そこが新しい連鎖の始点＝F-04のA4のままで、F-12は何も足さない）。
//
// ■ 連鎖の辺は2種類（B3）
//   (a) 同じ型式記号（typeId）の時間方向 … 型式記号が一致する「LOがより前のラン」へ自動でつなぐ（人の入力は要らない）
//   (b) 同一プロジェクト内で人が確定した比較元（F-04の bases） … 同一性の回答が「同一」のときだけ辺として使う
// **(a) があるときは (a) だけを使い、(b) へフォールバックしない**（直前の同一型式を飛ばして
// 都合のよい横比較へ逃げないための安全側ルール）。(b) は「その型式の最初のラン（前の指定が無い）」の辺になる。
//
// ■ 根（B4）：その法規の新型車適用日（shin）以前にLOを持つ型式ラン（LO ≤ shin）。
//   新型車適用日は法規ごとに違うので、同じ型式ランでも法規ごとに連鎖検証の要否が変わってよい。
//   F-12のNotionページはこの日付を「基準日 D」と呼ぶが、画面には「新型車適用日」と書く。
//   F-13で「基準日（＝今日）を選ぶ・固定する手段は持たない」と決めており、画面で語が二重になるため。
//   境界（LO＝新型車適用日ちょうど）は「以前」に含める＝根として扱う（法令用語の「以前」は当日を含む）。
//
// ■ 根拠未確認（B5）：対象セルで、連鎖の途中の同一性が「未確認」／LOが読めない／前段が見つからない／循環（B7）。
//   F-04のA5「要再確認」とは別の印として出す（混ぜると画面が要再確認だらけになるため）。
//   対象外のセルには根拠文も根拠未確認も出さない（B5・B8）。
// ───────────────────────────────────────────────
export const BASIS_STATES = ["対象外", "自分が根", "根到達", "根拠未確認"];

// (a) の辺：同じ型式記号（typeId）で、LOがより前のラン。
//   one       … 一意に決まった（自分より前のランのうち、LOが最も後のもの）
//   none      … 前のランが無い（その型式の最初のラン）
//   ambiguous … 一意に決められない（同じLOの候補が複数ある／同じ型式にLOが読めないランがある）
// 一意に決められないときは黙って1つ選ばず、根拠未確認へ倒す（任意の前段を選んで確定扱いにしない）。
export function chainPrevRun(run, runs) {
  // 型式記号が空のランは(a)の辺を作らない。空欄どうしを突き合わせても「同じ型式」とは確認できず、
  // 型式を特定できないデータから「変更なしで継続」と断定してしまう
  // （比較元の候補がプロジェクトコードの空欄を除くのと同じ扱い）。
  // 人が確定した比較元（(b)の辺）は、型式記号が空でも人の明示の回答なので従来どおり使える。
  if (!run?.typeId) return { state: "none", run: null, reason: "" };
  const self = dateDayNumber(run?.lo);
  if (self === null) return { state: "ambiguous", run: null, reason: "この型式ランのLOが読めない" };
  const mates = (runs || []).filter((x) => x && x.key !== run.key && x.typeId === run.typeId);
  if (mates.some((x) => dateDayNumber(x.lo) === null))
    return { state: "ambiguous", run: null, reason: "同じ型式にLOが読めないランがあり前段を決められない" };
  let best = null, bestDay = null, tie = false;
  for (const x of mates) {
    const d = dateDayNumber(x.lo);
    if (d >= self) continue;
    if (bestDay === null || d > bestDay) { best = x; bestDay = d; tie = false; }
    else if (d === bestDay) tie = true;
  }
  if (best === null) return { state: "none", run: null, reason: "" };
  if (tie) return { state: "ambiguous", run: null, reason: "同じLOの前のランが複数あり前段を決められない" };
  return { state: "one", run: best, reason: "" };
}

// 根（B3）。LO・新型車適用日のどちらかが読めなければ根としない（＝根拠未確認側へ倒す）。
export function isBasisRoot(run, reg) {
  const lo = dateDayNumber(run?.lo), shin = dateDayNumber(reg?.shin);
  if (lo === null || shin === null) return false;
  return lo <= shin;
}

// B2：継続車扱いにすることで要否が変わるセルか（反実仮想）。
// 既存の判定式（evalCellWith）を、同一性を「同一でない」＝新型車側・「同一」＝継続車側に固定して2回呼び、
// required（要か否か）だけを比べる。F-12のための判定式は作らない（二重管理をしないため）。
// cert は status／認可書番号にしか効かず required には関与しないので、ここでは空の認可書実績で呼ぶ。
const NO_CERT = Object.freeze([]);
export function graceChangesNeed(run, reg) {
  const asShin = evalCellWith(NO_CERT, run, reg, "同一でない");
  const asKei = evalCellWith(NO_CERT, run, reg, "同一");
  return asShin.required !== asKei.required;
}

// そのセルが「継続車適用日の猶予を使っている」か＝F-12の対象セルか（B2）。
//   1. いま継続車側で判定されている（新型車側に決まっているセルは猶予を使っていない）
//   2. 継続車扱いにすることで要否が変わる（両方「要」・両方「否」なら連鎖は結論を左右しない）
// 1は決定表の「実効の適用区分」そのものなので、決定表と同じ入口（effectiveSideOf）から読む
// （判定と食い違わせないため）。F-19 C3 により、比較元があって同一性が「未確認」のセルは
// 新型車側で判定される＝猶予を使っていないので、このセルは対象外になる。
export function usesGrace(run, reg, sameness) {
  return effectiveSideOf(run, sameness).side === "継" && graceChangesNeed(run, reg);
}

// セル（型式ラン × 法規）の根拠。判定には一切影響しない（表示と説明のためだけに使う）。
//   state … "対象外"（B2の対象でない＝猶予を使っていない／使っても要否が変わらない。何も出さない）
//           "自分が根"（この型式ラン自身のLOが新型車適用日以前＝自分の指定が根。対象セルでは境界の当日だけ起きる）
//           "根到達"（連鎖をたどって根に届いた）
//           "根拠未確認"（届かない／たどれない）
//   root  … 根の型式ラン（根到達・自分が根のときだけ）
//   hops  … 中継点の数（根到達のとき。自分と根の間に挟まったランの数）
//   path  … たどった型式ラン（先頭＝自分。根到達なら末尾＝根）
//   text  … B6の1行説明
// sameCtx は省略可（F-04の比較元・同一性を持たない版では (a) の辺だけで連鎖をたどる）。
export function basisOf(run, reg, runs, sameCtx = null) {
  const none = (reason) => ({ state: "対象外", reason, root: null, hops: 0, path: [], text: "" });
  const unknown = (reason, path) => ({
    state: "根拠未確認", reason, root: null, hops: Math.max(path.length - 1, 0), path,
    text: `根拠未確認：${reason}`,
  });
  const sameness = sameCtx ? sameCtx.effective(run, reg) : null;
  if (!usesGrace(run, reg, sameness)) {
    return none(graceChangesNeed(run, reg)
      ? "新型車日で判定しているため継続車適用日の猶予を使っていない"
      : "新型車日でも継続車日でも要否が同じため、連鎖は要否を左右しない");
  }
  if (dateDayNumber(reg.shin) === null) return unknown("法規の新型車適用日が読めない", [run]);

  const at = (x) => `${x.typeId}（${x.gen}）`;   // 連鎖のどの型式ランで止まったかを理由に入れる
  const path = [], visited = new Set();
  let node = run;
  for (;;) {
    if (visited.has(node.key)) return unknown(`連鎖が循環している（${at(node)}へ戻る）`, path);
    visited.add(node.key);
    path.push(node);
    if (dateDayNumber(node.lo) === null)
      return unknown(node.key === run.key ? "この型式ランのLOが読めない"
        : `連鎖の途中${at(node)}のLOが読めない`, path);
    if (isBasisRoot(node, reg)) {
      const hops = Math.max(path.length - 2, 0);
      return node.key === run.key
        ? { state: "自分が根", reason: "", root: node, hops: 0, path,
            text: `根拠：この型式ラン自身の指定（LO ${fmt(node.lo)}）が新型車適用日 ${fmt(reg.shin)} 以前（中継0件）` }
        : { state: "根到達", reason: "", root: node, hops, path,
            text: `根拠：${node.typeId}（${node.gen}・LO ${fmt(node.lo)}）の指定から変更なしで継続（中継${hops}件）` };
    }
    // 前段へ。(a) 同じ型式の時間方向を先に見る。
    const prev = chainPrevRun(node, runs);
    if (prev.state === "ambiguous") return unknown(`${at(node)}：${prev.reason}`, path);
    if (prev.state === "one") { node = prev.run; continue; }
    // (b) 同一プロジェクト内で人が確定した比較元。同一性が「同一」のときだけ辺として使う。
    const base = sameCtx ? sameCtx.base(node) : null;
    if (!base || base.state === "none") return unknown(`${at(node)}に前段が無い（前のランも比較元も無い）`, path);
    if (base.state === "invalid") return unknown(`${at(node)}の比較元が無効で前段をたどれない`, path);
    const v = sameCtx.effective(node, reg);
    if (v === "同一でない")
      return unknown(`${at(node)}が比較元と同一でない＝そこが新しい連鎖の始点になり、根まで届かない`, path);
    if (v !== "同一") return unknown(`${at(node)}の同一性が未確認`, path);
    node = base.baseRun;
  }
}

// 画面・検証から使うための索引。連結キーを作らず入れ子のMapにする（runKeyにどんな文字が入っても衝突しない）。
//
// 内側のキーは法規行そのもの（オブジェクト）にする。rid で覚えると、同じ行の日付を編集したときに
// 古い対象判定・根・説明を返してしまう（法規DBの編集は行オブジェクトを作り直すので、参照で持てば必ず作り直される）。
// 呼び出し側も runs だけでなく regs が変わったらこの索引を作り直すこと（StandaloneApp の useMemo 参照）。
export function makeBasisContext(runs, sameCtx = null) {
  const cache = new Map();
  return {
    of(run, reg) {
      if (!cache.has(run.key)) cache.set(run.key, new Map());
      const m = cache.get(run.key);
      if (!m.has(reg)) m.set(reg, basisOf(run, reg, runs, sameCtx));
      return m.get(reg);
    },
  };
}
