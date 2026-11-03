// F-42の条件番号で検証：人の対象外判断は取得予定（○）を隠さない。ダミーのみ。実API/DBへの接続なし。
// 純関数（makeCertStatusContext・buildCellModel・riskSections）と実部品（チェック操作・判断の確定と戻し・保存→再読込）の両方で確かめる。
import React from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import { TODAY, SEED, buildCellModel, riskSections, makeSamenessContext, parseImportedData, condOf,
  replaceBootData, readBootData } from "../src/IListApp.jsx";
import { makeCertStatusContext, setCertPlanned } from "../standalone/cert-status.js";
const clone = (x) => JSON.parse(JSON.stringify(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shift = (n) => { const d = new Date(TODAY+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const run = (key, typeId, lo, drop = shift(300)) => ({key,typeId,lo,gen:"DUMMY-PJ",sk:"新",drop});
const REQ = (rid = "g901") => ({rid,id:"DUMMY-REG",label:"ダミー法規",shin:shift(-500),kei:shift(-300),parent:""});   // 要
const NOT = (rid = "g901") => ({rid,id:"DUMMY-REG",label:"ダミー法規",shin:shift(200),kei:shift(500),parent:""});    // 否（LO+100 < 新型車日）
const record = (runKey,rid,ck="",planned=false) => ({runKey,rid,ck,planned});
// 人の判断。cond はいまの条件（＝要再確認は立たない）。recheck="flag" は保存済みフラグ、"cond" は確定時から条件が変わった
const decOf = (d, state, recheck = "") => { const r = d.runs.find((x) => x.key === "r902"), g = d.regs[0], cond = condOf(r, g, d.regs);
  return {runKey:"r902",rid:g.rid,state,reason:state==="対象外"?"ダミー：対象外の理由":"",decidedAt:`${TODAY} 09:00`,
    needsRecheck:recheck==="flag",cond:recheck==="cond"?{...cond,kei:shift(-299)}:cond}; };
const data = (regOf = REQ, lo = shift(100)) => ({schemaVersion:2,runs:[run("r901","DUMMY-A",shift(-200)),run("r902","DUMMY-A",lo)],
  regs:[regOf()],cert:[],decisions:[],bases:[],sameness:[]});
const view = (d) => {
  const sameCtx = makeSamenessContext(d.runs,d.bases,d.sameness);
  const ctx = makeCertStatusContext(d.runs,d.cert,d.decisions,sameCtx,TODAY);
  const model = buildCellModel({runs:d.runs,regs:d.regs,evalCell:ctx.evaluate,decisions:d.decisions,sameCtx,today:TODAY});
  return {model,cell:model.get(d.runs[1],d.regs[0]),sections:riskSections(model,{runs:d.runs}).sections};
};
const planSig = (m) => [m.auto.planVisible,m.auto.planned,m.auto.canPlan,m.auto.certPlan,m.decision.車両申請];
const results=[];
const check=(label,actual,expected)=>{results.push({label,pass:JSON.stringify(actual)===JSON.stringify(expected),actual,expected});};
const boot = (d) => { const p=parseImportedData(clone(d)); if(!p.ok) throw new Error(p.error); return {present:true,...p}; };
const mount=async(bootData)=>{const c=document.createElement("div");document.getElementById("sandbox").append(c);const root=createRoot(c);root.render(<StandaloneApp bootData={bootData}/>);await sleep(70);return {c,close:()=>{root.unmount();c.remove();}};};
const button=async(c,text)=>{const b=[...c.querySelectorAll("button")].find(b=>b.textContent.includes(text));if(!b)throw new Error("button missing: "+text);b.click();await sleep(40);};
const setInput=async(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));await sleep(40);};
const setText=async(el,value)=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));await sleep(40);};
const checkbox=(c,key="r902",rid="g901")=>c.querySelector(`input[aria-label="取得予定 ${key} ${rid}"]`);
const cell=(c)=>c.querySelector("table tbody").children[0].children[2];
const snapshot=async(c,html=false)=>{const create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=HTMLAnchorElement.prototype.click;let blob;
  URL.createObjectURL=(b)=>{blob=b;return "blob:dummy";};URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=()=>{};
  try{await button(c,html?"データ入りHTMLを保存":"JSONに書き出し");const s=await blob.text();return html?s:JSON.parse(s);}finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;HTMLAnchorElement.prototype.click=click;}};
