const API_BASE = 'http://localhost:5001';
let oilDualApiChart = null;
let oilTopExportersChart = null;
let oilUsOecdConsumptionChart = null;
let fertilizerExportsDualChart = null;
let fertilizerImportsDualChart = null;
let fertilizerImportsMonthlyChart = null;
const EIA_KEY_STORAGE_KEY = 'poste_eia_api_key';

function downloadChartAsPng(chartInstance, fileName, titleText = '') {
    if (!chartInstance || !chartInstance.canvas) {
        return false;
    }

    const sourceCanvas = chartInstance.canvas;
    const title = String(titleText || '').trim();
    const topPadding = title ? 54 : 0;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = sourceCanvas.width;
    exportCanvas.height = sourceCanvas.height + topPadding;

    const exportCtx = exportCanvas.getContext('2d');
    exportCtx.fillStyle = '#FFFFFF';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    if (title) {
        exportCtx.fillStyle = '#0B3A75';
        exportCtx.font = 'bold 28px Arial';
        exportCtx.textAlign = 'center';
        exportCtx.textBaseline = 'middle';
        exportCtx.fillText(title, exportCanvas.width / 2, 28);
    }

    exportCtx.drawImage(sourceCanvas, 0, topPadding);

    const link = document.createElement('a');
    link.href = exportCanvas.toDataURL('image/png', 1.0);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
}

function normalizeEiaKey(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return '';
    if (!/^[A-Za-z0-9]{20,80}$/.test(value)) return '';
    return value;
}

function formatMonthLabel(dateString) {
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return dateString;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
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

function buildShareSeries(points, worldSeries, key) {
    return points.map((point, index) => {
        const world = worldSeries[index];
        const value = point[key] == null ? null : Number(point[key]);
        if (value == null || world == null || world === 0 || Number.isNaN(value) || Number.isNaN(world)) {
            return null;
        }
        return (value / world) * 100;
    });
}

function renderChart(productionPayload, consumptionPayload) {
    const canvas = document.getElementById('oilDualApiChart');
    if (!canvas) return;

    const productionPoints = Array.isArray(productionPayload?.points) ? productionPayload.points : [];
    if (!productionPoints.length) {
        throw new Error('No production points available from first API source.');
    }

    const labels = productionPoints.map(point => formatMonthLabel(point.date));
    const worldSeries = productionPoints.map(point => point.world_tbpd == null ? null : Number(point.world_tbpd));

    const russiaSeries = buildShareSeries(productionPoints, worldSeries, 'russia_tbpd');
    const unitedStatesSeries = buildShareSeries(productionPoints, worldSeries, 'united_states_tbpd');
    const saudiSeries = buildShareSeries(productionPoints, worldSeries, 'saudi_arabia_tbpd');
    const kuwaitSeries = buildShareSeries(productionPoints, worldSeries, 'kuwait_tbpd');
    const qatarSeries = buildShareSeries(productionPoints, worldSeries, 'qatar_tbpd');
    const uaeSeries = buildShareSeries(productionPoints, worldSeries, 'uae_tbpd');
    const iraqSeries = buildShareSeries(productionPoints, worldSeries, 'iraq_tbpd');

    const annualPoints = Array.isArray(consumptionPayload?.points) ? consumptionPayload.points : [];
    const annualMap = {};
    for (const point of annualPoints) {
        const date = String(point?.date || '');
        const year = date.slice(0, 4);
        const pct = point?.world_pct_from_2018;
        const numeric = pct == null ? null : Number(pct);
        if (year && Number.isFinite(numeric)) {
            annualMap[year] = numeric;
        }
    }

    const worldConsumptionAnnualSeries = labels.map(label => {
        if (!label.endsWith('-01')) return null;
        const year = label.slice(0, 4);
        const value = annualMap[year];
        return Number.isFinite(value) ? value : null;
    });

    if (oilDualApiChart) {
        oilDualApiChart.destroy();
    }

    oilDualApiChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Russia',
                    data: russiaSeries,
                    borderColor: '#1D4ED8',
                    borderWidth: 2,
                    pointRadius: 0.7,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'United States',
                    data: unitedStatesSeries,
                    borderColor: '#111827',
                    borderWidth: 2,
                    pointRadius: 0.7,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'Saudi Arabia',
                    data: saudiSeries,
                    borderColor: '#B45309',
                    borderWidth: 2,
                    pointRadius: 0.7,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'Kuwait',
                    data: kuwaitSeries,
                    borderColor: '#7C3AED',
                    borderWidth: 1.9,
                    pointRadius: 0.7,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'Qatar',
                    data: qatarSeries,
                    borderColor: '#059669',
                    borderWidth: 1.9,
                    pointRadius: 0.7,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'UAE',
                    data: uaeSeries,
                    borderColor: '#DC2626',
                    borderWidth: 1.9,
                    pointRadius: 0.7,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'Iraq',
                    data: iraqSeries,
                    borderColor: '#0F766E',
                    borderWidth: 1.9,
                    pointRadius: 0.7,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'World petroleum and other liquids consumption growth (annual, % vs 2018)',
                    data: worldConsumptionAnnualSeries,
                    borderColor: '#BE185D',
                    borderWidth: 2.3,
                    pointRadius: 2.8,
                    tension: 0,
                    spanGaps: true,
                    fill: false,
                    yAxisID: 'y1',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Month',
                    },
                    ticks: {
                        maxRotation: 0,
                        callback: (value, index) => (index % 6 === 0 ? labels[index] : ''),
                    },
                    grid: {
                        display: false,
                    },
                },
                y: {
                    title: {
                        display: true,
                        text: 'Share of world production (%)',
                    },
                    grid: {
                        color: '#D1D5DB',
                    },
                },
                y1: {
                    position: 'right',
                    title: {
                        display: true,
                        text: 'World petroleum and other liquids consumption growth (% vs 2018, annual)',
                    },
                    grid: {
                        drawOnChartArea: false,
                    },
                },
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const value = context.parsed.y;
                            if (value == null) return `${context.dataset.label}: N/A`;
                            if (context.dataset.yAxisID === 'y1') {
                                return `${context.dataset.label}: ${Number(value).toFixed(2)}%`;
                            }
                            return `${context.dataset.label}: ${Number(value).toFixed(2)}% of world`;
                        },
                    },
                },
            },
        },
    });

    const title = document.getElementById('oilDualApiTitle');
    if (title) {
        title.textContent = `Monthly production shares + annual world petroleum and other liquids consumption growth (${productionPayload?.start_date || 'N/A'} → ${productionPayload?.end_date || 'N/A'})`;
    }
}

function renderTopExportersChart(payload) {
    const canvas = document.getElementById('oilTopExportersChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.points) ? payload.points : [];
    const exporters = Array.isArray(payload?.exporters) ? [...payload.exporters] : [];

    const forcedExporters = [
        { code: 'USA', name: 'United States', series_key: 'usa_share_pct' },
        { code: 'NOR', name: 'Norway', series_key: 'nor_share_pct' },
        { code: 'BRA', name: 'Brazil', series_key: 'bra_share_pct' },
    ];

    const existingCodes = new Set(exporters.map(item => String(item?.code || '').toUpperCase()));
    for (const forced of forcedExporters) {
        if (!existingCodes.has(forced.code)) {
            exporters.push(forced);
            existingCodes.add(forced.code);
        }
    }

    if (!points.length || !exporters.length) {
        if (oilTopExportersChart) {
            oilTopExportersChart.destroy();
            oilTopExportersChart = null;
        }
        const title = document.getElementById('oilTopExportersTitle');
        if (title) {
            const variant = payload?.variant ? ` [${payload.variant}]` : '';
            const strategy = payload?.selection_strategy ? ` strategy=${payload.selection_strategy}` : '';
            const candidates = Number.isFinite(payload?.selection_positive_candidates)
                ? ` candidates=${payload.selection_positive_candidates}`
                : '';
            title.textContent = `No top net-exporter share data available.${variant}${strategy}${candidates}`;
        }
        return;
    }

    const labels = points.map(point => String(point.date || '').slice(0, 4));
    const palette = ['#1D4ED8', '#B45309', '#059669', '#7C3AED', '#DC2626', '#0F766E', '#111827'];

    const readExporterValue = (point, exporter) => {
        if (!point || !exporter) return null;

        const direct = point[exporter.series_key];
        if (direct != null) return Number(direct);

        const code = String(exporter.code || '').toUpperCase();
        if (code === 'USA') {
            const v = point.usa_share_pct ?? point.united_states_share_pct;
            return v == null ? null : Number(v);
        }
        if (code === 'NOR') {
            const v = point.nor_share_pct ?? point.norway_share_pct;
            return v == null ? null : Number(v);
        }
        if (code === 'BRA') {
            const v = point.bra_share_pct ?? point.brazil_share_pct;
            return v == null ? null : Number(v);
        }

        return null;
    };

    const datasets = exporters.map((exporter, index) => ({
        label: exporter.name || exporter.code || `Exporter ${index + 1}`,
        data: points.map(point => readExporterValue(point, exporter)),
        borderColor: palette[index % palette.length],
        backgroundColor: `${palette[index % palette.length]}22`,
        borderWidth: 2,
        pointRadius: 1.6,
        tension: 0.2,
        spanGaps: true,
        fill: false,
    }));

    if (oilTopExportersChart) {
        oilTopExportersChart.destroy();
    }

    oilTopExportersChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Year',
                    },
                    grid: {
                        display: false,
                    },
                },
                y: {
                    title: {
                        display: true,
                        text: 'Share of world net exports (petroleum and other liquids, %)',
                    },
                    grid: {
                        color: '#D1D5DB',
                    },
                },
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const value = context.parsed.y;
                            if (value == null) return `${context.dataset.label}: N/A`;
                            return `${context.dataset.label}: ${Number(value).toFixed(2)}% of world petroleum and other liquids net exports`;
                        },
                    },
                },
            },
        },
    });

    const title = document.getElementById('oilTopExportersTitle');
    if (title) {
        const exportersLabel = exporters.map(item => item.name || item.code).join(', ');
        const variant = payload?.variant ? ` [${payload.variant}]` : '';
        title.textContent = `Top ${exporters.length} net exporters in petroleum and other liquids (${payload?.selection_year || 'N/A'} ranking): ${exportersLabel}${variant}`;
    }
}

