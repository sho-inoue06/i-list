import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // ローカル限定（LAN公開・外部公開はしない）
    host: "127.0.0.1",
    // 開発中、/api へのリクエストをバックエンド(3001)へ転送する
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
});
