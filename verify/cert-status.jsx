// F-23の条件番号で検証。ダミーのみ。実API/DBへの接続なし。
import React from "react";
import { createRoot } from "react-dom/client";
import StandaloneApp from "../standalone/StandaloneApp.jsx";
import { TODAY, buildCellModel, riskRunRows, makeSamenessContext, parseImportedData,
  setCertNumber, replaceBootData, readBootData, evalCellWith } from "../src/IListApp.jsx";
import { makeCertStatusContext, setCertPlanned } from "../standalone/cert-status.js";
const clone = (x) => JSON.parse(JSON.stringify(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shift = (n) => { const d = new Date(TODAY+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const run = (key, typeId, lo, gen = "DUMMY-PJ") => ({key,typeId,lo,gen,sk:"新",drop:shift(300)});
const reg = (rid, id, shin = shift(-500), kei = shift(-300)) => ({rid,id,label:"ダミー法規",shin,kei,parent:""});
const record = (runKey,rid,ck="",planned=false) => ({runKey,rid,ck,planned});
const data = () => ({schemaVersion:2,runs:[run("r901","DUMMY-A",shift(-200)),run("r902","DUMMY-A",shift(100))],
  regs:[reg("g901","DUMMY-REG")],cert:[record("r901","g901","DUMMY*01")],decisions:[],bases:[],sameness:[]});
const view = (d, today = TODAY) => {
  const sameCtx = makeSamenessContext(d.runs,d.bases,d.sameness);
  const ctx = makeCertStatusContext(d.runs,d.cert,d.decisions,sameCtx,today);
  const model = buildCellModel({runs:d.runs,regs:d.regs,evalCell:ctx.evaluate,decisions:d.decisions,sameCtx,today});
  return {ctx,model,cell:model.get(d.runs[1],d.regs[0]),risks:riskRunRows(model)};
};
const results=[];
const check=(label,actual,expected)=>{results.push({label,pass:JSON.stringify(actual)===JSON.stringify(expected),actual,expected});};
const hasPrevious=(d)=>view(d).cell.auto.handover;
const boot = (d) => { const p=parseImportedData(clone(d)); if(!p.ok) throw new Error(p.error); return {present:true,...p}; };
const mount=async(d)=>{const c=document.createElement("div");document.getElementById("sandbox").append(c);const root=createRoot(c);root.render(<StandaloneApp bootData={boot(d)}/>);await sleep(70);return {c,close:()=>{root.unmount();c.remove();}};};
const button=async(c,text)=>{[...c.querySelectorAll("button")].find(b=>b.textContent.includes(text)).click();await sleep(40);};
const setInput=async(el,value)=>{const proto=el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(el,value);el.dispatchEvent(new Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));await sleep(40);};
const riskSignature=(v)=>v.risks.map(r=>({key:r.run.key,bad:r.bad,warn:r.warn,cells:r.cells.map(m=>({rid:m.reg.rid,risk:m.risk}))}));
const checkbox=(c,key="r902",rid="g901")=>c.querySelector(`input[aria-label="取得予定 ${key} ${rid}"]`);
const cell=(c,row=0,col=1)=>c.querySelector("table tbody").children[row].children[col+1];
const snapshot=async(c,html=false)=>{const create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=HTMLAnchorElement.prototype.click;let blob;
  URL.createObjectURL=(b)=>{blob=b;return "blob:dummy";};URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=()=>{};
  try{await button(c,html?"データ入りHTMLを保存":"JSONに書き出し");const s=await blob.text();return html?s:JSON.parse(s);}finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;HTMLAnchorElement.prototype.click=click;}};
async function verify(){
  let d=data();
  check("A1/A7 前例→実績あり・引き継ぎあり",[view(d).cell.decision.表示,view(d).cell.auto.certPlan,view(d).cell.auto.ck],["引き継ぎ確認中","実績あり",null]);
  check("B1/B2 前例は保存せず危険一覧にも出さない",[d.cert.length,view(d).risks.length],[1,0]);
  d.runs.push(run("r903","DUMMY-A",shift(-100)),run("r904","DUMMY-A",shift(150)));
  check("A2 直前に番号がなくても遡る・新規ランが2つ続く",d.runs.slice(1).map(r=>view(d).ctx.evaluate(r,d.regs[0]).handover),[true,true,true]);
  d=data();d.runs[0].lo="";check("B9 前例元のLO空",hasPrevious(d),false);
  d=data();d.runs[0].lo=d.runs[1].lo;check("A2 同型式の同じLOは前例にしない",hasPrevious(d),false);
  d=data();d.runs[1].typeId="DUMMY-B";check("A3 型式変更に追従",hasPrevious(d),false);
  d.runs[0].lo=d.runs[1].lo;d.bases=[{runKey:"r902",baseRunKey:"r901",decidedAt:""}];
  for(const value of ["同一","同一でない","未確認"]){d.sameness=[{runKey:"r902",rid:"g901",value,baseRunKey:"r901",reason:"ダミー",decidedAt:"",needsRecheck:false}];check(`A2 比較元の同じLO・${value}`,hasPrevious(d),true);}
  d.runs[0].lo=shift(101);check("B9 比較元LOが後",hasPrevious(d),false);
  d.runs[0].lo="";check("B9 比較元LO空",hasPrevious(d),false);
  d.runs[0].lo=shift(-200);d.bases=[];check("A3 比較元解除",hasPrevious(d),false);
  d=data();d.runs.forEach(r=>r.typeId="");check("B10 型式空どうし",hasPrevious(d),false);
  d=data();d.cert[0].ck=" \t\n ";check("B6 空白だけは前例にしない",hasPrevious(d),false);
  d.cert.push(record("r902","g901"," \t "));check("B6 空白だけは実績にもならない",view(d).cell.auto.ck,null);
  d=data();d.runs[1].lo="";d.cert.push(record("r902","g901","",true));check("B3 LO空は判定不能・○非表示",[view(d).cell.decision.表示,view(d).cell.auto.planVisible],["判定不能",false]);
  d=data();d.regs[0]=reg("g901","DUMMY-REG",shift(200),shift(500));check("A1 否は前例があっても否",view(d).cell.decision.表示,"否");
  d.cert=[];check("A4 否でも未来LOなら○を付けられる",[view(d).cell.decision.表示,view(d).cell.auto.canPlan],["否",true]);d.cert=setCertPlanned(d.cert,"r902","g901",true);check("A5/A6 否の○も決定表へ渡す",[view(d).cell.auto.planned,view(d).cell.auto.certPlan,view(d).cell.decision.表示],[true,"実績なし+予定あり","否"]);
  d=data();d.decisions=[{runKey:"r902",rid:"g901",state:"対象外",reason:"ダミー",decidedAt:"",needsRecheck:false,cond:null}];check("B11 対象外にも前例→待ち、人の行を保持",[view(d).cell.decision.表示,view(d).cell.dec.state,view(d).cell.compliance],["引き継ぎ確認中","対象外",null]);
  d.cert=[];check("A4/A5 対象外は○非表示・入力不可",[view(d).cell.auto.planVisible,view(d).cell.auto.canPlan],[false,false]);
  d=data();d.cert=[];check("A4 前例なし未来LOは付けられる",view(d).cell.auto.canPlan,true);
  d.cert=setCertPlanned(d.cert,"r902","g901",true);check("A6 ○→計画済み、実績にはならない",[view(d).cell.decision.車両申請,view(d).cell.decision.表示],["発生する（計画済み）","申請発生"]);
  for(const lo of [shift(-1),TODAY,shift(1)]){d.runs[1].lo=lo;const v=view(d).cell.auto;check(`A4/A5/B7 LO=${lo}`,[v.planVisible,v.planned,v.canPlan],[true,true,lo>TODAY]);}
  const riskBefore=view(d).risks;d.cert=setCertPlanned(d.cert,"r902","g901",false);check("B5 危険一覧の行と件数は○の有無で同じ",view(d).risks,riskBefore);check("A6 ○なしは未計画",view(d).cell.decision.車両申請,"発生する（未計画）");
  d=data();d.cert=[record("r902","g901","",true)];
  for(const condition of ["precedent","lo","ck","excluded"]){let hidden=clone(d);if(condition==="precedent")hidden.cert.push(record("r901","g901","DUMMY*01"));if(condition==="lo")hidden.runs[1].lo="";if(condition==="ck")hidden.cert=setCertNumber(hidden.cert,"r902","g901"," DUMMY*02 ");if(condition==="excluded")hidden.decisions=[{runKey:"r902",rid:"g901",state:"対象外"}];
    check(`A10 ${condition}で○を隠し保存値は保持`,[view(hidden).cell.auto.planVisible,hidden.cert.find(c=>c.runKey==="r902").planned],[false,true]);check(`A10 ${condition}の条件が戻ると○復帰`,view(d).cell.auto.planned,true);}
  d.cert=setCertNumber(d.cert,"r902","g901"," DUMMY*02 ");check("A9/B8 番号優先・trimは入力だけ",[view(d).cell.decision.表示,view(d).cell.auto.ck,d.cert[0].ck],["実績あり","DUMMY*02"," DUMMY*02 "]);
  check("B12 API版は空白・plannedを従来どおり扱う",[evalCellWith([record("r902","g901"," ",true)],d.runs[1],d.regs[0]).ck,evalCellWith([record("r902","g901","",true)],d.runs[1],d.regs[0]).status],[" ","leak"]);
  for(const kind of ["不適合","予告"]){
    d=data();d.cert=[];d.runs[1].lo=shift(-10);if(kind==="予告"){d.runs[1].drop=shift(5);d.regs[0]=reg("g901","DUMMY-REG",shift(50),shift(15));}
    const before=riskSignature(view(d));check(`B5 ${kind}の危険セルが存在`,view(d).cell.risk.kind,kind);d.cert=setCertPlanned(d.cert,"r902","g901",true);check(`B5 ${kind}の行・件数は○で変わらない`,riskSignature(view(d)),before);
  }
  // 実部品のチェック操作、dirty、保存・読込、対象外行、色と破線。
  d=data();d.cert=[];let app=await mount(d);
  try{
    checkbox(app.c).click();await sleep(40);let saved=await snapshot(app.c);check("A4/A8 UIチェック→保存true",saved.cert,[record("r902","g901","",true)]);
    checkbox(app.c).click();await sleep(40);check("A4 UIオフ",(await snapshot(app.c)).cert,[]);
    checkbox(app.c).click();await sleep(40);check("A8 dirty表示",app.c.textContent.includes("未書き出しの変更があります"),true);
    saved=await snapshot(app.c);let next=await mount(saved);check("A8 JSON再読込で○復元",checkbox(next.c).checked,true);next.close();
    const template='<!doctype html><html><body><!--ILIST_BOOT_DATA_START--><script id="ilist-boot-data" type="application/json">null</script><!--ILIST_BOOT_DATA_END--></body></html>';
    const embedded=replaceBootData(template,saved);check("A8 HTML埋込",embedded.ok,true);const doc=new DOMParser().parseFromString(embedded.html,"text/html");const read=readBootData(doc);next=await mount(read.data);check("A8 HTML再読込で○復元",checkbox(next.c).checked,true);next.close();
  }finally{app.close();}
  d.runs[1].lo=TODAY;d.cert=[record("r902","g901","",true)];app=await mount(d);try{check("A5 今日LO・チェック済みは外せる",checkbox(app.c).disabled,false);checkbox(app.c).click();await sleep(30);check("B7 オフにしたら再追加不可",checkbox(app.c).disabled,true);}finally{app.close();}
  d=data();d.cert=[record("r902","g901","",true)];app=await mount(d);try{
    await button(app.c,"認可書実績");await setInput(app.c.querySelector('input[aria-label="認可書番号 r901 g901"]'),"DUMMY*01");await button(app.c,"帳票");check("A3/A10 前ランの番号入力で待ち・○を隠す",[cell(app.c).textContent.includes("認可番号待ち"),!!checkbox(app.c)],[true,false]);
    await button(app.c,"型式ラン");await setInput(app.c.querySelectorAll('tbody tr')[1].querySelector('input'),"DUMMY-B");await button(app.c,"帳票");check("A3/A10 型式変更で○復帰",checkbox(app.c).checked,true);
    await button(app.c,"型式ラン");await setInput(app.c.querySelectorAll('select[aria-label="比較元"]')[1],"r901");await button(app.c,"帳票");check("A3 比較元選択で待ち",cell(app.c).textContent.includes("認可番号待ち"),true);
    await button(app.c,"型式ラン");await setInput(app.c.querySelectorAll('tbody tr')[0].querySelector('input[type="date"]'),"");await button(app.c,"帳票");check("A3/B9 比較元LO消去で○復帰",checkbox(app.c).checked,true);
    await button(app.c,"型式ラン");await setInput(app.c.querySelectorAll('tbody tr')[1].querySelector('input[type="date"]'),"");await button(app.c,"帳票");check("A3/B3 自分のLO消去で判定不能・○非表示",[cell(app.c).textContent.includes("判定不能"),!!checkbox(app.c)],[true,false]);
    check("A10 条件変更後も保存予定を保持",(await snapshot(app.c)).cert.find(c=>c.runKey==="r902").planned,true);
  }finally{app.close();}
  d=data();d.decisions=[{runKey:"r902",rid:"g901",state:"対象外",reason:"ダミー理由",decidedAt:"2026-10-01 10:00",needsRecheck:false,cond:null}];app=await mount(d);try{const td=cell(app.c);check("A1/B11 待ちの色・破線・文言・人の行",[getComputedStyle(td.firstElementChild).borderTopStyle,getComputedStyle(td.firstElementChild).borderTopColor,td.textContent.includes("実績あり（認可番号待ち）"),td.textContent.includes("人：対象外"),td.textContent.includes("対象外（判断済み）"),!!checkbox(app.c)],["dashed","rgb(63, 191, 143)",true,true,false,false]);}finally{app.close();}
}
// 確認用画面：濃緑、薄緑、○付き要、未計画、○付き否、LO済み、LO空。
export const DEMO={schemaVersion:2,
  runs:[run("r911","DUMMY-A",shift(-200)),run("r912","DUMMY-A",shift(100)),run("r913","DUMMY-B",shift(100)),run("r914","DUMMY-C",shift(-10)),run("r915","DUMMY-D","")],
  regs:[reg("g911","DUMMY-REG-1"),reg("g912","DUMMY-REG-2",shift(150),shift(500))],
  cert:[record("r911","g911","DUMMY*01"),record("r913","g911","",true),record("r913","g912","",true),record("r914","g911","",true)],decisions:[],bases:[],sameness:[]};
window.__F23_DEMO__=DEMO;
verify().catch(e=>check("例外",String(e.stack),null)).finally(()=>{
  const pass=results.filter(x=>x.pass).length,fail=results.length-pass;
  window.__F23VERIFY_RESULT__={finished:true,pass,fail,results};
  document.getElementById("result").textContent=`F-23 セルフ検証 PASS ${pass} / FAIL ${fail}（下は方向性確認用のダミー画面）`;
  createRoot(document.getElementById("preview")).render(<StandaloneApp bootData={boot(DEMO)}/>);
});
