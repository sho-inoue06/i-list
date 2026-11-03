// F-42 A6/B2：生成した単体HTMLをfile://で開き、人の対象外＋取得予定（○）の実ファイルの保存→再読込を確認する。
// ダミー専用。依存追加なし。実API/DBに接続しない（外部名前解決も止める）。先にnpm run build:standaloneを実行。
// usage: node verify/plan-exempt-file.mjs <既存の証拠ディレクトリ>
import { spawn } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const out=process.argv[2];if(!out)throw Error("証拠ディレクトリを指定してください");
const page="file://"+fileURLToPath(new URL("../dist-standalone/ilist-standalone.html",import.meta.url));
const profile=mkdtempSync(join(tmpdir(),"ilist-f42-file-")),downloads=mkdtempSync(join(out,"f42-downloads-"));
const chrome=spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--host-resolver-rules=MAP * ~NOTFOUND","--window-size=1600,1100","--remote-debugging-address=127.0.0.1","--remote-debugging-port=9342",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
let ws;const cleanup=()=>{ws?.close();chrome.kill();try{rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}catch{}};process.on("exit",cleanup);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let target;for(let i=0;i<100;i++){try{target=(await(await fetch("http://127.0.0.1:9342/json/list")).json()).find(t=>t.type==="page");if(target)break;}catch{}await sleep(100);}
ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let id=0;const pending=new Map(),errors=[],external=[],results=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==="Runtime.exceptionThrown")errors.push(m.params.exceptionDetails.exception?.description||"exception");if(m.method==="Runtime.consoleAPICalled"&&m.params.type==="error")errors.push(m.params.args.map(a=>a.value||a.description).join(" "));if(m.method==="Network.requestWillBeSent"&&!/^(file|blob|data):/.test(m.params.request.url))external.push(m.params.request.url);};
const send=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async expression=>{const m=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(m.result?.exceptionDetails)throw Error(JSON.stringify(m.result.exceptionDetails));return m.result?.result?.value;};
const check=(label,actual,expected)=>{const pass=isDeepStrictEqual(actual,expected);results.push({label,pass,actual,expected});console.log(`${pass?"OK":"NG"} ${label}${pass?"":`\n   実際=${JSON.stringify(actual)}\n   期待=${JSON.stringify(expected)}`}`);};
const click=async text=>{await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(!b)throw Error('button missing');b.click();})()`);await sleep(80);};
const navigate=async url=>{await send("Page.navigate",{url});await sleep(700);};
const importFile=async path=>{const doc=await send("DOM.getDocument");const el=await send("DOM.querySelector",{nodeId:doc.result.root.nodeId,selector:'input[type="file"]'});await send("DOM.setFileInputFiles",{nodeId:el.result.nodeId,files:[resolve(path)]});await sleep(350);};
const download=async(text,ext)=>{const dir=mkdtempSync(join(downloads,"export-"));await send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:resolve(dir)});await click(text);for(let i=0;i<100;i++){await sleep(100);const name=readdirSync(dir).find(f=>f.endsWith(ext));if(name)return join(dir,name);}throw Error("download missing");};
await send("Runtime.enable");await send("Network.enable");await send("Page.enable");
const today=await ev("new Date().toLocaleDateString('en-CA')");
const shift=n=>{const d=new Date(today+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const run=(key,typeId,lo)=>({key,typeId,gen:"DUMMY-F42",sk:"新",lo,drop:shift(300)});
const REG={rid:"g931",id:"DUMMY-REG",label:"ダミー",shin:shift(-300),kei:shift(-200),parent:""};
// 確定時の条件＝いまの条件（要再確認は保存済みフラグだけで立てる）
const cond=r=>({typeId:r.typeId,sk:r.sk,lo:r.lo,drop:r.drop,regId:REG.id,shin:REG.shin,kei:REG.kei,parent:"",parentLink:"none",parentRid:""});
//   r931 対象外＋○（重なりなし）／r932 対象外・要再確認＋○（重なりなし）／r933 対象外＋○・LO空／r934 対象外＋○・認可番号あり
const runs=[run("r931","DUMMY-A",shift(100)),run("r932","DUMMY-B",shift(100)),run("r933","DUMMY-C",""),run("r934","DUMMY-D",shift(100))];
const input={schemaVersion:2,runs,regs:[REG],
 cert:[{runKey:"r931",rid:"g931",ck:"",planned:true},{runKey:"r932",rid:"g931",ck:"",planned:true},{runKey:"r933",rid:"g931",ck:"",planned:true},{runKey:"r934",rid:"g931",ck:"DUMMY*01",planned:true}],
 decisions:runs.map((r,i)=>({runKey:r.key,rid:"g931",state:"対象外",reason:"ダミー：対象外の理由",decidedAt:`${today} 09:00`,needsRecheck:i===1,cond:cond(r)})),bases:[],sameness:[]};
const inputPath=join(out,"f42-input.json");writeFileSync(inputPath,JSON.stringify(input,null,2));
// ○を外すと番号の無いレコードが消え、付け直すと末尾に追加される。期待値は操作前に固定する。
const offExpected={...input,cert:input.cert.slice(1)};
const expected={...input,cert:[...input.cert.slice(1),input.cert[0]]};
writeFileSync(join(out,"f42-expected.json"),JSON.stringify(expected,null,2));
const planState=()=>ev(`(()=>[...document.querySelectorAll('input[type="checkbox"][aria-label^="取得予定 "]')].map(b=>[b.getAttribute('aria-label'),b.checked,b.closest('td').textContent.includes('人：対象外')]))()`);
const SHOWN=[["取得予定 r931 g931",true,true],["取得予定 r932 g931",true,true]];
await navigate(page);await importFile(inputPath);
check("A6 既存JSONの対象外＋planned:true に○が出る（LO空・認可番号ありは既存の規則で隠す）",await planState(),SHOWN);
await ev(`document.querySelector('input[aria-label="取得予定 r931 g931"]').click()`);await sleep(80);
const offJSON=await download("JSONに書き出し",".json");
check("A6/B2 ○を外して保存すると予定なし・判断と隠れた保存値はそのまま",JSON.parse(readFileSync(offJSON,"utf8")),offExpected);
await ev(`document.querySelector('input[aria-label="取得予定 r931 g931"]').click()`);await sleep(80);
check("A1 対象外のセルで○を付け直せる",await planState(),SHOWN);
const savedJSON=await download("JSONに書き出し",".json");check("A6/B2 JSON実ファイルに対象外と○の両方が残る",JSON.parse(readFileSync(savedJSON,"utf8")),expected);
const savedHTML=await download("データ入りHTMLを保存",".html");
await navigate("file://"+resolve(savedHTML));check("A6 データ入りHTMLを開き直すと対象外と○の両方が出る",await planState(),SHOWN);
check("A6 HTML起動データの全体値",await ev("JSON.parse(document.getElementById('ilist-boot-data').textContent)"),expected);
const afterHTML=await download("JSONに書き出し",".json");check("A6 HTML再起動後のJSON全体値",JSON.parse(readFileSync(afterHTML,"utf8")),expected);
await navigate(page);await importFile(savedJSON);check("A6 JSON実ファイル再読込で対象外と○の両方が出る",await planState(),SHOWN);
const ss=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});writeFileSync(join(out,"f42-file-roundtrip-preview.png"),Buffer.from(ss.result.data,"base64"));
check("製品コード由来consoleエラー0件",errors,[]);check("外部通信0件",external,[]);
const fail=results.filter(r=>!r.pass).length;writeFileSync(join(out,"f42-file-result.json"),JSON.stringify({pass:results.length-fail,fail,results,offJSON,savedJSON,savedHTML,afterHTML,errors,external},null,2));
console.log(`PASS ${results.length-fail} / FAIL ${fail}`);process.exit(fail?1:0);
