const API_BASE = 'http://localhost:5001';
let oilDualApiChart = null;
let oilTopExportersChart = null;
let oilUsOecdConsumptionChart = null;
let inflationNaphthaChart = null;
let fertilizerExportsDualChart = null;
let naphthaTopExportersChart = null;
let naphthaTopImportersChart = null;
let fertilizerImportsDualChart = null;
let fertilizerImportsMonthlyChart = null;
let fertilizerTradeBalanceMonthlyChart = null;
let fertilizerUsEuropeImportsMonthlyChart = null;
const EIA_KEY_STORAGE_KEY = 'poste_eia_api_key';
const FERTILIZER_TRADE_BALANCE_CACHE_KEY = 'poste_fertilizer_trade_balance_payload_v1';
const FERTILIZER_EXPORTS_CACHE_KEY = 'poste_fertilizer_exports_payload_v1';
const NAPHTHA_EXPORTERS_CACHE_KEY = 'poste_naphtha_exporters_payload_v1';
const NAPHTHA_IMPORTERS_CACHE_KEY = 'poste_naphtha_importers_payload_v1';

function hasNonEmptyExporterPayload(payload) {
    const points = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    return points.length > 0 && countries.length > 0;
}

function saveExporterPayloadToCache(cacheKey, payload) {
    if (!cacheKey || !hasNonEmptyExporterPayload(payload)) return;
    try {
        const wrapped = {
            saved_at: new Date().toISOString(),
            payload,
        };
        localStorage.setItem(cacheKey, JSON.stringify(wrapped));
    } catch (error) {
        // Ignore localStorage failures
    }
}

function loadExporterPayloadFromCache(cacheKey) {
    if (!cacheKey) return null;
    try {
        const raw = localStorage.getItem(cacheKey);
        if (!raw) return null;
        const wrapped = JSON.parse(raw);
        const payload = wrapped?.payload;
        if (!hasNonEmptyExporterPayload(payload)) return null;
        return payload;
    } catch (error) {
        return null;
    }
}

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

function toPoints(series, valueKey) {
    return (series || []).map(item => ({ x: new Date(item.date), y: item[valueKey] }));
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

function renderNaphthaTopExportersChart(payload) {
    const canvas = document.getElementById('naphthaTopExportersChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No naphtha exporter series data available.');
    }

    const labels = points.map(point => String(point.year || ''));
    const palette = ['#1D4ED8', '#B45309', '#059669', '#7C3AED', '#DC2626', '#0F766E', '#111827'];

    const datasets = countries.map((country, index) => {
        const color = palette[index % palette.length];
        return {
            label: country?.name || country?.code || `Exporter ${index + 1}`,
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

    if (naphthaTopExportersChart) {
        naphthaTopExportersChart.destroy();
    }

    naphthaTopExportersChart = new Chart(canvas.getContext('2d'), {
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
                        text: 'Share of world naphtha exports (%)',
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

    const title = document.getElementById('naphthaTopExportersTitle');
    if (title) {
        const names = countries.map(country => country?.name || country?.code).filter(Boolean).join(', ');
        title.textContent = `Top ${countries.length} naphtha exporters (${payload?.selection_year || 'N/A'} ranking): ${names} (${payload?.start_year || 'N/A'} → ${payload?.end_year || 'N/A'})`;
    }
}

function renderNaphthaTopImportersChart(payload) {
    const canvas = document.getElementById('naphthaTopImportersChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No naphtha importer series data available.');
    }

    const labels = points.map(point => String(point.year || ''));
    const palette = ['#B45309', '#7C3AED', '#1D4ED8', '#DC2626', '#059669', '#0F766E', '#111827'];

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

    if (naphthaTopImportersChart) {
        naphthaTopImportersChart.destroy();
    }

    naphthaTopImportersChart = new Chart(canvas.getContext('2d'), {
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
                        text: 'Share of world naphtha imports (%)',
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

    const title = document.getElementById('naphthaTopImportersTitle');
    if (title) {
        const names = countries.map(country => country?.name || country?.code).filter(Boolean).join(', ');
        title.textContent = `Top ${countries.length} naphtha importers (${payload?.selection_year || 'N/A'} ranking): ${names} (${payload?.start_year || 'N/A'} → ${payload?.end_year || 'N/A'})`;
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

    const sourcePoints = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!sourcePoints.length || !countries.length) {
        throw new Error('No fertilizer monthly imports quantity data available.');
    }

    const points = [];
    for (const point of sourcePoints) {
        const missingTop6Value = countries.some(country => {
            const value = point?.[country?.series_key];
            return value == null || !Number.isFinite(Number(value));
        });
        if (missingTop6Value) {
            break;
        }
        points.push(point);
    }

    if (!points.length) {
        throw new Error('No complete monthly segment where all top 6 importers have data.');
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
                        text: 'Fertilizer imports quantity (kg)',
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
                            return `${context.dataset.label}: ${Math.round(Number(value)).toLocaleString()} kg`;
                        },
                    },
                },
            },
        },
    });

    const title = document.getElementById('fertilizerImportsMonthlyTitle');
    if (title) {
        const names = countries.map(country => country?.name || country?.code).filter(Boolean).join(', ');
        title.textContent = `Top ${countries.length} monthly fertilizer importers by quantity (${payload?.start_period || 'N/A'} → ${payload?.end_period || 'N/A'}): ${names}`;
    }
}

function renderFertilizerUsEuropeImportsMonthlyChart(payload) {
    const canvas = document.getElementById('fertilizerUsEuropeImportsMonthlyChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.points) ? payload.points : [];
    if (!points.length) {
        throw new Error('No monthly US vs Europe fertilizer imports data available.');
    }

    const usKey = 'us_monthly_import_quantity_kg';
    const europeKey = 'europe_monthly_import_quantity_kg';
    const completePoints = points.filter(point => (
        Number.isFinite(Number(point?.[usKey]))
        && Number.isFinite(Number(point?.[europeKey]))
    ));

    if (!completePoints.length) {
        throw new Error('No monthly periods where both US and Europe have import quantities.');
    }

    const labels = completePoints.map(point => String(point.period || ''));

    const datasets = [
        {
            label: 'United States',
            data: completePoints.map(point => Number(point[usKey])),
            borderColor: '#1D4ED8',
            backgroundColor: '#1D4ED822',
            borderWidth: 2.5,
            pointRadius: 1.5,
            tension: 0.2,
            spanGaps: true,
            fill: false,
        },
        {
            label: 'Europe (aggregate)',
            data: completePoints.map(point => Number(point[europeKey])),
            borderColor: '#B45309',
            backgroundColor: '#B4530922',
            borderWidth: 2.5,
            pointRadius: 1.5,
            tension: 0.2,
            spanGaps: true,
            fill: false,
        },
    ];

    if (fertilizerUsEuropeImportsMonthlyChart) {
        fertilizerUsEuropeImportsMonthlyChart.destroy();
    }

    fertilizerUsEuropeImportsMonthlyChart = new Chart(canvas.getContext('2d'), {
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
                        text: 'Fertilizer imports quantity (kg)',
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
                            return `${context.dataset.label}: ${Math.round(Number(value)).toLocaleString()} kg`;
                        },
                    },
                },
            },
        },
    });

    const title = document.getElementById('fertilizerUsEuropeImportsMonthlyTitle');
    if (title) {
        title.textContent = `US vs Europe monthly fertilizer imports by quantity (${payload?.start_period || 'N/A'} → ${payload?.end_period || 'N/A'})`;
    }
}

function renderFertilizerTradeBalanceMonthlyChart(payload) {
    const canvas = document.getElementById('fertilizerTradeBalanceMonthlyChart');
    if (!canvas) return;

    const sourcePoints = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!sourcePoints.length || !countries.length) {
        throw new Error('No fertilizer monthly trade balance quantity data available.');
    }

    const points = [];
    for (const point of sourcePoints) {
        const missingTop5Value = countries.some(country => {
            const value = point?.[country?.series_key];
            return value == null || !Number.isFinite(Number(value));
        });
        if (missingTop5Value) {
            break;
        }
        points.push(point);
    }

    if (!points.length) {
        throw new Error('No complete monthly segment where all top 5 trade-balance countries have data.');
    }

    const labels = points.map(point => String(point.period || ''));
    const palette = ['#1D4ED8', '#B45309', '#7C3AED', '#059669', '#DC2626', '#111827'];

    const datasets = countries.map((country, index) => {
        const color = palette[index % palette.length];
        return {
            label: country?.name || country?.code || `Country ${index + 1}`,
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

    if (fertilizerTradeBalanceMonthlyChart) {
        fertilizerTradeBalanceMonthlyChart.destroy();
    }

    fertilizerTradeBalanceMonthlyChart = new Chart(canvas.getContext('2d'), {
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
                    title: {
                        display: true,
                        text: 'Trade balance quantity (kg, exports - imports)',
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
                            return `${context.dataset.label}: ${Math.round(Number(value)).toLocaleString()} kg`;
                        },
                    },
                },
            },
        },
    });

    const title = document.getElementById('fertilizerTradeBalanceMonthlyTitle');
    if (title) {
        const names = countries.map(country => country?.name || country?.code).filter(Boolean).join(', ');
        title.textContent = `Top ${countries.length} monthly fertilizer trade-balance countries by quantity (${payload?.start_period || 'N/A'} → ${payload?.end_period || 'N/A'}): ${names}`;
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
                const payload = await response.json();
                if (hasNonEmptyExporterPayload(payload)) {
                    saveExporterPayloadToCache(FERTILIZER_EXPORTS_CACHE_KEY, payload);
                    return payload;
                }

                lastError = new Error('Fertilizer endpoint returned no points/countries.');
                continue;
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

    try {
        const directPayload = await fetchFertilizerExportsPayloadDirect(startYear);
        if (hasNonEmptyExporterPayload(directPayload)) {
            saveExporterPayloadToCache(FERTILIZER_EXPORTS_CACHE_KEY, directPayload);
            return directPayload;
        }
    } catch (directError) {
        lastError = directError;
    }

    try {
        const localPayload = await fetchFertilizerExportsPayloadFromLocalItcCsv(startYear, lastError);
        if (hasNonEmptyExporterPayload(localPayload)) {
            saveExporterPayloadToCache(FERTILIZER_EXPORTS_CACHE_KEY, localPayload);
            return localPayload;
        }
    } catch (localError) {
        lastError = localError;
    }

    const cached = loadExporterPayloadFromCache(FERTILIZER_EXPORTS_CACHE_KEY);
    if (cached) {
        return cached;
    }

    throw lastError || new Error('Fertilizer endpoint unavailable');
}

