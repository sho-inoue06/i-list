// ───────────────────────────────────────────────
// Iリスト バックエンド（段階2）
//   Node標準機能のみ（node:http + node:sqlite）。追加インストール不要。
//   データは data/ilist.db（SQLiteファイル1個）に永続化。
//   API:
//     GET /api/data → { schemaVersion:2, runs, regs, cert:[{runKey,rid,ck,planned}] }
//                     （まだ一度も版2で保存していないDBは、旧形式 { runs, regs, cert:{typeId:{regId:ck}} } を返す。
//                       フロントが読込時に移行し、直後の自動保存で版2として書き戻す）
//     PUT /api/data → 全置換保存（トランザクション）。受け付けるのは版2だけ
//   dist/ があれば静的配信もする（npm run build 後は本番モードで単独起動できる）
// ───────────────────────────────────────────────
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // ilist-app/
const DATA_DIR = join(ROOT, "data");
const DIST_DIR = join(ROOT, "dist");
// 汎用の PORT は Vite 等と衝突しうるので、専用の環境変数名にしている
const PORT = process.env.ILIST_API_PORT || 3001;
// ローカル限定（LAN公開・外部公開はしない）
const HOST = "127.0.0.1";

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, "ilist.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    key     TEXT PRIMARY KEY,
    typeId  TEXT NOT NULL DEFAULT '',
    gen     TEXT NOT NULL DEFAULT '',
    sk      TEXT NOT NULL DEFAULT '新',
    lo      TEXT NOT NULL DEFAULT '',
    dropDate TEXT NOT NULL DEFAULT '',
    pos     INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS regs (
    rowid_  INTEGER PRIMARY KEY AUTOINCREMENT,
    id      TEXT NOT NULL DEFAULT '',
    label   TEXT NOT NULL DEFAULT '',
    shin    TEXT NOT NULL DEFAULT '',
    kei     TEXT NOT NULL DEFAULT '',
    parent  TEXT NOT NULL DEFAULT '',
    pos     INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cert (
    typeId  TEXT NOT NULL,
    regId   TEXT NOT NULL,
    ck      TEXT NOT NULL,
    PRIMARY KEY (typeId, regId)
  );
  -- F-22：認証実績を 型式ラン(run.key) × 法規行(rid) で持つ。旧 cert テーブル（型式 × 法規ID）は
  -- 移行元として残し、読み書きしない（版2で保存した後は使わない。消さないのは既存データを壊さないため）。
  CREATE TABLE IF NOT EXISTS cert_run (
    runKey  TEXT NOT NULL,
    rid     TEXT NOT NULL,
    ck      TEXT NOT NULL,
    planned INTEGER NOT NULL DEFAULT 0,
    pos     INTEGER NOT NULL,
    PRIMARY KEY (runKey, rid)
  );
  -- 保存データの版。行が無い＝旧形式のまま（まだ版2で保存していない）。
  CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );
