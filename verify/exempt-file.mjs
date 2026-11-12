// F-28 B2・必須検証：生成した単体HTMLをfile://で開き、危険一覧の印・件数・並び・判定不能の件数を表示する前後で
// JSON書き出しと保存HTMLのデータが変わらないこと、保存HTMLを開き直しても同じ印・件数が出ることを実ファイルで確認する。
// ダミー専用（初期ダミーのまま。JSONは読み込まない）。依存追加なし。実API/DBに接続しない（外部名前解決も止める）。
// 先にnpm run build:standaloneを実行。
// usage: node verify/exempt-file.mjs <既存の証拠ディレクトリ>
import { spawn } from "node:child_process";
import { CHROME_PATH } from "../scripts/chrome-path.mjs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const out=process.argv[2];if(!out)throw Error("証拠ディレクトリを指定してください");
const page="file://"+fileURLToPath(new URL("../dist-standalone/ilist-standalone.html",import.meta.url));
const profile=mkdtempSync(join(tmpdir(),"ilist-f28-file-")),downloads=mkdtempSync(join(out,"f28-downloads-"));
const chrome=spawn(CHROME_PATH,["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--host-resolver-rules=MAP * ~NOTFOUND","--window-size=1600,1100","--remote-debugging-address=127.0.0.1","--remote-debugging-port=9341",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
let ws;const cleanup=()=>{ws?.close();chrome.kill();try{rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}catch{}};process.on("exit",cleanup);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let target;for(let i=0;i<100;i++){try{target=(await(await fetch("http://127.0.0.1:9341/json/list")).json()).find(t=>t.type==="page");if(target)break;}catch{}await sleep(100);}
ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let id=0;const pending=new Map(),errors=[],external=[],results=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==="Runtime.exceptionThrown")errors.push(m.params.exceptionDetails.exception?.description||"exception");if(m.method==="Runtime.consoleAPICalled"&&m.params.type==="error")errors.push(m.params.args.map(a=>a.value||a.description).join(" "));if(m.method==="Network.requestWillBeSent"&&!/^(file|blob|data):/.test(m.params.request.url))external.push(m.params.request.url);};
const send=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async expression=>{const m=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(m.result?.exceptionDetails)throw Error(JSON.stringify(m.result.exceptionDetails));return m.result?.result?.value;};
const check=(label,actual,expected)=>{const pass=isDeepStrictEqual(actual,expected);results.push({label,pass,actual,expected});console.log(`${pass?"OK":"NG"} ${label}${pass?"":`\n   実際=${JSON.stringify(actual)}\n   期待=${JSON.stringify(expected)}`}`);};
const click=async text=>{await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(!b)throw Error('button missing: '+${JSON.stringify(text)});b.click();})()`);await sleep(80);};
const navigate=async url=>{await send("Page.navigate",{url});await sleep(700);};
const download=async(text,ext)=>{const dir=mkdtempSync(join(downloads,"export-"));await send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:resolve(dir)});await click(text);for(let i=0;i<100;i++){await sleep(100);const name=readdirSync(dir).find(f=>f.endsWith(ext));if(name)return join(dir,name);}throw Error("download missing");};
// 危険一覧の見え方：見出しの件数表記・判定不能の件数・区分ごとの [型式, [法規, 印]…]
const panel=()=>ev(`(()=>{const t=[...document.querySelectorAll('table')].find(t=>t.querySelector('tr[data-risk-section]'));if(!t)return null;
 const heads=[...t.querySelectorAll('tr[data-risk-section]')].map(tr=>[tr.getAttribute('data-risk-section'),(tr.textContent.match(/\\d+ 件（うち対象外 \\d+）/)||[''])[0]]);
 const k=(document.querySelector('[data-risk-undecidable]')?.textContent.match(/判定不能 ラン \\d+ 件/)||[null])[0];
 const rows=[];for(const tr of t.querySelectorAll('tbody > tr')){if(tr.hasAttribute('data-risk-section'))rows.push([tr.getAttribute('data-risk-section'),[]]);
  else if(tr.hasAttribute('data-risk-run'))rows.at(-1)[1].push([(tr.textContent.match(/DEMO-\\d{4}/)||[''])[0],[]]);
  else rows.at(-1)[1].at(-1)[1].push([(tr.children[0].textContent.match(/DEMO-REG-[A-Z0-9]+/)||[''])[0],tr.querySelector('[data-risk-exempt]')?.getAttribute('data-risk-exempt')||'']);}
 return {heads,k,rows};})()`);
const bootOf=async path=>{await navigate("file://"+resolve(path));return ev("JSON.parse(document.getElementById('ilist-boot-data').textContent)");};
await send("Runtime.enable");await send("Network.enable");await send("Page.enable");
await navigate(page);
// 表示する前（パネルを開かない）の書き出し
const json0=await download("JSONに書き出し",".json");const html0=await download("データ入りHTMLを保存",".html");
await click("危険な型式ラン");await click("すべて展開");
const HEADS=[["不適合","3 件（うち対象外 1）"],["期限前","11 件（うち対象外 1）"],["予告","2 件（うち対象外 1）"]];
const shown=await panel();
check("A2 見出しの件数（初期ダミー）",shown.heads,HEADS);
check("A4 判定不能の件数（初期ダミー）",shown.k,"判定不能 ラン 1 件");
const marks=kind=>shown.rows.find(r=>r[0]===kind)[1].flatMap(([,rs])=>rs.map(([,m])=>m));
check("A5 各区分に対象外・対象外・要再確認がある",["不適合","期限前","予告"].map(k=>[marks(k).includes("対象外"),marks(k).includes("対象外・要再確認")]),[[true,true],[true,true],[true,true]]);
await click("すべてたたむ");
check("A2 たたんでも見出しに件数が出る",(await panel()).heads,HEADS);
const json1=await download("JSONに書き出し",".json");const html1=await download("データ入りHTMLを保存",".html");
check("B2 印・件数・並びの表示前後でJSON書き出しが変わらない",readFileSync(json1,"utf8"),readFileSync(json0,"utf8"));
const j1=JSON.parse(readFileSync(json1,"utf8"));
check("B2 版・項目は従来どおり",[j1.schemaVersion,Object.keys(j1).sort()],[2,["bases","cert","decisions","regs","runs","sameness","schemaVersion"]]);
check("B2 印・件数の項目は保存データに無い",/exemptMark|riskCompliance|undecidable|うち対象外/.test(readFileSync(json1,"utf8")),false);
const boot0=await bootOf(html0),boot1=await bootOf(html1);   // 最後に html1 を開いた状態で終わる
check("B2 表示前後で保存HTMLのデータが変わらない",boot1,boot0);
check("B2 保存HTMLのデータ＝JSON書き出し",boot1,j1);
// 保存HTMLを開き直した画面でも同じ印・件数・並びが出る（表示時の導出だけで作っている）
await click("危険な型式ラン");await click("すべて展開");
check("保存HTMLを開き直しても同じ印・件数・並び",await panel(),shown);
const ss=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});writeFileSync(join(out,"f28-reopened.png"),Buffer.from(ss.result.data,"base64"));
check("製品コード由来consoleエラー0件",errors,[]);check("外部通信0件",external,[]);
const fail=results.filter(r=>!r.pass).length;writeFileSync(join(out,"f28-file-result.json"),JSON.stringify({pass:results.length-fail,fail,results,json0,json1,html0,html1,errors,external},null,2));
console.log(`PASS ${results.length-fail} / FAIL ${fail}`);process.exit(fail?1:0);
