let energyTradeChart = null;
let importsWeightsChart = null;
let usImportsChart = null;
let italyImportsChart = null;

const API_BASE = 'http://localhost:5001';
const EUROSTAT_BASE = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ext_st_eu27_2020sitc';

function drawWrappedCenteredText(ctx, text, centerX, startY, maxWidth, lineHeight) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return 0;

    const lines = [];
    let current = words[0];

    for (let i = 1; i < words.length; i += 1) {
        const next = `${current} ${words[i]}`;
        if (ctx.measureText(next).width <= maxWidth) {
            current = next;
        } else {
            lines.push(current);
            current = words[i];
        }
    }
    lines.push(current);

    lines.forEach((line, index) => {
        ctx.fillText(line, centerX, startY + index * lineHeight);
    });

    return lines.length;
}

function downloadChartPng(chartInstance, titleText, fileName) {
    if (!chartInstance) {
        alert('Chart is not ready yet. Please wait a moment and try again.');
        return;
    }

    const sourceCanvas = chartInstance.canvas;
    const exportCanvas = document.createElement('canvas');
    const titlePaddingTop = 20;
    const titleLineHeight = 28;
    const titleBlockWidth = Math.max(280, sourceCanvas.width - 80);

    const exportCtx = exportCanvas.getContext('2d');
    if (!exportCtx) {
        alert('Could not prepare chart export canvas.');
        return;
    }

    exportCtx.font = '700 34px Arial, sans-serif';
    const lineCount = Math.max(
        1,
        drawWrappedCenteredText(exportCtx, titleText || '', sourceCanvas.width / 2, 0, titleBlockWidth, titleLineHeight)
    );

    const titleBlockHeight = titlePaddingTop + lineCount * titleLineHeight + 18;
    exportCanvas.width = sourceCanvas.width;
    exportCanvas.height = sourceCanvas.height + titleBlockHeight;

    const ctx = exportCanvas.getContext('2d');
    if (!ctx) {
        alert('Could not prepare chart export context.');
        return;
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    ctx.fillStyle = '#0F172A';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '700 34px Arial, sans-serif';
    drawWrappedCenteredText(ctx, titleText || '', exportCanvas.width / 2, titlePaddingTop, titleBlockWidth, titleLineHeight);

    ctx.drawImage(sourceCanvas, 0, titleBlockHeight);

    const link = document.createElement('a');
    link.href = exportCanvas.toDataURL('image/png', 1);
    link.download = `${fileName}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function setupDownloadButtons() {
    const energyBtn = document.getElementById('downloadEnergyTradeBtn');
    if (energyBtn) {
        energyBtn.addEventListener('click', () => {
            const title = (document.getElementById('energyTradeTitle') || {}).textContent || 'Eurozone trade balance';
            downloadChartPng(energyTradeChart, title, 'eurozone_trade_balance');
        });
    }

    const importsBtn = document.getElementById('downloadImportsWeightsBtn');
    if (importsBtn) {
        importsBtn.addEventListener('click', () => {
            const title = (document.getElementById('importsWeightsTitle') || {}).textContent || 'Eurozone import weights';
            downloadChartPng(importsWeightsChart, title, 'eurozone_import_weights');
        });
    }

    const usBtn = document.getElementById('downloadUsChartBtn');
    if (usBtn) {
        usBtn.addEventListener('click', () => {
            const title = (document.getElementById('usFuelTitle') || {}).textContent || 'United States oil and gas net trade';
            downloadChartPng(usImportsChart, title, 'us_oil_gas_net_trade');
        });
    }

    const italyBtn = document.getElementById('downloadItalyChartBtn');
    if (italyBtn) {
        italyBtn.addEventListener('click', () => {
            const title = (document.getElementById('italyFuelTitle') || {}).textContent || 'Italy import composition';
            downloadChartPng(italyImportsChart, title, 'italy_import_composition');
        });
    }
}

function formatBillions(value) {
    if (value == null || !Number.isFinite(Number(value))) return 'N/A';
    return `${Number(value).toFixed(2)} bn`;
}

function normalizeEnergyPayload(rawPayload) {
    const payload = rawPayload || {};

    if (Array.isArray(payload.points) && payload.points.length) {
        const mappedPoints = payload.points.map(item => {
            if (item && item.period != null) {
                return {
                    period: String(item.period),
                    oil_net_million_eur: item.oil_net_million_eur,
                    gases_net_million_eur: item.gases_net_million_eur,
                    food_tobacco_net_million_eur: item.food_tobacco_net_million_eur,
                    raw_materials_net_million_eur: item.raw_materials_net_million_eur,
                    chemicals_net_million_eur: item.chemicals_net_million_eur,
                    machinery_vehicles_net_million_eur: item.machinery_vehicles_net_million_eur,
                    other_manufactured_net_million_eur: item.other_manufactured_net_million_eur,
                    other_goods_net_million_eur: item.other_goods_net_million_eur,
                    total_energy_net_million_eur: item.total_energy_net_million_eur,
                    total_all_items_net_million_eur: item.total_all_items_net_million_eur,
                    eur_usd: item.eur_usd,
                };
            }

            const period = (item && item.year != null) ? String(item.year) : null;
            const oil = item && item.petroleum_products_net_million_eur != null
                ? Number(item.petroleum_products_net_million_eur)
                : null;
            const gasesDirect = item && item.gases_net_million_eur != null
                ? Number(item.gases_net_million_eur)
                : null;
            const gasesResidual = item && item.other_energy_residual_net_million_eur != null
                ? Number(item.other_energy_residual_net_million_eur)
                : null;
            const total = item && item.total_energy_net_million_eur != null
                ? Number(item.total_energy_net_million_eur)
                : null;

            return {
                period,
                oil_net_million_eur: oil,
                gases_net_million_eur: (gasesDirect != null ? gasesDirect : gasesResidual),
                food_tobacco_net_million_eur: null,
                raw_materials_net_million_eur: null,
                chemicals_net_million_eur: null,
                machinery_vehicles_net_million_eur: null,
                other_manufactured_net_million_eur: null,
                other_goods_net_million_eur: null,
                total_energy_net_million_eur: total,
                total_all_items_net_million_eur: (item && item.total_all_items_net_million_eur != null)
                    ? Number(item.total_all_items_net_million_eur)
                    : null,
                eur_usd: null,
            };
        }).filter(point => point.period != null);

        return {
            points: mappedPoints,
            start_year: payload.start_year,
            end_year: payload.end_year,
            subtitle: `${payload.geo_label || ''} · partner ${payload.partner_label || ''} · ${payload.indicator_label || ''}`.trim()
        };
    }

    if (Array.isArray(payload.series) && payload.series.length) {
        const totalSeries = payload.series.find(item => item.fuel_code === 'SITC3');
        const oilSeries = payload.series.find(item => item.fuel_code === 'SITC33');

        const totalMap = new Map(((totalSeries && totalSeries.points) || []).map(item => [String(item.year), item]));
        const oilMap = new Map(((oilSeries && oilSeries.points) || []).map(item => [String(item.year), item]));
        const years = Array.from(new Set([...totalMap.keys(), ...oilMap.keys()])).sort();

        const points = years.map(year => {
            const totalRow = totalMap.get(year);
            const oilRow = oilMap.get(year);
            const total = totalRow && totalRow.net_trade_million_eur != null ? Number(totalRow.net_trade_million_eur) : null;
            const oil = oilRow && oilRow.net_trade_million_eur != null ? Number(oilRow.net_trade_million_eur) : null;
            const gases = (total != null && oil != null) ? (total - oil) : null;
            return {
                period: String(year),
                oil_net_million_eur: oil,
                gases_net_million_eur: gases,
                food_tobacco_net_million_eur: null,
                raw_materials_net_million_eur: null,
                chemicals_net_million_eur: null,
                machinery_vehicles_net_million_eur: null,
                other_manufactured_net_million_eur: null,
                other_goods_net_million_eur: null,
                total_energy_net_million_eur: total,
                total_all_items_net_million_eur: null,
                eur_usd: null,
            };
        });

        return {
            points,
            start_year: payload.start_year,
            end_year: payload.end_year,
            subtitle: `${payload.geo_label || ''} · partner ${payload.partner_label || ''}`.trim()
        };
    }

    return {
        points: [],
        start_year: null,
        end_year: null,
        subtitle: ''
    };
}

function toQuarterPeriod(timeCode) {
    const parts = String(timeCode || '').split('-');
    if (parts.length !== 2) return null;
    const year = parts[0];
    const month = Number(parts[1]);
    if (!Number.isFinite(month) || month < 1 || month > 12 || !/^\d{4}$/.test(year)) return null;
    const quarter = Math.floor((month - 1) / 3) + 1;
    return `Q${quarter}/${year}`;
}

function quarterStartEnd(periodLabel) {
    const match = /^Q([1-4])\/(\d{4})$/.exec(String(periodLabel || ''));
    if (!match) return null;

    const quarter = Number(match[1]);
    const year = Number(match[2]);
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;

    const start = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    const endDate = new Date(Date.UTC(year, endMonth, 0));
    const end = `${year}-${String(endMonth).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`;

    return { start, end };
}

function dateToQuarterPeriod(dateString) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
    const quarter = Math.floor((month - 1) / 3) + 1;
    return `Q${quarter}/${year}`;
}

async function fetchEurUsdQuarterlyFallback(periods) {
    if (!Array.isArray(periods) || periods.length === 0) return new Map();

    const validPeriods = periods.filter(period => /^Q[1-4]\/\d{4}$/.test(String(period)));
    if (!validPeriods.length) return new Map();

    const sortedPeriods = [...new Set(validPeriods)].sort((a, b) => {
        const [aq, ay] = [Number(a[1]), Number(a.split('/')[1])];
        const [bq, by] = [Number(b[1]), Number(b.split('/')[1])];
        return ay - by || aq - bq;
    });

    const rangeStart = quarterStartEnd(sortedPeriods[0]);
    const rangeEnd = quarterStartEnd(sortedPeriods[sortedPeriods.length - 1]);
    if (!rangeStart || !rangeEnd) return new Map();

    const url = `https://api.frankfurter.app/${rangeStart.start}..${rangeEnd.end}?from=EUR&to=USD`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Frankfurter FX error ${response.status}`);
    const payload = await response.json();

    const rates = payload.rates || {};
    const buckets = new Map();
    Object.entries(rates).forEach(([dateKey, valueObj]) => {
        const usd = valueObj && valueObj.USD != null ? Number(valueObj.USD) : null;
        if (usd == null || !Number.isFinite(usd)) return;
        const period = dateToQuarterPeriod(dateKey);
        if (!period) return;
        if (!buckets.has(period)) buckets.set(period, { sum: 0, count: 0 });
        const bucket = buckets.get(period);
        bucket.sum += usd;
        bucket.count += 1;
    });

    const quarterly = new Map();
    sortedPeriods.forEach(period => {
        const bucket = buckets.get(period);
        quarterly.set(period, bucket && bucket.count > 0 ? bucket.sum / bucket.count : null);
    });

    return quarterly;
}

async function fetchQuarterlySitcSeries(sitcCode) {
    const params = new URLSearchParams({
        lang: 'en',
        stk_flow: 'BAL_RT',
        indic_et: 'TRD_VAL_SCA',
        partner: 'EXT_EU27_2020',
        sitc06: sitcCode
    });

    const response = await fetch(`${EUROSTAT_BASE}?${params.toString()}`);
    if (!response.ok) throw new Error(`Eurostat error ${response.status} for ${sitcCode}`);

    const payload = await response.json();
    const timeIndex = (((payload.dimension || {}).time || {}).category || {}).index || {};
    const values = payload.value || {};

    const quarterly = new Map();
    Object.entries(timeIndex).forEach(([timeCode, timePos]) => {
        const value = values[String(timePos)];
        if (value == null) return;
        const period = toQuarterPeriod(timeCode);
        if (!period) return;
        quarterly.set(period, (quarterly.get(period) || 0) + Number(value));
    });

    return quarterly;
}

async function fetchQuarterlyTradeValueByFlow(sitcCode, flowCode) {
    const params = new URLSearchParams({
        lang: 'en',
        stk_flow: flowCode,
        indic_et: 'TRD_VAL',
        partner: 'EXT_EU27_2020',
        sitc06: sitcCode
    });

    const response = await fetch(`${EUROSTAT_BASE}?${params.toString()}`);
    if (!response.ok) throw new Error(`Eurostat error ${response.status} for ${sitcCode}/${flowCode}`);

    const payload = await response.json();
    const timeIndex = (((payload.dimension || {}).time || {}).category || {}).index || {};
    const values = payload.value || {};

    const quarterly = new Map();
    Object.entries(timeIndex).forEach(([timeCode, timePos]) => {
        const value = values[String(timePos)];
        if (value == null) return;
        const period = toQuarterPeriod(timeCode);
        if (!period) return;
        quarterly.set(period, (quarterly.get(period) || 0) + Number(value));
    });

    return quarterly;
}

async function fetchCensusHsAnnualSum({ flow, valueField, year, commodityCode = null, commLvl = 'HS4' }) {
    const base = flow === 'imports'
        ? 'https://api.census.gov/data/timeseries/intltrade/imports/hs'
        : 'https://api.census.gov/data/timeseries/intltrade/exports/hs';

    const commodityField = flow === 'imports' ? 'I_COMMODITY' : 'E_COMMODITY';
    const params = new URLSearchParams({
        get: commodityCode ? `${valueField},${commodityField}` : valueField,
        time: `${year}-12`,
        COMM_LVL: commLvl
    });

    if (commodityCode) {
        params.set(commodityField, commodityCode);
    }

    const response = await fetch(`${base}?${params.toString()}`);
    if (response.status === 204) return 0;
    if (!response.ok) throw new Error(`Census API error ${response.status} for ${flow}/${year}/${commodityCode || 'TOTAL'}`);

    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length < 2) return 0;

    const headers = payload[0];
    const valueIdx = headers.indexOf(valueField);
    if (valueIdx < 0) return 0;

    let total = 0;
    for (let i = 1; i < payload.length; i += 1) {
        const row = payload[i];
        if (!Array.isArray(row) || valueIdx >= row.length) continue;
        const value = Number(row[valueIdx]);
        if (Number.isFinite(value)) total += value;
    }
    return total;
}

async function buildUsRealEnergyFromCensus(startYear = 2002, endYear = (new Date().getFullYear() - 1)) {
    const years = [];
    for (let year = startYear; year <= endYear; year += 1) years.push(year);

    const oilCodes = ['2709', '2710'];
    const gasCodes = ['2711'];

    const points = [];
    for (const year of years) {
        const [totalImports, totalExports] = await Promise.all([
            fetchCensusHsAnnualSum({ flow: 'imports', valueField: 'GEN_VAL_YR', year, commLvl: 'HS2' }),
            fetchCensusHsAnnualSum({ flow: 'exports', valueField: 'ALL_VAL_YR', year, commLvl: 'HS2' })
        ]);

        const oilImports = (await Promise.all(oilCodes.map(code => fetchCensusHsAnnualSum({ flow: 'imports', valueField: 'GEN_VAL_YR', year, commodityCode: code, commLvl: 'HS4' }))))
            .reduce((sum, value) => sum + Number(value || 0), 0);
        const oilExports = (await Promise.all(oilCodes.map(code => fetchCensusHsAnnualSum({ flow: 'exports', valueField: 'ALL_VAL_YR', year, commodityCode: code, commLvl: 'HS4' }))))
            .reduce((sum, value) => sum + Number(value || 0), 0);

        const gasImports = (await Promise.all(gasCodes.map(code => fetchCensusHsAnnualSum({ flow: 'imports', valueField: 'GEN_VAL_YR', year, commodityCode: code, commLvl: 'HS4' }))))
            .reduce((sum, value) => sum + Number(value || 0), 0);
        const gasExports = (await Promise.all(gasCodes.map(code => fetchCensusHsAnnualSum({ flow: 'exports', valueField: 'ALL_VAL_YR', year, commodityCode: code, commLvl: 'HS4' }))))
            .reduce((sum, value) => sum + Number(value || 0), 0);

        const totalNet = totalImports - totalExports;
        const oilNet = oilImports - oilExports;
        const gasNet = gasImports - gasExports;
        const otherNet = totalNet - oilNet - gasNet;

        const positiveBase = Math.max(oilNet, 0) + Math.max(gasNet, 0) + Math.max(otherNet, 0);

        points.push({
            year,
            total_net_imports_usd: positiveBase > 0 ? positiveBase : null,
            total_trade_balance_usd: totalNet,
            oil_net_imports_usd: oilNet,
            gas_net_imports_usd: gasNet,
            other_net_imports_usd: otherNet,
            oil_weight_pct: positiveBase > 0 ? (Math.max(oilNet, 0) / positiveBase) * 100 : null,
            gas_weight_pct: positiveBase > 0 ? (Math.max(gasNet, 0) / positiveBase) * 100 : null,
            other_weight_pct: positiveBase > 0 ? (Math.max(otherNet, 0) / positiveBase) * 100 : null,
        });
    }

    return {
        source: 'U.S. Census Bureau International Trade API (HS) - client fallback',
        start_year: years[0] || null,
        end_year: years[years.length - 1] || null,
        points
    };
}

async function fetchWorldBankSeries(countryCode, indicatorCode) {
    const url = `https://api.worldbank.org/v2/country/${countryCode}/indicator/${indicatorCode}?format=json&per_page=20000`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`World Bank error ${response.status} for ${indicatorCode}`);
    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length < 2 || !Array.isArray(payload[1])) return new Map();

    const out = new Map();
    payload[1].forEach(row => {
        const year = row && row.date != null ? String(row.date) : null;
        const value = row ? row.value : null;
        if (!year || value == null) return;
        const y = Number(year);
        const v = Number(value);
        if (!Number.isFinite(y) || !Number.isFinite(v)) return;
        out.set(y, v);
    });
    return out;
}

