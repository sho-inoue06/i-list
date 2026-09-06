import React, { useState, useMemo, useRef, useEffect } from "react";
import { AlertTriangle, ShieldCheck, Minus, Activity, Pencil, Cpu, Plus, Trash2, Download, Upload, Table2, Scale, FileCheck } from "lucide-react";

// ───────────────────────────────────────────────
// Iリスト 帳票アプリ（段階2：サーバ保存）
//   入力＝法規DB・型式ラン・認可書実績（人間が手入れ）／ 帳票＝自動算出
//   要否：新型ラン 要⇔(新型適用≤LO)or(継続適用≤ドロップ)、継続ラン 要⇔継続適用≤ドロップ
//   データは起動時にサーバ(SQLite)から読み込み、編集すると自動保存される
//   JSONの書き出し/読み込みはバックアップ・持ち運び用として残している
// ───────────────────────────────────────────────

const INK="#0c1623", PANEL="#13202f", LINE="#22303f", CYAN="#4dd6e0", GREEN="#3fbf8f",
      RED="#ff6b57", MUTE="#5a6b7d", AMBER="#e0b24d";
const PALETTE=[CYAN,"#9d8cff",AMBER,GREEN,"#ff9e7d","#6db5ff","#d98cff"];
const TODAY="2026-06-28";

// ダミーデータ（架空の型式・法規・認可書番号。実車・実データとは無関係）
const SEED = {
  runs:[
    {key:"r1",typeId:"DEMO-0001", gen:"初代",     sk:"新",lo:"2017-07-01",drop:"2019-12-31"},
    {key:"r2",typeId:"DEMO-0001", gen:"改良MC",   sk:"継",lo:"2020-01-01",drop:"2022-12-31"},
    {key:"r3",typeId:"DEMO-0001", gen:"改良MC2",  sk:"継",lo:"2023-01-01",drop:"2023-12-31"},
    {key:"r4",typeId:"DEMO-0002",gen:"ビッグMC", sk:"新",lo:"2024-01-01",drop:"2025-12-31"},
    {key:"r5",typeId:"DEMO-0003",gen:"FMC2026", sk:"新",lo:"2026-01-01",drop:"2030-12-31"},
  ],
  regs:[
    {id:"DEMO-REG-A",   label:"ダミー法規A",   shin:"2016-01-01",kei:"2018-01-01",parent:""},
    {id:"DEMO-REG-A2",  label:"ダミー法規A SU",shin:"2024-06-01",kei:"2026-06-01",parent:"DEMO-REG-A"},
    {id:"DEMO-REG-B",   label:"ダミー法規B",   shin:"2022-01-01",kei:"2024-01-01",parent:""},
    {id:"DEMO-REG-C",   label:"ダミー法規C",   shin:"2025-01-01",kei:"2027-01-01",parent:""},
    {id:"DEMO-REG-D",   label:"ダミー法規D",   shin:"2020-01-01",kei:"2022-01-01",parent:""},
    {id:"DEMO-REG-E",   label:"ダミー法規E",   shin:"2028-01-01",kei:"2029-01-01",parent:""},
  ],
  cert:{
    "DEMO-0001": {"DEMO-REG-A":"DEMO*A00/00*01","DEMO-REG-D":"DEMO*D00/00*01"},
    "DEMO-0002": {"DEMO-REG-A":"DEMO*A00/00*02","DEMO-REG-B":"DEMO*B00/00*01","DEMO-REG-D":"DEMO*D00/00*02"},
    "DEMO-0003": {"DEMO-REG-A":"DEMO*A00/00*03","DEMO-REG-A2":"DEMO*A02/00*01","DEMO-REG-B":"DEMO*B00/00*02","DEMO-REG-D":"DEMO*D00/00*03","DEMO-REG-C":"DEMO*C00/00*01"},
  },
};

// サーバ応答が期待するデータ形 { runs:[], regs:[], cert:{} } かを判定する。
// 配列も typeof は "object" になるため、cert は「nullでない・配列でないオブジェクト」であることまで確認する。
// （cert:[] を通してしまうと、SEEDを保持したまま読込成功と誤認して保存に進む）
export const isValidData = (d) =>
  !!d && Array.isArray(d.runs) && Array.isArray(d.regs) &&
  typeof d.cert === "object" && d.cert !== null && !Array.isArray(d.cert);

