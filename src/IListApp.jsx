import React, { useState, useMemo, useRef, useEffect } from "react";
import { AlertTriangle, ShieldCheck, Minus, Activity, Pencil, Cpu, Plus, Trash2, Download, Upload, Table2, Scale, FileCheck, HelpCircle } from "lucide-react";

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

// ───────────────────────────────────────────────
// 表示文言の辞書（F-18）
//
// 画面に出る状態名・呼び名をここ1箇所にまとめる。判定・しきい値・色はここに置かない。
//   ・判定は complianceStateOf ／ evalCellWith のまま。辞書は「その結果をどう呼ぶか」だけを持つ。
//   ・色をここに置かないのは、色の定数がこのファイルの後半にもあり、モジュール評価の順序に
//     縛られるため（文言＝この辞書、色＝各部品側、と分ける）。
// 日付を含む文言は関数にする（整形は fmt に合わせる＝画面はどこでも YYYY/MM）。
// fmt は関数宣言なので巻き上げられ、ここより後ろで定義されていても呼び出し時には使える。
// ───────────────────────────────────────────────
export const TEXT = {
  // 申請発生セルの4状態（F-14）。帳票セル・コンプラ漏れ一覧・同一性の行が共有する。
  compliance: {
    対象外:    () => "対象外（判断済み）",
    要対応期日: (dueDate) => `要対応｜${fmt(dueDate)}まで`,
    要対応LO:  (lo) => `要対応｜${fmt(lo)}まで`,
    過去不適合: () => "過去に法規不適合（drop済み）",
    drop済み:  () => "drop済み（対応対象外）",
    法規不適合: () => "法規不適合",
  },
  // セルの自動判定（要否）の呼び名。
  cell: {
    否:       "否",
    否要再確認: "否・要再確認",          // F-15の黄色（ドロップ後30日以内にこれから継続規制）
    要:       "要",
    申請発生:   "申請発生",
    引き継ぎ確認中: "引き継ぎ確認中",      // F-19 C4（同じ型式の過去ランに実績あり・当プロジェクトの番号は空）
    判定不能:   "判定不能（LO未入力）",   // F-24 A3。「否」（対応不要）とは別の見た目にする
    drop未定:   "drop未定",             // F-24 A2。drop＝∞（生産継続）の仮定で判定したセルの要注意表示
  },
  // 生産フェーズ（F-19 C5）。型式ランの列見出しに1語だけ出す。セルの状態名には混ぜない。
  phase: {
    開発中:   "開発中",
    生産中:   "生産中",
    "drop済み": "drop済み",
  },
  // 危険な型式ランの一覧（F-10）。**危険かどうかの条件・しきい値はここに置かない**
  // （並べる条件は decideCell の出力だけで決まる。ここは「その結果をどう呼ぶか」だけ）。
  risk: {
    見出し:   "危険な型式ラン",
    件数:     (runs, cells) => `${runs} ラン・${cells} 件`,
    該当なし:  "危険な型式ランはありません。",
    内訳:     (bad, warn) => `不適合 ${bad} 件・予告 ${warn} 件`,
    // 日数の主語は状態ごとに変える（A3）。「規制日まで何日超過」のような混ざった言い方はしない。
    超過日数:  (n) => `期限を過ぎて ${n} 日`,
    予告日数:  (n, afterDrop) => `継続車規制日まで ${n} 日（dropの ${afterDrop} 日後）`,
    日数不明:  "日数不明（日付が読めません）",
    // A9の印。判定は変えず、印を付けるだけ。
    同一性未確認: "同一性 未確認",
    // F-24 A4。LOを迎えたのにdropが空のラン（入力漏れの異常）。ラン単位で1行だけ出す。
    drop未入力:  "drop未入力（LO済み）",
  },
};
// 「今日」（F-13）。画面を開いた／再読み込みした時点の端末ローカル日付を使う。
// ・モジュール評価はページの読み込みごとに1回なので、TODAY＝そのページを開いた日になる。
// ・日をまたいで開きっぱなしの場合は自動更新しない（再読み込みで更新する）。
// ・基準日を選ぶ・保存する・固定する手段は、製品UI・保存データ・検証用設定のいずれにも持たない。
// ・期日との比較は「期日 ≤ 今日」で期日到来として扱う（当日から）。
//   期日到来後の見せ分け（法規不適合／drop済み／対象外）は complianceStateOf（F-14）で行う。
// UTCではなく端末ローカルの暦日を使う（端末の時計に依存する。監査証跡としては保証しない）。
export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const TODAY = todayStr();

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
export const SCHEMA_VERSION = 2;

// 旧形式（型式 × 法規ID）から新形式（型式ラン × 法規行）への移し替え（F-22 A5）。
//   ・旧 cert[typeId][regId] の値を、その型式の *すべての* 型式ランへ複製する
//     （旧形式では同じ型式のランが全部同じ実績を読んでいたので、見え方がそのまま保たれる）。
//   ・同じ reg.id を持つ法規行が複数あれば、そのすべてへ複製する（旧形式でも全行が同じ値を読んでいた）。
//   ・付け先の型式ラン・法規行が無いエントリは破棄する（旧形式でも画面・判定のどこからも読まれていなかった）。
//   ・取得予定は全件 false で始まる（旧形式は予定を持たない）。
//   ・空文字の番号もそのまま移す（旧形式でも空文字は「実績なし」と読まれていた＝見え方は変わらない）。
// 同じ型式の中の複製だけで、別の型式の実績は読まない・写さない（決定B）。
// 並びは runs の順 × regs の順（入力が同じなら出力も同じ）。
// ※ SEED の組み立てからも呼ぶので、このファイルの後ろで定義する定数を参照しないこと。
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