async function buildUsProxyFallbackFromWorldBank() {
    const [importsMap, fuelShareMap] = await Promise.all([
        fetchWorldBankSeries('USA', 'NE.IMP.GNFS.CD'),
        fetchWorldBankSeries('USA', 'TM.VAL.FUEL.ZS.UN')
    ]);

    const years = [...new Set([...importsMap.keys(), ...fuelShareMap.keys()])].sort((a, b) => a - b);
    const points = years.map(year => {
        const totalImports = importsMap.get(year) ?? null;
        const fuelShare = fuelShareMap.get(year) ?? null;
        const otherShare = (fuelShare != null) ? (100 - fuelShare) : null;
        return {
            year,
            total_net_imports_usd: totalImports,
            total_trade_balance_usd: null,
            oil_net_imports_usd: null,
            gas_net_imports_usd: null,
            other_net_imports_usd: null,
            oil_weight_pct: fuelShare,
            gas_weight_pct: 0,
            other_weight_pct: otherShare,
        };
    }).filter(item => item.total_net_imports_usd != null || item.oil_weight_pct != null);

    return {
        source: 'World Bank fallback (proxy) due unavailable US real-data route/Census access',
        start_year: years.length ? years[0] : null,
        end_year: years.length ? years[years.length - 1] : null,
        points,
    };
}

