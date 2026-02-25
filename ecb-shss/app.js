/*
  ECB SHSS viewer with strict SDMX discovery + validation.
  ---------------------------------------------------------------------------
  CRITICAL: This script uses only ECB SDMX REST on sdw-wsrest.ecb.europa.eu.
  No fallback to IMF/OECD/etc.

  Query concept (dataset SHSS -> DSD NA_SEC dimensions):
  - FREQ: quarterly
  - REF_AREA: issuer country (ES, FR, IT, BE, DE)
  - REF_SECTOR: issuer sector (general government)
  - STO: flows/net transactions
  - INSTR_ASSET: debt securities
  - COUNTERPART_SECTOR: holder-sector breakdown
  - Time range: startPeriod=2021-Q1

  IMPORTANT: uncertain SDMX codes are never hardcoded blindly.
  The code discovers codelists first, validates all configured values,
  and fails with explicit diagnostics when dimensions/codes are wrong.
*/

const CONFIG = {
  ecb: {
    // User-requested endpoint (old SDW REST host)
    baseUrl: 'https://sdw-wsrest.ecb.europa.eu/service/',
    dataflowAgency: 'ECB',
    dataset: 'SHSS',
    version: '1.0'
  },

  // Time range requested by user
  time: {
    startPeriod: '2021-Q1'
  },

  // Countries requested by user
  issuerCountries: ['ES', 'FR', 'IT', 'BE', 'DE'],

  // SHSS/NA_SEC dimension semantics used in this chart
  dimensions: {
    frequency: 'FREQ',
    issuerCountry: 'REF_AREA',
    issuerSector: 'REF_SECTOR',
    holderSector: 'COUNTERPART_SECTOR',
    stockFlow: 'STO',
    instrument: 'INSTR_ASSET',
    unitMeasure: 'UNIT_MEASURE',
    currencyDenom: 'CURRENCY_DENOM'
  },

  // Known-safe fixed choices (must still validate against codelists)
  fixedCodes: {
    FREQ: 'Q',
    REF_SECTOR: 'S13',
    CURRENCY_DENOM: 'EUR'
  },

  // Uncertain codes: discover from ECB metadata labels; never guess.
  discoverCodes: {
    STO: {
      description: 'flows/net transactions',
      labelQueries: [
        ['net', 'transaction'],
        ['transaction'],
        ['flow']
      ]
    },
    INSTR_ASSET: {
      description: 'debt securities',
      labelQueries: [
        ['debt', 'securit'],
        ['f3']
      ]
    },
    UNIT_MEASURE: {
      description: 'currency amount measure (prefer domestic currency)',
      labelQueries: [
        ['domestic currency'],
        ['xdc'],
        ['euro']
      ]
    }
  },

  // Requested holder categories with candidate sector codes.
  // Each candidate is validated against ECB CL_SECTOR before use.
  holderCategories: [
    { label: 'Foreigners', candidates: ['S2'], required: true },
    { label: 'Banks', candidates: ['S122', 'S123', 'S124', 'S12K', 'S12'], required: false },
    { label: 'Central Bank', candidates: ['S121'], required: false },
    { label: 'Insurance', candidates: ['S128'], required: false },
    { label: 'Pension Funds', candidates: ['S129'], required: false },
    { label: 'Other Financial Corporations', candidates: ['S127', 'S12O', 'S12'], required: false },
    { label: 'Non-Financial Corporations', candidates: ['S11'], required: false },
    { label: 'Households', candidates: ['S14', 'S1M'], required: false },
    { label: 'General Government', candidates: ['S13'], required: false }
  ]
};

const logEl = document.getElementById('log');
const runBtn = document.getElementById('runBtn');
const discoveryOnlyEl = document.getElementById('discoveryOnly');
const ctx = document.getElementById('flowsChart').getContext('2d');
let chart;

