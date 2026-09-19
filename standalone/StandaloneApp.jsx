// ───────────────────────────────────────────────
// 単体版（サーバなし・file:// で直接開くデモ）
//
//   ・API（/api/data）へは一切アクセスしない。サーバ保存は行わない。
//   ・データは手入力し、JSONファイルへ明示的に書き出して保存する。
//   ・画面・4タブ・判定ロジックは src/IListApp.jsx と共有する（二重管理をしない）。
//
// 保存表示の考え方：
//   API版の「サーバに保存済み」は出さない。書き出すまでは「未書き出し」と表示する。
//   ダウンロードは「開始した」ことしか分からないため、保存完了とは表示しない。
// ───────────────────────────────────────────────
import React, { useState, useMemo, useRef, useEffect } from "react";
import { Download, Upload, Table2, Scale, Pencil, FileCheck, AlertTriangle, ShieldCheck, Save } from "lucide-react";
import {
  SEED, nextKey, parseImportedData, applyImported, evalCellWith, summarize,
  buildSavedHtml,
  MatrixView, RunsEditor, RegsEditor, CertEditor,
  sweepRecheck, upsertDecision, normalizeDecisions, markRunNeedsRecheck,
  pruneDecisionsByRun, pruneDecisionsByReg,
  setBase, sweepSameness, upsertSameness, normalizeSameness, makeSamenessContext,
  pruneBasesByRun, pruneSamenessByRun, pruneSamenessByReg,
  INK, PALETTE, btn,
} from "../src/IListApp.jsx";

const LINE = "#22303f", CYAN = "#4dd6e0", MUTE = "#5a6b7d", AMBER = "#e0b24d", GREEN = "#3fbf8f";

// 保存状態（単体版）
//   clean        … 最後の書き出し以降、変更がない
//   dirty        … 変更あり・JSONへ未書き出し
//   exported     … JSONの書き出しを開始した（ディスクへの保存完了は確認できない）
//   imported     … JSONから読み込んだ直後（まだ書き出していないわけではない＝cleanと同じ扱い）
//   htmlSaved    … データ入りHTMLの書き出しを開始した（同上、保存完了は確認できない）
//   htmlImported … データ入りHTML（保存版）を開いて起動した
function StandaloneStatus({ state }) {
  const m = {
    clean:        { c: MUTE,  t: "変更なし（未書き出しの変更はありません）" },
    dirty:        { c: AMBER, t: "未書き出しの変更があります（書き出してください）" },
    exported:     { c: CYAN,  t: "JSONの書き出しを開始しました（保存先はブラウザの動作に従います）" },
    imported:     { c: GREEN, t: "JSONから読み込みました" },
    htmlSaved:    { c: CYAN,  t: "データ入りHTMLの書き出しを開始しました（保存先はブラウザの動作に従います）" },
    htmlImported: { c: GREEN, t: "保存済みのHTMLから起動しました（この時点のデータで再開しています）" },
  }[state] || { c: MUTE, t: "" };
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, color:m.c, maxWidth:520 }}>
      <span style={{ width:7, height:7, borderRadius:"50%", background:m.c, flex:"none" }} />{m.t}
    </span>
  );
}

