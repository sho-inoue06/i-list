// ───────────────────────────────────────────────
// 決定表（F-19）の総当たりケースと期待値を作る道具。
//
// これは **検証データを作るための一回きりの道具** であり、検証そのものではない。
// 実行すると verify/decision-table-cases.js を書き出す。書き出した表はrepoへ固定して置き、
// 検証ハーネス（verify/decision-table.jsx）はその固定表だけを読む。
//
//   node verify/decision-table-gen.mjs
//
// ■ 期待値は製品コード（decideCell）を一切呼ばずに作る。
//   ここでの参照実装は Notion「F-19 判定の決定表」の文章から独立に書いたもので、
//   日付文字列ではなく **順位の大小だけ** で判定する（製品側と構造を変えてある）。
//   したがって「製品の出力を期待値として焼き付ける」ことにはならない。
//
// ■ ケースの数え方（Notion F-19 と同じ）
//   5つの日付（LO・drop・新型車規制日・継続車規制日・今日）の弱順序（同日を許す並び）… 541
//     うち LO<drop かつ 新型車日<継続車日 … 101
//   黄色予告は距離を見るので、drop<継続車日 の41通りを「差が30日以内／31日以上」に割る
//     → 順序ケース 101 + 41 = 142
//   142 × 認証3状態 × 実効の適用区分2 = 852
//
// ■ 順位を実際の日付にする
//   同じ順位＝同じ日。順位が1つ違うと spacing 日ずれる。
//     差が30日以内の版 … spacing = 5（5要素なので最大差20日。必ず窓の中）
//     それ以外         … spacing = 100（最小差100日。必ず窓の外）
//   どちらも順位の大小関係はそのまま保たれるので、日付の選び方で判定が変わることはない。
//   基点は固定日（今日も入力として渡すので、端末の日付に依存しない）。
// ───────────────────────────────────────────────
import { writeFileSync } from "node:fs";

const KEYS = ["lo", "drop", "shin", "kei", "today"];
const ANCHOR = "2040-01-01";
const dayNum = (s) => { const [y,m,d] = s.split("-").map(Number); return Math.floor(Date.UTC(y,m-1,d)/86400000); };
const dateOf = (n) => new Date(n*86400000).toISOString().slice(0,10);
const ANCHOR_DAY = dayNum(ANCHOR);

// ── 5要素の弱順序（{0..k} への全射）。生成順は決定的 ──
const orders = [];
(function walk(i, cur) {
  if (i === KEYS.length) {
    const used = new Set(cur);
    for (let v = 0; v <= Math.max(...cur); v++) if (!used.has(v)) return;
    orders.push(Object.fromEntries(KEYS.map((k, j) => [k, cur[j]])));
    return;
  }
  for (let v = 0; v < KEYS.length; v++) { cur.push(v); walk(i + 1, cur); cur.pop(); }
})(0, []);
const constrained = orders.filter((o) => o.lo < o.drop && o.shin < o.kei);

// ── 順序ケース142件 ──
const orderCases = [];
constrained.forEach((o, i) => {
  const id = `O${String(i).padStart(3, "0")}`;
  if (o.drop < o.kei) {
    orderCases.push({ id: `${id}-S`, o, gapSmall: true, spacing: 5 });
    orderCases.push({ id: `${id}-B`, o, gapSmall: false, spacing: 100 });
  } else {
    orderCases.push({ id: `${id}-N`, o, gapSmall: null, spacing: 100 });
  }
});