async function buildNetImportsWeightsPayloadFromEurostat(existingPeriods = []) {
    const codes = ['TOTAL', 'SITC3', 'SITC33', 'SITC0_1', 'SITC2', 'SITC5', 'SITC7', 'SITC6_8'];
    const maps = {};

    await Promise.all(codes.flatMap(code => [
        fetchQuarterlyTradeValueByFlow(code, 'IMP').then(map => { maps[`${code}_IMP`] = map; }),
        fetchQuarterlyTradeValueByFlow(code, 'EXP').then(map => { maps[`${code}_EXP`] = map; })
    ]));

    const periodSet = new Set(existingPeriods.map(String));
    Object.values(maps).forEach(map => {
        if (!(map instanceof Map)) return;
        map.forEach((_, period) => periodSet.add(String(period)));
    });

    const periods = [...periodSet].sort((a, b) => {
        const [aq, ay] = [Number(a[1]), Number(a.split('/')[1])];
        const [bq, by] = [Number(b[1]), Number(b.split('/')[1])];
        return ay - by || aq - bq;
    });

    const getNet = (code, period) => {
        const imp = maps[`${code}_IMP`]?.get(period);
        const exp = maps[`${code}_EXP`]?.get(period);
        if (imp == null && exp == null) return null;
        return Number(imp || 0) - Number(exp || 0);
    };

    const points = periods.map(period => {
        const totalNet = getNet('TOTAL', period);
        const energyNet = getNet('SITC3', period);
        const oilNet = getNet('SITC33', period);
        const gasesNet = (energyNet != null && oilNet != null) ? (energyNet - oilNet) : null;

        const foodNet = getNet('SITC0_1', period);
        const rawNet = getNet('SITC2', period);
        const chemNet = getNet('SITC5', period);
        const machNet = getNet('SITC7', period);
        const manufTotalNet = getNet('SITC6_8', period);
        const otherManufNet = (manufTotalNet != null && machNet != null) ? (manufTotalNet - machNet) : null;

        const known = [oilNet, gasesNet, foodNet, rawNet, chemNet, machNet, otherManufNet];
        const knownSum = known.filter(v => v != null).reduce((sum, v) => sum + Number(v), 0);
        const otherGoodsNet = totalNet != null ? (Number(totalNet) - knownSum) : null;

        const components = [oilNet, gasesNet, foodNet, rawNet, chemNet, machNet, otherManufNet, otherGoodsNet];
        const positiveBase = components.filter(v => v != null).reduce((sum, v) => sum + Math.max(Number(v), 0), 0);

        const oilPositive = oilNet == null ? null : Math.max(Number(oilNet), 0);
        const gasesPositive = gasesNet == null ? null : Math.max(Number(gasesNet), 0);

        return {
            period,
            total_net_imports_million_eur: positiveBase > 0 ? positiveBase : null,
            total_balance_million_eur: totalNet,
            oil_net_imports_million_eur: oilNet,
            gases_net_imports_million_eur: gasesNet,
            oil_weight_pct_of_total_net_imports: (positiveBase > 0 && oilPositive != null) ? (oilPositive / positiveBase) * 100 : null,
            gases_weight_pct_of_total_net_imports: (positiveBase > 0 && gasesPositive != null) ? (gasesPositive / positiveBase) * 100 : null,
        };
    });

    const years = periods.map(p => Number(String(p).split('/')[1])).filter(Number.isFinite);

    return {
        start_year: years.length ? Math.min(...years) : null,
        end_year: years.length ? Math.max(...years) : null,
        points,
    };
}

