// 検証が使うChromeの場所の決め方（verify/*.mjs と scripts/verify-all.mjs で共通）。
// 環境変数 CHROME_PATH があればそれを使い、無ければmacOSの既定の場所を使う。
export const CHROME_PATH =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
