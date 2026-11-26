import React, { useState, useMemo, useRef, useEffect } from "react";
import { AlertTriangle, ShieldCheck, Minus, Activity, Pencil, Cpu, Plus, Trash2, Download, Upload, Table2, Scale, FileCheck, HelpCircle } from "lucide-react";
// 判定・保存・読込の置き場は src/judge/（このファイルは画面の部品・IListApp 本体・初期ダミー・画面だけが使う色と書式を持つ）。

// ───────────────────────────────────────────────
// Iリスト 帳票アプリ（段階2：サーバ保存）
//   入力＝法規DB・型式ラン・認可書実績（人間が手入れ）／ 帳票＝自動算出
//   要否：新型ラン 要⇔(新型適用≤LO)or(継続適用≤ドロップ)、継続ラン 要⇔継続適用≤ドロップ
//   データは起動時にサーバ(SQLite)から読み込み、編集すると自動保存される
//   JSONの書き出し/読み込みはバックアップ・持ち運び用として残している
// ───────────────────────────────────────────────

// src/judge/ から読み、これまでどおり src/IListApp.jsx からも import できるように中継して export する。
import { GRAY, ORANGE, RED, TEXT, fmt } from "./judge/labels.js";
export { GRAY, ORANGE, RED, TEXT };
import { TODAY, dateDayNumber, todayStr } from "./judge/dates.js";
export { TODAY, dateDayNumber, todayStr };
import { certIndex, findCert, migrateLegacyCert, pruneCertByReg, pruneCertByRun, setCertNumber } from "./judge/cert.js";
export { certIndex, findCert, migrateLegacyCert, pruneCertByReg, pruneCertByRun, setCertNumber };
import {
  COND_FIELDS, DECISION_STATES, PARENT_LINKS, condEquals, condOf, decisionIndex, findDecision,
  hasReason, isValidDecidedAt, markRunNeedsRecheck, normalizeDecisions, nowStamp, parentLinkOf,
  pruneDecisionsByReg, pruneDecisionsByRun, recheckReasons, sweepRecheck, upsertDecision
} from "./judge/decisions.js";
export {
  COND_FIELDS, DECISION_STATES, PARENT_LINKS, condEquals, condOf, decisionIndex, findDecision,
  hasReason, isValidDecidedAt, markRunNeedsRecheck, normalizeDecisions, nowStamp, parentLinkOf,
  pruneDecisionsByReg, pruneDecisionsByRun, recheckReasons, sweepRecheck, upsertDecision
};
import {
  APPLIED_REGS, CELL_DISPLAYS, CERT_PLAN_STATES, COMPLIANCE_STATES, DEADLINE_KINDS,
  DROP_INPUT_STATES, EFFECTIVE_SIDES, PRODUCTION_PHASES, VEHICLE_APPLICATIONS, approachingKeiDays,
  approachingNoticeFor, certPlanOf, complianceOfDecision, complianceStateOf, deadlineOf,
  decideCell, dropInputStateOf, effectiveSideOf, evalCellInputs, evalCellWith, productionPhaseOf,
  summarize
} from "./judge/decide.js";
export {
  APPLIED_REGS, CELL_DISPLAYS, CERT_PLAN_STATES, COMPLIANCE_STATES, DEADLINE_KINDS,
  DROP_INPUT_STATES, EFFECTIVE_SIDES, PRODUCTION_PHASES, VEHICLE_APPLICATIONS, approachingKeiDays,
  approachingNoticeFor, certPlanOf, complianceOfDecision, complianceStateOf, deadlineOf,
  decideCell, dropInputStateOf, effectiveSideOf, evalCellInputs, evalCellWith, productionPhaseOf,
  summarize
};
import {
  BASIS_STATES, SAMENESS_VALUES, baseCandidates, baseOf, basisOf, chainPrevRun, effectiveSameness,
  findSameness, graceChangesNeed, isBasisRoot, makeBasisContext, makeSamenessContext,
  nextSamenessRecord, normalizeSameness, pruneBasesByRun, pruneSamenessByReg, pruneSamenessByRun,
  samenessAffects, samenessIndex, samenessMatters, samenessRecheckReasons, setBase, sweepSameness,
  upsertSameness, usesGrace
} from "./judge/sameness.js";
export {
  BASIS_STATES, SAMENESS_VALUES, baseCandidates, baseOf, basisOf, chainPrevRun, effectiveSameness,
  findSameness, graceChangesNeed, isBasisRoot, makeBasisContext, makeSamenessContext,
  nextSamenessRecord, normalizeSameness, pruneBasesByRun, pruneSamenessByReg, pruneSamenessByRun,
  samenessAffects, samenessIndex, samenessMatters, samenessRecheckReasons, setBase, sweepSameness,
  upsertSameness, usesGrace
};
import { RISK_KINDS, buildCellModel, riskOfCell, riskRunRows, riskSections } from "./judge/risk.js";
export { RISK_KINDS, buildCellModel, riskOfCell, riskRunRows, riskSections };
import {
  KeyLimitError, MAX_KEY_NUMBER, SCHEMA_VERSION, applyImported, bumpIdFrom, certOfLoaded,
  isValidData, nextKey, nextRegKey, parseImportedData, peekIds, planRegKeys, resetIds,
  validateCertRecords, validateLegacyCert
} from "./judge/data.js";
export {
  KeyLimitError, MAX_KEY_NUMBER, SCHEMA_VERSION, applyImported, bumpIdFrom, certOfLoaded,
  isValidData, nextKey, nextRegKey, parseImportedData, peekIds, planRegKeys, resetIds,
  validateCertRecords, validateLegacyCert
};
import { BOOT_DATA_END, BOOT_DATA_START, buildSavedHtml, readBootData, readTemplateHtml, replaceBootData } from "./judge/saved-html.js";
export { BOOT_DATA_END, BOOT_DATA_START, buildSavedHtml, readBootData, readTemplateHtml, replaceBootData };

export const INK="#0c1623", PANEL="#13202f", LINE="#22303f", CYAN="#4dd6e0", GREEN="#3fbf8f",
      MUTE="#5a6b7d", AMBER="#e0b24d";
export const PALETTE=[CYAN,"#9d8cff",AMBER,GREEN,"#ff9e7d","#6db5ff","#d98cff"];

// ───────────────────────────────────────────────
// SEEDの相対日付（F-20）。**組み込みのダミーデータだけ**が使う。
//
// 固定日付のダミーデータは、時間が経つと主要な業務状態が消える（F-10の一覧が
// 「危険な型式ランはありません」になる等）。そこで **SEEDの日付だけ** を
// 「今日から ±n 日」で組み立て、いつ開いても同じ業務状態が見えるようにする。
// 判定式・しきい値・抽出条件は一切変えていない（A6）。
//
//   ・効くのは SEED を使う新規起動だけ（A4）。埋め込み起動データ・読み込んだJSON・
//     既存のサーバDBは、それぞれの絶対日付をそのまま使い、ここを通らない。
//     空のサーバDBへ初回投入されたSEEDは、その時点の絶対日付として保存され、以後再計算されない。
//   ・Date.UTC が月・年・うるう年の繰り上がりを正規化するので、戻り値は必ず実在する日付になる（A3）。
//   ・同じ日に開き直せば同じ値になる（today が同じなら出力も同じ）。
//   ・起点は端末ローカル日付（TODAY）＝F-13の「今日」と同じ暦日。
// ───────────────────────────────────────────────
export function seedDate(offsetDays, today = TODAY) {
  const [y, m, d] = String(today).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return "";
  const t = new Date(Date.UTC(y, m - 1, d + offsetDays));
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}


