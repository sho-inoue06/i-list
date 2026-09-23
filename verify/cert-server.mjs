// サーバDBの認証実績（F-22 A2・A3・A4）の検証。ダミー専用。依存追加なし。
//
// 実DB（data/ilist.db）には触れない：server/index.js を一時フォルダへ写して起動する
// （サーバは自分のファイルの2階層上の data/ にDBを置くので、写した先の data/ が使われる）。
// 待ち受けは 127.0.0.1 のみ。
//   usage: node verify/cert-server.mjs
//
// 確かめること：
//   ・旧形式のDB（cert テーブルが 型式 × 法規ID、regs に rid 列なし）を開くと、GETは旧形式のまま返す（移行はフロントが行う）
//   ・版2のPUTを保存し、GETで1文字も変わらずに返す（空文字・空白だけ・予定あり・区切り文字入りの run.key を含む）
//   ・サーバDBは 型式ラン(runKey) × 法規行(rid) で持ち、regs に rid を保存する（A3）
//   ・旧形式・知らない版・rid の無い regs・組の重複は拒否し、DBは直前のまま（トランザクション）
//   ・旧 cert テーブルの行は消さない（移行元として残す）
//   ・再起動しても版2のまま読める
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const PORT = 3931;
const BASE = `http://127.0.0.1:${PORT}/api/data`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "OK" : "NG"} ${label}${ok ? "" : `\n   実際=${JSON.stringify(actual)}\n   期待=${JSON.stringify(expected)}`}`);
};

const work = mkdtempSync(join(tmpdir(), "ilist-cert-server-"));
mkdirSync(join(work, "server"));
mkdirSync(join(work, "data"));
copyFileSync(join(REPO, "server/index.js"), join(work, "server/index.js"));
const DB_PATH = join(work, "data/ilist.db");

// ── 旧形式のDBを作る（F-22より前の server/index.js と同じテーブル定義。ダミーの行だけ） ──
{
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE runs (key TEXT PRIMARY KEY, typeId TEXT NOT NULL DEFAULT '', gen TEXT NOT NULL DEFAULT '',
      sk TEXT NOT NULL DEFAULT '新', lo TEXT NOT NULL DEFAULT '', dropDate TEXT NOT NULL DEFAULT '', pos INTEGER NOT NULL);
    CREATE TABLE regs (rowid_ INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '',
      shin TEXT NOT NULL DEFAULT '', kei TEXT NOT NULL DEFAULT '', parent TEXT NOT NULL DEFAULT '', pos INTEGER NOT NULL);
    CREATE TABLE cert (typeId TEXT NOT NULL, regId TEXT NOT NULL, ck TEXT NOT NULL, PRIMARY KEY (typeId, regId));
  `);
  db.prepare("INSERT INTO runs VALUES (?,?,?,?,?,?,?)").run("r1", "SV-A", "PJ-1", "新", "2021-01-01", "2030-12-31", 0);
  db.prepare("INSERT INTO runs VALUES (?,?,?,?,?,?,?)").run("r2", "SV-A", "PJ-2", "継", "2024-01-01", "2031-12-31", 1);
  db.prepare("INSERT INTO regs (id, label, shin, kei, parent, pos) VALUES (?,?,?,?,?,?)").run("SV-REG-1", "ダミー法規1", "2020-01-01", "2022-01-01", "", 0);
  db.prepare("INSERT INTO cert VALUES (?,?,?)").run("SV-A", "SV-REG-1", "SV*A1");
  db.close();
}