let _id = 100;
const nextKey = () => "r" + (++_id);
// サーバから読んだランのキー(r101など)と新規追加のキーがぶつからないよう底上げする
const bumpIdFrom = (runs) => {
  for (const r of runs) {
    const n = parseInt(String(r.key).replace(/^r/, ""), 10);
    if (!Number.isNaN(n) && n > _id) _id = n;
  }
};

export default function IListApp() {
  const [runs, _setRuns] = useState(SEED.runs);
  const [regs, _setRegs] = useState(SEED.regs);
  const [cert, _setCert] = useState(SEED.cert);
  const [tab, setTab] = useState("帳票");

  // 編集世代：データ変更を「受け付けた時点」で進める。
  // 送信済みPUTの応答は、返ってきた時点の世代が自分の世代と一致するときだけ保存表示に反映する。
  // useEffect の中で進めるだけでは、変更受付からEffect実行までの間に届いた古い応答が
  // 「最新の応答」と誤認される窓が残るため、受付時点で進めるのが要点。
  const saveGen = useRef(0);
  // データ変更を受け付けたことを記録する（render中やstate updater内では呼ばない）
  const bumpGen = () => { saveGen.current += 1; };
  // runs/regs/cert の変更経路（手入力・JSON読込・初回読込の反映）はすべてこの3つを通す。
  // updater関数もそのまま渡せるように、副作用はupdaterの外（呼び出し時）で済ませている。
  const setRuns = (v) => { bumpGen(); _setRuns(v); };
  const setRegs = (v) => { bumpGen(); _setRegs(v); };
  const setCert = (v) => { bumpGen(); _setCert(v); };
  const fileRef = useRef(null);
  // loaded: 初回読込が「成功」した後にのみ true にする（保存を許可するフラグ）
  // 通信失敗・HTTPエラー・不正な応答（runs/regs/certが揃っていない）は失敗として扱い、loadedをtrueにしない
  const [loaded, setLoaded] = useState(false);
  // loading=読込中 / loadError=初回読込失敗（保存停止中） / saving=保存中 / saved=保存済み / saveError=保存失敗
  // 初回読込失敗(loadError)と保存失敗(saveError)は原因も対処も違うので別状態にする
  const [save, setSave] = useState("loading");

  // 起動時：サーバから読み込む。サーバが空（初回）なら SEED のまま → 読込成功として扱い、直後の自動保存でDBに入る
  useEffect(() => {
    let cancelled = false;
    fetch("/api/data")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => {
        if (cancelled) return;
        if (!isValidData(d)) throw new Error("不正な応答形式です");
        if (d.runs.length || d.regs.length || Object.keys(d.cert).length) {
          setRuns(d.runs); setRegs(d.regs); setCert(d.cert);
          bumpIdFrom(d.runs);
        }
        setLoaded(true);
        setSave("saved");
      })
      .catch(() => { if (!cancelled) setSave("loadError"); }); // loadedはfalseのまま→保存は行われない
    return () => { cancelled = true; };
  }, []);

  // 編集のたびに自動保存（0.8秒待ってまとめて送る）。初回読込が成功するまでは送らない
  useEffect(() => {
    if (!loaded) return;
    // 世代はデータ変更の受付時（setRuns/setRegs/setCert）に進めてある。ここでは読むだけ。
    const gen = saveGen.current;
    // このEffectが送ったPUTの応答を無効化するためのフラグ。
    // アンマウント時や次の変更時のcleanupで倒し、応答が状態更新の経路へ進まないようにする。
    let dropped = false;
    // 世代が最新で、かつこのEffectが破棄されていないときだけ保存表示を更新する
    const applySave = (next) => { if (!dropped && gen === saveGen.current) setSave(next); };
    setSave("saving");
    const t = setTimeout(() => {
      fetch("/api/data", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runs, regs, cert }),
      })
        .then((r) => {
          if (!r.ok) throw new Error();
          applySave("saved");
        })
        .catch(() => { applySave("saveError"); });
    }, 800);
    return () => { clearTimeout(t); dropped = true; };
  }, [runs, regs, cert, loaded]);

  const typeIds = useMemo(() => [...new Set(runs.map(r => r.typeId))], [runs]);
  const colorOf = (typeId) => PALETTE[typeIds.indexOf(typeId) % PALETTE.length];

  const evalCell = (run, r) => {
    const { sk, lo, drop } = run;
    let required=false, kind="";
    if (sk==="新") {
      if (r.shin && r.shin<=lo) { required=true; kind="新型"; }
      else if (r.kei && r.kei<=drop) { required=true; kind="継続"; }
    } else {
      if (r.kei && r.kei<=drop) { required=true; kind="継続"; }
    }
    const ck = cert[run.typeId]?.[r.id] || null;
    const status = !required ? "off" : ck ? "ok" : "leak";
    return { required, kind, ck, status, dueDate: kind==="新型" ? r.shin : r.kei };
  };

  const summary = useMemo(() => {
    const leaks=[], effDrop={};
    for (const run of runs) {
      let earliest=null;
      for (const r of regs) {
        const c = evalCell(run, r);
        if (c.status==="leak") {
          leaks.push({ run, reg:r.id, kind:c.kind, dueDate:c.dueDate });
          if (!earliest || c.dueDate<earliest) earliest=c.dueDate;
        }
      }
      if (earliest) effDrop[run.key]=earliest;
    }
    return { leaks, effDrop };
  }, [runs, regs, cert]);

  // ── JSON 書き出し/読み込み ──
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ runs, regs, cert }, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ilist_data_${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  const importJSON = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (d.runs && d.regs && d.cert) { setRuns(d.runs); setRegs(d.regs); setCert(d.cert); }
        else alert("形式が違います。runs / regs / cert を含むファイルを選んでください。");
      } catch { alert("読み込めませんでした。JSONファイルを確認してください。"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div style={{ background:INK, minHeight:"100vh", color:"#cdd9e5", fontFamily:"ui-sans-serif, system-ui, sans-serif", padding:"22px 18px 60px" }}>
      <div style={{ maxWidth:1120, margin:"0 auto" }}>
        {/* ヘッダ */}
        <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", marginBottom:14 }}>
          <span style={{ fontFamily:"ui-monospace, monospace", color:CYAN, fontSize:13, letterSpacing:2 }}>I-LIST</span>
          <h1 style={{ fontSize:19, fontWeight:700, margin:0, color:"#eef4fa" }}>自動車型式 適合・認証取得 管理帳票</h1>
          <span style={{ flex:1 }} />
          <SaveStatus save={save} />
          <button onClick={exportJSON} style={btn(CYAN)}><Download size={13}/> データ書き出し</button>
          <button onClick={()=>fileRef.current?.click()} style={btn(MUTE,true)}><Upload size={13}/> 読み込み</button>
          <input ref={fileRef} type="file" accept="application/json" onChange={importJSON} style={{ display:"none" }} />
        </div>

        {/* ダミー専用・検証中の告知 */}
        <div style={{ background:`${AMBER}14`, border:`1px solid ${AMBER}55`, borderRadius:8, padding:"6px 12px", fontSize:11, color:AMBER, marginBottom:14 }}>
          ダミーデータ専用・業務利用未検証（移植中の骨格です）
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

        {tab==="帳票" && <MatrixView {...{runs,regs,evalCell,summary,colorOf}} />}
        {tab==="型式ラン" && <RunsEditor {...{runs,setRuns,colorOf,nextKey}} />}
        {tab==="法規DB" && <RegsEditor {...{regs,setRegs}} />}
        {tab==="認可書実績" && <CertEditor {...{typeIds,regs,cert,setCert,colorOf,evalCell,runs}} />}
      </div>
    </div>
  );
}