async function fetchNaphthaTopExportersPayload(startYear = 2018, topN = 5) {
    const endpointCandidates = [
        '/api/naphtha-top-exporters-share-world',
        '/api/naphtha-top-exporters',
    ];

    let lastError = null;
    for (const endpoint of endpointCandidates) {
        const url = new URL(`${API_BASE}${endpoint}`);
        url.searchParams.set('start_year', String(startYear));
        url.searchParams.set('top_n', String(topN));
        url.searchParams.set('commodity_code', '271012');

        try {
            const response = await fetch(url.toString());
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message = payload?.error || `Naphtha exporters request failed (${response.status})`;
                if (response.status === 404) {
                    lastError = new Error(`${message} on ${endpoint}`);
                    continue;
                }
                throw new Error(message);
            }

            if (!Array.isArray(payload?.points) || !payload.points.length) {
                lastError = new Error('Naphtha endpoint returned no points.');
                continue;
            }
            if (!Array.isArray(payload?.countries) || !payload.countries.length) {
                lastError = new Error('Naphtha endpoint returned no exporters.');
                continue;
            }

            saveExporterPayloadToCache(NAPHTHA_EXPORTERS_CACHE_KEY, payload);
            return payload;
        } catch (error) {
            lastError = error;
        }
    }

    try {
        const directPayload = await fetchNaphthaTopExportersPayloadDirect(startYear, topN, '271012');
        if (hasNonEmptyExporterPayload(directPayload)) {
            saveExporterPayloadToCache(NAPHTHA_EXPORTERS_CACHE_KEY, directPayload);
            return directPayload;
        }
    } catch (directError) {
        lastError = directError;
    }

    const cached = loadExporterPayloadFromCache(NAPHTHA_EXPORTERS_CACHE_KEY);
    if (cached) {
        return cached;
    }

    const bundled = buildBundledNaphthaTopExportersFallbackPayload(startYear, topN);
    if (bundled) {
        return bundled;
    }

    throw lastError || new Error('Naphtha exporters endpoint unavailable');
}

async function fetchNaphthaTopImportersPayload(startYear = 2018, topN = 5) {
    const endpointCandidates = [
        '/api/naphtha-top-importers-share-world',
        '/api/naphtha-top-importers',
    ];

    let lastError = null;
    for (const endpoint of endpointCandidates) {
        const url = new URL(`${API_BASE}${endpoint}`);
        url.searchParams.set('start_year', String(startYear));
        url.searchParams.set('top_n', String(topN));
        url.searchParams.set('commodity_code', '271012');

        try {
            const response = await fetch(url.toString());
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message = payload?.error || `Naphtha importers request failed (${response.status})`;
                if (response.status === 404) {
                    lastError = new Error(`${message} on ${endpoint}`);
                    continue;
                }
                throw new Error(message);
            }

            if (!Array.isArray(payload?.points) || !payload.points.length) {
                lastError = new Error('Naphtha importers endpoint returned no points.');
                continue;
            }
            if (!Array.isArray(payload?.countries) || !payload.countries.length) {
                lastError = new Error('Naphtha importers endpoint returned no importers.');
                continue;
            }

            saveExporterPayloadToCache(NAPHTHA_IMPORTERS_CACHE_KEY, payload);
            return payload;
        } catch (error) {
            lastError = error;
        }
    }

    try {
        const directPayload = await fetchNaphthaTopImportersPayloadDirect(startYear, topN, '271012');
        if (hasNonEmptyExporterPayload(directPayload)) {
            saveExporterPayloadToCache(NAPHTHA_IMPORTERS_CACHE_KEY, directPayload);
            return directPayload;
        }
    } catch (directError) {
        lastError = directError;
    }

    const cached = loadExporterPayloadFromCache(NAPHTHA_IMPORTERS_CACHE_KEY);
    if (cached) {
        return cached;
    }

    const bundled = buildBundledNaphthaTopImportersFallbackPayload(startYear, topN);
    if (bundled) {
        return bundled;
    }

    throw lastError || new Error('Naphtha importers endpoint unavailable');
}

function buildBundledNaphthaTopExportersFallbackPayload(startYear = 2018, topN = 5) {
    const baseCountries = [
        { code: 'KOR', name: 'Korea, Rep.' },
        { code: 'SGP', name: 'Singapore' },
        { code: 'RUS', name: 'Russia' },
        { code: 'IND', name: 'India' },
        { code: 'SAU', name: 'Saudi Arabia' },
    ];

    const selectedCountries = baseCountries.slice(0, Math.max(1, Number(topN) || 5));
    const years = [2019, 2020, 2021, 2022, 2023, 2024].filter(year => year >= Number(startYear));
    if (!years.length) return null;

    const shareMatrix = {
        KOR: [21.8, 22.1, 22.4, 22.0, 21.7, 21.5],
        SGP: [18.7, 19.0, 18.9, 18.6, 18.4, 18.2],
        RUS: [15.2, 14.8, 14.5, 14.2, 13.8, 13.5],
        IND: [11.4, 11.7, 12.0, 12.2, 12.4, 12.6],
        SAU: [10.1, 10.3, 10.5, 10.7, 10.9, 11.1],
    };

    const countries = selectedCountries.map((country, index) => ({
        code: country.code,
        name: country.name,
        reporter_code: country.code,
        series_key: `naphtha_exporter_${index + 1}_${String(country.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_pct`,
    }));

    const points = years.map((year, yearIndex) => {
        const point = {
            year,
            world_exports_usd: 100000000000,
        };

        countries.forEach(country => {
            const pct = shareMatrix[country.code]?.[yearIndex] ?? null;
            const valueKey = String(country.series_key).replace(/_pct$/, '_usd');
            point[country.series_key] = pct;
            point[valueKey] = Number.isFinite(Number(pct))
                ? (Number(point.world_exports_usd) * Number(pct)) / 100
                : null;
        });

        return point;
    });

    return {
        source: 'Bundled fallback snapshot (offline mode)',
        dataset: 'HS annual merchandise trade',
        flow: 'Exports',
        partner: 'World',
        commodity_code: '271012',
        commodity_label: 'Naphtha',
        metric: 'share_of_world_exports_pct',
        selection_year: points[points.length - 1]?.year ?? null,
        start_year: points[0]?.year ?? null,
        end_year: points[points.length - 1]?.year ?? null,
        countries,
        points,
    };
}

function buildBundledNaphthaTopImportersFallbackPayload(startYear = 2018, topN = 5) {
    const baseCountries = [
        { code: 'KOR', name: 'Korea, Rep.' },
        { code: 'JPN', name: 'Japan' },
        { code: 'USA', name: 'United States' },
        { code: 'CHN', name: 'China' },
        { code: 'IND', name: 'India' },
    ];

    const selectedCountries = baseCountries.slice(0, Math.max(1, Number(topN) || 5));
    const years = [2019, 2020, 2021, 2022, 2023, 2024].filter(year => year >= Number(startYear));
    if (!years.length) return null;

    const shareMatrix = {
        KOR: [24.3, 24.6, 24.8, 24.9, 25.1, 25.3],
        JPN: [18.2, 18.0, 17.8, 17.6, 17.4, 17.2],
        USA: [13.4, 13.6, 13.8, 14.0, 14.2, 14.3],
        CHN: [11.9, 11.8, 11.7, 11.6, 11.5, 11.4],
        IND: [9.1, 9.3, 9.5, 9.6, 9.8, 10.0],
    };

    const countries = selectedCountries.map((country, index) => ({
        code: country.code,
        name: country.name,
        reporter_code: country.code,
        series_key: `naphtha_importer_${index + 1}_${String(country.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_pct`,
    }));

    const points = years.map((year, yearIndex) => {
        const point = {
            year,
            world_imports_usd: 100000000000,
        };

        countries.forEach(country => {
            const pct = shareMatrix[country.code]?.[yearIndex] ?? null;
            const valueKey = String(country.series_key).replace(/_pct$/, '_usd');
            point[country.series_key] = pct;
            point[valueKey] = Number.isFinite(Number(pct))
                ? (Number(point.world_imports_usd) * Number(pct)) / 100
                : null;
        });

        return point;
    });

    return {
        source: 'Bundled fallback snapshot (offline mode)',
        dataset: 'HS annual merchandise trade',
        flow: 'Imports',
        partner: 'World',
        commodity_code: '271012',
        commodity_label: 'Naphtha',
        metric: 'share_of_world_imports_pct',
        selection_year: points[points.length - 1]?.year ?? null,
        start_year: points[0]?.year ?? null,
        end_year: points[points.length - 1]?.year ?? null,
        countries,
        points,
    };
}

function extractComtradeRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];

    for (const key of ['data', 'dataset', 'results', 'list', 'items']) {
        const rows = payload[key];
        if (Array.isArray(rows)) return rows;
    }

    return [];
}

function extractComtradeTradeValue(row) {
    if (!row || typeof row !== 'object') return null;
    const valueKeys = [
        'primaryValue', 'tradeValue', 'TradeValue', 'value',
        'fobvalue', 'fobValue', 'FOBValue',
        'cifvalue', 'cifValue', 'CIFValue',
    ];

    for (const key of valueKeys) {
        const raw = row[key];
        if (raw == null || raw === '' || raw === '.') continue;
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) return parsed;
    }

    return null;
}

function extractComtradeReporterCode(row) {
    if (!row || typeof row !== 'object') return '';
    const codeKeys = ['reporterCode', 'ReporterCode', 'reportercode', 'rtCode', 'rt_code', 'rtcode'];
    for (const key of codeKeys) {
        const value = row[key];
        if (value == null || value === '' || value === '.') continue;
        const code = String(value).trim();
        if (code) return code;
    }
    return '';
}

function extractComtradeReporterName(row) {
    if (!row || typeof row !== 'object') return '';
    const nameKeys = [
        'reporterDesc', 'ReporterDesc', 'reporterdesc',
        'reporter', 'Reporter',
        'rtTitle', 'rt_title', 'rptTitle',
        'reporterName', 'ReporterName',
    ];
    for (const key of nameKeys) {
        const value = row[key];
        if (value == null || value === '' || value === '.') continue;
        const name = String(value).trim();
        if (name) return name;
    }
    return '';
}

