// F-23 A8/A10：生成した単体HTMLをfile://で開き、実ファイルの保存→再読込を確認する。
// ダミー専用。依存追加なし。実API/DBに接続しない。先にnpm run build:standaloneを実行。
// usage: node verify/cert-status-file.mjs <既存の証拠ディレクトリ>
import { spawn } from "node:child_process";
import { CHROME_PATH } from "../scripts/chrome-path.mjs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const out=process.argv[2];if(!out)throw Error("証拠ディレクトリを指定してください");
const page="file://"+fileURLToPath(new URL("../dist-standalone/ilist-standalone.html",import.meta.url));
const profile=mkdtempSync(join(tmpdir(),"ilist-f23-file-")),downloads=mkdtempSync(join(out,"f23-downloads-"));
const chrome=spawn(CHROME_PATH,["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--host-resolver-rules=MAP * ~NOTFOUND","--window-size=1600,1100","--remote-debugging-address=127.0.0.1","--remote-debugging-port=9338",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
let ws;const cleanup=()=>{ws?.close();chrome.kill();try{rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}catch{}};process.on("exit",cleanup);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let target;for(let i=0;i<100;i++){try{target=(await(await fetch("http://127.0.0.1:9338/json/list")).json()).find(t=>t.type==="page");if(target)break;}catch{}await sleep(100);}
ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let id=0;const pending=new Map(),errors=[],external=[],results=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==="Runtime.exceptionThrown")errors.push(m.params.exceptionDetails.exception?.description||"exception");if(m.method==="Runtime.consoleAPICalled"&&m.params.type==="error")errors.push(m.params.args.map(a=>a.value||a.description).join(" "));if(m.method==="Network.requestWillBeSent"&&!/^(file|blob|data):/.test(m.params.request.url))external.push(m.params.request.url);};
const send=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async expression=>{const m=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(m.result?.exceptionDetails)throw Error(JSON.stringify(m.result.exceptionDetails));return m.result?.result?.value;};
const check=(label,actual,expected)=>{const pass=isDeepStrictEqual(actual,expected);results.push({label,pass,actual,expected});console.log(`${pass?"OK":"NG"} ${label}`);};
const click=async text=>{await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(!b)throw Error('button missing');b.click();})()`);await sleep(80);};
const navigate=async url=>{await send("Page.navigate",{url});await sleep(700);};
const importFile=async path=>{const doc=await send("DOM.getDocument");const el=await send("DOM.querySelector",{nodeId:doc.result.root.nodeId,selector:'input[type="file"]'});await send("DOM.setFileInputFiles",{nodeId:el.result.nodeId,files:[resolve(path)]});await sleep(350);};
const download=async(text,ext)=>{const dir=mkdtempSync(join(downloads,"export-"));await send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:resolve(dir)});await click(text);for(let i=0;i<100;i++){await sleep(100);const name=readdirSync(dir).find(f=>f.endsWith(ext));if(name)return join(dir,name);}throw Error("download missing");};
await send("Runtime.enable");await send("Network.enable");await send("Page.enable");
const today=await ev("new Date().toLocaleDateString('en-CA')");
const shift=n=>{const d=new Date(today+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const run=(key,typeId,lo)=>({key,typeId,gen:"DUMMY-F23",sk:"新",lo,drop:shift(300)});
const input={schemaVersion:2,runs:[run("r921","DUMMY-A",shift(-100)),run("r922","DUMMY-A",shift(100)),run("r923","DUMMY-B",shift(100)),run("r924","DUMMY-C","")],
 regs:[{rid:"g921",id:"DUMMY-REG",label:"ダミー",shin:shift(-300),kei:shift(-200),parent:""}],
 cert:[{runKey:"r921",rid:"g921",ck:"DUMMY*01",planned:false},{runKey:"r922",rid:"g921",ck:"",planned:true},{runKey:"r923",rid:"g921",ck:"",planned:true},{runKey:"r924",rid:"g921",ck:"",planned:true}],decisions:[],bases:[],sameness:[]};
const inputPath=join(out,"f23-input.json");writeFileSync(inputPath,JSON.stringify(input,null,2));
// 明示オフで空のレコードが消え、オンで末尾に追加される。期待値は操作前に固定する。
const expected={...input,cert:[input.cert[0],input.cert[1],input.cert[3],input.cert[2]]};
writeFileSync(join(out,"f23-expected.json"),JSON.stringify(expected,null,2));
await navigate(page);await importFile(inputPath);
const planState=()=>ev(`(()=>{const boxes=[...document.querySelectorAll('input[type="checkbox"][aria-label^="取得予定 "]')];return boxes.map(b=>[b.getAttribute('aria-label'),b.checked]);})()`);
check("A1/A5/A10 実績待ち・LO空の予定は隠れ、前例なしの○だけ表示",await planState(),[["取得予定 r923 g921",true]]);
await ev(`document.querySelector('input[aria-label="取得予定 r923 g921"]').click()`);await sleep(80);
check("A4 チェックを外す",await planState(),[["取得予定 r923 g921",false]]);
await ev(`document.querySelector('input[aria-label="取得予定 r923 g921"]').click()`);await sleep(80);
check("A4 チェックを付ける",await planState(),[["取得予定 r923 g921",true]]);
const savedJSON=await download("JSONに書き出し",".json");check("A8/A10 JSON実ファイルに隠れた予定も保持・前例番号は複製しない",JSON.parse(readFileSync(savedJSON,"utf8")),expected);
const savedHTML=await download("データ入りHTMLを保存",".html");
await navigate("file://"+resolve(savedHTML));check("A8 HTML再起動で○復元",await planState(),[["取得予定 r923 g921",true]]);
check("A8 HTML起動データの全体値",await ev("JSON.parse(document.getElementById('ilist-boot-data').textContent)"),expected);
const afterHTML=await download("JSONに書き出し",".json");check("A8 HTML再起動後のJSON全体値",JSON.parse(readFileSync(afterHTML,"utf8")),expected);
await navigate(page);await importFile(savedJSON);check("A8 JSON実ファイル再読込で○復元",await planState(),[["取得予定 r923 g921",true]]);
// 番号編集にReactの入力イベントを渡し、保存してあった○が復帰することを実画面で確認。
await click("認可書実績");await ev(`(()=>{const e=document.querySelector('input[aria-label="認可書番号 r921 g921"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(100);await click("帳票");
check("A3/A10 前例の番号消去で隠れていた○が復帰",await planState(),[["取得予定 r921 g921",false],["取得予定 r922 g921",true],["取得予定 r923 g921",true]]);
const ss=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});writeFileSync(join(out,"file-roundtrip-preview.png"),Buffer.from(ss.result.data,"base64"));
check("製品コード由来consoleエラー0件",errors,[]);check("外部通信0件",external,[]);
const fail=results.filter(r=>!r.pass).length;writeFileSync(join(out,"f23-file-result.json"),JSON.stringify({pass:results.length-fail,fail,results,savedJSON,savedHTML,afterHTML,errors,external},null,2));
console.log(`PASS ${results.length-fail} / FAIL ${fail}`);process.exit(fail?1:0);