function renderFertilizerExportsDualChart(payload) {
    const canvas = document.getElementById('fertilizerExportsDualChart');
    if (!canvas) return;

    const sourcePoints = Array.isArray(payload?.points) ? payload.points : [];
    const points = sourcePoints.filter(point => Number(point?.year) <= 2024);
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No fertilizer exports share data available.');
    }

    const labels = points.map(point => String(point.year || ''));
    const colorByCode = {
        SAU: '#B45309',
        QAT: '#7C3AED',
        RUS: '#1D4ED8',
        CHN: '#DC2626',
        MAR: '#059669',
        CAN: '#111827',
        USA: '#0F766E',
    };

    const datasets = countries.map(country => {
        const code = String(country?.code || '').toUpperCase();
        const color = colorByCode[code] || '#334155';
        return {
            label: country?.name || code || 'Country',
            data: points.map(point => {
                const value = point?.[country?.series_key];
                return value == null ? null : Number(value);
            }),
            borderColor: color,
            backgroundColor: `${color}22`,
            borderWidth: 2,
            pointRadius: 1.5,
            tension: 0.2,
            spanGaps: true,
            fill: false,
        };
    });

    if (fertilizerExportsDualChart) {
        fertilizerExportsDualChart.destroy();
    }

    fertilizerExportsDualChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Year',
                    },
                    grid: {
                        display: false,
                    },
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: payload?.metric === 'share_of_world_trade_balance_pct'
                            ? 'Share of world fertilizer trade balance (%)'
                            : 'Share of world fertilizer exports (%)',
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`,
                    },
                    grid: {
                        color: '#D1D5DB',
                    },
                },
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const value = context.parsed.y;
                            if (value == null) return `${context.dataset.label}: N/A`;
                            return `${context.dataset.label}: ${Number(value).toFixed(2)}%`;
                        },
                    },
                },
            },
        },
    });

    const title = document.getElementById('fertilizerExportsDualTitle');
    if (title) {
        const metricLabel = payload?.metric === 'share_of_world_trade_balance_pct'
            ? 'share of world fertilizer trade balance'
            : 'share of world fertilizer exports';
        const countryLabel = countries
            .map(country => country?.name || country?.code)
            .filter(Boolean)
            .join(', ');
        const startYear = points[0]?.year ?? payload?.start_year ?? 'N/A';
        const endYear = points[points.length - 1]?.year ?? payload?.end_year ?? 'N/A';
        title.textContent = `${countryLabel} — ${metricLabel} (${startYear} → ${endYear})`;
    }
}

function renderFertilizerImportsDualChart(payload) {
    const canvas = document.getElementById('fertilizerImportsDualChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No fertilizer imports share data available.');
    }

    const labels = points.map(point => String(point.year || ''));
    const palette = ['#B45309', '#7C3AED', '#1D4ED8', '#DC2626', '#059669', '#111827', '#0F766E', '#334155'];

    const datasets = countries.map((country, index) => {
        const color = palette[index % palette.length];
        return {
            label: country?.name || country?.code || `Importer ${index + 1}`,
            data: points.map(point => {
                const value = point?.[country?.series_key];
                return value == null ? null : Number(value);
            }),
            borderColor: color,
            backgroundColor: `${color}22`,
            borderWidth: 2,
            pointRadius: 1.5,
            tension: 0.2,
            spanGaps: true,
            fill: false,
        };
    });

    if (fertilizerImportsDualChart) {
        fertilizerImportsDualChart.destroy();
    }

    fertilizerImportsDualChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Year',
                    },
                    grid: {
                        display: false,
                    },
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Share of world fertilizer imports (%)',
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`,
                    },
                    grid: {
                        color: '#D1D5DB',
                    },
                },
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const value = context.parsed.y;
                            if (value == null) return `${context.dataset.label}: N/A`;
                            return `${context.dataset.label}: ${Number(value).toFixed(2)}%`;
                        },
                    },
                },
            },
        },
    });

    const title = document.getElementById('fertilizerImportsDualTitle');
    if (title) {
        const countryLabel = countries
            .map(country => country?.name || country?.code)
            .filter(Boolean)
            .join(', ');
        title.textContent = `Top ${countries.length} fertilizer importers (${payload?.ranking_year || 'N/A'} ranking): ${countryLabel} (${payload?.start_year || 'N/A'} → ${payload?.end_year || 'N/A'})`;
    }
}

function renderFertilizerImportsMonthlyChart(payload) {
    const canvas = document.getElementById('fertilizerImportsMonthlyChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No fertilizer monthly imports value data available.');
    }

    const labels = points.map(point => String(point.period || ''));
    const palette = ['#B45309', '#7C3AED', '#1D4ED8', '#DC2626', '#059669', '#111827', '#0F766E', '#334155'];

    const datasets = countries.map((country, index) => {
        const color = palette[index % palette.length];
        return {
            label: country?.name || country?.code || `Importer ${index + 1}`,
            data: points.map(point => {
                const value = point?.[country?.series_key];
                return value == null ? null : Number(value);
            }),
            borderColor: color,
            backgroundColor: `${color}22`,
            borderWidth: 2,
            pointRadius: 1.5,
            tension: 0.2,
            spanGaps: true,
            fill: false,
        };
    });

    if (fertilizerImportsMonthlyChart) {
        fertilizerImportsMonthlyChart.destroy();
    }

    fertilizerImportsMonthlyChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Month',
                    },
                    grid: {
                        display: false,
                    },
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Fertilizer imports value (USD)',
                    },
                    ticks: {
                        callback: value => Number(value).toLocaleString(),
                    },
                    grid: {
                        color: '#D1D5DB',
                    },
                },
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const value = context.parsed.y;
                            if (value == null) return `${context.dataset.label}: N/A`;
                            return `${context.dataset.label}: ${Math.round(Number(value)).toLocaleString()} USD`;
                        },
                    },
                },
            },
        },
    });

    const title = document.getElementById('fertilizerImportsMonthlyTitle');
    if (title) {
        const names = countries.map(country => country?.name || country?.code).filter(Boolean).join(', ');
        title.textContent = `Top ${countries.length} monthly fertilizer importers by value (${payload?.start_period || 'N/A'} → ${payload?.end_period || 'N/A'}): ${names}`;
    }
}

async function fetchFertilizerExportsPayload(startYear = 2018) {
    const endpointCandidates = [
        '/api/fertilizer-exports-share-world',
        '/api/fertilizer-exports-share',
        '/api/fertilizer-exports-world-share',
    ];

    let lastError = null;
    for (const endpoint of endpointCandidates) {
        const url = `${API_BASE}${endpoint}?start_year=${encodeURIComponent(String(startYear))}`;
        try {
            const response = await fetch(url);
            if (response.ok) {
                return await response.json();
            }

            const err = await response.json().catch(() => ({}));
            const message = err?.error || `Fertilizer request failed (${response.status})`;

            if (response.status === 404) {
                lastError = new Error(`${message} on ${endpoint}`);
                continue;
            }

            throw new Error(message);
        } catch (error) {
            lastError = error;
        }
    }

    const onlyNotFound = lastError && /\(404\)/.test(String(lastError.message || ''));
    if (onlyNotFound) {
        try {
            return await fetchFertilizerExportsPayloadDirect(startYear);
        } catch (directError) {
            return await fetchFertilizerExportsPayloadFromLocalItcCsv(startYear, directError);
        }
    }

    throw lastError || new Error('Fertilizer endpoint unavailable');
}