function log(msg, level = 'INFO') {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  console.log(line);
  logEl.textContent += `${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  logEl.textContent = '';
}

function xmlNodes(doc, xpath) {
  const out = [];
  const result = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
  return out;
}

function textOf(node, xpath) {
  const r = node.ownerDocument.evaluate(xpath, node, null, XPathResult.STRING_TYPE, null);
  return (r.stringValue || '').trim();
}

function normalizeLabel(x) {
  return (x || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizePeriod(p) {
  // Normalize to e.g. 2021Q1
  return (p || '').replace('-', '').toUpperCase();
}

function quarterCompare(a, b) {
  const pa = normalizePeriod(a);
  const pb = normalizePeriod(b);
  return pa.localeCompare(pb, undefined, { numeric: true, sensitivity: 'base' });
}

async function fetchXml(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.sdmx.structure+xml;version=2.1, application/vnd.sdmx.genericdata+xml;version=2.1, application/xml;q=0.8, text/xml;q=0.8'
    }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parserErr = doc.querySelector('parsererror');
  if (parserErr) {
    throw new Error(`XML parse error for ${url}: ${parserErr.textContent}`);
  }
  return doc;
}

function parseCodelists(structureDoc) {
  const codelists = new Map();

  const nodes = xmlNodes(structureDoc, "//*[local-name()='Codelist']");
  for (const cl of nodes) {
    const agency = cl.getAttribute('agencyID') || '';
    const id = cl.getAttribute('id') || '';
    const version = cl.getAttribute('version') || '';
    const key = `${agency}:${id}:${version}`;

    const codes = new Map();
    const codeNodes = xmlNodes(cl, "./*[local-name()='Code']");
    for (const code of codeNodes) {
      const codeId = code.getAttribute('id');
      if (!codeId) continue;
      const label = textOf(code, "./*[local-name()='Name'][@xml:lang='en']/text()") ||
                    textOf(code, "./*[local-name()='Name'][1]/text()");
      codes.set(codeId, label || codeId);
    }

    codelists.set(key, {
      agency,
      id,
      version,
      key,
      codes
    });
  }

  return codelists;
}

function parseDataStructure(structureDoc, dsdAgency, dsdId, dsdVersion) {
  const dsdXpath = `//*[local-name()='DataStructure' and @agencyID='${dsdAgency}' and @id='${dsdId}' and @version='${dsdVersion}']`;
  const dsd = xmlNodes(structureDoc, dsdXpath)[0];
  if (!dsd) {
    throw new Error(`Could not find DataStructure ${dsdAgency}:${dsdId}(${dsdVersion}) in metadata.`);
  }

  const dimNodes = xmlNodes(dsd, ".//*[local-name()='DimensionList']/*[local-name()='Dimension' or local-name()='TimeDimension']");
  const dimensions = dimNodes.map((d) => {
    const id = d.getAttribute('id');
    const position = Number(d.getAttribute('position') || '999');
    const enumRef = xmlNodes(d, ".//*[local-name()='Enumeration']/*[local-name()='Ref']")[0];
    const codelist = enumRef
      ? {
          agency: enumRef.getAttribute('agencyID') || '',
          id: enumRef.getAttribute('id') || '',
          version: enumRef.getAttribute('version') || ''
        }
      : null;

    return { id, position, codelist };
  }).sort((a, b) => a.position - b.position);

  return dimensions;
}

function resolveCodelistForDimension(dim, codelists) {
  if (!dim.codelist) return null;
  const key = `${dim.codelist.agency}:${dim.codelist.id}:${dim.codelist.version}`;
  return codelists.get(key) || null;
}

