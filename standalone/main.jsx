import React from "react";
import ReactDOM from "react-dom/client";
import StandaloneApp from "./StandaloneApp.jsx";
import { readBootData } from "../src/IListApp.jsx";

// 起動データの埋め込み（#ilist-boot-data）を読む。
//   present=false … 埋め込みなし（通常テンプレート起動）→ StandaloneApp が SEED を使う
//   present=true, ok=false … 埋め込みはあるが壊れている → 黙ってSEEDへ置き換えない。
//     ここで警告のうえ画面には状態を渡し、StandaloneAppがユーザーに伝える。
//   present=true, ok=true … 埋め込みを初期データとして使う
const boot = readBootData(document);
if (boot.present && !boot.ok) {
  console.error("[i-list] 起動データの埋め込みを読み込めませんでした:", boot.error);
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <StandaloneApp bootData={boot} />
  </React.StrictMode>
);