const savedPlan=(s)=>s.cert.filter(c=>c.runKey==="r902").map(c=>[c.ck,c.planned]);
const savedDec=(s)=>s.decisions.filter(x=>x.runKey==="r902").map(x=>[x.state,x.reason,x.needsRecheck]);
// 判断の編集：ラジオを選び、理由を入れて保存ボタンを押す
const decide=async(c,state,label)=>{cell(c).querySelector('button[aria-label="適用判断・理由メモを編集"]').click();await sleep(40);
  [...cell(c).querySelectorAll('input[type="radio"]')].find(e=>e.parentElement.textContent.includes(state)).click();await sleep(40);
  if(state==="対象外")await setText(cell(c).querySelector("textarea"),"ダミー：対象外の理由");await button(cell(c),label);};
// 対象外の灰の状態表示・セルの色（○の行は除いて比べる）
const cellLook=(c)=>{const box=cell(c).firstElementChild,cs=getComputedStyle(box);const t=box.cloneNode(true);t.querySelectorAll("label").forEach(l=>{l.nextElementSibling?.tagName==="SPAN"&&!l.nextElementSibling.querySelector("*")&&/LO到来済み/.test(l.nextElementSibling.textContent)&&l.nextElementSibling.remove();l.remove();});
  return [cs.backgroundColor,cs.borderTopColor,cs.borderTopStyle,t.textContent];};

