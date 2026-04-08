const fs = require('fs');
const path = require('path');

const base = '/Users/johnjohn/Desktop/Poste';
const importFiles = [
  'Trade_Map_-_List_of_importers_for_the_selected_product_.xls',
  'Trade_Map_-_List_of_importers_for_the_selected_product_ (1).xls',
  'Trade_Map_-_List_of_importers_for_the_selected_product_ (2).xls',
  'Trade_Map_-_List_of_importers_for_the_selected_product_ (3).xls',
  'Trade_Map_-_List_of_importers_for_the_selected_product_ (4).xls',
];
const exportFiles = [
  'Trade_Map_-_List_of_exporters_for_the_selected_product_.xls',
  'Trade_Map_-_List_of_exporters_for_the_selected_product_ (1).xls',
  'Trade_Map_-_List_of_exporters_for_the_selected_product_ (2).xls',
  'Trade_Map_-_List_of_exporters_for_the_selected_product_ (3).xls',
  'Trade_Map_-_List_of_exporters_for_the_selected_product_ (4).xls',
];

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/');
}

function toFiniteNumber(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeQuantityToKg(value, unitText) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const unit = String(unitText || '').trim().toLowerCase();
  if (!unit) return numeric;
  if (unit.includes('mixed')) return null;
  if (unit.includes('kilogram') || unit === 'kg' || unit.includes('kilogrammes')) return numeric;
  if (unit.includes('tonne') || unit.includes('tons') || unit.includes('ton')) return numeric * 1000;
  if (unit.includes('pound') || unit === 'lb' || unit === 'lbs') return numeric * 0.45359237;
  return null;
}

function parseMonthlyRaw(rawHtml, entityLabel, measureLabel) {
  const entityRegex = new RegExp(entityLabel, 'i');
  const measureRegex = new RegExp(measureLabel, 'i');

  const tables = [...String(rawHtml).matchAll(/<table[^>]*>[\s\S]*?<\/table>/gi)].map(m => m[0]);
  const target = tables.find(t => entityRegex.test(t) && measureRegex.test(t));
  if (!target) return null;

  const rows = (target.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []).map(tr => {
    const parsed = [];
    const cells = tr.match(/<(?:td|th)[^>]*>[\s\S]*?<\/(?:td|th)>/gi) || [];
    for (const cell of cells) {
      const colspanMatch = cell.match(/colspan\s*=\s*["']?(\d+)/i);
      const colspan = colspanMatch ? Math.max(1, Number(colspanMatch[1])) : 1;
      const text = decodeHtmlEntities(
        cell
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      );
      for (let i = 0; i < colspan; i += 1) parsed.push(text);
    }
    return parsed;
  }).filter(r => r.length);

  const headerIndex = rows.findIndex(r => r.some(c => entityRegex.test(c)));
  if (headerIndex < 0) return null;
  const header = rows[headerIndex];
  const unitHeader = rows[headerIndex + 1] || [];
  const entityIdx = header.findIndex(c => entityRegex.test(c));
  if (entityIdx < 0) return null;

  const monthlyCols = [];
  for (let i = entityIdx + 1; i < Math.min(header.length, unitHeader.length); i += 1) {
    const pm = String(header[i] || '').match(/(\d{4}-M\d{2})/i);
    if (pm && measureRegex.test(String(unitHeader[i] || ''))) {
      monthlyCols.push({ index: i, unitIndex: i + 1 < unitHeader.length ? i + 1 : null, period: pm[1] });
    }
  }
  if (!monthlyCols.length) return null;

  const rowsOut = [];
  for (let r = headerIndex + 2; r < rows.length; r += 1) {
    const row = rows[r];
    const name = String(row[entityIdx] || '').trim();
    if (!name) continue;
    const valuesByPeriod = {};
    for (const col of monthlyCols) {
      const val = toFiniteNumber(row[col.index]);
      if (!Number.isFinite(val)) {
        valuesByPeriod[col.period] = null;
        continue;
      }
      valuesByPeriod[col.period] = normalizeQuantityToKg(val, row[col.unitIndex]);
    }
    rowsOut.push({ name, valuesByPeriod });
  }

  return { periods: monthlyCols.map(c => c.period), rows: rowsOut };
}

function merge(collections) {
  const byName = new Map();
  const periodSet = new Set();
  for (const raw of collections) {
    if (!raw) continue;
    for (const p of raw.periods || []) periodSet.add(p);
    for (const row of raw.rows || []) {
      if (!byName.has(row.name)) byName.set(row.name, {});
      const bucket = byName.get(row.name);
      for (const [p, v] of Object.entries(row.valuesByPeriod || {})) {
        if (!Number.isFinite(v)) continue;
        if (!Number.isFinite(bucket[p])) bucket[p] = v;
      }
    }
  }
  return { periods: Array.from(periodSet).sort(), byName };
}

const importCollections = importFiles
  .map(f => path.join(base, f))
  .filter(fs.existsSync)
  .map(fp => parseMonthlyRaw(fs.readFileSync(fp, 'utf8'), 'Importers', 'Imported quantity'))
  .filter(Boolean);

const exportCollections = exportFiles
  .map(f => path.join(base, f))
  .filter(fs.existsSync)
  .map(fp => parseMonthlyRaw(fs.readFileSync(fp, 'utf8'), 'Exporters', 'Exported quantity'))
  .filter(Boolean);

const imp = merge(importCollections);
const exp = merge(exportCollections);
const periods = Array.from(new Set([...imp.periods, ...exp.periods])).sort();
const common = Array.from(exp.byName.keys()).filter(n => imp.byName.has(n));

const ranked = common.map(name => {
  let total = 0;
  for (const p of periods) {
    const iv = imp.byName.get(name)[p];
    const ev = exp.byName.get(name)[p];
    if (Number.isFinite(iv) && Number.isFinite(ev)) total += (ev - iv);
  }
  return { name, total };
}).sort((a,b)=>b.total-a.total);

console.log('common_count', common.length);
const sample = 'China';
console.log('sample_import_periods', sample, Object.keys(imp.byName.get(sample) || {}).slice(0, 20));
console.log('sample_export_periods', sample, Object.keys(exp.byName.get(sample) || {}).slice(0, 20));
console.log('sample_import_2025M01', imp.byName.get(sample)?.['2025-M01']);
console.log('sample_export_2025M01', exp.byName.get(sample)?.['2025-M01']);
console.log('top10', ranked.slice(0,10));