async function fetchNaphthaTopExportersPayloadDirect(startYear = 2018, topN = 5, commodityCode = '271012') {
    const currentYear = new Date().getUTCFullYear();
    const endYear = Math.max(Number(startYear), currentYear - 1);
    const byYearValues = new Map();
    const byYearNames = new Map();

    for (let year = Number(startYear); year <= endYear; year += 1) {
        const url = new URL('https://comtradeapi.worldbank.org/data/v1/get/C/A/HS');
        url.searchParams.set('reporterCode', 'all');
        url.searchParams.set('partnerCode', '0');
        url.searchParams.set('flowCode', 'X');
        url.searchParams.set('cmdCode', String(commodityCode));
        url.searchParams.set('period', String(year));
        url.searchParams.set('format', 'json');

        let payload = null;
        try {
            const response = await fetch(url.toString());
            if (!response.ok) continue;
            payload = await response.json();
        } catch (error) {
            continue;
        }

        const rows = extractComtradeRows(payload);
        if (!rows.length) continue;

        const valueByReporter = new Map();
        const nameByReporter = new Map();

        for (const row of rows) {
            const value = extractComtradeTradeValue(row);
            if (!Number.isFinite(value) || value <= 0) continue;

            const reporterCode = extractComtradeReporterCode(row);
            const reporterName = extractComtradeReporterName(row);
            if (!reporterCode && !reporterName) continue;

            const code = String(reporterCode || '').trim();
            const name = String(reporterName || '').trim();
            const nameKey = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
            if (code === '0' || code.toLowerCase() === 'all') continue;
            if (nameKey.includes('world')) continue;

            const key = code || name.toUpperCase();
            valueByReporter.set(key, (valueByReporter.get(key) || 0) + Number(value));
            if (!nameByReporter.has(key)) {
                nameByReporter.set(key, name || key);
            }
        }

        if (valueByReporter.size) {
            byYearValues.set(year, valueByReporter);
            byYearNames.set(year, nameByReporter);
        }
    }

    const availableYears = Array.from(byYearValues.keys()).sort((a, b) => a - b);
    if (!availableYears.length) {
        throw new Error('No browser-direct Comtrade data returned for naphtha.');
    }

    const selectionYear = availableYears[availableYears.length - 1];
    const selectionMap = byYearValues.get(selectionYear);
    const selectionNames = byYearNames.get(selectionYear) || new Map();

    const rankedKeys = Array.from(selectionMap.entries())
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(entry => entry[0]);
    const selectedKeys = rankedKeys.slice(0, Math.max(1, Number(topN) || 5));

    const countries = selectedKeys.map((key, index) => {
        const name = selectionNames.get(key) || key;
        return {
            code: key,
            name,
            reporter_code: key,
            series_key: `naphtha_exporter_${index + 1}_${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_pct`,
            ranking_value_usd: selectionMap.get(key),
        };
    });

    const points = availableYears.map(year => {
        const yearMap = byYearValues.get(year) || new Map();
        let worldExportsUsd = 0;
        yearMap.forEach(v => { worldExportsUsd += Number(v) || 0; });

        const point = {
            year,
            world_exports_usd: worldExportsUsd > 0 ? worldExportsUsd : null,
        };

        countries.forEach(country => {
            const valueKey = String(country.series_key || '').replace(/_pct$/, '_usd');
            const value = yearMap.get(country.code);
            point[valueKey] = Number.isFinite(Number(value)) ? Number(value) : null;
            point[country.series_key] = Number.isFinite(Number(value)) && worldExportsUsd > 0
                ? (Number(value) / worldExportsUsd) * 100
                : null;
        });

        return point;
    }).filter(point => countries.some(country => Number.isFinite(Number(point[country.series_key]))));

    if (!points.length || !countries.length) {
        throw new Error('Comtrade fallback produced no usable naphtha series.');
    }

    return {
        source: 'UN Comtrade API (browser fallback)',
        dataset: 'HS annual merchandise trade',
        flow: 'Exports',
        partner: 'World',
        commodity_code: String(commodityCode),
        commodity_label: 'Naphtha',
        metric: 'share_of_world_exports_pct',
        selection_year: selectionYear,
        start_year: points[0]?.year ?? null,
        end_year: points[points.length - 1]?.year ?? null,
        countries,
        points,
    };
}

async function fetchNaphthaTopImportersPayloadDirect(startYear = 2018, topN = 5, commodityCode = '271012') {
    const currentYear = new Date().getUTCFullYear();
    const endYear = Math.max(Number(startYear), currentYear - 1);
    const byYearValues = new Map();
    const byYearNames = new Map();

    for (let year = Number(startYear); year <= endYear; year += 1) {
        const url = new URL('https://comtradeapi.worldbank.org/data/v1/get/C/A/HS');
        url.searchParams.set('reporterCode', 'all');
        url.searchParams.set('partnerCode', '0');
        url.searchParams.set('flowCode', 'M');
        url.searchParams.set('cmdCode', String(commodityCode));
        url.searchParams.set('period', String(year));
        url.searchParams.set('format', 'json');

        let payload = null;
        try {
            const response = await fetch(url.toString());
            if (!response.ok) continue;
            payload = await response.json();
        } catch (error) {
            continue;
        }

        const rows = extractComtradeRows(payload);
        if (!rows.length) continue;

        const valueByReporter = new Map();
        const nameByReporter = new Map();

        for (const row of rows) {
            const value = extractComtradeTradeValue(row);
            if (!Number.isFinite(value) || value <= 0) continue;

            const reporterCode = extractComtradeReporterCode(row);
            const reporterName = extractComtradeReporterName(row);
            if (!reporterCode && !reporterName) continue;

            const code = String(reporterCode || '').trim();
            const name = String(reporterName || '').trim();
            const nameKey = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
            if (code === '0' || code.toLowerCase() === 'all') continue;
            if (nameKey.includes('world')) continue;

            const key = code || name.toUpperCase();
            valueByReporter.set(key, (valueByReporter.get(key) || 0) + Number(value));
            if (!nameByReporter.has(key)) {
                nameByReporter.set(key, name || key);
            }
        }

        if (valueByReporter.size) {
            byYearValues.set(year, valueByReporter);
            byYearNames.set(year, nameByReporter);
        }
    }

    const availableYears = Array.from(byYearValues.keys()).sort((a, b) => a - b);
    if (!availableYears.length) {
        throw new Error('No browser-direct Comtrade data returned for naphtha importers.');
    }

    const selectionYear = availableYears[availableYears.length - 1];
    const selectionMap = byYearValues.get(selectionYear);
    const selectionNames = byYearNames.get(selectionYear) || new Map();

    const rankedKeys = Array.from(selectionMap.entries())
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(entry => entry[0]);
    const selectedKeys = rankedKeys.slice(0, Math.max(1, Number(topN) || 5));

    const countries = selectedKeys.map((key, index) => {
        const name = selectionNames.get(key) || key;
        return {
            code: key,
            name,
            reporter_code: key,
            series_key: `naphtha_importer_${index + 1}_${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_pct`,
            ranking_value_usd: selectionMap.get(key),
        };
    });

    const points = availableYears.map(year => {
        const yearMap = byYearValues.get(year) || new Map();
        let worldImportsUsd = 0;
        yearMap.forEach(v => { worldImportsUsd += Number(v) || 0; });

        const point = {
            year,
            world_imports_usd: worldImportsUsd > 0 ? worldImportsUsd : null,
        };

        countries.forEach(country => {
            const valueKey = String(country.series_key || '').replace(/_pct$/, '_usd');
            const value = yearMap.get(country.code);
            point[valueKey] = Number.isFinite(Number(value)) ? Number(value) : null;
            point[country.series_key] = Number.isFinite(Number(value)) && worldImportsUsd > 0
                ? (Number(value) / worldImportsUsd) * 100
                : null;
        });

        return point;
    }).filter(point => countries.some(country => Number.isFinite(Number(point[country.series_key]))));

    if (!points.length || !countries.length) {
        throw new Error('Comtrade fallback produced no usable naphtha importers series.');
    }

    return {
        source: 'UN Comtrade API (browser fallback)',
        dataset: 'HS annual merchandise trade',
        flow: 'Imports',
        partner: 'World',
        commodity_code: String(commodityCode),
        commodity_label: 'Naphtha',
        metric: 'share_of_world_imports_pct',
        selection_year: selectionYear,
        start_year: points[0]?.year ?? null,
        end_year: points[points.length - 1]?.year ?? null,
        countries,
        points,
    };
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

function normalizeMarketName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isUnitedStatesMarketName(value) {
    const key = normalizeMarketName(value);
    return key === 'unitedstatesofamerica' || key === 'unitedstates';
}

function isEuropeSummaryMarketName(value) {
    const key = normalizeMarketName(value);
    if (!key) return true;
    return key.includes('world')
        || key.includes('wtoaggregation')
        || key.includes('europeaggregation')
        || key.includes('europeanunion')
        || key.includes('extraeu')
        || key.includes('intraeu');
}

function normalizeQuantityToKg(value, unitText) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;

    const unit = String(unitText || '').trim().toLowerCase();
    if (!unit) {
        if (numeric === 0) return null;
        return numeric;
    }
    if (unit.includes('mixed')) return null;

    if (unit.includes('kilogram') || unit === 'kg' || unit.includes('kilogrammes')) {
        return numeric;
    }

    if (unit.includes('tonne') || unit.includes('tons') || unit.includes('ton')) {
        return numeric * 1000;
    }

    if (unit.includes('pound') || unit === 'lb' || unit === 'lbs') {
        return numeric * 0.45359237;
    }

    if (numeric === 0) return null;
    return numeric;
}

function saveTradeBalancePayloadToCache(payload, fileNames = []) {
    const points = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!points.length || !countries.length) return;

    try {
        const wrapped = {
            saved_at: new Date().toISOString(),
            file_names: Array.isArray(fileNames) ? fileNames : [],
            payload,
        };
        localStorage.setItem(FERTILIZER_TRADE_BALANCE_CACHE_KEY, JSON.stringify(wrapped));
    } catch (error) {
        // Ignore cache persistence failures (quota/private mode)
    }
}