function normalizeCsvHeader(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseCsvText(rawCsv) {
    const rows = String(rawCsv || '')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    const parsed = rows.map(line => line.split(',').map(item => item.trim().replace(/^"|"$/g, '')));
    if (parsed.length < 2) return [];
    return parsed;
}

function parseFlatYearlyItcCsv(table) {
    if (!table.length) return null;

    const header = table[0];
    const headerNorm = header.map(normalizeCsvHeader);
    const indexOf = (...candidates) => {
        for (const candidate of candidates) {
            const idx = headerNorm.indexOf(normalizeCsvHeader(candidate));
            if (idx >= 0) return idx;
        }
        return -1;
    };

    const yearIdx = indexOf('year');
    const worldIdx = indexOf('world_exports_usd', 'worldexportsusd', 'world');
    const sauIdx = indexOf('saudi_arabia_exports_usd', 'saudi_exports_usd', 'saudiarabiaexportsusd');
    const qatIdx = indexOf('qatar_exports_usd', 'qatarexportsusd');
    const rusIdx = indexOf('russia_exports_usd', 'russiaexportsusd');
    const chnIdx = indexOf('china_exports_usd', 'chinaexportsusd');
    const marIdx = indexOf('morocco_exports_usd', 'moroccoexportsusd');
    const canIdx = indexOf('canada_exports_usd', 'canadaexportsusd');
    const usaIdx = indexOf('united_states_exports_usd', 'unitedstatesexportsusd', 'us_exports_usd', 'usa_exports_usd');

    if ([yearIdx, worldIdx, sauIdx, qatIdx, rusIdx, marIdx, canIdx].some(idx => idx < 0)) {
        return null;
    }

    const points = [];
    for (let rowIndex = 1; rowIndex < table.length; rowIndex += 1) {
        const row = table[rowIndex];
        const year = Number(String(row[yearIdx] || '').replace(/[^0-9]/g, ''));
        const world = toFiniteNumber(row[worldIdx]);
        const sau = toFiniteNumber(row[sauIdx]);
        const qat = toFiniteNumber(row[qatIdx]);
        const rus = toFiniteNumber(row[rusIdx]);
        const chn = chnIdx >= 0 ? toFiniteNumber(row[chnIdx]) : null;
        const mar = toFiniteNumber(row[marIdx]);
        const can = toFiniteNumber(row[canIdx]);
        const usa = usaIdx >= 0 ? toFiniteNumber(row[usaIdx]) : null;

        if (!Number.isFinite(year)) continue;
        if (!Number.isFinite(world) || world <= 0) continue;

        points.push({
            year,
            world_exports_usd: world,
            saudi_arabia_usd: sau,
            qatar_usd: qat,
            russia_usd: rus,
            china_usd: chn,
            morocco_usd: mar,
            canada_usd: can,
            united_states_usd: usa,
            saudi_arabia_pct: Number.isFinite(sau) ? (sau / world) * 100 : null,
            qatar_pct: Number.isFinite(qat) ? (qat / world) * 100 : null,
            russia_pct: Number.isFinite(rus) ? (rus / world) * 100 : null,
            china_pct: Number.isFinite(chn) ? (chn / world) * 100 : null,
            morocco_pct: Number.isFinite(mar) ? (mar / world) * 100 : null,
            canada_pct: Number.isFinite(can) ? (can / world) * 100 : null,
            united_states_pct: Number.isFinite(usa) ? (usa / world) * 100 : null,
        });
    }

    points.sort((a, b) => a.year - b.year);
    return points.length ? points : null;
}

function parseTradeMapWideItcCsv(table) {
    if (!table.length) return null;

    const header = table[0];
    const yearColumns = [];
    for (let index = 0; index < header.length; index += 1) {
        const col = String(header[index] || '');
        const match = /exported\s*value\s*in\s*(\d{4})/i.exec(col);
        if (match) {
            yearColumns.push({ index, year: Number(match[1]) });
        }
    }
    if (!yearColumns.length) return null;

    const countryAliases = {
        world: ['world', 'worldtradeorganizationwtoaggregation'],
        saudi: ['saudiarabia', 'saudi arabia'],
        qatar: ['qatar'],
        russia: ['russianfederation', 'russia', 'russian federation'],
        china: ['china'],
        morocco: ['morocco'],
        canada: ['canada'],
        usa: ['unitedstatesofamerica', 'united states of america', 'unitedstates', 'usa', 'us'],
    };

    const normalizeName = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    const findRow = aliases => table.find((row, idx) => {
        if (idx === 0) return false;
        const name = normalizeName(row[1] || row[0] || '');
        return aliases.some(alias => name.includes(normalizeName(alias)));
    });

    const worldRow = findRow(countryAliases.world);
    const saudiRow = findRow(countryAliases.saudi);
    const qatarRow = findRow(countryAliases.qatar);
    const russiaRow = findRow(countryAliases.russia);
    const chinaRow = findRow(countryAliases.china);
    const moroccoRow = findRow(countryAliases.morocco);
    const canadaRow = findRow(countryAliases.canada);
    const usaRow = findRow(countryAliases.usa);

    if (!worldRow) return null;

    const points = [];
    for (const col of yearColumns) {
        const world = toFiniteNumber(worldRow[col.index]);
        if (!Number.isFinite(world) || world <= 0) continue;
        const sau = saudiRow ? toFiniteNumber(saudiRow[col.index]) : null;
        const qat = qatarRow ? toFiniteNumber(qatarRow[col.index]) : null;
        const rus = russiaRow ? toFiniteNumber(russiaRow[col.index]) : null;
        const chn = chinaRow ? toFiniteNumber(chinaRow[col.index]) : null;
        const mar = moroccoRow ? toFiniteNumber(moroccoRow[col.index]) : null;
        const can = canadaRow ? toFiniteNumber(canadaRow[col.index]) : null;
        const usa = usaRow ? toFiniteNumber(usaRow[col.index]) : null;

        points.push({
            year: col.year,
            world_exports_usd: world,
            saudi_arabia_usd: sau,
            qatar_usd: qat,
            russia_usd: rus,
            china_usd: chn,
            morocco_usd: mar,
            canada_usd: can,
            united_states_usd: usa,
            saudi_arabia_pct: Number.isFinite(sau) ? (sau / world) * 100 : null,
            qatar_pct: Number.isFinite(qat) ? (qat / world) * 100 : null,
            russia_pct: Number.isFinite(rus) ? (rus / world) * 100 : null,
            china_pct: Number.isFinite(chn) ? (chn / world) * 100 : null,
            morocco_pct: Number.isFinite(mar) ? (mar / world) * 100 : null,
            canada_pct: Number.isFinite(can) ? (can / world) * 100 : null,
            united_states_pct: Number.isFinite(usa) ? (usa / world) * 100 : null,
        });
    }

    points.sort((a, b) => a.year - b.year);
    return points.length ? points : null;
}

function buildFertilizerPayloadFromPoints(points) {
    return buildFertilizerPayloadFromPointsWithMeta(points, {
        source: 'ITC TradeMap CSV (local file fallback)',
        dataset: 'Product 31 Fertilisers',
        flow: 'Exports',
        partner: 'World',
        commodity_code: '31',
        commodity_label: 'Fertilizers',
    });
}

function buildFertilizerPayloadFromPointsWithMeta(points, meta = {}) {
    const countries = [
        { code: 'RUS', name: 'Russia', series_key: 'russia_pct' },
        { code: 'CHN', name: 'China', series_key: 'china_pct' },
        { code: 'CAN', name: 'Canada', series_key: 'canada_pct' },
        { code: 'MAR', name: 'Marocco', series_key: 'morocco_pct' },
        { code: 'USA', name: 'United States', series_key: 'united_states_pct' },
        { code: 'SAU', name: 'Saudi Arabia', series_key: 'saudi_arabia_pct' },
        { code: 'QAT', name: 'Qatar', series_key: 'qatar_pct' },
    ];

    return {
        source: meta.source || 'ITC TradeMap CSV (local file fallback)',
        dataset: meta.dataset || 'Product 31 Fertilisers',
        flow: meta.flow || 'Exports',
        partner: meta.partner || 'World',
        commodity_code: meta.commodity_code || '31',
        commodity_label: meta.commodity_label || 'Fertilizers',
        metric: meta.metric || 'share_of_world_exports_pct',
        start_year: points[0]?.year ?? null,
        end_year: points[points.length - 1]?.year ?? null,
        countries,
        points,
    };
}

function buildBundledFertilizerFallbackPayload(startYear = 2018) {
    const rawPoints = [
        {
            year: 2021,
            world_exports_usd: 80491667,
            saudi_arabia_usd: 3593467,
            qatar_usd: 2409973,
            russia_usd: 12494548,
            china_usd: 11472060,
            morocco_usd: 5714861,
            canada_usd: 6606567,
            united_states_usd: 4621063,
        },
        {
            year: 2022,
            world_exports_usd: 124804688,
            saudi_arabia_usd: 7318212,
            qatar_usd: 3576787,
            russia_usd: 20988390,
            china_usd: 11380037,
            morocco_usd: 7715003,
            canada_usd: 13728655,
            united_states_usd: 8472033,
        },
        {
            year: 2023,
            world_exports_usd: 85303845,
            saudi_arabia_usd: 4735640,
            qatar_usd: 1848849,
            russia_usd: 15309326,
            china_usd: 9711197,
            morocco_usd: 5460994,
            canada_usd: 9551446,
            united_states_usd: 5483859,
        },
        {
            year: 2024,
            world_exports_usd: 82290767,
            saudi_arabia_usd: 4972945,
            qatar_usd: 1845703,
            russia_usd: 15334458,
            china_usd: 8498739,
            morocco_usd: 6362517,
            canada_usd: 6680193,
            united_states_usd: 5172314,
        },
        {
            year: 2025,
            world_exports_usd: 33585772,
            saudi_arabia_usd: null,
            qatar_usd: null,
            russia_usd: null,
            china_usd: 13487839,
            morocco_usd: null,
            canada_usd: 7339191,
            united_states_usd: 5046169,
        },
    ];

    const points = rawPoints
        .filter(point => Number(point.year) >= Number(startYear))
        .map(point => {
            const world = Number(point.world_exports_usd);
            const withPct = { ...point };
            withPct.saudi_arabia_pct = Number.isFinite(point.saudi_arabia_usd) && Number.isFinite(world) && world !== 0
                ? (Number(point.saudi_arabia_usd) / world) * 100
                : null;
            withPct.qatar_pct = Number.isFinite(point.qatar_usd) && Number.isFinite(world) && world !== 0
                ? (Number(point.qatar_usd) / world) * 100
                : null;
            withPct.russia_pct = Number.isFinite(point.russia_usd) && Number.isFinite(world) && world !== 0
                ? (Number(point.russia_usd) / world) * 100
                : null;
            withPct.china_pct = Number.isFinite(point.china_usd) && Number.isFinite(world) && world !== 0
                ? (Number(point.china_usd) / world) * 100
                : null;
            withPct.morocco_pct = Number.isFinite(point.morocco_usd) && Number.isFinite(world) && world !== 0
                ? (Number(point.morocco_usd) / world) * 100
                : null;
            withPct.canada_pct = Number.isFinite(point.canada_usd) && Number.isFinite(world) && world !== 0
                ? (Number(point.canada_usd) / world) * 100
                : null;
            withPct.united_states_pct = Number.isFinite(point.united_states_usd) && Number.isFinite(world) && world !== 0
                ? (Number(point.united_states_usd) / world) * 100
                : null;
            return withPct;
        });

    if (!points.length) return null;

    return buildFertilizerPayloadFromPointsWithMeta(points, {
        source: 'ITC TradeMap HTML export (bundled fallback snapshot)',
        dataset: 'Product 31 Fertilisers',
        flow: 'Exports',
        partner: 'World',
        commodity_code: '31',
        commodity_label: 'Fertilizers',
        metric: 'share_of_world_exports_pct',
    });
}

function decodeHtmlEntities(value) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = String(value || '');
    return textarea.value;
}

