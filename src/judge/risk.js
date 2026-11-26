// 全セルの判定結果のまとめ（buildCellModel）と、危険な型式ランの一覧・区分見出し（riskOfCell・riskRunRows・riskSections）。

import { TODAY, dateDayNumber } from "./dates.js";
import { decisionIndex, findDecision, recheckReasons } from "./decisions.js";
import { certPlanOf, complianceOfDecision, decideCell, dropInputStateOf, effectiveSideOf, productionPhaseOf } from "./decide.js";
import { samenessAffects } from "./sameness.js";

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
      // 危険（F-10・F-26）：決定表の出力だけで3区分のどれかに入れる。どれにも入らないセルは null。
      const risk = riskOfCell(decision, today);
      // 危険一覧の補助表示（F-28）。どちらも表示の導出だけで、判定・区分・保存データには関与しない（B1・B2）。
      //   exemptMark … 人の適用判断が「対象外」のセルの印。要再確認の見方は帳票の「人：」行と同じ
      //                （保存済みのフラグ＋いま条件から導かれる理由。掃き出し前でも取りこぼさない）
      //   riskCompliance … 危険一覧の状態表示。人の対象外で灰に上書きせず、決定表の結果のまま出す（赤を薄くしない）
      const exemptMark = risk && dec?.state === "対象外"
        ? (dec.needsRecheck || recheckReasons(dec, run, reg, regs).length > 0 ? "対象外・要再確認" : "対象外")
        : null;
      const riskCompliance = risk && auto.status === "leak"
        ? complianceOfDecision(decision, { lo: run.lo, drop: run.drop, dueDate: auto.dueDate })
        : null;
      const entry = { run, reg, auto, decision, notice, dec, compliance, base, sameRec, sameness, showSame, basis, risk,
        exemptMark, riskCompliance };
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
// 危険な型式ランの一覧（F-10・F-26）
//
// ここは **判定をしない**。decideCell の出力だけを読んでセルを3区分のどれかに入れ、
// 画面に出す日数を数えるだけである。要否・期限・生産フェーズ・実績の有無をここで見直さない。
//
//   共通ゲート（F-26 A1）… 生産フェーズ = drop済み のセルは、どの区分にも入れない（マトリクスには残る）
//   期限超過（kind 不適合）… 現在法規不適合 = はい（要かつ実績なしかつ超過かつ生産中）
//   期限前・未取得（kind 期限前）… 法規適合必要 = はい（要かつ実績なしかつ未超過）。開発中のランも入る。
//                       ○ありの「計画済み」の印は、画面が決定表の車両申請を直接読んで付ける
//                       （ここに持たせない＝○の付け外しで一覧の行の中身が変わらない。B2）
//   黄色予告（kind 予告）… 黄色予告 = はい（否かつ実績なしかつ 0 < 継続車規制日 − drop ≤ 30 かつ 継続車規制日 > 今日）
//
// 3つの出力は決定表の中で排他（要／否、超過／未超過で分かれる）なので、1セルは高々1区分に入る。
// 決定表の出力から自動的に導かれること（一覧側にゲートを足していない）：
//   ・実績あり（認可番号待ち＝前例ありで「実績あり」として渡るセルを含む）はどの区分にも入らない（B1）
//   ・○の付け外しは車両申請の値を変えるだけで、上の3出力を変えない＝行・件数は変わらない（B2）
//   ・判定不能（LO未入力）はどの出力も「いいえ」なので入らない
//   ・drop未定（drop＝∞）には30日窓が無いので、黄色予告には入らない（要のセルは超過／期限前に入る）
//   ・同一性切れは実効の適用区分を経て要否に反映済みなので、独立の条件にしない。
//
// ■ 日数（A3）。主語を状態ごとに変える（「規制日まで何日超過」のような混ざった言い方をしない）。
//   期限超過       … 期限を過ぎて n 日（n = 今日 − 期限日。期限日 = max(規制日, LO)。当日は0）
//   期限前・未取得 … 期限まで n 日（n = 期限日 − 今日。未超過なので 1 以上）
//   黄色予告       … 継続車規制日まで n 日（n = 継続車規制日 − 今日）。dropの何日後かは決定表の窓の値
//
// ■ 並べ替えに使う「切迫度」（urgency）は、上の日数を1本の数直線へ載せ直したもの。
//   超過は負、これからは正。小さいほど切迫している。**新しい判定ではなく日数の言い換え**である。
//   期限日・継続車規制日が読めないときは null（＝最後に並べる。日数も出さない）。
// ───────────────────────────────────────────────
export const RISK_KINDS = ["不適合", "期限前", "予告"];

