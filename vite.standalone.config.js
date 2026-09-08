// 単体HTML（file:// で直接開けるデモ）専用のビルド設定。
// 通常のAPI版ビルド（vite.config.js / npm run build）とは出力先も入口も分ける。
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "standalone",
  base: "./",                 // file:// で開くため絶対パスにしない
  build: {
    outDir: "../dist-standalone",
    emptyOutDir: true,
    // 単一ファイルにまとめるため、コード分割とアセット分離をやめる
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true, manualChunks: undefined },
    },
  },
});