// ===== 帳票（マトリクス） =====
function MatrixView({ runs, regs, evalCell, summary, colorOf }) {
  const cellStyle=(s)=> s==="ok"?{bg:"rgba(63,191,143,0.13)",bd:GREEN,fg:GREEN}
    : s==="leak"?{bg:"rgba(255,107,87,0.16)",bd:RED,fg:RED}
    : {bg:"rgba(90,107,125,0.07)",bd:LINE,fg:MUTE};
  if (runs.length===0 || regs.length===0)
    return <Empty msg="型式ランと法規を入力すると、ここに適合・実績の帳票が出ます。" />;
  return (
    <>
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:10 }}>
        <Note color={CYAN}><b style={{color:CYAN}}>新型</b> 要⇔(新型適用≤LO)or(継続適用≤ドロップ)　<b style={{color:CYAN}}>継続</b> 要⇔継続適用≤ドロップ</Note>
        <Note color={AMBER}><Pencil size={10} color={AMBER}/> 手入れ＝法規DB・実績　<Cpu size={10} color={GREEN}/> 自動＝要否・申請発生・実効ドロップ</Note>
      </div>
      <div style={{ background:PANEL, borderRadius:12, padding:14, border:`1px solid ${LINE}`, overflowX:"auto" }}>
        <table style={{ borderCollapse:"separate", borderSpacing:5, width:"100%" }}>
          <thead><tr>
            <th style={{ textAlign:"left", padding:"4px 8px", fontSize:10.5, color:MUTE, minWidth:150 }}>法規 \ 型式ラン</th>
            {runs.map(run=>{ const col=colorOf(run.typeId); return (
              <th key={run.key} style={{ padding:"4px 6px", minWidth:138, verticalAlign:"top" }}>
                <div style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                  <span style={{ width:7,height:7,borderRadius:2,background:col }}/>
                  <span style={{ fontFamily:"ui-monospace, monospace", fontSize:12.5, color:"#eef4fa", fontWeight:700, borderBottom:`2px solid ${col}` }}>{run.typeId}</span>
                </div>
                <div style={{ fontSize:9.5, color:"#6b7d90", margin:"2px 0" }}>{run.gen}・{run.sk==="新"?"新型/指定":"継続/既指定"}</div>
                <div style={{ fontSize:9, color:MUTE, fontFamily:"ui-monospace,monospace" }}>LO {fmt(run.lo)}<br/>drop {fmt(run.drop)}</div>
              </th>);})}
          </tr></thead>
          <tbody>
            {regs.map(r=>(
              <tr key={r.id}>
                <td style={{ padding:"4px 8px", verticalAlign:"top", borderLeft:r.parent?`2px solid ${MUTE}`:"none" }}>
                  <div style={{ fontSize:12.5, fontWeight:700, color:"#eef4fa", paddingLeft:r.parent?8:0 }}>
                    {r.parent && <span style={{ color:MUTE, fontSize:10 }}>↳ </span>}{r.id}
                    <span style={{ color:"#6b7d90", fontWeight:500, fontSize:10, marginLeft:4 }}>{r.label}</span>
                  </div>
                  <div style={{ fontSize:9, color:MUTE, fontFamily:"ui-monospace,monospace", paddingLeft:r.parent?8:0, marginTop:2 }}>新{fmt(r.shin)}・継{fmt(r.kei)}</div>
                </td>
                {runs.map(run=>{ const c=evalCell(run,r); const st=cellStyle(c.status); return (
                  <td key={run.key} style={{ padding:0 }}>
                    <div style={{ background:st.bg, border:`1px solid ${st.bd}`, borderRadius:7, padding:"7px 8px", minHeight:48, display:"flex", flexDirection:"column", justifyContent:"center", gap:2 }}>
                      {c.status==="off" && <div style={{ display:"flex", alignItems:"center", gap:4, color:st.fg }}><Minus size={12}/><span style={{ fontSize:11 }}>否</span></div>}
                      {c.status==="ok" && <>
                        <div style={{ display:"flex", alignItems:"center", gap:4, color:st.fg }}><ShieldCheck size={12}/><span style={{ fontSize:10.5, fontWeight:700 }}>要</span><Badge kind={c.kind}/></div>
                        <span style={{ fontFamily:"ui-monospace,monospace", fontSize:9, color:"#bfe9d8" }}>{c.ck}</span></>}
                      {c.status==="leak" && <>
                        <div style={{ display:"flex", alignItems:"center", gap:4, color:st.fg }}><AlertTriangle size={12}/><span style={{ fontSize:10.5, fontWeight:800 }}>申請発生</span><Badge kind={c.kind}/></div>
                        <span style={{ fontSize:9, color:"#ffb3a8" }}>{c.dueDate<TODAY?"既発効・即対応":`${fmt(c.dueDate)}までに`}</span></>}
                    </div>
                  </td>);})}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display:"flex", gap:16, marginTop:10, fontSize:10.5, color:MUTE, flexWrap:"wrap", alignItems:"center" }}>
        <Leg c={GREEN} t="要・認可書あり"/><Leg c={RED} t="要・実績なし＝申請発生"/><Leg c={MUTE} t="否＝対象外"/>
        <span style={{ display:"inline-flex", gap:5 }}><Badge kind="新型"/>指定で適合<Badge kind="継続"/>継続対応</span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:13, marginTop:22 }}>
        <Card title="コンプラ漏れ（自動検出）" icon={<AlertTriangle size={15} color={RED}/>}>
          {summary.leaks.length===0 ? <p style={{ color:GREEN, fontSize:12.5, margin:0 }}>漏れなし。</p> :
            summary.leaks.map((l,i)=>(
              <div key={i} style={{ fontSize:12, padding:"5px 0", borderBottom:i<summary.leaks.length-1?`1px solid ${LINE}`:"none" }}>
                <span style={{ fontFamily:"ui-monospace,monospace", color:"#eef4fa" }}>{l.run.typeId}</span>
                <span style={{ color:"#6b7d90", fontSize:11 }}>（{l.run.gen}）</span> × <span style={{ color:"#eef4fa" }}>{l.reg}</span>
                <Badge kind={l.kind}/><span style={{ color:"#ffb3a8", fontSize:11 }}> {l.dueDate<TODAY?"既発効・即対応":fmt(l.dueDate)+"までに"}</span>
              </div>))}
        </Card>
        <Card title="実効ドロップ（規制で縛られる期限）" icon={<Activity size={15} color={CYAN}/>}>
          {Object.keys(summary.effDrop).length===0 ? <p style={{ color:GREEN, fontSize:12.5, margin:0 }}>計画ドロップまで作れる。</p> :
            Object.entries(summary.effDrop).map(([k,d],i,arr)=>{ const run=runs.find(x=>x.key===k); const risk=d<run.drop; return (
              <div key={k} style={{ fontSize:12, padding:"5px 0", borderBottom:i<arr.length-1?`1px solid ${LINE}`:"none" }}>
                <span style={{ fontFamily:"ui-monospace,monospace", color:"#eef4fa" }}>{run.typeId}</span>
                <span style={{ color:"#6b7d90", fontSize:11 }}>（{run.gen}）</span>
                <span style={{ color:risk?RED:MUTE }}> 実効 {d<TODAY?"既発効":fmt(d)}</span>
                <span style={{ color:MUTE, fontSize:11 }}>（計画 {fmt(run.drop)}）</span>
                {risk && <span style={{ color:RED, fontSize:10 }}> ← 早まる</span>}
              </div>);})}
        </Card>
      </div>
    </>
  );
}