function normalizeImportsWeightsPayload(rawPayload) {
    const payload = rawPayload || {};
    const points = Array.isArray(payload.points) ? payload.points : [];

    const normalizedPoints = points
        .map(item => {
            const period = item && item.period != null ? String(item.period) : null;
            if (!period) return null;

            const totalNet = item.total_net_imports_million_eur != null
                ? Number(item.total_net_imports_million_eur)
                : (item.total_imports_million_eur != null ? Number(item.total_imports_million_eur) : null);

            const oilWeight = item.oil_weight_pct_of_total_net_imports != null
                ? Number(item.oil_weight_pct_of_total_net_imports)
                : (item.oil_weight_pct_of_total_imports != null ? Number(item.oil_weight_pct_of_total_imports) : null);

            const gasWeight = item.gases_weight_pct_of_total_net_imports != null
                ? Number(item.gases_weight_pct_of_total_net_imports)
                : (item.gases_weight_pct_of_total_imports != null ? Number(item.gases_weight_pct_of_total_imports) : null);

            return {
                period,
                total_net_imports_million_eur: totalNet,
                oil_weight_pct_of_total_net_imports: oilWeight,
                gases_weight_pct_of_total_net_imports: gasWeight,
                total_balance_million_eur: item.total_balance_million_eur != null ? Number(item.total_balance_million_eur) : null,
            };
        })
        .filter(Boolean);

    return {
        start_year: payload.start_year,
        end_year: payload.end_year,
        points: normalizedPoints,
    };
}

function hasDetailedSectionData(points) {
    return points.some(point =>
        point.food_tobacco_net_million_eur != null ||
        point.raw_materials_net_million_eur != null ||
        point.chemicals_net_million_eur != null ||
        point.machinery_vehicles_net_million_eur != null ||
        point.other_manufactured_net_million_eur != null ||
        point.other_goods_net_million_eur != null
    );
}

