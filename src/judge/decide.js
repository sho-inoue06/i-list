// 判定の決定表（decideCell）と、その出力の読み替え（期日超過の状態分け・黄色の接近予告・帳票の集計）。
// セル1つの業務状態を決めるのはここだけ。

import { GRAY, ORANGE, RED, TEXT } from "./labels.js";
import { TODAY, dateDayNumber } from "./dates.js";
import { findCert } from "./cert.js";

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
