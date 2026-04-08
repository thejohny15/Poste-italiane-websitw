import re, json, html
from pathlib import Path

base = Path('/Users/johnjohn/Desktop/Poste')
import_files = [
    'Trade_Map_-_List_of_importers_for_the_selected_product_.xls',
    'Trade_Map_-_List_of_importers_for_the_selected_product_ (1).xls',
    'Trade_Map_-_List_of_importers_for_the_selected_product_ (2).xls',
    'Trade_Map_-_List_of_importers_for_the_selected_product_ (3).xls',
    'Trade_Map_-_List_of_importers_for_the_selected_product_ (4).xls',
]
export_files = [
    'Trade_Map_-_List_of_exporters_for_the_selected_product_.xls',
    'Trade_Map_-_List_of_exporters_for_the_selected_product_ (1).xls',
    'Trade_Map_-_List_of_exporters_for_the_selected_product_ (2).xls',
    'Trade_Map_-_List_of_exporters_for_the_selected_product_ (3).xls',
    'Trade_Map_-_List_of_exporters_for_the_selected_product_ (4).xls',
]

def parse_cells(row_html):
    cells = re.findall(r'<(?:td|th)[^>]*>[\s\S]*?</(?:td|th)>', row_html, flags=re.I)
    out = []
    for cell in cells:
        m = re.search(r'colspan\s*=\s*["\']?(\d+)', cell, flags=re.I)
        colspan = int(m.group(1)) if m else 1
        txt = re.sub(r'<br\s*/?>', ' ', cell, flags=re.I)
        txt = re.sub(r'<[^>]+>', ' ', txt)
        txt = html.unescape(re.sub(r'\s+', ' ', txt)).strip()
        out.extend([txt] * max(1, colspan))
    return out

def parse_monthly(path, entity, measure):
    s = path.read_text(errors='ignore')
    tables = re.findall(r'<table[^>]*>[\s\S]*?</table>', s, flags=re.I)
    target = None
    for t in tables:
        if re.search(entity, t, flags=re.I) and re.search(measure, t, flags=re.I):
            target = t
            break
    if not target:
        return None

    rows = [parse_cells(r) for r in re.findall(r'<tr[^>]*>[\s\S]*?</tr>', target, flags=re.I)]
    rows = [r for r in rows if r]
    hi = next((i for i, r in enumerate(rows) if any(re.search(entity, c, flags=re.I) for c in r)), -1)
    if hi < 0:
        return None

    header = rows[hi]
    unit = rows[hi + 1] if hi + 1 < len(rows) else []
    ei = next((i for i, c in enumerate(header) if re.search(entity, c, flags=re.I)), -1)
    if ei < 0:
        return None

    cols = []
    for i in range(ei + 1, min(len(header), len(unit))):
        pm = re.search(r'(\d{4}-M\d{2})', header[i], flags=re.I)
        if pm and re.search(measure, unit[i], flags=re.I):
            cols.append((i, pm.group(1)))
    if not cols:
        return None

    out = {}
    for r in rows[hi + 2:]:
        name = (r[ei] if ei < len(r) else '').strip()
        if not name or 'world' in re.sub(r'[^a-z0-9]+', '', name.lower()):
            continue
        bucket = {}
        for idx, p in cols:
            val = (r[idx] if idx < len(r) else '').replace(',', '').strip()
            try:
                bucket[p] = float(val)
            except Exception:
                continue
        if bucket:
            out[name] = bucket
    return out

def merge(dicts):
    out = {}
    for d in dicts:
        if not d:
            continue
        for name, pmap in d.items():
            out.setdefault(name, {})
            for p, v in pmap.items():
                out[name].setdefault(p, v)
    return out

imports = merge([parse_monthly(base / f, 'Importers', 'Imported quantity') for f in import_files])
exports = merge([parse_monthly(base / f, 'Exporters', 'Exported quantity') for f in export_files])

common = sorted(set(imports) & set(exports))
periods = sorted(set(p for n in common for p in (set(imports[n]) | set(exports[n]))))

rank = []
for n in common:
    total = 0.0
    for p in periods:
        if p in imports[n] and p in exports[n]:
            total += exports[n][p] - imports[n][p]
    rank.append((n, total))
rank.sort(key=lambda x: x[1], reverse=True)
sel = [n for n, _ in rank[:5]]

points = []
for p in periods:
    row = {'period': p}
    for i, n in enumerate(sel, 1):
        vi = imports[n].get(p)
        ve = exports[n].get(p)
        row[f'k{i}'] = None if (vi is None or ve is None) else (ve - vi)
    points.append(row)

trim = []
for r in points:
    if any(r[f'k{i}'] is None for i in range(1, 6)):
        break
    trim.append(r)

print(json.dumps({
    'countries': sel,
    'start': trim[0]['period'] if trim else None,
    'end': trim[-1]['period'] if trim else None,
    'points': trim,
}, separators=(',', ':')))
