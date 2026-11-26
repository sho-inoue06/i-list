// 日付：「今日」（TODAY）と、判定が使う日付の読み取り（dateDayNumber）。

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
