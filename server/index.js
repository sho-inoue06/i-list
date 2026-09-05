// ───────────────────────────────────────────────
// Iリスト バックエンド（段階2）
//   Node標準機能のみ（node:http + node:sqlite）。追加インストール不要。
//   データは data/ilist.db（SQLiteファイル1個）に永続化。
//   API:
//     GET /api/data → { runs, regs, cert }
//     PUT /api/data → 全置換保存（トランザクション）
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
`);

// ── 読み出し：テーブル → フロントのデータ形 { runs, regs, cert } ──
function loadData() {
  const runs = db.prepare("SELECT key, typeId, gen, sk, lo, dropDate FROM runs ORDER BY pos")
    .all().map(({ dropDate, ...r }) => ({ ...r, drop: dropDate }));
  const regs = db.prepare("SELECT id, label, shin, kei, parent FROM regs ORDER BY pos").all();
  const cert = {};
  for (const row of db.prepare("SELECT typeId, regId, ck FROM cert").all()) {
    (cert[row.typeId] ??= {})[row.regId] = row.ck;
  }
  return { runs, regs, cert };
}

// ── 保存：全置換（途中で失敗したら元のまま残るようトランザクション） ──
function saveData({ runs, regs, cert }) {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM runs; DELETE FROM regs; DELETE FROM cert;");
    const insRun = db.prepare("INSERT INTO runs (key, typeId, gen, sk, lo, dropDate, pos) VALUES (?,?,?,?,?,?,?)");
    runs.forEach((r, i) => insRun.run(String(r.key), r.typeId ?? "", r.gen ?? "", r.sk ?? "新", r.lo ?? "", r.drop ?? "", i));
    const insReg = db.prepare("INSERT INTO regs (id, label, shin, kei, parent, pos) VALUES (?,?,?,?,?,?)");
    regs.forEach((r, i) => insReg.run(r.id ?? "", r.label ?? "", r.shin ?? "", r.kei ?? "", r.parent ?? "", i));
    const insCert = db.prepare("INSERT INTO cert (typeId, regId, ck) VALUES (?,?,?)");
    for (const [typeId, byReg] of Object.entries(cert)) {
      for (const [regId, ck] of Object.entries(byReg)) {
        if (ck) insCert.run(typeId, regId, String(ck));
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
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
