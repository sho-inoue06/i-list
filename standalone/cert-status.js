// 前例・取得予定の決定表入力は src/judge/cert-status.js へ移した。
// verify/ がこのファイルを直接 import しているので、同じ名前を中継して export するだけのファイルとして残す。
export { makeCertStatusContext, setCertPlanned } from "../src/judge/cert-status.js";
