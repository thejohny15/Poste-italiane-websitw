const API_BASE = 'http://localhost:5001';
let oilDualApiChart = null;
let oilTopExportersChart = null;
const EIA_KEY_STORAGE_KEY = 'poste_eia_api_key';

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

window.addEventListener('DOMContentLoaded', async () => {
    await checkServerStatus();

    const pageParams = new URLSearchParams(window.location.search);
    const keyInput = document.getElementById('eiaApiKeyInput');
    const keyStatus = document.getElementById('eiaKeyStatus');
    const saveBtn = document.getElementById('saveEiaKeyBtn');
    const clearBtn = document.getElementById('clearEiaKeyBtn');

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

    if (!hasExportsAuth) {
        const title = document.getElementById('oilTopExportersTitle');
        if (title) {
            title.textContent = 'Missing EIA key for exporters chart. Add ?eia_api_key=YOUR_KEY (or eia_exports_api_key).';
        }
        return;
    }

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
});
