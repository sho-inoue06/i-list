import React, { useEffect, useRef, useState } from 'react';
import { readDummyXlsx, previewExcel, applyExcel } from './excel-import.js';
import { btn } from '../src/IListApp.jsx';

export default function ExcelImportDialog({ runs, regs, cert, onApply, onClose }) {
  const dialog = useRef(null), generation = useRef(0);
  const [file, setFile] = useState(null), [project, setProject] = useState('');
  const [preview, setPreview] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const projects = [...new Set(runs.map(r => r.gen))].filter(Boolean);
  useEffect(() => {
    dialog.current.showModal();
    return () => { generation.current++; };
  }, []);
  // 解析中や確認中に別データへ変わった場合、その結果からは反映させない。
  useEffect(() => { generation.current++; setPreview(null); setBusy(false); }, [runs, regs, cert]);
  const clear = () => { generation.current++; setPreview(null); setError(''); setBusy(false); };
  const analyze = async () => {
    if (!file || !project) return;
    const gen = ++generation.current;
    setBusy(true); setPreview(null); setError('');
    try {
      const parsed = await readDummyXlsx(file);
      if (gen !== generation.current) return;
      setPreview({ ...previewExcel(parsed.rows, project, runs, regs, cert), sheet: parsed.sheet });
    } catch (err) {
      if (gen === generation.current) setError(`解析できませんでした。${err.message}（現在のデータは変更していません）`);
    } finally { if (gen === generation.current) setBusy(false); }
  };
  const additions = preview?.accepted.filter(r => r.status === '追加').length || 0;
  const cellStyle = { borderBottom: '1px solid #334155', padding: '8px', textAlign: 'left', overflowWrap: 'anywhere' };
  return <dialog ref={dialog} aria-labelledby="excel-title" onCancel={onClose}
    style={{ background: '#13202f', color: '#eef4fa', border: '1px solid #5a6b7d', borderRadius: 12, padding: 24, width: 'min(1050px, 90vw)', maxHeight: '85vh' }}>
    <h2 id="excel-title" style={{ marginTop: 0 }}>ダミーExcelの取り込み</h2>
    <p>先頭シートの先頭行に「認可番号」「対象型式」の見出しを置いてください。ほかの列は使いません。<br />
      対象型式は「,」または「、」で区切ります。会社の実ファイルは使用しないでください。</p>
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
      <label>ダミーxlsx <input aria-label="ダミーxlsx" type="file" accept=".xlsx" onChange={e => { clear(); setFile(e.target.files?.[0] || null); }} /></label>
      <label>プロジェクト <select aria-label="取込先プロジェクト" value={project} onChange={e => { clear(); setProject(e.target.value); }}>
        <option value="">選択してください</option>{projects.map(p => <option key={p} value={p}>{p}</option>)}
      </select></label>
      <button style={btn('#4dd6e0')} disabled={!file || !project || busy} onClick={analyze}>{busy ? '解析中…' : '解析'}</button>
    </div>
    {error && <p role="alert" style={{ color: '#ff9e7d' }}>{error}</p>}
    {preview && <div aria-live="polite">
      <h3>確認：プロジェクトコード {preview.project}</h3>
      <p>ファイル：{file.name} ／ シート：{preview.sheet}</p>
      <p>追加だけを反映します。既存の番号は変更しません。同じセル・同じ番号の重複行はまとめています。</p>
      {['追加', '既存と同じ', '既存と違う'].map(status => {
        const rows = preview.accepted.filter(r => r.status === status);
        return <section key={status} aria-label={status}>
          <h4>{status}：{rows.length}件</h4>
          {rows.length > 0 && <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['Excel行', '法規行', '認可番号', '型式ラン', '取得シリーズ', '既存の番号'].map(h => <th key={h} style={cellStyle}>{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => <tr key={JSON.stringify([r.runKey, r.rid])}>
              {[r.row, r.reg, r.number, `${preview.project} / ${r.type} (${r.runKey})`, r.mark || '一致', r.existing || '—'].map((v, i) => <td key={i} style={cellStyle}>{v}</td>)}
            </tr>)}</tbody>
          </table>}
        </section>;
      })}
      <section aria-label="読めなかった行" style={{ marginTop: 20, border: '1px solid #e0b24d', padding: 12 }}>
        <h4 style={{ marginTop: 0 }}>読めなかった行：{preview.rejected.length}件</h4>
        <p style={{ fontSize: 12 }}>装置行・型式・型式ラン×法規行ごとに、理由に応じて数えています。</p>
        {preview.rejected.map((r, i) => <p key={i} style={{ fontSize: 13 }}>Excel行 {r.row} {r.type} {r.reg}：{r.reason}</p>)}
      </section>
    </div>}
    <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
      <button style={btn('#3fbf8f')} disabled={!additions || busy} onClick={() => { onApply(applyExcel(cert, preview)); onClose(); }}>反映（追加 {additions}件）</button>
      <button style={btn('#8fa3b8', true)} onClick={onClose}>反映せず閉じる</button>
    </div>
  </dialog>;
}
