// F-31: 単体HTMLの実ファイル検証。生成: python3 verify/fixtures/f31/generate.py
// npm run build:standalone && node verify/excel-import-file.mjs <証拠ディレクトリ>
import { spawn } from "node:child_process";
import { CHROME_PATH } from "../scripts/chrome-path.mjs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const out=process.argv[2];if(!out)throw Error("証拠ディレクトリを指定してください");
const page="file://"+fileURLToPath(new URL("../dist-standalone/ilist-standalone.html",import.meta.url));
const profile=mkdtempSync(join(tmpdir(),"ilist-f31-file-")),downloads=mkdtempSync(join(out,"f31-downloads-"));
const chrome=spawn(CHROME_PATH,["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--host-resolver-rules=MAP * ~NOTFOUND","--window-size=1600,1100","--remote-debugging-address=127.0.0.1","--remote-debugging-port=9343",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
let ws;const cleanup=()=>{ws?.close();chrome.kill();try{rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}catch{}};process.on("exit",cleanup);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let target;for(let i=0;i<100;i++){try{target=(await(await fetch("http://127.0.0.1:9343/json/list")).json()).find(t=>t.type==="page");if(target)break;}catch{}await sleep(100);}
ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let id=0;const pending=new Map(),errors=[],external=[],results=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==="Runtime.exceptionThrown")errors.push(m.params.exceptionDetails.exception?.description||"exception");if(m.method==="Runtime.consoleAPICalled"&&m.params.type==="error")errors.push(m.params.args.map(a=>a.value||a.description).join(" "));if(m.method==="Network.requestWillBeSent"&&!/^(file|blob|data):/.test(m.params.request.url))external.push(m.params.request.url);};
const send=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async expression=>{const m=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(m.result?.exceptionDetails)throw Error(JSON.stringify(m.result.exceptionDetails));return m.result?.result?.value;};
const check=(label,actual,expected)=>{const pass=isDeepStrictEqual(actual,expected);results.push({label,pass,actual,expected});console.log(`${pass?"OK":"NG"} ${label}${pass?"":`\n   実際=${JSON.stringify(actual)}\n   期待=${JSON.stringify(expected)}`}`);};
const click=async text=>{await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(!b)throw Error('button missing');b.click();})()`);await sleep(80);};
const navigate=async url=>{await send("Page.navigate",{url});await sleep(700);await ev(`window.alert=()=>{};window.confirm=()=>true`);};
const importFile=async (path,selector='input[type="file"]')=>{const doc=await send("DOM.getDocument");const el=await send("DOM.querySelector",{nodeId:doc.result.root.nodeId,selector});await send("DOM.setFileInputFiles",{nodeId:el.result.nodeId,files:[resolve(path)]});await sleep(350);};
const download=async(text,ext)=>{const dir=mkdtempSync(join(downloads,"export-"));await send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:resolve(dir)});await click(text);for(let i=0;i<100;i++){await sleep(100);const name=readdirSync(dir).find(f=>f.endsWith(ext));if(name)return join(dir,name);}throw Error("download missing");};
await send("Runtime.enable");await send("Network.enable");await send("Page.enable");
const fixture = name => fileURLToPath(new URL(`./fixtures/f31/${name}`, import.meta.url));
const input=JSON.parse(readFileSync(fixture('dummy-data.json'),'utf8'));
const dump=async()=>JSON.parse(readFileSync(await download('JSONに書き出し','.json'),'utf8'));
const matrix=()=>ev(`(() => {const t=[...document.querySelectorAll('table')].find(t=>!t.closest('dialog')&&t.textContent.includes('R156-00'));return [...t.tBodies[0].rows].map(r=>[...r.cells].map(c=>c.textContent));})()`);
const excel=async (name='dummy.xlsx', project='DUMMY-P31')=>{
  await click('Excelを取り込み');
  await importFile(fixture(name),'dialog input[type="file"]');
  await ev(`(()=>{const s=document.querySelector('select[aria-label="取込先プロジェクト"]');s.value=${JSON.stringify(project)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('解析');await sleep(500);
};
await navigate(page);await importFile(fixture('dummy-data.json'));
check('検証用JSONを既存の読込処理で受理',await dump(),input);
const beforeMatrix=await matrix();
await excel();
check('A1 プロジェクトを確認画面に表示',await ev(`document.querySelector('dialog h3').textContent`),'確認：プロジェクトコード DUMMY-P31');
const sections=await ev(`[...document.querySelectorAll('dialog section')].map(s=>[s.getAttribute('aria-label'),s.querySelector('h4').textContent,s.querySelectorAll('tbody tr').length])`);
check('A2/A4/A5 読めた8セル・除外9件を分離',sections,[['追加','追加：6件',6],['既存と同じ','既存と同じ：1件',1],['既存と違う','既存と違う：1件',1],['読めなかった行','読めなかった行：9件',0]]);
check('A3 旧シリーズ3セルだけに取得シリーズの印',await ev(`[...document.querySelectorAll('dialog td')].filter(c=>c.textContent==='01で取得').length`),3);
check('B1/B6 新シリーズと競合セルは読めた側に出ない',await ev(`[...document.querySelectorAll('dialog tbody tr')].some(r=>/R156-02|R157-00/.test(r.textContent))`),false);
check('B4 解析前後の帳票表示が完全一致',await matrix(),beforeMatrix);
const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'f31-preview.png'),Buffer.from(shot.result.data,'base64'));
await click('反映せず閉じる');
check('A7/B4 閉じた後の全データが一致',await dump(),input);
for (const name of ['dummy-data.json','broken.xlsx','broken-xml.xlsx']) {
  await excel(name);
  check(`A7 ${name}を解析失敗として表示`,await ev(`!!document.querySelector('dialog [role="alert"]')`),true);
  await click('反映せず閉じる');
  check(`A7 ${name}で全データ不変`,await dump(),input);
  check(`A7 ${name}で帳票不変`,await matrix(),beforeMatrix);
}
for (const name of ['dummy-shared.xlsx','dummy-stored.xlsx']) {
  await excel(name);
  check(`A2 共有文字列/非圧縮ZIP ${name}`,await ev(`document.querySelector('section[aria-label="追加"] h4')?.textContent`),'追加：6件');
  await click('反映せず閉じる');
}
// 明示指定した別プロジェクトだけが確認画面の対象になる。
await excel('dummy.xlsx','DUMMY-OTHER');
check('B3 別プロジェクト指定時はそちらの型式ランだけ',await ev(`[...document.querySelectorAll('dialog tbody tr')].every(r=>r.textContent.includes('DUMMY-OTHER / DUMMY-A (r306)'))`),true);
await click('反映せず閉じる');
await excel();await click('反映（追加');await sleep(200);
const expected=structuredClone(input);
expected.cert[2].ck='E43*156R01/00*9001*00';
expected.cert.push(
 {runKey:'r301',rid:'g302',ck:'E43*156R01/00*9001*00',planned:false},
 {runKey:'r302',rid:'g301',ck:'E43*156R01/00*9001*00',planned:false},
 {runKey:'r302',rid:'g302',ck:'E43*156R01/00*9001*00',planned:false},
 {runKey:'r301',rid:'g304',ck:'E43*13HR00/00*9001*00',planned:false},
 {runKey:'r303',rid:'g307',ck:'E43*158R00/00*9001*00',planned:false},
);
const after=await dump();
check('A6/B1/B2/B3/B5/B6 追加6セルだけ反映・残りの全データは保持',after,expected);
const afterMatrix=await matrix();
check('A6 LOあり・要のセルに取得番号が表示される',afterMatrix[0][1].includes('E43*156R01/00*9001*00'),true);
check('A6 LO空のセルは判定不能のまま',afterMatrix[0][2],beforeMatrix[0][2]);
check('A6 否の対照が正しい',beforeMatrix[3][1].includes('否'),true);
check('A6 要否が否のセルは否のまま（番号取得後は既存規則で予定欄を隠す）',[afterMatrix[3][1].startsWith('否'),afterMatrix[3][1].includes('E43*')],[true,false]);
check('A6 帳票に確認画面専用の印を出さない',afterMatrix.flat().some(t=>t.includes('01で取得')),false);
check('B4 反映後に対象セルの帳票表示が変わる',afterMatrix[0][1]!==beforeMatrix[0][1],true);
check('B5 既存番号2セルの保存値を幅・空白ごと保持',after.cert.slice(0,2),input.cert.slice(0,2));
writeFileSync(join(out,'f31-before-after.json'),JSON.stringify({before:input,after,beforeMatrix,afterMatrix},null,2));
const savedJSON=await download('JSONに書き出し','.json');
const savedHTML=await download('データ入りHTMLを保存','.html');
await navigate('file://'+resolve(savedHTML));
check('A8 HTML再起動で同じセルの番号を復元',await dump(),expected);
check('A8 HTML再起動で帳票表示を復元',await matrix(),afterMatrix);
await navigate(page);await importFile(savedJSON);
check('A8 JSON再読込で同じセルの番号を復元',await dump(),expected);
check('A8 JSON再読込で帳票表示を復元',await matrix(),afterMatrix);
await excel();
check('再取り込みは追加0・同じ7・違う1',await ev(`[...document.querySelectorAll('dialog section h4')].slice(0,3).map(h=>h.textContent)`),['追加：0件','既存と同じ：7件','既存と違う：1件']);
check('追加0件なら反映ボタン無効',await ev(`[...document.querySelectorAll('dialog button')].find(b=>b.textContent.startsWith('反映（')).disabled`),true);
check('外部通信0件',external,[]);check('ブラウザエラー0件',errors,[]);
const fail=results.filter(r=>!r.pass).length;
writeFileSync(join(out,'f31-results.json'),JSON.stringify({pass:results.length-fail,fail,results,savedJSON,savedHTML},null,2));
console.log(`PASS ${results.length-fail} / FAIL ${fail}`);cleanup();process.exit(fail?1:0);