// ===== 型式ラン編集 =====
function RunsEditor({ runs, setRuns, colorOf, nextKey }) {
  const up=(key,field,val)=>setRuns(rs=>rs.map(r=>r.key===key?{...r,[field]:val}:r));
  const add=()=>setRuns(rs=>[...rs,{key:nextKey(),typeId:"",gen:"",sk:"新",lo:"",drop:""}]);
  const del=(key)=>setRuns(rs=>rs.filter(r=>r.key!==key));
  return (
    <EditorShell title="型式ラン（型式 × プロジェクト）" desc="型式・プロジェクト（世代）・新継・LO・ドロップを入力。同じ型式を複数ランで使える（新→継など）。" onAdd={add} addLabel="ランを追加">
      <table style={tbl}>
        <thead><tr>{["型式","プロジェクト/世代","新継","LO（生産開始）","ドロップ（生産終了）",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {runs.map(r=>(
            <tr key={r.key}>
              <td style={td}><div style={{ display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ width:8,height:8,borderRadius:2,background:colorOf(r.typeId) }}/>
                <input value={r.typeId} placeholder="DEMO-0001" onChange={e=>up(r.key,"typeId",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace", width:120}}/>
              </div></td>
              <td style={td}><input value={r.gen} placeholder="FMC2026" onChange={e=>up(r.key,"gen",e.target.value)} style={inp}/></td>
              <td style={td}><select value={r.sk} onChange={e=>up(r.key,"sk",e.target.value)} style={{...inp, width:64}}><option value="新">新型</option><option value="継">継続</option></select></td>
              <td style={td}><input type="date" value={r.lo} onChange={e=>up(r.key,"lo",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace"}}/></td>
              <td style={td}><input type="date" value={r.drop} onChange={e=>up(r.key,"drop",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace"}}/></td>
              <td style={td}><button onClick={()=>del(r.key)} style={iconBtn}><Trash2 size={14} color={RED}/></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </EditorShell>
  );
}

// ===== 法規DB編集 =====
function RegsEditor({ regs, setRegs }) {
  const up=(id,field,val)=>setRegs(rs=>rs.map(r=>r.id===id?{...r,[field]:val}:r));
  const add=()=>setRegs(rs=>[...rs,{id:"",label:"",shin:"",kei:"",parent:""}]);
  const del=(id)=>setRegs(rs=>rs.filter(r=>r.id!==id));
  return (
    <EditorShell title="法規DB" desc="法規ID（UN番号）・名称・新型適用日・継続適用日を入力。シリーズアップは親法規を選ぶと帳票で↳表示される。" onAdd={add} addLabel="法規を追加">
      <table style={tbl}>
        <thead><tr>{["法規ID","名称","新型適用日","継続適用日","シリーズアップ元",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {regs.map((r,idx)=>(
            <tr key={idx}>
              <td style={td}><input value={r.id} placeholder="DEMO-REG-A2" onChange={e=>up(r.id,"id",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace", width:96}}/></td>
              <td style={td}><input value={r.label} placeholder="ダミー法規 SU" onChange={e=>up(r.id,"label",e.target.value)} style={inp}/></td>
              <td style={td}><input type="date" value={r.shin} onChange={e=>up(r.id,"shin",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace"}}/></td>
              <td style={td}><input type="date" value={r.kei} onChange={e=>up(r.id,"kei",e.target.value)} style={{...inp, fontFamily:"ui-monospace,monospace"}}/></td>
              <td style={td}><select value={r.parent||""} onChange={e=>up(r.id,"parent",e.target.value)} style={{...inp, width:110}}>
                <option value="">（なし）</option>
                {regs.filter(x=>x.id!==r.id&&x.id).map(x=><option key={x.id} value={x.id}>{x.id}</option>)}
              </select></td>
              <td style={td}><button onClick={()=>del(r.id)} style={iconBtn}><Trash2 size={14} color={RED}/></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </EditorShell>
  );
}

// ===== 認可書実績編集（型式 × 法規 グリッド）=====
function CertEditor({ typeIds, regs, cert, setCert, colorOf }) {
  const set=(typeId,regId,val)=>setCert(c=>{
    const next={...c, [typeId]:{...(c[typeId]||{})}};
    if (val) next[typeId][regId]=val; else delete next[typeId][regId];
    return next;
  });
  if (typeIds.length===0 || regs.length===0)
    return <Empty msg="型式ランと法規を入力すると、ここで認可書番号を型式×法規で入力できます。" />;
  return (
    <div>
      <p style={{ color:MUTE, fontSize:12, lineHeight:1.7, margin:"0 0 4px" }}>
        指定装置一覧＝認可書実績の入力。型式 × 法規に認可書番号を入れる（継続ランは型式の実績を共有）。空欄＝実績なし。
      </p>
      <p style={{ color:"#6b7d90", fontSize:10.5, margin:"0 0 14px" }}>※段階2では、この欄を指定装置一覧ファイルから自動で埋める設計（次の相談）。</p>
      <div style={{ background:PANEL, borderRadius:12, padding:14, border:`1px solid ${LINE}`, overflowX:"auto" }}>
        <table style={{ borderCollapse:"separate", borderSpacing:5, width:"100%" }}>
          <thead><tr>
            <th style={{ textAlign:"left", padding:"4px 8px", fontSize:10.5, color:MUTE }}>法規 \ 型式</th>
            {typeIds.map(t=>(
              <th key={t} style={{ padding:"4px 6px", minWidth:150 }}>
                <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                  <span style={{ width:7,height:7,borderRadius:2,background:colorOf(t) }}/>
                  <span style={{ fontFamily:"ui-monospace,monospace", fontSize:12.5, color:"#eef4fa", fontWeight:700 }}>{t}</span>
                </span>
              </th>))}
          </tr></thead>
          <tbody>
            {regs.map(r=>(
              <tr key={r.id}>
                <td style={{ padding:"4px 8px" }}><span style={{ fontSize:12, color:"#eef4fa", fontWeight:600 }}>{r.id}</span></td>
                {typeIds.map(t=>(
                  <td key={t} style={{ padding:0 }}>
                    <input value={cert[t]?.[r.id]||""} placeholder="認可書番号" onChange={e=>set(t,r.id,e.target.value)}
                      style={{ width:"100%", background:cert[t]?.[r.id]?"rgba(63,191,143,0.08)":"transparent", border:`1px solid ${cert[t]?.[r.id]?GREEN:LINE}`, borderRadius:6, color:"#bfe9d8", fontSize:10, fontFamily:"ui-monospace,monospace", padding:"7px 8px", boxSizing:"border-box" }}/>
                  </td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===== 保存ステータス表示 =====
function SaveStatus({ save }) {
  const m = {
    loading:  { c: MUTE,  t: "読み込み中…" },
    saving:   { c: AMBER, t: "保存中…" },
    saved:    { c: GREEN, t: "サーバに保存済み" },
    // 初回読込に失敗＝保存自体を止めている（サーバ側データは保護される）
    loadError:{ c: RED,   t: "初回読込に失敗（保存は行われません）" },
    // 読込は成功したがPUTが失敗＝画面の変更がサーバに入っていない
    saveError:{ c: RED,   t: "保存に失敗（変更は未保存です）" },
  }[save];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, color:m.c }}>
      <span style={{ width:7, height:7, borderRadius:"50%", background:m.c }} />{m.t}
    </span>
  );
}

// ===== 共通パーツ =====
function EditorShell({ title, desc, onAdd, addLabel, children }) {
  return (
    <div>
      <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:12 }}>
        <div style={{ flex:1 }}>
          <h2 style={{ fontSize:14, fontWeight:700, margin:"0 0 3px", color:"#eef4fa" }}>{title}</h2>
          <p style={{ color:MUTE, fontSize:11.5, margin:0, lineHeight:1.6 }}>{desc}</p>
        </div>
        <button onClick={onAdd} style={btn(CYAN)}><Plus size={13}/> {addLabel}</button>
      </div>
      <div style={{ background:PANEL, borderRadius:12, padding:14, border:`1px solid ${LINE}`, overflowX:"auto" }}>{children}</div>
    </div>
  );
}
function Empty({ msg }) {
  return <div style={{ background:PANEL, border:`1px dashed ${LINE}`, borderRadius:12, padding:"40px 20px", textAlign:"center", color:MUTE, fontSize:12.5 }}>{msg}</div>;
}
function Note({ color, children }) {
  return <div style={{ flex:"1 1 300px", background:`${color}0d`, border:`1px solid ${color}33`, borderRadius:9, padding:"8px 12px", fontSize:11.5, lineHeight:1.6 }}>{children}</div>;
}
function Badge({ kind }) {
  const isNew=kind==="新型";
  return <span style={{ fontSize:8.5, fontWeight:700, padding:"0px 4px", borderRadius:3, marginLeft:2, color:isNew?"#0c1623":"#fff", background:isNew?CYAN:"rgba(157,140,255,0.85)" }}>{kind}</span>;
}
function Leg({ c, t }) {
  return <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}><span style={{ width:10,height:10,borderRadius:3,background:c,opacity:0.85 }}/>{t}</span>;
}
function Card({ title, icon, children }) {
  return <div style={{ background:PANEL, border:`1px solid ${LINE}`, borderRadius:12, padding:"13px 15px" }}>
    <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:9 }}>{icon}<h3 style={{ fontSize:12.5, fontWeight:700, margin:0, color:"#eef4fa" }}>{title}</h3><span style={{ flex:1, height:1, background:LINE }}/></div>
    {children}</div>;
}
function fmt(d){ return d ? d.replaceAll("-","/").slice(0,7) : "—"; }
const btn=(c,ghost)=>({ display:"inline-flex", alignItems:"center", gap:5, background:ghost?"transparent":c, color:ghost?"#aab8c6":"#0c1623", border:ghost?`1px solid ${LINE}`:"none", borderRadius:7, padding:"6px 12px", fontSize:12, fontWeight:600, cursor:"pointer" });
const tbl={ borderCollapse:"collapse", width:"100%" };
const th={ textAlign:"left", padding:"6px 8px", fontSize:10.5, color:MUTE, fontWeight:600, borderBottom:`1px solid ${LINE}` };
const td={ padding:"5px 8px", borderBottom:`1px solid ${LINE}` };
const inp={ background:"#0c1623", border:`1px solid ${LINE}`, borderRadius:6, color:"#cdd9e5", fontSize:11.5, padding:"6px 8px", width:130, boxSizing:"border-box" };
const iconBtn={ background:"transparent", border:"none", cursor:"pointer", padding:4 };