export function riskOfCell(decision, today = TODAY) {
  // 共通ゲート（F-26 A1）：drop済みのランはどの区分にも出さない。
  if (!decision || decision.生産フェーズ === "drop済み") return null;
  const t = dateDayNumber(today);
  if (decision.現在法規不適合) {
    const d = dateDayNumber(decision.期限日);
    const days = d === null || t === null ? null : t - d;     // 期限を過ぎて n 日（当日＝0）
    return { kind: "不適合", days, afterDrop: null, urgency: days === null ? null : -days };
  }
  if (decision.法規適合必要) {
    const d = dateDayNumber(decision.期限日);
    const days = d === null || t === null ? null : d - t;     // 期限まで n 日
    return { kind: "期限前", days, afterDrop: null, urgency: days };
  }
  const y = decision.黄色予告;
  if (y) {
    const k = dateDayNumber(y.keiDate);
    const days = k === null || t === null ? null : k - t;     // 継続車規制日まで n 日
    return { kind: "予告", days, afterDrop: y.days, urgency: days };
  }
  return null;
}

// 切迫している順（A3）。小さい＝切迫。日数が読めない行は最後。
// 同点のときは不適合を先にする（数の上では超過が必ず 0 以下・期限前と予告が 1 以上なので
// 実際には日数が読めない行どうしか、期限前と予告の間でしか起きないが、規則として明示しておく）。
const RISK_RANK = { 不適合: 0, 期限前: 1, 予告: 2, drop未入力: 3 };
const cmpUrgency = (a, b) => {
  if (a.urgency === null && b.urgency === null) return RISK_RANK[a.kind] - RISK_RANK[b.kind];
  if (a.urgency === null) return 1;
  if (b.urgency === null) return -1;
  if (a.urgency !== b.urgency) return a.urgency - b.urgency;
  return RISK_RANK[a.kind] - RISK_RANK[b.kind];
};

// 型式ラン単位で束ねた一覧の行（A2）。1行＝1型式ラン、展開するとそのランの危険な法規が並ぶ。
// F-27 から画面は riskSections（区分ごと）で描き、ここはパネル見出しの「n ラン・n 件」に使う。
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
    const due = cells.filter((m) => m.risk.kind === "期限前").length;
    const alert = model.alertOf?.(run) || null;
    // 最も切迫した法規行（並べ替え済みなので先頭）。危険な法規が無いラン（異常だけ）は null。
    const head = cells.length > 0 ? cells[0].risk : { kind: alert, urgency: null };
    rows.push({
      run, phase: model.phaseOf(run), cells,
      bad, due, warn: cells.length - bad - due,
      kind: head.kind, urgency: head.urgency, top: cells.length > 0 ? head : null,
      alert,
      // A9：同一性が未確認（比較元があるのに未回答）のセルを含むか。印だけで、並べる条件には効かない。
      unconfirmed: cells.some((m) => m.decision.根拠未確認),
    });
  }
  rows.sort(cmpUrgency);
  return rows;
}