// ダミーデータ（架空の型式・法規・認可書番号。実車・実データとは無関係）
//
// 日付はすべて seedDate（今日からの相対日数）で作る。括弧内の数字は「今日から何日」。
//
// ■ 型式ランと生産フェーズ（F-25：計10本。drop済み3・LO空1・現在LO〜将来LO 6。F-28で r11 を足して計11本）
//   r1  DEMO-0001 000A 新  LO −3300 / drop −2450  … drop済み（いちばん古い指定）
//   r2  DEMO-0001 000B 継  LO −2440 / drop −1350  … drop済み
//   r3  DEMO-0002 000B 新  LO −1990 / drop −1350  … drop済み（000Bで型式追加。比較元は選んでいない）
//   r4  DEMO-0001 000C 継  LO −1340 / drop +700   … 生産中
//   r5  DEMO-0002 000C 継  LO +60   / drop +1900  … 開発中（000Cで型式を戻す。装置変更で比較元と同一でない）
//   r6  DEMO-0003 001A 新  LO −190  / drop +150   … 生産中
//   r7  DEMO-0004 001A 新  LO +120  / drop +1550  … 開発中（LOがまだ来ていない）
//   r8  DEMO-0005 000C 新  LO −200  / drop +120   … 生産中（000Cで型式追加。REG-A2は比較元と同一）
//   r9  DEMO-0003 001B 継  LO 空    / drop 空     … LO未入力（次のプロジェクト。全法規が判定不能）
//   r10 DEMO-0004 001B 新  LO +500  / drop 空     … 開発中・drop未定（drop＝∞として判定）
//   r11 DEMO-0006 001A 新  LO −100  / drop +150   … 生産中（F-28。001Aで型式追加。人の対象外の例を置くため、期限超過2件・黄色予告1件を持つ）
//
// ■ 業務状態 → セルの対応表（A1）。**偶然そうなっているデータにしない。**
//   verify/seed-demo.html がこの表そのものを突き合わせ、崩れても増えてもFAILする（A8）。
//   1 現在法規不適合   … r6×REG-C（生産中・実績なし・期限を190日超過）＝危険一覧に「期限超過」で出る
//   2 黄色予告         … r6×REG-E（dropの15日後に継続車規制）＝危険一覧に「黄色予告」で出る
//   3 法規適合必要     … r7×REG-C・r7×REG-E ほか（要だが期限がまだ先＝橙「要対応」）
//                        ＝危険一覧に「期限前・未取得」で出る（F-26。開発中のランも含む）
//   4 過去に法規不適合 … r3×REG-B（規制日のあともドロップまで実績なしで生産していた。前例も比較元も無い）
//                        ＝マトリクスには灰色で残るが、drop済みなので一覧には出さない（F-26 A1）
//   5 実績あり         … DEMO-0001×REG-A が r1(000A)・r2(000B)・r4(000C) の3プロジェクトで緑（A5）ほか
//   6 否（通常）       … r1×REG-B など
//   単体版（F-23の前例あり）では、さらに次が出る：
//   7 引き継ぎ確認中   … r5×REG-B（比較元r4が同じ法規行に番号を持つ＝認可番号待ち。F-23 A2・A7）ほか
//                        ＝実績ありとして決定表へ渡るので一覧には出ない（F-26 B1）
//   8 判定不能         … r9 の全法規（LOが空）＝一覧には出ない
//   9 drop未定         … r10 の全法規（dropが空。F-24）＝要のセルは「期限前・未取得」で出る。黄色予告には出ない
//   10 取得予定あり    … r7×REG-E・r7×REG-C（実績なし・予定あり＝車両申請「発生する（計画済み）」）
//                        ＝「期限前・未取得」に「計画済み」の印つきで出る（F-26 A3）。
//                        r7×REG-C は対象外・要再確認でもあり、対象外の印と並ぶ（F-42 A5）
//   判定関数が返す状態が初期データに1件以上あることは verify/seed-demo.html の F-25 が確かめる。
//
// ■ 危険一覧（F-10・F-26）の3区分。期限超過と黄色予告は **r6 だけ** にしてある（F-25 A2）。
//   F-28 で r11 を足し、期限超過と黄色予告にも人の対象外の例を置けるようにした（r11 は r6 と同じ drop）。
//   黄色予告は「dropの30日以内に継続車規制日が来る」セルに出る仕様なので、
//   ドロップ直後に規制日が来るデータなら一覧に並ぶ。
//   それ自体は仕様どおりだが、**開発中の現物確認では主役（生産中の赤と予告）がぼやける**ため、
//   r6 以外のランのドロップは、どの法規の継続車規制日からも30日窓の外に置いてある。
//   ＝ いま30日窓に入りうる継続車規制日は REG-A2(+200)・REG-C(+5)・REG-E(+165) の3つで、
//      drop が窓に入るランは r6・r11（drop +150 と REG-E の +165）だけになる（r8 の drop +120 は REG-E まで45日）。
//   期限前・未取得は「要・実績なし・未超過」の全セルなので、開発中・生産中の多くのランに出る（F-26）。
//   drop済みのラン（r1〜r3）はどの区分にも出ない（F-26 A1）。
//
// ■ 認証実績は 型式ラン × 法規行 で持つ（F-22）。ダミーでは、同じ型式の全ランに同じ番号を入れてある
//   （F-22より前の「型式 × 法規で1つ」と同じ見え方。DEMO-0001×REG-A が3プロジェクトとも緑になる＝A5）。
//
// 「今日」を受け取る組み立て関数にしてある。**日付をここに直接書かないため**である
// （固定日付を1つ混ぜても、その日は正しく見えてしまい、翌日から静かに意味を失う）。
// 検証は別の「今日」で組み立て直し、全部の日付が同じだけ動くことを確かめられる（A3・A8）。
export function buildSeed(today = TODAY) {
  const d = (n) => seedDate(n, today);
  const seed = {
    // 保存データの版（F-22）。SEEDもそのまま読込検証を通る版2のデータにしておく。
    schemaVersion: SCHEMA_VERSION,
    // プロジェクトコードは任意の識別記号（000A・000B…）。世代・前後関係は表さない。
    //   000A：DEMO-0001 だけ
    //   000B：DEMO-0001 が続き、途中で DEMO-0002 が追加される（LOが違う）
    //   000C：DEMO-0001 が続き、DEMO-0005 が追加され、DEMO-0002 が装置を変えて戻る
    //   001A：別系統の DEMO-0003、途中で DEMO-0004 が追加される
    //   001B：001Aの次。DEMO-0003 はLO未定、DEMO-0004 はdrop未定
    runs:[
      {key:"r1", typeId:"DEMO-0001",gen:"000A",sk:"新",lo:d(-3300),drop:d(-2450)},
      {key:"r2", typeId:"DEMO-0001",gen:"000B",sk:"継",lo:d(-2440),drop:d(-1350)},
      {key:"r3", typeId:"DEMO-0002",gen:"000B",sk:"新",lo:d(-1990),drop:d(-1350)},
      {key:"r4", typeId:"DEMO-0001",gen:"000C",sk:"継",lo:d(-1340),drop:d(700)},
      {key:"r5", typeId:"DEMO-0002",gen:"000C",sk:"継",lo:d(60),   drop:d(1900)},
      {key:"r6", typeId:"DEMO-0003",gen:"001A",sk:"新",lo:d(-190), drop:d(150)},
      {key:"r7", typeId:"DEMO-0004",gen:"001A",sk:"新",lo:d(120),  drop:d(1550)},
      {key:"r8", typeId:"DEMO-0005",gen:"000C",sk:"新",lo:d(-200), drop:d(120)},
      {key:"r9", typeId:"DEMO-0003",gen:"001B",sk:"継",lo:"",      drop:""},
      {key:"r10",typeId:"DEMO-0004",gen:"001B",sk:"新",lo:d(500),  drop:""},
      {key:"r11",typeId:"DEMO-0006",gen:"001A",sk:"新",lo:d(-100), drop:d(150)},
    ],
    // 法規の日付も相対。新型車適用日（shin）と継続車適用日（kei）の間隔は法規ごとに変えてある。
    //   A  … どのランのLOより前に両方の日が来ている古い法規（実績で緑になる）
    //   A2 … Aの後継（parent=A）。新型車日は過去、継続車日はこれから（r8は同一で継続車日を借りて逃げる）
    //   B  … 000Bの型式追加をまたぐ法規（過渡規定の例。r3は比較元が無く過去に不適合、r5は比較元r4の番号待ち）
    //   C  … 生産中のランが取り漏らしている法規（新型車日は過去・継続車日は5日後）
    //   E  … これから来る法規（新型車日はr7のLOより後なので、r7には同一性を出さない）
    regs:[
      {rid:"g1", id:"DEMO-REG-A",   label:"ダミー法規A",   shin:d(-3400),kei:d(-2800),parent:""},
      {rid:"g2", id:"DEMO-REG-A2",  label:"ダミー法規A SU",shin:d(-700), kei:d(200),  parent:"DEMO-REG-A"},
      {rid:"g3", id:"DEMO-REG-B",   label:"ダミー法規B（過渡規定の例）",shin:d(-2000),kei:d(-1200),parent:""},
      {rid:"g4", id:"DEMO-REG-C",   label:"ダミー法規C",   shin:d(-300), kei:d(5),    parent:""},
      {rid:"g5", id:"DEMO-REG-D",   label:"ダミー法規D",   shin:d(-2400),kei:d(-1700),parent:""},
      {rid:"g6", id:"DEMO-REG-E",   label:"ダミー法規E",   shin:d(130),  kei:d(165),  parent:""},
    ],
    // 比較元・同一性（F-04）の例。単体版の初期表示だけが使う（API版はこの2つを持たない）。
    //   r8×A2 同一      … 継続車日を借りて「否」（新継どおりなら新型車日で期日到来＝生産中の不適合）
    //   r5×B 同一でない … 000Cで装置変更。新型車日（過去）で要。比較元r4に番号があるので単体版は認可番号待ち
    //   r5×D 同一でない … LO≥継続車日なので結論は変わらず、要再確認も立たない（実績ありで緑。実績ありのセルは要再確認を出さない）
    //   r7×B 同一でない … 初回回答で要再確認が立った例（同一と答えると継続車日へ、期日が変わる）
    //   r7×C 未確認     … 同一から未確認へ戻した例。実績が無いので要再確認が残っている
    //   記録を持たないセル（r5×A・r7×A・r8×A など）… 手を付けていない例。同一性：未確認・要再確認なし
    // ※ 同一性の行は「新型車日 ≤ LO」のセルにしか出ない（答えても結論が変わらないセルには出さない）。
    //    000CのE（r5・r8）、001AのE などは、比較元を選んでいても同一性の行が出ない。
    bases:[
      {runKey:"r5",baseRunKey:"r4",decidedAt:`${d(-3)} 10:00`},
      {runKey:"r7",baseRunKey:"r6",decidedAt:`${d(-3)} 10:00`},
      {runKey:"r8",baseRunKey:"r4",decidedAt:`${d(-3)} 10:00`},
    ],
    sameness:[
      {runKey:"r5",rid:"g3",value:"同一でない",reason:"ダミー：000Cで装置を変更",decidedAt:`${d(-3)} 10:06`,needsRecheck:false,baseRunKey:"r4"},
      {runKey:"r5",rid:"g5",value:"同一でない",reason:"ダミー：LO≥継続車日なので結論は変わらない",decidedAt:`${d(-3)} 10:07`,needsRecheck:false,baseRunKey:"r4"},
      {runKey:"r7",rid:"g3",value:"同一でない",reason:"ダミー：初回の回答",decidedAt:`${d(-3)} 10:08`,needsRecheck:true,baseRunKey:"r6"},
      {runKey:"r7",rid:"g4",value:"未確認",reason:"ダミー：確認し直すため未確認に戻した",decidedAt:"",needsRecheck:true,baseRunKey:""},
      {runKey:"r8",rid:"g2",value:"同一",reason:"ダミー：比較元と装置は同じ",decidedAt:`${d(-3)} 10:05`,needsRecheck:false,baseRunKey:"r4"},
    ],
  };
  // 認可書実績（F-22：型式ラン × 法規行）。
  // 番号は型式ごとに下の表で持ち、旧形式の移行と同じ規則（migrateLegacyCert）でその型式の全ランへ展開する。
  // こうしておくと、F-22の前（型式 × 法規で1つ）と見え方が1セルも変わらない（F-22 B1）。
  // DEMO-0003 は REG-C を取り漏らしている＝現在法規不適合の1件。
  // DEMO-0002 は REG-B を持たない＝r3 は過去に法規不適合、r5 は比較元の番号待ち。
  // DEMO-0005 は REG-A2 を持たない＝同一で継続車日を借りて逃げている（番号は比較元から写していない）。
  // DEMO-0006（F-28）は REG-B・D・E を持たない＝REG-B・D が期限超過、REG-E が黄色予告（人の対象外の例を置く先）。
  seed.cert = migrateLegacyCert({
    "DEMO-0001": {"DEMO-REG-A":"DEMO*A00/00*01","DEMO-REG-B":"DEMO*B00/00*01","DEMO-REG-D":"DEMO*D00/00*01"},
    "DEMO-0002": {"DEMO-REG-A":"DEMO*A00/00*02","DEMO-REG-D":"DEMO*D00/00*02"},
    "DEMO-0003": {"DEMO-REG-A":"DEMO*A00/00*03","DEMO-REG-A2":"DEMO*A02/00*01","DEMO-REG-B":"DEMO*B00/00*02","DEMO-REG-D":"DEMO*D00/00*03"},
    "DEMO-0004": {"DEMO-REG-A":"DEMO*A00/00*04","DEMO-REG-A2":"DEMO*A02/00*02","DEMO-REG-D":"DEMO*D00/00*04"},
    "DEMO-0005": {"DEMO-REG-A":"DEMO*A00/00*05","DEMO-REG-B":"DEMO*B00/00*03","DEMO-REG-C":"DEMO*C00/00*01","DEMO-REG-D":"DEMO*D00/00*05"},
    "DEMO-0006": {"DEMO-REG-A":"DEMO*A00/00*06","DEMO-REG-A2":"DEMO*A02/00*03","DEMO-REG-C":"DEMO*C00/00*02"},
  }, seed.runs, seed.regs);
  // 取得予定（F-23）の例。番号は無く、予定だけがある＝車両申請「発生する（計画済み）」。
  // F-42 A5：対象外・要再確認の r7×REG-C にも○を付ける（人の対象外は○を隠さない）。
  seed.cert.push({ runKey:"r7", rid:"g6", ck:"", planned:true }, { runKey:"r7", rid:"g4", ck:"", planned:true });
  // 人の適用判断（F-28 A5）。危険一覧の3区分それぞれに「対象外」と「対象外・要再確認」を1件以上置く。
  // 確定時の条件はいまのデータから取る（＝条件は変わっていない）。要再確認は手動で立てた扱い（needsRecheck だけ true）。
  //   期限超過       … r11×REG-B 対象外（ランの末尾へ寄る）／r11×REG-D 対象外・要再確認（寄らない）。r6×REG-C は判断なし
  //   期限前・未取得 … r4×REG-C 対象外（r4 の先頭から末尾へ寄り、r4 が r5・r7 より後ろになる）／r7×REG-C 対象外・要再確認
  //   黄色予告       … r6×REG-E 対象外（r6 は寄った行しか無いので区分の末尾へ）／r11×REG-E 対象外・要再確認
  // ○は r7×REG-E（判断なし）と r7×REG-C（対象外・要再確認）の2件。対象外でも○は隠れず、危険一覧に両方の印が出る（F-42）。
  const runOf = (k) => seed.runs.find((r) => r.key === k), regOf = (rid) => seed.regs.find((r) => r.rid === rid);
  const exempt = (runKey, rid, needsRecheck, reason) => ({ runKey, rid, state:"対象外", reason,
    decidedAt:`${d(-2)} 09:00`, needsRecheck, cond: condOf(runOf(runKey), regOf(rid), seed.regs) });
  seed.decisions = [
    exempt("r11", "g3", false, "ダミー：対象外と判断した例"),
    exempt("r11", "g5", true,  "ダミー：対象外と判断したが要再確認の例"),
    exempt("r4",  "g4", false, "ダミー：対象外と判断した例"),
    exempt("r7",  "g4", true,  "ダミー：対象外と判断したが要再確認の例"),
    exempt("r6",  "g6", false, "ダミー：対象外と判断した例"),
    exempt("r11", "g6", true,  "ダミー：対象外と判断したが要再確認の例"),
  ];
  return seed;
}