async function verify(){
  // ── A1・A2・B3・A6（重なり）：判断の有無だけを変えて、○の出方・付けられるか・決定表への渡し方が判断なしと同じ ──
  const LOS=[shift(-1),TODAY,shift(1),""];
  const CERTS={なし:()=>[],予定:()=>[record("r902","g901","",true)],番号:()=>[record("r902","g901","DUMMY*02",true)],
    前例:()=>[record("r901","g901","DUMMY*01"),record("r902","g901","",true)]};
  const DECS=[["対象",""],["対象外",""],["対象外","flag"],["対象外","cond"]];
  let same=0,diff=[];
  for(const regOf of [REQ,NOT])for(const lo of LOS)for(const [cn,certOf] of Object.entries(CERTS)){
    const d=data(regOf,lo);d.cert=certOf();const base=planSig(view(d).cell);
    for(const [state,recheck] of DECS){const e=clone(d);e.decisions=[decOf(e,state,recheck)];const v=view(e).cell;
      if(JSON.stringify(planSig(v))===JSON.stringify(base)&&v.dec.state===state)same++;else diff.push([regOf===REQ?"要":"否",lo,cn,state,recheck,planSig(v),base]);}
  }
  check("A1/A2/B3/A6 判断（対象・対象外・対象外＋要再確認2種）でも○の出方・付け外し・決定表への渡し方は判断なしと同じ（要否×LO4種×実績4種）",[same,diff],[2*4*4*4,[]]);
  for(const regOf of [REQ,NOT])for(const [state,recheck,name] of [["対象外","","A1 対象外"],["対象外","flag","A2 対象外・要再確認"]]){
    const d=data(regOf);d.decisions=[decOf(d,state,recheck)];const v=view(d).cell;
    check(`${name}（${regOf===REQ?"要":"否"}）未来LO・実績なし・前例なしは○の欄が出て付けられる`,[v.auto.planVisible,v.auto.canPlan,v.auto.planned],[true,true,false]);
    d.runs[1].lo=shift(-1);d.cert=[record("r902","g901","",true)];const w=view(d).cell;
    check(`${name}（${regOf===REQ?"要":"否"}）LO到来済みの○は見えて外せるが、新たには付けられない`,[w.auto.planVisible,w.auto.planned,w.auto.canPlan],[true,true,false]);
  }
  // ── A3：○と判断の順序を入れ替えても、○の表示と保存値は変わらない ──
  {const d=data();d.cert=setCertPlanned(d.cert,"r902","g901",true);const certAfter=clone(d.cert);const seq=[];
    for(const [state,recheck] of [["対象外",""],["未確認",""],["対象外","flag"],["対象外",""],["対象外","cond"],["未確認",""]]){
      d.decisions=state==="未確認"?[]:[decOf(d,state,recheck)];const v=view(d).cell;seq.push([v.auto.planVisible,v.auto.planned]);}
    check("A3 ○のあと 対象外確定→未確認→要再確認付け→外し→条件変化→未確認 で○は見えたまま",seq,Array(6).fill([true,true]));
    check("A3 判断を変えても保存値（cert）は同じ",d.cert,certAfter);
    const e=data();e.decisions=[decOf(e,"対象外","")];e.cert=setCertPlanned(e.cert,"r902","g901",true);
    check("A3 逆順（対象外を確定してから○）でも付く",[view(e).cell.auto.planned,e.cert],[true,[record("r902","g901","",true)]]);}
  // ── A4：対象外＋○は「実績なし+予定あり」で渡り、計画済み。危険一覧で対象外の印と計画済みが並ぶ ──
  for(const [recheck,mark] of [["","対象外"],["flag","対象外・要再確認"]]){
    const d=data();d.cert=[record("r902","g901","",true)];d.decisions=[decOf(d,"対象外",recheck)];const v=view(d);
    check(`A4 ${mark}＋○の決定表入力と車両申請`,[v.cell.auto.certPlan,v.cell.decision.車両申請,v.cell.risk?.kind,v.cell.exemptMark],["実績なし+予定あり","発生する（計画済み）","期限前",mark]);
    const s=v.sections.find(x=>x.kind==="期限前");
    check(`A4 ${mark}＋○は危険一覧の期限前に出る（件数・寄せは対象外のまま）`,[s.count,s.exempt,s.rows.map(r=>[r.run.key,r.aside])],[1,mark==="対象外"?1:0,[["r902",mark==="対象外"]]]);
  }
  {const d=data(REQ,shift(-400));d.runs[1].drop=shift(-10);d.cert=[record("r902","g901","",true)];d.decisions=[decOf(d,"対象外","")];const v=view(d);
    check("A4 drop済みのランの対象外＋○は危険一覧に出ないまま",[v.cell.risk,v.sections.some(s=>s.rows.some(r=>r.run.key==="r902"))],[null,false]);}
  // ── A5・B5：初期ダミー ──
  check("B5 初期ダミーの人の適用判断（6件）",SEED.decisions.map(x=>[x.runKey,x.rid,x.state,x.needsRecheck]),
    [["r11","g3","対象外",false],["r11","g5","対象外",true],["r4","g4","対象外",false],["r7","g4","対象外",true],["r6","g6","対象外",false],["r11","g6","対象外",true]]);
  check("A5/B5 初期ダミーの○は r7×REG-E と r7×REG-C の2件だけ",SEED.cert.filter(c=>c.planned).map(c=>[c.runKey,c.rid,c.ck]),[["r7","g6",""],["r7","g4",""]]);
  {const v=view(SEED),r7=SEED.runs.find(r=>r.key==="r7"),gC=SEED.regs.find(g=>g.rid==="g4"),m=v.model.get(r7,gC);
    check("A5 r7×REG-C は対象外・要再確認＋○、期限前・未取得・計画済み",[r7.lo>TODAY,m.dec.state,m.exemptMark,m.auto.planVisible,m.auto.planned,m.risk?.kind,m.decision.車両申請],
      [true,"対象外","対象外・要再確認",true,true,"期限前","発生する（計画済み）"]);}
  let app=await mount(undefined);try{
    const box=checkbox(app.c,"r7","g4"),td=box?.closest("td");
    check("A5/A2 帳票の r7×REG-C に「人：対象外」と要再確認と○が並ぶ",[!!box&&box.checked,!!td&&td.textContent.includes("人：対象外"),!!td&&td.textContent.includes("要再確認")],[true,true,true]);
    const before=await snapshot(app.c);
    [...app.c.querySelectorAll("button")].find(b=>b.textContent.includes("危険な型式ラン")).click();await sleep(40);
    await button(app.c,"すべて展開");
    const rows=[...app.c.querySelectorAll("tr")].filter(tr=>!tr.hasAttribute("data-risk-section")&&!tr.hasAttribute("data-risk-run")&&tr.querySelector("[data-risk-exempt]")&&/DEMO-REG-C/.test(tr.children[0]?.textContent||""));
    const r7C=rows.filter(tr=>tr.textContent.includes("計画済み"));
    check("A4/A5 危険一覧の r7×REG-C に対象外・要再確認の印と計画済みの印が両方出る",r7C.map(tr=>tr.querySelector("[data-risk-exempt]").getAttribute("data-risk-exempt")),["対象外・要再確認"]);
    check("B5 一覧を開いても保存データは同じ",await snapshot(app.c),before);
  }finally{app.close();}
  // ── A1・B2・B4：実画面のチェック操作（対象外のセル） ──
  {const d=data();d.decisions=[decOf(d,"対象外","")];app=await mount(boot(d));try{
    const look0=cellLook(app.c);
    check("A1 帳票の対象外セルに「人：対象外」と○の欄が並ぶ",[cell(app.c).textContent.includes("人：対象外"),!!checkbox(app.c),checkbox(app.c)?.disabled],[true,true,false]);
    const dec0=savedDec(await snapshot(app.c));
    checkbox(app.c).click();await sleep(40);let s=await snapshot(app.c);
    check("A1 対象外のセルで○を付けると保存値 true",savedPlan(s),[["",true]]);
    check("B2 ○を付けても人の判断（状態・理由・要再確認）は同じ",savedDec(s),dec0);
    check("B4 ○を付けてもセルの色・状態表示は同じ",cellLook(app.c),look0);
    checkbox(app.c).click();await sleep(40);s=await snapshot(app.c);
    check("A6 ○を外して保存すると予定なし（見えない保存値が残らない）",savedPlan(s),[]);
    check("B2 ○を外しても人の判断は同じ",savedDec(s),dec0);
  }finally{app.close();}}
  {const d=data();d.decisions=[decOf(d,"対象外","")];d.cert=[record("r902","g901","DUMMY*OWN")];app=await mount(boot(d));try{
    check("B4 対象外セルの認可番号（実績）の表示は従来どおり・○は出ない",[cell(app.c).textContent.includes("DUMMY*OWN"),cell(app.c).textContent.includes("人：対象外"),!!checkbox(app.c)],[true,true,false]);
  }finally{app.close();}}
  // ── A3：実画面で ○→判断の変更、判断→○ ──
  {const d=data();app=await mount(boot(d));try{
    checkbox(app.c).click();await sleep(40);
    await decide(app.c,"対象外","この判断で確定");
    let s=await snapshot(app.c);
    check("A3 ○のあと対象外を確定しても○と保存値はそのまま",[checkbox(app.c)?.checked,savedPlan(s),savedDec(s)],[true,[["",true]],[["対象外","ダミー：対象外の理由",false]]]);
    await decide(app.c,"未確認","未確認に戻す");s=await snapshot(app.c);
    check("A3 未確認へ戻しても○と保存値はそのまま",[checkbox(app.c)?.checked,savedPlan(s),savedDec(s).map(x=>x[0])],[true,[["",true]],["未確認"]]);
    await decide(app.c,"対象外","この判断で確定");
    // 要再確認を付ける：このランのLOを（未来のまま）変える＝確定時から条件が変わる
    await button(app.c,"型式ラン");await setInput(app.c.querySelectorAll('tbody tr')[1].querySelector('input[type="date"]'),shift(120));await button(app.c,"帳票");
    s=await snapshot(app.c);
    check("A3 要再確認が付いても○と保存値はそのまま",[cell(app.c).textContent.includes("要再確認"),checkbox(app.c)?.checked,savedPlan(s),savedDec(s).map(x=>[x[0],x[2]])],[true,true,[["",true]],[["対象外",true]]]);
    cell(app.c).querySelector('button[aria-label="適用判断・理由メモを編集"]').click();await sleep(40);await button(cell(app.c),"この内容で再確定");
    s=await snapshot(app.c);
    check("A3 要再確認を外しても○と保存値はそのまま",[cell(app.c).textContent.includes("要再確認"),checkbox(app.c)?.checked,savedPlan(s),savedDec(s).map(x=>[x[0],x[2]])],[false,true,[["",true]],[["対象外",false]]]);
  }finally{app.close();}}
  {const d=data();app=await mount(boot(d));try{
    await decide(app.c,"対象外","この判断で確定");
    check("A3 逆順：対象外を確定したあとも○の欄が出て付けられる",[!!checkbox(app.c),checkbox(app.c)?.disabled],[true,false]);
    checkbox(app.c).click();await sleep(40);const s=await snapshot(app.c);
    check("A3 逆順：対象外のあと○を付けると保存値 true・判断はそのまま",[checkbox(app.c)?.checked,savedPlan(s),savedDec(s).map(x=>x[0])],[true,[["",true]],["対象外"]]);
  }finally{app.close();}}
  // ── A6：対象外に planned: true が残っている既存データを開く・保存→再読込 ──
  {const d=data();d.decisions=[decOf(d,"対象外","")];d.cert=[record("r902","g901","",true)];app=await mount(boot(d));try{
    check("A6 既存JSONの対象外＋planned:true は○が出る（チェック済み・外せる）",[checkbox(app.c)?.checked,checkbox(app.c)?.disabled,cell(app.c).textContent.includes("人：対象外")],[true,false,true]);
    const saved=await snapshot(app.c);
    let next=await mount(boot(saved));
    check("A6 JSONで保存→再読込しても対象外と○の両方が残る",[checkbox(next.c)?.checked,cell(next.c).textContent.includes("人：対象外"),savedPlan(await snapshot(next.c)),savedDec(await snapshot(next.c)).map(x=>x[0])],[true,true,[["",true]],["対象外"]]);next.close();
    // データ入りHTMLは書き出したデータを単体HTMLの雛形へ埋め込んだもの（実ファイルでの確認は verify/plan-exempt-file.mjs）
    const template='<!doctype html><html><body><!--ILIST_BOOT_DATA_START--><script id="ilist-boot-data" type="application/json">null</script><!--ILIST_BOOT_DATA_END--></body></html>';
    const read=readBootData(new DOMParser().parseFromString(replaceBootData(template,saved).html,"text/html"));
    next=await mount(read);
    check("A6 データ入りHTMLで保存→再読込しても対象外と○の両方が残る",[read.ok,checkbox(next.c)?.checked,cell(next.c).textContent.includes("人：対象外"),savedDec(await snapshot(next.c)).map(x=>x[0])],[true,true,true,["対象外"]]);next.close();
    checkbox(app.c).click();await sleep(40);
    const off=await snapshot(app.c);check("A6 ○を外して保存すると予定なし",savedPlan(off),[]);
    next=await mount(boot(off));check("A6 外して保存→再読込で○なし・対象外は残る",[checkbox(next.c)?.checked,cell(next.c).textContent.includes("人：対象外")],[false,true]);next.close();
  }finally{app.close();}}
  for(const [name,edit] of [["実績（番号）あり",(d)=>{d.cert[0].ck="DUMMY*02";}],["前例あり",(d)=>{d.cert.push(record("r901","g901","DUMMY*01"));}],["LO空",(d)=>{d.runs[1].lo="";}]]){
    const d=data();d.decisions=[decOf(d,"対象外","")];d.cert=[record("r902","g901","",true)];edit(d);d.decisions=[decOf(d,"対象外","")];app=await mount(boot(d));try{
      const s=await snapshot(app.c);
      check(`A6 対象外＋planned:true でも${name}なら既存の規則で○を隠し保存値を保持`,[!!checkbox(app.c),s.cert.find(c=>c.runKey==="r902").planned],[false,true]);
    }finally{app.close();}
  }
  // HTML埋込→読み出し（replaceBootData）の経路でも同じ
  {const d=data();d.decisions=[decOf(d,"対象外","")];d.cert=[record("r902","g901","",true)];
    const template='<!doctype html><html><body><!--ILIST_BOOT_DATA_START--><script id="ilist-boot-data" type="application/json">null</script><!--ILIST_BOOT_DATA_END--></body></html>';
    const embedded=replaceBootData(template,boot(d).data);const read=readBootData(new DOMParser().parseFromString(embedded.html,"text/html"));
    app=await mount(boot(read.data));try{check("A6 既存のデータ入りHTML（対象外＋planned:true）を開くと○が出る",[embedded.ok,checkbox(app.c)?.checked],[true,true]);}finally{app.close();}}
}
// 確認用画面：対象外＋○（要）、対象外・要再確認＋○（要）、対象外で○なし（要）、対象外＋○（否）、対象外＋○（LO到来済み）
const D=(key,typeId,lo)=>run(key,typeId,lo);
export const DEMO={schemaVersion:2,
  runs:[D("r921","DUMMY-A",shift(100)),D("r922","DUMMY-B",shift(100)),D("r923","DUMMY-C",shift(100)),D("r924","DUMMY-D",shift(-10))],
  regs:[REQ("g921"),NOT("g922")],
  cert:[record("r921","g921","",true),record("r922","g921","",true),record("r921","g922","",true),record("r924","g921","",true)],
  decisions:[],bases:[],sameness:[]};
for(const [k,rid,recheck] of [["r921","g921",false],["r922","g921",true],["r923","g921",false],["r921","g922",false],["r924","g921",false]]){
  const r=DEMO.runs.find(x=>x.key===k),g=DEMO.regs.find(x=>x.rid===rid);
  DEMO.decisions.push({runKey:k,rid,state:"対象外",reason:"ダミー：対象外の理由",decidedAt:`${TODAY} 09:00`,needsRecheck:recheck,cond:condOf(r,g,DEMO.regs)});
}
window.__F42_DEMO__=DEMO;
verify().catch(e=>check("例外",String(e.stack),null)).finally(()=>{
  const pass=results.filter(x=>x.pass).length,fail=results.length-pass;
  window.__F42VERIFY_RESULT__={finished:true,pass,fail,results};
  document.getElementById("result").textContent=`F-42 セルフ検証 PASS ${pass} / FAIL ${fail}（下は確認用のダミー画面）`;
  createRoot(document.getElementById("preview")).render(<StandaloneApp bootData={boot(DEMO)}/>);
});