async function enrichWithDetailedSections(points) {
    const [foodMap, rawMap, chemMap, machMap, manufMap] = await Promise.all([
        fetchQuarterlySitcSeries('SITC0_1'),
        fetchQuarterlySitcSeries('SITC2'),
        fetchQuarterlySitcSeries('SITC5'),
        fetchQuarterlySitcSeries('SITC7'),
        fetchQuarterlySitcSeries('SITC6_8')
    ]);

    return points.map(point => {
        const period = String(point.period);
        const food = foodMap.get(period) ?? null;
        const raw = rawMap.get(period) ?? null;
        const chem = chemMap.get(period) ?? null;
        const mach = machMap.get(period) ?? null;
        const manuf = manufMap.get(period) ?? null;
        const otherManuf = (manuf != null && mach != null) ? (manuf - mach) : null;

        const known = [
            point.oil_net_million_eur,
            point.gases_net_million_eur,
            food,
            raw,
            chem,
            mach,
            otherManuf
        ].filter(v => v != null).reduce((sum, v) => sum + Number(v), 0);

        const totalAll = point.total_all_items_net_million_eur;
        const otherGoods = (totalAll != null) ? (Number(totalAll) - known) : null;

        return {
            ...point,
            food_tobacco_net_million_eur: food,
            raw_materials_net_million_eur: raw,
            chemicals_net_million_eur: chem,
            machinery_vehicles_net_million_eur: mach,
            other_manufactured_net_million_eur: otherManuf,
            other_goods_net_million_eur: otherGoods,
        };
    });
}

async function checkServerStatus() {
    const statusElement = document.getElementById('serverStatus');
    if (!statusElement) return;

    try {
        const response = await fetch(`${API_BASE}/api/health`);
        if (!response.ok) throw new Error(`Server error ${response.status}`);
        statusElement.textContent = '✅ Connected to API server';
        statusElement.style.background = '#DCFCE7';
        statusElement.style.color = '#166534';
    } catch (error) {
        statusElement.textContent = '❌ API server offline. Start api_server.py on port 5001.';
        statusElement.style.background = '#FEE2E2';
        statusElement.style.color = '#991B1B';
    }
}

function renderEnergyTradeChart(payload) {
    const canvas = document.getElementById('energyTradeChart');
    if (!canvas) return;

    const normalized = normalizeEnergyPayload(payload);
    const points = normalized.points || [];
    if (!points.length) {
        throw new Error('No data points available for energy trade chart.');
    }

    const labels = points.map(item => item.period);
    const oilBn = points.map(item => item.oil_net_million_eur == null ? null : Number(item.oil_net_million_eur) / 1000);
    const gasesBn = points.map(item => item.gases_net_million_eur == null ? null : Number(item.gases_net_million_eur) / 1000);
    const foodTobaccoBn = points.map(item => item.food_tobacco_net_million_eur == null ? null : Number(item.food_tobacco_net_million_eur) / 1000);
    const rawMaterialsBn = points.map(item => item.raw_materials_net_million_eur == null ? null : Number(item.raw_materials_net_million_eur) / 1000);
    const chemicalsBn = points.map(item => item.chemicals_net_million_eur == null ? null : Number(item.chemicals_net_million_eur) / 1000);
    const machineryVehiclesBn = points.map(item => item.machinery_vehicles_net_million_eur == null ? null : Number(item.machinery_vehicles_net_million_eur) / 1000);
    const otherManufacturedBn = points.map(item => item.other_manufactured_net_million_eur == null ? null : Number(item.other_manufactured_net_million_eur) / 1000);
    const otherGoodsBn = points.map(item => item.other_goods_net_million_eur == null ? null : Number(item.other_goods_net_million_eur) / 1000);
    const totalBn = points.map(item => {
        const value = item.total_all_items_net_million_eur;
        return value == null ? null : Number(value) / 1000;
    });
    const eurUsd = points.map(item => item.eur_usd == null ? null : Number(item.eur_usd));

    const datasets = [
        {
            type: 'bar',
            label: 'Oil section net trade',
            data: oilBn,
            backgroundColor: '#1D4ED8CC',
            borderColor: '#1D4ED8',
            borderWidth: 1,
            stack: 'energy-sections',
            order: 2
        },
        {
            type: 'bar',
            label: 'Gases section net trade',
            data: gasesBn,
            backgroundColor: '#60A5FACC',
            borderColor: '#60A5FA',
            borderWidth: 1,
            stack: 'energy-sections',
            order: 2
        },
        {
            type: 'bar',
            label: 'Food, drinks and tobacco',
            data: foodTobaccoBn,
            backgroundColor: '#BFDBFE99',
            borderColor: '#BFDBFE',
            borderWidth: 1,
            stack: 'energy-sections',
            order: 2
        },
        {
            type: 'bar',
            label: 'Raw materials',
            data: rawMaterialsBn,
            backgroundColor: '#E5E7EB99',
            borderColor: '#D1D5DB',
            borderWidth: 1,
            stack: 'energy-sections',
            order: 2
        },
        {
            type: 'bar',
            label: 'Chemicals',
            data: chemicalsBn,
            backgroundColor: '#EAB308CC',
            borderColor: '#EAB308',
            borderWidth: 1,
            stack: 'energy-sections',
            order: 2
        },
        {
            type: 'bar',
            label: 'Machinery & vehicles',
            data: machineryVehiclesBn,
            backgroundColor: '#E9D5A1CC',
            borderColor: '#E9D5A1',
            borderWidth: 1,
            stack: 'energy-sections',
            order: 2
        },
        {
            type: 'bar',
            label: 'Other manufactured goods',
            data: otherManufacturedBn,
            backgroundColor: '#B45309CC',
            borderColor: '#B45309',
            borderWidth: 1,
            stack: 'energy-sections',
            order: 2
        },
        {
            type: 'bar',
            label: 'Other goods',
            data: otherGoodsBn,
            backgroundColor: '#EF4444AA',
            borderColor: '#EF4444',
            borderWidth: 1,
            stack: 'energy-sections',
            order: 2
        },
        {
            type: 'line',
            label: 'Total net trade (all traded items)',
            data: totalBn,
            borderColor: '#EF4444',
            backgroundColor: '#EF444422',
            borderWidth: 2.8,
            pointRadius: 2,
            fill: false,
            tension: 0.1,
            spanGaps: true,
            order: 0
        },
        {
            type: 'line',
            label: 'EUR/USD (right axis)',
            data: eurUsd,
            borderColor: '#7C3AED',
            backgroundColor: '#7C3AED22',
            borderWidth: 2.2,
            pointRadius: 1.5,
            fill: false,
            tension: 0.1,
            spanGaps: true,
            yAxisID: 'yRight',
            order: 1
        }
    ];

    if (energyTradeChart) {
        energyTradeChart.destroy();
    }

    energyTradeChart = new Chart(canvas.getContext('2d'), {
        data: {
            labels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Quarter'
                    },
                    grid: {
                        display: false
                    }
                },
                y: {
                    stacked: true,
                    title: {
                        display: true,
                        text: 'Net trade value (bn EUR)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(0)} bn`
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                },
                yRight: {
                    position: 'right',
                    stacked: false,
                    title: {
                        display: true,
                        text: 'EUR/USD (USD per EUR)'
                    },
                    ticks: {
                        callback: value => Number(value).toFixed(2)
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const value = context.parsed.y;
                            if (value == null) return `${context.dataset.label}: N/A`;
                            if (context.dataset.yAxisID === 'yRight') {
                                return `${context.dataset.label}: ${Number(value).toFixed(3)}`;
                            }
                            return `${context.dataset.label}: ${formatBillions(value)}`;
                        }
                    }
                }
            }
        }
    });

    const titleElement = document.getElementById('energyTradeTitle');
    if (titleElement) {
        titleElement.textContent = `Eurozone: oil, gases and detailed non-energy sections with total net-trade line (all items) (${normalized.start_year || 'N/A'}→${normalized.end_year || 'N/A'})`;
    }

    const subtitleElement = document.getElementById('energySubtitle');
    if (subtitleElement) {
        const hasTrueTotal = points.some(item => item.total_all_items_net_million_eur != null);
        const suffix = hasTrueTotal ? '' : ' · Total all-items series unavailable from current API runtime';
        subtitleElement.textContent = (normalized.subtitle || 'Net trade decomposition for energy section') + suffix;
    }
}