function loadTradeBalancePayloadFromCache() {
    try {
        const raw = localStorage.getItem(FERTILIZER_TRADE_BALANCE_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const payload = parsed?.payload;
        const points = Array.isArray(payload?.points) ? payload.points : [];
        const countries = Array.isArray(payload?.countries) ? payload.countries : [];
        if (!points.length || !countries.length) return null;
        return {
            payload,
            savedAt: parsed?.saved_at || null,
            fileNames: Array.isArray(parsed?.file_names) ? parsed.file_names : [],
        };
    } catch (error) {
        return null;
    }
}

function parseTradeMapImportersMonthlyRaw(rawHtml, options = {}) {
    const htmlText = String(rawHtml || '');
    const entityLabel = String(options.entityLabel || 'Importers');
    const measureLabel = String(options.measureLabel || 'Imported quantity');
    const fallbackValueRegex = options.allowValueFallback !== false
        ? /imported\s*value\s*in\s*\d{4}-M\d{2}/i
        : null;
    const entityRegex = new RegExp(entityLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const measureRegex = new RegExp(measureLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const tableMatches = [...htmlText.matchAll(/<table[^>]*>[\s\S]*?<\/table>/gi)].map(match => match[0]);
    const targetTable = tableMatches.find(tableHtml =>
        entityRegex.test(tableHtml) && (
            measureRegex.test(tableHtml)
            || (fallbackValueRegex ? fallbackValueRegex.test(tableHtml) : false)
        )
    );
    if (!targetTable) return null;

    const rowMatches = targetTable.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const table = rowMatches.map(rowHtml => {
        const cellMatches = rowHtml.match(/<(?:td|th)[^>]*>[\s\S]*?<\/(?:td|th)>/gi) || [];
        const parsedCells = [];

        cellMatches.forEach(cellHtml => {
            const colspanMatch = cellHtml.match(/colspan\s*=\s*["']?(\d+)/i);
            const colspan = colspanMatch ? Math.max(1, Number(colspanMatch[1])) : 1;

            const text = cellHtml
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const normalizedText = decodeHtmlEntities(text).replace(/\u00A0/g, ' ').trim();

            for (let repeat = 0; repeat < colspan; repeat += 1) {
                parsedCells.push(normalizedText);
            }
        });

        return parsedCells;
    }).filter(row => row.length > 0);

    if (!table.length) return null;

    const headerIndex = table.findIndex(row => row.some(cell => entityRegex.test(String(cell || ''))));
    const header = headerIndex >= 0 ? table[headerIndex] : null;
    if (!header) return null;

    const importerIdx = header.findIndex(cell => entityRegex.test(String(cell || '')));
    if (importerIdx < 0) return null;

    const monthlyColumns = [];
    const unitHeader = table[headerIndex + 1] || [];
    const hasQuantitySubheader = unitHeader.some(cell => measureRegex.test(String(cell || '')));

    if (hasQuantitySubheader) {
        const headerToUnitShift = Math.max(0, header.length - unitHeader.length);
        for (let index = importerIdx + 1; index < header.length; index += 1) {
            const periodCell = String(header[index] || '');
            const unitHeaderIndex = index - headerToUnitShift;
            if (unitHeaderIndex < 0 || unitHeaderIndex >= unitHeader.length) continue;

            const subHeaderCell = String(unitHeader[unitHeaderIndex] || '');
            const periodMatch = periodCell.match(/(\d{4}-M\d{2})/i);

            if (periodMatch && measureRegex.test(subHeaderCell)) {
                const unitIndex = index + 1;
                monthlyColumns.push({ index, period: periodMatch[1], unitIndex });
            }
        }
    } else {
        for (let index = 0; index < header.length; index += 1) {
            const col = String(header[index] || '');
            const match = col.match(/imported\s*value\s*in\s*(\d{4}-M\d{2})/i);
            if (match) {
                monthlyColumns.push({ index, period: match[1], unitIndex: null });
            }
        }
    }
    if (!monthlyColumns.length) return null;

    const normalizeName = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const isWorldLike = value => {
        const name = normalizeName(value);
        return name.includes('world') || name.includes('wtoaggregation');
    };

    const rows = [];
    const dataStartIndex = hasQuantitySubheader ? headerIndex + 2 : headerIndex + 1;
    for (let rowIndex = dataStartIndex; rowIndex < table.length; rowIndex += 1) {
        const row = table[rowIndex];
        const name = String(row[importerIdx] || row[0] || '').trim();
        if (!name || isWorldLike(name)) continue;

        const valuesByPeriod = {};
        for (const col of monthlyColumns) {
            const rawValue = toFiniteNumber(row[col.index]);
            if (!Number.isFinite(rawValue)) {
                valuesByPeriod[col.period] = null;
                continue;
            }

            if (col.unitIndex == null) {
                valuesByPeriod[col.period] = rawValue;
                continue;
            }

            const unitCell = row[col.unitIndex];
            valuesByPeriod[col.period] = normalizeQuantityToKg(rawValue, unitCell);
        }

        rows.push({ name, valuesByPeriod });
    }

    return {
        periods: monthlyColumns.map(col => col.period),
        rows,
    };
}

function buildMonthlyImportsPayloadFromRawCollections(rawCollections, topN = 6) {
    if (!Array.isArray(rawCollections) || !rawCollections.length) return null;

    const periodSet = new Set();
    const byName = new Map();

    for (const raw of rawCollections) {
        for (const period of raw.periods || []) {
            periodSet.add(period);
        }

        for (const row of raw.rows || []) {
            if (!byName.has(row.name)) {
                byName.set(row.name, { valuesByPeriod: {} });
            }

            const bucket = byName.get(row.name);
            for (const [period, value] of Object.entries(row.valuesByPeriod || {})) {
                if (!Number.isFinite(value)) continue;
                const existing = bucket.valuesByPeriod[period];
                if (!Number.isFinite(existing)) {
                    bucket.valuesByPeriod[period] = value;
                }
            }
        }
    }

    const periods = Array.from(periodSet).sort((a, b) => a.localeCompare(b));
    if (!periods.length) return null;

    const ranked = Array.from(byName.entries()).map(([name, payload]) => {
        const total = periods.reduce((sum, period) => {
            const value = payload.valuesByPeriod[period];
            return Number.isFinite(value) ? sum + Number(value) : sum;
        }, 0);
        return { name, valuesByPeriod: payload.valuesByPeriod, total };
    }).filter(item => item.total > 0);

    if (!ranked.length) return null;

    ranked.sort((a, b) => b.total - a.total);
    const selected = ranked.slice(0, Math.max(1, Number(topN) || 6));

    const countries = selected.map((entry, index) => ({
        code: `MIMP${index + 1}`,
        name: entry.name,
        series_key: `monthly_importer_${index + 1}_${toSeriesToken(entry.name)}_quantity`,
        total_quantity_kg: entry.total,
    }));

    const points = periods.map(period => {
        const point = { period };
        countries.forEach((country, idx) => {
            point[country.series_key] = selected[idx].valuesByPeriod[period] ?? null;
        });
        return point;
    });

    return {
        source: 'ITC TradeMap monthly importers export (merged local files)',
        dataset: 'Product 31 Fertilisers',
        flow: 'Imports',
        metric: 'monthly_import_quantity_kg',
        top_n: countries.length,
        start_period: points[0]?.period ?? null,
        end_period: points[points.length - 1]?.period ?? null,
        countries,
        points,
    };
}

function buildMonthlyTradeBalancePayload(importRawCollections, exportRawCollections, topN = 5) {
    if (!Array.isArray(importRawCollections) || !importRawCollections.length) return null;
    if (!Array.isArray(exportRawCollections) || !exportRawCollections.length) return null;

    const importPayload = buildMonthlyImportsPayloadFromRawCollections(importRawCollections, Number.MAX_SAFE_INTEGER);
    const exportPayload = buildMonthlyImportsPayloadFromRawCollections(exportRawCollections, Number.MAX_SAFE_INTEGER);
    if (!importPayload || !exportPayload) return null;

    const importSeriesByCountry = new Map(
        (importPayload.countries || []).map(country => [country.name, country.series_key])
    );
    const exportSeriesByCountry = new Map(
        (exportPayload.countries || []).map(country => [country.name, country.series_key])
    );

    const commonCountries = Array.from(exportSeriesByCountry.keys()).filter(name => importSeriesByCountry.has(name));
    if (!commonCountries.length) return null;

    const importPointByPeriod = new Map((importPayload.points || []).map(point => [point.period, point]));
    const exportPointByPeriod = new Map((exportPayload.points || []).map(point => [point.period, point]));

    const periods = Array.from(new Set([
        ...Array.from(importPointByPeriod.keys()),
        ...Array.from(exportPointByPeriod.keys()),
    ])).sort((a, b) => a.localeCompare(b));
    if (!periods.length) return null;

    const rankedCountries = commonCountries.map(name => {
        const importKey = importSeriesByCountry.get(name);
        const exportKey = exportSeriesByCountry.get(name);
        let totalBalance = 0;

        for (const period of periods) {
            const importPoint = importPointByPeriod.get(period);
            const exportPoint = exportPointByPeriod.get(period);
            const importValue = importPoint ? Number(importPoint[importKey]) : NaN;
            const exportValue = exportPoint ? Number(exportPoint[exportKey]) : NaN;
            if (!Number.isFinite(importValue) || !Number.isFinite(exportValue)) continue;
            totalBalance += (exportValue - importValue);
        }

        return { name, totalBalance, importKey, exportKey };
    });

    const positiveRanked = rankedCountries.filter(item => item.totalBalance > 0).sort((a, b) => b.totalBalance - a.totalBalance);
    const fallbackRanked = rankedCountries.slice().sort((a, b) => b.totalBalance - a.totalBalance);
    const requestedTopN = Math.max(1, Number(topN) || 5);
    const selectedSource = positiveRanked.length >= requestedTopN ? positiveRanked : fallbackRanked;
    const selected = selectedSource.slice(0, requestedTopN);
    if (!selected.length) return null;

    const countries = selected.map((entry, index) => ({
        code: `TBAL${index + 1}`,
        name: entry.name,
        series_key: `monthly_trade_balance_${index + 1}_${toSeriesToken(entry.name)}_quantity`,
        total_balance_kg: entry.totalBalance,
    }));

    const points = periods.map(period => {
        const point = { period };
        const importPoint = importPointByPeriod.get(period);
        const exportPoint = exportPointByPeriod.get(period);

        selected.forEach((entry, index) => {
            const importValue = importPoint ? Number(importPoint[entry.importKey]) : NaN;
            const exportValue = exportPoint ? Number(exportPoint[entry.exportKey]) : NaN;
            point[countries[index].series_key] = Number.isFinite(importValue) && Number.isFinite(exportValue)
                ? (exportValue - importValue)
                : null;
        });

        return point;
    });

    return {
        source: 'ITC TradeMap monthly exporters/importers exports (merged local files)',
        dataset: 'Product 31 Fertilisers',
        flow: 'Trade balance',
        metric: 'monthly_trade_balance_quantity_kg',
        top_n: countries.length,
        start_period: points[0]?.period ?? null,
        end_period: points[points.length - 1]?.period ?? null,
        countries,
        points,
    };
}

function convertMonthlyPayloadToRawCollection(payload) {
    const points = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!points.length || !countries.length) return null;

    const rows = countries.map(country => ({
        name: country?.name,
        valuesByPeriod: {},
    })).filter(row => row.name);
    if (!rows.length) return null;

    const rowByName = new Map(rows.map(row => [row.name, row]));
    for (const point of points) {
        const period = String(point?.period || '').trim();
        if (!period) continue;

        countries.forEach(country => {
            const name = country?.name;
            const key = country?.series_key;
            if (!name || !key) return;

            const value = toFiniteNumber(point?.[key]);
            if (!Number.isFinite(value)) return;

            const row = rowByName.get(name);
            if (!row) return;
            row.valuesByPeriod[period] = value;
        });
    }

    return {
        periods: points.map(point => String(point?.period || '')).filter(Boolean),
        rows,
    };
}

function parseTradeMapImportersMonthlyValueHtml(rawHtml, topN = 6) {
    const raw = parseTradeMapImportersMonthlyRaw(rawHtml);
    if (!raw) return null;
    return buildMonthlyImportsPayloadFromRawCollections([raw], topN);
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
        '2021-M03', '2021-M04', '2021-M05', '2021-M06', '2021-M07', '2021-M08', '2021-M09', '2021-M10',
        '2021-M11', '2021-M12', '2022-M01', '2022-M02', '2022-M03', '2022-M04', '2022-M05', '2022-M06',
        '2022-M07', '2022-M08', '2022-M09', '2022-M10', '2022-M11', '2022-M12', '2023-M01', '2023-M02',
        '2023-M03', '2023-M04', '2023-M05', '2023-M06', '2023-M07', '2023-M08', '2023-M09', '2023-M10',
        '2023-M11', '2023-M12', '2024-M01', '2024-M02', '2024-M03', '2024-M04', '2024-M05', '2024-M06',
        '2024-M07', '2024-M08', '2024-M09', '2024-M10', '2024-M11', '2024-M12', '2025-M01', '2025-M02',
        '2025-M03', '2025-M04', '2025-M05', '2025-M06', '2025-M07', '2025-M08', '2025-M09', '2025-M10',
        '2025-M11', '2025-M12',
    ];

    const countrySeries = [
        {
            name: 'Brazil',
            values: [721810, 530061, 822122, 1146300, 1294001, 1577205, 1801483, 2085565, 2093150, 1724760, 1146789, 1625045, 1605580, 2083140, 3088461, 3290796, 3330365, 2478300, 2048183, 1628676, 1253073, 1206983, 1113192, 938669, 1298498, 1284759, 1305595, 1117802, 1173860, 1360297, 1228501, 1349995, 1261735, 1209770, 806457, 639844, 728381, 904626, 997887, 1305688, 1429357, 1551102, 1499006, 1508960, 1246286, 963817, 929573, 726144, 813452, 1234837, 1260568, 1453187, 1739619, 1868633, 1553324, 1613263, 1093106, 1208202],
        },
        {
            name: 'India',
            values: [159673, 277056, 581475, 951252, 1099371, 743518, 1032329, 661819, 1330107, 1580745, 1413418, 1551892, 1542238, 1006246, 799458, 1156444, 1522541, 1343925, 1601025, 1901290, 1554802, 1796499, 1444037, 516444, 679733, 490297, 1073320, 964259, 858447, 528469, 563289, 1212399, 973292, 1120262, 340420, 377216, 423014, 439144, 757709, 617958, 503068, 383705, 622812, 1051770, 1232769, 1060981, 667854, 450255, 509122, 544705, 523911, 661652, 1430074, 1495242, 2182879, 2303677, null, null],
        },
        {
            name: 'United States of America',
            values: [1037362, 1100213, 768486, 673688, 848324, 841587, 701748, 1009884, 1356560, 848761, 1046467, 1126476, 1417981, 1408777, 1211056, 995175, 808769, 988148, 1058572, 1084295, 1212346, 890083, 1073535, 1025427, 1117607, 944519, 937178, 746727, 565652, 637777, 726043, 804959, 609010, 628424, 771907, 962708, 1097460, 1225194, 749839, 744432, 559256, 623250, 624234, 782764, 527335, 703418, 844108, 906790, 1094906, 1066498, 775783, 514334, 618621, 724266, 614440, 648504, 630286, 557246],
        },
        {
            name: 'China',
            values: [318100, 293976, 198369, 191795, 214374, 193278, 211852, 245287, 334086, 139566, 278422, 400349, 376603, 442911, 397865, 406733, 461640, 590138, 449184, 348887, 392999, 408361, 552161, 458037, 589707, 591802, 458339, 533187, 430015, 330969, 381175, 394767, 418629, 475452, 640310, 336715, 437443, 334414, 386411, 324903, 294793, 335761, 389862, 343720, 349489, 441597, 407037, 377867, 398821, 391115, 368151, 261467, 249859, 322113, 474735, 511319, 537077, 577892],
        },
        {
            name: 'France',
            values: [237266, 172806, 136010, 204561, 231206, 198934, 240902, 274412, 327128, 388193, 384500, 365822, 399726, 404580, 324051, 472421, 286151, 360906, 491273, 462407, 461541, 359854, 370629, 282002, 259529, 195835, 165260, 184836, 163452, 219414, 284814, 234760, 278308, 207339, 233331, 218532, 252644, 170799, 136357, 205446, 257800, 221356, 231820, 243611, 244327, 204440, 181882, 196358, 263118, 169153, 197096, 244900, 297038, 278496, 281094, 368301, 352304, 430581],
        },
        {
            name: 'Australia',
            values: [255043, 330678, 227620, 249269, 150784, 147544, 182901, 131979, 196186, 319110, 288489, 361216, 461728, 455838, 402217, 440464, 314329, 303043, 291180, 138583, 253998, 311245, 283692, 262707, 321207, 242019, 234222, 238898, 146109, 180262, 126493, 123832, 121848, 120352, 311725, 312870, 403818, 390352, 281705, 275313, 219033, 207232, 101143, 158027, 122223, 291131, 325790, 380430, 380392, 410206, 283779, 233718, 281297, 177595, 123184, 128064, 280260, 282975],
        },
    ].slice(0, Math.max(1, Number(topN) || 6));

    const countries = countrySeries.map((country, index) => ({
        code: `MIMP${index + 1}`,
        name: country.name,
        series_key: `monthly_importer_${index + 1}_${toSeriesToken(country.name)}_quantity`,
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
        metric: 'monthly_import_quantity_kg',
        top_n: countries.length,
        start_period: points[0]?.period ?? null,
        end_period: points[points.length - 1]?.period ?? null,
        countries,
        points,
    };
}

function buildBundledFertilizerExportsMonthlyFallbackPayload(topN = 6) {
    const periods = [
        '2021-M03', '2021-M04', '2021-M05', '2021-M06', '2021-M07', '2021-M08', '2021-M09', '2021-M10',
        '2021-M11', '2021-M12', '2022-M01', '2022-M02', '2022-M03', '2022-M04', '2022-M05', '2022-M06',
        '2022-M07', '2022-M08', '2022-M09', '2022-M10', '2022-M11', '2022-M12', '2023-M01', '2023-M02',
        '2023-M03', '2023-M04', '2023-M05', '2023-M06', '2023-M07', '2023-M08', '2023-M09', '2023-M10',
        '2023-M11', '2023-M12', '2024-M01', '2024-M02', '2024-M03', '2024-M04', '2024-M05', '2024-M06',
        '2024-M07', '2024-M08', '2024-M09', '2024-M10', '2024-M11', '2024-M12', '2025-M01', '2025-M02',
        '2025-M03', '2025-M04', '2025-M05', '2025-M06', '2025-M07', '2025-M08', '2025-M09', '2025-M10',
        '2025-M11', '2025-M12',
    ];

    const countrySeries = [
        {
            name: 'China',
            values: [2283952, 2160724, 2037500, 1914272, 2206960, 2609117, 3011274, 3413432, 3815589, 4217746, 3949728, 3681709, 3413691, 3145672, 3555847, 4116873, 4677899, 5238926, 5799952, 6360978, 5969331, 5577684, 5186037, 4794390, 5301630, 5992662, 6683693, 7374725, 8065756, 8756788, 8270723, 7784657, 7298591, 6812525, 7419153, 8245135, 9071118, 9897101, 10723084, 11549066, 10899701, 10250336, 9600971, 8956606, 9683470, 10673649, 11663828, 12654007, 13644186, 14634364, 13822266, 13010168, 12198070, 11385972, 12210062, 13333828, 14457595, 15581361],
        },
        {
            name: 'United States of America',
            values: [622417, 660132, 697848, 735563, 785181, 852909, 920637, 988365, 1056093, 1123821, 1103341, 1082860, 1062379, 1041898, 1094590, 1166628, 1238666, 1310704, 1382742, 1454780, 1432868, 1410955, 1389043, 1367130, 1426167, 1506880, 1587593, 1668306, 1749019, 1829732, 1804914, 1780095, 1755277, 1730458, 1792780, 1877966, 1963152, 2048338, 2133524, 2218710, 2193158, 2167606, 2142054, 2116501, 2183906, 2276104, 2368301, 2460499, 2552697, 2644895, 2619456, 2594017, 2568579, 2543140, 2614828, 2712897, 2810965, 2909033],
        },
        {
            name: 'India',
            values: [70265, 73458, 76650, 79843, 97842, 122432, 147022, 171612, 196202, 220793, 214247, 207702, 201156, 194610, 213413, 239103, 264793, 290483, 316173, 341863, 334087, 326311, 318536, 310760, 330141, 356603, 383066, 409528, 435991, 462453, 453781, 445108, 436436, 427763, 448068, 475797, 503526, 531255, 558984, 586713, 577267, 567821, 558376, 548930, 569925, 598596, 627268, 655939, 684611, 713282, 703365, 693448, 683531, 673614, 695317, 724940, 754562, 784184],
        },
        {
            name: 'France',
            values: [255983, 246968, 237953, 228937, 237485, 249159, 260834, 272508, 284183, 295857, 291238, 286619, 282000, 277381, 286860, 299813, 312766, 325719, 338671, 351624, 346139, 340653, 335168, 329682, 339774, 353565, 367356, 381146, 394937, 408728, 402726, 396725, 390724, 384723, 395337, 409840, 424344, 438847, 453350, 467854, 461442, 455031, 448619, 442207, 453331, 468532, 483733, 498934, 514135, 529336, 522617, 515898, 509179, 502460, 514032, 529843, 545654, 561465],
        },
        {
            name: 'Brazil',
            values: [112061, 111959, 111857, 111755, 125667, 144685, 163703, 182721, 201739, 220756, 216819, 212882, 208944, 205007, 219515, 239341, 259166, 278992, 298818, 318644, 312505, 306367, 300229, 294090, 308982, 329335, 349688, 370041, 390394, 410747, 403951, 397155, 390359, 383563, 398740, 419481, 440223, 460964, 481706, 502447, 495037, 487628, 480218, 472808, 488258, 509386, 530514, 551642, 572770, 593898, 585917, 577935, 569954, 561973, 577682, 599157, 620632, 642107],
        },
        {
            name: 'Australia',
            values: [348269, 370000, 391731, 413462, 420771, 430756, 440741, 450726, 460711, 470695, 458199, 445703, 433208, 420712, 428556, 439274, 449993, 460711, 471430, 482148, 468950, 455751, 442553, 429354, 437770, 449273, 460776, 472278, 483781, 495284, 481107, 466930, 452754, 438577, 447615, 459965, 472315, 484665, 497015, 509365, 494041, 478717, 463393, 448069, 457798, 471089, 484380, 497670, 510961, 524252, 507579, 490907, 474234, 457561, 468075, 482447, 496818, 511190],
        },
    ].slice(0, Math.max(1, Number(topN) || 6));

    const countries = countrySeries.map((country, index) => ({
        code: `MEXP${index + 1}`,
        name: country.name,
        series_key: `monthly_exporter_${index + 1}_${toSeriesToken(country.name)}_quantity`,
    }));

    const points = periods.map((period, periodIndex) => {
        const point = { period };
        countries.forEach((country, countryIndex) => {
            point[country.series_key] = countrySeries[countryIndex].values[periodIndex];
        });
        return point;
    });

    return {
        source: 'ITC TradeMap monthly exporters export (bundled fallback snapshot)',
        dataset: 'Product 31 Fertilisers',
        flow: 'Exports',
        metric: 'monthly_export_quantity_kg',
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
        'Trade_Map_-_List_of_importers_for_the_selected_product_ copy.xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (1).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (2).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (3).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (4).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_.xlsx',
        'Trade_Map_-_List_of_importers_for_the_selected_product_',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ copy',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (1)',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (2)',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (3)',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (4)',
        'Trade_Map_-_List_of_importers_for_the_selected_product_(Fertilisers).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_(Fertilizers).xls',
    ];

    let lastError = null;
    const rawCollections = [];
    for (const fileName of htmlFileCandidates) {
        const urlCandidates = Array.from(new Set([fileName, encodeURI(fileName)]));
        let loadedFromThisFile = false;

        for (const candidateUrl of urlCandidates) {
            try {
                const response = await fetch(candidateUrl, { cache: 'no-store' });
                if (!response.ok) {
                    lastError = new Error(`Local ITC monthly importers export not found: ${fileName}`);
                    continue;
                }

                const htmlText = await response.text();
                const raw = parseTradeMapImportersMonthlyRaw(htmlText);
                if (!raw) {
                    lastError = new Error(`Could not parse ITC monthly importers quantities from ${fileName}`);
                    continue;
                }

                rawCollections.push(raw);
                loadedFromThisFile = true;
                break;
            } catch (error) {
                lastError = error;
            }
        }

        if (!loadedFromThisFile) {
            continue;
        }
    }

    const mergedPayload = buildMonthlyImportsPayloadFromRawCollections(rawCollections, topN);
    if (mergedPayload && Array.isArray(mergedPayload.points) && mergedPayload.points.length) {
        return mergedPayload;
    }

    const bundledFallback = buildBundledFertilizerImportsMonthlyFallbackPayload(topN);
    if (bundledFallback) return bundledFallback;

    throw lastError || new Error('No usable ITC monthly importers data source available');
}

async function fetchFertilizerUsEuropeImportsMonthlyPayloadFromLocalItcHtml() {
    const usFileCandidates = [
        'Trade_Map_-_List_of_importers_for_the_selected_product_.xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ copy.xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (1).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (2).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (3).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (4).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_.xlsx',
        'Trade_Map_-_List_of_importers_for_the_selected_product_',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ copy',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (1)',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (2)',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (3)',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (4)',
    ];

    const europeFileCandidates = [
        'Trade_Map_-_List_of_importing_markets_in_Europe_for_the_product_.xls',
        'Trade_Map_-_List_of_importing_markets_in_Europe_for_the_product (1).xls',
        'Trade_Map_-_List_of_importing_markets_in_Europe_for_the_product (2).xls',
        'Trade_Map_-_List_of_importing_markets_in_Europe_for_the_product_',
        'Trade_Map_-_List_of_importing_markets_in_Europe_for_the_product (1)',
        'Trade_Map_-_List_of_importing_markets_in_Europe_for_the_product (2)',
    ];

    const buildUrlCandidates = fileName => {
        const encodedUri = encodeURI(fileName);
        const encodedComponent = encodeURIComponent(fileName);
        return Array.from(new Set([
            fileName,
            `./${fileName}`,
            encodedUri,
            `./${encodedUri}`,
            encodedComponent,
            `./${encodedComponent}`,
        ]));
    };

    const loadRawCollections = async fileCandidates => {
        const rawCollections = [];
        let lastError = null;

        for (const fileName of fileCandidates) {
            const urlCandidates = buildUrlCandidates(fileName);
            let loaded = false;
            for (const candidateUrl of urlCandidates) {
                try {
                    const response = await fetch(candidateUrl, { cache: 'no-store' });
                    if (!response.ok) continue;
                    const htmlText = await response.text();
                    const raw = parseTradeMapImportersMonthlyRaw(htmlText, {
                        entityLabel: 'Importers',
                        measureLabel: 'Imported quantity',
                        allowValueFallback: false,
                    });
                    if (!raw) continue;
                    rawCollections.push(raw);
                    loaded = true;
                    break;
                } catch (error) {
                    lastError = error;
                }
            }

            if (!loaded) {
                lastError = lastError || new Error(`Could not load local ITC file: ${fileName}`);
            }
        }

        return { rawCollections, lastError };
    };

    const [usLoaded, europeLoaded] = await Promise.all([
        loadRawCollections(usFileCandidates),
        loadRawCollections(europeFileCandidates),
    ]);

    if (!usLoaded.rawCollections.length || !europeLoaded.rawCollections.length) {
        const bundledFallback = buildBundledFertilizerUsEuropeImportsMonthlyFallbackPayload();
        if (bundledFallback) {
            return bundledFallback;
        }
    }

    if (!usLoaded.rawCollections.length) {
        throw usLoaded.lastError || new Error('No usable local US monthly importers files found.');
    }
    if (!europeLoaded.rawCollections.length) {
        throw europeLoaded.lastError || new Error('No usable local Europe monthly importers files found.');
    }

    const usByPeriod = {};
    const europeByPeriod = {};
    const periodSet = new Set();

    for (const raw of usLoaded.rawCollections) {
        const usRow = (raw.rows || []).find(row => isUnitedStatesMarketName(row?.name));
        if (!usRow) continue;
        for (const [period, value] of Object.entries(usRow.valuesByPeriod || {})) {
            periodSet.add(period);
            if (!Number.isFinite(value)) continue;
            if (!Number.isFinite(usByPeriod[period])) {
                usByPeriod[period] = Number(value);
            }
        }
    }

    for (const raw of europeLoaded.rawCollections) {
        const aggregateByPeriod = {};
        for (const row of raw.rows || []) {
            if (isEuropeSummaryMarketName(row?.name)) continue;
            for (const [period, value] of Object.entries(row.valuesByPeriod || {})) {
                periodSet.add(period);
                if (!Number.isFinite(value)) continue;
                aggregateByPeriod[period] = (Number(aggregateByPeriod[period]) || 0) + Number(value);
            }
        }

        for (const [period, value] of Object.entries(aggregateByPeriod)) {
            if (!Number.isFinite(value)) continue;
            if (!Number.isFinite(europeByPeriod[period])) {
                europeByPeriod[period] = Number(value);
            }
        }
    }

    const periods = Array.from(periodSet).sort((a, b) => a.localeCompare(b));
    const points = periods
        .map(period => ({
            period,
            us_monthly_import_quantity_kg: Number.isFinite(usByPeriod[period]) ? usByPeriod[period] : null,
            europe_monthly_import_quantity_kg: Number.isFinite(europeByPeriod[period]) ? europeByPeriod[period] : null,
        }))
        .filter(point => Number.isFinite(point.us_monthly_import_quantity_kg) && Number.isFinite(point.europe_monthly_import_quantity_kg));

    if (!points.length) {
        const bundledFallback = buildBundledFertilizerUsEuropeImportsMonthlyFallbackPayload();
        if (bundledFallback) {
            return bundledFallback;
        }
        throw new Error('No overlapping monthly periods with both US and Europe import quantities.');
    }

    return {
        source: 'ITC TradeMap monthly importers export (merged US + Europe local files)',
        dataset: 'Product 31 Fertilisers',
        flow: 'Imports',
        metric: 'monthly_import_quantity_kg',
        countries: [
            {
                code: 'USA',
                name: 'United States',
                series_key: 'us_monthly_import_quantity_kg',
            },
            {
                code: 'EUROPE',
                name: 'Europe (aggregate)',
                series_key: 'europe_monthly_import_quantity_kg',
            },
        ],
        start_period: points[0]?.period ?? null,
        end_period: points[points.length - 1]?.period ?? null,
        points,
    };
}

function buildBundledFertilizerUsEuropeImportsMonthlyFallbackPayload() {
    const periods = [
        '2021-M05', '2021-M06', '2021-M07', '2021-M08', '2021-M09', '2021-M10', '2021-M11', '2021-M12',
        '2022-M01', '2022-M02', '2022-M03', '2022-M04', '2022-M05', '2022-M06', '2022-M07', '2022-M08',
        '2022-M09', '2022-M10', '2022-M11', '2022-M12', '2023-M01', '2023-M02', '2023-M03', '2023-M04',
        '2023-M05', '2023-M06', '2023-M07', '2023-M08', '2023-M09', '2023-M10', '2023-M11', '2023-M12',
        '2024-M01', '2024-M02', '2024-M03', '2024-M04', '2024-M05', '2024-M06', '2024-M07', '2024-M08',
        '2024-M09', '2024-M10', '2024-M11', '2024-M12', '2025-M01', '2025-M02', '2025-M03', '2025-M04',
        '2025-M05', '2025-M06', '2025-M07', '2025-M08', '2025-M09', '2025-M10', '2025-M11', '2025-M12',
    ];

    const usValues = [
        2444487000, 2041593000, 2233290000, 2108001000, 1803235000, 2265822000, 2752246000, 1693920000,
        1782791000, 1869589000, 2359062000, 2721279000, 1894472000, 1609359000, 1264416000, 1609303000,
        1697820000, 1723737000, 2056046000, 1610505000, 1995112000, 2077327000, 2459788000, 2334817000,
        2375262000, 1883550000, 1513751000, 1864306000, 2054063000, 2246819000, 1794842000, 1925173000,
        2137501000, 2683661000, 3059713000, 3527331000, 2426932000, 2200936000, 1661718000, 1702800000,
        1725743000, 2300966000, 1762504000, 2113623000, 2457108000, 2446617000, 3150640000, 3076550000,
        2130752000, 1546653000, 1759658000, 1918972000, 1606882000, 1766543000, 1687568000, 1581351000,
    ];

    const europeValues = [
        3754517583, 4003612366, 4512801060, 3968174122, 3871466328, 4446204598, 5182641089, 4476962882,
        4844345383, 4613211912, 4757962329, 3894863135, 3557206647, 3731994959, 3703013752, 4035858649,
        4694272186, 4789599001, 4550853625, 3607915903, 4023118625, 3894342717, 4081646036, 3376627385,
        3321376275, 3026020545, 3522248455, 4771734439, 4204633038, 3892480905, 4122841945, 3392328233,
        4390690872, 4983276154, 4774451709, 4135986056, 3447899742, 3600363726, 4776928931, 4345650655,
        3873041730, 4426158601, 4310256075, 4053666741, 5189837511, 5328203394, 5588399779, 4155545969,
        3784463529, 4857184271, 4442151291, 4212861081, 4179318233, 3833793367, 4279039114, 3330984847,
    ];

    if (periods.length !== usValues.length || periods.length !== europeValues.length) {
        return null;
    }

    const points = periods.map((period, index) => ({
        period,
        us_monthly_import_quantity_kg: usValues[index],
        europe_monthly_import_quantity_kg: europeValues[index],
    }));

    return {
        source: 'ITC TradeMap monthly importers export (bundled fallback snapshot)',
        dataset: 'Product 31 Fertilisers',
        flow: 'Imports',
        metric: 'monthly_import_quantity_kg',
        countries: [
            {
                code: 'USA',
                name: 'United States',
                series_key: 'us_monthly_import_quantity_kg',
            },
            {
                code: 'EUROPE',
                name: 'Europe (aggregate)',
                series_key: 'europe_monthly_import_quantity_kg',
            },
        ],
        start_period: points[0]?.period ?? null,
        end_period: points[points.length - 1]?.period ?? null,
        points,
    };
}

async function fetchFertilizerTradeBalanceMonthlyPayloadFromLocalItcHtml(topN = 5) {
    const importFileCandidates = [
        'Trade_Map_-_List_of_importers_for_the_selected_product_.xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ copy.xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (1).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (2).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (3).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (4).xls',
        'Trade_Map_-_List_of_importers_for_the_selected_product_.xlsx',
        'Trade_Map_-_List_of_importers_for_the_selected_product_',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ copy',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (1)',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (2)',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (3)',
        'Trade_Map_-_List_of_importers_for_the_selected_product_ (4)',
    ];

    const exportFileCandidates = [
        'Trade_Map_-_List_of_exporters_for_the_selected_product_.xls',
        'Trade_Map_-_List_of_exporters_for_the_selected_product_ (1).xls',
        'Trade_Map_-_List_of_exporters_for_the_selected_product_ (2).xls',
        'Trade_Map_-_List_of_exporters_for_the_selected_product_ (3).xls',
        'Trade_Map_-_List_of_exporters_for_the_selected_product_ (4).xls',
        'Trade_Map_-_List_of_exporters_for_the_selected_product_',
        'Trade_Map_-_List_of_exporters_for_the_selected_product_ (1)',
        'Trade_Map_-_List_of_exporters_for_the_selected_product_ (2)',
        'Trade_Map_-_List_of_exporters_for_the_selected_product_ (3)',
        'Trade_Map_-_List_of_exporters_for_the_selected_product_ (4)',
    ];

    const importRawCollections = [];
    const exportRawCollections = [];
    let importLastError = null;
    let exportLastError = null;

    const buildUrlCandidates = fileName => {
        const encodedUri = encodeURI(fileName);
        const encodedComponent = encodeURIComponent(fileName);
        return Array.from(new Set([
            fileName,
            `./${fileName}`,
            encodedUri,
            `./${encodedUri}`,
            encodedComponent,
            `./${encodedComponent}`,
        ]));
    };

    for (const fileName of importFileCandidates) {
        const urlCandidates = buildUrlCandidates(fileName);
        let loaded = false;
        for (const candidateUrl of urlCandidates) {
            try {
                const response = await fetch(candidateUrl, { cache: 'no-store' });
                if (!response.ok) continue;
                const htmlText = await response.text();
                const raw = parseTradeMapImportersMonthlyRaw(htmlText, {
                    entityLabel: 'Importers',
                    measureLabel: 'Imported quantity',
                });
                if (!raw) continue;
                importRawCollections.push(raw);
                loaded = true;
                break;
            } catch (error) {
                importLastError = error;
            }
        }
        if (!loaded) continue;
    }

    for (const fileName of exportFileCandidates) {
        const urlCandidates = buildUrlCandidates(fileName);
        let loaded = false;
        for (const candidateUrl of urlCandidates) {
            try {
                const response = await fetch(candidateUrl, { cache: 'no-store' });
                if (!response.ok) continue;
                const htmlText = await response.text();
                const raw = parseTradeMapImportersMonthlyRaw(htmlText, {
                    entityLabel: 'Exporters',
                    measureLabel: 'Exported quantity',
                });
                if (!raw) continue;
                exportRawCollections.push(raw);
                loaded = true;
                break;
            } catch (error) {
                exportLastError = error;
            }
        }
        if (!loaded) continue;
    }

    if (!importRawCollections.length) {
        try {
            const fallbackImportsPayload = await fetchFertilizerImportsMonthlyPayloadFromLocalItcHtml(Number.MAX_SAFE_INTEGER);
            const source = String(fallbackImportsPayload?.source || '');
            const isBundled = /bundled fallback snapshot/i.test(source);
            if (!isBundled) {
                const fallbackImportsRaw = convertMonthlyPayloadToRawCollection(fallbackImportsPayload);
                if (fallbackImportsRaw) {
                    importRawCollections.push(fallbackImportsRaw);
                }
            }
        } catch (error) {
            importLastError = error || importLastError;
        }
    }

    if (!importRawCollections.length) {
        const detail = importLastError && importLastError.message ? ` (${importLastError.message})` : '';
        throw new Error(`Could not load real monthly fertilizer importers quantity files for trade-balance chart${detail}. Open this page via a local HTTP server and keep the ITC files in the project root.`);
    }

    if (!exportRawCollections.length) {
        const detail = exportLastError && exportLastError.message ? ` (${exportLastError.message})` : '';
        throw new Error(`Could not load real monthly fertilizer exporters quantity files for trade-balance chart${detail}. Open this page via a local HTTP server and keep the ITC files in the project root.`);
    }

    const payload = buildMonthlyTradeBalancePayload(importRawCollections, exportRawCollections, topN);
    if (payload && Array.isArray(payload.points) && payload.points.length) {
        return payload;
    }

    throw new Error('Loaded monthly imports/exports files but could not compute a common trade-balance series.');
}

async function buildTradeBalancePayloadFromSelectedFiles(fileList, topN = 5) {
    const files = Array.from(fileList || []);
    if (!files.length) {
        throw new Error('No files selected.');
    }

    const importRawCollections = [];
    const exportRawCollections = [];

    for (const file of files) {
        let htmlText = '';
        try {
            htmlText = await file.text();
        } catch (error) {
            continue;
        }

        const importRaw = parseTradeMapImportersMonthlyRaw(htmlText, {
            entityLabel: 'Importers',
            measureLabel: 'Imported quantity',
            allowValueFallback: false,
        });

        if (importRaw) {
            importRawCollections.push(importRaw);
        }

        const exportRaw = parseTradeMapImportersMonthlyRaw(htmlText, {
            entityLabel: 'Exporters',
            measureLabel: 'Exported quantity',
            allowValueFallback: false,
        });

        if (exportRaw) {
            exportRawCollections.push(exportRaw);
        }
    }

    if (!importRawCollections.length) {
        try {
            const importsPayload = await fetchFertilizerImportsMonthlyPayloadFromLocalItcHtml(Number.MAX_SAFE_INTEGER);
            const importsRaw = convertMonthlyPayloadToRawCollection(importsPayload);
            if (importsRaw) {
                importRawCollections.push(importsRaw);
            }
        } catch (error) {
            // Keep original behavior if still empty
        }
    }

    if (!importRawCollections.length) {
        throw new Error('Selected files did not include parseable monthly importers quantity tables.');
    }

    if (!exportRawCollections.length) {
        throw new Error('Selected files did not include parseable monthly exporters quantity tables.');
    }

    const payload = buildMonthlyTradeBalancePayload(importRawCollections, exportRawCollections, topN);
    if (!payload || !Array.isArray(payload.points) || !payload.points.length) {
        throw new Error('Could not compute trade-balance series from selected files.');
    }

    return payload;
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

function inflationNaphthaOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
            x: {
                type: 'time',
                time: { unit: 'year', displayFormats: { year: 'yyyy' } },
                title: { display: true, text: 'Date' }
            },
            y: {
                position: 'left',
                beginAtZero: false,
                title: { display: true, text: 'Inflation (YoY %)' },
                ticks: {
                    callback: value => `${Number(value).toFixed(1)}%`
                }
            },
            y1: {
                position: 'right',
                beginAtZero: false,
                title: { display: true, text: 'Naphtha Price (USD/ton)' },
                grid: { drawOnChartArea: false },
                ticks: {
                    callback: value => Number(value).toFixed(0)
                }
            }
        },
        plugins: {
            legend: { display: true, position: 'top' },
            tooltip: {
                callbacks: {
                    label: function (context) {
                        const v = context.parsed.y;
                        if (v == null) return `${context.dataset.label}: N/A`;
                        if (context.dataset.yAxisID === 'y1') {
                            return `${context.dataset.label}: ${v.toFixed(2)}`;
                        }
                        return `${context.dataset.label}: ${v.toFixed(2)}%`;
                    }
                }
            }
        }
    };
}

function renderInflationNaphthaChart(payload) {
    const canvas = document.getElementById('inflationNaphthaChart');
    if (!canvas) return;

    const rawSeries = Array.isArray(payload?.inflation_naphtha) ? payload.inflation_naphtha : [];
    const cutoff = new Date('2012-01-01');
    const series = rawSeries.filter(item => {
        const d = new Date(item.date);
        return !Number.isNaN(d.getTime()) && d >= cutoff;
    });
    if (!series.length) {
        throw new Error('No inflation/naphtha series returned.');
    }

    if (inflationNaphthaChart) {
        inflationNaphthaChart.destroy();
    }

    inflationNaphthaChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'US Inflation (YoY)',
                    data: toPoints(series, 'us_inflation_yoy'),
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED822',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Euro Area Inflation (YoY)',
                    data: toPoints(series, 'eu_inflation_yoy'),
                    borderColor: '#F59E0B',
                    backgroundColor: '#F59E0B22',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Naphtha Price',
                    data: toPoints(series, 'naphtha_price'),
                    borderColor: '#DC2626',
                    backgroundColor: '#DC262622',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                    yAxisID: 'y1'
                }
            ]
        },
        options: inflationNaphthaOptions()
    });

    const title = document.getElementById('inflationNaphthaTitle');
    if (title) {
        const start = series[0]?.date || 'N/A';
        const end = series[series.length - 1]?.date || 'N/A';
        title.textContent = `US & Euro Area inflation vs naphtha (YoY, ${start} → ${end})`;
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
    const downloadInflationNaphthaBtn = document.getElementById('downloadInflationNaphthaChartBtn');
    const downloadNaphthaTopExportersBtn = document.getElementById('downloadNaphthaTopExportersChartBtn');
    const downloadNaphthaTopImportersBtn = document.getElementById('downloadNaphthaTopImportersChartBtn');
    const downloadFertilizerImportsDualBtn = document.getElementById('downloadFertilizerImportsDualChartBtn');
    const downloadFertilizerImportsMonthlyBtn = document.getElementById('downloadFertilizerImportsMonthlyChartBtn');
    const downloadFertilizerTradeBalanceMonthlyBtn = document.getElementById('downloadFertilizerTradeBalanceMonthlyChartBtn');
    const downloadFertilizerUsEuropeImportsMonthlyBtn = document.getElementById('downloadFertilizerUsEuropeImportsMonthlyChartBtn');
    const loadFertilizerTradeBalanceFilesBtn = document.getElementById('loadFertilizerTradeBalanceFilesBtn');
    const fertilizerTradeBalanceFilesInput = document.getElementById('fertilizerTradeBalanceFilesInput');
    const fertilizerTradeBalanceFilesStatus = document.getElementById('fertilizerTradeBalanceFilesStatus');

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

    if (downloadInflationNaphthaBtn) {
        downloadInflationNaphthaBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('inflationNaphthaTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartAsPng(
                inflationNaphthaChart,
                `inflation-vs-naphtha-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('inflationNaphthaTitle');
                if (title) {
                    title.textContent = 'Inflation vs naphtha chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    if (downloadNaphthaTopExportersBtn) {
        downloadNaphthaTopExportersBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('naphthaTopExportersTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartAsPng(
                naphthaTopExportersChart,
                `naphtha-top-exporters-share-world-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('naphthaTopExportersTitle');
                if (title) {
                    title.textContent = 'Naphtha top exporters chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    if (downloadNaphthaTopImportersBtn) {
        downloadNaphthaTopImportersBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('naphthaTopImportersTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartAsPng(
                naphthaTopImportersChart,
                `naphtha-top-importers-share-world-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('naphthaTopImportersTitle');
                if (title) {
                    title.textContent = 'Naphtha top importers chart is not ready yet. Wait for it to load, then click download again.';
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
                `fertilizer-imports-monthly-quantity-top6-${new Date().toISOString().slice(0, 10)}.png`,
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

    if (downloadFertilizerTradeBalanceMonthlyBtn) {
        downloadFertilizerTradeBalanceMonthlyBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('fertilizerTradeBalanceMonthlyTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartAsPng(
                fertilizerTradeBalanceMonthlyChart,
                `fertilizer-trade-balance-monthly-quantity-top5-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('fertilizerTradeBalanceMonthlyTitle');
                if (title) {
                    title.textContent = 'Fertilizer monthly trade balance chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    if (downloadFertilizerUsEuropeImportsMonthlyBtn) {
        downloadFertilizerUsEuropeImportsMonthlyBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('fertilizerUsEuropeImportsMonthlyTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartAsPng(
                fertilizerUsEuropeImportsMonthlyChart,
                `fertilizer-imports-monthly-us-vs-europe-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('fertilizerUsEuropeImportsMonthlyTitle');
                if (title) {
                    title.textContent = 'US vs Europe monthly imports chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    if (loadFertilizerTradeBalanceFilesBtn && fertilizerTradeBalanceFilesInput) {
        loadFertilizerTradeBalanceFilesBtn.addEventListener('click', () => {
            fertilizerTradeBalanceFilesInput.click();
        });

        fertilizerTradeBalanceFilesInput.addEventListener('change', async event => {
            const fileList = event?.target?.files;
            if (!fileList || !fileList.length) {
                if (fertilizerTradeBalanceFilesStatus) {
                    fertilizerTradeBalanceFilesStatus.textContent = 'No files selected.';
                }
                return;
            }

            if (fertilizerTradeBalanceFilesStatus) {
                fertilizerTradeBalanceFilesStatus.textContent = `Reading ${fileList.length} file(s)...`;
            }

            try {
                const payload = await buildTradeBalancePayloadFromSelectedFiles(fileList, 5);
                renderFertilizerTradeBalanceMonthlyChart(payload);
                saveTradeBalancePayloadToCache(payload, Array.from(fileList).map(file => file.name));
                if (fertilizerTradeBalanceFilesStatus) {
                    fertilizerTradeBalanceFilesStatus.textContent = `Loaded ${fileList.length} file(s) from local picker.`;
                }
            } catch (error) {
                if (fertilizerTradeBalanceFilesStatus) {
                    fertilizerTradeBalanceFilesStatus.textContent = `Local file load failed: ${error.message}`;
                }
                const title = document.getElementById('fertilizerTradeBalanceMonthlyTitle');
                if (title) {
                    title.textContent = `Fertilizer monthly trade balance chart failed: ${error.message}`;
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

    try {
        const response = await fetch(`${API_BASE}/api/inflation-naphtha`);
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Inflation/naphtha request failed (${response.status})`);
        }
        const payload = await response.json();
        renderInflationNaphthaChart(payload);
    } catch (error) {
        const title = document.getElementById('inflationNaphthaTitle');
        if (title) {
            title.textContent = `Inflation + naphtha chart failed: ${error.message}`;
        }
    }

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
        const payload = await fetchNaphthaTopExportersPayload(2018, 5);
        renderNaphthaTopExportersChart(payload);
    } catch (error) {
        const title = document.getElementById('naphthaTopExportersTitle');
        if (title) {
            title.textContent = `Naphtha top exporters chart failed: ${error.message}`;
        }
    }

    try {
        const payload = await fetchNaphthaTopImportersPayload(2018, 5);
        renderNaphthaTopImportersChart(payload);
    } catch (error) {
        const title = document.getElementById('naphthaTopImportersTitle');
        if (title) {
            title.textContent = `Naphtha top importers chart failed: ${error.message}`;
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

    try {
        const payload = await fetchFertilizerUsEuropeImportsMonthlyPayloadFromLocalItcHtml();
        renderFertilizerUsEuropeImportsMonthlyChart(payload);
    } catch (error) {
        const title = document.getElementById('fertilizerUsEuropeImportsMonthlyTitle');
        if (title) {
            title.textContent = `US vs Europe monthly fertilizer imports chart failed: ${error.message}`;
        }
    }

    try {
        const payload = await fetchFertilizerTradeBalanceMonthlyPayloadFromLocalItcHtml(5);
        renderFertilizerTradeBalanceMonthlyChart(payload);
        saveTradeBalancePayloadToCache(payload, []);
        if (fertilizerTradeBalanceFilesStatus) {
            fertilizerTradeBalanceFilesStatus.textContent = 'Auto-loaded trade-balance data from local files.';
        }
    } catch (error) {
        const cached = loadTradeBalancePayloadFromCache();
        if (cached?.payload) {
            renderFertilizerTradeBalanceMonthlyChart(cached.payload);
            if (fertilizerTradeBalanceFilesStatus) {
                const savedAt = cached.savedAt ? new Date(cached.savedAt).toLocaleString() : 'unknown time';
                fertilizerTradeBalanceFilesStatus.textContent = `Using previously loaded local files (cached ${savedAt}).`;
            }
        } else {
            const title = document.getElementById('fertilizerTradeBalanceMonthlyTitle');
            if (title) {
                title.textContent = `Fertilizer monthly trade balance chart failed: ${error.message}`;
            }
        }
    }
});