// ───────────────────────────────────────────────
// 危険一覧の区分見出し（F-27）
//
// riskRunRows と同じ集約結果を、「区分 → 型式ラン → 法規行」の形に組み直すだけである。
// **セルの所属は riskOfCell の kind のまま**（ここで判定・除外を足さない）。
//
//   sections … RISK_KINDS の順（期限超過 → 期限前・未取得 → 黄色予告）に必ず3つ。0件の区分も返す（A1）
//     count  … その区分に入った法規行の数（表示中のランだけ。判断済みも数える。A4）
//     rows   … その区分の法規行を持つ型式ラン。1つのランが複数の区分に出ることがある（A2）
//              cells はそのランのうち、その区分の法規行だけ
//   alerts   … drop未入力（F-24 A4）のラン。区分とは別枠で、件数に混ざらない（A7・B3）
//
// ■ 並び（A5・A6）。日数は riskOfCell の切迫度（urgency）をそのまま使う。
//   区分の中の法規行 … 切迫度の小さい順。期限前は同じ期限なら未計画 → 計画済み。日数が読めない行は末尾
//   ランどうし       … そのランの区分内で日数が読める先頭の行で比べる。読める行が無いランは区分の末尾
//   同順位           … 元の並び（ランの入力順 × 法規の順）のまま（sort は安定）
// 計画済みは決定表の車両申請を読むだけで、区分・件数には効かない（○の付け外しで並びだけが変わりうる。B4）。
//
// ■ 人の対象外（F-28）。セルは区分から外さず、印（buildCellModel の exemptMark）を付けるだけ。
//   印が「対象外」の行だけを、区分全体の末尾に寄せる。「対象外・要再確認」は寄せない（A3）。
//   区分は「寄せていない行のラン群 → 寄せた行のラン群」の2段で、どちらも中の並びは F-27 のまま。
//   寄せていない行と寄せた行の両方を持つランは、同じ区分に2回（前段と後段に1回ずつ）出る（aside で区別する）。
//   exempt … 印が「対象外」のセルの数（A2）。count は変えない
//   undecidable … LO未入力で判定できないラン（A4）。区分にはもともと入らない（決定表の出力がすべて「いいえ」）
// ───────────────────────────────────────────────
const isPlanned = (m) => m.decision.車両申請 === "発生する（計画済み）";
const isSetAside = (m) => m.exemptMark === "対象外";
const cmpInSection = (a, b) => {
  if (a.risk.urgency === null || b.risk.urgency === null) {
    return (a.risk.urgency === null) - (b.risk.urgency === null);
  }
  if (a.risk.urgency !== b.risk.urgency) return a.risk.urgency - b.risk.urgency;
  if (a.risk.kind === "期限前") return isPlanned(a) - isPlanned(b);
  return 0;
};

export function riskSections(model, { runs = null } = {}) {
  const allow = runs ? new Set(runs) : null;
  // ランの順は model のランの順（riskRunRows と同じ）。同じランは1回だけ。
  const order = [...new Set(model.runs || model.list.map((m) => m.run))].filter((run) => !allow || allow.has(run));
  const cellsOf = new Map();
  for (const m of model.list) {
    if (!m.risk) continue;
    if (!cellsOf.has(m.run)) cellsOf.set(m.run, []);
    cellsOf.get(m.run).push(m);
  }
  const sections = RISK_KINDS.map((kind) => {
    // 印が「対象外」の行だけを区分の末尾に寄せる（F-28 A3）。前段・後段それぞれの中は F-27 の並びのまま。
    const groupRows = (aside) => {
      const rows = [];
      for (const run of order) {
        const cells = (cellsOf.get(run) || []).filter((m) => m.risk.kind === kind && isSetAside(m) === aside);
        if (cells.length === 0) continue;
        cells.sort(cmpInSection);
        // 日数が読める先頭の行（読めない行は並べ替えで末尾に来ているので、先頭が読めなければ全部読めない）
        const top = cells[0].risk.urgency === null ? null : cells[0];
        rows.push({
          run, phase: model.phaseOf(run), cells, top: top ? top.risk : null, head: top, aside,
          unconfirmed: cells.some((m) => m.decision.根拠未確認),
        });
      }
      return rows.sort((a, b) => (!a.head || !b.head) ? (!a.head) - (!b.head) : cmpInSection(a.head, b.head));
    };
    const rows = [...groupRows(false), ...groupRows(true)];
    const cells = rows.flatMap((r) => r.cells);
    // count は F-27 のまま（判断済みも数える）。exempt は印が「対象外」のセルだけ（対象外・要再確認は数えない。F-28 A2）
    return { kind, count: cells.length, exempt: cells.filter(isSetAside).length, rows };
  });
  const alerts = order.filter((run) => model.alertOf?.(run)).map((run) => ({ run, phase: model.phaseOf(run) }));
  // LO未入力で判定できないラン（F-28 A4）。決定表と同じ見方（dropInputStateOf）で、LOが空のランだけを数える。
  // 規制日の空欄・drop未入力はここに入れない（B3）。表示中のランだけ（フィルター連動）。
  const undecidable = order.filter((run) => dropInputStateOf(run.lo, run.drop) === "LO未入力");
  return { sections, alerts, undecidable };
}