function renderImportsWeightsChart(payload) {
    const canvas = document.getElementById('importsWeightsChart');
    if (!canvas) return;

    const normalized = normalizeImportsWeightsPayload(payload);
    const points = normalized.points;
    if (!points.length) {
        throw new Error('No data points available for imports weights chart.');
    }

    const extractYear = (periodLabel) => {
        const match = String(periodLabel || '').match(/(\d{4})$/);
        return match ? Number(match[1]) : null;
    };

    const yearlyBuckets = new Map();
    points.forEach(point => {
        const year = extractYear(point.period);
        if (!Number.isFinite(year)) return;

        if (!yearlyBuckets.has(year)) {
            yearlyBuckets.set(year, {
                totalNet: 0,
                oilAmount: 0,
                gasAmount: 0,
                hasTotal: false,
            });
        }

        const bucket = yearlyBuckets.get(year);
        const total = Number(point.total_net_imports_million_eur);
        const oilPct = Number(point.oil_weight_pct_of_total_net_imports);
        const gasPct = Number(point.gases_weight_pct_of_total_net_imports);

        if (Number.isFinite(total)) {
            bucket.totalNet += total;
            bucket.hasTotal = true;

            if (Number.isFinite(oilPct)) {
                bucket.oilAmount += total * (oilPct / 100);
            }
            if (Number.isFinite(gasPct)) {
                bucket.gasAmount += total * (gasPct / 100);
            }
        }
    });

    const yearlyPoints = [...yearlyBuckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([year, bucket]) => {
            const total = bucket.hasTotal ? bucket.totalNet : null;
            const oilPct = (total && total > 0) ? (bucket.oilAmount / total) * 100 : null;
            const gasPct = (total && total > 0) ? (bucket.gasAmount / total) * 100 : null;
            return {
                period: String(year),
                total_net_imports_million_eur: total,
                oil_weight_pct_of_total_net_imports: oilPct,
                gases_weight_pct_of_total_net_imports: gasPct,
            };
        });

    if (!yearlyPoints.length) {
        throw new Error('No yearly data points available for imports weights chart.');
    }

    const labels = yearlyPoints.map(item => String(item.period));
    const totalNetImportsBn = yearlyPoints.map(item => item.total_net_imports_million_eur == null ? null : Number(item.total_net_imports_million_eur) / 1000);
    const oilWeightPct = yearlyPoints.map(item => item.oil_weight_pct_of_total_net_imports == null ? null : Number(item.oil_weight_pct_of_total_net_imports));
    const gasesWeightPct = yearlyPoints.map(item => item.gases_weight_pct_of_total_net_imports == null ? null : Number(item.gases_weight_pct_of_total_net_imports));
    const otherWeightPct = oilWeightPct.map((oil, idx) => {
        const gas = gasesWeightPct[idx];
        if (oil == null || gas == null) return null;
        const other = 100 - oil - gas;
        return Number.isFinite(other) ? other : null;
    });

    const datasets = [
        {
            type: 'bar',
            label: 'Oil weight in total net imports (%)',
            data: oilWeightPct,
            backgroundColor: '#1D4ED8CC',
            borderColor: '#1D4ED8',
            borderWidth: 1,
            stack: 'weights',
            order: 2
        },
        {
            type: 'bar',
            label: 'Gases weight in total net imports (%)',
            data: gasesWeightPct,
            backgroundColor: '#60A5FACC',
            borderColor: '#60A5FA',
            borderWidth: 1,
            stack: 'weights',
            order: 2
        },
        {
            type: 'bar',
            label: 'Other sections weight (%)',
            data: otherWeightPct,
            backgroundColor: '#E5E7EBCC',
            borderColor: '#D1D5DB',
            borderWidth: 1,
            stack: 'weights',
            order: 2
        }
    ];

    if (importsWeightsChart) {
        importsWeightsChart.destroy();
    }

    importsWeightsChart = new Chart(canvas.getContext('2d'), {
        data: {
            labels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Year'
                    },
                    grid: {
                        display: false
                    }
                },
                y: {
                    stacked: true,
                    min: 0,
                    max: 100,
                    title: {
                        display: true,
                        text: 'Share of total net imports (%)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(0)}%`
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const value = context.parsed.y;
                            if (value == null) return `${context.dataset.label}: N/A`;
                            return `${context.dataset.label}: ${Number(value).toFixed(2)}%`;
                        },
                        afterBody: function (tooltipItems) {
                            const idx = tooltipItems && tooltipItems.length ? tooltipItems[0].dataIndex : -1;
                            if (idx < 0) return [];
                            const total = totalNetImportsBn[idx];
                            return [total == null ? 'Total net imports: N/A' : `Total net imports: ${formatBillions(total)}`];
                        }
                    }
                }
            }
        }
    });

    const titleElement = document.getElementById('importsWeightsTitle');
    if (titleElement) {
        const startYear = labels.length ? labels[0] : (normalized.start_year || 'N/A');
        const endYear = labels.length ? labels[labels.length - 1] : (normalized.end_year || 'N/A');
        titleElement.textContent = `Eurozone net-import composition bar (oil and gases weights in total net imports) (${startYear}→${endYear})`;
    }
}