function parseTradeMapHtmlTable(rawHtml) {
    const htmlText = String(rawHtml || '');
    const tableMatch = htmlText.match(/<table[^>]*>[\s\S]*?(?:Balance in value in|Exported value in)[\s\S]*?<\/table>/i);
    if (!tableMatch) return [];

    const table = tableMatch[0];
    const rowMatches = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const rows = rowMatches.map(rowHtml => {
        const cellMatches = rowHtml.match(/<(?:td|th)[^>]*>[\s\S]*?<\/(?:td|th)>/gi) || [];
        return cellMatches.map(cellHtml => {
            const text = cellHtml
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            return decodeHtmlEntities(text).replace(/\u00A0/g, ' ').trim();
        });
    }).filter(row => row.length > 0);

    return rows;
}

function pickBestWorldRow(table, partnerIdx, yearColumns) {
    const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const preferred = ['worldtradeorganizationwtoaggregation', 'world'];

    let bestRow = null;
    let bestScore = -1;
    for (let rowIndex = 1; rowIndex < table.length; rowIndex += 1) {
        const row = table[rowIndex];
        const name = normalize(row[partnerIdx] || row[0] || '');
        if (!preferred.some(alias => name.includes(alias))) continue;

        const values = yearColumns
            .map(col => toFiniteNumber(row[col.index]))
            .filter(value => Number.isFinite(value) && value !== 0);

        const score = values.length * 10 + (preferred[0] && name.includes(preferred[0]) ? 1 : 0);
        if (score > bestScore) {
            bestScore = score;
            bestRow = row;
        }
    }

    return bestRow;
}

function parseTradeMapHtmlItcText(rawHtml) {
    const table = parseTradeMapHtmlTable(rawHtml);
    if (!table.length) return null;

    const header = table.find(row => row.some(cell => /partners/i.test(cell)));
    if (!header) return null;

    const partnerIdx = header.findIndex(cell => /partners/i.test(cell));
    if (partnerIdx < 0) return null;

    const balanceColumns = [];
    const exportColumns = [];
    for (let index = 0; index < header.length; index += 1) {
        const col = String(header[index] || '');
        let match = col.match(/balance\s*in\s*value\s*in\s*(\d{4})/i);
        if (match) {
            balanceColumns.push({ index, year: Number(match[1]) });
            continue;
        }
        match = col.match(/exported\s*value\s*in\s*(\d{4})/i);
        if (match) {
            exportColumns.push({ index, year: Number(match[1]) });
        }
    }

    const yearColumns = exportColumns.length ? exportColumns : balanceColumns;
    if (!yearColumns.length) return null;

    const normalizeName = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    const findRow = aliases => table.find((row, idx) => {
        if (idx === 0) return false;
        const name = normalizeName(row[partnerIdx] || row[0] || '');
        return aliases.some(alias => name.includes(normalizeName(alias)));
    });

    const worldRow = pickBestWorldRow(table, partnerIdx, yearColumns);
    const saudiRow = findRow(['saudi arabia']);
    const qatarRow = findRow(['qatar']);
    const russiaRow = findRow(['russian federation', 'russia']);
    const chinaRow = findRow(['china']);
    const moroccoRow = findRow(['morocco']);
    const canadaRow = findRow(['canada']);
    const usaRow = findRow(['united states of america', 'united states', 'usa']);

    if (!worldRow) return null;

    const points = [];
    for (const col of yearColumns) {
        const world = toFiniteNumber(worldRow[col.index]);
        if (!Number.isFinite(world) || world === 0) continue;

        const sau = saudiRow ? toFiniteNumber(saudiRow[col.index]) : null;
        const qat = qatarRow ? toFiniteNumber(qatarRow[col.index]) : null;
        const rus = russiaRow ? toFiniteNumber(russiaRow[col.index]) : null;
        const chn = chinaRow ? toFiniteNumber(chinaRow[col.index]) : null;
        const mar = moroccoRow ? toFiniteNumber(moroccoRow[col.index]) : null;
        const can = canadaRow ? toFiniteNumber(canadaRow[col.index]) : null;
        const usa = usaRow ? toFiniteNumber(usaRow[col.index]) : null;

        points.push({
            year: col.year,
            world_exports_usd: world,
            saudi_arabia_usd: sau,
            qatar_usd: qat,
            russia_usd: rus,
            china_usd: chn,
            morocco_usd: mar,
            canada_usd: can,
            united_states_usd: usa,
            saudi_arabia_pct: Number.isFinite(sau) ? (sau / world) * 100 : null,
            qatar_pct: Number.isFinite(qat) ? (qat / world) * 100 : null,
            russia_pct: Number.isFinite(rus) ? (rus / world) * 100 : null,
            china_pct: Number.isFinite(chn) ? (chn / world) * 100 : null,
            morocco_pct: Number.isFinite(mar) ? (mar / world) * 100 : null,
            canada_pct: Number.isFinite(can) ? (can / world) * 100 : null,
            united_states_pct: Number.isFinite(usa) ? (usa / world) * 100 : null,
        });
    }

    points.sort((a, b) => a.year - b.year);
    if (!points.length) return null;

    const metric = exportColumns.length ? 'share_of_world_exports_pct' : 'share_of_world_trade_balance_pct';
    return buildFertilizerPayloadFromPointsWithMeta(points, {
        source: 'ITC TradeMap HTML export (local file fallback)',
        dataset: 'Product 31 Fertilisers',
        flow: exportColumns.length ? 'Exports' : 'Trade balance',
        partner: 'World',
        commodity_code: '31',
        commodity_label: 'Fertilizers',
        metric,
    });
}

