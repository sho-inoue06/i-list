// F-31：ダミー様式専用。実ファイルのシート・列・備考書式への対応は引き継ぎ事項。
// XLSX の ZIP/XML はブラウザ標準機能で読み、通信も追加依存も使わない。
const fail = (message) => { throw new Error(message); };
const LIMIT = 32 * 1024 * 1024;
const nodes = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const xml = (bytes) => {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail('DTDを含むExcelは読み込めません。');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (nodes(doc, 'parsererror').length) fail('ExcelのXMLが壊れています。');
  return doc;
};
const crc32 = (bytes) => {
  let crc = -1;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
};
async function unzip(buffer) {
  const data = new Uint8Array(buffer), view = new DataView(buffer);
  const u16 = (p) => view.getUint16(p, true), u32 = (p) => view.getUint32(p, true);
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65557); end--) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === data.length) break;
  }
  if (end < 0 || u32(end) !== 0x06054b50) fail('xlsxのZIP構造が壊れています。');
  const count = u16(end + 10), start = u32(end + 16), size = u32(end + 12);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count > 1000 || start + size !== end)
    fail('このxlsxのZIP形式には対応していません。');
  const files = new Map();
  let p = start, total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || u32(p) !== 0x02014b50) fail('xlsxの索引が壊れています。');
    const flags = u16(p + 8), method = u16(p + 10), crc = u32(p + 16);
    const packed = u32(p + 20), length = u32(p + 24), nameLen = u16(p + 28);
    const next = p + 46 + nameLen + u16(p + 30) + u16(p + 32), local = u32(p + 42);
    total += length;
    if (flags & 1 || ![0, 8].includes(method) || total > LIMIT || next > end || local + 30 > start)
      fail('暗号化・大きすぎるファイル・未対応のZIP形式です。');
    const name = new TextDecoder().decode(data.slice(p + 46, p + 46 + nameLen));
    if (files.has(name) || u32(local) !== 0x04034b50 || u16(local + 8) !== method || u16(local + 6) !== flags)
      fail('xlsxのファイル構造が不正です。');
    const body = local + 30 + u16(local + 26) + u16(local + 28);
    if (body + packed > start || new TextDecoder().decode(data.slice(local + 30, local + 30 + u16(local + 26))) !== name)
      fail('xlsxのデータ範囲が不正です。');
    let bytes = data.slice(body, body + packed);
    if (method === 8) {
      if (typeof DecompressionStream === 'undefined') fail('このブラウザはExcelの展開に対応していません。');
      const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const chunks = []; let n = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        n += part.value.length;
        if (n > length || n > LIMIT) { await reader.cancel(); fail('Excelの展開サイズが不正です。'); }
        chunks.push(part.value);
      }
      bytes = new Uint8Array(n); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    }
    if (bytes.length !== length || crc32(bytes) !== crc) fail('xlsxのデータが壊れています。');
    files.set(name, bytes); p = next;
  }
  if (p !== end) fail('xlsxの索引サイズが不正です。');
  return files;
}
const resolvePart = (base, target) => {
  if (!target || target.includes(':') || target.includes('\\')) fail('Excel内の参照先が不正です。');
  const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') { if (!parts.length) fail('Excel内の参照先が不正です。'); parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
};
export async function readDummyXlsx(file) {
  if (!/\.xlsx$/i.test(file.name)) fail('xlsxファイルを選んでください。');
  if (file.size > 10 * 1024 * 1024) fail('ダミーxlsxは10MB以下にしてください。');
  const files = await unzip(await file.arrayBuffer());
  const read = (name) => xml(files.get(name) || fail('Excelの必要なファイルがありません。'));
  const rootRel = nodes(read('_rels/.rels'), 'Relationship').find(r => r.getAttribute('Type').endsWith('/officeDocument'));
  if (!rootRel || rootRel.getAttribute('TargetMode') === 'External') fail('Excelのブックがありません。');
  const bookPath = resolvePart('', rootRel.getAttribute('Target'));
  const book = read(bookPath), sheet = nodes(book, 'sheet')[0];
  if (!sheet) fail('Excelにシートがありません。');
  const sheetId = [...sheet.attributes].find(a => a.localName === 'id')?.value;
  const relPath = bookPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const rels = nodes(read(relPath), 'Relationship');
  const relationship = rels.find(r => r.getAttribute('Id') === sheetId && r.getAttribute('Type').endsWith('/worksheet'));
  if (!relationship || relationship.getAttribute('TargetMode') === 'External') fail('先頭シートを読めません。');
  const sharedRel = rels.find(r => r.getAttribute('Type').endsWith('/sharedStrings'));
  if (sharedRel?.getAttribute('TargetMode') === 'External') fail('外部の共有文字列は読めません。');
  const strings = sharedRel ? nodes(read(resolvePart(bookPath, sharedRel.getAttribute('Target'))), 'si').map(si =>
    nodes(si, 't').filter(t => t.parentElement.localName !== 'rPh').map(t => t.textContent).join('')) : [];
  const worksheet = read(resolvePart(bookPath, relationship.getAttribute('Target')));
  const rows = nodes(worksheet, 'row');
  if (rows.length > 10001) fail('ダミーxlsxは10000装置までです。');
  const cells = (row) => {
    const values = new Map();
    for (const c of nodes(row, 'c')) {
      const ref = /^([A-Z]+)[1-9]\d*$/.exec(c.getAttribute('r') || '');
      if (!ref || values.has(ref[1])) fail('Excelのセル位置が不正です。');
      values.set(ref[1], c);
    }
    return values;
  };
  const value = (c) => {
    if (!c) return '';
    if (nodes(c, 'f').length) fail('認可番号・対象型式には数式ではなく文字列を入れてください。');
    const t = c.getAttribute('t'), v = nodes(c, 'v')[0]?.textContent || '';
    if (t === 's') {
      if (!/^\d+$/.test(v) || strings[Number(v)] === undefined) fail('Excelの共有文字列が壊れています。');
      return strings[Number(v)];
    }
    if (t === 'inlineStr') return nodes(c, 't').filter(n => n.parentElement.localName !== 'rPh').map(n => n.textContent).join('');
    return v;
  };
  if (!rows.length) fail('Excelに見出し行がありません。');
  const headers = [...cells(rows[0])].map(([col, c]) => [col, value(c).trim()]);
  const column = (title) => {
    const matches = headers.filter(([, v]) => v === title);
    if (matches.length !== 1) fail(`先頭行に「${title}」の見出しを1つ置いてください。`);
    return matches[0][0];
  };
  const certCol = column('認可番号'), typeCol = column('対象型式');
  const result = [];
  for (const [i, row] of rows.slice(1).entries()) {
    const cs = cells(row);
    // 書式だけの空行は装置として数えない。未使用列だけに値のある装置行は空番号として報告する。
    if (![...cs.values()].some(c => nodes(c, 'v').length || nodes(c, 't').some(t => t.textContent))) continue;
    result.push({ row: Number(row.getAttribute('r')) || i + 2, number: value(cs.get(certCol)), types: value(cs.get(typeCol)) });
  }
  return { sheet: sheet.getAttribute('name'), rows: result };
}

