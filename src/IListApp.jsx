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
// 「今日」（F-13）。画面を開いた／再読み込みした時点の端末ローカル日付を使う。
// ・モジュール評価はページの読み込みごとに1回なので、TODAY＝そのページを開いた日になる。
// ・日をまたいで開きっぱなしの場合は自動更新しない（再読み込みで更新する）。
// ・基準日を選ぶ・保存する・固定する手段は、製品UI・保存データ・検証用設定のいずれにも持たない。
// ・期日との比較は「期日 ≤ 今日」で既発効／即対応／期限超過として扱う（当日から）。
// UTCではなく端末ローカルの暦日を使う（端末の時計に依存する。監査証跡としては保証しない）。
export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const TODAY = todayStr();

// ダミーデータ（架空の型式・法規・認可書番号。実車・実データとは無関係）
export const SEED = {
  // プロジェクトコードは任意の識別記号（000A・000B…）。世代・前後関係は表さない。
  //   000A：DEMO-0001 だけ
  //   000B：DEMO-0001 が続き、途中で DEMO-0002 が追加される（LOが違う）
  //   000C：両型式が続く。DEMO-0002 は装置変更で比較元と同一でなくなる
  //   001A：別系統の DEMO-0003、途中で DEMO-0004 が追加される
  runs:[
    {key:"r1",typeId:"DEMO-0001",gen:"000A",sk:"新",lo:"2017-07-01",drop:"2019-12-31"},
    {key:"r2",typeId:"DEMO-0001",gen:"000B",sk:"継",lo:"2020-01-01",drop:"2022-12-31"},
    {key:"r3",typeId:"DEMO-0002",gen:"000B",sk:"新",lo:"2021-04-01",drop:"2022-12-31"},
    {key:"r4",typeId:"DEMO-0001",gen:"000C",sk:"継",lo:"2023-01-01",drop:"2025-12-31"},
    {key:"r5",typeId:"DEMO-0002",gen:"000C",sk:"継",lo:"2023-01-01",drop:"2025-12-31"},
    {key:"r6",typeId:"DEMO-0003",gen:"001A",sk:"新",lo:"2026-01-01",drop:"2030-12-31"},
    {key:"r7",typeId:"DEMO-0004",gen:"001A",sk:"新",lo:"2027-01-01",drop:"2030-12-31"},
  ],
  regs:[
    {rid:"g1", id:"DEMO-REG-A",   label:"ダミー法規A",   shin:"2016-01-01",kei:"2018-01-01",parent:""},
    {rid:"g2", id:"DEMO-REG-A2",  label:"ダミー法規A SU",shin:"2024-06-01",kei:"2026-06-01",parent:"DEMO-REG-A"},
    {rid:"g3", id:"DEMO-REG-B",   label:"ダミー法規B（過渡規定の例）",shin:"2021-03-01",kei:"2023-10-01",parent:""},
    {rid:"g4", id:"DEMO-REG-C",   label:"ダミー法規C",   shin:"2025-01-01",kei:"2027-01-01",parent:""},
    {rid:"g5", id:"DEMO-REG-D",   label:"ダミー法規D",   shin:"2020-01-01",kei:"2022-01-01",parent:""},
    {rid:"g6", id:"DEMO-REG-E",   label:"ダミー法規E",   shin:"2028-01-01",kei:"2029-01-01",parent:""},
  ],
  cert:{
    "DEMO-0001": {"DEMO-REG-A":"DEMO*A00/00*01","DEMO-REG-B":"DEMO*B00/00*01","DEMO-REG-D":"DEMO*D00/00*01"},
    "DEMO-0002": {"DEMO-REG-A":"DEMO*A00/00*02","DEMO-REG-D":"DEMO*D00/00*02"},
    "DEMO-0003": {"DEMO-REG-A":"DEMO*A00/00*03","DEMO-REG-A2":"DEMO*A02/00*01","DEMO-REG-B":"DEMO*B00/00*02","DEMO-REG-D":"DEMO*D00/00*03","DEMO-REG-C":"DEMO*C00/00*01"},
    "DEMO-0004": {"DEMO-REG-A":"DEMO*A00/00*04","DEMO-REG-A2":"DEMO*A02/00*02","DEMO-REG-D":"DEMO*D00/00*04"},
  },
  // 比較元・同一性（F-04）の例。単体版の初期表示だけが使う（API版はこの2つを持たない）。
  //   r3×B 同一       … 継続車日を借りて「否」（新継どおりなら新型車日で既発効）
  //   r5×B 同一でない … 000Cで装置変更。新型車日（過去）で申請発生・期限超過
  //   r5×D 同一でない … LO≥継続車日なので結論は変わらず、要再確認も立たない（実績ありで緑。実績ありのセルは要再確認を出さない）
  //   r3×C 未確認     … 同一から未確認へ戻した例。実績が無いので要再確認が残っている
  //   r7×E 同一でない … 初回回答で要再確認が立った例。新型車の式だが継続車日で要になる
  //   r7×C 未確認     … 手を付けていない例（同一と答えると期日が変わる）
  bases:[
    {runKey:"r3",baseRunKey:"r2",decidedAt:"2026-09-19 10:00"},
    {runKey:"r5",baseRunKey:"r4",decidedAt:"2026-09-19 10:00"},
    {runKey:"r7",baseRunKey:"r6",decidedAt:"2026-09-19 10:00"},
  ],
  sameness:[
    {runKey:"r3",rid:"g3",value:"同一",reason:"ダミー：比較元と装置は同じ",decidedAt:"2026-09-19 10:05",needsRecheck:false,baseRunKey:"r2"},
    {runKey:"r5",rid:"g3",value:"同一でない",reason:"ダミー：000Cで装置を変更",decidedAt:"2026-09-19 10:06",needsRecheck:false,baseRunKey:"r4"},
    {runKey:"r5",rid:"g5",value:"同一でない",reason:"ダミー：LO≥継続車日なので結論は変わらない",decidedAt:"2026-09-19 10:07",needsRecheck:false,baseRunKey:"r4"},
    {runKey:"r3",rid:"g4",value:"未確認",reason:"ダミー：確認し直すため未確認に戻した",decidedAt:"",needsRecheck:true,baseRunKey:""},
    {runKey:"r7",rid:"g6",value:"同一でない",reason:"ダミー：初回の回答",decidedAt:"2026-09-19 10:08",needsRecheck:true,baseRunKey:"r6"},
  ],
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
//
// sameness（省略可）… 比較元との同一性（F-04）。省略・null・"未確認" のときは従来どおり run.sk で判定する。
//   "同一"       … 過渡規定で継続車側の規制日を適用する（継続ランと同じ式で判定）
//   "同一でない" … 新型車側の規制日を適用する（新型ランと同じ式で判定）
// 戻り値の applied は、同一性によって適用する側を決めたときだけ "継続車日" / "新型車日" を持つ（それ以外は ""）。
export const evalCellWith = (cert, run, r, sameness) => {
  const { lo, drop } = run;
  const applied = sameness==="同一" ? "継続車日" : sameness==="同一でない" ? "新型車日" : "";
  const sk = applied==="継続車日" ? "継" : applied==="新型車日" ? "新" : run.sk;
  let required=false, kind="";
  if (sk==="新") {
    if (r.shin && r.shin<=lo) { required=true; kind="新型"; }
    else if (r.kei && r.kei<=drop) { required=true; kind="継続"; }
  } else {
    if (r.kei && r.kei<=drop) { required=true; kind="継続"; }
  }
  const ck = cert[run.typeId]?.[r.id] || null;
  const status = !required ? "off" : ck ? "ok" : "leak";
  return { required, kind, ck, status, dueDate: kind==="新型" ? r.shin : r.kei, applied };
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
// samenessFor(run, reg) は省略可（F-04の同一性。省略時は従来どおり）。
export const summarize = (runs, regs, cert, samenessFor) => {
  const leaks=[], effDrop={};
  for (const run of runs) {
    let earliest=null;
    for (const r of regs) {
      const c = evalCellWith(cert, run, r, samenessFor ? samenessFor(run, r) : undefined);
      if (c.status==="leak") {
        leaks.push({ run, reg:r.id, kind:c.kind, dueDate:c.dueDate });
        if (!earliest || c.dueDate<earliest) earliest=c.dueDate;
      }
    }
    if (earliest) effDrop[run.key]=earliest;
  }
  return { leaks, effDrop };
};

// ───────────────────────────────────────────────
// 人の適用判断・理由メモ（decisions）
//
// 自動の日程判定（evalCellWith）・黄色の接近予告（approachingNoticeFor）・
// 認証実績（cert[typeId][reg.id]）とは完全に別のデータとして持つ。
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
const RID_FORMAT = /^g\d+$/;

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
//   reg … id（法規ID。cert の参照キーでもある） / shin / kei / parent / 親の解決状態
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

  return {
    ok: true,
    // decisions / bases / sameness が無い旧形式は空配列（＝全件未確認・比較元未選択）。既存3領域は従来どおりそのまま返す。
    data: { runs: d.runs, regs: planned.regs, cert: d.cert, decisions, bases, sameness },
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
        // ── API版への誤投入ガード ──
        // 単体版（サーバなし）で作ったJSONには decisions（人の適用判断）が入る。
        // API版は decisions を保存できない（サーバは runs/regs/cert しか持たない）ため、
        // そのまま取り込むと自動保存のPUTで判断が黙って捨てられる。
        // state を置き換える前に拒否する。ここで return するので
        //   ・setRuns/setRegs/setCert に到達しない＝stateが変わらない
        //   ・保存Effectが再実行されない＝この読込を原因とするPUTが発生しない
        // ただし、これは *いま動いているこのフロントエンド* の誤投入を止めるだけである。
        // 配布済みの古いビルド、curl等での直接PUT、サーバ側の検証は守れない。
        // 比較元（bases）・同一性（sameness）も単体版だけのデータなので同じ理由で拒否する。
        if (d && typeof d === "object" && !Array.isArray(d) &&
            (d.decisions !== undefined || d.bases !== undefined || d.sameness !== undefined)) {
          alert(
            "このファイルは単体版（サーバなし）の判断データ（適用判断・比較元・同一性）を含んでいます。\n" +
            "サーバ保存版はこれらを保存できないため、読み込みを中止しました。\n\n" +
            "（現在のデータは変更していません。単体版のHTMLで開いてください）"
          );
          return;
        }
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
// decisions / onSaveDecision / onRecheckRun は省略可能。
// 省略した場合（API版）は判断のUIを一切描画せず、従来どおりの帳票になる。
// ───────────────────────────────────────────────
// 帳票の列（型式ラン）表示フィルター（単体HTML版のみ・columnFilter プロップで有効化）
//
//   ・軸は2つ：プロジェクトコード（run.gen）／車両型式（run.typeId）。それぞれ複数選択。
//     欄内の複数選択は OR、プロジェクトコード欄と車両型式欄のあいだは AND。いずれも完全一致。
//   ・未選択の欄は「その項目の制限なし」。両欄未選択＝全件表示（初期状態）。
//   ・列＝型式ラン単位（run.key）。元の列順・法規行はそのまま。該当ランが複数でも全て表示。
//   ・選択候補は「元の全データ」から重複を除いて作る（表示中の列からではない）。
//   ・この絞り込みは表示だけ：runs/regs/cert/decisions を削らない・置換しない・dirty にしない。
//     保存形式へ追加しない（HTML/JSON には非表示列も含めた全データを保存する）。
//   ・成功した別データの読込（dataGen 進行）で条件を全解除。不正読込・置換キャンセルでは保持。
//   ・選択中の値が現データから消えても自動で外さない。「対象なし」と表示して手動解除できる。
// ───────────────────────────────────────────────
function ColumnFilterBar({ projectOptions, typeOptions, selProjects, setSelProjects, selTypes, setSelTypes, total, shown, active, onClearAll }) {
  const toggle = (list, setList, v) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const labelFor = (v) => (v === "" ? "（コード未設定）" : v);
  const row = (title, options, sel, setSel) => {
    const stale = sel.filter((v) => !options.includes(v));   // 選択済みだが現データに無い値も並べる（消さない）
    const chips = [...options, ...stale];
    return (
      <div style={{ display:"flex", alignItems:"baseline", gap:6, flexWrap:"wrap" }}>
        <span style={{ fontSize:10, color:MUTE, minWidth:92, flex:"none" }}>{title}</span>
        {chips.length === 0 && <span style={{ fontSize:10, color:MUTE }}>（候補なし）</span>}
        {chips.map((v) => {
          const on = sel.includes(v);
          const gone = !options.includes(v);
          return (
            <button key={"c:" + v} onClick={() => toggle(sel, setSel, v)}
              title={gone ? "この値は現在のデータにありません。押すと選択を解除できます。" : undefined}
              style={{ fontSize:10, padding:"2px 8px", borderRadius:999, cursor:"pointer", fontFamily:"inherit", lineHeight:1.4,
                border:`1px solid ${on ? CYAN : LINE}`,
                background: on ? "rgba(77,214,224,0.16)" : "transparent",
                color: gone ? MUTE : on ? "#dff6f8" : "#aab8c6",
                textDecoration: gone ? "line-through" : "none" }}>
              {labelFor(v)}{gone && "（対象なし）"}
            </button>
          );
        })}
      </div>
    );
  };
  return (
    <div style={{ background:PANEL, border:`1px solid ${LINE}`, borderRadius:10, padding:"9px 12px", marginBottom:10, display:"flex", flexDirection:"column", gap:6 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <span style={{ fontSize:10.5, fontWeight:700, color:"#eef4fa" }}>表示フィルター</span>
        {active
          ? <span style={{ fontSize:10, fontWeight:700, color:AMBER }}>絞り込み中：表示 {shown} ／ 全 {total} 列</span>
          : <span style={{ fontSize:10, color:MUTE }}>全 {total} 列を表示中</span>}
        <span style={{ flex:1 }} />
        <button onClick={onClearAll} disabled={!active}
          style={{ ...miniBtn, marginTop:0, cursor: active ? "pointer" : "default", opacity: active ? 1 : 0.5 }}>すべて表示</button>
      </div>
      {row("プロジェクトコード", projectOptions, selProjects, setSelProjects)}
      {row("車両型式", typeOptions, selTypes, setSelTypes)}
      <div style={{ fontSize:9, color:MUTE, lineHeight:1.55 }}>
        同じ欄の複数選択はどれかに一致（OR）、プロジェクトコードと車両型式のあいだは両方一致（AND）。完全一致で抽出します。
        絞り込みは表示中の列だけを変え、データ・保存・判断・集計には影響しません。
      </div>
    </div>
  );
}

// sameCtx / onSaveSameness は省略可能（F-04・単体版のみ）。省略時は同一性のUIを一切描画しない。
export function MatrixView({ runs, regs, evalCell, summary, colorOf, decisions, onSaveDecision, onRecheckRun, dataGen, columnFilter, sameCtx, onSaveSameness }) {
  // 黄色は status="off"（否）の表示だけを差し替える注記であり、要否判定(status)そのものは変えない。
  // ok（緑）・leak（赤）の判定・配色には一切関与しない（既存の赤警告を黄色で弱めないため）。
  // 人の適用判断もセルの色には一切関与しない（対象外を緑にしない・赤を消さない）。
  const cellStyle=(s, notice)=> s==="ok"?{bg:"rgba(63,191,143,0.13)",bd:GREEN,fg:GREEN}
    : s==="leak"?{bg:"rgba(255,107,87,0.16)",bd:RED,fg:RED}
    : notice?{bg:"rgba(224,178,77,0.14)",bd:AMBER,fg:AMBER}
    : {bg:"rgba(90,107,125,0.07)",bd:LINE,fg:MUTE};
  // 判断機能はpropsが渡されたときだけ有効（フックは常に同じ順序で呼ぶ）
  const judge = Array.isArray(decisions);
  const [editing, setEditing] = useState(null);     // { runKey, rid } | null
  // 編集領域の未保存の下書き（state/reason）。編集できるセルは常に1つなので1件だけ持つ。
  // これを MatrixView 側に置くことで、表示フィルターで編集中の列が一時的に隠れても
  // （MatrixView 自体はアンマウントされない）入力途中の理由・選択が保持され、再表示で戻る。
  // 保存対象データ・dirty には一切関与しない。明示保存／キャンセル／成功読込で捨てる。
  const [editDraft, setEditDraft] = useState(null); // { runKey, rid, state, reason } | null
  const decIndex = useMemo(() => decisionIndex(decisions || []), [decisions]);
  // データが丸ごと差し替わったら（＝読込が成功したら）開いている編集領域を閉じる。
  // 編集領域は開いた時点の理由を自分の中に持つため、開いたまま置換すると
  // 古い理由を新しい判断へ書き戻せてしまう。
  // dataGen は「読込が成功したとき」だけ進む。不正ファイル・置換キャンセル・
  // 古い読込の破棄では進めないので、編集途中の入力は保たれる。
  // 同一性（F-04）の編集中セル。判断の編集とは別に持つ。
  // 判断と同じく、未保存の下書きは MatrixView 側に持つ（表示フィルターで列が隠れても残す）。
  // セル内で開く編集領域は常に1つ（判断を開けば同一性は閉じ、その逆も同じ）。
  const [editingSame, setEditingSame] = useState(null); // { runKey, rid } | null
  const [sameDraft, setSameDraft] = useState(null);     // { runKey, rid, value, reason } | null
  useEffect(() => { setEditing(null); setEditDraft(null); setEditingSame(null); setSameDraft(null); }, [dataGen]);

  // ── 列（型式ラン）表示フィルター ──
  // columnFilter は単体版だけが渡す。選択状態は単体版（StandaloneApp）が保持し、
  // タブ切替でこの部品がアンマウントされても選択が消えない。成功した別データ読込での全解除も単体版が行う。
  // ここでは「表示する列を選ぶ」だけ：runs/regs/cert/decisions・保存・dirty には一切触れない。
  const filterable = !!columnFilter;
  const selProjects = columnFilter?.selProjects || [];   // run.gen の完全一致（欄内OR）
  const selTypes = columnFilter?.selTypes || [];          // run.typeId の完全一致（欄内OR）
  // 選択候補は「元の全データ」から重複を除く（表示中の列からではない）
  const projectOptions = useMemo(() => [...new Set(runs.map((r) => r.gen))], [runs]);
  const typeOptions = useMemo(() => [...new Set(runs.map((r) => r.typeId))], [runs]);
  const filterActive = filterable && (selProjects.length > 0 || selTypes.length > 0);
  // 欄内OR・欄間AND・完全一致。未選択の欄は制限なし。列順は runs の順を保つ。
  // 同じ (gen, typeId) のランが複数あっても、条件に合えば全ランを残す（重複排除しない）。
  const visibleRuns = !filterActive ? runs : runs.filter((run) =>
    (selProjects.length === 0 || selProjects.includes(run.gen)) &&
    (selTypes.length === 0 || selTypes.includes(run.typeId)));

  if (runs.length===0 || regs.length===0) {
    // データが空でも、保持している列フィルターの選択は見せて手動解除できるようにする
    // （型式ラン・法規を全削除したあとに古い選択が残るケース。自動では解除しない）。
    if (filterable && (selProjects.length > 0 || selTypes.length > 0)) {
      return (
        <>
          <ColumnFilterBar
            projectOptions={projectOptions} typeOptions={typeOptions}
            selProjects={selProjects} setSelProjects={columnFilter.setSelProjects}
            selTypes={selTypes} setSelTypes={columnFilter.setSelTypes}
            total={runs.length} shown={0} active onClearAll={columnFilter.clear} />
          <Empty msg="型式ランと法規を入力すると、ここに適合・実績の帳票が出ます。" />
        </>
      );
    }
    return <Empty msg="型式ランと法規を入力すると、ここに適合・実績の帳票が出ます。" />;
  }
  return (
    <>
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:10 }}>
        <Note color={CYAN}><b style={{color:CYAN}}>新型</b> 要⇔(新型適用≤LO)or(継続適用≤ドロップ)　<b style={{color:CYAN}}>継続</b> 要⇔継続適用≤ドロップ</Note>
        <Note color={AMBER}><Pencil size={10} color={AMBER}/> 手入れ＝法規DB・実績　<Cpu size={10} color={GREEN}/> 自動＝要否・申請発生・実効ドロップ</Note>
      </div>
      {filterable && (
        <ColumnFilterBar
          projectOptions={projectOptions} typeOptions={typeOptions}
          selProjects={selProjects} setSelProjects={columnFilter.setSelProjects}
          selTypes={selTypes} setSelTypes={columnFilter.setSelTypes}
          total={runs.length} shown={visibleRuns.length}
          active={filterActive} onClearAll={columnFilter.clear} />
      )}
      {filterActive && visibleRuns.length === 0 ? (
        <div style={{ background:PANEL, border:`1px dashed ${LINE}`, borderRadius:12, padding:"22px 16px", textAlign:"center", color:MUTE, fontSize:12, lineHeight:1.8 }}>
          絞り込み条件に一致する型式ランがありません（<b style={{ color:AMBER }}>0 件</b>）。<br/>
          条件を変えるか、上の「すべて表示」で解除してください（自動では全件に戻しません）。
        </div>
      ) : (
      <div style={{ background:PANEL, borderRadius:12, padding:14, border:`1px solid ${LINE}`, overflowX:"auto" }}>
        <table style={{ borderCollapse:"separate", borderSpacing:5, width:"100%" }}>
          <thead><tr>
            <th style={{ textAlign:"left", padding:"4px 8px", fontSize:10.5, color:MUTE, minWidth:150 }}>法規 \ 型式ラン</th>
            {visibleRuns.map(run=>{ const col=colorOf(run.typeId); return (
              <th key={run.key} style={{ padding:"4px 6px", minWidth:138, verticalAlign:"top" }}>
                <div style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                  <span style={{ width:7,height:7,borderRadius:2,background:col }}/>
                  <span style={{ fontFamily:"ui-monospace, monospace", fontSize:12.5, color:"#eef4fa", fontWeight:700, borderBottom:`2px solid ${col}` }}>{run.typeId}</span>
                </div>
                <div style={{ fontSize:9.5, color:"#6b7d90", margin:"2px 0" }}>{run.gen}・{run.sk==="新"?"新型/指定":"継続/既指定"}</div>
                <div style={{ fontSize:9, color:MUTE, fontFamily:"ui-monospace,monospace" }}>LO {fmt(run.lo)}<br/>drop {fmt(run.drop)}</div>
                {sameCtx && <BaseLabel base={sameCtx.base(run)} />}
                {judge && onRecheckRun && (
                  <button onClick={()=>onRecheckRun(run.key)} style={miniBtn}
                    title="このランの確定した判断（対象／対象外）をまとめて要再確認にします。理由・確定日時は消えません。">
                    ⟳ 要再確認にする
                  </button>
                )}
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
                {visibleRuns.map(run=>{
                  const c=evalCell(run,r);
                  // 黄色は判定式(evalCellWith)の外で計算する注記。status="off"以外には出さない。
                  const notice = approachingNoticeFor(c.status, run, r);
                  const st=cellStyle(c.status, !!notice);
                  // 人の適用判断（propsが無ければ null のまま＝何も描画しない）
                  const dec = judge ? findDecision(decIndex, run.key, r.rid) : null;
                  const isEditing = judge && editing && editing.runKey===run.key && editing.rid===r.rid;
                  // 同一性（F-04）：比較元を選んだランの列だけに印を出す
                  const base = sameCtx ? sameCtx.base(run) : null;
                  // 比較元が未選択でも、回答や要再確認が残っているセルには出す（警告を隠さない）
                  const sameRec = sameCtx ? sameCtx.rec(run, r) : null;
                  const showSame = !!base && (base.state!=="none" ||
                    (!!sameRec && (sameRec.needsRecheck || sameRec.value!=="未確認")));
                  const isEditingSame = showSame && editingSame && editingSame.runKey===run.key && editingSame.rid===r.rid;
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
                        <span style={{ fontSize:9, color:"#ffb3a8" }}>{c.dueDate<=TODAY?"既発効・即対応":`${fmt(c.dueDate)}までに`}</span></>}
                      {showSame && !isEditingSame &&
                        <SamenessLine rec={sameRec} run={run} reg={r} base={base} auto={c}
                          onOpen={base.state==="ok" ? ()=>{ setEditing(null); setEditDraft(null); setEditingSame({ runKey:run.key, rid:r.rid }); setSameDraft(null); } : null} />}
                      {isEditingSame &&
                        <SamenessEditor rec={sameRec} run={run} reg={r} base={base} hasCert={!!c.ck}
                          draft={sameDraft && sameDraft.runKey===run.key && sameDraft.rid===r.rid ? sameDraft : null}
                          onDraftChange={(d)=>setSameDraft({ runKey:run.key, rid:r.rid, ...d })}
                          onCancel={()=>{ setEditingSame(null); setSameDraft(null); }}
                          onSave={(rec)=>{ onSaveSameness(rec); setEditingSame(null); setSameDraft(null); }} />}
                      {judge && !isEditing &&
                        <DecisionLine dec={dec} run={run} reg={r} regs={regs}
                          onOpen={()=>{ setEditingSame(null); setSameDraft(null); setEditing({ runKey:run.key, rid:r.rid }); setEditDraft(null); }} />}
                      {isEditing &&
                        <DecisionEditor run={run} reg={r} regs={regs} dec={dec} auto={c} notice={notice}
                          draft={editDraft && editDraft.runKey===run.key && editDraft.rid===r.rid ? editDraft : null}
                          onDraftChange={(d)=>setEditDraft({ runKey:run.key, rid:r.rid, ...d })}
                          onCancel={()=>{ setEditing(null); setEditDraft(null); }}
                          onSave={(rec)=>{ onSaveDecision(rec); setEditing(null); setEditDraft(null); }} />}
                    </div>
                  </td>);})}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <div style={{ display:"flex", gap:16, marginTop:10, fontSize:10.5, color:MUTE, flexWrap:"wrap", alignItems:"center" }}>
        <Leg c={GREEN} t="要・認可書あり"/><Leg c={RED} t="要・実績なし＝申請発生"/><Leg c={MUTE} t="否＝対象外"/>
        <Leg c={AMBER} t="否・ドロップ後30日以内に継続規制＝要再確認"/>
        <span style={{ display:"inline-flex", gap:5 }}><Badge kind="新型"/>指定で適合<Badge kind="継続"/>継続対応</span>
      </div>
      {judge && (
        <div style={{ marginTop:8, fontSize:10.5, color:"#8fa3b8", lineHeight:1.75, background:`${JUDGE}0d`, border:`1px solid ${JUDGE}33`, borderRadius:9, padding:"8px 12px" }}>
          各セルの<b style={{color:"#eef4fa"}}>上段＝自動判定</b>（日程と認可書実績から計算）、
          <b style={{color:JUDGE}}>下段「人：」＝人の適用判断</b>です。判断は型式ラン×法規行ごとに独立し、他のランへ引き継ぎません。
          <b>人の判断で自動判定・警告が消えることはありません</b>（対象外にしても適合確認済みの緑にはなりません）。<br/>
          アプリに入力していない装備変更などは自動検知できません。必要なときは各ランの見出しにある「⟳ 要再確認にする」で明示的に立ててください。
          <span style={{ display:"inline-flex", alignItems:"center", gap:8, flexWrap:"wrap", marginTop:6 }}>
            <span style={{ color:MUTE }}>下段の見分け：</span>
            <DecisionTag state="対象" /><DecisionTag state="対象外" /><DecisionTag state="未確認" />
            <RecheckBadge /><span style={{ color:MUTE }}>＝判断とは別の警告</span>
          </span>
        </div>
      )}
      {sameCtx && (
        <div style={{ marginTop:8, fontSize:10.5, color:"#8fa3b8", lineHeight:1.75, background:`${SAME}0d`, border:`1px solid ${SAME}33`, borderRadius:9, padding:"8px 12px" }}>
          <b style={{color:SAME}}>「同一性：」</b>は比較元（型式ランタブで選ぶ・同じプロジェクト内の別型式）と当該装置の性能が同一かの回答です。比較元を選んだランの列にだけ出ます。
          <b style={{color:"#eef4fa"}}>同一</b>＝継続車側の規制日を適用、<b style={{color:"#eef4fa"}}>同一でない</b>＝新型車側の規制日を適用、未確認＝従来どおり新継で判定します。
          同一でない・未確認に変わると<b>要再確認</b>になり、メモの保存では消えず、同一性を答え直して確定したときだけ消えます。認可書の実績があるセルには要再確認を出しません。
          <span style={{ display:"inline-flex", alignItems:"center", gap:8, flexWrap:"wrap", marginTop:6 }}>
            <span style={{ color:MUTE }}>見分け：</span>
            <SamenessTag value="同一" /><SamenessTag value="同一でない" /><SamenessTag value="未確認" />
          </span>
        </div>
      )}
      {filterActive && (
        <div style={{ marginTop:14, fontSize:10, color:MUTE, lineHeight:1.6 }}>
          下の<b style={{ color:"#8fa3b8" }}>コンプラ漏れ・実効ドロップは全体集計</b>です（表示フィルターの影響を受けず、全 {runs.length} 列を対象にします）。
        </div>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:13, marginTop:filterActive?8:22 }}>
        <Card title="コンプラ漏れ（自動検出）" icon={<AlertTriangle size={15} color={RED}/>}>
          {summary.leaks.length===0 ? <p style={{ color:GREEN, fontSize:12.5, margin:0 }}>漏れなし。</p> :
            summary.leaks.map((l,i)=>(
              <div key={i} style={{ fontSize:12, padding:"5px 0", borderBottom:i<summary.leaks.length-1?`1px solid ${LINE}`:"none" }}>
                <span style={{ fontFamily:"ui-monospace,monospace", color:"#eef4fa" }}>{l.run.typeId}</span>
                <span style={{ color:"#6b7d90", fontSize:11 }}>（{l.run.gen}）</span> × <span style={{ color:"#eef4fa" }}>{l.reg}</span>
                <Badge kind={l.kind}/><span style={{ color:"#ffb3a8", fontSize:11 }}> {l.dueDate<=TODAY?"既発効・即対応":fmt(l.dueDate)+"までに"}</span>
              </div>))}
        </Card>
        <Card title="実効ドロップ（規制で縛られる期限）" icon={<Activity size={15} color={CYAN}/>}>
          {Object.keys(summary.effDrop).length===0 ? <p style={{ color:GREEN, fontSize:12.5, margin:0 }}>計画ドロップまで作れる。</p> :
            Object.entries(summary.effDrop).map(([k,d],i,arr)=>{ const run=runs.find(x=>x.key===k); const risk=d<run.drop; return (
              <div key={k} style={{ fontSize:12, padding:"5px 0", borderBottom:i<arr.length-1?`1px solid ${LINE}`:"none" }}>
                <span style={{ fontFamily:"ui-monospace,monospace", color:"#eef4fa" }}>{run.typeId}</span>
                <span style={{ color:"#6b7d90", fontSize:11 }}>（{run.gen}）</span>
                <span style={{ color:risk?RED:MUTE }}> 実効 {d<=TODAY?"既発効":fmt(d)}</span>
                <span style={{ color:MUTE, fontSize:11 }}>（計画 {fmt(run.drop)}）</span>
                {risk && <span style={{ color:RED, fontSize:10 }}> ← 早まる</span>}
              </div>);})}
        </Card>
      </div>
    </>
  );
}

// ===== 同一性（F-04）：列見出しの比較元・セル内の表示と編集 =====
// 色は自動判定（赤・緑・黄）とも人の適用判断（紫）とも別系統にする。
export const SAME = "#6db5ff";
const SAMENESS_TAG = {
  "同一":       { fg:"#e3f0ff", bg:"rgba(109,181,255,0.22)", border:`1px solid ${SAME}`,    radius:999 },
  "同一でない": { fg:"#ffe2dc", bg:"rgba(9,16,26,0.82)",     border:"1.5px solid #ff9e7d", radius:3   },
  "未確認":     { fg:"#9aabbd", bg:"rgba(12,20,32,0.55)",    border:`1px dashed ${MUTE}`,  radius:999 },
};
export function SamenessTag({ value }) {
  const t = SAMENESS_TAG[value] || SAMENESS_TAG["未確認"];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", lineHeight:1.15, fontSize:9.5, fontWeight:700,
      color:t.fg, background:t.bg, border:t.border, borderRadius:t.radius, padding:"0 4px", whiteSpace:"nowrap" }}>{value}</span>
  );
}

// 列見出しの「比較元」表示。未選択の列には何も出さない（従来の見出しのまま）。
function BaseLabel({ base }) {
  if (!base || base.state === "none") return null;
  if (base.state === "invalid") {
    return <div style={{ fontSize:9, color:AMBER, marginTop:3 }}>⚠ 比較元が無効（型式ランタブで選び直し）</div>;
  }
  return (
    <div style={{ fontSize:9, color:SAME, marginTop:3 }}>
      比較元 <span style={{ fontFamily:"ui-monospace,monospace", fontWeight:700 }}>{base.baseRun.typeId}</span>
    </div>
  );
}

// 「同一でない」は新型ランの式で判定する。この式は 新型車日≤LO でなければ 継続車日≤drop で要否を決めるため、
// 実際に要になった日付の種類（auto.kind）で表示し、継続車日で要のセルを「新型車日を適用」と書かない。
const appliedText = (auto, eff) =>
  auto.applied === "継続車日" ? "継続車日を適用"
  : auto.applied === "新型車日"
    ? (!auto.required ? "新型車の式で判定"
      : auto.kind === "新型" ? "新型車日を適用"
      : "新型車の式で判定・継続車日で要")
  : eff === "未確認" ? "新継どおり" : "";

// セル内の「同一性：」行。
function SamenessLine({ rec, run, reg, base, auto, onOpen }) {
  const eff = effectiveSameness(rec, base);          // 無効な比較元なら null
  const shown = eff ?? "未確認";
  const stale = !!rec && rec.value !== "未確認" && eff === "未確認";
  const live = samenessRecheckReasons(rec, run, reg, base);
  // 認可書の実績があるセルでは要再確認を出さない（記録上のフラグは残す。実績を消すとまた出る）
  const recheck = !auto.ck && (!!rec?.needsRecheck || live.length > 0);
  // 同一でない→新型車日で、適用日が今日以前なのに実績がない＝期限超過（要再確認の有無と関係なく出す）
  const overdue = auto.applied === "新型車日" && auto.status === "leak" && auto.dueDate && auto.dueDate <= TODAY;
  return (
    <div style={{ borderTop:`1px dashed ${LINE}`, marginTop:5, paddingTop:4, display:"flex", flexDirection:"column", gap:3 }}>
      <div style={{ display:"flex", alignItems:"center", gap:4, flexWrap:"wrap" }}>
        <span style={{ fontSize:9, color:MUTE, flex:"none" }}>同一性：</span>
        <SamenessTag value={shown} />
        {recheck && <RecheckBadge />}
        <span style={{ flex:1, minWidth:4 }} />
        {onOpen && (
          <button onClick={onOpen} aria-label="同一性を編集" title="同一性を編集"
            style={{ display:"inline-flex", alignItems:"center", flex:"none", cursor:"pointer",
              background:`${SAME}1f`, border:`1px solid ${SAME}66`, borderRadius:5, color:SAME, lineHeight:0, padding:"2px 4px" }}>
            <Pencil size={11} color={SAME}/></button>
        )}
      </div>
      <span style={{ fontSize:9, color:"#8fa3b8", lineHeight:1.5 }}>
        {base.state === "invalid" ? "比較元が無効のため新継どおり"
          : base.state === "none" ? "比較元が未選択のため新継どおり（比較元を選び直して答え直すと要再確認が消えます）"
          : appliedText(auto, eff)}
        {auto.required && auto.applied && auto.dueDate ? ` ${fmt(auto.dueDate)}` : ""}
        {overdue && <b style={{ color:RED }}> 期限超過</b>}
        {stale && <span style={{ color:AMBER }}>（前の比較元への回答）</span>}
      </span>
    </div>
  );
}

// セルから開く同一性の編集領域。
function SamenessEditor({ rec, run, reg, base, hasCert, onSave, onCancel, draft, onDraftChange }) {
  const stored = rec?.value || "未確認";
  const [value, _setValue] = useState(draft?.value ?? stored);
  const [reason, _setReason] = useState(draft?.reason ?? (rec?.reason || ""));
  const setValue = (v) => { _setValue(v); onDraftChange?.({ value: v, reason }); };
  const setReason = (v) => { _setReason(v); onDraftChange?.({ value, reason: v }); };
  const live = samenessRecheckReasons(rec, run, reg, base);
  const recheck = !hasCert && (!!rec?.needsRecheck || live.length > 0);
  const same = value === stored;
  // 回答した時の比較元といまの比較元が違う回答（要再確認を立てないセルでも起こる）
  const stale = !!rec && rec.value !== "未確認" && base?.state === "ok" && rec.baseRunKey !== base.baseRunKey;
  const save = () => onSave(nextSamenessRecord({ rec, run, reg, base, value, reason }));
  const reconfirm = () => onSave(nextSamenessRecord({ rec, run, reg, base, value, reason, action: "reconfirm" }));
  return (
    <div style={{ marginTop:5, borderTop:`1px dashed ${LINE}`, paddingTop:6, display:"flex", flexDirection:"column", gap:6, textAlign:"left" }}>
      <div style={{ fontSize:9, color:MUTE, lineHeight:1.6 }}>
        <div><b style={{ color:"#eef4fa" }}>{run.typeId}</b> × <b style={{ color:"#eef4fa" }}>{reg.id||"（法規ID未入力）"}</b></div>
        <div>比較元 <b style={{ color:SAME }}>{base.baseRun.typeId}</b> と当該装置の性能は同一か</div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
        {SAMENESS_VALUES.map((v)=>(
          <label key={v} style={{ display:"flex", alignItems:"center", gap:5, fontSize:10.5, cursor:"pointer", fontWeight: value===v ? 700 : 400 }}>
            <input type="radio" name={`same-${run.key}-${reg.rid}`} checked={value===v} onChange={()=>setValue(v)} style={{ margin:0 }} />
            <SamenessTag value={v} />
            <span style={{ fontSize:9, color:MUTE }}>{v==="同一" ? "継続車日を適用" : v==="同一でない" ? "新型車日を適用" : "新継どおり"}</span>
          </label>
        ))}
      </div>
      <textarea value={reason} onChange={(e)=>setReason(e.target.value)}
        placeholder="理由・メモ（そのまま文字として保存されます）" rows={2}
        style={{ background:"#0c1623", border:`1px solid ${LINE}`, borderRadius:6, color:"#cdd9e5", fontSize:10.5, padding:"5px 6px", width:"100%", boxSizing:"border-box", resize:"vertical", fontFamily:"inherit" }} />
      {stale && !recheck && (
        <div style={{ fontSize:9, color:AMBER, lineHeight:1.6 }}>前の比較元への回答です。いまの比較元で答え直して確定すると判定に使われます。</div>
      )}
      {recheck && (
        <div style={{ fontSize:9, color:AMBER, lineHeight:1.6 }}>
          ⚠ 要再確認{live.length>0 && <>：{live.join("／")}</>}
          <div style={{ color:MUTE }}>メモの保存では消えません。同一性を答え直して確定すると消えます。</div>
        </div>
      )}
      {rec?.decidedAt && <div style={{ fontSize:9, color:MUTE }}>確定：{rec.decidedAt}</div>}
      <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
        <button onClick={save} style={miniBtn}>{same ? "メモを保存" : value==="未確認" ? "未確認に戻す" : "この回答で確定"}</button>
        {(recheck || stale) && same && value!=="未確認" &&
          <button onClick={reconfirm} style={{ ...miniBtn, borderColor:AMBER, color:AMBER }}>答え直して確定</button>}
        <button onClick={onCancel} style={miniBtn}>キャンセル</button>
      </div>
    </div>
  );
}

// ===== 人の適用判断：セル内の表示と編集 =====
// 判断の色は自動判定（赤・緑・黄）とは別系統にする。
// 「対象外＝適合確認済み」に見えてはいけないので、緑は絶対に使わない。
export const JUDGE = "#9d8cff";

// 人の適用判断（対象／対象外／未確認）をセル内で見分けるための小さなタグ。
//   ・「対象」「対象外」「未確認」の文字は必ず出す（色を読めない環境でも判別できる）。
//   ・色だけに頼らず、枠線の太さ・線種・角の形でも差をつける：
//       対象   … 紫系のピル（角丸・実線・淡い塗り）。JUDGE を基調にする。
//       対象外 … 対象とは別の寒色。角ばった箱＋太めの実線＋濃い下地で、対象と混同させない。
//       未確認 … 破線のピル。控えめだが読める灰色（文字を薄くしすぎない）。
//   ・セル背景（緑・赤・黄・暗色）に依らず読めるよう、タグ自身に下地・枠・明るい文字色を持たせる。
//   ・要再確認は判断状態とは独立した黄色（AMBER）の警告として別に描く（このタグでは扱わない）。
const DECISION_TAG = {
  "対象":   { fg:"#ece8ff", bg:"rgba(157,140,255,0.22)", border:`1px solid ${JUDGE}`,  radius:999 },
  "対象外": { fg:"#dce7f6", bg:"rgba(9,16,26,0.82)",     border:"1.5px solid #8ea6c8", radius:3   },
  "未確認": { fg:"#9aabbd", bg:"rgba(12,20,32,0.55)",    border:`1px dashed ${MUTE}`,  radius:999 },
};
export function DecisionTag({ state }) {
  const t = DECISION_TAG[state] || DECISION_TAG["未確認"];
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", lineHeight:1.15, letterSpacing:0.2,
      fontSize:9.5, fontWeight:700, color:t.fg, background:t.bg,
      border:t.border, borderRadius:t.radius, padding:"0 4px", whiteSpace:"nowrap",
    }}>{state}</span>
  );
}

// 要再確認バッジ（判断状態から独立した黄色の警告）。文言に「要再確認」を必ず含める。
export function RecheckBadge() {
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", gap:2, whiteSpace:"nowrap",
      fontSize:9, fontWeight:700, color:AMBER,
      background:`${AMBER}1f`, border:`1px solid ${AMBER}`, borderRadius:3, padding:"0 3px",
    }}><AlertTriangle size={9}/>要再確認</span>
  );
}