function discoverSingleCodeByLabel(codelist, labelQueries, what) {
  if (!codelist) {
    throw new Error(`No codelist provided while discovering code for ${what}.`);
  }

  const entries = [...codelist.codes.entries()].map(([code, label]) => ({
    code,
    label,
    norm: normalizeLabel(label)
  }));

  for (const queryTokens of labelQueries) {
    const q = queryTokens.map(normalizeLabel);
    const matches = entries.filter(e => q.every(tok => e.norm.includes(tok)));
    if (matches.length === 1) {
      return matches[0].code;
    }
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous code discovery for ${what}. Tokens [${queryTokens.join(', ')}] matched multiple codes: ` +
        matches.map(m => `${m.code}="${m.label}"`).join(' | ') +
        `. Refine CONFIG.discoverCodes for this dimension.`
      );
    }
  }

  throw new Error(
    `No code found for ${what} using label queries ${JSON.stringify(labelQueries)} in codelist ${codelist.key}.`
  );
}

function validateCodesExist(codelist, codes, dimensionId) {
  const invalid = codes.filter(c => !codelist.codes.has(c));
  if (invalid.length) {
    throw new Error(
      `Invalid code(s) for dimension ${dimensionId}: ${invalid.join(', ')}. ` +
      `Use discovery metadata for codelist ${codelist.key}.`
    );
  }
}

function resolveHolderSectors(sectorCodelist) {
  const resolved = [];
  const skipped = [];

  for (const cat of CONFIG.holderCategories) {
    const code = cat.candidates.find(c => sectorCodelist.codes.has(c));
    if (code) {
      resolved.push({
        label: cat.label,
        code,
        sourceLabel: sectorCodelist.codes.get(code)
      });
    } else if (cat.required) {
      throw new Error(
        `Required holder category "${cat.label}" has no valid code in CL_SECTOR. Tried: ${cat.candidates.join(', ')}`
      );
    } else {
      skipped.push(cat.label);
    }
  }

  if (skipped.length) {
    log(`Optional holder categories not available in CL_SECTOR and skipped: ${skipped.join(', ')}`, 'WARN');
  }

  return resolved;
}

async function discoverAndValidate() {
  const { baseUrl, dataflowAgency, dataset, version } = CONFIG.ecb;

  const dataflowUrl = `${baseUrl}dataflow/${dataflowAgency}/${dataset}/${version}`;
  log(`Fetching dataflow metadata: ${dataflowUrl}`);
  const flowDoc = await fetchXml(dataflowUrl);

  const dsdRef = xmlNodes(flowDoc, "//*[local-name()='Dataflow']/*[local-name()='Structure']/*[local-name()='Ref']")[0];
  if (!dsdRef) {
    throw new Error('Could not read DataStructure reference from dataflow metadata.');
  }

  const dsdAgency = dsdRef.getAttribute('agencyID');
  const dsdId = dsdRef.getAttribute('id');
  const dsdVersion = dsdRef.getAttribute('version');

  log(`Dataflow ${dataset} uses DSD ${dsdAgency}:${dsdId}(${dsdVersion})`);

  const dsdUrl = `${baseUrl}datastructure/${dsdAgency}/${dsdId}/${dsdVersion}?references=all`;
  log(`Fetching data structure + codelists: ${dsdUrl}`);
  const dsdDoc = await fetchXml(dsdUrl);

  const codelists = parseCodelists(dsdDoc);
  const dimensions = parseDataStructure(dsdDoc, dsdAgency, dsdId, dsdVersion);

  log(`Dimension order: ${dimensions.map(d => d.id).join(' · ')}`);

  const dimMap = new Map(dimensions.map(d => [d.id, d]));

  // Ensure required dimensions exist
  const requiredDims = Object.values(CONFIG.dimensions);
  for (const dimId of requiredDims) {
    if (!dimMap.has(dimId)) {
      throw new Error(`Required dimension ${dimId} not found in DSD ${dsdAgency}:${dsdId}.`);
    }
  }

  // Resolve codelists per important dimensions
  const freqDim = dimMap.get(CONFIG.dimensions.frequency);
  const issuerDim = dimMap.get(CONFIG.dimensions.issuerCountry);
  const issuerSectorDim = dimMap.get(CONFIG.dimensions.issuerSector);
  const holderDim = dimMap.get(CONFIG.dimensions.holderSector);
  const stoDim = dimMap.get(CONFIG.dimensions.stockFlow);
  const instrDim = dimMap.get(CONFIG.dimensions.instrument);
  const unitDim = dimMap.get(CONFIG.dimensions.unitMeasure);
  const currDim = dimMap.get(CONFIG.dimensions.currencyDenom);

  const freqCL = resolveCodelistForDimension(freqDim, codelists);
  const issuerCL = resolveCodelistForDimension(issuerDim, codelists);
  const issuerSectorCL = resolveCodelistForDimension(issuerSectorDim, codelists);
  const holderCL = resolveCodelistForDimension(holderDim, codelists);
  const stoCL = resolveCodelistForDimension(stoDim, codelists);
  const instrCL = resolveCodelistForDimension(instrDim, codelists);
  const unitCL = resolveCodelistForDimension(unitDim, codelists);
  const currCL = resolveCodelistForDimension(currDim, codelists);

  // Validate fixed codes
  validateCodesExist(freqCL, [CONFIG.fixedCodes.FREQ], freqDim.id);
  validateCodesExist(issuerCL, CONFIG.issuerCountries, issuerDim.id);
  validateCodesExist(issuerSectorCL, [CONFIG.fixedCodes.REF_SECTOR], issuerSectorDim.id);
  validateCodesExist(currCL, [CONFIG.fixedCodes.CURRENCY_DENOM], currDim.id);

  // Discover uncertain codes from metadata labels
  const stoCode = discoverSingleCodeByLabel(stoCL, CONFIG.discoverCodes.STO.labelQueries, CONFIG.discoverCodes.STO.description);
  const instrCode = discoverSingleCodeByLabel(instrCL, CONFIG.discoverCodes.INSTR_ASSET.labelQueries, CONFIG.discoverCodes.INSTR_ASSET.description);
  const unitCode = discoverSingleCodeByLabel(unitCL, CONFIG.discoverCodes.UNIT_MEASURE.labelQueries, CONFIG.discoverCodes.UNIT_MEASURE.description);

  // Resolve holder categories against CL_SECTOR
  const holders = resolveHolderSectors(holderCL);

  log('Resolved SDMX codes (after discovery + validation):');
  console.table({
    FREQ: CONFIG.fixedCodes.FREQ,
    REF_AREA: CONFIG.issuerCountries.join('+'),
    REF_SECTOR: CONFIG.fixedCodes.REF_SECTOR,
    STO: `${stoCode} (${stoCL.codes.get(stoCode)})`,
    INSTR_ASSET: `${instrCode} (${instrCL.codes.get(instrCode)})`,
    UNIT_MEASURE: `${unitCode} (${unitCL.codes.get(unitCode)})`,
    CURRENCY_DENOM: CONFIG.fixedCodes.CURRENCY_DENOM,
    COUNTERPART_SECTOR: holders.map(h => `${h.code}:${h.label}`).join(' | ')
  });

  return {
    dsd: { agency: dsdAgency, id: dsdId, version: dsdVersion },
    dimensions,
    codelists,
    resolved: {
      freq: CONFIG.fixedCodes.FREQ,
      issuerCountries: CONFIG.issuerCountries,
      issuerSector: CONFIG.fixedCodes.REF_SECTOR,
      sto: stoCode,
      instrument: instrCode,
      unitMeasure: unitCode,
      currencyDenom: CONFIG.fixedCodes.CURRENCY_DENOM,
      holders
    }
  };
}

function buildKey(dimensions, resolved) {
  // SDMX key must respect DSD dimension order (except TIME_PERIOD, set by query params)
  const valuesByDim = new Map(dimensions.map(d => [d.id, '']));

  valuesByDim.set(CONFIG.dimensions.frequency, resolved.freq);
  valuesByDim.set(CONFIG.dimensions.issuerCountry, resolved.issuerCountries.join('+'));
  valuesByDim.set(CONFIG.dimensions.issuerSector, resolved.issuerSector);
  valuesByDim.set(CONFIG.dimensions.holderSector, resolved.holders.map(h => h.code).join('+'));
  valuesByDim.set(CONFIG.dimensions.stockFlow, resolved.sto);
  valuesByDim.set(CONFIG.dimensions.instrument, resolved.instrument);
  valuesByDim.set(CONFIG.dimensions.unitMeasure, resolved.unitMeasure);
  valuesByDim.set(CONFIG.dimensions.currencyDenom, resolved.currencyDenom);

  const keyParts = [];
  for (const d of dimensions) {
    if (d.id === 'TIME_PERIOD') continue;
    keyParts.push(valuesByDim.get(d.id) ?? '');
  }

  return keyParts.join('.');
}

async function fetchShssData(meta) {
  const key = buildKey(meta.dimensions, meta.resolved);
  const { baseUrl, dataset } = CONFIG.ecb;
  const dataUrl = `${baseUrl}data/${dataset}/${key}?startPeriod=${encodeURIComponent(CONFIG.time.startPeriod)}`;

  log(`Fetching SHSS data: ${dataUrl}`);
  const dataDoc = await fetchXml(dataUrl);

  const seriesNodes = xmlNodes(dataDoc, "//*[local-name()='Series']");
  if (!seriesNodes.length) {
    throw new Error(
      `SHSS query returned 0 series.\n` +
      `Likely wrong dimension/code combination in key: ${key}\n` +
      `To diagnose: open DSD metadata, inspect each dimension codelist, validate each code before query.`
    );
  }

  // Build map quarter -> issuer -> holderLabel -> value(EUR bn)
  const valueMap = new Map();
  const holderByCode = new Map(meta.resolved.holders.map(h => [h.code, h.label]));

  for (const s of seriesNodes) {
    const kvNodes = xmlNodes(s, ".//*[local-name()='SeriesKey']/*[local-name()='Value']");
    const seriesKey = new Map(kvNodes.map(n => [n.getAttribute('id'), n.getAttribute('value')]));

    const issuer = seriesKey.get(CONFIG.dimensions.issuerCountry);
    const holderCode = seriesKey.get(CONFIG.dimensions.holderSector);
    const holder = holderByCode.get(holderCode);
    if (!issuer || !holder) continue;

    // Unit multiplier can be series attribute; fallback to 0
    const attrNodes = xmlNodes(s, ".//*[local-name()='Attributes']/*[local-name()='Value']");
    const attrs = new Map(attrNodes.map(n => [n.getAttribute('id'), n.getAttribute('value')]));
    const unitMult = Number(attrs.get('UNIT_MULT') ?? '0');

    const obsNodes = xmlNodes(s, ".//*[local-name()='Obs']");
    for (const obs of obsNodes) {
      const tNode = xmlNodes(obs, ".//*[local-name()='ObsDimension']")[0];
      const vNode = xmlNodes(obs, ".//*[local-name()='ObsValue']")[0];
      if (!tNode || !vNode) continue;

      const periodRaw = tNode.getAttribute('value');
      const quarter = normalizePeriod(periodRaw);
      if (!quarter) continue;
      if (quarterCompare(quarter, normalizePeriod(CONFIG.time.startPeriod)) < 0) continue;

      const rawVal = Number(vNode.getAttribute('value'));
      if (!Number.isFinite(rawVal)) continue;

      // Convert to EUR billions: value * 10^UNIT_MULT / 1e9
      const eurBn = rawVal * (10 ** unitMult) / 1e9;

      if (!valueMap.has(quarter)) valueMap.set(quarter, new Map());
      const byIssuer = valueMap.get(quarter);
      if (!byIssuer.has(issuer)) byIssuer.set(issuer, new Map());
      const byHolder = byIssuer.get(issuer);
      byHolder.set(holder, (byHolder.get(holder) || 0) + eurBn);
    }
  }

  if (!valueMap.size) {
    throw new Error(
      `SHSS query returned series but no usable observations from ${CONFIG.time.startPeriod}.\n` +
      `Check TIME_PERIOD format and selected STO/INSTR_ASSET/sector codes via metadata.`
    );
  }

  return valueMap;
}

function render(valueMap, holders) {
  const quarters = [...valueMap.keys()].sort(quarterCompare);
  const issuerOrder = CONFIG.issuerCountries;
  const holderLabels = holders.map(h => h.label);

  const labels = [];
  const rows = [];

  // one stacked bar per (quarter, issuer)
  for (const q of quarters) {
    for (const issuer of issuerOrder) {
      labels.push(`${q} ${issuer}`);
      const byIssuer = valueMap.get(q)?.get(issuer) || new Map();
      rows.push({ quarter: q, issuer, byIssuer });
    }
  }

  const palette = [
    '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5',
    '#70ad47', '#264478', '#9e480e', '#636363'
  ];

  const datasets = holderLabels.map((holder, i) => ({
    label: holder,
    data: rows.map(r => Number((r.byIssuer.get(holder) || 0).toFixed(3))),
    backgroundColor: palette[i % palette.length],
    stack: 'egb',
    borderWidth: 0
  }));

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      scales: {
        x: {
          stacked: true,
          ticks: {
            maxRotation: 75,
            minRotation: 75,
            autoSkip: true,
            maxTicksLimit: 40,
            color: '#d7dff2'
          },
          grid: { color: 'rgba(200,210,230,0.08)' }
        },
        y: {
          stacked: true,
          title: { display: true, text: 'EUR billions', color: '#d7dff2' },
          ticks: { color: '#d7dff2' },
          grid: { color: 'rgba(200,210,230,0.12)' }
        }
      },
      plugins: {
        title: {
          display: true,
          text: 'EGB flows by quarter (SHSS, net transactions, debt securities, issuer S13)',
          color: '#e9eefb'
        },
        legend: {
          labels: { color: '#d7dff2' }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.toFixed(2)} EUR bn`
          }
        }
      }
    }
  });
}