function toSeriesToken(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function parseTradeMapImportersMonthlyValueHtml(rawHtml, topN = 6) {
    const htmlText = String(rawHtml || '');
    const tableMatches = [...htmlText.matchAll(/<table[^>]*>[\s\S]*?<\/table>/gi)].map(match => match[0]);
    const targetTable = tableMatches.find(tableHtml => /importers/i.test(tableHtml) && /imported\s*value\s*in\s*\d{4}-M\d{2}/i.test(tableHtml));
    if (!targetTable) return null;

    const rowMatches = targetTable.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const table = rowMatches.map(rowHtml => {
        const cellMatches = rowHtml.match(/<(?:td|th)[^>]*>[\s\S]*?<\/(?:td|th)>/gi) || [];
        return cellMatches.map(cellHtml => {
            const text = cellHtml
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            return decodeHtmlEntities(text).replace(/\u00A0/g, ' ').trim();
        });
    }).filter(row => row.length > 0);

    if (!table.length) return null;

    const header = table.find(row => row.some(cell => /importers/i.test(cell)));
    if (!header) return null;

    const importerIdx = header.findIndex(cell => /importers/i.test(cell));
    if (importerIdx < 0) return null;

    const monthlyColumns = [];
    for (let index = 0; index < header.length; index += 1) {
        const col = String(header[index] || '');
        const match = col.match(/imported\s*value\s*in\s*(\d{4}-M\d{2})/i);
        if (match) {
            monthlyColumns.push({ index, period: match[1] });
        }
    }
    if (!monthlyColumns.length) return null;

    const normalizeName = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const isWorldLike = value => {
        const name = normalizeName(value);
        return name.includes('world') || name.includes('wtoaggregation');
    };

    const countryRows = [];
    for (let rowIndex = 1; rowIndex < table.length; rowIndex += 1) {
        const row = table[rowIndex];
        const name = String(row[importerIdx] || row[0] || '').trim();
        if (!name || isWorldLike(name)) continue;

        const values = monthlyColumns.map(col => toFiniteNumber(row[col.index]));
        const totalValue = values
            .filter(value => Number.isFinite(value))
            .reduce((sum, value) => sum + Number(value), 0);

        if (totalValue <= 0) continue;
        countryRows.push({ name, row, totalValue });
    }

    if (!countryRows.length) return null;

    countryRows.sort((a, b) => b.totalValue - a.totalValue);
    const selected = countryRows.slice(0, Math.max(1, Number(topN) || 6));

    const countries = selected.map((entry, index) => ({
        code: `MIMP${index + 1}`,
        name: entry.name,
        series_key: `monthly_importer_${index + 1}_${toSeriesToken(entry.name)}_value`,
        total_value_usd: entry.totalValue,
    }));

    const points = monthlyColumns.map(col => {
        const point = { period: col.period };
        countries.forEach((country, idx) => {
            const selectedRow = selected[idx].row;
            point[country.series_key] = toFiniteNumber(selectedRow[col.index]);
        });
        return point;
    });

    if (!points.length) return null;

    return {
        source: 'ITC TradeMap monthly importers export (local file fallback)',
        dataset: 'Product 31 Fertilisers',
        flow: 'Imports',
        metric: 'monthly_import_value_usd',
        top_n: countries.length,
        start_period: points[0].period,
        end_period: points[points.length - 1].period,
        countries,
        points,
    };
}

function parseTradeMapImportersHtmlItcText(rawHtml, startYear = 2018, topN = 6) {
    const htmlText = String(rawHtml || '');
    const tableMatches = [...htmlText.matchAll(/<table[^>]*>[\s\S]*?<\/table>/gi)].map(match => match[0]);
    const targetTable = tableMatches.find(tableHtml => /importers/i.test(tableHtml) && /imported\s*value\s*in/i.test(tableHtml));
    if (!targetTable) return null;

    const rowMatches = targetTable.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const table = rowMatches.map(rowHtml => {
        const cellMatches = rowHtml.match(/<(?:td|th)[^>]*>[\s\S]*?<\/(?:td|th)>/gi) || [];
        return cellMatches.map(cellHtml => {
            const text = cellHtml
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            return decodeHtmlEntities(text).replace(/\u00A0/g, ' ').trim();
        });
    }).filter(row => row.length > 0);

    if (!table.length) return null;

    const header = table.find(row => row.some(cell => /importers/i.test(cell)));
    if (!header) return null;

    const importerIdx = header.findIndex(cell => /importers/i.test(cell));
    if (importerIdx < 0) return null;

    const yearColumns = [];
    for (let index = 0; index < header.length; index += 1) {
        const col = String(header[index] || '');
        const match = col.match(/imported\s*value\s*in\s*(\d{4})/i);
        if (!match) continue;
        const year = Number(match[1]);
        if (Number.isFinite(year) && year >= Number(startYear) && year <= 2024) {
            yearColumns.push({ index, year });
        }
    }
    if (!yearColumns.length) return null;

    const rankingYear = Math.max(...yearColumns.map(col => col.year));
    const rankingColumn = yearColumns.find(col => col.year === rankingYear);
    if (!rankingColumn) return null;

    const worldRow = pickBestWorldRow(table, importerIdx, yearColumns);
    const worldByYear = new Map();
    for (const col of yearColumns) {
        const worldValue = worldRow ? toFiniteNumber(worldRow[col.index]) : null;
        if (Number.isFinite(worldValue) && worldValue > 0) {
            worldByYear.set(col.year, worldValue);
        }
    }
    if (!worldByYear.size) return null;

    const normalizeName = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const isWorldLike = value => {
        const name = normalizeName(value);
        return name.includes('world') || name.includes('wtoaggregation');
    };

    const countryRows = [];
    for (let rowIndex = 1; rowIndex < table.length; rowIndex += 1) {
        const row = table[rowIndex];
        const name = String(row[importerIdx] || row[0] || '').trim();
        if (!name || isWorldLike(name)) continue;
        const rankingValue = toFiniteNumber(row[rankingColumn.index]);
        if (!Number.isFinite(rankingValue) || rankingValue <= 0) continue;
        countryRows.push({ name, row, rankingValue });
    }

    if (!countryRows.length) return null;

    countryRows.sort((a, b) => b.rankingValue - a.rankingValue);
    const selected = countryRows.slice(0, Math.max(1, Number(topN) || 6));
    const countries = selected.map((entry, index) => ({
        code: `IMP${index + 1}`,
        name: entry.name,
        value_key: `importer_${index + 1}_${toSeriesToken(entry.name)}_usd`,
        series_key: `importer_${index + 1}_${toSeriesToken(entry.name)}_pct`,
        ranking_value_usd: entry.rankingValue,
    }));

    const points = [];
    for (const col of yearColumns) {
        const world = worldByYear.get(col.year);
        if (!Number.isFinite(world) || world <= 0) continue;

        const point = {
            year: col.year,
            world_imports_usd: world,
        };

        countries.forEach((country, idx) => {
            const selectedRow = selected[idx].row;
            const value = toFiniteNumber(selectedRow[col.index]);
            point[country.value_key] = value;
            point[country.series_key] = Number.isFinite(value) ? (value / world) * 100 : null;
        });

        points.push(point);
    }

    points.sort((a, b) => a.year - b.year);
    if (!points.length) return null;

    return {
        source: 'ITC TradeMap HTML importers export (local file fallback)',
        dataset: 'Product 31 Fertilisers',
        flow: 'Imports',
        partner: 'World',
        commodity_code: '31',
        commodity_label: 'Fertilizers',
        metric: 'share_of_world_imports_pct',
        ranking_year: rankingYear,
        start_year: points[0].year,
        end_year: points[points.length - 1].year,
        countries,
        points,
    };
}

async function fetchFertilizerImportsPayloadFromLocalItcHtml(startYear = 2018, topN = 6) {
    const htmlFileCandidates = [
        'Trade_Map_-_List_of_importers_for_the_selected_product_(Fertilisers).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_(Fertilizers).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_(Fertilisers).xlsx',
        'Trade_Map_-_List_of_importers_for_the_selected_product_(Fertilizers).xlsx',
        'Trade_Map_-_List_of_importers_for_the_selected_product_(Fertilisers)',
        'Trade_Map_-_List_of_importers_for_the_selected_product_(Fertilizers)',
    ];

    let lastError = null;
    for (const fileName of htmlFileCandidates) {
        try {
            const response = await fetch(fileName, { cache: 'no-store' });
            if (!response.ok) {
                lastError = new Error(`Local ITC importers export not found: ${fileName}`);
                continue;
            }

            const htmlText = await response.text();
            const payload = parseTradeMapImportersHtmlItcText(htmlText, startYear, topN);
            if (!payload || !Array.isArray(payload.points) || !payload.points.length) {
                lastError = new Error(`Could not parse ITC importers values from ${fileName}`);
                continue;
            }

            return payload;
        } catch (error) {
            lastError = error;
        }
    }

    const bundledFallback = buildBundledFertilizerImportsFallbackPayload(startYear, topN);
    if (bundledFallback) {
        return bundledFallback;
    }

    throw lastError || new Error('No usable ITC importers data source available');
}

function buildBundledFertilizerImportsFallbackPayload(startYear = 2018, topN = 6) {
    const rawPoints = [
        {
            year: 2021,
            world_imports_usd: 96437127,
            brazil_usd: 15164542,
            united_states_of_america_usd: 10291043,
            india_usd: 9116775,
            china_usd: 2765253,
            australia_usd: 2489351,
            france_usd: 2802583,
        },
        {
            year: 2022,
            world_imports_usd: 149664607,
            brazil_usd: 24785390,
            united_states_of_america_usd: 13248147,
            india_usd: 17259772,
            china_usd: 4954092,
            australia_usd: 3988681,
            france_usd: 4794018,
        },
        {
            year: 2023,
            world_imports_usd: 99803763,
            brazil_usd: 14642673,
            united_states_of_america_usd: 9816857,
            india_usd: 10424677,
            china_usd: 5614328,
            australia_usd: 2388667,
            france_usd: 2851473,
        },
        {
            year: 2024,
            world_imports_usd: 94237024,
            brazil_usd: 13581411,
            united_states_of_america_usd: 9371797,
            india_usd: 7829707,
            china_usd: 4615419,
            australia_usd: 3084717,
            france_usd: 2619525,
        },
    ];

    const countryDefs = [
        { name: 'Brazil', key: 'brazil_usd' },
        { name: 'United States of America', key: 'united_states_of_america_usd' },
        { name: 'India', key: 'india_usd' },
        { name: 'China', key: 'china_usd' },
        { name: 'Australia', key: 'australia_usd' },
        { name: 'France', key: 'france_usd' },
    ].slice(0, Math.max(1, Number(topN) || 6));

    const countries = countryDefs.map((country, index) => {
        const token = toSeriesToken(country.name);
        return {
            code: `IMP${index + 1}`,
            name: country.name,
            value_key: `importer_${index + 1}_${token}_usd`,
            series_key: `importer_${index + 1}_${token}_pct`,
        };
    });

    const points = rawPoints
        .filter(point => Number(point.year) >= Number(startYear) && Number(point.year) <= 2024)
        .map(point => {
            const world = Number(point.world_imports_usd);
            const out = {
                year: point.year,
                world_imports_usd: world,
            };

            countries.forEach((country, index) => {
                const sourceKey = countryDefs[index].key;
                const value = Number(point[sourceKey]);
                out[country.value_key] = Number.isFinite(value) ? value : null;
                out[country.series_key] = Number.isFinite(value) && Number.isFinite(world) && world > 0
                    ? (value / world) * 100
                    : null;
            });

            return out;
        });

    if (!points.length || !countries.length) return null;

    return {
        source: 'ITC TradeMap importers export (bundled fallback snapshot)',
        dataset: 'Product 31 Fertilisers',
        flow: 'Imports',
        partner: 'World',
        commodity_code: '31',
        commodity_label: 'Fertilizers',
        metric: 'share_of_world_imports_pct',
        ranking_year: 2024,
        start_year: points[0].year,
        end_year: points[points.length - 1].year,
        countries,
        points,
    };
}

function buildBundledFertilizerImportsMonthlyFallbackPayload(topN = 6) {
    const periods = [
        '2024-M05', '2024-M06', '2024-M07', '2024-M08', '2024-M09', '2024-M10', '2024-M11', '2024-M12',
        '2025-M01', '2025-M02', '2025-M03', '2025-M04', '2025-M05', '2025-M06', '2025-M07', '2025-M08',
        '2025-M09', '2025-M10', '2025-M11', '2025-M12',
    ];

    const countrySeries = [
        {
            name: 'Brazil',
            values: [997887, 1305688, 1429357, 1551102, 1499006, 1508960, 1246286, 963817, 929573, 726144, 813452, 1234837, 1260568, 1453187, 1739619, 1868633, 1553324, 1613263, 1093106, 1208202],
        },
        {
            name: 'India',
            values: [757709, 617958, 503068, 383705, 622812, 1051770, 1232769, 1060981, 667854, 450255, 509122, 544705, 523911, 661652, 1430074, 1495242, 2182879, 2303677, null, null],
        },
        {
            name: 'United States of America',
            values: [749839, 744432, 559256, 623250, 624234, 782764, 527335, 703418, 844108, 906790, 1094906, 1066498, 775783, 514334, 618621, 724266, 614440, 648504, 630286, 557246],
        },
        {
            name: 'China',
            values: [386411, 324903, 294793, 335761, 389862, 343720, 349489, 441597, 407037, 377867, 398821, 391115, 368151, 261467, 249859, 322113, 474735, 511319, 537077, 577892],
        },
        {
            name: 'France',
            values: [136357, 205446, 257800, 221356, 231820, 243611, 244327, 204440, 181882, 196358, 263118, 169153, 197096, 244900, 297038, 278496, 281094, 368301, 352304, 430581],
        },
        {
            name: 'Australia',
            values: [281705, 275313, 219033, 207232, 101143, 158027, 122223, 291131, 325790, 380430, 380392, 410206, 283779, 233718, 281297, 177595, 123184, 128064, 280260, 282975],
        },
    ].slice(0, Math.max(1, Number(topN) || 6));

    const countries = countrySeries.map((country, index) => ({
        code: `MIMP${index + 1}`,
        name: country.name,
        series_key: `monthly_importer_${index + 1}_${toSeriesToken(country.name)}_value`,
    }));

    const points = periods.map((period, periodIndex) => {
        const point = { period };
        countries.forEach((country, countryIndex) => {
            point[country.series_key] = countrySeries[countryIndex].values[periodIndex];
        });
        return point;
    });

    return {
        source: 'ITC TradeMap monthly importers export (bundled fallback snapshot)',
        dataset: 'Product 31 Fertilisers',
        flow: 'Imports',
        metric: 'monthly_import_value_usd',
        top_n: countries.length,
        start_period: points[0]?.period ?? null,
        end_period: points[points.length - 1]?.period ?? null,
        countries,
        points,
    };
}

async function fetchFertilizerImportsMonthlyPayloadFromLocalItcHtml(topN = 6) {
    const htmlFileCandidates = [
        'Trade_Map_-_List_of_importers_for_the_selected_product_.xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_.xlsx',
        'Trade_Map_-_List_of_importers_for_the_selected_product_',
        'Trade_Map_-_List_of_importers_for_the_selected_product_(Fertilisers).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_(Fertilizers).xls',
    ];

    let lastError = null;
    for (const fileName of htmlFileCandidates) {
        try {
            const response = await fetch(fileName, { cache: 'no-store' });
            if (!response.ok) {
                lastError = new Error(`Local ITC monthly importers export not found: ${fileName}`);
                continue;
            }

            const htmlText = await response.text();
            const payload = parseTradeMapImportersMonthlyValueHtml(htmlText, topN);
            if (!payload || !Array.isArray(payload.points) || !payload.points.length) {
                lastError = new Error(`Could not parse ITC monthly importers values from ${fileName}`);
                continue;
            }

            return payload;
        } catch (error) {
            lastError = error;
        }
    }

    const bundledFallback = buildBundledFertilizerImportsMonthlyFallbackPayload(topN);
    if (bundledFallback) return bundledFallback;

    throw lastError || new Error('No usable ITC monthly importers data source available');
}

async function fetchFertilizerExportsPayloadFromLocalItcCsv(startYear = 2018, priorError = null) {
    const fileCandidates = ['itc_fertilizer_exports.csv', 'itc_fertiliser_exports.csv'];
    let lastFileError = priorError;

    for (const fileName of fileCandidates) {
        try {
            const response = await fetch(fileName, { cache: 'no-store' });
            if (!response.ok) {
                lastFileError = new Error(`Local ITC file not found: ${fileName}`);
                continue;
            }
            const csvText = await response.text();
            const table = parseCsvText(csvText);
            if (!table.length) {
                lastFileError = new Error(`Local ITC file is empty: ${fileName}`);
                continue;
            }

            const points = parseFlatYearlyItcCsv(table) || parseTradeMapWideItcCsv(table);
            if (!points || !points.length) {
                lastFileError = new Error(`Could not parse ITC export values from ${fileName}`);
                continue;
            }

            const filtered = points.filter(point => Number(point.year) >= Number(startYear));
            if (!filtered.length) {
                lastFileError = new Error(`ITC file ${fileName} has no data from ${startYear} onward`);
                continue;
            }

            return buildFertilizerPayloadFromPoints(filtered);
        } catch (error) {
            lastFileError = error;
        }
    }

    const htmlFileCandidates = [
        'Trade_Map_-_List_of_exporters_for_the_selected_product_(Fertilisers).xls',
        'Trade_Map_-_List_of_exporters_for_the_selected_product_(Fertilizers).xls',
        'Trade_Map_-_List_of_exporters_for_the_selected_product_(Fertilisers).xlsx',
        'Trade_Map_-_List_of_exporters_for_the_selected_product_(Fertilizers).xlsx',
        'Trade_Map_-_List_of_exporters_for_the_selected_product_(Fertilisers)',
        'Trade_Map_-_List_of_exporters_for_the_selected_product_(Fertilizers)',
        'Trade_Map_-_List_of_markets_for_the_selected_product_(Fertilisers).xls',
        'Trade_Map_-_List_of_markets_for_the_selected_product_(Fertilizers).xls',
    ];

    for (const fileName of htmlFileCandidates) {
        try {
            const response = await fetch(fileName, { cache: 'no-store' });
            if (!response.ok) {
                lastFileError = new Error(`Local ITC HTML export not found: ${fileName}`);
                continue;
            }

            const htmlText = await response.text();
            const payload = parseTradeMapHtmlItcText(htmlText);
            if (!payload || !Array.isArray(payload.points) || !payload.points.length) {
                lastFileError = new Error(`Could not parse ITC HTML export values from ${fileName}`);
                continue;
            }

            const filteredPoints = payload.points.filter(point => Number(point.year) >= Number(startYear));
            if (!filteredPoints.length) {
                lastFileError = new Error(`ITC HTML export ${fileName} has no data from ${startYear} onward`);
                continue;
            }

            return {
                ...payload,
                start_year: filteredPoints[0].year,
                end_year: filteredPoints[filteredPoints.length - 1].year,
                points: filteredPoints,
            };
        } catch (error) {
            lastFileError = error;
        }
    }

    const bundledFallbackPayload = buildBundledFertilizerFallbackPayload(startYear);
    if (bundledFallbackPayload) {
        return bundledFallbackPayload;
    }

    const priorMessage = priorError && priorError.message ? `; prior source error: ${priorError.message}` : '';
    throw new Error(`No usable ITC data source available (backend, direct, local files, or bundled fallback)${priorMessage}`);
}

function extractComtradeRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    const keys = ['data', 'dataset', 'results', 'list', 'items'];
    for (const key of keys) {
        if (Array.isArray(payload[key])) return payload[key];
        if (payload[key] && typeof payload[key] === 'object') {
            for (const nestedKey of keys) {
                if (Array.isArray(payload[key][nestedKey])) return payload[key][nestedKey];
            }
        }
    }
    return [];
}