function renderCountryFuelProxyChart(countryPayload, chartConfig) {
    const canvas = document.getElementById(chartConfig.canvasId);
    if (!canvas) return null;

    const points = Array.isArray(countryPayload && countryPayload.points) ? countryPayload.points : [];
    if (!points.length) {
        throw new Error(`No data points available for ${chartConfig.countryLabel} imports chart.`);
    }

    const labels = points.map(point => String(point.year));
    const fuelSeries = points.map(point => point.fuel_share_pct != null ? Number(point.fuel_share_pct) : null);
    const otherSeries = points.map(point => point.other_share_pct != null ? Number(point.other_share_pct) : null);
    const importsBn = points.map(point => point.total_imports_usd != null ? Number(point.total_imports_usd) / 1e9 : null);

    const datasets = [
        {
            type: 'bar',
            label: 'Fuel share (%)',
            data: fuelSeries,
            backgroundColor: chartConfig.colors.fuel,
            borderColor: chartConfig.colors.line,
            borderWidth: 1,
            stack: 'weights',
            order: 2
        },
        {
            type: 'bar',
            label: 'Other share (%)',
            data: otherSeries,
            backgroundColor: chartConfig.colors.other,
            borderColor: chartConfig.colors.other,
            borderWidth: 1,
            stack: 'weights',
            order: 2
        },
        {
            type: 'line',
            label: 'Total imports (bn USD)',
            data: importsBn,
            borderColor: chartConfig.colors.line,
            backgroundColor: `${chartConfig.colors.line}22`,
            borderWidth: 2,
            pointRadius: 1.2,
            tension: 0.1,
            spanGaps: true,
            fill: false,
            yAxisID: 'yRight',
            order: 0
        }
    ];

    const existingChart = chartConfig.getChart();
    if (existingChart) {
        existingChart.destroy();
    }

    const chartInstance = new Chart(canvas.getContext('2d'), {
        data: {
            labels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Year'
                    },
                    grid: {
                        display: false
                    }
                },
                y: {
                    stacked: true,
                    min: 0,
                    max: 100,
                    title: {
                        display: true,
                        text: 'Fuel/other share in imports (%)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(0)}%`
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                },
                yRight: {
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Total imports (bn USD)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(0)} bn`
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const value = context.parsed.y;
                            if (value == null) return `${context.dataset.label}: N/A`;
                            if (context.dataset.yAxisID === 'yRight') {
                                return `${context.dataset.label}: ${Number(value).toFixed(1)} bn USD`;
                            }
                            return `${context.dataset.label}: ${Number(value).toFixed(2)}%`;
                        }
                    }
                }
            }
        }
    });

    const titleElement = document.getElementById(chartConfig.titleId);
    if (titleElement) {
        titleElement.textContent = `${chartConfig.countryLabel} imports with fuel-share composition (${chartConfig.startYear || 'N/A'}→${chartConfig.endYear || 'N/A'})`;
    }

    return chartInstance;
}

function renderUsRealChart(payload) {
    const canvas = document.getElementById('usImportsChart');
    if (!canvas) return;

    const points = Array.isArray(payload && payload.points) ? payload.points : [];
    if (!points.length) {
        throw new Error('No real U.S. data points available for net-trade chart.');
    }

    const labels = points.map(point => String(point.year));
    const oilNetTradeBn = points.map(point => point.oil_net_imports_usd == null ? null : Number(point.oil_net_imports_usd) / 1e9);
    const gasNetTradeBn = points.map(point => point.gas_net_imports_usd == null ? null : Number(point.gas_net_imports_usd) / 1e9);

    const hasAnySeries = [...oilNetTradeBn, ...gasNetTradeBn].some(value => value != null && Number.isFinite(Number(value)));
    if (!hasAnySeries) {
        throw new Error('U.S. net-trade payload has no usable oil/gas values.');
    }

    if (usImportsChart) {
        usImportsChart.destroy();
    }

    usImportsChart = new Chart(canvas.getContext('2d'), {
        data: {
            labels,
            datasets: [
                {
                    type: 'line',
                    label: 'Oil net trade (bn USD)',
                    data: oilNetTradeBn,
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED822',
                    borderWidth: 2.5,
                    pointRadius: 2,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                    order: 1
                },
                {
                    type: 'line',
                    label: 'Gas net trade (bn USD)',
                    data: gasNetTradeBn,
                    borderColor: '#60A5FA',
                    backgroundColor: '#60A5FA22',
                    borderWidth: 2.5,
                    pointRadius: 2,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Year'
                    },
                    grid: {
                        display: false
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Net trade (bn USD, imports − exports)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(0)} bn`
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const value = context.parsed.y;
                            if (value == null) return `${context.dataset.label}: N/A`;
                            return `${context.dataset.label}: ${Number(value).toFixed(2)} bn USD`;
                        }
                    }
                }
            }
        }
    });

    const titleElement = document.getElementById('usFuelTitle');
    if (titleElement) {
        titleElement.textContent = `United States oil and gas net trade (real data) (${payload.start_year || 'N/A'}→${payload.end_year || 'N/A'})`;
    }
}