function printDiscoveryHelp() {
  log('How to discover correct codes from ECB metadata:');
  log('1) Fetch dataflow: /service/dataflow/ECB/SHSS/1.0');
  log('2) Read DSD Ref (agency/id/version).');
  log('3) Fetch DSD + codelists: /service/datastructure/{agency}/{id}/{version}?references=all');
  log('4) For each query dimension (e.g., STO, INSTR_ASSET, COUNTERPART_SECTOR), inspect its referenced codelist and validate every code before building key.');
}

async function run() {
  runBtn.disabled = true;
  clearLog();

  try {
    log('Starting ECB SHSS discovery mode...');
    log(`Endpoint: ${CONFIG.ecb.baseUrl}`);

    const meta = await discoverAndValidate();
    printDiscoveryHelp();

    if (discoveryOnlyEl.checked) {
      log('Discovery-only mode enabled. Stopping before data query.');
      return;
    }

    const valueMap = await fetchShssData(meta);
    render(valueMap, meta.resolved.holders);
    log('Chart rendered successfully.');

  } catch (err) {
    // CRITICAL behavior requested by user: STOP and explain exactly what failed.
    log(String(err.message || err), 'ERROR');

    log('STOPPED: no fallback dataset used.', 'ERROR');
    log('If this is a code issue, validate each dimension code against ECB metadata codelists before querying.', 'ERROR');
    printDiscoveryHelp();

    alert(`ECB SHSS stopped: ${err.message || err}`);
  } finally {
    runBtn.disabled = false;
  }
}

runBtn.addEventListener('click', run);
window.addEventListener('DOMContentLoaded', run);