function toFiniteNumber(value) {
    if (value == null) return null;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    const raw = String(value).trim();
    if (!raw || raw === '.') return null;

    const normalized = raw
        .replace(/\s+/g, '')
        .replace(/,/g, '')
        .replace(/\u00A0/g, '');

    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
}

function extractComtradeValue(row) {
    if (!row || typeof row !== 'object') return null;
    const keys = [
        'primaryValue', 'tradeValue', 'TradeValue', 'value',
        'fobvalue', 'fobValue', 'FOBValue',
        'cifvalue', 'cifValue', 'CIFValue',
        'netWgt', 'netWeight',
    ];
    for (const key of keys) {
        const numeric = toFiniteNumber(row[key]);
        if (numeric != null) return numeric;
    }
    return null;
}

async function fetchComtradeHsExportsValue(year, reporterCode) {
    const baseUrl = 'https://comtradeapi.worldbank.org/data/v1/get/C/A/HS';
    const url = new URL(baseUrl);
    url.searchParams.set('reporterCode', String(reporterCode));
    url.searchParams.set('partnerCode', '0');
    url.searchParams.set('flowCode', 'X');
    url.searchParams.set('cmdCode', '31');
    url.searchParams.set('period', String(year));
    url.searchParams.set('format', 'json');

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error(`Comtrade request failed (${response.status}) for reporter ${reporterCode}, year ${year}`);
    }

    const payload = await response.json().catch(() => ({}));
    const rows = extractComtradeRows(payload);
    if (!rows.length) return null;

    let total = 0;
    let hasValue = false;
    for (const row of rows) {
        const value = extractComtradeValue(row);
        if (value == null) continue;
        total += value;
        hasValue = true;
    }
    return hasValue ? total : null;
}