// ── 参照実装（Notionの文章から独立に。順位の大小だけで判定する） ──
function expectOf(o, gapSmall, certPlan, side) {
  const 生産フェーズ = o.today < o.lo ? "開発中"
    : (o.lo <= o.today && o.today <= o.drop) ? "生産中" : "drop済み";

  let 適用した規制 = "なし";
  if (side === "新") {
    if (o.shin <= o.lo) 適用した規制 = "新型";
    else if (o.kei <= o.drop) 適用した規制 = "継続";
  } else {
    if (o.kei <= o.drop) 適用した規制 = "継続";
  }
  const 要 = 適用した規制 !== "なし";
  const 規制日順位 = 適用した規制 === "新型" ? o.shin : o.kei;   // 否でも継続車日（現行の期日と同じ）

  // 期限 = max（適用した規制日、LO）
  const 期限 = !要 ? "なし" : (o.lo > 規制日順位 ? "LO" : "規制日");
  const 超過 = 要 && 規制日順位 <= o.today && o.lo <= o.today;

  const 実績あり = certPlan === "実績あり";
  const 車両申請 = !要 ? null : 実績あり ? "発生しない"
    : certPlan === "実績なし+予定あり" ? "発生する（計画済み）" : "発生する（未計画）";

  const 現在法規不適合 = 要 && !実績あり && 超過 && 生産フェーズ === "生産中";
  const 過去に法規不適合 = 要 && !実績あり && 超過 && 生産フェーズ === "drop済み";
  const 法規適合必要 = 要 && !実績あり && !超過;

  // 黄色予告：否・実績なし・窓（0 < 継続車日 − drop ≤ 30）・継続車日 > 今日（F-15）
  const 黄色予告 = !要 && !実績あり && gapSmall === true && o.kei > o.today;

  const 表示 = !要 ? (黄色予告 ? "否・予告" : "否") : 実績あり ? "実績あり" : "申請発生";
  return { 生産フェーズ, 要否: 要 ? "要" : "否", 適用した規制, 車両申請, 期限,
    現在法規不適合, 過去に法規不適合, 法規適合必要, 黄色予告, 表示, 超過, 規制日順位 };
}

const CERT = ["実績あり", "実績なし+予定あり", "実績なし+予定なし"];
const SIDES = ["新", "継"];
const rows = [];
for (const c of orderCases) {
  const date = (k) => dateOf(ANCHOR_DAY + c.o[k] * c.spacing);
  const input = { lo: date("lo"), drop: date("drop"), shin: date("shin"), kei: date("kei"), today: date("today") };
  for (const certPlan of CERT) for (const side of SIDES) {
    const e = expectOf(c.o, c.gapSmall, certPlan, side);
    const 規制日 = e.適用した規制 === "新型" ? input.shin : input.kei;
    const 期限日 = e.期限 === "LO" ? input.lo : e.期限 === "規制日" ? 規制日 : "";
    const days = dayNum(input.kei) - dayNum(input.drop);
    rows.push({
      id: `${c.id}/${certPlan}/${side}`,
      in: { ...input, certPlan, side },
      out: {
        生産フェーズ: e.生産フェーズ, 要否: e.要否, 適用した規制: e.適用した規制,
        車両申請: e.車両申請, 期限: e.期限, 期限日,
        現在法規不適合: e.現在法規不適合, 過去に法規不適合: e.過去に法規不適合,
        法規適合必要: e.法規適合必要,
        黄色予告: e.黄色予告 ? { days, keiDate: input.kei } : null,
        根拠未確認: false, 規制日, 超過: e.超過, 表示: e.表示,
      },
    });
  }
}

const header = `// ───────────────────────────────────────────────
// 決定表（F-19 C2）の総当たりケースと期待値。**自動生成物・手で編集しない。**
//
//   作り方： node verify/decision-table-gen.mjs
//   作った道具： verify/decision-table-gen.mjs
//
// 期待値は製品コード（decideCell）を一度も呼ばずに作ってある。道具の中の参照実装は
// Notion「F-19 判定の決定表」の文章から独立に書いたもので、日付文字列ではなく
// 順位の大小だけで判定する（製品側と構造を変えてある）。
// この表は固定した期待値であり、製品の出力が変わったら検証が落ちる側の正本である。
//
// ${rows.length}件 ＝ 順序${orderCases.length}通り × 認証3状態 × 実効の適用区分2。
// ───────────────────────────────────────────────
export const DECISION_CASES = `;
writeFileSync("verify/decision-table-cases.js",
  header + JSON.stringify(rows, null, 0).replace(/\},\{"id"/g, "},\n{\"id\"") + ";\n", "utf8");

// ── 数え上げの自己点検（Notion F-19 の試算値と突き合わせる） ──
const cnt = {}; const bump = (k) => cnt[k] = (cnt[k] || 0) + 1;
for (const r of rows) {
  bump("phase:" + r.out.生産フェーズ); bump("req:" + r.out.要否); bump("applied:" + r.out.適用した規制);
  if (r.out.現在法規不適合) bump("現在法規不適合");
  if (r.out.過去に法規不適合) bump("過去に法規不適合");
  if (r.out.法規適合必要) bump("法規適合必要");
  if (r.out.黄色予告) { bump("黄色予告"); bump("黄色:" + r.in.side); }
}
console.log("弱順序", orders.length, "/ 制約後", constrained.length,
  "/ drop<継続車日", constrained.filter((o) => o.drop < o.kei).length,
  "/ 順序ケース", orderCases.length, "/ 総ケース", rows.length);
console.log(cnt);
