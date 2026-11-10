"""完全ダミーをゼロから生成。会社ファイル・既存SEEDは使わない。
python3 verify/fixtures/f31/generate.py
xlsxはrepoのignore対象のためstageせず、この生成コードから再生成する。
"""
import json
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED, ZIP_STORED

out = Path(__file__).parent
number = lambda rule, series, seq='9001': f'E43*{rule}R{series}/00*{seq}*00'
runs = []
for i, (project, typ, lo) in enumerate([
    ('DUMMY-P31', 'DUMMY-A', '2025-01-01'), ('DUMMY-P31', 'DUMMY-B', ''),
    ('DUMMY-P31', 'DUMMY-C', '2025-01-01'), ('DUMMY-P31', 'DUMMY-DUP', '2025-01-01'),
    ('DUMMY-P31', 'DUMMY-DUP', '2026-01-01'), ('DUMMY-OTHER', 'DUMMY-A', '2025-01-01'),
    ('DUMMY-P31', 'DUMMY-UNLISTED', '2025-01-01'),
], 301):
    runs.append(dict(key=f'r{i}', gen=project, typeId=typ, sk='新', lo=lo, drop='2030-01-01'))
regs = []
for i, rule in enumerate(['R156-00', 'R156-01', 'R156-02', 'R13H-00', 'R155-01', 'R157-00', 'R158-00', 'DEMO-INVALID'], 301):
    regs.append(dict(rid=f'g{i}', id=rule, label=f'完全ダミー法規 {rule}', shin='2020-01-01' if rule != 'R13H-00' else '2035-01-01', kei='2020-01-01' if rule != 'R13H-00' else '2035-01-01', parent=''))
wide = ''.join(chr(ord(c)+0xfee0) if '!' <= c <= '~' else c for c in number('156','01'))
data = dict(schemaVersion=2, runs=runs, regs=regs, cert=[
    dict(runKey='r303', rid='g301', ck='　'+wide+'　', planned=False),
    dict(runKey='r303', rid='g302', ck='DUMMY-EXISTING-KEEP', planned=False),
    dict(runKey='r301', rid='g301', ck='', planned=True),
], decisions=[], bases=[], sameness=[])
rows = [
    [number('156','01'), 'DUMMY-A、DUMMY-B,DUMMY-C,DUMMY-MISSING,DUMMY-DUP', '完全ダミー装置1'],
    [number('13H','00'), 'DUMMY-A', '英字規則・要否が否'],
    ['', 'DUMMY-A', '空番号'], ['NOT-A-NUMBER', 'DUMMY-A', '不正形'],
    [number('156','01')+', '+number('156','01','9002'), 'DUMMY-A', '複数番号'],
    [number('156','01'), '', '空型式'], [number('999','00'), 'DUMMY-A', '法規なし'],
    [number('155','00'), 'DUMMY-A', '新シリーズしかない'],
    [number('157','00'), 'DUMMY-A', '競合1'], [number('157','00','9002'), 'DUMMY-A', '競合2'],
    ['  '+wide+'  ', 'DUMMY-A', '幅と空白が異なる同一番号'],
    [number('158','00'), 'DUMMY-C', '追加装置'],
]
(out/'dummy-data.json').write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
(out/'dummy-rows.json').write_text(json.dumps([dict(row=i, number=r[0], types=r[1]) for i,r in enumerate(rows,2)], ensure_ascii=False, indent=2)+'\n')
ns = 'http://schemas.openxmlformats.org/'
rels = ns+'package/2006/relationships'
off = ns+'officeDocument/2006/relationships'
ss = ns+'spreadsheetml/2006/main'

def workbook(path, shared=False, compression=ZIP_DEFLATED, source=rows):
    allrows = [['認可番号','対象型式','未使用列','未使用列2']] + [r+['無視してよいダミー'] for r in source]
    strings = []
    parts = []
    for i,row in enumerate(allrows,1):
        cells=[]
        for j,text in enumerate(row):
            ref=f'{chr(65+j)}{i}'
            if shared:
                strings.append(text)
                cells.append(f'<c r="{ref}" t="s"><v>{len(strings)-1}</v></c>')
            else:
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(text)}</t></is></c>')
        parts.append(f'<row r="{i}">'+''.join(cells)+'</row>')
    with ZipFile(path,'w',compression=compression) as z:
        z.writestr('[Content_Types].xml', f'<Types xmlns="{ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+ ('<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' if shared else '')+'</Types>')
        z.writestr('_rels/.rels',f'<Relationships xmlns="{rels}"><Relationship Id="rId1" Type="{off}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml',f'<workbook xmlns="{ss}" xmlns:r="{off}"><sheets><sheet name="完全ダミー" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels',f'<Relationships xmlns="{rels}"><Relationship Id="rId1" Type="{off}/worksheet" Target="worksheets/sheet1.xml"/>'+ (f'<Relationship Id="rId2" Type="{off}/sharedStrings" Target="sharedStrings.xml"/>' if shared else '')+'</Relationships>')
        z.writestr('xl/worksheets/sheet1.xml',f'<worksheet xmlns="{ss}"><sheetData>'+''.join(parts)+'</sheetData></worksheet>')
        if shared:
            z.writestr('xl/sharedStrings.xml',f'<sst xmlns="{ss}">'+''.join(f'<si><t xml:space="preserve">{escape(t)}</t></si>' for t in strings)+'</sst>')
workbook(out/'dummy.xlsx')
workbook(out/'dummy-shared.xlsx', shared=True)
workbook(out/'dummy-stored.xlsx', compression=ZIP_STORED)
(out/'broken.xlsx').write_bytes(b'broken dummy xlsx')
# ZIP自体は正しいがXMLが不正なケース。
with ZipFile(out/'broken-xml.xlsx', 'w', compression=ZIP_DEFLATED) as z:
    z.writestr('_rels/.rels', '<Relationships><broken>')
print('完全ダミーJSON・xlsxを生成:', out)