// 長い理由をセル内で1行に畳む（内容は変えない。全文は編集領域で見る）。
const oneLine = (s, max = 34) => {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
};

// セル下段の「人：」行。レコードが無ければ未確認として扱う。
function DecisionLine({ dec, run, reg, regs, onOpen }) {
  const state = dec?.state || "未確認";
  // 保存済みのフラグ（sticky）と、いま条件から導かれる理由の両方を見る。
  // 掃き出しEffectが走る前でも取りこぼさないため。
  const live = dec ? recheckReasons(dec, run, reg, regs) : [];
  const recheck = !!dec?.needsRecheck || live.length > 0;
  const reason = dec?.reason || "";
  return (
    <div style={{ borderTop:`1px dashed ${LINE}`, marginTop:5, paddingTop:4, display:"flex", flexDirection:"column", gap:3 }}>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        <span style={{ fontSize:9, color:MUTE, flex:"none" }}>人：</span>
        <DecisionTag state={state} />
        {recheck && <RecheckBadge />}
        <span style={{ flex:1, minWidth:4 }} />
        <button onClick={onOpen} aria-label="適用判断・理由メモを編集"
          style={{ display:"inline-flex", alignItems:"center", flex:"none", cursor:"pointer",
            background:`${JUDGE}1f`, border:`1px solid ${JUDGE}66`, borderRadius:5,
            color:JUDGE, lineHeight:0, padding:"2px 4px" }}
          title="適用判断・理由メモを編集"><Pencil size={11} color={JUDGE}/></button>
      </div>
      {hasReason(reason) && (
        <span style={{ fontSize:9, color:"#8fa3b8", lineHeight:1.5 }}>
          <span style={{ color:MUTE }}>理由：</span>{oneLine(reason)}
        </span>
      )}
    </div>
  );
}