// 起動時のダミーデータ。モジュールの評価はページの読み込みごとに1回なので、
// SEED＝そのページを開いた日の相対日付になる（TODAY と同じ考え方）。
export const SEED = buildSeed();

// 判定済みの結果（complianceStateOf の戻り値）をそのまま描く版。
// 呼び出し側がすでに結果を持っているときはこちらを使う（F-18：判定は1箇所で作り、画面は描くだけにする）。
export function ComplianceLabel({ s, fontSize = 9 }) {
  return (
    <span style={{ fontSize, fontWeight: s.state === "法規不適合" ? 800 : 700, color: s.color }}>{s.label}</span>
  );
}
// 結果を持っていない呼び出し側（同一性の行など）のための版。判定はここでも complianceStateOf に任せる。
export function ComplianceStateText({ dueDate, drop, lo, decisionState, fontSize = 9 }) {
  return <ComplianceLabel s={complianceStateOf({ dueDate, drop, lo, decisionState })} fontSize={fontSize} />;
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
        // 版2の応答は「一度保存されたデータ」なので、空でもそのまま使う（全件削除して保存した空をSEEDへ戻さない。Codexレビュー指摘3）。
        // 版なしで空の応答は未初期化のDBなので、従来どおりSEEDのまま（直後の自動保存でSEEDが入る）。
        if (d.schemaVersion === SCHEMA_VERSION || d.runs.length || d.regs.length || Object.keys(d.cert).length) {
          // 法規行の内部キー(rid)は旧形式のサーバDB（SQLがridを返さない形）には無いので補う。
          // 受理条件は変えず、値の削除・統合・改名もしない（付け足すだけ）。
          // 補完は共有カウンタを変えない planRegKeys で行い、反映時にまとめて採番を進める。
          const planned = planRegKeys(d.regs, peekIds().rid);
          if (!planned.ok) throw new Error(planned.error);
          // 旧形式のDBなら cert をここで型式ラン × 法規行へ移す。直後の自動保存で版2としてDBへ書き戻される（F-22 A4）。
          const c = certOfLoaded(d, planned.regs);
          if (!c.ok) throw new Error(c.error);
          setRuns(d.runs); setRegs(planned.regs); setCert(c.cert);
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
        body: JSON.stringify({ schemaVersion: SCHEMA_VERSION, runs, regs, cert }),
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
    const blob = new Blob([JSON.stringify({ schemaVersion: SCHEMA_VERSION, runs, regs, cert }, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ilist_data_${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  // 行の削除と同じ操作で、その行を参照する認証実績も取り除く（F-22 A7）
  const handleDeleteRun = (runKey) => setCert((c) => pruneCertByRun(c, runKey));
  const handleDeleteReg = (rid) => setCert((c) => pruneCertByReg(c, rid));
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
          // 旧形式（版なし）なら型式ラン × 法規行へ移す。読めない版・壊れた cert は state を変えずに中止する（F-22 A4）。
          const c = certOfLoaded(d, planned.regs);
          if (!c.ok) { alert(`このファイルは読み込めません。\n${c.error}\n\n（現在のデータは変更していません）`); return; }
          setRuns(d.runs); setRegs(planned.regs); setCert(c.cert);
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
        {tab==="型式ラン" && <RunsEditor {...{runs,setRuns,colorOf,nextKey}} onDeleteRun={handleDeleteRun} />}
        {tab==="法規DB" && <RegsEditor {...{regs,setRegs}} onDeleteReg={handleDeleteReg} />}
        {tab==="認可書実績" && <CertEditor {...{runs,regs,cert,setCert,colorOf}} />}
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

// ===== 危険な型式ランの一覧（F-10）：マトリクス上部の開閉パネル =====
//
// **ここでは判定も日付比較もしない**（A5）。buildCellModel の集約結果を riskSections（F-27）で
// 区分ごとに束ねて並べたものを、そのまま描くだけである（見出しの件数は riskRunRows）。文言はすべて TEXT（F-18の辞書）から引く。
// 色も既存の系統をそのまま使う（赤＝法規不適合・橙＝黄色予告・青＝同一性）。
//
// 開閉・展開は一時的なUI状態で、保存形式にも dirty にも関与しない（既定は閉じた状態＝A6）。

// 日数（A3）。主語は状態ごとに変える。読めない日付は日数を出さず、そう書く。
function RiskDays({ risk, bold = true }) {
  if (risk.days === null) return <span style={{ color:MUTE }}>{TEXT.risk.日数不明}</span>;
  const fontWeight = bold ? 800 : 600;
  if (risk.kind === "不適合") return <span style={{ color:RED, fontWeight }}>{TEXT.risk.超過日数(risk.days)}</span>;
  if (risk.kind === "期限前") return <span style={{ color:ORANGE, fontWeight }}>{TEXT.risk.期限前日数(risk.days)}</span>;
  return <span style={{ color:AMBER, fontWeight }}>{TEXT.risk.予告日数(risk.days, risk.afterDrop)}</span>;
}

// 区分（F-26）。法規行の先頭に1語だけ出す。色は日数と同じ系統（赤＝超過・橙＝期限前・黄＝予告）。
const RISK_COLOR = { 不適合: RED, 期限前: ORANGE, 予告: AMBER };
function RiskKind({ kind }) {
  const c = RISK_COLOR[kind] || MUTE;
  return (
    <span style={{ display:"inline-block", fontSize:9, fontWeight:700, padding:"0 5px", borderRadius:3,
      border:`1px solid ${c}`, color:c, background:`${c}14`, lineHeight:1.7, marginRight:5 }}>
      {TEXT.risk.区分[kind]}
    </span>
  );
}

// ○あり（車両申請＝発生する（計画済み））の印（F-26 A3）。一覧に出す・出さないには効かない。
function PlannedMark() {
  return (
    <span title="取得予定（○）が付いています。車両申請は「発生する（計画済み）」です。"
      style={{ display:"inline-block", fontSize:9, fontWeight:700, padding:"0 5px", borderRadius:999,
        border:`1px solid ${GREEN}`, color:GREEN, background:`${GREEN}12`, lineHeight:1.7, marginLeft:5 }}>
      {TEXT.risk.計画済み}
    </span>
  );
}

// 人の適用判断が「対象外」のセルの印（F-28 A1）。状態の表示・色はそのままで、横に添えるだけ（B1）。
// 要再確認が掛かっているものは帳票の要再確認と同じ橙で、寄せない側であることが見て分かるようにする。
function ExemptMark({ mark }) {
  const recheck = mark === "対象外・要再確認";
  const c = recheck ? AMBER : GRAY;
  return (
    <span data-risk-exempt={mark}
      title={recheck ? "人が対象外と判断したセルですが、判断した時から条件が変わったなどで要再確認です。判定・区分は変えていません。"
        : "人が対象外と判断したセルです。判定・区分は変えず、区分の末尾に寄せています。"}
      style={{ display:"inline-flex", alignItems:"center", gap:2, fontSize:9, fontWeight:700, padding:"0 5px", borderRadius:3,
        border:`1px solid ${c}`, color:c, background:`${c}14`, lineHeight:1.7, marginLeft:5, whiteSpace:"nowrap" }}>
      {recheck && <AlertTriangle size={9}/>}{recheck ? TEXT.risk.対象外要再確認印 : TEXT.risk.対象外印}
    </span>
  );
}

// 状態。帳票のセルと同じ状態名を出す（A7：マトリクスの状態と一覧の状態が一致する）。
//   不適合・期限前の行 … F-14の4状態。人の対象外では灰に上書きせず、決定表の結果のまま出す（F-28 B1。印は ExemptMark）。
//                        その場合は状態名の前に「自動判定：」を添え、人の判断ではないことを示す（色は変えない）
//   予告の行           … 帳票セルと同じ「否・要再確認」
function RiskState({ m }) {
  const autoPrefix = (color) => m.exemptMark
    ? <span data-risk-auto-prefix style={{ fontSize:11, fontWeight:700, color }}>{TEXT.risk.自動判定前置き}</span> : null;
  if (m.risk.kind === "予告")
    return <><RiskKind kind="予告" /><span style={{ fontSize:11, fontWeight:700, color:AMBER }}>{TEXT.cell.否要再確認}</span></>;
  if (m.risk.kind === "期限前")
    return <><RiskKind kind="期限前" />{autoPrefix(m.riskCompliance ? m.riskCompliance.color : ORANGE)}{m.riskCompliance
      ? <ComplianceLabel s={m.riskCompliance} fontSize={11} />
      : <span style={{ fontSize:11, fontWeight:700, color:ORANGE }}>{TEXT.risk.区分.期限前}</span>}
      {m.decision.車両申請 === "発生する（計画済み）" && <PlannedMark />}</>;
  return <><RiskKind kind="不適合" />{autoPrefix(m.riskCompliance ? m.riskCompliance.color : RED)}{m.riskCompliance
    ? <ComplianceLabel s={m.riskCompliance} fontSize={11} />
    : <span style={{ fontSize:11, fontWeight:800, color:RED }}>{TEXT.compliance.法規不適合()}</span>}</>;
}

// A9の印。同一性が未確認（比較元があるのに未回答）のセルに付ける。
// 判定は変えない（この印だけを理由に一覧へ出すこともしない）。同一性の「要再確認」とも別の見た目にする。
export function SamenessUnknownMark({ title }) {
  return (
    <span title={title} style={{ display:"inline-block", fontSize:9, fontWeight:700, padding:"0 5px",
      borderRadius:999, border:`1px dashed ${SAME}`, color:SAME, background:`${SAME}12`, lineHeight:1.7, marginLeft:5 }}>
      {TEXT.risk.同一性未確認}
    </span>
  );
}

// drop未定の要注意表示（F-24 A2）。drop＝∞（生産継続）の仮定で判定したことを示す印で、判定は変えない。
// 帳票セルと危険一覧の法規行が同じ部品を使う。
export function DropUndecidedMark() {
  return (
    <span title="dropが未入力です。生産が続く前提（drop＝∞）で判定しています。dropは空のままです。"
      style={{ display:"inline-block", fontSize:9, fontWeight:700, padding:"0 5px", borderRadius:3,
        border:`1px dashed ${ORANGE}`, color:ORANGE, background:`${ORANGE}14`, lineHeight:1.7, marginLeft:5 }}>
      {TEXT.cell.drop未定}
    </span>
  );
}
// ラン単位の異常（F-24 A4）。LOを迎えたのにdropが空＝入力漏れ。ラン行に1つだけ付ける。
function DropMissingMark() {
  return (
    <span title="LOを迎えているのにdropが未入力です（通常はdropが決まっているはずの入力漏れ）。法規の判定は drop＝∞ で出しています。"
      style={{ display:"inline-block", fontSize:10, fontWeight:800, padding:"0 6px", borderRadius:3,
        border:`1px solid ${RED}`, color:RED, background:`${RED}18`, lineHeight:1.7, marginLeft:10 }}>
      {TEXT.risk.drop未入力}
    </span>
  );
}

// 区分の開閉の既定（F-27 A3）。期限超過と黄色予告は開き、件数の多い期限前・未取得はたたむ。
// 一時的なUI状態で、保存形式にも dirty にも関与しない。パネルを開き直すたびにこの既定へ戻す（保存HTMLを開いても同じ）。
const RISK_SECTION_DEFAULT = { 不適合: true, 期限前: false, 予告: true };
// 判定不能の文字色（F-28 A4）。帳票セルの「判定不能（LO未入力）」と同じ紫系にそろえる。
const UNDECIDABLE = "#b9adff";

// 型式ランの見出し（プロジェクト・型式・生産フェーズ・LO/drop）。区分の中のラン行と、drop未入力の別枠で同じものを使う。
function RiskRunLabel({ run, phase }) {
  return <>
    <span style={{ fontSize:10.5, color:"#8fa3b8" }}>{run.gen || "（コード未設定）"}</span>
    <span style={{ fontFamily:"ui-monospace,monospace", fontWeight:700 }}>{run.typeId || "（型式未設定）"}</span>
    <span style={{ fontSize:9.5, padding:"1px 6px", borderRadius:999, color:"#8fa3b8",
      border:`1px solid ${LINE}`, background:"rgba(90,107,125,0.12)", fontWeight:700 }}>
      {TEXT.phase[phase] || ""}</span>
    <span style={{ fontSize:9.5, color:MUTE, fontFamily:"ui-monospace,monospace" }}>
      LO {fmt(run.lo)}・drop {fmt(run.drop)}</span>
  </>;
}

function RiskPanel({ rows, sections, filterActive, shownRuns, totalRuns }) {
  const [open, setOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(RISK_SECTION_DEFAULT);
  // 展開中の型式ラン（区分ごと）。同じランが複数の区分に出るので「区分＋ランのオブジェクト」で持つ（key は重複しうる）。
  // F-28：同じ区分の中でも、寄せていない行の段と寄せた行（対象外）の段に同じランが出るので aside も持つ。
  const [expanded, setExpanded] = useState([]);
  const cellCount = rows.reduce((n, r) => n + r.cells.length, 0);
  const same = (x, kind, r) => x.kind === kind && x.run === r.run && x.aside === r.aside;
  const isOpen = (kind, r) => expanded.some((x) => same(x, kind, r));
  const toggle = (kind, r) => setExpanded(isOpen(kind, r)
    ? expanded.filter((x) => !same(x, kind, r)) : [...expanded, { kind, run: r.run, aside: r.aside }]);
  const toggleSection = (kind) => setSectionOpen({ ...sectionOpen, [kind]: !sectionOpen[kind] });
  const togglePanel = () => {
    // 開き直すと既定に戻す（A3）。閉じている間の状態は持ち越さない。
    if (!open) { setSectionOpen(RISK_SECTION_DEFAULT); setExpanded([]); }
    setOpen(!open);
  };
  const filled = sections.sections.filter((s) => s.rows.length > 0);
  const allOpen = filled.length > 0 && filled.every((s) => sectionOpen[s.kind] && s.rows.every((r) => isOpen(s.kind, r)));
  const setAll = (v) => {
    setSectionOpen(Object.fromEntries(RISK_KINDS.map((k) => [k, v])));
    setExpanded(v ? filled.flatMap((s) => s.rows.map((r) => ({ kind: s.kind, run: r.run, aside: r.aside }))) : []);
  };
  const hasRisk = rows.length > 0;
  const MARK_TITLE = "比較元を選んでいるのに同一性が未回答のセルを含みます。判定は安全側（新型車側）で出しています。";
  const runBtn = { display:"inline-flex", alignItems:"center", gap:6, background:"transparent", border:"none",
    padding:0, color:"#eef4fa", fontSize:11.5, cursor:"pointer", fontFamily:"inherit", textAlign:"left" };
  return (
    <div style={{ background:PANEL, border:`1px solid ${hasRisk ? `${RED}66` : LINE}`, borderRadius:10, padding:"9px 12px", marginBottom:10 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <button onClick={togglePanel}
          style={{ display:"inline-flex", alignItems:"center", gap:6, background:"transparent", border:"none", padding:0,
            color:"#eef4fa", fontSize:11.5, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
          <span style={{ color:MUTE, fontSize:10 }}>{open ? "▼" : "▶"}</span>
          <AlertTriangle size={12} color={hasRisk ? RED : MUTE}/>{TEXT.risk.見出し}
        </button>
        <span style={{ fontSize:10.5, fontWeight:800, color: hasRisk ? RED : GREEN }}>
          {hasRisk ? TEXT.risk.件数(rows.length, cellCount) : TEXT.risk.該当なし}
        </span>
        {filterActive && <span style={{ fontSize:10, color:AMBER }}>表示フィルター適用中（{shownRuns}／{totalRuns}列）</span>}
        <span style={{ flex:1 }} />
        {!open && <span style={{ fontSize:10, color:MUTE }}>押すと一覧を開きます</span>}
      </div>
      {open && (
        <div style={{ marginTop:8 }}>
          {/* drop未入力のラン（F-27 A7）。区分見出しより上の別枠。区分の件数には数えない（B3）。 */}
          {/* LO未入力で判定できないラン（F-28 A4）。3区分には入らないので件数だけを一覧の上に出す。0件でも出す。 */}
          <div data-risk-undecidable={sections.undecidable.length}
            style={{ display:"flex", alignItems:"center", gap:6, fontSize:10.5, fontWeight:700, marginBottom:8,
              color: sections.undecidable.length > 0 ? UNDECIDABLE : MUTE }}>
            <HelpCircle size={12}/>{TEXT.risk.判定不能件数(sections.undecidable.length)}
            <span style={{ fontWeight:400, color:MUTE }}>（LOが空のため判定できない型式ラン。下の3区分には入りません）</span>
          </div>
          {sections.alerts.length > 0 && (
            <div data-risk-alerts="" style={{ border:`1px solid ${RED}66`, borderRadius:8, padding:"6px 10px", marginBottom:8, background:`${RED}0c` }}>
              <div style={{ fontSize:10.5, fontWeight:800, color:RED, marginBottom:4 }}>{TEXT.risk.drop未入力枠}</div>
              {sections.alerts.map((a, i) => (
                <div key={`alert:${i}`} data-risk-alert-run="" style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", fontSize:11.5, color:"#eef4fa", padding:"2px 0" }}>
                  <RiskRunLabel run={a.run} phase={a.phase} /><DropMissingMark />
                </div>
              ))}
            </div>
          )}
          {hasRisk && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
              {filled.length > 0 && (
                <button onClick={()=>setAll(!allOpen)} style={{ ...miniBtn, marginTop:0 }}>
                  {allOpen ? "すべてたたむ" : "すべて展開"}
                </button>
              )}
              <span style={{ fontSize:10, color:MUTE }}>区分ごとに、切迫している順に並べています</span>
            </div>
          )}
          <div style={{ overflowX:"auto" }}>
            <table style={tbl}>
              <thead><tr>
                <th style={th}>法規</th><th style={th}>状態</th><th style={th}>適用した規制</th>
                <th style={th}>規制日</th><th style={th}>期限</th><th style={th}>日数</th>
              </tr></thead>
              <tbody>
                {sections.sections.map((s) => (
                  <React.Fragment key={`sec:${s.kind}`}>
                    {/* 区分見出し（A1）。0件でも出す。押すと開閉する（A3）。 */}
                    <tr data-risk-section={s.kind}>
                      <td colSpan={6} style={{ ...td, background:`${RISK_COLOR[s.kind]}14`, borderTop:`2px solid ${RISK_COLOR[s.kind]}66`, padding:"6px 8px" }}>
                        <button onClick={()=>toggleSection(s.kind)}
                          style={{ ...runBtn, fontWeight:800, color:RISK_COLOR[s.kind] }}>
                          <span style={{ color:MUTE, fontSize:9 }}>{sectionOpen[s.kind] ? "▼" : "▶"}</span>
                          {TEXT.risk.区分[s.kind]}
                          <span style={{ fontSize:10.5 }}>{TEXT.risk.区分見出し件数(s.count, s.exempt)}</span>
                        </button>
                      </td>
                    </tr>
                    {sectionOpen[s.kind] && s.rows.map((r, i) => (
                      <React.Fragment key={`run:${s.kind}:${i}`}>
                        {/* ラン行（A2）。人は「どの車が危ないか」を先に見るので、法規より先に型式ランを出す。 */}
                        <tr data-risk-run={s.kind} data-risk-aside={r.aside ? "" : undefined}>
                          <td colSpan={6} style={{ ...td, background:"rgba(90,107,125,0.10)", padding:"7px 8px 7px 20px" }}>
                            <button onClick={()=>toggle(s.kind, r)} style={runBtn}>
                              <span style={{ color:MUTE, fontSize:9 }}>{isOpen(s.kind, r) ? "▼" : "▶"}</span>
                              <RiskRunLabel run={r.run} phase={r.phase} />
                            </button>
                            <span style={{ marginLeft:10, fontSize:10.5, color:"#aab8c6" }}>{TEXT.risk.区分件数(r.cells.length)}</span>
                            <span style={{ marginLeft:10, fontSize:10.5 }}><RiskDays risk={r.top || r.cells[0].risk} /></span>
                            {r.unconfirmed && <SamenessUnknownMark title={MARK_TITLE} />}
                            {/* 区分の末尾に寄せた段（F-28 A3）。同じランが上の段にも出ることがあるので、段であることを添える */}
                            {r.aside && <ExemptMark mark="対象外" />}
                          </td>
                        </tr>
                        {/* 法規行（展開したときだけ）。その区分の法規行だけを、切迫している順に出す。 */}
                        {isOpen(s.kind, r) && r.cells.map((m, j) => (
                          <tr key={`cell:${s.kind}:${i}:${j}`}>
                            <td style={{ ...td, fontSize:11.5, color:"#eef4fa", paddingLeft:34 }}>
                              {m.reg.id}<div style={{ fontSize:9, color:MUTE }}>{m.reg.label}</div>
                            </td>
                            <td style={td}>
                              <RiskState m={m} />
                              {m.exemptMark && <ExemptMark mark={m.exemptMark} />}
                              {m.decision.drop未定 && <DropUndecidedMark />}
                              {m.decision.根拠未確認 && <SamenessUnknownMark title={MARK_TITLE} />}
                            </td>
                            <td style={{ ...td, fontSize:10.5, color:"#aab8c6", whiteSpace:"nowrap" }}>
                              {m.decision.適用した規制 === "なし" ? <span style={{ color:MUTE }}>—</span> : <Badge kind={m.decision.適用した規制}/>}
                            </td>
                            <td style={{ ...td, fontSize:10.5, color:"#aab8c6", fontFamily:"ui-monospace,monospace", whiteSpace:"nowrap" }}>{fmt(m.decision.規制日)}</td>
                            <td style={{ ...td, fontSize:10.5, color:"#aab8c6", fontFamily:"ui-monospace,monospace", whiteSpace:"nowrap" }}>
                              {m.decision.期限 === "なし" ? "—" : `${m.decision.期限} ${fmt(m.decision.期限日)}`}
                            </td>
                            <td style={{ ...td, fontSize:10.5, whiteSpace:"nowrap" }}><RiskDays risk={m.risk} bold={false} /></td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {/* 凡例。状態名は辞書から引く（ここで文字列を書くと、辞書を直したときに説明だけ古い名前が残る）。
              「要対応」は辞書が日付つきの文言しか持たない（TEXT.compliance.要対応期日／要対応LO）ので、
              その族の呼び名としてかぎ括弧で書いている。 */}
          <div style={{ marginTop:8, fontSize:10, color:MUTE, lineHeight:1.7 }}>
            並ぶのは次の3区分です。
            <b style={{ color:RED }}>{TEXT.risk.区分.不適合}</b>（{TEXT.compliance.法規不適合()}：いま生産中・期限を過ぎている・実績なし）、
            <b style={{ color:ORANGE }}>{TEXT.risk.区分.期限前}</b>（「要対応」：要・実績なし・期限はまだ先。まだラインオフしていないランも入ります）、
            <b style={{ color:AMBER }}>{TEXT.risk.区分.予告}</b>（{TEXT.cell.否要再確認}：ドロップ後30日以内にこれから継続規制が来る）。
            開いた直後は{TEXT.risk.区分.不適合}と{TEXT.risk.区分.予告}を開き、{TEXT.risk.区分.期限前}はたたんでいます（見出しを押すと開閉します）。
            1つのランが複数の区分に当たるときは、それぞれの区分に出ます。区分の中は切迫している順で、{TEXT.risk.区分.期限前}は同じ期限なら未計画が先です。
            取得予定（○）が付いているセルは期限前・未取得のまま
            <span style={{ display:"inline-flex", verticalAlign:"middle" }}><PlannedMark /></span> を付けます（○の有無で行・件数は変わりません）。
            <b>実績あり（認可番号待ちを含む）のセルと、ドロップ済みのランは出しません</b>（ドロップ済みのランの状態は、{TEXT.compliance.過去不適合()}を含めてマトリクスに残ります）。
            dropが空のランは<b>生産が続く前提（drop＝∞）</b>で判定し、出た行に
            <span style={{ display:"inline-flex", verticalAlign:"middle" }}><DropUndecidedMark /></span> を付けます（dropが無いので黄色予告には入りません）。
            <b>LOを迎えたのにdropが空</b>のランは入力漏れとして、法規に関係なくラン単位で
            <b style={{ color:RED }}>{TEXT.risk.drop未入力}</b> を区分見出しより上の別枠に出します（法規の件数には数えません）。
            LOが空のランは判定不能なので3区分には出さず、上に<b style={{ color:UNDECIDABLE }}>判定不能</b>のラン数だけを出します（セルは帳票に出ます）。
            状態・規制日・期限は<b>帳票のセルとまったく同じ判定結果</b>で、ここでは束ねて並べているだけです。
            人が対象外と判断したセルも消さず、状態は判定結果のまま「自動判定：」を前に添えて出し、
            <span style={{ display:"inline-flex", verticalAlign:"middle" }}><ExemptMark mark="対象外" /></span> を付けて区分の末尾にまとめます
            （同じランの対象外でない行は上に残るので、そのランは区分に2回出ることがあります）
            （見出しの「うち対象外」はこの数）。要再確認が掛かっているものは
            <span style={{ display:"inline-flex", verticalAlign:"middle" }}><ExemptMark mark="対象外・要再確認" /></span> を付け、寄せずに切迫している順のまま出します。
            <span style={{ display:"inline-flex", verticalAlign:"middle" }}><SamenessUnknownMark title={MARK_TITLE} /></span>
            は、比較元があるのに同一性が未回答のセルを含む印です（判定は安全側の新型車側で出しています。印があること自体は一覧に出す理由にしません）。
          </div>
        </div>
      )}
    </div>
  );
}

// sameCtx / onSaveSameness は省略可能（F-04・単体版のみ）。省略時は同一性のUIを一切描画しない。
export function MatrixView({ runs, regs, evalCell, summary, colorOf, decisions, onSaveDecision, onRecheckRun, dataGen, columnFilter, sameCtx, onSaveSameness, basisCtx, onSetPlan }) {
  // セルの色と中身は、決定表（F-19）の出力「表示」1語だけで決まる（C4）。
  // status と notice から色をこねる形をやめたので、判定と見た目が食い違うことが起きない。
  // 人の適用判断はセルの色には一切関与しない（対象外を緑にしない・赤を消さない）。
  //   実績あり       … 濃い緑（認可書番号がある。従来の緑と同じ）
  //   引き継ぎ確認中 … 薄い緑＋破線の緑枠（単体版では前例あり・このランの認可番号待ち）
  const CELL_STYLE = {
    "否":            { bg:"rgba(90,107,125,0.07)", bd:LINE,  fg:MUTE,  dash:false },
    "否・予告":       { bg:"rgba(224,178,77,0.14)", bd:AMBER, fg:AMBER, dash:false },
    "実績あり":       { bg:"rgba(63,191,143,0.13)", bd:GREEN, fg:GREEN, dash:false },
    "引き継ぎ確認中": { bg:"rgba(63,191,143,0.04)", bd:GREEN, fg:GREEN, dash:true  },
    "申請発生":       { bg:"rgba(255,107,87,0.16)", bd:RED,   fg:RED,   dash:false },
    // F-24 A3：LO未入力。「否」（対応不要）と同じ見た目にしない（B2）。
    "判定不能":       { bg:"rgba(157,140,255,0.08)", bd:"#9d8cff", fg:"#b9adff", dash:true },
  };
  const cellStyle=(display)=> CELL_STYLE[display] || CELL_STYLE["否"];
  // 判断機能はpropsが渡されたときだけ有効（フックは常に同じ順序で呼ぶ）
  const judge = Array.isArray(decisions);
  const [editing, setEditing] = useState(null);     // { runKey, rid } | null
  // 編集領域の未保存の下書き（state/reason）。編集できるセルは常に1つなので1件だけ持つ。
  // これを MatrixView 側に置くことで、表示フィルターで編集中の列が一時的に隠れても
  // （MatrixView 自体はアンマウントされない）入力途中の理由・選択が保持され、再表示で戻る。
  // 保存対象データ・dirty には一切関与しない。明示保存／キャンセル／成功読込で捨てる。
  const [editDraft, setEditDraft] = useState(null); // { runKey, rid, state, reason } | null
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
  // 全セルの判定結果（F-18）。帳票のセルもコンプラ漏れ一覧も、ここで作った結果だけを描く。
  // 表示フィルターで隠れている列も作る（フィルターは描く側で効かせる）。
  // evalCell は呼び出し側で毎描画つくり直される関数なので、実質は毎描画の計算になる（従来のセル内計算と同じ）。
  // ※ 新しいフックは既存フックより後ろに置く（既存の呼び出し順を動かさないため）。
  const model = useMemo(
    () => buildCellModel({ runs, regs, evalCell, decisions: judge ? decisions : null, sameCtx, basisCtx }),
    [runs, regs, evalCell, decisions, judge, sameCtx, basisCtx]);
  // コンプラ漏れ一覧に並べる行。判定はせず、集約結果から「申請発生」のセルを拾うだけ（F-18・B1）。
  const leakRows = useMemo(() => model.list.filter((m) => m.auto.status === "leak"), [model]);
  const filterActive = filterable && (selProjects.length > 0 || selTypes.length > 0);
  // 欄内OR・欄間AND・完全一致。未選択の欄は制限なし。列順は runs の順を保つ。
  // 同じ (gen, typeId) のランが複数あっても、条件に合えば全ランを残す（重複排除しない）。
  const visibleRuns = !filterActive ? runs : runs.filter((run) =>
    (selProjects.length === 0 || selProjects.includes(run.gen)) &&
    (selTypes.length === 0 || selTypes.includes(run.typeId)));
  // 危険な型式ランの一覧（F-10）。帳票と同じ集約結果を、表示中の列だけに絞って束ねる（A4）。
  // 絞れば作業中用、外せば全体の見回しになる。判定・日付比較はここでも一覧側でも行わない。
  // ※ 新しいフックは既存フックより後ろに置く（既存の呼び出し順を動かさないため）。
  const riskRows = useMemo(() => riskRunRows(model, { runs: visibleRuns }), [model, visibleRuns]);
  // 区分見出し（F-27）。同じ集約結果・同じ表示中の列から作る（件数・フィルター連動が上の riskRows とずれない）。
  const riskSec = useMemo(() => riskSections(model, { runs: visibleRuns }), [model, visibleRuns]);

  // 法規が0件でも、ラン単位の異常（F-24 A4「drop未入力（LO済み）」）は危険一覧に出す（Codexレビュー指摘1）。
  // LO未入力のランの件数（F-28 A4）も同じ扱い：法規が0件でも判定不能のランがあれば出す（Codexレビュー指摘2）。
  const riskOnly = riskRows.length > 0 || riskSec.undecidable.length > 0
    ? <RiskPanel rows={riskRows} sections={riskSec} filterActive={filterActive} shownRuns={visibleRuns.length} totalRuns={runs.length} />
    : null;
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
          {riskOnly}
          <Empty msg="型式ランと法規を入力すると、ここに適合・実績の帳票が出ます。" />
        </>
      );
    }
    return <>{riskOnly}<Empty msg="型式ランと法規を入力すると、ここに適合・実績の帳票が出ます。" /></>;
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
      <RiskPanel rows={riskRows} sections={riskSec} filterActive={filterActive} shownRuns={visibleRuns.length} totalRuns={runs.length} />
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
            {visibleRuns.map(run=>{ const col=colorOf(run.typeId);
              const loMissing = dropInputStateOf(run.lo, run.drop) === "LO未入力";
              return (
              <th key={run.key} style={{ padding:"4px 6px", minWidth:138, verticalAlign:"top" }}>
                <div style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                  <span style={{ width:7,height:7,borderRadius:2,background:col }}/>
                  <span style={{ fontFamily:"ui-monospace, monospace", fontSize:12.5, color:"#eef4fa", fontWeight:700, borderBottom:`2px solid ${col}` }}>{run.typeId}</span>
                </div>
                <div style={{ fontSize:9.5, color:"#6b7d90", margin:"2px 0" }}>{run.gen}・{run.sk==="新"?"新型/指定":"継続/既指定"}</div>
                {/* F-29：LOが空なら見出しだけを置き換える。判定に使う生産フェーズは変えない。 */}
                <div style={{ fontSize:9.5, margin:"2px 0" }}>
                  <span style={{ display:"inline-block", padding:"1px 6px", borderRadius:999, color:loMissing ? UNDECIDABLE : "#8fa3b8",
                    border:`1px solid ${LINE}`, background:"rgba(90,107,125,0.12)", fontWeight:700 }}>
                    {loMissing ? TEXT.runHeader.LO未入力 : TEXT.phase[model.phaseOf(run)] || ""}</span>
                </div>
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
                認証実績も rid（と run.key）で引く（F-22）。 */}
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
                  // セルの中身は buildCellModel が作った結果をそのまま描く（判定はここでやり直さない・F-18）。
                  //   c      … 要否・種別・認可書・期日（evalCellWith）
                  //   notice … F-15の黄色の接近予告（status="off"以外には出ない）
                  //   dec    … 人の適用判断（判断機能が無い版では null）
                  //   base / sameRec / showSame … 同一性（F-04）。showSame は答えが判定を変えるセルだけ true
                  //   basis  … 根拠（F-12）。判定・色・期日・要再確認には一切関与しない
                  const m = model.get(run, r);
                  const c = m.auto, notice = m.notice, dec = m.dec, base = m.base, sameRec = m.sameRec, basis = m.basis;
                  const disp = m.decision.表示;         // 決定表の出力。色も中身もこの1語から決まる（C4）
                  const st=cellStyle(disp);
                  const isEditing = judge && editing && editing.runKey===run.key && editing.rid===r.rid;
                  const showSame = m.showSame;
                  const isEditingSame = showSame && editingSame && editingSame.runKey===run.key && editingSame.rid===r.rid;
                  return (
                  <td key={run.key} style={{ padding:0 }}>
                    <div style={{ background:st.bg, border:`1px ${st.dash?"dashed":"solid"} ${st.bd}`, borderRadius:7, padding:"7px 8px", minHeight:48, display:"flex", flexDirection:"column", justifyContent:"center", gap:2 }}>
                      {disp==="否" && <div style={{ display:"flex", alignItems:"center", gap:4, color:st.fg }}><Minus size={12}/><span style={{ fontSize:11 }}>{TEXT.cell.否}</span></div>}
                      {disp==="否・予告" && <>
                        <div style={{ display:"flex", alignItems:"center", gap:4, color:st.fg }}><AlertTriangle size={12}/><span style={{ fontSize:10.5, fontWeight:700 }}>{TEXT.cell.否要再確認}</span></div>
                        <span style={{ fontSize:9, color:st.fg }}>継続規制まで{notice.days}日（{fmt(notice.keiDate)}・延長時は再確認）</span></>}
                      {disp==="実績あり" && <>
                        <div style={{ display:"flex", alignItems:"center", gap:4, color:st.fg }}><ShieldCheck size={12}/><span style={{ fontSize:10.5, fontWeight:700 }}>{TEXT.cell.要}</span><Badge kind={c.kind}/></div>
                        <span style={{ fontFamily:"ui-monospace,monospace", fontSize:9, color:"#bfe9d8" }}>{c.ck}</span></>}
                      {disp==="引き継ぎ確認中" && <>
                        <div style={{ display:"flex", alignItems:"center", gap:4, color:st.fg }}><ShieldCheck size={12}/><span style={{ fontSize:10.5, fontWeight:700 }}>{TEXT.cell.要}</span><Badge kind={c.kind}/></div>
                        <span style={{ fontSize:9, color:st.fg, fontWeight:700 }}>{onSetPlan ? "実績あり（認可番号待ち）" : TEXT.cell.引き継ぎ確認中}</span>
                        <span style={{ fontSize:9, color:"#8fa3b8" }}>{onSetPlan ? "この法規には前例あり・このランの認可番号は空" : "同じ型式の過去の実績あり・このプロジェクトの番号は空"}</span></>}
                      {disp==="申請発生" && <>
                        <div style={{ display:"flex", alignItems:"center", gap:4, color:st.fg }}><AlertTriangle size={12}/><span style={{ fontSize:10.5, fontWeight:800 }}>{TEXT.cell.申請発生}</span><Badge kind={c.kind}/></div>
                        <ComplianceLabel s={m.compliance} /></>}
                      {disp==="判定不能" &&
                        <div style={{ display:"flex", alignItems:"center", gap:4, color:st.fg }}><HelpCircle size={12}/><span style={{ fontSize:10.5, fontWeight:700 }}>{TEXT.cell.判定不能}</span></div>}
                      {onSetPlan && c.planVisible && <>
                        <label style={{ display:"flex", alignItems:"center", gap:5, marginTop:4, fontSize:10, color:c.planned ? "#cdd9e5" : "#8fa3b8", cursor:c.canPlan || c.planned ? "pointer" : "default" }}>
                          <input type="checkbox" aria-label={`取得予定 ${run.key} ${r.rid}`} checked={c.planned}
                            disabled={!c.canPlan && !c.planned} style={{ margin:0, accentColor:CYAN }}
                            onChange={(e)=>onSetPlan(run, r, e.target.checked)} />
                          {c.planned ? "○ 取得予定" : "取得予定（○）"}
                        </label>
                        {!c.canPlan && <span style={{ fontSize:9, color:"#8fa3b8" }}>{c.planned ? "LO到来済み・予定の解除のみ可" : "LO到来済み・新たな予定は追加不可"}</span>}
                      </>}
                      {m.decision.drop未定 && <div><DropUndecidedMark /></div>}
                      {showSame && !isEditingSame &&
                        <SamenessLine rec={sameRec} run={run} reg={r} base={base} auto={c} compliance={m.compliance}
                          unconfirmedSide={m.decision.根拠未確認}
                          onOpen={base.state==="ok" ? ()=>{ setEditing(null); setEditDraft(null); setEditingSame({ runKey:run.key, rid:r.rid }); setSameDraft(null); } : null} />}
                      {isEditingSame &&
                        <SamenessEditor rec={sameRec} run={run} reg={r} base={base} hasCert={!!c.ck}
                          draft={sameDraft && sameDraft.runKey===run.key && sameDraft.rid===r.rid ? sameDraft : null}
                          onDraftChange={(d)=>setSameDraft({ runKey:run.key, rid:r.rid, ...d })}
                          onCancel={()=>{ setEditingSame(null); setSameDraft(null); }}
                          onSave={(rec)=>{ onSaveSameness(rec); setEditingSame(null); setSameDraft(null); }} />}
                      <BasisLine basis={basis} />
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
        <Leg c={GREEN} t="要・認可書あり（濃い緑）"/><Leg c={GREEN} t={onSetPlan ? "要・実績あり（認可番号待ち）（薄い緑・破線）" : "要・引き継ぎ確認中（薄い緑・破線）"}/>
        {onSetPlan && <span style={{ color:"#8fa3b8" }}>○＝取得予定（実績には含めない）</span>}
        <Leg c={RED} t="要・実績なし＝申請発生"/><Leg c={MUTE} t="否＝対象外"/>
        <Leg c="#9d8cff" t="判定不能＝LOが未入力（破線）"/><Leg c={ORANGE} t="drop未定＝dropが空なので生産継続（drop＝∞）として判定"/>
        <Leg c={AMBER} t="否・ドロップ後30日以内にこれから継続規制＝要再確認"/>
        <span style={{ display:"inline-flex", gap:5 }}><Badge kind="新型"/>指定で適合<Badge kind="継続"/>継続対応</span>
      </div>
      <div style={{ marginTop:6, fontSize:10.5, color:MUTE, lineHeight:1.8 }}>
        型式ランの見出しにある<b style={{ color:"#8fa3b8" }}>開発中／生産中／drop済み</b>は<b>生産フェーズ</b>で、
        LO・ドロップ日と今日だけで決まります（今日 &lt; LO＝開発中／LO ≤ 今日 ≤ ドロップ＝生産中／ドロップ &lt; 今日＝drop済み）。
        セルの状態名とは別の軸です。
      </div>
      <div style={{ marginTop:6, fontSize:10.5, color:MUTE, lineHeight:1.8 }}>
        申請発生のセルは、期日・LO・ドロップ日{judge && "・人の適用判断"}から
        <b style={{ color:RED }}>法規不適合</b>（期日が来ていて、LOも過ぎ、まだ生産中）／
        <b style={{ color:ORANGE }}>要対応｜YYYY/MMまで</b>（期日がこれから＝期日まで。期日は過ぎたがLOがまだ＝LOまで）／
        <b style={{ color:GRAY }}>過去に法規不適合（drop済み）</b>（規制日のあともドロップまで実績なしで生産していた）／
        <b style={{ color:GRAY }}>drop済み（対応対象外）</b>（規制日が来る前にドロップしていた）
        {judge && <>／<b style={{ color:GRAY }}>対象外（判断済み）</b>（人が対象外と判断したセル）</>}
        に分けて表示します。ドロップ当日はまだ生産中として扱い、LOがまだのランは法規不適合にしません。
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
          <b>新型車日がLOより後の法規</b>は、同一でも同一でなくても継続車日で判定が決まるため、同一性の行を出しません（答えても結果が変わらないため）。
          <span style={{ display:"inline-flex", alignItems:"center", gap:8, flexWrap:"wrap", marginTop:6 }}>
            <span style={{ color:MUTE }}>見分け：</span>
            <SamenessTag value="同一" /><SamenessTag value="同一でない" /><SamenessTag value="未確認" />
          </span>
        </div>
      )}
      {basisCtx && (
        <div style={{ marginTop:8, fontSize:10.5, color:"#8fa3b8", lineHeight:1.75, background:`${SAME}0d`, border:`1px dashed ${SAME}55`, borderRadius:9, padding:"8px 12px" }}>
          <b style={{ color:SAME }}>「根拠：」</b>が出るのは、<b>継続車適用日の猶予を使っているセル</b>だけです
          （＝新型車日なら「要」・継続車日なら「否」になるセル。「新型車適用日以前に指定を受けた自動車と、当該装置に変更がない」と言って先送りしているセル）。
          どちらの日で判定しても要否が同じセルには出しません（連鎖の成否が結論を左右しないため）。
          連鎖は<b>同じ型式記号の前のラン</b>を優先してたどり、それが無いときだけ<b>人が確定した比較元（「同一」と答えたものだけ）</b>をたどります。
          <b>その法規の新型車適用日以前にLOを持つ型式ラン＝根</b>まで届けば、根と中継点の数を1行で出します。
          途中の同一性が未確認・LOが読めない・前段が無い・連鎖が循環している場合は
          <span style={{ display:"inline-flex", verticalAlign:"middle", margin:"0 3px" }}><BasisUnknownBadge /></span>
          になります。<b>判定・期日・色・要再確認は変わりません</b>（根拠をたどれたかを示すだけの表示です）。同一性の<b>要再確認</b>とは別の印です。
        </div>
      )}
      {filterActive && (
        <div style={{ marginTop:14, fontSize:10, color:MUTE, lineHeight:1.6 }}>
          下の<b style={{ color:"#8fa3b8" }}>コンプラ漏れ・実効ドロップは全体集計</b>です（表示フィルターの影響を受けず、全 {runs.length} 列を対象にします）。
        </div>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:13, marginTop:filterActive?8:22 }}>
        <Card title="コンプラ漏れ（自動検出）" icon={<AlertTriangle size={15} color={RED}/>}>
          {/* 並べる行も状態も、帳票セルと同じ集約結果（buildCellModel）から作る（F-18・B1）。
              ここでは判定をやり直さない。抽出条件・並び順は summarize と同じ
              （runs の順 × regs の順に status==="leak" を拾う）ため、出る行と順序は従来と変わらない。
              表示フィルターの影響は受けず、全列を対象にするのも従来どおり（model は runs 全件で作っている）。 */}
          {leakRows.length===0 ? <p style={{ color:GREEN, fontSize:12.5, margin:0 }}>漏れなし。</p> :
            leakRows.map((m,i)=>{
              // drop済み・対象外の行も一覧から外さず、灰色の行として残す（F-14）。
              const dim = m.compliance.color === GRAY;
              return (
              <div key={i} style={{ fontSize:12, padding:"5px 0", borderBottom:i<leakRows.length-1?`1px solid ${LINE}`:"none" }}>
                <span style={{ fontFamily:"ui-monospace,monospace", color:dim?GRAY:"#eef4fa" }}>{m.run.typeId}</span>
                <span style={{ color:"#6b7d90", fontSize:11 }}>（{m.run.gen}）</span> × <span style={{ color:dim?GRAY:"#eef4fa" }}>{m.reg.id}</span>
                <Badge kind={m.auto.kind}/>{" "}<ComplianceLabel s={m.compliance} fontSize={11} />
              </div>);})}
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
//
// 未確認（比較元はあるが未回答）も F-19 C3 で新型車側に決まる（安全側）ので、同じ見方で書く。
// 決定表の出力 根拠未確認 = はい がその状態なので、その値で分岐する（画面で判定をやり直さない）。
// ここを「新継どおり」と書くと、指定区分が継のランで新型車側へ切り替えた理由と反対の説明になる。
const appliedText = (auto, eff, 根拠未確認 = false) => {
  const shinSide = (prefix) =>
    !auto.required ? `${prefix}新型車の式で判定`
    : auto.kind === "新型" ? `${prefix}新型車日を適用`
    : `${prefix}新型車の式で判定・継続車日で要`;
  if (auto.applied === "継続車日") return "継続車日を適用";
  if (auto.applied === "新型車日") return shinSide("");
  if (根拠未確認 || eff === "未確認") return shinSide("未確認のため安全側：");
  return "";
};

// セル内の「同一性：」行。
// compliance … 申請発生セルの4状態（F-14）。呼び出し側（MatrixView）が集約結果から渡す。
// ここで complianceStateOf を呼び直さない（F-18・B1「セル描画の中で判定関数を呼ばない」）。
// 申請発生でないセルでは null で渡ってくる。
function SamenessLine({ rec, run, reg, base, auto, compliance, unconfirmedSide = false, onOpen }) {
  const eff = effectiveSameness(rec, base);          // 無効な比較元なら null
  const shown = eff ?? "未確認";
  const stale = !!rec && rec.value !== "未確認" && eff === "未確認";
  const live = samenessRecheckReasons(rec, run, reg, base);
  // 認可書の実績があるセルでは要再確認を出さない（記録上のフラグは残す。実績を消すとまた出る）
  const recheck = !auto.ck && (!!rec?.needsRecheck || live.length > 0);
  // 申請発生のセルは、帳票セル・コンプラ漏れ一覧と同じ4状態を出す（F-14。「期限超過」は使わない）。
  // 要再確認の有無・同一性の回答とは独立に出す。
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
          : appliedText(auto, eff, unconfirmedSide)}
        {auto.required && auto.applied && auto.dueDate ? ` ${fmt(auto.dueDate)}` : ""}
        {auto.status === "leak" && compliance && <>{" "}<ComplianceLabel s={compliance} /></>}
        {stale && <span style={{ color:AMBER }}>（前の比較元への回答）</span>}
      </span>
    </div>
  );
}

// ===== 根拠（F-12）：セル内の「根拠：」行と「根拠未確認」の印 =====
// 表示だけの行。要否・色・期日・要再確認（F-04のA5）・人の判断には一切関与しない。

// 「根拠未確認」の印。F-04の「要再確認」（黄色・実線の角箱・三角アイコン）とは
// 文言・色・形のすべてを変える（青系・破線のピル・アイコンなし）＝完成条件B4の「別の表示」。
export function BasisUnknownBadge() {
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", whiteSpace:"nowrap",
      fontSize:9, fontWeight:700, color:SAME, background:"rgba(12,20,32,0.55)",
      border:`1px dashed ${SAME}`, borderRadius:999, padding:"0 4px",
    }}>根拠未確認</span>
  );
}

// セル内の「根拠：」行。
//   対象外   … B2の対象外（猶予を使っていない／使っても要否が変わらない）＝何も出さない（B5・B8）
//   自分が根 … 自分の指定が根。対象セルなので1行出す
//   根到達   … どの型式ランのどの指定から変更なしで継続しているかを1行で出す（B6）
//   根拠未確認 … 印と理由を出す（B5）。猶予を使っていることも一緒に書く
function BasisLine({ basis }) {
  if (!basis || basis.state === "対象外") return null;
  const unknown = basis.state === "根拠未確認";
  return (
    <div style={{ borderTop:`1px dashed ${LINE}`, marginTop:5, paddingTop:4, display:"flex", flexDirection:"column", gap:3 }}>
      {unknown ? (
        <>
          <div style={{ display:"flex", alignItems:"center", gap:4, flexWrap:"wrap" }}>
            <span style={{ fontSize:9, color:MUTE, flex:"none" }}>根拠：</span>
            <BasisUnknownBadge />
          </div>
          <span style={{ fontSize:9, color:"#8fa3b8", lineHeight:1.5 }}>継続車適用日の猶予を使っているが、{basis.reason}</span>
        </>
      ) : (
        <span style={{ fontSize:9, color:"#8fa3b8", lineHeight:1.5 }}>
          <span style={{ color:MUTE }}>根拠：</span>{basis.text.replace(/^根拠：/, "")}
        </span>
      )}
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

  const autoText = auto.handover && auto.status==="ok" ? "要・実績あり（認可番号待ち）" : auto.status==="ok" ? `要・認可書あり（${auto.ck}）`
    : auto.status==="leak" ? "要・実績なし＝申請発生"
    : auto.status==="unknown" ? TEXT.cell.判定不能
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

// ===== 認可書実績編集（型式ラン × 法規行 グリッド・F-22 A6）=====
// 列＝型式ラン（型式・プロジェクトコード・新継）、行＝法規行。1マス＝このランのこの法規の管理番号1つ。
// 同じ型式でもランごとに別の欄になる（型式で共有しない）。取得予定の入力はまだ出さない（F-23）。
export function CertEditor({ runs, regs, cert, setCert, colorOf }) {
  const set=(runKey,rid,val)=>setCert(c=>setCertNumber(c,runKey,rid,val));
  if (runs.length===0 || regs.length===0)
    return <Empty msg="型式ランと法規を入力すると、ここで認可書番号を型式ラン×法規で入力できます。" />;
  return (
    <div>
      <p style={{ color:MUTE, fontSize:12, lineHeight:1.7, margin:"0 0 4px" }}>
        指定装置一覧＝認可書実績の入力。型式ラン × 法規に認可書番号を入れる（同じ型式でもランごとに別の欄）。空欄＝実績なし。
      </p>
      <p style={{ color:"#6b7d90", fontSize:10.5, margin:"0 0 14px" }}>※段階2では、この欄を指定装置一覧ファイルから自動で埋める設計（次の相談）。</p>
      <div style={{ background:PANEL, borderRadius:12, padding:14, border:`1px solid ${LINE}`, overflowX:"auto" }}>
        <table style={{ borderCollapse:"separate", borderSpacing:5, width:"100%" }}>
          <thead><tr>
            <th style={{ textAlign:"left", padding:"4px 8px", fontSize:10.5, color:MUTE }}>法規 \ 型式ラン</th>
            {runs.map(run=>(
              <th key={run.key} style={{ padding:"4px 6px", minWidth:150 }}>
                <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                  <span style={{ width:7,height:7,borderRadius:2,background:colorOf(run.typeId) }}/>
                  <span style={{ fontFamily:"ui-monospace,monospace", fontSize:12.5, color:"#eef4fa", fontWeight:700 }}>{run.typeId}</span>
                </span>
                <div style={{ fontSize:9.5, color:MUTE, fontWeight:500, marginTop:2 }}>{run.gen || "—"}・{run.sk}</div>
              </th>))}
          </tr></thead>
          <tbody>
            {/* 行キーは rid、列キーは run.key（認証実績の結合キーそのもの） */}
            {regs.map(r=>(
              <tr key={r.rid}>
                <td style={{ padding:"4px 8px" }}><span style={{ fontSize:12, color:"#eef4fa", fontWeight:600 }}>{r.id}</span></td>
                {runs.map(run=>{
                  const ck = findCert(cert, run.key, r.rid)?.ck || "";
                  return (
                  <td key={run.key} style={{ padding:0 }}>
                    <input value={ck} placeholder="認可書番号" aria-label={`認可書番号 ${run.key} ${r.rid}`} onChange={e=>set(run.key,r.rid,e.target.value)}
                      style={{ width:"100%", background:ck?"rgba(63,191,143,0.08)":"transparent", border:`1px solid ${ck?GREEN:LINE}`, borderRadius:6, color:"#bfe9d8", fontSize:10, fontFamily:"ui-monospace,monospace", padding:"7px 8px", boxSizing:"border-box" }}/>
                  </td>);
                })}
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
export const btn=(c,ghost)=>({ display:"inline-flex", alignItems:"center", gap:5, background:ghost?"transparent":c, color:ghost?"#aab8c6":"#0c1623", border:ghost?`1px solid ${LINE}`:"none", borderRadius:7, padding:"6px 12px", fontSize:12, fontWeight:600, cursor:"pointer" });
const tbl={ borderCollapse:"collapse", width:"100%" };
const th={ textAlign:"left", padding:"6px 8px", fontSize:10.5, color:MUTE, fontWeight:600, borderBottom:`1px solid ${LINE}` };
const td={ padding:"5px 8px", borderBottom:`1px solid ${LINE}` };
const inp={ background:"#0c1623", border:`1px solid ${LINE}`, borderRadius:6, color:"#cdd9e5", fontSize:11.5, padding:"6px 8px", width:130, boxSizing:"border-box" };
const iconBtn={ background:"transparent", border:"none", cursor:"pointer", padding:4 };
// 判断まわりの小さなボタン（帳票セル・列見出しで使う）
const miniBtn={ background:"transparent", border:`1px solid ${LINE}`, borderRadius:5, color:"#aab8c6",
  fontSize:9.5, padding:"3px 6px", cursor:"pointer", fontFamily:"inherit", lineHeight:1.3, marginTop:4 };