// 幅と前後空白だけを揃える。NFKCによるその他の互換文字の同一視は行わない。
export const normalizeNumber = (v) => String(v ?? '').replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim();
export const REASONS = {
  empty: '認可番号が空', invalid: '認可番号の形として読めない', multiple: '1セルに番号が複数ある',
  noReg: '同じ規則番号の法規行が無い', newer: '入れられる法規行が無い（どの行も番号より新しいシリーズ）',
  noTypes: '対象型式が空', missing: '型式が指定プロジェクトに無い', ambiguous: '型式ランが1つに決まらない',
  conflict: '同じ型式ラン×法規行にファイル内の違う番号が2つ以上当たる',
};
export function previewExcel(rows, project, runs, regs, cert) {
  const rejected = [], candidates = [];
  const reject = (row, reason, type = '', reg = '') => rejected.push({ row, reason, type, reg });
  for (const item of rows) {
    const number = normalizeNumber(item.number);
    const match = /^E\d+\*(\d+[A-Z]*)R(\d{2})\/\d{2}\*\d+\*\d{2}$/.exec(number);
    if (!number) { reject(item.row, REASONS.empty); continue; }
    if ((number.match(/E\d+\*/g) || []).length > 1) { reject(item.row, REASONS.multiple); continue; }
    if (!match) { reject(item.row, REASONS.invalid); continue; }
    const types = [...new Set(item.types.split(/[,、]/).map(t => t.trim()).filter(Boolean))];
    if (!types.length) { reject(item.row, REASONS.noTypes); continue; }
    const same = regs.map(reg => ({ reg, id: /^R(\d+[A-Z]*)-(\d{2})$/.exec(reg.id) }))
      .filter(x => x.id && x.id[1] === match[1]);
    if (!same.length) { reject(item.row, REASONS.noReg); continue; }
    const eligible = same.filter(x => Number(x.id[2]) <= Number(match[2]));
    if (!eligible.length) { reject(item.row, REASONS.newer); continue; }
    for (const type of types) {
      const targets = runs.filter(run => run.gen === project && run.typeId === type);
      if (targets.length !== 1) { reject(item.row, targets.length ? REASONS.ambiguous : REASONS.missing, type); continue; }
      for (const { reg, id } of eligible) candidates.push({ row: item.row, runKey: targets[0].key, type, rid: reg.rid,
        reg: reg.id, number, mark: id[2] !== match[2] ? `${match[2]}で取得` : '' });
    }
  }
  const groups = new Map();
  for (const c of candidates) {
    const key = JSON.stringify([c.runKey, c.rid]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const accepted = [];
  for (const group of groups.values()) {
    const c = group[0], sourceRows = [...new Set(group.map(x => x.row))].join(', ');
    if (new Set(group.map(x => x.number)).size > 1) { reject(sourceRows, REASONS.conflict, `${c.type} (${c.runKey})`, c.reg); continue; }
    const existing = cert.find(x => x.runKey === c.runKey && x.rid === c.rid)?.ck || '';
    accepted.push({ ...c, row: sourceRows, existing,
      status: !normalizeNumber(existing) ? '追加' : normalizeNumber(existing) === c.number ? '既存と同じ' : '既存と違う' });
  }
  return { project, accepted, rejected };
}

// 確認時に追加だったセルだけを対象とし、反映直前にも空セルかを確認する。
export function applyExcel(cert, preview) {
  let next = cert;
  for (const row of preview.accepted.filter(r => r.status === '追加')) {
    const i = next.findIndex(c => c.runKey === row.runKey && c.rid === row.rid);
    if (i >= 0 && normalizeNumber(next[i].ck)) continue;
    if (next === cert) next = cert.slice();
    if (i < 0) next.push({ runKey: row.runKey, rid: row.rid, ck: row.number, planned: false });
    else next[i] = { ...next[i], ck: row.number };
  }
  return next;
}