function renderUsItalyFuelProxyChart(payload) {
    const countries = Array.isArray(payload && payload.countries) ? payload.countries : [];
    if (!countries.length) {
        throw new Error('No country data available for US/Italy imports charts.');
    }

    const italy = countries.find(item => String(item.country_code || '').toUpperCase() === 'ITA');

    if (!italy) {
        throw new Error('Italy series is missing from payload.');
    }

    if (italy) {
        italyImportsChart = renderCountryFuelProxyChart(italy, {
            canvasId: 'italyImportsChart',
            titleId: 'italyFuelTitle',
            countryLabel: 'Italy',
            startYear: payload.start_year,
            endYear: payload.end_year,
            colors: { fuel: '#B45309CC', other: '#FCD9B6CC', line: '#92400E' },
            getChart: () => italyImportsChart,
        });
    }
}

async function fetchAndRenderUsRealEnergy() {
    let payload = null;
    const currentYear = new Date().getFullYear();
    const startYear = Math.max(2014, currentYear - 10);
    const endYear = currentYear - 1;
    const titleElement = document.getElementById('usFuelTitle');
    if (titleElement) {
        titleElement.textContent = 'United States oil and gas net trade (real data) — loading… this can take up to ~1 minute';
    }

    try {
        const response = await fetch(`${API_BASE}/api/us-real-energy-imports?start_year=${startYear}&end_year=${endYear}`);
        if (response.ok) {
            payload = await response.json();
        }
    } catch (error) {
        console.warn('US real endpoint unavailable, trying Census client fallback.', error);
    }

    if (!payload || !Array.isArray(payload.points) || payload.points.length === 0) {
        try {
            payload = await buildUsRealEnergyFromCensus(startYear, endYear);
        } catch (error) {
            throw new Error('Census client fallback unavailable for U.S. oil/gas net-trade series.');
        }
    }

    renderUsRealChart(payload);
}

async function fetchAndRenderEnergyTrade() {
    const [energyResp, totalResp, fxResp] = await Promise.all([
        fetch(`${API_BASE}/api/eurozone-energy-fuels-trade`),
        fetch(`${API_BASE}/api/eurozone-total-net-trade-all-items`),
        fetch(`${API_BASE}/api/eur-usd-exchange-quarterly`)
    ]);

    if (!energyResp.ok) throw new Error(`Server error ${energyResp.status}`);
    const payload = await energyResp.json();

    if (totalResp.ok) {
        const totalPayload = await totalResp.json();
        const totalByPeriod = new Map(((totalPayload.points || []).map(item => [String(item.period), item.total_all_items_net_million_eur])));
        if (Array.isArray(payload.points)) {
            payload.points = payload.points.map(item => ({
                ...item,
                total_all_items_net_million_eur: totalByPeriod.has(String(item.period))
                    ? totalByPeriod.get(String(item.period))
                    : (item.total_all_items_net_million_eur ?? null)
            }));
        }
    }

    if (Array.isArray(payload.points) && payload.points.length && !hasDetailedSectionData(payload.points)) {
        try {
            payload.points = await enrichWithDetailedSections(payload.points);
        } catch (error) {
            console.warn('Detailed section enrichment failed; rendering base decomposition only.', error);
        }
    }

    if (fxResp.ok && Array.isArray(payload.points)) {
        const fxPayload = await fxResp.json();
        const fxByPeriod = new Map(((fxPayload.points || []).map(item => [String(item.period), item.eur_usd])));
        payload.points = payload.points.map(item => ({
            ...item,
            eur_usd: fxByPeriod.has(String(item.period))
                ? fxByPeriod.get(String(item.period))
                : (item.eur_usd ?? null)
        }));
    }

    if (Array.isArray(payload.points)) {
        const hasFxData = payload.points.some(item => item.eur_usd != null && Number.isFinite(Number(item.eur_usd)));
        if (!hasFxData) {
            try {
                const fallbackMap = await fetchEurUsdQuarterlyFallback(payload.points.map(item => String(item.period)));
                payload.points = payload.points.map(item => ({
                    ...item,
                    eur_usd: fallbackMap.has(String(item.period))
                        ? fallbackMap.get(String(item.period))
                        : (item.eur_usd ?? null)
                }));
            } catch (error) {
                console.warn('EUR/USD fallback enrichment failed.', error);
            }
        }
    }

    renderEnergyTradeChart(payload);
}

async function fetchAndRenderImportsWeights() {
    const response = await fetch(`${API_BASE}/api/eurozone-imports-energy-weights`);
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    let payload = await response.json();

    const normalized = normalizeImportsWeightsPayload(payload);
    const hasNetWeights = normalized.points.some(item =>
        item.oil_weight_pct_of_total_net_imports != null || item.gases_weight_pct_of_total_net_imports != null
    );

    const appearsLegacy = normalized.points.length > 0 && normalized.points.some(item => item.total_balance_million_eur == null);
    if (appearsLegacy || !hasNetWeights) {
        try {
            const periods = normalized.points.map(item => item.period);
            payload = await buildNetImportsWeightsPayloadFromEurostat(periods);
        } catch (error) {
            console.warn('Net-imports fallback enrichment failed; using backend payload as-is.', error);
        }
    }

    renderImportsWeightsChart(payload);
}

async function fetchAndRenderUsItalyFuelProxy() {
    const response = await fetch(`${API_BASE}/api/us-italy-imports-fuel-proxy`);
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const payload = await response.json();
    renderUsItalyFuelProxyChart(payload);
}

window.addEventListener('DOMContentLoaded', async () => {
    await checkServerStatus();
    setupDownloadButtons();
    try {
        await fetchAndRenderEnergyTrade();
    } catch (error) {
        console.error('Error loading energy fuels trade chart:', error);
    }

    try {
        await fetchAndRenderImportsWeights();
    } catch (error) {
        console.error('Error loading imports weights chart:', error);
    }

    try {
        await fetchAndRenderUsRealEnergy();
    } catch (error) {
        console.error('Error loading U.S. real energy chart:', error);
        const titleElement = document.getElementById('usFuelTitle');
        if (titleElement) {
            titleElement.textContent = 'United States oil/gas net-trade chart failed to load (real-data route unavailable)';
        }
    }

    try {
        await fetchAndRenderUsItalyFuelProxy();
    } catch (error) {
        console.error('Error loading Italy proxy chart:', error);
    }
});