// ダミーデータ（架空の型式・法規・認可書番号。実車・実データとは無関係）
//
// 日付はすべて seedDate（今日からの相対日数）で作る。括弧内の数字は「今日から何日」。
//
// ■ 型式ランと生産フェーズ
//   r1 DEMO-0001 000A 新  LO −3300 / drop −2450  … drop済み（いちばん古い指定）
//   r2 DEMO-0001 000B 継  LO −2440 / drop −1350  … drop済み
//   r3 DEMO-0002 000B 新  LO −1990 / drop −1350  … drop済み（000Bで型式追加。LOが違う）
//   r4 DEMO-0001 000C 継  LO −1340 / drop −365  … drop済み（1年前にドロップした）
//   r5 DEMO-0002 000C 継  LO −1340 / drop −365  … drop済み（同上。装置変更で比較元と同一でない）
//   r6 DEMO-0003 001A 新  LO −190  / drop +150   … 生産中
//   r7 DEMO-0004 001A 新  LO +120  / drop +1550  … 開発中（LOがまだ来ていない）
//
// ■ 業務状態 → セルの対応表（A1）。**偶然そうなっているデータにしない。**
//   verify/seed-demo.html がこの表そのものを突き合わせ、崩れても増えてもFAILする（A8）。
//   1 現在法規不適合   … r6×REG-C（生産中・実績なし・期限を190日超過）＝F-10に「不適合」で出る
//   2 黄色予告         … r6×REG-E（dropの15日後に継続車規制）＝F-10に「予告」で出る
//   3 法規適合必要     … r7×REG-B・r7×REG-C・r7×REG-E（要だが期限＝LOがまだ先＝橙「要対応」）
//                        ＝現行F-10の定義どおり一覧には出さない
//   4 過去に法規不適合 … r5×REG-B（規制日のあともドロップまで実績なしで生産していた）
//                        ＝マトリクスには灰色で残るが、一覧には出さない
//   5 実績あり         … DEMO-0001×REG-A が r1(000A)・r2(000B)・r4(000C) の3プロジェクトで緑（A5）ほか
//   6 否（通常）       … r1×REG-B など
//
// ■ 危険一覧（F-10）に出るのは **drop前のラン（r6）だけ** にしてある（A2）。
//   F-10の黄色予告は「dropの30日以内に継続車規制日が来る」セルにも出る仕様なので、
//   drop済みのランでも、ドロップ直後に規制日が来るデータなら一覧に並ぶ。
//   それ自体は仕様どおりだが、**開発中の現物確認では主役（生産中の赤と予告）がぼやける**ため、
//   000C（r4・r5）のドロップを1年前に置き、どの法規の継続車規制日からも30日窓の外に出してある。
//   判定式・抽出条件は変えていない（A6）。変えたのはSEEDの日付関係だけである。
//   ＝ いま30日窓に入りうる継続車規制日は REG-A2(+200)・REG-C(+5)・REG-E(+165) の3つで、
//      drop が窓に入るランは r6（drop +150 と REG-E の +165）だけになる。
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
    //   000C：両型式が続く。DEMO-0002 は装置変更で比較元と同一でなくなる
    //   001A：別系統の DEMO-0003、途中で DEMO-0004 が追加される
    runs:[
      {key:"r1",typeId:"DEMO-0001",gen:"000A",sk:"新",lo:d(-3300),drop:d(-2450)},
      {key:"r2",typeId:"DEMO-0001",gen:"000B",sk:"継",lo:d(-2440),drop:d(-1350)},
      {key:"r3",typeId:"DEMO-0002",gen:"000B",sk:"新",lo:d(-1990),drop:d(-1350)},
      {key:"r4",typeId:"DEMO-0001",gen:"000C",sk:"継",lo:d(-1340),drop:d(-365)},
      {key:"r5",typeId:"DEMO-0002",gen:"000C",sk:"継",lo:d(-1340),drop:d(-365)},
      {key:"r6",typeId:"DEMO-0003",gen:"001A",sk:"新",lo:d(-190), drop:d(150)},
      {key:"r7",typeId:"DEMO-0004",gen:"001A",sk:"新",lo:d(120),  drop:d(1550)},
    ],
    // 法規の日付も相対。新型車適用日（shin）と継続車適用日（kei）の間隔は法規ごとに変えてある。
    //   A  … どのランのLOより前に両方の日が来ている古い法規（実績で緑になる）
    //   A2 … Aの後継（parent=A）。新型車日は過去、継続車日はこれから
    //   B  … 000Bの型式追加をまたぐ法規（過渡規定の例。r3は同一で逃げ、r5は同一でないので過去に不適合）
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
    //   r3×B 同一       … 継続車日を借りて「否」（新継どおりなら新型車日で期日到来）
    //   r5×B 同一でない … 000Cで装置変更。新型車日（過去）で申請発生（dropも過去なので 過去に法規不適合 表示）
    //   r5×D 同一でない … LO≥継続車日なので結論は変わらず、要再確認も立たない（実績ありで緑。実績ありのセルは要再確認を出さない）
    //   r7×B 同一でない … 初回回答で要再確認が立った例（同一と答えると継続車日へ、期日が変わる）
    //   r7×C 未確認     … 同一から未確認へ戻した例。実績が無いので要再確認が残っている
    //   記録を持たないセル（r3×A・r5×A・r7×A など）… 手を付けていない例。同一性：未確認・要再確認なし
    // ※ 同一性の行は「新型車日 ≤ LO」のセルにしか出ない（答えても結論が変わらないセルには出さない）。
    //    000BのC・E、000CのA2・C・E、001AのE などは、比較元を選んでいても同一性の行が出ない。
    bases:[
      {runKey:"r3",baseRunKey:"r2",decidedAt:`${d(-3)} 10:00`},
      {runKey:"r5",baseRunKey:"r4",decidedAt:`${d(-3)} 10:00`},
      {runKey:"r7",baseRunKey:"r6",decidedAt:`${d(-3)} 10:00`},
    ],
    sameness:[
      {runKey:"r3",rid:"g3",value:"同一",reason:"ダミー：比較元と装置は同じ",decidedAt:`${d(-3)} 10:05`,needsRecheck:false,baseRunKey:"r2"},
      {runKey:"r5",rid:"g3",value:"同一でない",reason:"ダミー：000Cで装置を変更",decidedAt:`${d(-3)} 10:06`,needsRecheck:false,baseRunKey:"r4"},
      {runKey:"r5",rid:"g5",value:"同一でない",reason:"ダミー：LO≥継続車日なので結論は変わらない",decidedAt:`${d(-3)} 10:07`,needsRecheck:false,baseRunKey:"r4"},
      {runKey:"r7",rid:"g3",value:"同一でない",reason:"ダミー：初回の回答",decidedAt:`${d(-3)} 10:08`,needsRecheck:true,baseRunKey:"r6"},
      {runKey:"r7",rid:"g4",value:"未確認",reason:"ダミー：確認し直すため未確認に戻した",decidedAt:"",needsRecheck:true,baseRunKey:""},
    ],
  };
  // 認可書実績（F-22：型式ラン × 法規行）。
  // 番号は型式ごとに下の表で持ち、旧形式の移行と同じ規則（migrateLegacyCert）でその型式の全ランへ展開する。
  // こうしておくと、F-22の前（型式 × 法規で1つ）と見え方が1セルも変わらない（F-22 B1）。
  // DEMO-0003 は REG-C を取り漏らしている＝現在法規不適合の1件。
  seed.cert = migrateLegacyCert({
    "DEMO-0001": {"DEMO-REG-A":"DEMO*A00/00*01","DEMO-REG-B":"DEMO*B00/00*01","DEMO-REG-D":"DEMO*D00/00*01"},
    "DEMO-0002": {"DEMO-REG-A":"DEMO*A00/00*02","DEMO-REG-D":"DEMO*D00/00*02"},
    "DEMO-0003": {"DEMO-REG-A":"DEMO*A00/00*03","DEMO-REG-A2":"DEMO*A02/00*01","DEMO-REG-B":"DEMO*B00/00*02","DEMO-REG-D":"DEMO*D00/00*03"},
    "DEMO-0004": {"DEMO-REG-A":"DEMO*A00/00*04","DEMO-REG-A2":"DEMO*A02/00*02","DEMO-REG-D":"DEMO*D00/00*04"},
  }, seed.runs, seed.regs);
  return seed;
}

// 起動時のダミーデータ。モジュールの評価はページの読み込みごとに1回なので、
// SEED＝そのページを開いた日の相対日付になる（TODAY と同じ考え方）。
export const SEED = buildSeed();

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