// セルから開く小さな編集領域（新しいタブ・画面切替は作らない）。
//
// 保存の意味を2つに分ける（v0.1の「メモ編集だけでは日時を更新せず、再確認済みにもしない」）：
//   ・選んだ状態が保存済みと同じ  … 理由だけを保存する。確定日時・確定時条件・要再確認は触らない
//   ・選んだ状態が保存済みと違う  … 状態変更なので確定日時・確定時条件を更新する（未確認へ戻す場合は空にする）
// 要再確認の解除は「この内容で再確定」だけ。条件を元に戻す・メモを直す・読み直すでは解除されない。
function DecisionEditor({ run, reg, regs, dec, auto, notice, onSave, onCancel, draft, onDraftChange }) {
  const stored = dec?.state || "未確認";
  // 未保存の下書きがあれば（＝この列がフィルターで一時的に隠れて再表示された等）そこから復元する。
  // 無ければ保存済みの判断から開始する（従来どおり）。
  const [state, setState] = useState(draft?.state ?? stored);
  const [reason, setReason] = useState(draft?.reason ?? (dec?.reason || ""));
  const [msg, setMsg] = useState("");
  // 入力のたびに MatrixView 側の下書きへ写す（保存対象データ・dirty には触れない）。
  // 状態と理由は同時には変わらないので、変わっていない側は現在値をそのまま渡す。
  const changeState = (s) => { setState(s); setMsg(""); onDraftChange?.({ state: s, reason }); };
  const changeReason = (v) => { setReason(v); setMsg(""); onDraftChange?.({ state, reason: v }); };
  const live = dec ? recheckReasons(dec, run, reg, regs) : [];
  const recheck = !!dec?.needsRecheck || live.length > 0;
  const sameState = state === stored;

  const needReason = () => {
    if (state === "対象外" && !hasReason(reason)) {
      setMsg("「対象外」には理由が必要です（空白だけでは確定できません）。");
      return true;
    }
    return false;
  };
  const confirmRec = () => ({
    runKey: run.key, rid: reg.rid, state, reason,
    decidedAt: nowStamp(), needsRecheck: false, cond: condOf(run, reg, regs),
  });
  const save = () => {
    if (needReason()) return;
    if (sameState) {
      // メモだけの保存。確定日時・確定時条件・要再確認フラグは一切変えない。
      const base = dec || { runKey:run.key, rid:reg.rid, state:"未確認", reason:"", decidedAt:"", needsRecheck:false, cond:null };
      onSave({ ...base, reason });
    } else if (state === "未確認") {
      // 未確認へ戻す：理由は誤消去を避けて残し、有効な確定日時と確定時条件は空にする
      onSave({ runKey:run.key, rid:reg.rid, state:"未確認", reason, decidedAt:"", needsRecheck:false, cond:null });
    } else {
      onSave(confirmRec());
    }
  };
  const reconfirm = () => { if (!needReason()) onSave(confirmRec()); };

  const autoText = auto.status==="ok" ? `要・認可書あり（${auto.ck}）`
    : auto.status==="leak" ? "要・実績なし＝申請発生"
    : "否（日程上の適用対象外）";
  return (
    <div style={{ marginTop:5, borderTop:`1px dashed ${LINE}`, paddingTop:6, display:"flex", flexDirection:"column", gap:6, textAlign:"left" }}>
      <div style={{ fontSize:9, color:MUTE, lineHeight:1.6 }}>
        <div><b style={{ color:"#eef4fa" }}>{run.typeId}</b>（{run.gen||"—"}）× <b style={{ color:"#eef4fa" }}>{reg.id||"（法規ID未入力）"}</b></div>
        <div>自動：{autoText}{auto.required && auto.dueDate ? `／${auto.kind}適用 ${fmt(auto.dueDate)}` : ""}</div>
        {notice && <div style={{ color:AMBER }}>継続規制まで{notice.days}日（{fmt(notice.keiDate)}）</div>}
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
        {DECISION_STATES.map((s)=>(
          <label key={s} style={{ display:"flex", alignItems:"center", gap:5, fontSize:10.5, cursor:"pointer",
            fontWeight: state===s ? 700 : 400 }}>
            <input type="radio" name={`dec-${run.key}-${reg.rid}`} checked={state===s}
              onChange={()=>changeState(s)} style={{ margin:0 }} />
            <DecisionTag state={s} />{s==="対象外" && <span style={{ fontSize:9, color:MUTE }}>（理由必須）</span>}
          </label>
        ))}
      </div>

      <textarea value={reason} onChange={(e)=>changeReason(e.target.value)}
        placeholder="理由・メモ（そのまま文字として保存されます）" rows={3}
        style={{ background:"#0c1623", border:`1px solid ${LINE}`, borderRadius:6, color:"#cdd9e5", fontSize:10.5, padding:"5px 6px", width:"100%", boxSizing:"border-box", resize:"vertical", fontFamily:"inherit" }} />

      {recheck && (
        <div style={{ fontSize:9, color:AMBER, lineHeight:1.6 }}>
          ⚠ 要再確認{live.length>0 && <>：{live.join("／")}</>}
          {dec?.decidedAt && <div style={{ color:MUTE }}>前回の確定：{dec.decidedAt}（判断・理由は残しています）</div>}
        </div>
      )}
      {!recheck && dec?.decidedAt && <div style={{ fontSize:9, color:MUTE }}>確定：{dec.decidedAt}</div>}
      {msg && <div style={{ fontSize:9.5, color:RED }}>{msg}</div>}

      <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
        <button onClick={save} style={miniBtn}>{sameState ? "メモを保存" : state==="未確認" ? "未確認に戻す" : "この判断で確定"}</button>
        {recheck && sameState && state!=="未確認" &&
          <button onClick={reconfirm} style={{ ...miniBtn, borderColor:AMBER, color:AMBER }}>この内容で再確定</button>}
        <button onClick={onCancel} style={miniBtn}>キャンセル</button>
      </div>
      <div style={{ fontSize:8.5, color:MUTE, lineHeight:1.55 }}>
        人の判断は自動判定・認可書実績を書き換えません。装備変更などアプリに入力していない条件は自動検知できません。
      </div>
    </div>
  );
}

