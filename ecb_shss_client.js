/*
  ECB SHSS client (strict discovery mode, no fallback datasets).
  Exposes: window.fetchEcbShssByIssuer(options)

  options = {
    issuerCode: 'IT' | 'ES' | ...,
    startPeriod: '2021-Q1',
    canvasId: 'canvasId',
    statusId: 'statusElementId',
    logId: 'preElementId'
  }
*/
(function () {
  const ECB = {
    // Try requested legacy SDW host first; if unreachable, use current ECB host.
    // Both are ECB SDMX service endpoints, same dataset/metadata model.
    baseUrls: [
      'https://sdw-wsrest.ecb.europa.eu/service/',
      'https://data-api.ecb.europa.eu/service/'
    ],
    dataflowAgency: 'ECB',
    dataset: 'SHSS',
    version: '1.0'
  };

  const HOLDER_CATEGORIES = [
    { label: 'Banks', candidates: ['S122', 'S123', 'S124'] },
    { label: 'Central Bank', candidates: ['S121'] },
    { label: 'Insurance', candidates: ['S128'] },
    { label: 'Pension Funds', candidates: ['S129'] },
    { label: 'Other Financial Corporations', candidates: ['S125A', 'S127', 'S12O'] },
    { label: 'Non-Financial Corporations', candidates: ['S11'] },
    { label: 'Households', candidates: ['S1M', 'S14'] },
    { label: 'General Government', candidates: ['S13'] }
  ];

  const COLOR_PALETTE = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#264478', '#9e480e', '#636363'];

  const chartByCanvas = new Map();

  function normalize(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function logFactory(logEl) {
    return function log(msg, level) {
      const line = `[${new Date().toISOString()}] [${level || 'INFO'}] ${msg}`;
      console.log(line);
      if (logEl) {
        logEl.textContent += `${line}\n`;
        logEl.scrollTop = logEl.scrollHeight;
      }
    };
  }

  function xmlNodes(doc, xpath) {
    const context = doc;
    const xmlDoc = context && context.nodeType === 9 ? context : (context ? context.ownerDocument : null);
    if (!xmlDoc || typeof xmlDoc.evaluate !== 'function') {
      throw new Error('XML XPath engine unavailable: cannot evaluate metadata/query XML.');
    }

    const out = [];
    const res = xmlDoc.evaluate(xpath, context, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < res.snapshotLength; i++) out.push(res.snapshotItem(i));
    return out;
  }

  function textOf(node, xpath) {
    const context = node;
    const xmlDoc = context && context.nodeType === 9 ? context : (context ? context.ownerDocument : null);
    if (!xmlDoc || typeof xmlDoc.evaluate !== 'function') return '';
    return (xmlDoc.evaluate(xpath, context, null, XPathResult.STRING_TYPE, null).stringValue || '').trim();
  }

  async function fetchXml(url) {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.sdmx.structure+xml;version=2.1, application/vnd.sdmx.genericdata+xml;version=2.1, application/xml;q=0.8'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const parserErr = doc.querySelector('parsererror');
    if (parserErr) throw new Error(`XML parse error for ${url}: ${parserErr.textContent}`);
    return doc;
  }

  async function resolveReachableBase(log) {
    const errors = [];

    for (const baseUrl of ECB.baseUrls) {
      const probeUrl = `${baseUrl}dataflow/${ECB.dataflowAgency}/${ECB.dataset}/${ECB.version}`;
      try {
        log(`Probe ECB endpoint: ${probeUrl}`);
        const flowDoc = await fetchXml(probeUrl);
        log(`Using ECB endpoint: ${baseUrl}`);
        return { baseUrl, flowDoc };
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        errors.push(`${baseUrl} -> ${msg}`);
        log(`Endpoint probe failed: ${baseUrl} (${msg})`, 'WARN');
      }
    }

    throw new Error(
      'No reachable ECB SDMX endpoint. ' +
      'Tried: ' + errors.join(' | ') +
      '. This is a connectivity/host issue, not an SDMX dimension-code issue.'
    );
  }

  function parseCodelists(structureDoc) {
    const out = new Map();
    const codelists = xmlNodes(structureDoc, "//*[local-name()='Codelist']");

    for (const cl of codelists) {
      const agency = cl.getAttribute('agencyID') || '';
      const id = cl.getAttribute('id') || '';
      const version = cl.getAttribute('version') || '';
      const key = `${agency}:${id}:${version}`;

      const codes = new Map();
      const codeNodes = xmlNodes(cl, "./*[local-name()='Code']");
      for (const c of codeNodes) {
        const codeId = c.getAttribute('id');
        if (!codeId) continue;
        const label = textOf(c, "./*[local-name()='Name'][@*[name()='xml:lang']='en']/text()") || textOf(c, "./*[local-name()='Name'][1]/text()") || codeId;
        codes.set(codeId, label);
      }
      out.set(key, { key, agency, id, version, codes });
    }
    return out;
  }

  function parseDsdDimensions(doc, agency, id, version) {
    const dsd = xmlNodes(doc, `//*[local-name()='DataStructure' and @agencyID='${agency}' and @id='${id}' and @version='${version}']`)[0];
    if (!dsd) throw new Error(`Cannot find DataStructure ${agency}:${id}(${version}) in metadata.`);

    const dimNodes = xmlNodes(dsd, ".//*[local-name()='DimensionList']/*[local-name()='Dimension' or local-name()='TimeDimension']");
    return dimNodes.map((d) => {
      const ref = xmlNodes(d, ".//*[local-name()='Enumeration']/*[local-name()='Ref']")[0];
      return {
        id: d.getAttribute('id'),
        position: Number(d.getAttribute('position') || '999'),
        codelist: ref
          ? {
              agency: ref.getAttribute('agencyID') || '',
              id: ref.getAttribute('id') || '',
              version: ref.getAttribute('version') || ''
            }
          : null
      };
    }).sort((a, b) => a.position - b.position);
  }

  function getCodelist(dim, codelists) {
    if (!dim || !dim.codelist) return null;
    return codelists.get(`${dim.codelist.agency}:${dim.codelist.id}:${dim.codelist.version}`) || null;
  }

  function validateCode(codelist, code, dimId) {
    if (!codelist) throw new Error(`Missing codelist for dimension ${dimId}.`);
    if (!codelist.codes.has(code)) {
      throw new Error(`Invalid code for ${dimId}: ${code}. Use codelist ${codelist.key}.`);
    }
  }

  function discoverSingleCode(codelist, tokenSets, what) {
    const entries = [...codelist.codes.entries()].map(([code, label]) => ({ code, label, norm: normalize(label) }));

    for (const tokens of tokenSets) {
      const normTokens = tokens.map(normalize);
      const matches = entries.filter(e => normTokens.every(t => e.norm.includes(t)));
      if (matches.length === 1) return matches[0].code;
      if (matches.length > 1) {
        throw new Error(`Ambiguous ${what} discovery for tokens [${tokens.join(', ')}]: ${matches.map(m => `${m.code}="${m.label}"`).join(' | ')}`);
      }
    }
    throw new Error(`Could not discover ${what} from codelist ${codelist.key}.`);
  }

  function choosePreferredCode(codelist, preferredCodes, what) {
    if (!codelist) throw new Error(`Missing codelist for ${what}.`);
    for (const code of preferredCodes) {
      if (codelist.codes.has(code)) return code;
    }
    throw new Error(
      `Could not resolve ${what}. None of preferred codes exist in ${codelist.key}: ${preferredCodes.join(', ')}`
    );
  }

  function resolveHolders(sectorCL) {
    const resolved = [];
    for (const cat of HOLDER_CATEGORIES) {
      const code = cat.candidates.find(c => sectorCL.codes.has(c));
      if (code) {
        resolved.push({ label: cat.label, code });
      }
    }
    return resolved;
  }

  function normalizeQuarter(q) {
    return (q || '').replace('-', '').toUpperCase();
  }

  function cmpQuarter(a, b) {
    return normalizeQuarter(a).localeCompare(normalizeQuarter(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  function buildSdmxKey(dimensions, fields) {
    const map = new Map(dimensions.map(d => [d.id, '']));

    for (const [k, v] of Object.entries(fields || {})) {
      if (map.has(k)) map.set(k, v ?? '');
    }

    const parts = [];
    for (const d of dimensions) {
      if (d.id === 'TIME_PERIOD') continue;
      parts.push(map.get(d.id) ?? '');
    }
    return parts.join('.');
  }

  function setStatus(statusEl, txt, isError) {
    if (!statusEl) return;
    statusEl.textContent = txt;
    statusEl.style.background = isError ? '#FEE2E2' : '#DCFCE7';
    statusEl.style.color = isError ? '#991B1B' : '#166534';
  }

  function quarterToDateString(q) {
    const n = normalizeQuarter(q);
    const m = /^([0-9]{4})Q([1-4])$/.exec(n);
    if (!m) return n;
    const year = Number(m[1]);
    const quarter = Number(m[2]);
    const month = (quarter - 1) * 3 + 1;
    return `${year}-${String(month).padStart(2, '0')}-01`;
  }

  async function fetchEcbShssTopHoldersQuarterlyData(options) {
    const {
      issuerCode,
      startPeriod,
      topN,
      logId
    } = options || {};

    if (!issuerCode) {
      throw new Error('issuerCode is required.');
    }

    const logEl = logId ? document.getElementById(logId) : null;
    const log = logFactory(logEl);

    const endpoint = await resolveReachableBase(log);
    const baseUrl = endpoint.baseUrl;
    const flowDoc = endpoint.flowDoc;

    const dsdRef = xmlNodes(flowDoc, "//*[local-name()='Dataflow']/*[local-name()='Structure']/*[local-name()='Ref']")[0];
    if (!dsdRef) throw new Error('Missing DSD Ref in SHSS dataflow metadata.');

    const dsdAgency = dsdRef.getAttribute('agencyID');
    const dsdId = dsdRef.getAttribute('id');
    const dsdVersion = dsdRef.getAttribute('version');
    log(`DSD resolved for quarterly holders: ${dsdAgency}:${dsdId}(${dsdVersion})`);

    const dsdUrl = `${baseUrl}datastructure/${dsdAgency}/${dsdId}/${dsdVersion}?references=all`;
    const dsdDoc = await fetchXml(dsdUrl);

    const codelists = parseCodelists(dsdDoc);
    const dimensions = parseDsdDimensions(dsdDoc, dsdAgency, dsdId, dsdVersion);
    const byId = new Map(dimensions.map(d => [d.id, d]));

    const required = [
      'FREQ', 'ADJUSTMENT', 'COUNTERPART_AREA', 'REF_SECTOR', 'COUNTERPART_SECTOR', 'CONSOLIDATION',
      'ACCOUNTING_ENTRY', 'STO', 'INSTR_ASSET', 'MATURITY', 'EXPENDITURE', 'UNIT_MEASURE',
      'CURRENCY_DENOM', 'VALUATION', 'PRICES', 'TRANSFORMATION', 'CUST_BREAKDOWN'
    ];
    for (const dim of required) {
      if (!byId.has(dim)) throw new Error(`Required dimension ${dim} missing in DSD ${dsdAgency}:${dsdId}.`);
    }

    const freqCL = getCodelist(byId.get('FREQ'), codelists);
    const areaCL = getCodelist(byId.get('COUNTERPART_AREA'), codelists);
    const sectorCL = getCodelist(byId.get('REF_SECTOR'), codelists);
    const issuerSectorCL = getCodelist(byId.get('COUNTERPART_SECTOR'), codelists);
    const adjCL = getCodelist(byId.get('ADJUSTMENT'), codelists);
    const consCL = getCodelist(byId.get('CONSOLIDATION'), codelists);
    const accCL = getCodelist(byId.get('ACCOUNTING_ENTRY'), codelists);
    const stoCL = getCodelist(byId.get('STO'), codelists);
    const instrCL = getCodelist(byId.get('INSTR_ASSET'), codelists);
    const matCL = getCodelist(byId.get('MATURITY'), codelists);
    const expCL = getCodelist(byId.get('EXPENDITURE'), codelists);
    const unitCL = getCodelist(byId.get('UNIT_MEASURE'), codelists);
    const currCL = getCodelist(byId.get('CURRENCY_DENOM'), codelists);
    const valCL = getCodelist(byId.get('VALUATION'), codelists);
    const priceCL = getCodelist(byId.get('PRICES'), codelists);
    const trfCL = getCodelist(byId.get('TRANSFORMATION'), codelists);
    const custCL = getCodelist(byId.get('CUST_BREAKDOWN'), codelists);

    validateCode(freqCL, 'Q', 'FREQ');
    validateCode(adjCL, 'N', 'ADJUSTMENT');
    validateCode(areaCL, issuerCode, 'COUNTERPART_AREA');
    validateCode(issuerSectorCL, 'S13', 'COUNTERPART_SECTOR');
    validateCode(consCL, 'N', 'CONSOLIDATION');
    validateCode(accCL, 'A', 'ACCOUNTING_ENTRY');
    validateCode(matCL, 'T', 'MATURITY');
    validateCode(expCL, '_Z', 'EXPENDITURE');
    validateCode(unitCL, 'XDC', 'UNIT_MEASURE');
    validateCode(currCL, '_T', 'CURRENCY_DENOM');
    validateCode(valCL, 'M', 'VALUATION');
    validateCode(priceCL, 'V', 'PRICES');
    validateCode(trfCL, 'N', 'TRANSFORMATION');
    validateCode(custCL, '_T', 'CUST_BREAKDOWN');

    const stoCode = choosePreferredCode(stoCL, ['LE'], 'STO stock code');
    const instrCode = choosePreferredCode(instrCL, ['F3'], 'INSTR_ASSET debt securities code');
    const holders = resolveHolders(sectorCL);
    if (!holders.length) throw new Error('Could not resolve holder sectors from REF_SECTOR codelist.');

    const key = buildSdmxKey(dimensions, {
      FREQ: 'Q',
      ADJUSTMENT: 'N',
      REF_AREA: '',
      COUNTERPART_AREA: issuerCode,
      REF_SECTOR: '',
      COUNTERPART_SECTOR: 'S13',
      CONSOLIDATION: 'N',
      ACCOUNTING_ENTRY: 'A',
      STO: stoCode,
      INSTR_ASSET: instrCode,
      MATURITY: 'T',
      EXPENDITURE: '_Z',
      UNIT_MEASURE: 'XDC',
      CURRENCY_DENOM: '_T',
      VALUATION: 'M',
      PRICES: 'V',
      TRANSFORMATION: 'N',
      CUST_BREAKDOWN: '_T'
    });

    const dataUrl = `${baseUrl}data/${ECB.dataset}/${key}?startPeriod=${encodeURIComponent(startPeriod || '2021-Q1')}`;
    log(`Fetch quarterly holder stocks: ${dataUrl}`);
    const dataDoc = await fetchXml(dataUrl);

    const series = xmlNodes(dataDoc, "//*[local-name()='Series']");
    if (!series.length) {
      throw new Error(`SHSS stock query returned empty series for issuer ${issuerCode}.`);
    }

    const holderByCode = new Map(holders.map(h => [h.code, h.label]));
    const byQuarter = new Map();

    for (const s of series) {
      const sk = new Map(xmlNodes(s, ".//*[local-name()='SeriesKey']/*[local-name()='Value']").map(n => [n.getAttribute('id'), n.getAttribute('value')]));
      const holderCode = sk.get('REF_SECTOR');
      const holderLabel = holderByCode.get(holderCode);
      if (!holderLabel) continue;

      const attrs = new Map(xmlNodes(s, ".//*[local-name()='Attributes']/*[local-name()='Value']").map(n => [n.getAttribute('id'), n.getAttribute('value')]));
      const unitMult = Number(attrs.get('UNIT_MULT') ?? '0');

      for (const o of xmlNodes(s, ".//*[local-name()='Obs']")) {
        const t = xmlNodes(o, ".//*[local-name()='ObsDimension']")[0];
        const v = xmlNodes(o, ".//*[local-name()='ObsValue']")[0];
        if (!t || !v) continue;

        const q = normalizeQuarter(t.getAttribute('value'));
        if (!q || cmpQuarter(q, normalizeQuarter(startPeriod || '2021-Q1')) < 0) continue;

        const raw = Number(v.getAttribute('value'));
        if (!Number.isFinite(raw)) continue;

        const eurBn = raw * (10 ** unitMult) / 1e9;
        if (!byQuarter.has(q)) byQuarter.set(q, new Map());
        const qMap = byQuarter.get(q);
        qMap.set(holderLabel, (qMap.get(holderLabel) || 0) + eurBn);
      }
    }

    if (!byQuarter.size) {
      throw new Error(`No usable SHSS stock observations for issuer ${issuerCode} from ${startPeriod || '2021-Q1'}.`);
    }

    const quarters = [...byQuarter.keys()].sort(cmpQuarter);
    const latestQuarter = quarters[quarters.length - 1];
    const labels = holders.map(h => h.label);

    const ranked = labels
      .map(label => ({ label, value: byQuarter.get(latestQuarter).get(label) || 0 }))
      .sort((a, b) => b.value - a.value);

    const selected = ranked.slice(0, Math.max(1, Number(topN || 5))).map(x => x.label);

    const holdings = {};
    const shares = {};
    for (const label of selected) {
      holdings[label] = [];
      shares[label] = [];
    }

    for (const q of quarters) {
      const qMap = byQuarter.get(q);
      const total = labels.reduce((acc, label) => acc + (qMap.get(label) || 0), 0);
      const date = quarterToDateString(q);

      for (const label of selected) {
        const val = qMap.get(label) || 0;
        holdings[label].push({ date, holdings: Number(val.toFixed(3)) });
        shares[label].push({ date, percentage: total > 0 ? Number(((val / total) * 100).toFixed(3)) : 0 });
      }
    }

    return {
      holdings,
      shares,
      latest_quarter: latestQuarter,
      holder_labels: selected
    };
  }

  async function fetchEcbShssByIssuer(options) {
    const {
      issuerCode,
      startPeriod,
      canvasId,
      statusId,
      logId
    } = options;

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const statusEl = document.getElementById(statusId);
    const logEl = document.getElementById(logId);
    if (logEl) logEl.textContent = '';
    const log = logFactory(logEl);

    setStatus(statusEl, 'Discovering ECB SHSS metadata...', false);

    try {
      const endpoint = await resolveReachableBase(log);
      const baseUrl = endpoint.baseUrl;
      const flowDoc = endpoint.flowDoc;

      const dsdRef = xmlNodes(flowDoc, "//*[local-name()='Dataflow']/*[local-name()='Structure']/*[local-name()='Ref']")[0];
      if (!dsdRef) throw new Error('Missing DSD Ref in SHSS dataflow metadata.');

      const dsdAgency = dsdRef.getAttribute('agencyID');
      const dsdId = dsdRef.getAttribute('id');
      const dsdVersion = dsdRef.getAttribute('version');
      log(`DSD resolved: ${dsdAgency}:${dsdId}(${dsdVersion})`);

      const dsdUrl = `${baseUrl}datastructure/${dsdAgency}/${dsdId}/${dsdVersion}?references=all`;
      log(`Fetch DSD/codelists: ${dsdUrl}`);
      const dsdDoc = await fetchXml(dsdUrl);

      const codelists = parseCodelists(dsdDoc);
      const dimensions = parseDsdDimensions(dsdDoc, dsdAgency, dsdId, dsdVersion);
      log(`Dimensions: ${dimensions.map(d => d.id).join(' · ')}`);

      const byId = new Map(dimensions.map(d => [d.id, d]));
      const required = [
        'FREQ',
        'ADJUSTMENT',
        'REF_AREA',
        'COUNTERPART_AREA',
        'REF_SECTOR',
        'COUNTERPART_SECTOR',
        'CONSOLIDATION',
        'ACCOUNTING_ENTRY',
        'STO',
        'INSTR_ASSET',
        'MATURITY',
        'EXPENDITURE',
        'UNIT_MEASURE',
        'CURRENCY_DENOM',
        'VALUATION',
        'PRICES',
        'TRANSFORMATION',
        'CUST_BREAKDOWN'
      ];
      for (const dim of required) {
        if (!byId.has(dim)) throw new Error(`Required dimension ${dim} missing in DSD ${dsdAgency}:${dsdId}.`);
      }

      const freqCL = getCodelist(byId.get('FREQ'), codelists);
      const areaCL = getCodelist(byId.get('COUNTERPART_AREA'), codelists);
      const sectorCL = getCodelist(byId.get('REF_SECTOR'), codelists);
      const issuerSectorCL = getCodelist(byId.get('COUNTERPART_SECTOR'), codelists);
      const adjCL = getCodelist(byId.get('ADJUSTMENT'), codelists);
      const consCL = getCodelist(byId.get('CONSOLIDATION'), codelists);
      const accCL = getCodelist(byId.get('ACCOUNTING_ENTRY'), codelists);
      const stoCL = getCodelist(byId.get('STO'), codelists);
      const instrCL = getCodelist(byId.get('INSTR_ASSET'), codelists);
      const matCL = getCodelist(byId.get('MATURITY'), codelists);
      const expCL = getCodelist(byId.get('EXPENDITURE'), codelists);
      const unitCL = getCodelist(byId.get('UNIT_MEASURE'), codelists);
      const currCL = getCodelist(byId.get('CURRENCY_DENOM'), codelists);
      const valCL = getCodelist(byId.get('VALUATION'), codelists);
      const priceCL = getCodelist(byId.get('PRICES'), codelists);
      const trfCL = getCodelist(byId.get('TRANSFORMATION'), codelists);
      const custCL = getCodelist(byId.get('CUST_BREAKDOWN'), codelists);

      validateCode(freqCL, 'Q', 'FREQ');
      validateCode(areaCL, issuerCode, 'COUNTERPART_AREA');
      validateCode(issuerSectorCL, 'S13', 'REF_SECTOR');
      validateCode(adjCL, 'N', 'ADJUSTMENT');
      validateCode(consCL, 'N', 'CONSOLIDATION');
      validateCode(accCL, 'A', 'ACCOUNTING_ENTRY');
      validateCode(matCL, 'T', 'MATURITY');
      validateCode(expCL, '_Z', 'EXPENDITURE');
      validateCode(currCL, '_T', 'CURRENCY_DENOM');
      validateCode(valCL, 'M', 'VALUATION');
      validateCode(priceCL, 'V', 'PRICES');
      validateCode(trfCL, 'N', 'TRANSFORMATION');
      validateCode(custCL, '_T', 'CUST_BREAKDOWN');

      const stoCode = choosePreferredCode(stoCL, ['F', 'LE'], 'STO code');
      const instrCode = choosePreferredCode(instrCL, ['F3'], 'INSTR_ASSET debt securities code');
      const unitCode = choosePreferredCode(unitCL, ['XDC'], 'UNIT_MEASURE code');

      validateCode(stoCL, stoCode, 'STO');
      validateCode(instrCL, instrCode, 'INSTR_ASSET');
      validateCode(unitCL, unitCode, 'UNIT_MEASURE');
      const holders = resolveHolders(sectorCL);
      if (!holders.length) {
        throw new Error('Could not resolve holder sectors from REF_SECTOR codelist.');
      }

      log(`Using codes -> FREQ=Q, COUNTERPART_AREA=${issuerCode}, COUNTERPART_SECTOR=S13, STO=${stoCode}, INSTR_ASSET=${instrCode}, UNIT_MEASURE=${unitCode}, CURRENCY_DENOM=_T`);
      log(`Holder sectors: ${holders.map(h => `${h.code}:${h.label}`).join(' | ')}`);

      const key = buildSdmxKey(dimensions, {
        FREQ: 'Q',
        ADJUSTMENT: 'N',
        REF_AREA: '',
        COUNTERPART_AREA: issuerCode,
        REF_SECTOR: '',
        COUNTERPART_SECTOR: 'S13',
        CONSOLIDATION: 'N',
        ACCOUNTING_ENTRY: 'A',
        STO: stoCode,
        INSTR_ASSET: instrCode,
        MATURITY: 'T',
        EXPENDITURE: '_Z',
        UNIT_MEASURE: unitCode,
        CURRENCY_DENOM: '_T',
        VALUATION: 'M',
        PRICES: 'V',
        TRANSFORMATION: 'N',
        CUST_BREAKDOWN: '_T'
      });

      const dataUrl = `${baseUrl}data/${ECB.dataset}/${key}?startPeriod=${encodeURIComponent(startPeriod || '2021-Q1')}`;
      log(`Fetch data: ${dataUrl}`);
      const dataDoc = await fetchXml(dataUrl);

      const series = xmlNodes(dataDoc, "//*[local-name()='Series']");
      if (!series.length) {
        throw new Error(
          `SHSS query returned empty series for issuer ${issuerCode}. ` +
          `Likely wrong dimension/code in key. Check STO/INSTR_ASSET/UNIT_MEASURE and sector codelists in ECB metadata.`
        );
      }

      const holderByCode = new Map(holders.map(h => [h.code, h.label]));
      const byQuarter = new Map();

      for (const s of series) {
        const sk = new Map(xmlNodes(s, ".//*[local-name()='SeriesKey']/*[local-name()='Value']").map(n => [n.getAttribute('id'), n.getAttribute('value')]));
        const holderCode = sk.get('REF_SECTOR');
        const holderLabel = holderByCode.get(holderCode);
        if (!holderLabel) continue;

        const attrs = new Map(xmlNodes(s, ".//*[local-name()='Attributes']/*[local-name()='Value']").map(n => [n.getAttribute('id'), n.getAttribute('value')]));
        const unitMult = Number(attrs.get('UNIT_MULT') ?? '0');

        const obs = xmlNodes(s, ".//*[local-name()='Obs']");
        for (const o of obs) {
          const t = xmlNodes(o, ".//*[local-name()='ObsDimension']")[0];
          const v = xmlNodes(o, ".//*[local-name()='ObsValue']")[0];
          if (!t || !v) continue;

          const q = normalizeQuarter(t.getAttribute('value'));
          if (!q || cmpQuarter(q, normalizeQuarter(startPeriod || '2021-Q1')) < 0) continue;

          const raw = Number(v.getAttribute('value'));
          if (!Number.isFinite(raw)) continue;

          const eurBn = raw * (10 ** unitMult) / 1e9;
          if (!byQuarter.has(q)) byQuarter.set(q, new Map());
          const hMap = byQuarter.get(q);
          hMap.set(holderLabel, (hMap.get(holderLabel) || 0) + eurBn);
        }
      }

      if (!byQuarter.size) {
        throw new Error(`No usable SHSS observations for issuer ${issuerCode} from ${startPeriod || '2021-Q1'}.`);
      }

      const quarters = [...byQuarter.keys()].sort(cmpQuarter);
      const holderOrder = holders.map(h => h.label);

      const datasets = holderOrder.map((label, i) => ({
        label,
        data: quarters.map(q => Number(((byQuarter.get(q).get(label) || 0)).toFixed(3))),
        backgroundColor: COLOR_PALETTE[i % COLOR_PALETTE.length],
        stack: 'egb'
      }));

      const old = chartByCanvas.get(canvasId);
      if (old) old.destroy();

      const chart = new Chart(ctx, {
        type: 'bar',
        data: { labels: quarters, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              stacked: true,
              ticks: { color: '#0F172A' }
            },
            y: {
              stacked: true,
              title: { display: true, text: 'EUR billions' },
              ticks: { color: '#0F172A' }
            }
          },
          plugins: {
            title: {
              display: true,
              text: `ECB SHSS — ${issuerCode} sovereign debt net flows by holder sector`
            },
            tooltip: {
              callbacks: {
                label: (c) => `${c.dataset.label}: ${c.raw.toFixed(2)} EUR bn`
              }
            }
          }
        }
      });

      chartByCanvas.set(canvasId, chart);
      setStatus(statusEl, '✅ ECB SHSS chart loaded', false);
      log('Chart rendered successfully.');

    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      setStatus(statusEl, `❌ ECB SHSS stopped: ${message}`, true);
      log(message, 'ERROR');
      log('STOPPED. No fallback dataset used.', 'ERROR');
      log('How to discover correct code: dataflow -> datastructure?references=all -> dimension codelist validation.', 'ERROR');
    }
  }

  window.fetchEcbShssByIssuer = fetchEcbShssByIssuer;
  window.fetchEcbShssTopHoldersQuarterlyData = fetchEcbShssTopHoldersQuarterlyData;
})();