let server = null;
async function start() {
  server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(work, "server/index.js")],
    { env: { ...process.env, ILIST_API_PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(BASE); if (r.ok) return; } catch {}
    await sleep(100);
  }
  throw new Error("サーバが起動しません");
}
async function stop() {
  if (!server) return;
  const s = server; server = null;
  await new Promise((r) => { s.once("exit", r); s.kill("SIGTERM"); });
}
const cleanup = () => { try { server?.kill("SIGTERM"); } catch {} try { rmSync(work, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);

const get = async () => (await fetch(BASE)).json();
const put = async (body) => {
  const r = await fetch(BASE, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.status;
};

// 版2の文書（書き出し・PUTと同じキーの並び）
const V2 = {
  schemaVersion: 2,
  runs: [
    { key: "r1", typeId: "SV-A", gen: "PJ-1", sk: "新", lo: "2021-01-01", drop: "2030-12-31" },
    { key: "r2", typeId: "SV-A", gen: "PJ-2", sk: "継", lo: "2024-01-01", drop: "2031-12-31" },
    { key: "PJ:9|x", typeId: "SV-C", gen: "PJ-9", sk: "新", lo: "2022-01-01", drop: "2030-12-31" },
  ],
  regs: [
    { rid: "g7", id: "SV-REG-1", label: "ダミー法規1", shin: "2020-01-01", kei: "2022-01-01", parent: "" },
    { rid: "g8", id: "", label: "ID未入力", shin: "", kei: "", parent: "" },
  ],
  cert: [
    { runKey: "r2", rid: "g7", ck: "SV*A1-EXT", planned: false },
    { runKey: "r1", rid: "g7", ck: "SV*A1", planned: false },
    { runKey: "r1", rid: "g8", ck: " ", planned: false },
    { runKey: "PJ:9|x", rid: "g7", ck: "", planned: true },
    { runKey: "PJ:9|x", rid: "g8", ck: "SV*</script>&\"'", planned: false },
  ],
};

try {
  await start();
  // ① 旧形式のDBを開く
  const legacy = await get();
  check("旧DB：GETは版なし（旧形式）", legacy.schemaVersion, undefined);
  check("旧DB：cert は型式 × 法規ID のまま", legacy.cert, { "SV-A": { "SV-REG-1": "SV*A1" } });
  check("旧DB：regs は rid を返さない（フロントが補う）", legacy.regs.map((g) => Object.keys(g).sort().join(",")), ["id,kei,label,parent,shin"]);
  {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    check("旧DB：起動時に regs へ rid 列を足す", db.prepare("PRAGMA table_info(regs)").all().some((c) => c.name === "rid"), true);
    check("旧DB：既存の regs 行の値は変わらない", db.prepare("SELECT id, label FROM regs").all().map((x) => ({ ...x })), [{ id: "SV-REG-1", label: "ダミー法規1" }]);
    db.close();
  }
  // ② 拒否されるPUT（DBは直前のまま）
  check("旧形式のPUTは400", await put({ runs: legacy.runs, regs: legacy.regs, cert: legacy.cert }), 400);
  check("知らない版のPUTは400", await put({ ...V2, schemaVersion: 3 }), 400);
  check("版2で rid の無い regs は400", await put({ ...V2, regs: V2.regs.map(({ rid, ...g }) => g) }), 400);
  check("版2で cert がオブジェクトは400", await put({ ...V2, cert: {} }), 400);
  check("版2で予定が真偽値でないと400", await put({ ...V2, cert: [{ ...V2.cert[0], planned: 0 }] }), 400);
  check("拒否のあともDBは旧形式のまま", await get(), legacy);
  // ③ 版2の保存と往復
  check("版2のPUTは200", await put(V2), 200);
  check("版2：GETはPUTと完全一致", await get(), V2);
  {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    check("A3：cert_run の列", db.prepare("PRAGMA table_info(cert_run)").all().map((c) => c.name), ["runKey", "rid", "ck", "planned", "pos"]);
    check("A3：主キーは (runKey, rid)", db.prepare("PRAGMA table_info(cert_run)").all().filter((c) => c.pk).map((c) => c.name), ["runKey", "rid"]);
    check("A3：regs に rid を保存", db.prepare("SELECT rid FROM regs ORDER BY pos").all().map((x) => x.rid), ["g7", "g8"]);
    check("旧 cert テーブルの行は消さない（移行元として残す）", db.prepare("SELECT typeId, regId, ck FROM cert").all().map((x) => ({ ...x })),
      [{ typeId: "SV-A", regId: "SV-REG-1", ck: "SV*A1" }]);
    db.close();
  }
  // ④ 組の重複はトランザクションごと取り消す
  check("組の重複のPUTは400", await put({ ...V2, cert: [...V2.cert, { ...V2.cert[0] }] }), 400);
  check("重複で失敗してもDBは直前の版2のまま", await get(), V2);
  // ⑤ 空の cert・再起動
  const empty = { ...V2, cert: [] };
  check("空の cert を保存できる", await put(empty), 200);
  check("空の cert の往復", await get(), empty);
  check("戻す", await put(V2), 200);
  await stop();
  await start();
  check("再起動しても版2のまま読める", await get(), V2);
} catch (e) {
  fail++;
  console.log("NG 例外:", e.message);
} finally {
  await stop();
}
console.log(`PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