`);
// 旧DBの regs には rid 列が無い。列を足すだけで既存行の値は変えない（空文字で始まり、版2の初回保存で埋まる）。
if (!db.prepare("PRAGMA table_info(regs)").all().some((c) => c.name === "rid")) {
  db.exec("ALTER TABLE regs ADD COLUMN rid TEXT NOT NULL DEFAULT ''");
}
const SCHEMA_VERSION = 2;
const schemaVersionOf = () => db.prepare("SELECT v FROM meta WHERE k = 'schemaVersion'").get()?.v;

// ── 読み出し：テーブル → フロントのデータ形 ──
function loadData() {
  const runs = db.prepare("SELECT key, typeId, gen, sk, lo, dropDate FROM runs ORDER BY pos")
    .all().map(({ dropDate, ...r }) => ({ ...r, drop: dropDate }));
  if (schemaVersionOf() === String(SCHEMA_VERSION)) {
    const regs = db.prepare("SELECT rid, id, label, shin, kei, parent FROM regs ORDER BY pos").all();
    const cert = db.prepare("SELECT runKey, rid, ck, planned FROM cert_run ORDER BY pos")
      .all().map((c) => ({ runKey: c.runKey, rid: c.rid, ck: c.ck, planned: c.planned === 1 }));
    return { schemaVersion: SCHEMA_VERSION, runs, regs, cert };
  }
  // 旧形式（版なし）：従来どおりの形で返す（rid は返さない。フロントが補って移行する）
  const regs = db.prepare("SELECT id, label, shin, kei, parent FROM regs ORDER BY pos").all();
  const cert = {};
  for (const row of db.prepare("SELECT typeId, regId, ck FROM cert").all()) {
    (cert[row.typeId] ??= {})[row.regId] = row.ck;
  }
  return { runs, regs, cert };
}

// ── 保存：全置換（途中で失敗したら元のまま残るようトランザクション） ──
// 版2だけを書く。旧 cert テーブルには触れない（移行元として残す）。
// 認証実績は受け取ったレコードをそのまま全件書く（空の番号も捨てない＝読み直したとき完全一致させる。F-22 A2）。
function saveData({ runs, regs, cert }) {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM runs; DELETE FROM regs; DELETE FROM cert_run;");
    const insRun = db.prepare("INSERT INTO runs (key, typeId, gen, sk, lo, dropDate, pos) VALUES (?,?,?,?,?,?,?)");
    runs.forEach((r, i) => insRun.run(String(r.key), r.typeId ?? "", r.gen ?? "", r.sk ?? "新", r.lo ?? "", r.drop ?? "", i));
    const insReg = db.prepare("INSERT INTO regs (rid, id, label, shin, kei, parent, pos) VALUES (?,?,?,?,?,?,?)");
    regs.forEach((r, i) => insReg.run(r.rid, r.id ?? "", r.label ?? "", r.shin ?? "", r.kei ?? "", r.parent ?? "", i));
    const insCert = db.prepare("INSERT INTO cert_run (runKey, rid, ck, planned, pos) VALUES (?,?,?,?,?)");
    cert.forEach((c, i) => insCert.run(c.runKey, c.rid, c.ck, c.planned ? 1 : 0, i));
    db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('schemaVersion', ?)").run(String(SCHEMA_VERSION));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// PUT本文が版2の形か。問題があればエラー文、無ければ null（形だけを見る。業務ルールは見ない）。
function invalidV2(d) {
  if (d.schemaVersion !== SCHEMA_VERSION) return `schemaVersion ${SCHEMA_VERSION} のデータだけ保存できます`;
  if (!Array.isArray(d.cert)) return "cert が配列ではありません";
  if (!d.regs.every((r) => r && typeof r.rid === "string" && r.rid !== "")) return "regs の各行に rid が必要です";
  const ok = (c) => c && typeof c.runKey === "string" && typeof c.rid === "string" &&
    typeof c.ck === "string" && typeof c.planned === "boolean";
  if (!d.cert.every(ok)) return "cert の各件は { runKey, rid, ck, planned } の形が必要です";
  return null;
}

const json = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/data") {
    if (req.method === "GET") return json(res, 200, loadData());
    if (req.method === "PUT") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 5e6) req.destroy(); });
      req.on("end", () => {
        try {
          const d = JSON.parse(body);
          if (!Array.isArray(d.runs) || !Array.isArray(d.regs) || typeof d.cert !== "object")
            return json(res, 400, { error: "runs / regs / cert が必要です" });
          // 版2だけ受け付ける（旧形式を書き込ませると、版2のDBに型式単位の実績が混ざる）
          const bad = invalidV2(d);
          if (bad) return json(res, 400, { error: bad });
          saveData(d);
          json(res, 200, { ok: true });
        } catch (e) {
          json(res, 400, { error: String(e.message || e) });
        }
      });
      return;
    }
    return json(res, 405, { error: "method not allowed" });
  }

  // dist/ の静的配信（ビルド済みのときだけ。開発中は Vite が担当）
  if (req.method === "GET" && existsSync(DIST_DIR)) {
    let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
    if (p === "/" || p === "\\") p = "/index.html";
    const file = join(DIST_DIR, p);
    if (file.startsWith(DIST_DIR) && existsSync(file)) {
      res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
      return res.end(readFileSync(file));
    }
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Iリスト APIサーバ起動: http://${HOST}:${PORT}`);
  console.log(`データ保存先: ${join(DATA_DIR, "ilist.db")}`);
  if (existsSync(DIST_DIR)) console.log("dist/ を検出 → 本番モード（このURLだけでアプリが開けます）");
});