async function fetchFertilizerExportsPayloadDirect(startYear = 2018) {
    const currentYear = new Date().getUTCFullYear();
    const endYear = Math.max(startYear, currentYear - 1);

    const countries = [
        { code: 'RUS', name: 'Russia', reporter_code: '643', series_key: 'russia_pct' },
        { code: 'CHN', name: 'China', reporter_code: '156', series_key: 'china_pct' },
        { code: 'CAN', name: 'Canada', reporter_code: '124', series_key: 'canada_pct' },
        { code: 'MAR', name: 'Marocco', reporter_code: '504', series_key: 'morocco_pct' },
        { code: 'USA', name: 'United States', reporter_code: '842', series_key: 'united_states_pct' },
        { code: 'SAU', name: 'Saudi Arabia', reporter_code: '682', series_key: 'saudi_arabia_pct' },
        { code: 'QAT', name: 'Qatar', reporter_code: '634', series_key: 'qatar_pct' },
    ];

    const points = [];
    for (let year = Number(startYear); year <= endYear; year += 1) {
        const countryValues = await Promise.all(
            countries.map(async country => {
                try {
                    const value = await fetchComtradeHsExportsValue(year, country.reporter_code);
                    return [country.series_key.replace('_pct', '_usd'), value];
                } catch {
                    return [country.series_key.replace('_pct', '_usd'), null];
                }
            })
        );

        const countryValueMap = Object.fromEntries(countryValues);

        let worldValue = null;
        try {
            worldValue = await fetchComtradeHsExportsValue(year, 'all');
        } catch {
            try {
                worldValue = await fetchComtradeHsExportsValue(year, '0');
            } catch {
                worldValue = null;
            }
        }

        if (worldValue == null) {
            worldValue = Object.values(countryValueMap)
                .filter(value => Number.isFinite(value))
                .reduce((sum, value) => sum + Number(value), 0);
            if (worldValue <= 0) worldValue = null;
        }

        const point = {
            year,
            world_exports_usd: worldValue,
        };

        for (const country of countries) {
            const valueKey = country.series_key.replace('_pct', '_usd');
            const pctKey = country.series_key;
            const value = countryValueMap[valueKey];
            point[valueKey] = value;
            point[pctKey] = (Number.isFinite(value) && Number.isFinite(worldValue) && Number(worldValue) > 0)
                ? (Number(value) / Number(worldValue)) * 100
                : null;
        }

        if (countries.some(country => point[country.series_key] != null)) {
            points.push(point);
        }
    }

    if (!points.length) {
        throw new Error('Fertilizer request failed (404) and direct Comtrade fallback returned no usable data');
    }

    return {
        source: 'UN Comtrade API (direct fallback)',
        dataset: 'HS annual merchandise trade',
        flow: 'Exports',
        partner: 'World',
        commodity_code: '31',
        commodity_label: 'Fertilizers',
        start_year: points[0].year,
        end_year: points[points.length - 1].year,
        countries,
        points,
    };
}

function buildUsOecdSeries(rows, options = {}) {
    const totalOnly = Boolean(options.totalPetroleumOnly);
    const periodMap = new Map();
    let unitLabel = '';

    for (const row of rows) {
        const period = String(row?.period || '').trim();
        const code = String(row?.countryRegionId || '').trim().toUpperCase();
        const productId = String(row?.productId || '').trim();
        const productName = String(row?.productName || '').toLowerCase();
        const value = row?.value == null ? null : Number(row.value);
        if (!period || !Number.isFinite(value)) continue;
        if (code !== 'USA' && code !== 'OEEU') continue;

        if (totalOnly) {
            const matchesProductId = productId ? productId === '53' : true;
            const matchesProductName = productName ? productName.includes('total petroleum and other liquids') : true;
            if (!matchesProductId || !matchesProductName) continue;
        }

        if (!periodMap.has(period)) {
            periodMap.set(period, { usa: 0, oeeu: 0, hasUsa: false, hasOeeu: false });
        }
        const bucket = periodMap.get(period);
        if (code === 'USA') {
            bucket.usa = value;
            bucket.hasUsa = true;
        }
        if (code === 'OEEU') {
            bucket.oeeu = value;
            bucket.hasOeeu = true;
        }
        if (!unitLabel && row?.unit) unitLabel = String(row.unit);
    }

    const labels = Array.from(periodMap.keys()).sort();
    const usaSeries = labels.map(period => {
        const bucket = periodMap.get(period);
        return bucket?.hasUsa ? bucket.usa : null;
    });
    const oeeuSeries = labels.map(period => {
        const bucket = periodMap.get(period);
        return bucket?.hasOeeu ? bucket.oeeu : null;
    });

    return {
        labels,
        usaSeries,
        oeeuSeries,
        unitLabel: unitLabel || 'value',
    };
}

function renderUsOecdConsumptionChart(consumptionRows, productionRows) {
    const canvas = document.getElementById('oilUsOecdConsumptionChart');
    if (!canvas) return;

    const consumptionSeries = buildUsOecdSeries(consumptionRows);
    const productionSeries = buildUsOecdSeries(productionRows, { totalPetroleumOnly: true });

    const allLabels = Array.from(new Set([
        ...consumptionSeries.labels,
        ...productionSeries.labels,
    ])).sort();

    const consumptionUsaMap = new Map(consumptionSeries.labels.map((label, idx) => [label, consumptionSeries.usaSeries[idx]]));
    const consumptionOeeuMap = new Map(consumptionSeries.labels.map((label, idx) => [label, consumptionSeries.oeeuSeries[idx]]));
    const productionUsaMap = new Map(productionSeries.labels.map((label, idx) => [label, productionSeries.usaSeries[idx]]));
    const productionOeeuMap = new Map(productionSeries.labels.map((label, idx) => [label, productionSeries.oeeuSeries[idx]]));

    const usaSeries = allLabels.map(label => consumptionUsaMap.get(label) ?? null);
    const oeeuSeries = allLabels.map(label => consumptionOeeuMap.get(label) ?? null);
    const productionUsaSeries = allLabels.map(label => productionUsaMap.get(label) ?? null);
    const productionOeeuSeries = allLabels.map(label => productionOeeuMap.get(label) ?? null);
    const deltaSeries = allLabels.map((period, index) => {
        const usaValue = usaSeries[index];
        const oeeuValue = oeeuSeries[index];
        if (usaValue == null || oeeuValue == null) return null;
        return Number(usaValue) - Number(oeeuValue);
    });

    if (oilUsOecdConsumptionChart) {
        oilUsOecdConsumptionChart.destroy();
    }

    oilUsOecdConsumptionChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: allLabels,
            datasets: [
                {
                    label: 'United States (Consumption)',
                    data: usaSeries,
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED822',
                    borderWidth: 2,
                    pointRadius: 0.8,
                    tension: 0.15,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'OECD Europe (Consumption)',
                    data: oeeuSeries,
                    borderColor: '#DC2626',
                    backgroundColor: '#DC262622',
                    borderWidth: 2,
                    pointRadius: 0.8,
                    tension: 0.15,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'Delta (US - OECD Europe)',
                    data: deltaSeries,
                    borderColor: '#111827',
                    backgroundColor: '#11182722',
                    borderWidth: 2,
                    pointRadius: 0.8,
                    tension: 0.15,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'United States (Production)',
                    data: productionUsaSeries,
                    borderColor: '#2563EB',
                    backgroundColor: '#2563EB22',
                    borderWidth: 2,
                    borderDash: [6, 4],
                    pointRadius: 0.8,
                    tension: 0.15,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'OECD Europe (Production)',
                    data: productionOeeuSeries,
                    borderColor: '#B91C1C',
                    backgroundColor: '#B91C1C22',
                    borderWidth: 2,
                    borderDash: [6, 4],
                    pointRadius: 0.8,
                    tension: 0.15,
                    spanGaps: true,
                    fill: false,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Month',
                    },
                    ticks: {
                        maxRotation: 0,
                        callback: (value, index) => (index % 6 === 0 ? allLabels[index] : ''),
                    },
                    grid: {
                        display: false,
                    },
                },
                y: {
                    title: {
                        display: true,
                        text: `Consumption / Production (${consumptionSeries.unitLabel})`,
                    },
                    grid: {
                        color: '#D1D5DB',
                    },
                },
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const value = context.parsed.y;
                            if (value == null) return `${context.dataset.label}: N/A`;
                            return `${context.dataset.label}: ${Number(value).toFixed(2)} ${consumptionSeries.unitLabel}`;
                        },
                    },
                },
            },
        },
    });

    const title = document.getElementById('oilUsOecdConsumptionTitle');
    if (title) {
        const start = allLabels[0] || 'N/A';
        const end = allLabels[allLabels.length - 1] || 'N/A';
        title.textContent = `Monthly consumption + production: United States vs OECD Europe (${start} → ${end})`;
    }
}

