// F-27 B1・B2：生成した単体HTMLをfile://で開き、危険一覧の並び・開閉の操作が保存データに入らないこと、
// 保存HTMLを開き直したとき期限超過が閉じていない（既定の開閉に戻る）ことを実ファイルで確認する。
// ダミー専用。依存追加なし。実API/DBに接続しない（外部名前解決も止める）。先にnpm run build:standaloneを実行。
// usage: node verify/sections-file.mjs <既存の証拠ディレクトリ>
import { spawn } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const out=process.argv[2];if(!out)throw Error("証拠ディレクトリを指定してください");
const page="file://"+fileURLToPath(new URL("../dist-standalone/ilist-standalone.html",import.meta.url));
const profile=mkdtempSync(join(tmpdir(),"ilist-f27-file-")),downloads=mkdtempSync(join(out,"f27-downloads-"));
const chrome=spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--host-resolver-rules=MAP * ~NOTFOUND","--window-size=1600,1100","--remote-debugging-address=127.0.0.1","--remote-debugging-port=9339",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
let ws;const cleanup=()=>{ws?.close();chrome.kill();try{rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}catch{}};process.on("exit",cleanup);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let target;for(let i=0;i<100;i++){try{target=(await(await fetch("http://127.0.0.1:9339/json/list")).json()).find(t=>t.type==="page");if(target)break;}catch{}await sleep(100);}
ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let id=0;const pending=new Map(),errors=[],external=[],results=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==="Runtime.exceptionThrown")errors.push(m.params.exceptionDetails.exception?.description||"exception");if(m.method==="Runtime.consoleAPICalled"&&m.params.type==="error")errors.push(m.params.args.map(a=>a.value||a.description).join(" "));if(m.method==="Network.requestWillBeSent"&&!/^(file|blob|data):/.test(m.params.request.url))external.push(m.params.request.url);};
const send=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async expression=>{const m=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(m.result?.exceptionDetails)throw Error(JSON.stringify(m.result.exceptionDetails));return m.result?.result?.value;};
const check=(label,actual,expected)=>{const pass=isDeepStrictEqual(actual,expected);results.push({label,pass,actual,expected});console.log(`${pass?"OK":"NG"} ${label}${pass?"":`\n   実際=${JSON.stringify(actual)}\n   期待=${JSON.stringify(expected)}`}`);};
const click=async text=>{await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(!b)throw Error('button missing: '+${JSON.stringify(text)});b.click();})()`);await sleep(80);};
const navigate=async url=>{await send("Page.navigate",{url});await sleep(700);};
const importFile=async path=>{const doc=await send("DOM.getDocument");const el=await send("DOM.querySelector",{nodeId:doc.result.root.nodeId,selector:'input[type="file"]'});await send("DOM.setFileInputFiles",{nodeId:el.result.nodeId,files:[resolve(path)]});await sleep(350);};
const download=async(text,ext)=>{const dir=mkdtempSync(join(downloads,"export-"));await send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:resolve(dir)});await click(text);for(let i=0;i<100;i++){await sleep(100);const name=readdirSync(dir).find(f=>f.endsWith(ext));if(name)return join(dir,name);}throw Error("download missing");};
// 危険一覧の表の見え方：[区分, 見えているラン行の数, 見えている法規行の数]
const sections=()=>ev(`(()=>{const t=[...document.querySelectorAll('table')].find(t=>t.querySelector('tr[data-risk-section]'));if(!t)return null;const o=[];for(const tr of t.querySelectorAll('tbody > tr')){if(tr.hasAttribute('data-risk-section'))o.push([tr.getAttribute('data-risk-section'),0,0]);else if(tr.hasAttribute('data-risk-run'))o[o.length-1][1]++;else o[o.length-1][2]++;}return o;})()`);
const clickSection=async kind=>{await ev(`document.querySelector('tr[data-risk-section="${kind}"] button').click()`);await sleep(80);};
// 保存HTMLを実際に開き、埋め込まれた起動データを読む（雛形の中にも同じidの文字列があるので、文字列検索はしない）
const bootOf=async path=>{await navigate("file://"+resolve(path));return ev("JSON.parse(document.getElementById('ilist-boot-data').textContent)");};
await send("Runtime.enable");await send("Network.enable");await send("Page.enable");
const today=await ev("new Date().toLocaleDateString('en-CA')");
const shift=n=>{const d=new Date(today+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
// 期限超過（r1）・期限前（r1・r2）・黄色予告（r3）・drop未入力の別枠（r2）。すべて継続ラン。
const run=(key,typeId,lo,drop)=>({key,typeId,gen:"DUMMY-F27",sk:"継",lo,drop});
const reg=(rid,id,kei)=>({rid,id,label:"ダミー",shin:shift(-3650),kei,parent:""});
const input={schemaVersion:2,runs:[run("r1","DUMMY-A",shift(-3650),shift(3650)),run("r2","DUMMY-B",shift(-10),""),run("r3","DUMMY-C",shift(-30),shift(5))],
 regs:[reg("g1","DUMMY-OVER",shift(-100)),reg("g2","DUMMY-K15",shift(15))],cert:[],decisions:[],bases:[],sameness:[]};
const inputPath=join(out,"f27-input.json");writeFileSync(inputPath,JSON.stringify(input,null,2));
await navigate(page);await importFile(inputPath);
const json0=await download("JSONに書き出し",".json");const html0=await download("データ入りHTMLを保存",".html");
await click("危険な型式ラン");
const DEFAULT=[["不適合",3,0],["期限前",0,0],["予告",1,0]];
check("A3 開いた直後は期限超過・黄色予告が展開、期限前はたたむ",await sections(),DEFAULT);
// 並び・開閉の操作（区分の開閉・すべて展開・すべてたたむ）
await clickSection("期限前");await clickSection("不適合");await click("すべて展開");
check("操作後：すべて展開",await sections(),[["不適合",3,3],["期限前",2,2],["予告",1,1]]);
await click("すべてたたむ");await clickSection("不適合");
const json1=await download("JSONに書き出し",".json");const html1=await download("データ入りHTMLを保存",".html");
check("B1 並び・開閉の操作でJSON書き出しが変わらない",readFileSync(json1,"utf8"),readFileSync(json0,"utf8"));
const boot0=await bootOf(html0),boot1=await bootOf(html1);   // 最後に html1 を開いた状態で終わる
check("B1 並び・開閉の操作で保存HTMLのデータが変わらない",boot1,boot0);
check("B1 保存HTMLのデータ＝JSON書き出し",boot1,JSON.parse(readFileSync(json1,"utf8")));
// 期限超過を閉じた状態で保存したHTML（html1）を開き直した画面
check("B2 開き直した直後のパネルは閉じている（F-10の既定）",await sections(),null);
await click("危険な型式ラン");
check("B2 保存HTMLを開き直すと期限超過は閉じていない（既定の開閉）",await sections(),DEFAULT);
const ss=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});writeFileSync(join(out,"f27-reopened.png"),Buffer.from(ss.result.data,"base64"));
check("製品コード由来consoleエラー0件",errors,[]);check("外部通信0件",external,[]);
const fail=results.filter(r=>!r.pass).length;writeFileSync(join(out,"f27-file-result.json"),JSON.stringify({pass:results.length-fail,fail,results,json0,json1,html0,html1,errors,external},null,2));
console.log(`PASS ${results.length-fail} / FAIL ${fail}`);process.exit(fail?1:0);