// ───────────────────────────────────────────────
// 日付の読み取り（判定はすべてこの見方だけを使う）
// ───────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// YYYY-MM-DD を UTC 日付として解釈し、その日数値を返す（タイムゾーンに依存させないため）。
// 形式が不正、または実在しない日付（例：2024-02-30）なら null。
export const dateDayNumber = (s) => {
  if (typeof s !== "string" || !DATE_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  // Date.UTCは月・日の繰り上がりを黙って許容する（例：2024-02-30→2024-03-01）ため、
  // 実在しない日付は往復して値が変わることで検出する
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return Math.floor(t / 86400000);
};

// ───────────────────────────────────────────────
// 判定の決定表（F-19）
//
// これまで要否・黄色の予告・期日超過の4状態・生産フェーズは別々の関数に散らばっていた。
// そのため「LOがまだ来ていないランのセルが赤い申請発生になる」「見た目と状態名が食い違う」
// といったズレが起きていた。そこで **セル1つの業務状態を決めるのはこの関数だけ** にする。
// 散らさないことを規約ではなく構造で担保するのが目的である。
//
// ■ 入力は3軸（Notion F-19 の決定表そのまま）
//   ① 日付5つ    lo / drop / shin（新型車規制日）/ kei（継続車規制日）/ today（今日）
//   ② 認証・予定  certPlan … "実績あり" / "実績なし+予定あり" / "実績なし+予定なし"（排他）
//      ※「予定」を人が入力する画面は F-16（取得予定○）で扱う。F-19では入力として受け取るだけで、
//        アプリ側は常に "実績あり" か "実績なし+予定なし" を渡す（F-19のやらないこと）。
//   ③ 実効の適用区分 side … "新" / "継"
//      型式ランの指定区分（run.sk）と同一性（F-04）から effectiveSideOf で先に決める。
//
// ■ 要否の式は現行のまま写し取っただけで、変えていない（F-19 やらないこと）。
//   **新型車規制はLOで、継続車規制はdropで比べる。** 両方をdropで比べるのは誤り。
//   日付の比較も現行と同じ文字列比較にそろえる（法規DBの日付が空なら要にしない）。
//
// ■ 出力（決定表の10項目＋画面が描くための3つ）
//   生産フェーズ / 要否 / 適用した規制 / 車両申請 / 期限 /
//   現在法規不適合 / 過去に法規不適合 / 法規適合必要 / 黄色予告 / 根拠未確認
//   ＋ 規制日（適用した規制の日付）・期限日・表示（セルの見せ方）
//   いずれも上の規則から導いた値で、ここ以外で判定をやり直さない。
//
// ■ 読めない日付（空・不正形式・実在しない日付）は「警告を弱めない側」へ寄せる（F-14から不変）：
//   今日が読めない → 生産中／LOが読めない → もう迎えている／dropが読めない → まだ生産中／
//   規制日が読めない → もう到来している。
//   ただし要否だけは文字列比較のままで、法規DBの日付が空なら要にしない（適合を要求する日が無いため）。
//   F-24：LO・dropが**空**のときだけは別に扱う（dropInputStateOf）。LOが空＝判定不能、
//   dropが空（LOあり）＝drop＝∞（生産継続）として要否を決める。入っているが読めない日付は上のとおり。
// ───────────────────────────────────────────────
export const PRODUCTION_PHASES = ["開発中", "生産中", "drop済み"];
export const EFFECTIVE_SIDES = ["新", "継"];
export const CERT_PLAN_STATES = ["実績あり", "実績なし+予定あり", "実績なし+予定なし"];
export const APPLIED_REGS = ["新型", "継続", "なし"];
export const DEADLINE_KINDS = ["なし", "規制日", "LO"];
export const VEHICLE_APPLICATIONS = ["発生しない", "発生する（計画済み）", "発生する（未計画）"];
export const CELL_DISPLAYS = ["否", "否・予告", "実績あり", "引き継ぎ確認中", "申請発生", "判定不能"];

// LO・dropの入力状態（F-24）。空（未入力・空白だけ）かどうかだけを見る。日付として読めるかは見ない
// （入っているが読めない日付は、従来どおり「警告を弱めない側」の読み方に任せる）。
//   "LO未入力" … LOが空。要否を決める日付が無いので、全法規を「判定不能」にする（A3）
//   "drop未定" … LOはあり、dropが空。生産が続く前提で drop＝∞ として判定する（A1）。dropは空のまま（B3）
//   "入力済み" … 両方入っている。F-24より前と同じ判定（B1）
// LOもdropも空なら "LO未入力"（判定不能を優先する）。
export const DROP_INPUT_STATES = ["入力済み", "drop未定", "LO未入力"];
const isBlankDate = (s) => typeof s !== "string" || s.trim() === "";
export function dropInputStateOf(lo, drop) {
  if (isBlankDate(lo)) return "LO未入力";
  if (isBlankDate(drop)) return "drop未定";
  return "入力済み";
}

// 生産フェーズ。LO・drop・今日だけで決まり、法規には一切依存しない（＝列見出しに出せる）。
export function productionPhaseOf(lo, drop, today = TODAY) {
  const t = dateDayNumber(today), l = dateDayNumber(lo), d = dateDayNumber(drop);
  if (l !== null && t !== null && t < l) return "開発中";
  if (d !== null && t !== null && d < t) return "drop済み";
  return "生産中";   // ドロップ当日はまだ生産中（F-14のA4の境界）
}

// 期限と超過（F-19 C6）。**期限 = max（適用した規制日、LO）**。
// 認可はLOまでに要るので、規制日が先に来ていてもLOがまだなら期限はLOになる。
// 結果として「今日 < LO」のラン（開発中）は構造上いちども超過にならない。
// 読めない日付は「もう到来している」側なので、max の候補からは外す（残った側が期限になる）。
export function deadlineOf(規制日, lo, today = TODAY) {
  const t = dateDayNumber(today), r = dateDayNumber(規制日), l = dateDayNumber(lo);
  const 規制日到来 = r === null || t === null ? true : r <= t;
  const LO到来 = l === null || t === null ? true : l <= t;
  const 期限 = r === null && l === null ? { kind: "なし", date: "" }
    : r === null ? { kind: "LO", date: lo }
    : l === null ? { kind: "規制日", date: 規制日 }
    : l > r ? { kind: "LO", date: lo } : { kind: "規制日", date: 規制日 };
  return { 期限: 期限.kind, 期限日: 期限.date, 超過: 規制日到来 && LO到来, 規制日到来, LO到来 };
}

// 認可書番号から認証・予定の3状態へ。
// 単体版の「予定あり」と前例は standalone/cert-status.js が導出する（F-23）。API版は番号だけを使う。
// したがってアプリ側からは "実績あり" か "実績なし+予定なし" の2つしか渡らない。
export const certPlanOf = (ck) => (ck ? "実績あり" : "実績なし+予定なし");

// 実効の適用区分（F-19 C3）。型式ランの指定区分と同一性（F-04）から決める。
//   同一性 = 同一           → 継（継続車側の猶予を借りる）
//   同一性 = 同一でない     → 新
//   同一性 = 未確認         → 新（安全側）＋根拠未確認 = はい
//   比較元なし（同一性なし） → 指定区分（run.sk）をそのまま使う。根拠未確認 = いいえ
// 比較元を選んでいないランを「未確認」にしないのが C3 の要点。比較元が無いランは
// 同一性という問いそのものが立たないので、そのランの指定区分が正しい答えである。
// run.sk が "新" 以外（空・不正値を含む）は従来どおり継続側として扱う。
export function effectiveSideOf(run, sameness) {
  if (sameness === "同一") return { side: "継", 根拠未確認: false };
  if (sameness === "同一でない") return { side: "新", 根拠未確認: false };
  if (sameness === "未確認") return { side: "新", 根拠未確認: true };
  return { side: run?.sk === "新" ? "新" : "継", 根拠未確認: false };
}

// セル1つの業務状態。判定はこの関数だけが行う（F-19 C1）。
//   handover … 「引き継ぎ確認中」（同じ型式の過去ランに実績があり、当プロジェクトの番号は空）。
//     表示の枝分かれだけに効き、要否・期限・不適合・黄色予告には一切効かない。
//     単体版はF-23で前例から導出する。API版はfalseのまま。
export function decideCell({
  lo = "", drop = "", shin = "", kei = "", today = TODAY,
  certPlan = "実績なし+予定なし", side = "新", 根拠未確認 = false, handover = false,
} = {}) {
  const 生産フェーズ = productionPhaseOf(lo, drop, today);
  const 入力 = dropInputStateOf(lo, drop);

  // ── LO未入力（F-24 A3）：判定不能。「否」（対応不要）とは見せない（B2） ──
  //   要否を決める日付が無いので、要にも否にもしない。不適合・予告・危険のどれにも当たらない。
  if (入力 === "LO未入力") {
    return {
      生産フェーズ, 要否: "判定不能", 適用した規制: "なし", 車両申請: null, 期限: "なし",
      現在法規不適合: false, 過去に法規不適合: false, 法規適合必要: false, 黄色予告: null, 根拠未確認: !!根拠未確認,
      規制日: "", 期限日: "", 超過: false, 表示: "判定不能", drop未定: false,
    };
  }
  // drop未定（F-24 A1）：drop＝∞ として判定する。継続車規制は「要 ⇔ drop ＞ 継続車日」なので、
  // 継続車日が入っていれば常に要になる。dropの値そのものは作らない・保存しない（B3）。
  const drop未定 = 入力 === "drop未定";
  const 継続到来 = (k) => !!k && (drop未定 || k <= drop);

  // ── 要否と適用した規制（現行式をそのまま写し取る。文字列比較も現行どおり） ──
  let 適用した規制 = "なし";
  if (side === "新") {
    if (shin && shin <= lo) 適用した規制 = "新型";
    else if (継続到来(kei)) 適用した規制 = "継続";
  } else {
    if (継続到来(kei)) 適用した規制 = "継続";
  }
  const 要 = 適用した規制 !== "なし";
  const 要否 = 要 ? "要" : "否";
  // 規制日：適用した側の日付。否のセルは従来の dueDate と同じく継続車規制日を返す。
  const 規制日 = 適用した規制 === "新型" ? shin : kei;

  // ── 期限と超過 ──
  const dl = 要 ? deadlineOf(規制日, lo, today) : { 期限: "なし", 期限日: "", 超過: false };
  const 超過 = dl.超過;

  // ── 車両申請（要のときだけ見る。否のセルは申請そのものが起きないので null） ──
  const 実績あり = certPlan === "実績あり";
  const 車両申請 = !要 ? null
    : 実績あり ? "発生しない"
    : certPlan === "実績なし+予定あり" ? "発生する（計画済み）" : "発生する（未計画）";

  // ── 不適合の3状態（排他。要・実績なしのセルのどれか1つに必ず当たる） ──
  const 現在法規不適合 = 要 && !実績あり && 超過 && 生産フェーズ === "生産中";
  const 過去に法規不適合 = 要 && !実績あり && 超過 && 生産フェーズ === "drop済み";
  const 法規適合必要 = 要 && !実績あり && !超過;

  // ── 黄色の30日接近予告 ──
  //   否 かつ 実績なし かつ 0 < 継続車規制日 − drop ≤ 30。実効区分では絞らない
  //   （新ランでも「否」なら継続車側で逃げている状態なので、同じ危険がある）。
  //   加えて F-15：継続車規制日 ≤ 今日（もう過ぎた組み合わせ）には出さない
  //   （黄色は これから来る規制日の予告 であるため。2026-09-22 祥の判断でF-19でも維持）。
  //   はい／いいえだけでなく画面に出す日数・日付も要るので、はい＝オブジェクト／いいえ＝null で返す。
  //   drop未定（∞）には「dropの後30日」という窓が無いので、窓は読めない＝予告なし（F-24）。
  const 窓 = approachingKeiDays(drop, kei);
  const keiDay = dateDayNumber(kei), todayDay = dateDayNumber(today);
  const 黄色予告 = !要 && !実績あり && 窓 !== null &&
    keiDay !== null && todayDay !== null && keiDay > todayDay
    ? { days: 窓, keiDate: kei } : null;

  // ── 表示区分（C4。セルの色も文言もこの1語から決まる） ──
  const 表示 = !要 ? (黄色予告 ? "否・予告" : "否")
    : 実績あり ? (handover ? "引き継ぎ確認中" : "実績あり")
    : "申請発生";

  return {
    生産フェーズ, 要否, 適用した規制, 車両申請, 期限: dl.期限,
    現在法規不適合, 過去に法規不適合, 法規適合必要, 黄色予告, 根拠未確認: !!根拠未確認,
    規制日, 期限日: dl.期限日, 超過, 表示,
    // drop未定（F-24 A2）：drop＝∞ の仮定で判定したセル。表示の印に使うだけで、上の判定には効かない。
    drop未定,
  };
}

// ───────────────────────────────────────────────
// セル1つぶんの判定（決定表の薄い包み）。API版・単体版の両方がここを参照する（二重管理をしないため）。
//
// sameness（省略可）… 比較元との同一性（F-04）。省略・null は「比較元なし」＝指定区分をそのまま使う。
//   "同一"       … 過渡規定で継続車側の規制日を適用する
//   "同一でない" … 新型車側の規制日を適用する
//   "未確認"     … 新型車側で判定する（安全側。F-19 C3）
// 戻り値の applied は、同一性によって適用する側を決めたときだけ "継続車日" / "新型車日" を持つ（それ以外は ""）。
//
// 戻り値の形は従来のまま（required / kind / ck / status / dueDate / applied）で、決定表の出力そのものは載せない。
// ここに項目を足すと、この戻り値を丸ごと比べている既存の検証が「中身は同じなのに落ちる」ためである。
// 画面が使う決定表の出力は buildCellModel が同じ decideCell から作る（＝規則の実装は1つのまま）。
// ───────────────────────────────────────────────
// API版の入力。cert は型式ラン × 法規行の配列（F-22）。このランのこの法規行の管理番号だけを読む
// （同じ型式の別ランも、比較元の型式も読まない）。空白だけの番号は従来どおり「実績あり」（trimしない）。
export const evalCellWith = (cert, run, r, sameness, today = TODAY) => {
  const ck = findCert(cert, run.key, r.rid)?.ck || null;
  return evalCellInputs(run, r, sameness, today, { ck, certPlan: certPlanOf(ck) });
};

// 決定表への入力を組み立てた後の共通評価。API版の入力は従来どおり、単体版はF-23で導出する。
export function evalCellInputs(run, r, sameness, today, { ck, certPlan, handover = false }) {
  const applied = sameness==="同一" ? "継続車日" : sameness==="同一でない" ? "新型車日" : "";
  const { side, 根拠未確認 } = effectiveSideOf(run, sameness);
  const d = decideCell({
    lo: run.lo, drop: run.drop, shin: r.shin, kei: r.kei, today,
    certPlan, handover, side, 根拠未確認,
  });
  const required = d.要否 === "要";
  const kind = d.適用した規制 === "なし" ? "" : d.適用した規制;
  // "unknown" … 判定不能（LO未入力・F-24 A3）。否（"off"）とは区別する。
  const status = d.表示 === "判定不能" ? "unknown" : !required ? "off" : certPlan === "実績あり" ? "ok" : "leak";
  return { required, kind, ck, status, dueDate: d.規制日, applied };
}

// ───────────────────────────────────────────────
// 黄色の30日接近予告の窓（1〜30暦日）。決定表がこの窓を使う。
//
// 条件：ドロップ日(run.drop)の後、1〜30暦日以内に継続車規制日(r.kei)が来る場合。
//   ・0日（同日）・負数（ドロップ日以前）・31日以上は対象外（黄色にしない）。
//   ・drop・kei のいずれかが欠落／不正な日付形式なら「対象外」として扱う
//     （安全側＝黄色を出さない。欠落・不正日付を「安全」とは表示しない＝
//      呼び出し側は notice=null のとき何も表示しないだけで、
//      「問題なし」の意味を持つ表示は一切出さない）。
// ───────────────────────────────────────────────
// 対象外・不正のときは null（＝「安全」ではなく「注記なし」を意味する。呼び出し側で判定すること）。
export function approachingKeiDays(dropStr, keiStr) {
  const dropDay = dateDayNumber(dropStr);
  const keiDay = dateDayNumber(keiStr);
  if (dropDay === null || keiDay === null) return null;
  const diff = keiDay - dropDay;
  if (diff < 1 || diff > 30) return null;
  return diff;
}

// セル1つぶんの黄色注記（決定表の薄い包み）。status が "off" 以外（ok/leak）には常に null を返す
// （赤・緑の判定を黄色で弱めない）。窓・F-15の過去分の除外・実績なしのゲートは decideCell の中にある。
// 認可書実績を受け取らない入口なので「実績なし」として決定表へ渡す
// （実績を見た判定は evalCellWith 側の decision.黄色予告 が持つ）。
export function approachingNoticeFor(cellStatus, run, r, today = TODAY) {
  if (cellStatus !== "off") return null;
  // LOも渡す（F-24）：LOが空のランは判定不能で、予告も出さない。
  return decideCell({ lo: run?.lo, drop: run?.drop, kei: r?.kei, today, side: "継",
    certPlan: "実績なし+予定なし" }).黄色予告;
}

// ───────────────────────────────────────────────
// 期日超過の状態分け（F-14）
//
// 申請発生（status="leak"）のセルを、既存の 期日・ドロップ日・人の適用判断 だけから
// 4状態へ一意に分類する。新しい日付データ・基準日は追加しない。
// 人の「対象外」がここで効くのは、この状態表示だけに限る（セルの色・要否・集計には関与しない）。
//
// F-19以降：ここは **判定をしない**。決定表と同じ deadlineOf / productionPhaseOf を読み、
// その結果を4状態の名前へ読み替えるだけの入口である（呼ばれるのは「要・実績なし」のセルだけ）。
//   超過でない         … 橙「要対応｜{期限}まで」。期限 = max（期日、LO）なので、
//                        期日が先でもLOがもっと先ならLOを出す（F-19 C6）。
//   超過・drop済み・期日≤drop … 灰「過去に法規不適合（drop済み）」
//   超過・drop済み・期日>drop … 灰「drop済み（対応対象外）」
//   超過・生産中       … 赤「法規不適合」（ドロップ当日はまだ生産中＝こちら）
//
// 「過去に法規不適合」について（2026-09-20 祥の判断）：要になったセルは要否の式から必ず「期日 ≤ drop」が
// 成り立つ。つまりドロップ済みセルのほぼすべてが、「規制日が来たあともドロップまで生産を続け、その間ずっと
// 実績が無かった」＝過去に不適合だった記録である。「対応対象外」とだけ書くと、はじめから問題が無かったように
// 読めてしまうため、事実を文言に残す。色は灰のまま（いまから手を打てる対象ではない）。
// 「期日 > drop」＝規制日が来る前にドロップしていた場合だけが、本当に何も起きなかったケースになる。
//
// 日付が読めないとき（欠落・不正形式・実在しない日付）は、警告を弱めない側へ寄せる：
//   ・期日が読めない → 「過ぎている」側として扱う（従来の文字列比較と同じ結果になる）
//   ・dropが読めない → 「まだ生産中」側として扱う（灰色にして警告を弱めない）
//   ・LOが読めない   → 「もうLOを迎えている」側として扱う（橙にして警告を弱めない）
// ───────────────────────────────────────────────
export const ORANGE = "#ff9f43";   // 要対応（赤・黄とは別系統の橙）
export const GRAY = "#9aabbd";     // drop済み・対象外（暗い背景でも読める灰）
export const COMPLIANCE_STATES = ["対象外", "過去不適合", "drop済み", "法規不適合", "要対応"];

// 決定表の出力を4状態の名前へ読み替えるだけの関数。**ここでは判定をしない。**
// 呼ばれるのは「要・実績なし」と決まった申請発生セルだけ。決定表の出力との対応は1対1になる。
//   超過でない     … 橙「要対応｜{期限}まで」（期限 = max（期日、LO）＝決定表の出力そのまま）＝法規適合必要
//   超過・drop済み … 灰「過去に法規不適合（drop済み）」／「drop済み（対応対象外）」＝過去に法規不適合
//   超過・生産中   … 赤「法規不適合」＝現在法規不適合
// 開発中は構造上いちども超過にならないので、開発中のセルは必ず「要対応」側に入る。
//
// 「過去に法規不適合」と「drop済み（対応対象外）」の分けだけは決定表に項目が無いので、
// 期日とドロップ日から決める。要になったセルは要否の式から必ず「期日 ≤ drop」が成り立つため、
// 決定表が前提にする並び（LO < drop）では常に「過去に法規不適合」側になる。
// 「期日 > drop」＝規制日が来る前にドロップしていた、は不自然なデータでしか起きない。
// 判断できないとき（日付が読めない）は事実を残す側へ寄せる。
// 文言は TEXT.compliance（F-18でまとめた辞書）から引く。
export function complianceOfDecision(d, { lo, drop, dueDate, decisionState } = {}) {
  // 人の判断＝対象外は判定ではなく表示の上書き（決定表には人の判断という入力が無い）。
  if (decisionState === "対象外") return { state:"対象外", label:TEXT.compliance.対象外(), color:GRAY };
  if (!d.超過) return d.期限 === "LO"
    ? { state:"要対応", label:TEXT.compliance.要対応LO(lo), color:ORANGE }
    : { state:"要対応", label:TEXT.compliance.要対応期日(d.期限日), color:ORANGE };
  if (d.生産フェーズ === "drop済み") {
    const dueDay = dateDayNumber(dueDate), dropDay = dateDayNumber(drop);
    const producedAfterDue = dueDay === null || dropDay === null || dueDay <= dropDay;
    return producedAfterDue
      ? { state:"過去不適合", label:TEXT.compliance.過去不適合(), color:GRAY }
      : { state:"drop済み", label:TEXT.compliance.drop済み(), color:GRAY };
  }
  return { state:"法規不適合", label:TEXT.compliance.法規不適合(), color:RED };
}

// 決定表の出力を持っていない呼び出し側（同一性の行など）のための入口。
// 決定表とまったく同じ deadlineOf / productionPhaseOf から同じ見方を作って上の関数へ渡すので、
// 帳票セル（decideCell の出力から描く側）と結果が食い違うことは起こらない。
export function complianceStateOf({ dueDate, drop, lo, decisionState, today = TODAY }) {
  const dl = deadlineOf(dueDate, lo, today);
  const view = { 超過: dl.超過, 期限: dl.期限, 期限日: dl.期限日,
    生産フェーズ: productionPhaseOf(lo, drop, today) };
  return complianceOfDecision(view, { lo, drop, dueDate, decisionState });
}

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

// 帳票の集計（漏れ一覧と実効ドロップ）。単体版は専用の入力評価を渡し、省略時はAPI版の評価を使う。
// samenessFor(run, reg) は省略可（F-04の同一性。省略時は従来どおり）。
export const summarize = (runs, regs, cert, samenessFor, evaluate) => {
  const leaks=[], effDrop={};
  for (const run of runs) {
    let earliest=null;
    for (const r of regs) {
      const c = evaluate ? evaluate(run, r) : evalCellWith(cert, run, r, samenessFor ? samenessFor(run, r) : undefined);
      if (c.status==="leak") {
        // rid は人の適用判断（decisions）を引くための内部キー。法規ID(r.id)は空・重複がありうるので使わない。
        leaks.push({ run, reg:r.id, rid:r.rid, kind:c.kind, dueDate:c.dueDate });
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

// ───────────────────────────────────────────────
// 全セル（型式ラン × 法規行）の判定結果をまとめて作る（F-18）
//
// 目的：判定の二重実装を、規約ではなく構造で不可能にする。
// セル1つぶんの結果を作る場所をここ1箇所にし、**画面（マトリクスのセル・コンプラ漏れ一覧）は
// この結果を描くだけ**にする。描画の中で evalCell / approachingNoticeFor / complianceStateOf を
// 呼び直さないので、画面ごとに条件がずれることが起きない。
//
// ここでは新しい判定をしない。既存の関数（要否＝evalCell、接近予告＝F-15、状態＝F-14、
// 同一性＝F-04、根拠＝F-12）を呼んで、その結果を1つのオブジェクトにまとめるだけ。
//
//   evalCell  … 呼び出し側の判定関数（API版は認可書だけ、単体版は同一性つき）。ここでは呼ぶだけで作らない
//   decisions … 人の適用判断。配列を渡したときだけ dec を持つ（API版は渡さない＝null のまま）
//   sameCtx   … 同一性（F-04・単体版のみ）。省略時は same 系が null
//   basisCtx  … 根拠（F-12・単体版のみ）。省略時は basis が null
//
// 戻り値
//   list          … 全セルの結果（runs の順 × regs の順）
//   get(run, reg) … 1セルの結果（無ければ null）
//
// 索引のキーは **型式ラン・法規行のオブジェクトそのもの**にする（rid や run.key の文字列では引かない）。
// 文字列で覚えると、キーが重複しているデータで別の行の結果に上書きされ、
// 「セルごとにその場で判定していたとき」と違う結果を描いてしまう。
// API版の読込（isValidData ＋ planRegKeys）は形だけを見るので、重複した rid・key を受理しうる。
// 同じ理由で makeBasisContext も行オブジェクトをキーにしている（F-12のレビュー指摘1）。
// ───────────────────────────────────────────────
export function buildCellModel({ runs, regs, evalCell, decisions = null, sameCtx = null, basisCtx = null, today = TODAY }) {
  const judge = Array.isArray(decisions);
  const decIdx = judge ? decisionIndex(decisions) : null;
  const byRun = new Map();   // run（オブジェクト）→ reg（オブジェクト）→ セルの結果
  const phases = new Map();  // run（オブジェクト）→ 生産フェーズ（列見出し用・C5）
  const alerts = new Map();  // run（オブジェクト）→ ラン単位の異常（F-24 A4）。無ければ入れない
  const list = [];
  for (const run of runs || []) {
    const m = new Map();
    for (const reg of regs || []) {
      const auto = evalCell(run, reg);
      // 決定表（F-19）の出力。evalCell が載せてくる＝ここで判定をやり直さない。
      // 画面はこの1つの結果から描く：要否も黄色予告も4状態も生産フェーズも、すべてここから出る。
      // 単体版はF-23の前例・取得予定から入力を導出する。API版は従来どおり番号だけを使う。
      const decision = decideCell({
        lo: run.lo, drop: run.drop, shin: reg.shin, kei: reg.kei, today,
        certPlan: auto.certPlan ?? certPlanOf(auto.ck), handover: !!auto.handover,
        ...effectiveSideOf(run, sameCtx ? sameCtx.effective(run, reg) : null),
      });
      // 黄色の接近予告（窓＋F-15の過去分の除外＋実績なしのゲート）。決定表が「いいえ」なら null。
      const notice = auto.status === "off" ? decision.黄色予告 : null;
      // 人の適用判断（判断機能が無い版では null のまま＝何も描画しない）
      const dec = decIdx ? findDecision(decIdx, run.key, reg.rid) : null;
      // 期日超過の4状態（F-14）。申請発生のセルにしか出ないので、それ以外は null。
      const compliance = auto.status === "leak"
        ? complianceOfDecision(decision,
            { lo: run.lo, drop: run.drop, dueDate: auto.dueDate, decisionState: dec?.state })
        : null;
      // 同一性（F-04）：比較元を選んだランの列だけに印を出す。
      const base = sameCtx ? sameCtx.base(run) : null;
      // 比較元が未選択でも、回答や要再確認が残っているセルには出す（警告を隠さない）
      const sameRec = sameCtx ? sameCtx.rec(run, reg) : null;
      const sameness = sameCtx ? sameCtx.effective(run, reg) : null;
      // 同一性の答えで判定が何も変わらないセルには、行そのものを出さない（選ばせない）。
      // 保存済みの回答・要再確認は記録としては残るが、画面には出さない（2026-09-20 祥の判断）。
      const showSame = !!base && samenessAffects(run, reg) && (base.state !== "none" ||
        (!!sameRec && (sameRec.needsRecheck || sameRec.value !== "未確認")));
      // 根拠（F-12）：継続車日を借りているセルだけ。判定・色・期日・要再確認には一切関与しない。
      const basis = basisCtx ? basisCtx.of(run, reg) : null;
      // 危険（F-10）：決定表の出力の2つだけを読む。危険でないセルは null。
      const risk = riskOfCell(decision, today);
      const entry = { run, reg, auto, decision, notice, dec, compliance, base, sameRec, sameness, showSame, basis, risk };
      m.set(reg, entry);
      list.push(entry);
    }
    byRun.set(run, m);
    // 生産フェーズ（C5）は法規行に依存しないので、そのランのどのセルから取っても同じ値になる。
    // 法規が1行も無いときだけ決定表を直接呼ぶ（そのときは列見出し自体が描かれないが、値は返せるようにする）。
    const phase = m.size > 0
      ? m.values().next().value.decision.生産フェーズ
      : productionPhaseOf(run.lo, run.drop, today);
    phases.set(run, phase);
    // ラン単位の異常（F-24 A4）：LOを迎えた（今日を含む）のにdropが空。実務ではdropが決まっているはずなので入力漏れ。
    // 日付をここで比べ直さない：dropが空なら drop済み にはならないので、「開発中でない」＝LO ≤ 今日 である
    // （LOが読めない日付のときも「もう迎えている」側＝異常として出す。警告を弱めない側）。
    // 法規の日付とは無関係に立つ＝継続車日がまだ先の法規しか無いランでも出る（F-24 決めたこと 案b）。
    if (dropInputStateOf(run.lo, run.drop) === "drop未定" && phase !== "開発中") alerts.set(run, "drop未入力");
  }
  return {
    list,
    get: (run, reg) => byRun.get(run)?.get(reg) || null,
    // 型式ランの列見出しに出す1語（C5）。セルの状態名とは混ぜない。
    phaseOf: (run) => phases.get(run) || null,
    // ラン単位の異常（F-24 A4）。"drop未入力" か null。
    alertOf: (run) => alerts.get(run) || null,
    // 集約した型式ラン（入力の順）。法規が0件でもラン単位の異常を一覧へ出すために使う（Codexレビュー指摘1）。
    runs: [...(runs || [])],
  };
}

// ───────────────────────────────────────────────
// 危険な型式ランの一覧（F-10）
//
// ここは **判定をしない**。decideCell の出力のうち次の2つが「はい」のセルだけを危険とし（A1）、
// 画面に出す日数を数えるだけである。要否・期限・生産フェーズ・実績の有無をここで見直さない。
//
//   現在法規不適合 = はい … 要かつ実績なしかつ超過かつ生産中
//   黄色予告       = はい … 否かつ実績なしかつ 0 < 継続車規制日 − drop ≤ 30 かつ 継続車規制日 > 今日
//
// 出さないものと理由（2026-09-23の決定。別のゲートを足さない）：
//   ・法規適合必要（超過前）… これから対応する正常な状態で、件数が多すぎて検出の意味がなくなる
//   ・過去に法規不適合（drop済み）… いま手を打てない。状態自体はマトリクスに残る
// この2条件から自動的に導かれること：
//   ・開発中（今日 < LO）のランは構造上いちども超過にならない（期限 = max(規制日, LO)・F-19 C6）ので、
//     現在法規不適合では出ない。黄色予告では出うる。
//   ・drop済みのランの「要」のセルは 過去に法規不適合 になるので出ない。
//     ただし **ドロップが30日以内の過去で、継続車規制日がこれから来る**セルは黄色予告の条件を満たすので出る
//     （ドロップが延びれば引っかかる、という予告そのもの）。F-10ページの導出はここまで書き分けていないが、
//     A1は「決定表の出力が はい のセルだけ・別のゲートを足さない」なので、そのまま出している。
//   ・同一性切れは実効の適用区分を経て要否に反映済みなので、独立の条件にしない。
//
// ■ 日数（A3）。主語を状態ごとに変える（「規制日まで何日超過」のような混ざった言い方をしない）。
//   現在法規不適合 … 期限を過ぎて n 日（n = 今日 − 期限日。期限日 = max(規制日, LO)。当日は0）
//   黄色予告       … 継続車規制日まで n 日（n = 継続車規制日 − 今日）。dropの何日後かは決定表の窓の値
//
// ■ 並べ替えに使う「切迫度」（urgency）は、上の日数を1本の数直線へ載せ直したもの。
//   超過は負、これからは正。小さいほど切迫している。**新しい判定ではなく日数の言い換え**である。
//   期限日・継続車規制日が読めないときは null（＝最後に並べる。日数も出さない）。
// ───────────────────────────────────────────────
export const RISK_KINDS = ["不適合", "予告"];

export function riskOfCell(decision, today = TODAY) {
  const t = dateDayNumber(today);
  if (decision?.現在法規不適合) {
    const d = dateDayNumber(decision.期限日);
    const days = d === null || t === null ? null : t - d;     // 期限を過ぎて n 日（当日＝0）
    return { kind: "不適合", days, afterDrop: null, urgency: days === null ? null : -days };
  }
  const y = decision?.黄色予告;
  if (y) {
    const k = dateDayNumber(y.keiDate);
    const days = k === null || t === null ? null : k - t;     // 継続車規制日まで n 日
    return { kind: "予告", days, afterDrop: y.days, urgency: days };
  }
  return null;
}

// 切迫している順（A3）。小さい＝切迫。日数が読めない行は最後。
// 同点のときは不適合を先にする（数の上では超過が必ず 0 以下・予告が 1 以上なので
// 実際には日数が読めない行どうしでしか起きないが、規則として明示しておく）。
const RISK_RANK = { 不適合: 0, 予告: 1, drop未入力: 2 };
const cmpUrgency = (a, b) => {
  if (a.urgency === null && b.urgency === null) return RISK_RANK[a.kind] - RISK_RANK[b.kind];
  if (a.urgency === null) return 1;
  if (b.urgency === null) return -1;
  if (a.urgency !== b.urgency) return a.urgency - b.urgency;
  return RISK_RANK[a.kind] - RISK_RANK[b.kind];
};

// 型式ラン単位で束ねた一覧の行（A2）。1行＝1型式ラン、展開するとそのランの危険な法規が並ぶ。
//
//   model … buildCellModel の集約結果（帳票のセルと同じもの）
//   runs  … 並べる対象の型式ラン（F-02の表示フィルターを通した visibleRuns。省略＝全ラン）。
//           **型式ランのオブジェクトで絞る**（key は外部JSON経由で重複しうるため文字列では引かない）。
//
// 法規行の順序は model.list の順（runs の順 × regs の順）を保ったまま切迫度で並べ替える
// （Array.prototype.sort は安定なので、同じ切迫度の行は元の法規順のまま残る）。
//
// ラン単位の異常（F-24 A4「drop未入力（LO済み）」）は、危険な法規が1つも無いランでも行を出す。
// 1ランにつき1つの印（alert）で持ち、cells には入れない＝法規単位の件数に混ざらない（B6）。
// 危険な法規もあるランでは、その行に印が付くだけ（行は増えない）。
// 危険な法規が1つも無いランは切迫度が無い（null）ので、日数が読めない行と同じく最後に並ぶ。
// ラン単位の異常はセルではなくランから拾う（法規が0件のデータでも出す。Codexレビュー指摘1）。
export function riskRunRows(model, { runs = null } = {}) {
  const allow = runs ? new Set(runs) : null;
  const cellsOf = new Map();
  for (const m of model.list) {
    if (!m.risk) continue;
    if (!cellsOf.has(m.run)) cellsOf.set(m.run, []);
    cellsOf.get(m.run).push(m);
  }
  // 並びは model のランの順（＝F-24より前と同じ model.list の順）。同じランは1回だけ。
  const order = new Set(model.runs || model.list.map((m) => m.run));
  const byRun = new Map();
  for (const run of order) {
    if (allow && !allow.has(run)) continue;
    const cells = cellsOf.get(run) || [];
    if (cells.length > 0 || model.alertOf?.(run)) byRun.set(run, cells);
  }
  const rows = [];
  for (const [run, cells] of byRun) {
    cells.sort((a, b) => cmpUrgency(a.risk, b.risk));
    const bad = cells.filter((m) => m.risk.kind === "不適合").length;
    const alert = model.alertOf?.(run) || null;
    // 最も切迫した法規行（並べ替え済みなので先頭）。危険な法規が無いラン（異常だけ）は null。
    const head = cells.length > 0 ? cells[0].risk : { kind: alert, urgency: null };
    rows.push({
      run, phase: model.phaseOf(run), cells,
      bad, warn: cells.length - bad,
      kind: head.kind, urgency: head.urgency, top: cells.length > 0 ? head : null,
      alert,
      // A9：同一性が未確認（比較元があるのに未回答）のセルを含むか。印だけで、並べる条件には効かない。
      unconfirmed: cells.some((m) => m.decision.根拠未確認),
    });
  }
  rows.sort(cmpUrgency);
  return rows;
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
// **ここでは判定も日付比較もしない**（A5）。buildCellModel の集約結果を riskRunRows で
// 束ねて並べたものを、そのまま描くだけである。文言はすべて TEXT（F-18の辞書）から引く。
// 色も既存の系統をそのまま使う（赤＝法規不適合・橙＝黄色予告・青＝同一性）。
//
// 開閉・展開は一時的なUI状態で、保存形式にも dirty にも関与しない（既定は閉じた状態＝A6）。

// 日数（A3）。主語は状態ごとに変える。読めない日付は日数を出さず、そう書く。
function RiskDays({ risk, bold = true }) {
  if (risk.days === null) return <span style={{ color:MUTE }}>{TEXT.risk.日数不明}</span>;
  return risk.kind === "不適合"
    ? <span style={{ color:RED, fontWeight: bold ? 800 : 600 }}>{TEXT.risk.超過日数(risk.days)}</span>
    : <span style={{ color:AMBER, fontWeight: bold ? 800 : 600 }}>{TEXT.risk.予告日数(risk.days, risk.afterDrop)}</span>;
}

// 状態。帳票のセルと同じ状態名を出す（A7：マトリクスの状態と一覧の状態が一致する）。
//   不適合の行 … F-14の4状態（人が対象外と判断していればその表示になる。判断は一覧に出すか否かには効かない）
//   予告の行   … 帳票セルと同じ「否・要再確認」
function RiskState({ m }) {
  if (m.risk.kind === "予告")
    return <span style={{ fontSize:11, fontWeight:700, color:AMBER }}>{TEXT.cell.否要再確認}</span>;
  return m.compliance
    ? <ComplianceLabel s={m.compliance} fontSize={11} />
    : <span style={{ fontSize:11, fontWeight:800, color:RED }}>{TEXT.compliance.法規不適合()}</span>;
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

function RiskPanel({ rows, filterActive, shownRuns, totalRuns }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState([]);   // 展開中の型式ラン（オブジェクトで持つ。key は重複しうる）
  const cellCount = rows.reduce((n, r) => n + r.cells.length, 0);
  const isOpen = (run) => expanded.includes(run);
  const toggle = (run) => setExpanded(isOpen(run) ? expanded.filter((x) => x !== run) : [...expanded, run]);
  const allOpen = rows.length > 0 && rows.every((r) => isOpen(r.run));
  const hasRisk = rows.length > 0;
  const MARK_TITLE = "比較元を選んでいるのに同一性が未回答のセルを含みます。判定は安全側（新型車側）で出しています。";
  return (
    <div style={{ background:PANEL, border:`1px solid ${hasRisk ? `${RED}66` : LINE}`, borderRadius:10, padding:"9px 12px", marginBottom:10 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <button onClick={()=>setOpen(!open)}
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
          {!hasRisk ? (
            /* 件数の欄がすでに「該当なし」と言っているので、ここでは繰り返さず説明だけを残す */
            <p style={{ color:MUTE, fontSize:11, margin:"6px 0" }}>
              表示中の型式ランには、下の2条件に当たるセルがありません。
            </p>
          ) : (
          <>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
            <button onClick={()=>setExpanded(allOpen ? [] : rows.map((r)=>r.run))} style={{ ...miniBtn, marginTop:0 }}>
              {allOpen ? "すべてたたむ" : "すべて展開"}
            </button>
            <span style={{ fontSize:10, color:MUTE }}>切迫している順（超過が上）に並べています</span>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={tbl}>
              <thead><tr>
                <th style={th}>法規</th><th style={th}>状態</th><th style={th}>適用した規制</th>
                <th style={th}>規制日</th><th style={th}>期限</th><th style={th}>日数</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <React.Fragment key={`run:${i}`}>
                    {/* ラン行（A2）。人は「どの車が危ないか」を先に見るので、法規より先に型式ランを出す。 */}
                    <tr>
                      <td colSpan={6} style={{ ...td, background:"rgba(90,107,125,0.10)", padding:"7px 8px" }}>
                        <button onClick={()=>toggle(r.run)}
                          style={{ display:"inline-flex", alignItems:"center", gap:6, background:"transparent", border:"none",
                            padding:0, color:"#eef4fa", fontSize:11.5, cursor:"pointer", fontFamily:"inherit", textAlign:"left" }}>
                          <span style={{ color:MUTE, fontSize:9 }}>{isOpen(r.run) ? "▼" : "▶"}</span>
                          <span style={{ fontSize:10.5, color:"#8fa3b8" }}>{r.run.gen || "（コード未設定）"}</span>
                          <span style={{ fontFamily:"ui-monospace,monospace", fontWeight:700 }}>{r.run.typeId || "（型式未設定）"}</span>
                          <span style={{ fontSize:9.5, padding:"1px 6px", borderRadius:999, color:"#8fa3b8",
                            border:`1px solid ${LINE}`, background:"rgba(90,107,125,0.12)", fontWeight:700 }}>
                            {TEXT.phase[r.phase] || ""}</span>
                          <span style={{ fontSize:9.5, color:MUTE, fontFamily:"ui-monospace,monospace" }}>
                            LO {fmt(r.run.lo)}・drop {fmt(r.run.drop)}</span>
                        </button>
                        {r.alert && <DropMissingMark />}
                        {r.top && <>
                          <span style={{ marginLeft:10, fontSize:10.5, color:"#aab8c6" }}>{TEXT.risk.内訳(r.bad, r.warn)}</span>
                          <span style={{ marginLeft:10, fontSize:10.5 }}><RiskDays risk={r.top} /></span></>}
                        {r.unconfirmed && <SamenessUnknownMark title={MARK_TITLE} />}
                      </td>
                    </tr>
                    {/* 法規行（展開したときだけ）。並びはそのランの中で切迫している順。 */}
                    {isOpen(r.run) && r.cells.map((m, j) => (
                      <tr key={`cell:${i}:${j}`}>
                        <td style={{ ...td, fontSize:11.5, color:"#eef4fa", paddingLeft:26 }}>
                          {m.reg.id}<div style={{ fontSize:9, color:MUTE }}>{m.reg.label}</div>
                        </td>
                        <td style={td}>
                          <RiskState m={m} />
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
              </tbody>
            </table>
          </div>
          </>)}
          {/* 凡例。状態名は辞書から引く（ここで文字列を書くと、辞書を直したときに説明だけ古い名前が残る）。
              「要対応」は辞書が日付つきの文言しか持たない（TEXT.compliance.要対応期日／要対応LO）ので、
              その族の呼び名としてかぎ括弧で書いている。 */}
          <div style={{ marginTop:8, fontSize:10, color:MUTE, lineHeight:1.7 }}>
            並ぶのは <b style={{ color:RED }}>{TEXT.compliance.法規不適合()}（いま生産中・期限を過ぎている・実績なし）</b> と
            <b style={{ color:AMBER }}>{TEXT.cell.否要再確認}（ドロップ後30日以内にこれから継続規制が来る）</b> の
            2つだけです。<b>これから対応する「要対応」の分と、{TEXT.compliance.過去不適合()}は出しません</b>
            （前者は件数が多すぎて検出の意味がなくなり、後者はいま手を打てないため）。
            まだラインオフしていないランは期限がLOになるため、{TEXT.compliance.法規不適合()}では出ません。
            ドロップ済みのランでも、<b>ドロップ直後にこれから継続規制が来る</b>場合は予告として出ます（ドロップが延びれば引っかかるため）。
            dropが空のランは<b>生産が続く前提（drop＝∞）</b>で同じ2条件に通し、出た行に
            <span style={{ display:"inline-flex", verticalAlign:"middle" }}><DropUndecidedMark /></span> を付けます。
            <b>LOを迎えたのにdropが空</b>のランは入力漏れとして、法規に関係なくラン単位で
            <b style={{ color:RED }}>{TEXT.risk.drop未入力}</b> を出します（法規の件数には数えません）。
            LOが空のランは判定不能なので出しません（帳票のセルに出ます）。
            状態・規制日・期限は<b>帳票のセルとまったく同じ判定結果</b>で、ここでは束ねて並べているだけです。
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

  // 法規が0件でも、ラン単位の異常（F-24 A4「drop未入力（LO済み）」）は危険一覧に出す（Codexレビュー指摘1）。
  const riskOnly = riskRows.length > 0
    ? <RiskPanel rows={riskRows} filterActive={filterActive} shownRuns={visibleRuns.length} totalRuns={runs.length} />
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
      <RiskPanel rows={riskRows} filterActive={filterActive} shownRuns={visibleRuns.length} totalRuns={runs.length} />
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
                {/* 生産フェーズ（F-19 C5）。LO・drop・今日だけで決まる1語で、セルの状態名とは混ぜない。 */}
                <div style={{ fontSize:9.5, margin:"2px 0" }}>
                  <span style={{ display:"inline-block", padding:"1px 6px", borderRadius:999, color:"#8fa3b8",
                    border:`1px solid ${LINE}`, background:"rgba(90,107,125,0.12)", fontWeight:700 }}>
                    {TEXT.phase[model.phaseOf(run)] || ""}</span>
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