async function loadUsOecdConsumptionChart(apiKey) {
    const title = document.getElementById('oilUsOecdConsumptionTitle');
    if (!title) return;

    if (!apiKey) {
        title.textContent = 'Missing EIA key for US vs OECD Europe consumption chart. Add ?eia_api_key=YOUR_KEY.';
        return;
    }

    try {
        const url = new URL('https://api.eia.gov/v2/international/data/');
        url.searchParams.set('frequency', 'monthly');
        url.searchParams.set('data[0]', 'value');
        url.searchParams.set('facets[activityId][]', '2');
        url.searchParams.set('facets[productId][]', '54');
        url.searchParams.append('facets[countryRegionId][]', 'OEEU');
        url.searchParams.append('facets[countryRegionId][]', 'USA');
        url.searchParams.set('start', '2018-01');
        url.searchParams.set('end', '2025-11');
        url.searchParams.set('sort[0][column]', 'period');
        url.searchParams.set('sort[0][direction]', 'desc');
        url.searchParams.set('offset', '0');
        url.searchParams.set('length', '5000');
        url.searchParams.set('api_key', apiKey);

        const response = await fetch(url.toString());
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = payload?.error?.message || payload?.error || `Request failed (${response.status})`;
            throw new Error(message);
        }

        const consumptionRows = Array.isArray(payload?.response?.data) ? payload.response.data : [];

        const productionUrl = new URL('https://api.eia.gov/v2/international/data/');
        productionUrl.searchParams.set('frequency', 'monthly');
        productionUrl.searchParams.set('data[0]', 'value');
        productionUrl.searchParams.set('facets[activityId][]', '1');
        productionUrl.searchParams.set('facets[productId][]', '53');
        productionUrl.searchParams.append('facets[countryRegionId][]', 'OEEU');
        productionUrl.searchParams.append('facets[countryRegionId][]', 'USA');
        productionUrl.searchParams.set('start', '2018-01');
        productionUrl.searchParams.set('end', '2025-11');
        productionUrl.searchParams.set('sort[0][column]', 'period');
        productionUrl.searchParams.set('sort[0][direction]', 'desc');
        productionUrl.searchParams.set('offset', '0');
        productionUrl.searchParams.set('length', '5000');
        productionUrl.searchParams.set('api_key', apiKey);

        const productionResponse = await fetch(productionUrl.toString());
        const productionPayload = await productionResponse.json().catch(() => ({}));
        if (!productionResponse.ok) {
            const message = productionPayload?.error?.message || productionPayload?.error || `Production request failed (${productionResponse.status})`;
            throw new Error(message);
        }

        const productionRows = Array.isArray(productionPayload?.response?.data) ? productionPayload.response.data : [];

        if (!consumptionRows.length && !productionRows.length) {
            throw new Error('No rows returned for USA/OECD Europe with selected parameters.');
        }
        renderUsOecdConsumptionChart(consumptionRows, productionRows);
    } catch (error) {
        title.textContent = `US vs OECD Europe chart failed: ${error.message}`;
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    await checkServerStatus();

    const pageParams = new URLSearchParams(window.location.search);
    const keyInput = document.getElementById('eiaApiKeyInput');
    const keyStatus = document.getElementById('eiaKeyStatus');
    const saveBtn = document.getElementById('saveEiaKeyBtn');
    const clearBtn = document.getElementById('clearEiaKeyBtn');
    const downloadUsOecdBtn = document.getElementById('downloadUsOecdChartBtn');
    const downloadFertilizerDualBtn = document.getElementById('downloadFertilizerDualChartBtn');
    const downloadFertilizerImportsDualBtn = document.getElementById('downloadFertilizerImportsDualChartBtn');
    const downloadFertilizerImportsMonthlyBtn = document.getElementById('downloadFertilizerImportsMonthlyChartBtn');

    if (downloadUsOecdBtn) {
        downloadUsOecdBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('oilUsOecdConsumptionTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartAsPng(
                oilUsOecdConsumptionChart,
                `us-vs-oecd-europe-consumption-production-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('oilUsOecdConsumptionTitle');
                if (title) {
                    title.textContent = 'US vs OECD Europe chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    if (downloadFertilizerDualBtn) {
        downloadFertilizerDualBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('fertilizerExportsDualTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartAsPng(
                fertilizerExportsDualChart,
                `fertilizer-exports-share-world-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('fertilizerExportsDualTitle');
                if (title) {
                    title.textContent = 'Fertilizer chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    if (downloadFertilizerImportsDualBtn) {
        downloadFertilizerImportsDualBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('fertilizerImportsDualTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartAsPng(
                fertilizerImportsDualChart,
                `fertilizer-imports-share-world-top6-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('fertilizerImportsDualTitle');
                if (title) {
                    title.textContent = 'Fertilizer imports chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    if (downloadFertilizerImportsMonthlyBtn) {
        downloadFertilizerImportsMonthlyBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('fertilizerImportsMonthlyTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartAsPng(
                fertilizerImportsMonthlyChart,
                `fertilizer-imports-monthly-value-top6-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('fertilizerImportsMonthlyTitle');
                if (title) {
                    title.textContent = 'Fertilizer monthly imports chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    const storedKeyRaw = localStorage.getItem(EIA_KEY_STORAGE_KEY) || '';
    const storedKey = normalizeEiaKey(storedKeyRaw);
    if (storedKeyRaw && !storedKey) {
        localStorage.removeItem(EIA_KEY_STORAGE_KEY);
    }
    if (keyInput && storedKey) {
        keyInput.value = storedKey;
    }

    if (keyStatus) {
        keyStatus.textContent = storedKey ? 'Using key from local storage.' : 'No key stored.';
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const value = normalizeEiaKey((keyInput && keyInput.value) || '');
            if (!value) {
                if (keyStatus) keyStatus.textContent = 'Invalid key format. Paste your EIA API key and try again.';
                return;
            }
            localStorage.setItem(EIA_KEY_STORAGE_KEY, value);
            if (keyStatus) keyStatus.textContent = 'Key saved. Reloading charts...';
            window.location.reload();
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            localStorage.removeItem(EIA_KEY_STORAGE_KEY);
            if (keyInput) keyInput.value = '';
            if (keyStatus) keyStatus.textContent = 'Key cleared.';
            window.location.reload();
        });
    }

    const productionSourceUrl = pageParams.get('production_source_url') || '';
    const consumptionSourceUrl = pageParams.get('consumption_source_url') || '';
    const exportsSourceUrl = pageParams.get('exports_source_url') || '';

    const genericKey = normalizeEiaKey(pageParams.get('eia_api_key')) || storedKey || '';

    const productionKey = normalizeEiaKey(pageParams.get('eia_production_api_key')) || genericKey;
    const consumptionKey = normalizeEiaKey(pageParams.get('eia_consumption_api_key')) || genericKey;
    const exportsKey = normalizeEiaKey(pageParams.get('eia_exports_api_key')) || genericKey || productionKey || consumptionKey;
    const usOecdConsumptionKey = genericKey || consumptionKey || productionKey || exportsKey;

    const productionApiUrl = new URL(`${API_BASE}/api/world-oil-production-monthly`);
    productionApiUrl.searchParams.set('date_from', '2018-01');
    if (productionSourceUrl) productionApiUrl.searchParams.set('source_url', productionSourceUrl);
    if (productionKey) productionApiUrl.searchParams.set('production_api_key', productionKey);

    const consumptionApiUrl = new URL(`${API_BASE}/api/world-oil-consumption-annual`);
    consumptionApiUrl.searchParams.set('date_from', '2018');
    if (consumptionSourceUrl) consumptionApiUrl.searchParams.set('source_url', consumptionSourceUrl);
    if (consumptionKey) consumptionApiUrl.searchParams.set('consumption_api_key', consumptionKey);

    const exportsApiUrl = new URL(`${API_BASE}/api/world-oil-top-exporters-share-annual`);
    exportsApiUrl.searchParams.set('date_from', '2018');
    exportsApiUrl.searchParams.set('top_n', '5');
    exportsApiUrl.searchParams.set('_t', String(Date.now()));
    if (exportsSourceUrl) exportsApiUrl.searchParams.set('source_url', exportsSourceUrl);
    if (exportsKey) exportsApiUrl.searchParams.set('exports_api_key', exportsKey);

    const hasProductionAuth = Boolean(productionKey || productionSourceUrl);
    const hasConsumptionAuth = Boolean(consumptionKey || consumptionSourceUrl);
    const hasExportsAuth = Boolean(exportsKey || exportsSourceUrl);

    if (!hasProductionAuth) {
        const title = document.getElementById('oilDualApiTitle');
        if (title) {
            title.textContent = 'Missing EIA key for production chart. Open this page with ?eia_api_key=YOUR_KEY';
        }
        return;
    }

    try {
        const requests = [fetch(productionApiUrl.toString())];
        if (hasConsumptionAuth) {
            requests.push(fetch(consumptionApiUrl.toString()));
        }

        const [productionResponse, consumptionResponse] = await Promise.all(requests);

        if (!productionResponse.ok) {
            const err = await productionResponse.json().catch(() => ({}));
            throw new Error(err.error || `Production request failed (${productionResponse.status})`);
        }

        const productionPayload = await productionResponse.json();

        let consumptionPayload = null;
        if (consumptionResponse && consumptionResponse.ok) {
            consumptionPayload = await consumptionResponse.json();
        }

        renderChart(productionPayload, consumptionPayload);
    } catch (error) {
        const title = document.getElementById('oilDualApiTitle');
        if (title) {
            title.textContent = `Dual API chart failed: ${error.message}`;
        }
    }

    await loadUsOecdConsumptionChart(usOecdConsumptionKey);

    if (!hasExportsAuth) {
        const title = document.getElementById('oilTopExportersTitle');
        if (title) {
            title.textContent = 'Missing EIA key for exporters chart. Add ?eia_api_key=YOUR_KEY (or eia_exports_api_key).';
        }
    } else {
        try {
            const response = await fetch(exportsApiUrl.toString());
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || `Exports request failed (${response.status})`);
            }
            const payload = await response.json();
            renderTopExportersChart(payload);
        } catch (error) {
            const title = document.getElementById('oilTopExportersTitle');
            if (title) {
                const message = String(error && error.message ? error.message : error);
                if (message.includes('NameResolutionError') || message.includes('Failed to resolve')) {
                    title.textContent = 'Top exporters chart failed due to DNS/network resolution issue. Retrying later will use cached data when available.';
                } else {
                    title.textContent = `Top exporters chart failed: ${message}`;
                }
            }
        }
    }

    try {
        const payload = await fetchFertilizerExportsPayload(2018);
        renderFertilizerExportsDualChart(payload);
    } catch (error) {
        const title = document.getElementById('fertilizerExportsDualTitle');
        if (title) {
            title.textContent = `Fertilizer exports chart failed: ${error.message}`;
        }
    }

    try {
        const payload = await fetchFertilizerImportsPayloadFromLocalItcHtml(2018, 6);
        renderFertilizerImportsDualChart(payload);
    } catch (error) {
        const title = document.getElementById('fertilizerImportsDualTitle');
        if (title) {
            title.textContent = `Fertilizer imports chart failed: ${error.message}`;
        }
    }

    try {
        const payload = await fetchFertilizerImportsMonthlyPayloadFromLocalItcHtml(6);
        renderFertilizerImportsMonthlyChart(payload);
    } catch (error) {
        const title = document.getElementById('fertilizerImportsMonthlyTitle');
        if (title) {
            title.textContent = `Fertilizer monthly imports chart failed: ${error.message}`;
        }
    }
});