// ===== 型式ラン編集 =====
// onDeleteRun は省略可能。渡された場合、行の削除と同じ操作でその行を参照する判断も取り除く
// （参照整合性のため。既存の削除手順そのものは変えていない）。
// bases / onSetBase は省略可能（F-04・単体版のみ）。渡されたときだけ「比較元」列を出す。
export function RunsEditor({ runs, setRuns, colorOf, nextKey, onDeleteRun, bases, onSetBase }) {
  const withBase = Array.isArray(bases) && !!onSetBase;
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
  // 行の削除と、その行を参照する判断の削除は同じ操作で行う（同一イベント内でまとめて反映される）
  const del=(key)=>{ setRuns(rs=>rs.filter(r=>r.key!==key)); onDeleteRun?.(key); };
  return (
    <EditorShell title="型式ラン（型式 × プロジェクト）" desc="車両型式・プロジェクトコード・新継・LO・ドロップを入力。同じ型式を複数ランで使える（新→継など）。プロジェクトコードは任意の識別記号（世代・MC・継承関係は推測しない）。" onAdd={add} addLabel="ランを追加">
      <table style={tbl}>
        <thead><tr>{["型式","プロジェクトコード","新継","LO（生産開始）","ドロップ（生産終了）",...(withBase?["比較元（同じプロジェクト内）"]:[]),""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {runs.map(r=>(
            <tr key={r.key}>
              <td style={td}><div style={{ display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ width:8,height:8,borderRadius:2,background:colorOf(r.typeId) }}/>
                <input value={r.typeId} placeholder="DEMO-0001" onChange={e=>up(r.key,"typeId",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace", width:120}}/>
              </div></td>
              <td style={td}><input value={r.gen} placeholder="000A" onChange={e=>up(r.key,"gen",e.target.value)} style={inp}/></td>
              <td style={td}><select value={r.sk} onChange={e=>up(r.key,"sk",e.target.value)} style={{...inp, width:64}}><option value="新">新型</option><option value="継">継続</option></select></td>
              <td style={td}><input type="date" value={r.lo} onChange={e=>up(r.key,"lo",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace"}}/></td>
              <td style={td}><input type="date" value={r.drop} onChange={e=>up(r.key,"drop",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace"}}/></td>
              {withBase && <td style={td}><BaseSelect run={r} runs={runs} bases={bases} onSetBase={onSetBase} /></td>}
              <td style={td}><button onClick={()=>del(r.key)} style={iconBtn}><Trash2 size={14} color={RED}/></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </EditorShell>
  );
}

// 比較元の選択欄。候補は同じプロジェクトコードの別型式ラン（システムが出す）。選ぶと確定になる。
function BaseSelect({ run, runs, bases, onSetBase }) {
  const base = baseOf(run, runs, bases);
  const cands = baseCandidates(run, runs);
  const value = base.state === "none" ? "" : base.rec.baseRunKey;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
      <select value={value} aria-label="比較元" onChange={e=>onSetBase(run.key, e.target.value)}
        style={{ ...inp, width:170, color: base.state==="none" ? MUTE : base.state==="invalid" ? AMBER : SAME }}>
        <option value="">（未選択）</option>
        {base.state==="invalid" && <option value={value}>無効：{base.baseRun ? base.baseRun.typeId || value : value}</option>}
        {cands.map(x=><option key={x.key} value={x.key}>{x.typeId || "（型式未入力）"}　LO {x.lo || "—"}</option>)}
      </select>
      <span style={{ fontSize:9, color: base.state==="invalid" ? AMBER : MUTE }}>
        {base.state==="ok" ? `選択済み（${base.rec.decidedAt}）`
          : base.state==="invalid" ? "無効：同じプロジェクトの別型式ではありません"
          : run.gen==="" ? "プロジェクトコード未入力" : cands.length===0 ? "候補なし" : `候補 ${cands.length} 件`}
      </span>
    </div>
  );
}

// ===== 法規DB編集 =====
// onDeleteReg は省略可能（RunsEditor の onDeleteRun と同じ考え方）。
export function RegsEditor({ regs, setRegs, onDeleteReg }) {
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
  const del=(rid)=>{ setRegs(rs=>rs.filter(r=>r.rid!==rid)); onDeleteReg?.(rid); };
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
// 判断まわりの小さなボタン（帳票セル・列見出しで使う）
const miniBtn={ background:"transparent", border:`1px solid ${LINE}`, borderRadius:5, color:"#aab8c6",
  fontSize:9.5, padding:"3px 6px", cursor:"pointer", fontFamily:"inherit", lineHeight:1.3, marginTop:4 };