export default function StandaloneApp({ bootData } = {}) {
  // 埋め込み起動データ（保存版HTML）の扱い：
  //   present=false … 通常テンプレート起動 → SEED を使う
  //   present=true, ok=false … 埋め込みはあるが壊れている → 黙ってSEEDへ置き換えない。
  //     初期値はSEEDのまま表示し、バナーで「埋め込みを読めなかった」ことを伝える。
  //   present=true, ok=true … 埋め込みを初期データとして使う
  const bootOk = !!bootData?.present && !!bootData?.ok;
  const bootBroken = !!bootData?.present && !bootData?.ok;
  const [runs, _setRuns] = useState(bootOk ? bootData.data.runs : SEED.runs);
  const [regs, _setRegs] = useState(bootOk ? bootData.data.regs : SEED.regs);
  const [cert, _setCert] = useState(bootOk ? bootData.data.cert : SEED.cert);
  // 人の適用判断。SEEDには含めない（初期表示は全件未確認＝レコードなし）。
  const [decisions, _setDecisions] = useState(bootOk ? bootData.data.decisions : []);
  const [tab, setTab] = useState("帳票");
  const [state, setState] = useState(bootOk ? "htmlImported" : "clean");
  const fileRef = useRef(null);

  // 埋め込み起動データの採番（key/rid）を、初回描画のあとに一度だけ反映する。
  // render中に共有カウンタ(_id/_rid)を書き換えないため、useEffectで行う。
  const bootApplied = useRef(false);
  useEffect(() => {
    if (bootApplied.current) return;
    bootApplied.current = true;
    if (bootOk) applyImported({ maxId: bootData.maxId, maxRid: bootData.maxRid });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 読込世代：ファイルを選ぶたびに進める。
  // 読取が完了した時点で世代が変わっていれば、その結果は「古い読込」なので破棄する。
  // これにより、後から選んだファイルより古い読込結果がデータや表示を上書きしない。
  const loadGen = useRef(0);

  // データ置換が成功した回数。読込が成功したときだけ進める。
  // 帳票側はこれが変わったときに、開いている判断の編集領域を閉じる
  // （開いたままだと、古い理由を新しい判断へ書き戻せてしまうため）。
  // 不正ファイル・置換キャンセル・古い読込の破棄では進めないので、編集途中の入力は保たれる。
  const [dataGen, setDataGen] = useState(0);

  // 「未書き出しかどうか」を、読取完了時点の最新の値で判定するための参照。
  // ファイル選択時のdirtyをそのまま使うと、読取中に行われた編集を見落とす。
  const dirtyRef = useRef(false);
  const setSaveState = (next) => { dirtyRef.current = (next === "dirty"); setState(next); };

  // 帳票の列（型式ラン）表示フィルター：プロジェクトコード(run.gen)／車両型式(run.typeId)の複数選択。
  // 一時的なUI状態。保存形式には入れず、dirty にもしない。runs/regs/cert/decisions は削らない・置換しない。
  // 成功した別データの読込でだけ全解除する（下の importJSON 成功時）。不正読込・置換キャンセルでは保持。
  const [selProjects, setSelProjects] = useState([]);
  const [selTypes, setSelTypes] = useState([]);
  const clearColumnFilter = () => { setSelProjects([]); setSelTypes([]); };

  // 規制再判定のデータ（F-04）：比較元（bases）と同一性（sameness）。初期表示は SEED の例を使う。
  // ※ 検証ハーネスが既存Hookの順序を観測しているため、既存のstateより後ろに置く。
  const [bases, _setBases] = useState(bootOk ? bootData.data.bases : SEED.bases);
  const [sameness, _setSameness] = useState(bootOk ? bootData.data.sameness : SEED.sameness);

  // データ変更を受け付けた時点で「未書き出し」にする。
  // updater関数もそのまま渡せるよう、副作用はupdaterの外（呼び出し時）で行う。
  const markDirty = () => setSaveState("dirty");
  const setRuns = (v) => { markDirty(); _setRuns(v); };
  const setRegs = (v) => { markDirty(); _setRegs(v); };
  const setCert = (v) => { markDirty(); _setCert(v); };
  const setDecisions = (v) => { markDirty(); _setDecisions(v); };
  const setBases = (v) => { markDirty(); _setBases(v); };
  const setSameness = (v) => { markDirty(); _setSameness(v); };

  const dirty = state === "dirty";

  // 要再確認フラグの掃き出し。
  //   ・立てるだけで下ろさない（条件を元に戻す・メモ編集・読み直しでは解除されない）。
  //   ・解除はセルの「この内容で再確定」だけ。
  //
  // 立った要再確認は「保存対象のデータが変わった」ことを意味する。人の明示再確定でしか
  // 下ろさない以上、書き出さずに閉じれば失われる情報である。したがって boot・読込を含め、
  // 実際に変化したときは未書き出し表示・dirtyRef へ反映する。これにより
  // 終了時の警告ハンドラが登録され、次の読込でも置換確認が出る。
  //
  // 変化が無いときは sweepRecheck が同じ配列参照を返すので、
  // 不要な dirty も再実行のループも起こさない（保存直後に理由なく dirty へ戻らない）。
  useEffect(() => {
    const swept = sweepRecheck(decisions, runs, regs);
    if (swept === decisions) return;
    _setDecisions(swept);
    markDirty();
  }, [runs, regs, decisions]);

  // 同一性の要再確認も同じ考え方で掃き出す（比較元の変更・無効化で立てる。下ろさない）。
  useEffect(() => {
    const swept = sweepSameness(sameness, runs, regs, bases);
    if (swept === sameness) return;
    _setSameness(swept);
    markDirty();
  }, [runs, regs, bases, sameness]);

  // ── 判断の編集・整合 ──
  // セルの編集領域から確定・メモ保存された1件を反映する（他の判断には触れない）。
  const handleSaveDecision = (rec) => setDecisions((ds) => upsertDecision(ds, rec));
  // ランの見出しからの手動要再確認（装備変更など自動検知できない条件のため）。
  const handleRecheckRun = (runKey) => setDecisions((ds) => markRunNeedsRecheck(ds, runKey));
  // 行削除と同じ操作で、その行を参照する判断だけを取り除く（孤立参照を作らない）。
  const handleDeleteRun = (runKey) => {
    setDecisions((ds) => pruneDecisionsByRun(ds, runKey));
    setBases((bs) => pruneBasesByRun(bs, runKey));
    setSameness((ss) => pruneSamenessByRun(ss, runKey));
  };
  const handleDeleteReg = (rid) => {
    setDecisions((ds) => pruneDecisionsByReg(ds, rid));
    setSameness((ss) => pruneSamenessByReg(ss, rid));
  };
  // 比較元の選択・変更・解除（型式ランタブ）と、同一性1件の保存（帳票セル）。
  const handleSetBase = (runKey, baseRunKey) => setBases((bs) => setBase(bs, runKey, baseRunKey));
  const handleSaveSameness = (rec) => setSameness((ss) => upsertSameness(ss, rec));

  // 書き出す中身。
  // 掃き出しEffectの反映を待たずに済むよう、ここでも同じ sweepRecheck を通してから書き出す
  // （純関数なので結果は同じ。Effectより先に保存ボタンが押されても古いフラグを書き出さない）。
  // 情報を持たない未確認レコードは落とす（レコード無し＝未確認と同義）。
  const snapshot = () => ({ runs, regs, cert, decisions: normalizeDecisions(sweepRecheck(decisions, runs, regs)),
    bases, sameness: normalizeSameness(sweepSameness(sameness, runs, regs, bases)) });

  // 未書き出しのまま閉じようとしたら警告する。
  // ブラウザ依存であり、これはデータ保存の代わりにはならない。
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ""; return ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const typeIds = useMemo(() => [...new Set(runs.map(r => r.typeId))], [runs]);
  const colorOf = (typeId) => PALETTE[typeIds.indexOf(typeId) % PALETTE.length];
  // 判定ロジックは共有（src/IListApp.jsx の純関数を使う）
  // 同一性（F-04）で継続車日／新型車日を切り替える。比較元が未選択・無効のランは従来どおり。
  const sameCtx = useMemo(() => makeSamenessContext(runs, bases, sameness), [runs, bases, sameness]);
  const evalCell = (run, r) => evalCellWith(cert, run, r, sameCtx.effective(run, r));
  const summary = useMemo(() => summarize(runs, regs, cert, sameCtx.effective), [runs, regs, cert, sameCtx]);

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ilist_data_${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    // ここで分かるのは「ダウンロードを開始した」ことだけ。
    // 実際にディスクへ保存されたか、どこに保存されたかは確認できないため、保存完了とは表示しない。
    setSaveState("exported");
  };

  // 「データ入りHTMLを保存」：ページ自身が持つ雛形（#ilist-template。ビルド時点の
  // 制御されたアプリテンプレートの文字列）を使い、起動データのマーカー区間だけを
  // 現在のruns/regs/certで置き換えて新しいHTMLとしてダウンロードする。
  // 描画済みDOMの丸ごと保存はしない。元ファイル（いま開いているファイル自体）は書き換えない。
  // file:// では自分自身をfetch/XHRで読み直せない（実測済み）ため、埋め込み済みの雛形文字列を使う。
  const [htmlSaveBusy, setHtmlSaveBusy] = useState(false);
  const saveHtmlWithData = () => {
    if (htmlSaveBusy) return;
    setHtmlSaveBusy(true);
    try {
      const built = buildSavedHtml(snapshot());
      if (!built.ok) throw new Error(built.error);
      const blob = new Blob([built.html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.href = url; a.download = `ilist_standalone_${stamp}.html`;
      a.click(); URL.revokeObjectURL(url);
      // ここで分かるのも「ダウンロードを開始した」ことだけ。保存完了とは表示しない。
      setSaveState("htmlSaved");
    } catch (err) {
      // 失敗時は現在の保存状態を変えない（未書き出し扱いのままにする）。
      alert(
        "データ入りHTMLの書き出しに失敗しました。\n" +
        (err?.message || String(err)) +
        "\n（現在のデータは変更していません。JSONへの書き出しは引き続き使えます）"
      );
    } finally {
      setHtmlSaveBusy(false);
    }
  };

  const importJSON = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";                 // 同じファイルを選び直せるよう先に戻す
    if (!file) return;

    // この読込の世代を確定する。完了時に世代が進んでいれば「古い読込」として破棄する。
    const gen = ++loadGen.current;
    const isStale = () => gen !== loadGen.current;

    const reader = new FileReader();
    reader.onload = () => {
      // 後から別のファイルを選んでいたら、この結果は捨てる（成功でも表示を変えない）
      if (isStale()) return;

      // 解析・構造検証・反映用データの準備をすべて終えてから置換する。
      // 途中で失敗した場合、runs/regs/cert・未書き出し状態・採番状態のいずれも変更しない。
      let raw;
      try {
        raw = JSON.parse(reader.result);
      } catch {
        alert("読み込めませんでした。JSONファイルを確認してください。\n（現在のデータは変更していません）");
        return;
      }
      const parsed = parseImportedData(raw);
      if (!parsed.ok) {
        alert(`このファイルは読み込めません。\n${parsed.error}\n\n（現在のデータは変更していません）`);
        return;
      }

      // 未書き出しの変更があるかは、ファイル選択時ではなく「いまの状態」で判定する。
      // 読取中に編集された場合も見落とさない。
      if (dirtyRef.current && !window.confirm(
        "未書き出しの変更があります。\n読み込むと、現在の内容は失われます。\n\n読み込みを続けますか？"
      )) return;                          // キャンセル時は現在のデータを保持する

      // 確認ダイアログの表示中に別の読込が始まっている可能性があるため、置換直前に再確認する
      if (isStale()) return;

      const { runs: nextRuns, regs: nextRegs, cert: nextCert, decisions: nextDecisions,
        bases: nextBases, sameness: nextSameness } = parsed.data;
      const sweptDecisions = sweepRecheck(nextDecisions, nextRuns, nextRegs);
      const sweptSameness = sweepSameness(nextSameness, nextRuns, nextRegs, nextBases);
      _setRuns(nextRuns); _setRegs(nextRegs); _setCert(nextCert);
      _setDecisions(sweptDecisions);
      _setBases(nextBases); _setSameness(sweptSameness);
      setDataGen((g) => g + 1);          // 置換が成功したので、開いている編集領域を閉じさせる
      clearColumnFilter();               // 別データに替わったので列表示フィルターは全解除する

      // 採番は「置換確認と最新世代の確認を通過した反映時」だけ動かす。
      // runs(_id) と rid(_rid) の両方をまとめて整合させる。
      applyImported({ maxId: parsed.maxId, maxRid: parsed.maxRid });
      // 読込時の掃き出しで変わった保存対象も保護する。
      // 後続Effectでは既に整合済みなので、ここでdirtyRefと保存表示を同時に更新する。
      setSaveState(sweptDecisions !== nextDecisions || sweptSameness !== nextSameness ? "dirty" : "imported");
    };
    reader.onerror = () => {
      if (isStale()) return;              // 古い読込の失敗で表示を変えない
      alert("ファイルを読み取れませんでした。（現在のデータは変更していません）");
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ background:INK, minHeight:"100vh", color:"#cdd9e5", fontFamily:"ui-sans-serif, system-ui, sans-serif", padding:"22px 18px 60px" }}>
      <div style={{ maxWidth:1120, margin:"0 auto" }}>
        {/* ヘッダ */}
        <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", marginBottom:14 }}>
          <span style={{ fontFamily:"ui-monospace, monospace", color:CYAN, fontSize:13, letterSpacing:2 }}>I-LIST</span>
          <h1 style={{ fontSize:19, fontWeight:700, margin:0, color:"#eef4fa" }}>自動車型式 適合・認証取得 管理帳票</h1>
          <span style={{ fontSize:10.5, color:MUTE, border:`1px solid ${LINE}`, borderRadius:5, padding:"2px 7px" }}>単体版（サーバなし）</span>
          <span style={{ flex:1 }} />
          <StandaloneStatus state={state} />
          <button onClick={saveHtmlWithData} disabled={htmlSaveBusy} style={btn(GREEN)}>
            <Save size={13}/> {htmlSaveBusy ? "書き出し中…" : "データ入りHTMLを保存"}
          </button>
          <button onClick={exportJSON} style={btn(CYAN)}><Download size={13}/> JSONに書き出し</button>
          <button onClick={()=>fileRef.current?.click()} style={btn(MUTE,true)}><Upload size={13}/> JSONを読み込み</button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={importJSON} style={{ display:"none" }} />
        </div>

        {/* ダミー専用の告知 */}
        <div style={{ background:`${AMBER}14`, border:`1px solid ${AMBER}55`, borderRadius:8, padding:"8px 12px", fontSize:11, color:AMBER, marginBottom:10, lineHeight:1.7 }}>
          <strong>ダミーデータ専用・業務利用未検証</strong>（画面提案用のデモです）<br />
          初期表示は架空のダミーデータです。実車情報・実日程・実認可番号は入力しないでください。
        </div>

        {/* 埋め込み起動データが壊れていた場合の告知（黙ってSEEDへ置き換えていないことを明示する） */}
        {bootBroken && (
          <div style={{ background:"rgba(255,107,87,0.12)", border:"1px solid rgba(255,107,87,0.5)", borderRadius:8, padding:"8px 12px", fontSize:11, color:"#ff6b57", marginBottom:10, lineHeight:1.7 }}>
            <strong>このHTMLに埋め込まれたデータを読み込めませんでした。</strong><br />
            {bootData?.error || "内容を確認してください。"}<br />
            画面には初期のダミーデータを表示しています（保存されていたデータではありません）。別のバックアップ（JSON等）があれば読み込み直してください。
          </div>
        )}

        {/* 単体版の保存についての注意 */}
        <div style={{ background:"rgba(90,107,125,0.10)", border:`1px solid ${LINE}`, borderRadius:8, padding:"8px 12px", fontSize:11, color:"#8fa3b8", marginBottom:14, lineHeight:1.7 }}>
          この単体版は<strong>自動保存しません</strong>。入力内容を残すには「データ入りHTMLを保存」または「JSONに書き出し」を押してファイルを保存してください。
          「データ入りHTMLを保存」で作ったファイルは、次回そのまま開けば保存時点のデータで再開できます（JSONの選択は不要）。<br />
          いずれも<strong>ダウンロードを開始したことしか分かりません</strong>。実際にディスクへ保存されたかはブラウザの表示で確認してください。
          元のファイルは自動更新されません（開き直しても保存前の内容のままです）。<br />
          タブを閉じる際の警告はブラウザによって出ないことがあります。<strong>警告はデータ保存の代わりにはなりません。</strong><br />
          人の適用判断・理由メモ、比較元・同一性は、この単体版で作るファイルにだけ入ります。<strong>サーバ保存版（API版）では読み込めません</strong>（誤って選んでも取り込まずに中止します）。
          古い版のアプリが新しい項目を無視することは「互換」ではありません。<strong>元のファイルは消さずに残してください。</strong>
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

        {/* 画面本体（API版と同じ部品を使う） */}
        {tab==="帳票" && <MatrixView {...{runs,regs,evalCell,summary,colorOf,decisions,dataGen}}
          columnFilter={{ selProjects, setSelProjects, selTypes, setSelTypes, clear: clearColumnFilter }}
          onSaveDecision={handleSaveDecision} onRecheckRun={handleRecheckRun}
          sameCtx={sameCtx} onSaveSameness={handleSaveSameness} />}
        {tab==="型式ラン" && <RunsEditor {...{runs,setRuns,colorOf,nextKey,bases}} onDeleteRun={handleDeleteRun} onSetBase={handleSetBase} />}
        {tab==="法規DB" && <RegsEditor {...{regs,setRegs}} onDeleteReg={handleDeleteReg} />}
        {tab==="認可書実績" && <CertEditor {...{typeIds,regs,cert,setCert,colorOf,evalCell,runs}} />}
      </div>
    </div>
  );
}
