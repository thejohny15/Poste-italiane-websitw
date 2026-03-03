let digitalIntensityChart = null;
let companySizeShareChart = null;
const diiVeryHighVsProductivityCharts = {};
let sizeVsProductivityLevelScatterChart250 = null;
let sizeVsProductivityLevelScatterChart50to249 = null;
let sizeVsProductivityLevelScatterChart10to49 = null;
let sizeVsProductivityScatterChart250 = null;
let sizeVsProductivityScatterChart50to249 = null;
let sizeVsProductivityScatterChart10to49 = null;
let veryHighTrendChart = null;
let trendChangeChart = null;
let companySizeGrowthTrendChart = null;
let companyGrowthVsDigitalIntensityChart = null;
let registrationGrowthTrendChart = null;
let bankruptcyGrowthTrendChart = null;
let productivityBankruptcyR2TrendChart = null;
let productivityBankruptcyScatter2024Chart = null;
let productivityRegistrationR2TrendChart = null;
let productivityRegistrationScatter2024Chart = null;
let netBusinessDynamicsBalanceTrendChart = null;
let productivityNetBusinessDynamicsR2TrendChart = null;
let productivityNetBusinessDynamicsScatter2024Chart = null;
let isChartsLoading = false;

const API_BASE = 'http://localhost:5001';
const COUNTRY_LABEL_MIN_FONT_SIZE = 13;
const LEGEND_FONT_SIZE = 15;
const GLOBAL_CHART_FONT_SIZE = 14;
const BAR_LEGEND_FONT_SIZE = 16;
const BAR_AXIS_TICK_FONT_SIZE = 15;
const BAR_AXIS_TITLE_FONT_SIZE = 15;

if (typeof Chart !== 'undefined' && Chart.defaults) {
    Chart.defaults.font = {
        ...(Chart.defaults.font || {}),
        size: GLOBAL_CHART_FONT_SIZE
    };

    const existingLegendLabels = ((Chart.defaults.plugins || {}).legend || {}).labels || {};
    const existingLegendFont = existingLegendLabels.font || {};
    Chart.defaults.plugins = Chart.defaults.plugins || {};
    Chart.defaults.plugins.legend = Chart.defaults.plugins.legend || {};
    Chart.defaults.plugins.legend.labels = {
        ...existingLegendLabels,
        font: {
            ...existingLegendFont,
            size: LEGEND_FONT_SIZE
        }
    };
}

const AGG_GEO_CODE = 'EZ_AGG';
function applyBarChartTypography(options) {
    const next = {
        ...options,
        scales: {
            ...(options.scales || {})
        },
        plugins: {
            ...(options.plugins || {})
        }
    };

    const legend = next.plugins.legend || {};
    const legendLabels = legend.labels || {};
    const legendFont = legendLabels.font || {};
    next.plugins.legend = {
        ...legend,
        labels: {
            ...legendLabels,
            font: {
                ...legendFont,
                size: BAR_LEGEND_FONT_SIZE
            }
        }
    };

    ['x', 'y'].forEach(axis => {
        const axisConfig = next.scales[axis];
        if (!axisConfig) return;

        const axisTicks = axisConfig.ticks || {};
        const axisTickFont = axisTicks.font || {};
        const axisTitle = axisConfig.title || {};
        const axisTitleFont = axisTitle.font || {};

        next.scales[axis] = {
            ...axisConfig,
            ticks: {
                ...axisTicks,
                font: {
                    ...axisTickFont,
                    size: BAR_AXIS_TICK_FONT_SIZE
                }
            },
            title: {
                ...axisTitle,
                font: {
                    ...axisTitleFont,
                    size: BAR_AXIS_TITLE_FONT_SIZE
                }
            }
        };
    });

    return next;
}

const countryPointLabelPlugin = {
    id: 'countryPointLabels',
    afterDatasetsDraw(chart, args, pluginOptions) {
        const opts = pluginOptions || {};
        if (opts.enabled === false) return;

        const ctx = chart.ctx;
        const color = opts.color || '#374151';
        const fontSize = Math.max(opts.fontSize || COUNTRY_LABEL_MIN_FONT_SIZE, COUNTRY_LABEL_MIN_FONT_SIZE);
        const offsetX = opts.offsetX || 6;
        const offsetY = opts.offsetY || -6;

        ctx.save();
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        chart.data.datasets.forEach((dataset, datasetIndex) => {
            if (!dataset || dataset.label === 'Trend line') return;
            const meta = chart.getDatasetMeta(datasetIndex);
            if (!meta || meta.hidden) return;

            meta.data.forEach((point, index) => {
                const raw = dataset.data && dataset.data[index];
                if (!raw || !raw.country || raw.x == null || raw.y == null) return;
                ctx.fillText(String(raw.country), point.x + offsetX, point.y + offsetY);
            });
        });

        ctx.restore();
    }
};
const SIZE_CONFIG = {
    '10-49': {
        shortLabel: '10-49 employees',
        subtitleText: 'Enterprises (10 to 49 persons employed) · Year 2025 · Eurostat'
    },
    '50-249': {
        shortLabel: '50-249 employees',
        subtitleText: 'Enterprises (50 to 249 persons employed) · Year 2025 · Eurostat'
    },
    '10-249': {
        shortLabel: '10-249 employees',
        subtitleText: 'Enterprises (10 to 249 persons employed) · Year 2025 · Eurostat'
    },
    'GE10': {
        shortLabel: '10+ employees',
        subtitleText: 'Enterprises (10 or more persons employed) · Year 2025 · Eurostat'
    },
    'GE250': {
        shortLabel: '250+ employees',
        subtitleText: 'Enterprises (250 or more persons employed) · Year 2025 · Eurostat'
    }
};
const TREND_INDICATOR_CONFIG = {
    'E_DI3_VHI': { shortLabel: 'Very high' },
    'E_DI3_HI': { shortLabel: 'High' },
    'E_DI3_LO': { shortLabel: 'Low' },
    'E_DI3_VLO': { shortLabel: 'Very low' }
};
const NACE_CONFIG = {
    'J': {
        label: 'Information and communication'
    },
    'K-N': {
        label: 'Financial and insurance activities; real estate activities; professional, scientific and technical activities; administrative and support service activities'
    },
    'B-S_X_O_S94': {
        label: 'Industry, construction and market services (except public administration and defence; compulsory social security; activities of membership organisations)'
    },
    'B-N_S95_X_K': {
        label: 'Industry, construction and market services (except public administration and defence; compulsory social security; activities of membership organisations)'
    }
};

function getSelectedSizeEmp() {
    const raw = new URLSearchParams(window.location.search).get('size_emp') || '10-249';
    return SIZE_CONFIG[raw] ? raw : '10-249';
}

function getSelectedTrendIndicator() {
    const raw = new URLSearchParams(window.location.search).get('indic_is') || 'E_DI3_VHI';
    return TREND_INDICATOR_CONFIG[raw] ? raw : 'E_DI3_VHI';
}

function getSelectedNaceR2() {
    const raw = new URLSearchParams(window.location.search).get('nace_r2') || 'J';
    return NACE_CONFIG[raw] ? raw : 'J';
}

function setQueryParamAndReload(key, value) {
    const params = new URLSearchParams(window.location.search);
    params.set(key, value);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.location.href = newUrl;
}

function slugifyForFilename(input) {
    return String(input || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function getAllRenderedChartsForExport() {
    const charts = [];
    const seenCanvasIds = new Set();

    const addChart = (chart) => {
        if (!chart || !chart.canvas) return;
        const canvasId = chart.canvas.id || '';
        if (canvasId && seenCanvasIds.has(canvasId)) return;
        if (canvasId) seenCanvasIds.add(canvasId);
        charts.push(chart);
    };

    const chartInstances = Chart && Chart.instances ? Object.values(Chart.instances) : [];
    chartInstances.forEach(addChart);

    const main = document.querySelector('main');
    if (main && typeof Chart.getChart === 'function') {
        const canvases = Array.from(main.querySelectorAll('canvas'));
        canvases.forEach(canvas => addChart(Chart.getChart(canvas)));
    }

    return charts;
}

function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
        if (!canvas || typeof canvas.toBlob !== 'function') {
            reject(new Error('Canvas blob export is not supported in this browser.'));
            return;
        }
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Unable to export canvas to blob.'));
                return;
            }
            resolve(blob);
        }, 'image/png', 1);
    });
}

function getChartTitleText(chart) {
    if (!chart || !chart.canvas) return '';

    const container = chart.canvas.closest('.chart-container');
    if (container) {
        const titleElement = container.querySelector('.chart-title');
        if (titleElement && titleElement.textContent) {
            return String(titleElement.textContent).trim();
        }
    }

    const pluginTitle = (((chart.options || {}).plugins || {}).title || {}).text;
    if (Array.isArray(pluginTitle)) {
        return pluginTitle.join(' ').trim();
    }
    return pluginTitle ? String(pluginTitle).trim() : '';
}

function wrapTextLines(ctx, text, maxWidth) {
    const raw = String(text || '').trim();
    if (!raw) return [];

    const words = raw.split(/\s+/);
    const lines = [];
    let line = '';

    words.forEach(word => {
        const candidate = line ? `${line} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxWidth) {
            line = candidate;
            return;
        }
        if (line) lines.push(line);
        line = word;
    });

    if (line) lines.push(line);
    return lines;
}

async function chartToTitledBlob(chart) {
    const canvas = chart && chart.canvas;
    if (!canvas) {
        throw new Error('Chart canvas unavailable for export.');
    }

    const title = getChartTitleText(chart);
    if (!title) {
        return canvasToBlob(canvas);
    }

    const titlePaddingTop = 24;
    const titlePaddingBottom = 16;
    const sidePadding = 28;
    const lineHeight = 34;
    const titleFontPx = 28;

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = canvas.width;

    const outputCtx = outputCanvas.getContext('2d');
    if (!outputCtx) {
        return canvasToBlob(canvas);
    }

    outputCtx.font = `700 ${titleFontPx}px sans-serif`;
    const maxTextWidth = Math.max(120, outputCanvas.width - sidePadding * 2);
    const titleLines = wrapTextLines(outputCtx, title, maxTextWidth);
    const titleHeight = titleLines.length
        ? (titlePaddingTop + (titleLines.length * lineHeight) + titlePaddingBottom)
        : 0;

    outputCanvas.height = canvas.height + titleHeight;

    outputCtx.fillStyle = '#FFFFFF';
    outputCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

    if (titleLines.length) {
        outputCtx.font = `700 ${titleFontPx}px sans-serif`;
        outputCtx.fillStyle = '#0F172A';
        outputCtx.textAlign = 'center';
        outputCtx.textBaseline = 'top';
        titleLines.forEach((line, index) => {
            const y = titlePaddingTop + (index * lineHeight);
            outputCtx.fillText(line, outputCanvas.width / 2, y);
        });
    }

    outputCtx.drawImage(canvas, 0, titleHeight);
    return canvasToBlob(outputCanvas);
}

async function downloadAllDigitalIntensityCharts() {
    if (isChartsLoading) {
        alert('Charts are still loading. Please wait a few seconds and try again.');
        return;
    }

    const charts = getAllRenderedChartsForExport();
    if (!charts.length) {
        alert('No rendered charts found to download.');
        return;
    }

    if (typeof JSZip === 'undefined') {
        alert('ZIP export dependency is missing. Please refresh the page and try again.');
        return;
    }

    const sizeEmp = getSelectedSizeEmp();
    const indicator = getSelectedTrendIndicator();
    const nace = getSelectedNaceR2();

    const zip = new JSZip();
    const prefix = `digital-intensity-${slugifyForFilename(sizeEmp)}-${slugifyForFilename(indicator)}-${slugifyForFilename(nace)}`;

    for (let index = 0; index < charts.length; index++) {
        const chart = charts[index];
        if (typeof chart.update === 'function') {
            chart.update('none');
        }
        const canvas = chart.canvas;
        const canvasId = canvas && canvas.id ? canvas.id : `chart-${index + 1}`;
        const safeCanvasId = slugifyForFilename(canvasId) || `chart-${index + 1}`;
        const filename = `${prefix}-${safeCanvasId}.png`;

        try {
            const blob = await chartToTitledBlob(chart);
            zip.file(filename, blob);
        } catch (error) {
            console.error(`Failed to add ${filename} to ZIP:`, error);
        }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipName = `${prefix}-all-graphs.zip`;
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = zipName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function setupDownloadAllChartsControl() {
    const button = document.getElementById('downloadAllChartsBtn');
    if (!button) return;

    button.addEventListener('click', async function () {
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = 'Preparing ZIP...';
        try {
            await downloadAllDigitalIntensityCharts();
        } catch (error) {
            console.error('Download all charts failed:', error);
            alert('Failed to prepare chart download ZIP. Please try again.');
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    });
}

function updateSizeUi(sizeEmp) {
    const sizeLabel = (SIZE_CONFIG[sizeEmp] || SIZE_CONFIG['10-249']).shortLabel;
    const subtitle = document.getElementById('digitalSubtitle');
    const chartTitle = document.getElementById('digitalChartTitle');
    const trendTitle = document.getElementById('veryHighTrendTitle');
    const trendChangeTitle = document.getElementById('trendChangeTitle');
    const link10to49 = document.getElementById('size10to49Link');
    const link50to249 = document.getElementById('size50to249Link');
    const link10to249 = document.getElementById('size10to249Link');
    const linkGE10 = document.getElementById('sizeGE10Link');
    const linkGE250 = document.getElementById('sizeGE250Link');

    if (subtitle) {
        subtitle.textContent = (SIZE_CONFIG[sizeEmp] || SIZE_CONFIG['10-249']).subtitleText;
    }
    if (chartTitle) {
        chartTitle.textContent = `Share of enterprises by Digital Intensity level (%, 2025, enterprise size: ${sizeLabel})`;
    }
    if (trendTitle) {
        const selectedIndic = getSelectedTrendIndicator();
        const indicatorLabel = (TREND_INDICATOR_CONFIG[selectedIndic] || TREND_INDICATOR_CONFIG['E_DI3_VHI']).shortLabel;
        trendTitle.textContent = `${indicatorLabel} digital intensity share (%, 2021-2025, enterprise size: ${sizeLabel})`;
    }
    if (trendChangeTitle) {
        const selectedIndic = getSelectedTrendIndicator();
        const indicatorLabel = (TREND_INDICATOR_CONFIG[selectedIndic] || TREND_INDICATOR_CONFIG['E_DI3_VHI']).shortLabel;
        trendChangeTitle.textContent = `Growth in ${indicatorLabel} Digital Intensity Among Enterprises (${sizeLabel})`;
    }
    if (link10to49 && link50to249 && link10to249 && linkGE10 && linkGE250) {
        link10to49.classList.toggle('active', sizeEmp === '10-49');
        link50to249.classList.toggle('active', sizeEmp === '50-249');
        link10to249.classList.toggle('active', sizeEmp === '10-249');
        linkGE10.classList.toggle('active', sizeEmp === 'GE10');
        linkGE250.classList.toggle('active', sizeEmp === 'GE250');
    }
}

function renderCompanySizeShareChart(payload) {
    const canvas = document.getElementById('companySizeShareChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rows = [...(payload.rows || [])].sort((a, b) => {
        const aValue = a && a.share_10_49 != null ? Number(a.share_10_49) : -Infinity;
        const bValue = b && b.share_10_49 != null ? Number(b.share_10_49) : -Infinity;
        return bValue - aValue;
    });

    const labels = rows.map(row => row.country);
    const share10to49 = rows.map(row => row.share_10_49);
    const share50to249 = rows.map(row => row.share_50_249);
    const share250Plus = rows.map(row => row.share_250_plus);

    if (companySizeShareChart) {
        companySizeShareChart.destroy();
    }

    companySizeShareChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: '10-49 employees',
                    data: share10to49,
                    backgroundColor: '#F0C43C',
                    borderWidth: 0
                },
                {
                    label: '50-249 employees',
                    data: share50to249,
                    backgroundColor: '#1E4D67',
                    borderWidth: 0
                },
                {
                    label: '250+ employees',
                    data: share250Plus,
                    backgroundColor: '#6D9C5F',
                    borderWidth: 0
                }
            ]
        },
        options: applyBarChartTypography({
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            interaction: {
                mode: 'nearest',
                axis: 'y',
                intersect: true
            },
            scales: {
                x: {
                    stacked: true,
                    beginAtZero: true,
                    max: 100,
                    title: {
                        display: true,
                        text: 'Share of companies (%)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(0)}%`
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                },
                y: {
                    stacked: true,
                    grid: {
                        display: false
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
                            const v = context.parsed.x;
                            if (v == null) return `${context.dataset.label}: N/A`;
                            return `${context.dataset.label}: ${v.toFixed(2)}%`;
                        }
                    }
                }
            }
        })
    });
}

function buildScatterRegressionLinePoints(rows, xKey, regressionStats) {
    const validX = rows.map(row => row[xKey]).filter(v => v != null);
    if (!validX.length) return [];
    const slope = regressionStats && regressionStats.slope;
    const intercept = regressionStats && regressionStats.intercept;
    if (slope == null || intercept == null) return [];

    const minX = Math.min(...validX);
    const maxX = Math.max(...validX);
    return [
        { x: minX, y: intercept + slope * minX },
        { x: maxX, y: intercept + slope * maxX }
    ];
}

function renderSizeVsProductivityLevelScatterChart(payload, options) {
    const {
        canvasId,
        titleId,
        xKey,
        xLabel,
        regressionKey,
        countryColor,
        euColor,
        chartRefName
    } = options;

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rows = payload.rows || [];
    const regressionStats = (payload.regression || {})[regressionKey] || {};

    const aggregatePoint = rows.find(row => row.geo === AGG_GEO_CODE);
    const countryPoints = rows.filter(row => row.geo !== AGG_GEO_CODE);

    const allX = rows.map(row => row[xKey]).filter(v => v != null);
    const allY = rows.map(row => row.real_labour_productivity_per_hour).filter(v => v != null);
    const xMin = allX.length ? Math.min(...allX) : 0;
    const xMax = allX.length ? Math.max(...allX) : 100;
    const yMin = allY.length ? Math.min(...allY) : 0;
    const yMax = allY.length ? Math.max(...allY) : 120;

    const pointFromRow = (row) => ({
        x: row[xKey],
        y: row.real_labour_productivity_per_hour,
        country: row.country,
        geo: row.geo
    });

    const regressionLinePoints = buildScatterRegressionLinePoints(rows, xKey, regressionStats);
    const datasets = [
        {
            label: 'Countries',
            data: countryPoints.map(pointFromRow),
            backgroundColor: countryColor,
            borderColor: countryColor,
            pointRadius: 5,
            pointHoverRadius: 7
        }
    ];

    if (aggregatePoint) {
        datasets.push({
            label: 'Eurozone aggregate',
            data: [pointFromRow(aggregatePoint)],
            backgroundColor: euColor,
            borderColor: euColor,
            pointRadius: 7,
            pointHoverRadius: 9
        });
    }

    if (regressionLinePoints.length === 2) {
        datasets.push({
            label: 'Trend line',
            type: 'line',
            data: regressionLinePoints,
            borderColor: '#111827',
            borderWidth: 1.5,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
            tension: 0
        });
    }

    const titleElement = document.getElementById(titleId);
    if (titleElement) {
        const r2 = regressionStats.r2;
        const r2Text = (r2 == null) ? 'N/A' : r2.toFixed(4);
        titleElement.textContent = `${xLabel} vs labour productivity level (2024) · R² = ${r2Text}`;
    }

    if (chartRefName === 'sizeVsProductivityLevelScatterChart250' && sizeVsProductivityLevelScatterChart250) {
        sizeVsProductivityLevelScatterChart250.destroy();
    }
    if (chartRefName === 'sizeVsProductivityLevelScatterChart50to249' && sizeVsProductivityLevelScatterChart50to249) {
        sizeVsProductivityLevelScatterChart50to249.destroy();
    }
    if (chartRefName === 'sizeVsProductivityLevelScatterChart10to49' && sizeVsProductivityLevelScatterChart10to49) {
        sizeVsProductivityLevelScatterChart10to49.destroy();
    }

    const chartInstance = new Chart(ctx, {
        type: 'scatter',
        plugins: [countryPointLabelPlugin],
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                intersect: true
            },
            scales: {
                x: {
                    min: Math.floor(xMin - 1),
                    max: Math.ceil(xMax + 1),
                    title: {
                        display: true,
                        text: `${xLabel} (%)`
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                },
                y: {
                    min: Math.floor(yMin - 1),
                    max: Math.ceil(yMax + 1),
                    title: {
                        display: true,
                        text: 'Real labour productivity per hour worked (index)'
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
                        title: function (items) {
                            if (!items || !items.length) return '';
                            return items[0].raw.country || '';
                        },
                        label: function (context) {
                            if (context.dataset && context.dataset.label === 'Trend line') {
                                return '';
                            }
                            const x = context.raw.x;
                            const y = context.raw.y;
                            return `${xLabel}: ${Number(x).toFixed(2)}% · Productivity: ${Number(y).toFixed(3)}`;
                        }
                    }
                },
                countryPointLabels: {
                    enabled: true,
                    fontSize: 9,
                    color: '#374151',
                    offsetX: 6,
                    offsetY: -6
                }
            }
        }
    });

    if (chartRefName === 'sizeVsProductivityLevelScatterChart250') {
        sizeVsProductivityLevelScatterChart250 = chartInstance;
    }
    if (chartRefName === 'sizeVsProductivityLevelScatterChart50to249') {
        sizeVsProductivityLevelScatterChart50to249 = chartInstance;
    }
    if (chartRefName === 'sizeVsProductivityLevelScatterChart10to49') {
        sizeVsProductivityLevelScatterChart10to49 = chartInstance;
    }
}

function renderDiiVeryHighVsProductivityScatterChart(payload, options) {
    const { canvasId, titleId, chartKey } = options;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rows = payload.rows || [];
    const regression = payload.regression || {};

    const aggregatePoint = rows.find(row => row.geo === AGG_GEO_CODE);
    const countryPoints = rows.filter(row => row.geo !== AGG_GEO_CODE);

    const xVals = rows.map(row => row.dii_very_high_share).filter(v => v != null);
    const yVals = rows.map(row => row.real_labour_productivity_per_hour).filter(v => v != null);
    const xMin = xVals.length ? Math.min(...xVals) : 0;
    const xMax = xVals.length ? Math.max(...xVals) : 100;
    const yMin = yVals.length ? Math.min(...yVals) : 0;
    const yMax = yVals.length ? Math.max(...yVals) : 120;

    const toPoint = (row) => ({
        x: row.dii_very_high_share,
        y: row.real_labour_productivity_per_hour,
        country: row.country,
        geo: row.geo
    });

    const datasets = [
        {
            label: 'Countries',
            data: countryPoints.map(toPoint),
            backgroundColor: '#1E4D67',
            borderColor: '#1E4D67',
            pointRadius: 5,
            pointHoverRadius: 7
        }
    ];

    if (aggregatePoint) {
        datasets.push({
            label: 'Eurozone aggregate',
            data: [toPoint(aggregatePoint)],
            backgroundColor: '#DC2626',
            borderColor: '#DC2626',
            pointRadius: 7,
            pointHoverRadius: 9
        });
    }

    const linePoints = buildScatterRegressionLinePoints(rows, 'dii_very_high_share', regression);
    if (linePoints.length === 2) {
        datasets.push({
            label: 'Trend line',
            type: 'line',
            data: linePoints,
            borderColor: '#111827',
            borderWidth: 1.5,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
            tension: 0
        });
    }

    const titleElement = document.getElementById(titleId);
    if (titleElement) {
        const r2 = regression.r2;
        const r2Text = (r2 == null) ? 'N/A' : r2.toFixed(4);
        const year = payload.x_year || 2025;
        const productivityTime = payload.y_time || `${year}-Q3`;
        const sizeLabel = payload.size_label || payload.size_class || '';
        titleElement.textContent = `Very high digital intensity share (${sizeLabel}) vs labour productivity (${productivityTime}) · R² = ${r2Text}`;
    }

    if (diiVeryHighVsProductivityCharts[chartKey]) {
        diiVeryHighVsProductivityCharts[chartKey].destroy();
    }

    diiVeryHighVsProductivityCharts[chartKey] = new Chart(ctx, {
        type: 'scatter',
        plugins: [countryPointLabelPlugin],
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                intersect: true
            },
            scales: {
                x: {
                    min: Math.floor(xMin - 1),
                    max: Math.ceil(xMax + 1),
                    title: {
                        display: true,
                        text: `Very high digital intensity share among ${payload.size_label || payload.size_class || 'selected size'} companies (%)`
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                },
                y: {
                    min: Math.floor(yMin - 1),
                    max: Math.ceil(yMax + 1),
                    title: {
                        display: true,
                        text: 'Real labour productivity per hour worked (index)'
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
                        title: function (items) {
                            if (!items || !items.length) return '';
                            return items[0].raw.country || '';
                        },
                        label: function (context) {
                            if (context.dataset && context.dataset.label === 'Trend line') {
                                return '';
                            }
                            const x = context.raw.x;
                            const y = context.raw.y;
                            const sizeLabel = payload.size_label || payload.size_class || 'selected size';
                            return `Very high digital share (${sizeLabel}): ${Number(x).toFixed(2)}% · Productivity: ${Number(y).toFixed(3)}`;
                        }
                    }
                },
                countryPointLabels: {
                    enabled: true,
                    fontSize: 9,
                    color: '#374151',
                    offsetX: 6,
                    offsetY: -6
                }
            }
        }
    });
}

function renderSizeVsProductivityScatterChart(payload, options) {
    const {
        canvasId,
        titleId,
        xKey,
        xLabel,
        regressionKey,
        countryColor,
        euColor,
        chartRefName
    } = options;

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rows = payload.rows || [];
    const regressionStats = (payload.regression || {})[regressionKey] || {};

    const aggregatePoint = rows.find(row => row.geo === AGG_GEO_CODE);
    const countryPoints = rows.filter(row => row.geo !== AGG_GEO_CODE);

    const allX = rows.map(row => row[xKey]).filter(v => v != null);
    const allY = rows.map(row => row.productivity_change_pct).filter(v => v != null);
    const xMin = allX.length ? Math.min(...allX) : -10;
    const xMax = allX.length ? Math.max(...allX) : 10;
    const yMin = allY.length ? Math.min(...allY) : -10;
    const yMax = allY.length ? Math.max(...allY) : 10;

    const pointFromRow = (row) => ({
        x: row[xKey],
        y: row.productivity_change_pct,
        country: row.country,
        geo: row.geo
    });

    const regressionLinePoints = buildScatterRegressionLinePoints(rows, xKey, regressionStats);

    const datasets = [
        {
            label: 'Countries',
            data: countryPoints.map(pointFromRow),
            backgroundColor: countryColor,
            borderColor: countryColor,
            pointRadius: 5,
            pointHoverRadius: 7
        }
    ];

    if (aggregatePoint) {
        datasets.push({
            label: 'Eurozone aggregate',
            data: [pointFromRow(aggregatePoint)],
            backgroundColor: euColor,
            borderColor: euColor,
            pointRadius: 7,
            pointHoverRadius: 9
        });
    }

    if (regressionLinePoints.length === 2) {
        datasets.push({
            label: 'Trend line',
            type: 'line',
            data: regressionLinePoints,
            borderColor: '#111827',
            borderWidth: 1.5,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
            tension: 0
        });
    }

    const titleElement = document.getElementById(titleId);
    if (titleElement) {
        const r2 = regressionStats.r2;
        const r2Text = (r2 == null) ? 'N/A' : r2.toFixed(4);
        const startYear = payload.x_start_year || 2021;
        const endYear = payload.x_end_year || 2024;
        titleElement.textContent = `% change in ${xLabel} vs % change in labour productivity (${startYear}→${endYear}) · R² = ${r2Text}`;
    }

    if (chartRefName === 'sizeVsProductivityScatterChart250' && sizeVsProductivityScatterChart250) {
        sizeVsProductivityScatterChart250.destroy();
    }
    if (chartRefName === 'sizeVsProductivityScatterChart50to249' && sizeVsProductivityScatterChart50to249) {
        sizeVsProductivityScatterChart50to249.destroy();
    }
    if (chartRefName === 'sizeVsProductivityScatterChart10to49' && sizeVsProductivityScatterChart10to49) {
        sizeVsProductivityScatterChart10to49.destroy();
    }

    const chartInstance = new Chart(ctx, {
        type: 'scatter',
        plugins: [countryPointLabelPlugin],
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                intersect: true
            },
            scales: {
                x: {
                    min: Math.floor(xMin - 1),
                    max: Math.ceil(xMax + 1),
                    title: {
                        display: true,
                        text: `% change in ${xLabel} (${payload.x_start_year || 2021}→${payload.x_end_year || 2024})`
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                },
                y: {
                    min: Math.floor(yMin - 1),
                    max: Math.ceil(yMax + 1),
                    title: {
                        display: true,
                        text: `% change in real labour productivity per hour worked (${payload.x_start_year || 2021}→${payload.x_end_year || 2024})`
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
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
                        title: function (items) {
                            if (!items || !items.length) return '';
                            return items[0].raw.country || '';
                        },
                        label: function (context) {
                            if (context.dataset && context.dataset.label === 'Trend line') {
                                return '';
                            }
                            const x = context.raw.x;
                            const y = context.raw.y;
                            return `${xLabel}: ${Number(x).toFixed(2)}% · Productivity change: ${Number(y).toFixed(2)}%`;
                        }
                    }
                },
                countryPointLabels: {
                    enabled: true,
                    fontSize: 9,
                    color: '#374151',
                    offsetX: 6,
                    offsetY: -6
                }
            }
        }
    });

    if (chartRefName === 'sizeVsProductivityScatterChart250') {
        sizeVsProductivityScatterChart250 = chartInstance;
    }
    if (chartRefName === 'sizeVsProductivityScatterChart50to249') {
        sizeVsProductivityScatterChart50to249 = chartInstance;
    }
    if (chartRefName === 'sizeVsProductivityScatterChart10to49') {
        sizeVsProductivityScatterChart10to49 = chartInstance;
    }
}

function setupTrendIndicatorControls() {
    const selected = getSelectedTrendIndicator();

    const mapping = [
        ['trendVeryHighLink', 'E_DI3_VHI'],
        ['trendHighLink', 'E_DI3_HI'],
        ['trendLowLink', 'E_DI3_LO'],
        ['trendVeryLowLink', 'E_DI3_VLO']
    ];

    mapping.forEach(([id, code]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('active', selected === code);
        el.addEventListener('click', function (event) {
            event.preventDefault();
            setQueryParamAndReload('indic_is', code);
        });
    });
}

function setupNaceControls() {
    const selected = getSelectedNaceR2();
    const linkJ = document.getElementById('sectorJLink');
    const linkKN = document.getElementById('sectorKNLink');
    const linkBNS95XK = document.getElementById('sectorBNS95XKLink');

    if (linkJ) {
        linkJ.classList.toggle('active', selected === 'J');
        linkJ.addEventListener('click', function (event) {
            event.preventDefault();
            setQueryParamAndReload('nace_r2', 'J');
        });
    }
    if (linkKN) {
        linkKN.classList.toggle('active', selected === 'K-N');
        linkKN.addEventListener('click', function (event) {
            event.preventDefault();
            setQueryParamAndReload('nace_r2', 'K-N');
        });
    }
    if (linkBNS95XK) {
        linkBNS95XK.classList.toggle('active', selected === 'B-S_X_O_S94' || selected === 'B-N_S95_X_K');
        linkBNS95XK.addEventListener('click', function (event) {
            event.preventDefault();
            setQueryParamAndReload('nace_r2', 'B-S_X_O_S94');
        });
    }
}

function renderVeryHighTrendChart(payload, sizeEmp) {
    const canvas = document.getElementById('veryHighTrendChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const palette = {
        'European Union': '#0F766E',
        'Belgium': '#2563EB',
        'France': '#DC2626',
        'Spain': '#D97706',
        'Italy': '#16A34A',
        'Germany': '#111827',
        'Poland': '#7C3AED'
    };

    const datasets = (payload.series || []).map(item => {
        const color = palette[item.country] || '#1E4D67';
        return {
            label: item.country,
            data: (item.points || []).map(point => ({ x: `${point.year}-01-01`, y: point.value })),
            borderColor: color,
            backgroundColor: `${color}22`,
            borderWidth: 2.4,
            pointRadius: 3,
            fill: false,
            tension: 0.12,
            spanGaps: true
        };
    });

    if (veryHighTrendChart) {
        veryHighTrendChart.destroy();
    }

    veryHighTrendChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'year',
                        displayFormats: { year: 'yyyy' }
                    },
                    title: {
                        display: true,
                        text: 'Year'
                    }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Very high share (%)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
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
                            const v = context.parsed.y;
                            if (v == null) return `${context.dataset.label}: N/A`;
                            return `${context.dataset.label}: ${v.toFixed(2)}% (${payload.indicator || 'Digital intensity share'}, ${(SIZE_CONFIG[sizeEmp] || SIZE_CONFIG['10-249']).shortLabel})`;
                        }
                    }
                }
            }
        }
    });
}

function buildYoyChangeSeries(points) {
    const ordered = [...(points || [])].sort((a, b) => Number(a.year) - Number(b.year));
    if (!ordered.length) return [];

    const known = ordered.filter(point => point.value != null);
    if (!known.length) return [];

    const series = [];
    const first = known[0];
    series.push({
        x: `${first.year}-01-01`,
        y: 0,
        sourceFrom: null,
        sourceTo: Number(first.year),
        isBaseline: true
    });

    for (let i = 1; i < known.length; i++) {
        const prev = known[i - 1];
        const curr = known[i];
        const prevYear = Number(prev.year);
        const currYear = Number(curr.year);

        if (prev.value == null || curr.value == null || prev.value === 0) {
            continue;
        }

        const intervalPctChange = ((curr.value - prev.value) / Math.abs(prev.value)) * 100;
        series.push({
            x: `${curr.year}-01-01`,
            y: intervalPctChange,
            sourceFrom: prevYear,
            sourceTo: currYear,
            isBaseline: false
        });
    }

    return series;
}

function renderTrendChangeChart(payload, sizeEmp) {
    const canvas = document.getElementById('trendChangeChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const palette = {
        'European Union': '#0F766E',
        'Belgium': '#2563EB',
        'France': '#DC2626',
        'Spain': '#D97706',
        'Italy': '#16A34A',
        'Germany': '#111827',
        'Poland': '#7C3AED'
    };

    const datasets = (payload.series || []).map(item => {
        const color = palette[item.country] || '#1E4D67';
        return {
            label: item.country,
            data: buildYoyChangeSeries(item.points),
            borderColor: color,
            backgroundColor: `${color}22`,
            borderWidth: 2.2,
            pointRadius: 3,
            fill: false,
            tension: 0.12,
            spanGaps: true
        };
    });

    if (trendChangeChart) {
        trendChangeChart.destroy();
    }

    trendChangeChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'year',
                        displayFormats: { year: 'yyyy' }
                    },
                    title: {
                        display: true,
                        text: 'Year'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Change vs previous available point (%)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
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
                            const v = context.parsed.y;
                            if (v == null) return `${context.dataset.label}: N/A`;
                            if (context.raw && context.raw.isBaseline) {
                                return `${context.dataset.label}: ${v.toFixed(2)}% baseline (${payload.indicator || 'Digital intensity share'}, ${(SIZE_CONFIG[sizeEmp] || SIZE_CONFIG['10-249']).shortLabel})`;
                            }
                            const fromYear = context.raw && context.raw.sourceFrom ? Number(context.raw.sourceFrom) : null;
                            const toYear = context.raw && context.raw.sourceTo ? Number(context.raw.sourceTo) : null;
                            if (fromYear && toYear) {
                                return `${context.dataset.label}: ${v.toFixed(2)}% (${payload.indicator || 'Digital intensity share'}, ${fromYear}→${toYear}, ${(SIZE_CONFIG[sizeEmp] || SIZE_CONFIG['10-249']).shortLabel})`;
                            }
                            return `${context.dataset.label}: ${v.toFixed(2)}% (${payload.indicator || 'Digital intensity share'}, ${(SIZE_CONFIG[sizeEmp] || SIZE_CONFIG['10-249']).shortLabel})`;
                        }
                    }
                }
            }
        }
    });
}

function renderCompanySizeGrowthTrendChart(payload) {
    const canvas = document.getElementById('companySizeGrowthTrendChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rows = payload.rows || [];

    const labels = rows.map(row => row.country);
    const growth10to49 = rows.map(row => row.growth_10_49);
    const growth50to249 = rows.map(row => row.growth_50_249);
    const growth250Plus = rows.map(row => row.growth_250_plus);

    const minGrowth = Math.min(
        ...growth10to49.filter(v => v != null),
        ...growth50to249.filter(v => v != null),
        ...growth250Plus.filter(v => v != null),
        0
    );
    const maxGrowth = Math.max(
        ...growth10to49.filter(v => v != null),
        ...growth50to249.filter(v => v != null),
        ...growth250Plus.filter(v => v != null),
        0
    );

    if (companySizeGrowthTrendChart) {
        companySizeGrowthTrendChart.destroy();
    }

    const startYear = payload.start_year || 2021;
    const endYear = payload.end_year || 2024;
    const titleElement = document.getElementById('companySizeGrowthTitle');
    if (titleElement) {
        titleElement.textContent = `Growth in number of companies by size class (${startYear}–${endYear})`;
    }

    companySizeGrowthTrendChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: '10-49 employees',
                    data: growth10to49,
                    backgroundColor: '#F0C43C',
                    borderWidth: 0
                },
                {
                    label: '50-249 employees',
                    data: growth50to249,
                    backgroundColor: '#1E4D67',
                    borderWidth: 0
                },
                {
                    label: '250+ employees',
                    data: growth250Plus,
                    backgroundColor: '#6D9C5F',
                    borderWidth: 0
                }
            ]
        },
        options: applyBarChartTypography({
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    }
                },
                y: {
                    beginAtZero: false,
                    min: Math.floor(minGrowth - 2),
                    max: Math.ceil(maxGrowth + 2),
                    title: {
                        display: true,
                        text: 'Growth in number of companies (%)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
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
                            const v = context.parsed.y;
                            if (v == null) return `${context.dataset.label}: N/A`;
                            return `${context.dataset.label}: ${v.toFixed(2)}% (${startYear}→${endYear})`;
                        }
                    }
                }
            }
        })
    });
}

function computePctChangeFromPoints(points, targetStartYear, targetEndYear) {
    const available = [...(points || [])]
        .map(point => ({ year: Number(point.year), value: point.value == null ? null : Number(point.value) }))
        .filter(point => Number.isFinite(point.year) && point.value != null)
        .sort((a, b) => a.year - b.year);

    if (!available.length) {
        return { value: null, fromYear: null, toYear: null };
    }

    const startCandidate = available.find(point => point.year === targetStartYear);
    const endCandidate = available.find(point => point.year === targetEndYear);

    if (!startCandidate || !endCandidate || startCandidate.value === 0) {
        return { value: null, fromYear: startCandidate ? startCandidate.year : null, toYear: endCandidate ? endCandidate.year : null };
    }

    return {
        value: ((endCandidate.value - startCandidate.value) / Math.abs(startCandidate.value)) * 100.0,
        fromYear: startCandidate.year,
        toYear: endCandidate.year,
    };
}

function computeSimpleRegression(points) {
    const valid = (points || []).filter(point => point.x != null && point.y != null);
    if (valid.length < 2) {
        return { slope: null, intercept: null, r2: null };
    }

    const n = valid.length;
    const xs = valid.map(point => Number(point.x));
    const ys = valid.map(point => Number(point.y));
    const xMean = xs.reduce((sum, value) => sum + value, 0) / n;
    const yMean = ys.reduce((sum, value) => sum + value, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - xMean;
        numerator += dx * (ys[i] - yMean);
        denominator += dx * dx;
    }

    if (denominator === 0) {
        return { slope: null, intercept: null, r2: null };
    }

    const slope = numerator / denominator;
    const intercept = yMean - slope * xMean;

    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < n; i++) {
        const yPred = intercept + slope * xs[i];
        ssRes += Math.pow(ys[i] - yPred, 2);
        ssTot += Math.pow(ys[i] - yMean, 2);
    }

    const r2 = ssTot === 0 ? null : 1 - (ssRes / ssTot);
    return { slope, intercept, r2 };
}

function growthFieldForSizeEmp(sizeEmp) {
    const mapping = {
        '10-49': 'growth_10_49',
        '50-249': 'growth_50_249',
        '10-249': 'growth_10_249',
        'GE10': 'growth_ge10',
        'GE250': 'growth_250_plus'
    };
    return mapping[sizeEmp] || 'growth_10_249';
}

function resolveGrowthValueForSize(row, sizeEmp) {
    const toNumberOrNull = (value) => (value == null ? null : Number(value));
    const g10to49 = toNumberOrNull(row.growth_10_49);
    const g50to249 = toNumberOrNull(row.growth_50_249);
    const g250plus = toNumberOrNull(row.growth_250_plus);
    const g10to249 = toNumberOrNull(row.growth_10_249);
    const gGE10 = toNumberOrNull(row.growth_ge10);

    if (sizeEmp === '10-49') return g10to49;
    if (sizeEmp === '50-249') return g50to249;
    if (sizeEmp === 'GE250') return g250plus;

    if (sizeEmp === '10-249') {
        if (g10to249 != null) return g10to249;
        if (g10to49 != null && g50to249 != null) return (g10to49 + g50to249) / 2;
        if (g10to49 != null) return g10to49;
        if (g50to249 != null) return g50to249;
        return null;
    }

    if (sizeEmp === 'GE10') {
        if (gGE10 != null) return gGE10;
        const available = [g10to49, g50to249, g250plus].filter(v => v != null);
        if (!available.length) return null;
        return available.reduce((sum, value) => sum + value, 0) / available.length;
    }

    return g10to249;
}

function renderCompanyGrowthVsDigitalIntensityScatterChart(growthPayload, trendPayload, sizeEmp, selectedIndicator) {
    const canvas = document.getElementById('companyGrowthVsDigitalIntensityChart');
    if (!canvas || !growthPayload || !trendPayload) return;

    const growthRows = growthPayload.rows || [];
    const trendSeries = trendPayload.series || [];
    const growthKey = growthFieldForSizeEmp(sizeEmp);
    const requestedStartYear = Number(growthPayload.start_year || 2021);
    const requestedEndYear = Number(growthPayload.end_year || 2024);

    const digitalChangeByCountry = {};
    trendSeries.forEach(item => {
        const country = item && item.country ? item.country : null;
        if (!country) return;
        digitalChangeByCountry[country] = computePctChangeFromPoints(item.points || [], requestedStartYear, requestedEndYear);
    });

    const points = growthRows
        .map(row => {
            const growthValue = resolveGrowthValueForSize(row || {}, sizeEmp);
            const digitalChange = digitalChangeByCountry[row.country] || { value: null, fromYear: null, toYear: null };
            if (growthValue == null || digitalChange.value == null) return null;
            return {
                x: growthValue,
                y: Number(digitalChange.value),
                country: row.country,
                growthFromYear: requestedStartYear,
                growthToYear: requestedEndYear,
                diFromYear: digitalChange.fromYear,
                diToYear: digitalChange.toYear
            };
        })
        .filter(Boolean);

    const regression = computeSimpleRegression(points);
    const linePoints = buildScatterRegressionLinePoints(points, 'x', regression);

    const datasets = [
        {
            label: 'Countries',
            data: points,
            backgroundColor: '#0F766E',
            borderColor: '#0F766E',
            pointRadius: 6,
            pointHoverRadius: 8
        }
    ];

    if (linePoints.length === 2) {
        datasets.push({
            label: 'Trend line',
            type: 'line',
            data: linePoints,
            borderColor: '#111827',
            borderWidth: 1.8,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
            tension: 0
        });
    }

    if (companyGrowthVsDigitalIntensityChart) {
        companyGrowthVsDigitalIntensityChart.destroy();
    }

    const titleElement = document.getElementById('companyGrowthVsDigitalIntensityTitle');
    if (titleElement) {
        const indicatorLabel = (TREND_INDICATOR_CONFIG[selectedIndicator] || TREND_INDICATOR_CONFIG['E_DI3_VHI']).shortLabel;
        const sizeLabel = (SIZE_CONFIG[sizeEmp] || SIZE_CONFIG['10-249']).shortLabel;
        const r2Text = regression.r2 == null ? 'N/A' : regression.r2.toFixed(4);
        const usesFallback = sizeEmp === '10-249' || sizeEmp === 'GE10';
        const fallbackText = usesFallback ? ' (growth proxy when aggregate series unavailable)' : '';
        titleElement.textContent = `% change in number of companies (${sizeLabel}) vs % change in ${indicatorLabel.toLowerCase()} digital intensity (${requestedStartYear}→${requestedEndYear})${fallbackText} · R² = ${r2Text}`;
    }

    companyGrowthVsDigitalIntensityChart = new Chart(canvas.getContext('2d'), {
        type: 'scatter',
        plugins: [countryPointLabelPlugin],
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                intersect: true
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: `% change in number of companies (${requestedStartYear}→${requestedEndYear})`
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: `% change in digital intensity (${requestedStartYear}→${requestedEndYear})`
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
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
                        title: function (items) {
                            if (!items || !items.length) return '';
                            return items[0].raw.country || '';
                        },
                        label: function (context) {
                            if (context.dataset && context.dataset.label === 'Trend line') {
                                return '';
                            }
                            const point = context.raw;
                            const xText = point && point.x != null ? `${Number(point.x).toFixed(2)}%` : 'N/A';
                            const yText = point && point.y != null ? `${Number(point.y).toFixed(2)}%` : 'N/A';
                            return `Company growth: ${xText} · Digital intensity change: ${yText}`;
                        }
                    }
                },
                countryPointLabels: {
                    enabled: true,
                    fontSize: 10,
                    color: '#111827',
                    offsetX: 7,
                    offsetY: -7
                }
            }
        }
    });
}

function renderCompanyGrowthVsDigitalIntensityScatterEurozoneChart(payload, sizeEmp, selectedIndicator) {
    const canvas = document.getElementById('companyGrowthVsDigitalIntensityChart');
    if (!canvas || !payload) return;

    const rows = payload.rows || [];
    const points = rows.map(row => ({
        x: row.company_growth_pct,
        y: row.digital_intensity_change_pct,
        country: row.country,
    }));

    const regression = payload.regression || {};
    const linePoints = buildScatterRegressionLinePoints(points, 'x', regression);
    const datasets = [
        {
            label: 'Eurozone countries',
            data: points,
            backgroundColor: '#0F766E',
            borderColor: '#0F766E',
            pointRadius: 5,
            pointHoverRadius: 7
        }
    ];

    if (linePoints.length === 2) {
        datasets.push({
            label: 'Trend line',
            type: 'line',
            data: linePoints,
            borderColor: '#111827',
            borderWidth: 1.8,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
            tension: 0
        });
    }

    if (companyGrowthVsDigitalIntensityChart) {
        companyGrowthVsDigitalIntensityChart.destroy();
    }

    const titleElement = document.getElementById('companyGrowthVsDigitalIntensityTitle');
    if (titleElement) {
        const indicatorLabel = (TREND_INDICATOR_CONFIG[selectedIndicator] || TREND_INDICATOR_CONFIG['E_DI3_VHI']).shortLabel;
        const sizeLabel = (SIZE_CONFIG[sizeEmp] || SIZE_CONFIG['10-249']).shortLabel;
        const r2Text = regression.r2 == null ? 'N/A' : regression.r2.toFixed(4);
        const nCountries = payload.eligible_country_count != null ? payload.eligible_country_count : points.length;
        titleElement.textContent = `% change in number of companies (${sizeLabel}) vs % change in ${indicatorLabel.toLowerCase()} digital intensity (${payload.start_year}→${payload.end_year}, eurozone countries n=${nCountries}) · R² = ${r2Text}`;
    }

    companyGrowthVsDigitalIntensityChart = new Chart(canvas.getContext('2d'), {
        type: 'scatter',
        plugins: [countryPointLabelPlugin],
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                intersect: true
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: `% change in number of companies (${payload.start_year}→${payload.end_year})`
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: `% change in digital intensity (${payload.start_year}→${payload.end_year})`
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
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
                        title: function (items) {
                            if (!items || !items.length) return '';
                            return items[0].raw.country || '';
                        },
                        label: function (context) {
                            if (context.dataset && context.dataset.label === 'Trend line') {
                                return '';
                            }
                            const point = context.raw;
                            const xText = point && point.x != null ? `${Number(point.x).toFixed(2)}%` : 'N/A';
                            const yText = point && point.y != null ? `${Number(point.y).toFixed(2)}%` : 'N/A';
                            return `Company growth: ${xText} · Digital intensity change: ${yText}`;
                        }
                    }
                },
                countryPointLabels: {
                    enabled: true,
                    fontSize: 9,
                    color: '#111827',
                    offsetX: 6,
                    offsetY: -6
                }
            }
        }
    });
}

function renderBusinessIndexGrowthChart(canvasId, titleId, series, titleText) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const palette = {
        'Eurozone': '#0F766E',
        'Belgium': '#2563EB',
        'France': '#DC2626',
        'Spain': '#D97706',
        'Italy': '#16A34A',
        'Germany': '#111827',
        'Poland': '#7C3AED'
    };

    const datasets = (series || []).map(item => {
        const color = palette[item.country] || '#1E4D67';
        return {
            label: item.country,
            data: (item.points || []).map(point => ({ x: point.time, y: point.value })),
            borderColor: color,
            backgroundColor: `${color}22`,
            borderWidth: 2.2,
            pointRadius: 3,
            fill: false,
            tension: 0.12,
            spanGaps: true
        };
    });

    const titleElement = document.getElementById(titleId);
    if (titleElement) {
        titleElement.textContent = titleText;
    }

    const isRegistration = canvasId === 'registrationGrowthTrendChart';
    if (isRegistration && registrationGrowthTrendChart) {
        registrationGrowthTrendChart.destroy();
    }
    if (!isRegistration && bankruptcyGrowthTrendChart) {
        bankruptcyGrowthTrendChart.destroy();
    }

    const chart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    type: 'category',
                    title: {
                        display: true,
                        text: 'Year'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Annual average percentage change on previous period (%)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
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
                            const v = context.parsed.y;
                            if (v == null) return `${context.dataset.label}: N/A`;
                            return `${context.dataset.label}: ${v.toFixed(2)}%`;
                        }
                    }
                }
            }
        }
    });

    if (isRegistration) {
        registrationGrowthTrendChart = chart;
    } else {
        bankruptcyGrowthTrendChart = chart;
    }
}

function renderNetBusinessDynamicsBalanceTrendChart(payload) {
    const canvas = document.getElementById('netBusinessDynamicsBalanceTrendChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const palette = {
        'Belgium': '#2563EB',
        'France': '#DC2626',
        'Spain': '#D97706',
        'Italy': '#16A34A',
        'Germany': '#111827'
    };

    const datasets = (payload.series || []).map(item => {
        const color = palette[item.country] || '#1E4D67';
        return {
            label: item.country,
            data: (item.points || []).map(point => ({ x: point.time, y: point.value })),
            borderColor: color,
            backgroundColor: `${color}22`,
            borderWidth: 2,
            pointRadius: 2.6,
            fill: false,
            tension: 0.12,
            spanGaps: true
        };
    });

    if (netBusinessDynamicsBalanceTrendChart) {
        netBusinessDynamicsBalanceTrendChart.destroy();
    }

    const titleElement = document.getElementById('netBusinessDynamicsBalanceTitle');
    if (titleElement) {
        const sectorLabel = (NACE_CONFIG[payload.nace_r2] || {}).label || payload.nace_r2 || 'selected sector';
        titleElement.textContent = `Net business dynamics balance proxy (REG - BKRT, annual avg % change, ${sectorLabel}, from 2015)`;
    }

    netBusinessDynamicsBalanceTrendChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    type: 'category',
                    title: {
                        display: true,
                        text: 'Year'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Net balance proxy (percentage points)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)} pp`
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
                }
            }
        }
    });
}

function renderProductivityNetBusinessDynamicsR2TrendChart(payload) {
    const canvas = document.getElementById('productivityNetBusinessDynamicsR2TrendChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const points = payload.points || [];

    if (productivityNetBusinessDynamicsR2TrendChart) {
        productivityNetBusinessDynamicsR2TrendChart.destroy();
    }

    const titleElement = document.getElementById('productivityNetBusinessDynamicsR2Title');
    if (titleElement) {
        const nCountries = payload.eligible_country_count || 0;
        const sectorLabel = (NACE_CONFIG[payload.x_nace_r2] || {}).label || payload.x_nace_r2 || 'selected sector';
        titleElement.textContent = `R² of productivity vs net business dynamics balance proxy — annual trend (${sectorLabel}, n=${nCountries})`;
    }

    const yValues = points.map(point => Number(point.r2_pct));
    const yMin = yValues.length ? Math.min(...yValues) : 0;
    const yMax = yValues.length ? Math.max(...yValues) : 100;

    productivityNetBusinessDynamicsR2TrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    data: points.map(point => ({ x: point.year, y: point.r2_pct, n: point.n, x_std: point.x_std })),
                    borderColor: '#7C2D12',
                    backgroundColor: '#7C2D1222',
                    borderWidth: 4,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    fill: false,
                    tension: 0,
                    spanGaps: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'category',
                    title: {
                        display: true,
                        text: 'Year'
                    }
                },
                y: {
                    beginAtZero: false,
                    min: Math.max(0, Math.floor(yMin - 2)),
                    max: Math.min(100, Math.ceil(yMax + 2)),
                    title: {
                        display: true,
                        text: 'R² (%)'
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
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title: function (items) {
                            if (!items || !items.length) return '';
                            return `Year ${items[0].raw.x}`;
                        },
                        label: function (context) {
                            const v = context.parsed.y;
                            const n = context.raw.n;
                            if (v == null) return 'R²: N/A';
                            const xStd = context.raw.x_std;
                            const xDispText = (xStd == null) ? 'N/A' : `${Number(xStd).toFixed(2)} pp`;
                            return `R²: ${Number(v).toFixed(2)}% (n=${n}, x-dispersion=${xDispText})`;
                        }
                    }
                }
            }
        }
    });
}

function renderProductivityNetBusinessDynamicsScatter2024Chart(payload) {
    const canvas = document.getElementById('productivityNetBusinessDynamicsScatter2024Chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rows = payload.rows || [];
    const regression = payload.regression || {};

    const xVals = rows.map(row => row.net_business_dynamics_balance_pp).filter(v => v != null);
    const yVals = rows.map(row => row.real_labour_productivity_per_hour).filter(v => v != null);
    const xMin = xVals.length ? Math.min(...xVals) : 0;
    const xMax = xVals.length ? Math.max(...xVals) : 100;
    const yMin = yVals.length ? Math.min(...yVals) : 0;
    const yMax = yVals.length ? Math.max(...yVals) : 120;

    const toPoint = (row) => ({
        x: row.net_business_dynamics_balance_pp,
        y: row.real_labour_productivity_per_hour,
        country: row.country,
        geo: row.geo
    });

    const datasets = [
        {
            label: 'Countries',
            data: rows.map(toPoint),
            backgroundColor: '#7C2D12',
            borderColor: '#7C2D12',
            pointRadius: 7,
            pointHoverRadius: 9
        }
    ];

    const linePoints = buildScatterRegressionLinePoints(rows, 'net_business_dynamics_balance_pp', regression);
    if (linePoints.length === 2) {
        datasets.push({
            label: 'Trend line',
            type: 'line',
            data: linePoints,
            borderColor: '#111827',
            borderWidth: 2.2,
            pointRadius: 0,
            fill: false,
            tension: 0
        });
    }

    if (productivityNetBusinessDynamicsScatter2024Chart) {
        productivityNetBusinessDynamicsScatter2024Chart.destroy();
    }

    const titleElement = document.getElementById('productivityNetBusinessDynamicsScatter2024Title');
    if (titleElement) {
        const r2 = regression.r2;
        const r2Text = (r2 == null) ? 'N/A' : `${(r2 * 100).toFixed(1)}%`;
        const nCountries = payload.eligible_country_count || rows.length;
        const sectorLabel = (NACE_CONFIG[payload.x_nace_r2] || {}).label || payload.x_nace_r2 || 'selected sector';
        titleElement.textContent = `Productivity vs net business dynamics balance proxy (2024, ${sectorLabel}, n=${nCountries}) · R²: ${r2Text}`;
    }

    productivityNetBusinessDynamicsScatter2024Chart = new Chart(ctx, {
        type: 'scatter',
        plugins: [countryPointLabelPlugin],
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                intersect: true
            },
            scales: {
                x: {
                    min: Math.floor(xMin - 1),
                    max: Math.ceil(xMax + 1),
                    title: {
                        display: true,
                        text: 'Net business dynamics balance proxy (percentage points)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)} pp`
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                },
                y: {
                    min: Math.floor(yMin - 2),
                    max: Math.ceil(yMax + 2),
                    title: {
                        display: true,
                        text: 'Real labour productivity per hour worked (index)'
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title: function (items) {
                            if (!items || !items.length) return '';
                            return items[0].raw.country || '';
                        },
                        label: function (context) {
                            if (context.dataset && context.dataset.label === 'Trend line') {
                                return '';
                            }
                            const x = context.raw.x;
                            const y = context.raw.y;
                            return `Net balance proxy: ${Number(x).toFixed(2)} pp · Productivity: ${Number(y).toFixed(2)}`;
                        }
                    }
                },
                countryPointLabels: {
                    enabled: true,
                    fontSize: 11,
                    color: '#111827',
                    offsetX: 8,
                    offsetY: -8
                }
            }
        }
    });
}

function renderProductivityBankruptcyR2TrendChart(payload) {
    const canvas = document.getElementById('productivityBankruptcyR2TrendChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const points = payload.points || [];

    if (productivityBankruptcyR2TrendChart) {
        productivityBankruptcyR2TrendChart.destroy();
    }

    const titleElement = document.getElementById('productivityBankruptcyR2Title');
    if (titleElement) {
        const nCountries = payload.eligible_country_count || 0;
        const sectorLabel = (NACE_CONFIG[payload.x_nace_r2] || {}).label || payload.x_nace_r2 || 'selected sector';
        titleElement.textContent = `R² of productivity vs bankruptcy relation — annual trend (${sectorLabel}, from 2015, n=${nCountries})`;
    }

    const yValues = points.map(point => Number(point.r2_pct));
    const yMin = yValues.length ? Math.min(...yValues) : 0;
    const yMax = yValues.length ? Math.max(...yValues) : 100;

    productivityBankruptcyR2TrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'R² (%)',
                    data: points.map(point => ({ x: point.year, y: point.r2_pct, n: point.n })),
                    borderColor: '#111827',
                    backgroundColor: '#11182722',
                    borderWidth: 4,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#111827',
                    pointBorderColor: '#111827',
                    fill: false,
                    tension: 0,
                    spanGaps: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                intersect: false
            },
            scales: {
                x: {
                    type: 'category',
                    title: {
                        display: true,
                        text: 'Year'
                    }
                },
                y: {
                    beginAtZero: false,
                    min: Math.max(0, Math.floor(yMin - 2)),
                    max: Math.min(100, Math.ceil(yMax + 2)),
                    title: {
                        display: true,
                        text: 'R² (%)'
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
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title: function (items) {
                            if (!items || !items.length) return '';
                            return `Year ${items[0].raw.x}`;
                        },
                        label: function (context) {
                            const v = context.parsed.y;
                            const n = context.raw.n;
                            if (v == null) return 'R²: N/A';
                            const xStd = context.raw.x_std;
                            const xDispText = (xStd == null) ? 'N/A' : `${Number(xStd).toFixed(2)} pp`;
                            return `R²: ${Number(v).toFixed(2)}% (n=${n}, x-dispersion=${xDispText})`;
                        }
                    }
                }
            }
        }
    });
}

function renderProductivityBankruptcyScatter2024Chart(payload) {
    const canvas = document.getElementById('productivityBankruptcyScatter2024Chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rows = payload.rows || [];
    const regression = payload.regression || {};

    const xVals = rows.map(row => row.bankruptcy_growth_pct).filter(v => v != null);
    const yVals = rows.map(row => row.real_labour_productivity_per_hour).filter(v => v != null);
    const xMin = xVals.length ? Math.min(...xVals) : 0;
    const xMax = xVals.length ? Math.max(...xVals) : 100;
    const yMin = yVals.length ? Math.min(...yVals) : 0;
    const yMax = yVals.length ? Math.max(...yVals) : 120;

    const toPoint = (row) => ({
        x: row.bankruptcy_growth_pct,
        y: row.real_labour_productivity_per_hour,
        country: row.country,
        geo: row.geo
    });

    const datasets = [
        {
            label: 'Countries',
            data: rows.map(toPoint),
            backgroundColor: '#2738D0',
            borderColor: '#2738D0',
            pointRadius: 7,
            pointHoverRadius: 9
        }
    ];

    const linePoints = buildScatterRegressionLinePoints(rows, 'bankruptcy_growth_pct', regression);
    if (linePoints.length === 2) {
        datasets.push({
            label: 'Trend line',
            type: 'line',
            data: linePoints,
            borderColor: '#111827',
            borderWidth: 2.2,
            pointRadius: 0,
            fill: false,
            tension: 0
        });
    }

    if (productivityBankruptcyScatter2024Chart) {
        productivityBankruptcyScatter2024Chart.destroy();
    }

    const titleElement = document.getElementById('productivityBankruptcyScatter2024Title');
    if (titleElement) {
        const r2 = regression.r2;
        const r2Text = (r2 == null) ? 'N/A' : `${(r2 * 100).toFixed(1)}%`;
        const nCountries = payload.eligible_country_count || rows.length;
        const sectorLabel = (NACE_CONFIG[payload.x_nace_r2] || {}).label || payload.x_nace_r2 || 'selected sector';
        titleElement.textContent = `Productivity vs bankruptcy growth (2024, ${sectorLabel}, n=${nCountries}) · R²: ${r2Text}`;
    }

    productivityBankruptcyScatter2024Chart = new Chart(ctx, {
        type: 'scatter',
        plugins: [countryPointLabelPlugin],
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                intersect: true
            },
            scales: {
                x: {
                    min: Math.floor(xMin - 1),
                    max: Math.ceil(xMax + 1),
                    title: {
                        display: true,
                        text: 'Bankruptcy growth (annual avg of quarterly % change)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                },
                y: {
                    min: Math.floor(yMin - 2),
                    max: Math.ceil(yMax + 2),
                    title: {
                        display: true,
                        text: 'Real labour productivity per hour worked (index)'
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title: function (items) {
                            if (!items || !items.length) return '';
                            return items[0].raw.country || '';
                        },
                        label: function (context) {
                            if (context.dataset && context.dataset.label === 'Trend line') {
                                return '';
                            }
                            const x = context.raw.x;
                            const y = context.raw.y;
                            return `Bankruptcy growth: ${Number(x).toFixed(2)}% · Productivity: ${Number(y).toFixed(2)}`;
                        }
                    }
                },
                countryPointLabels: {
                    enabled: true,
                    fontSize: 11,
                    color: '#111827',
                    offsetX: 8,
                    offsetY: -8
                }
            }
        }
    });
}

function renderProductivityRegistrationR2TrendChart(payload) {
    const canvas = document.getElementById('productivityRegistrationR2TrendChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const points = payload.points || [];

    if (productivityRegistrationR2TrendChart) {
        productivityRegistrationR2TrendChart.destroy();
    }

    const titleElement = document.getElementById('productivityRegistrationR2Title');
    if (titleElement) {
        const nCountries = payload.eligible_country_count || 0;
        const sectorLabel = (NACE_CONFIG[payload.x_nace_r2] || {}).label || payload.x_nace_r2 || 'selected sector';
        titleElement.textContent = `R² of productivity vs business registration relation — annual trend (${sectorLabel}, from 2015, n=${nCountries})`;
    }

    const yValues = points.map(point => Number(point.r2_pct));
    const yMin = yValues.length ? Math.min(...yValues) : 0;
    const yMax = yValues.length ? Math.max(...yValues) : 100;

    productivityRegistrationR2TrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'R² (%)',
                    data: points.map(point => ({ x: point.year, y: point.r2_pct, n: point.n, x_std: point.x_std })),
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED822',
                    borderWidth: 4,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#1D4ED8',
                    pointBorderColor: '#1D4ED8',
                    fill: false,
                    tension: 0,
                    spanGaps: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                intersect: false
            },
            scales: {
                x: {
                    type: 'category',
                    title: {
                        display: true,
                        text: 'Year'
                    }
                },
                y: {
                    beginAtZero: false,
                    min: Math.max(0, Math.floor(yMin - 2)),
                    max: Math.min(100, Math.ceil(yMax + 2)),
                    title: {
                        display: true,
                        text: 'R² (%)'
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
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title: function (items) {
                            if (!items || !items.length) return '';
                            return `Year ${items[0].raw.x}`;
                        },
                        label: function (context) {
                            const v = context.parsed.y;
                            const n = context.raw.n;
                            if (v == null) return 'R²: N/A';
                            const xStd = context.raw.x_std;
                            const xDispText = (xStd == null) ? 'N/A' : `${Number(xStd).toFixed(2)} pp`;
                            return `R²: ${Number(v).toFixed(2)}% (n=${n}, x-dispersion=${xDispText})`;
                        }
                    }
                }
            }
        }
    });
}

function renderProductivityRegistrationScatter2024Chart(payload) {
    const canvas = document.getElementById('productivityRegistrationScatter2024Chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rows = payload.rows || [];
    const regression = payload.regression || {};

    const xVals = rows.map(row => row.registration_growth_pct).filter(v => v != null);
    const yVals = rows.map(row => row.real_labour_productivity_per_hour).filter(v => v != null);
    const xMin = xVals.length ? Math.min(...xVals) : 0;
    const xMax = xVals.length ? Math.max(...xVals) : 100;
    const yMin = yVals.length ? Math.min(...yVals) : 0;
    const yMax = yVals.length ? Math.max(...yVals) : 120;

    const toPoint = (row) => ({
        x: row.registration_growth_pct,
        y: row.real_labour_productivity_per_hour,
        country: row.country,
        geo: row.geo
    });

    const datasets = [
        {
            label: 'Countries',
            data: rows.map(toPoint),
            backgroundColor: '#1D4ED8',
            borderColor: '#1D4ED8',
            pointRadius: 7,
            pointHoverRadius: 9
        }
    ];

    const linePoints = buildScatterRegressionLinePoints(rows, 'registration_growth_pct', regression);
    if (linePoints.length === 2) {
        datasets.push({
            label: 'Trend line',
            type: 'line',
            data: linePoints,
            borderColor: '#111827',
            borderWidth: 2.2,
            pointRadius: 0,
            fill: false,
            tension: 0
        });
    }

    if (productivityRegistrationScatter2024Chart) {
        productivityRegistrationScatter2024Chart.destroy();
    }

    const titleElement = document.getElementById('productivityRegistrationScatter2024Title');
    if (titleElement) {
        const r2 = regression.r2;
        const r2Text = (r2 == null) ? 'N/A' : `${(r2 * 100).toFixed(1)}%`;
        const nCountries = payload.eligible_country_count || rows.length;
        const sectorLabel = (NACE_CONFIG[payload.x_nace_r2] || {}).label || payload.x_nace_r2 || 'selected sector';
        titleElement.textContent = `Productivity vs business registration growth (2024, ${sectorLabel}, n=${nCountries}) · R²: ${r2Text}`;
    }

    productivityRegistrationScatter2024Chart = new Chart(ctx, {
        type: 'scatter',
        plugins: [countryPointLabelPlugin],
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                intersect: true
            },
            scales: {
                x: {
                    min: Math.floor(xMin - 1),
                    max: Math.ceil(xMax + 1),
                    title: {
                        display: true,
                        text: 'Business registration growth (annual avg of quarterly % change)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                },
                y: {
                    min: Math.floor(yMin - 2),
                    max: Math.ceil(yMax + 2),
                    title: {
                        display: true,
                        text: 'Real labour productivity per hour worked (index)'
                    },
                    grid: {
                        color: '#D1D5DB'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title: function (items) {
                            if (!items || !items.length) return '';
                            return items[0].raw.country || '';
                        },
                        label: function (context) {
                            if (context.dataset && context.dataset.label === 'Trend line') {
                                return '';
                            }
                            const x = context.raw.x;
                            const y = context.raw.y;
                            return `Business registration growth: ${Number(x).toFixed(2)}% · Productivity: ${Number(y).toFixed(2)}`;
                        }
                    }
                },
                countryPointLabels: {
                    enabled: true,
                    fontSize: 11,
                    color: '#111827',
                    offsetX: 8,
                    offsetY: -8
                }
            }
        }
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

function buildOptions(sizeEmp) {
    const sizeLabel = (SIZE_CONFIG[sizeEmp] || SIZE_CONFIG['10-249']).shortLabel;
    return applyBarChartTypography({
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        interaction: {
            mode: 'nearest',
            axis: 'y',
            intersect: true
        },
        scales: {
            x: {
                stacked: true,
                min: 0,
                max: 100,
                title: {
                    display: true,
                    text: 'Percent of enterprises (%)'
                },
                ticks: {
                    callback: value => `${value}%`
                },
                grid: {
                    color: '#D1D5DB'
                }
            },
            y: {
                stacked: true,
                grid: {
                    display: false
                }
            }
        },
        plugins: {
            legend: {
                display: true,
                position: 'bottom'
            },
            tooltip: {
                mode: 'nearest',
                intersect: true,
                callbacks: {
                    label: function (context) {
                        const value = context.parsed.x;
                        if (value == null) return `${context.dataset.label}: N/A`;
                        return `${context.dataset.label}: ${value.toFixed(2)}% (${sizeLabel})`;
                    }
                }
            }
        }
    });
}

function renderChart(rows, sizeEmp) {
    const canvas = document.getElementById('digitalIntensityChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const labels = rows.map(row => row.country);

    const datasets = [
        {
            label: 'Very low',
            data: rows.map(row => row.very_low),
            backgroundColor: '#D13B6A',
            borderWidth: 0
        },
        {
            label: 'Low',
            data: rows.map(row => row.low),
            backgroundColor: '#F0C43C',
            borderWidth: 0
        },
        {
            label: 'High',
            data: rows.map(row => row.high),
            backgroundColor: '#1E4D67',
            borderWidth: 0
        },
        {
            label: 'Very high',
            data: rows.map(row => row.very_high),
            backgroundColor: '#6D9C5F',
            borderWidth: 0
        }
    ];

    if (digitalIntensityChart) {
        digitalIntensityChart.destroy();
    }

    digitalIntensityChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: buildOptions(sizeEmp)
    });
}

async function fetchAndRenderDigitalIntensity() {
    isChartsLoading = true;
    const sizeEmp = getSelectedSizeEmp();
    const selectedIndicator = getSelectedTrendIndicator();
    const selectedNaceR2 = getSelectedNaceR2();
    updateSizeUi(sizeEmp);

    let loadedAtLeastOneChart = false;

    try {
        const sizeShareResponse = await fetch(`${API_BASE}/api/company-size-shares-by-country?year=2024`);
        if (!sizeShareResponse.ok) throw new Error(`Server error ${sizeShareResponse.status}`);
        const sizeSharePayload = await sizeShareResponse.json();
        renderCompanySizeShareChart(sizeSharePayload);
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading company-size-share chart:', error);
    }

    try {
        const levelScatterResponse = await fetch(`${API_BASE}/api/company-size-vs-productivity-scatter-levels?year=2024&quarter=Q4`);
        if (!levelScatterResponse.ok) throw new Error(`Server error ${levelScatterResponse.status}`);
        const levelScatterPayload = await levelScatterResponse.json();

        renderSizeVsProductivityLevelScatterChart(levelScatterPayload, {
            canvasId: 'sizeVsProductivityLevelScatterChart250',
            titleId: 'sizeVsProductivityLevelTitle250',
            xKey: 'share_250_plus',
            xLabel: 'Share of 250+ companies',
            regressionKey: 'share_250_plus',
            countryColor: '#1E4D67',
            euColor: '#DC2626',
            chartRefName: 'sizeVsProductivityLevelScatterChart250'
        });
        renderSizeVsProductivityLevelScatterChart(levelScatterPayload, {
            canvasId: 'sizeVsProductivityLevelScatterChart50to249',
            titleId: 'sizeVsProductivityLevelTitle50to249',
            xKey: 'share_50_249',
            xLabel: 'Share of 50-249 companies',
            regressionKey: 'share_50_249',
            countryColor: '#6D9C5F',
            euColor: '#DC2626',
            chartRefName: 'sizeVsProductivityLevelScatterChart50to249'
        });
        renderSizeVsProductivityLevelScatterChart(levelScatterPayload, {
            canvasId: 'sizeVsProductivityLevelScatterChart10to49',
            titleId: 'sizeVsProductivityLevelTitle10to49',
            xKey: 'share_10_49',
            xLabel: 'Share of 10-49 companies',
            regressionKey: 'share_10_49',
            countryColor: '#F0C43C',
            euColor: '#DC2626',
            chartRefName: 'sizeVsProductivityLevelScatterChart10to49'
        });
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading level size-vs-productivity scatter chart:', error);
    }

    try {
        const diiScatterConfigs = [
            {
                sizeEmp: 'GE250',
                canvasId: 'diiGe250VeryHighVsProductivityChart',
                titleId: 'diiGe250VeryHighVsProductivityTitle',
                chartKey: 'GE250'
            },
            {
                sizeEmp: '10-49',
                canvasId: 'dii10to49VeryHighVsProductivityChart',
                titleId: 'dii10to49VeryHighVsProductivityTitle',
                chartKey: '10-49'
            },
            {
                sizeEmp: '50-249',
                canvasId: 'dii50to249VeryHighVsProductivityChart',
                titleId: 'dii50to249VeryHighVsProductivityTitle',
                chartKey: '50-249'
            },
            {
                sizeEmp: '10-249',
                canvasId: 'dii10to249VeryHighVsProductivityChart',
                titleId: 'dii10to249VeryHighVsProductivityTitle',
                chartKey: '10-249'
            },
            {
                sizeEmp: 'GE10',
                canvasId: 'diiGE10VeryHighVsProductivityChart',
                titleId: 'diiGE10VeryHighVsProductivityTitle',
                chartKey: 'GE10'
            }
        ];

        for (const config of diiScatterConfigs) {
            const diiScatterResponse = await fetch(`${API_BASE}/api/dii-ge250-very-high-vs-productivity-scatter?year=2025&quarter=Q3&size_emp=${encodeURIComponent(config.sizeEmp)}`);
            if (!diiScatterResponse.ok) throw new Error(`Server error ${diiScatterResponse.status} (${config.sizeEmp})`);
            const diiScatterPayload = await diiScatterResponse.json();
            renderDiiVeryHighVsProductivityScatterChart(diiScatterPayload, config);
        }
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading DII GE250 very-high vs productivity scatter chart:', error);
    }

    try {
        const scatterResponse = await fetch(`${API_BASE}/api/company-size-vs-productivity-scatter?start_year=2021&end_year=2024&quarter=Q4`);
        if (!scatterResponse.ok) throw new Error(`Server error ${scatterResponse.status}`);
        const scatterPayload = await scatterResponse.json();
        renderSizeVsProductivityScatterChart(scatterPayload, {
            canvasId: 'sizeVsProductivityScatterChart250',
            titleId: 'sizeVsProductivityTitle250',
            xKey: 'company_change_250_plus_pct',
            xLabel: '250+ companies',
            regressionKey: 'company_change_250_plus_pct',
            countryColor: '#1E4D67',
            euColor: '#DC2626',
            chartRefName: 'sizeVsProductivityScatterChart250'
        });
        renderSizeVsProductivityScatterChart(scatterPayload, {
            canvasId: 'sizeVsProductivityScatterChart50to249',
            titleId: 'sizeVsProductivityTitle50to249',
            xKey: 'company_change_50_249_pct',
            xLabel: '50-249 companies',
            regressionKey: 'company_change_50_249_pct',
            countryColor: '#6D9C5F',
            euColor: '#DC2626',
            chartRefName: 'sizeVsProductivityScatterChart50to249'
        });
        renderSizeVsProductivityScatterChart(scatterPayload, {
            canvasId: 'sizeVsProductivityScatterChart10to49',
            titleId: 'sizeVsProductivityTitle10to49',
            xKey: 'company_change_10_49_pct',
            xLabel: '10-49 companies',
            regressionKey: 'company_change_10_49_pct',
            countryColor: '#F0C43C',
            euColor: '#DC2626',
            chartRefName: 'sizeVsProductivityScatterChart10to49'
        });
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading size-vs-productivity scatter chart:', error);
    }

    try {
        const response = await fetch(`${API_BASE}/api/digital-intensity-index?size_emp=${encodeURIComponent(sizeEmp)}`);
        if (!response.ok) throw new Error(`Server error ${response.status}`);

        const payload = await response.json();
        const rows = payload.rows || [];
        if (!rows.length) throw new Error('No data available for the selected filters');

        renderChart(rows, sizeEmp);
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading main digital intensity chart:', error);
    }

    try {
        const trendResponse = await fetch(
            `${API_BASE}/api/digital-intensity-very-high-trend?size_emp=${encodeURIComponent(sizeEmp)}&indic_is=${encodeURIComponent(selectedIndicator)}`
        );
        if (!trendResponse.ok) throw new Error(`Server error ${trendResponse.status}`);
        const trendPayload = await trendResponse.json();
        renderVeryHighTrendChart(trendPayload, sizeEmp);
        renderTrendChangeChart(trendPayload, sizeEmp);
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading very-high trend chart:', error);
    }

    try {
        const growthResponse = await fetch(`${API_BASE}/api/company-size-growth-selected-countries?start_year=2021&end_year=2023`);
        if (!growthResponse.ok) throw new Error(`Server error ${growthResponse.status}`);
        const growthPayload = await growthResponse.json();
        renderCompanySizeGrowthTrendChart(growthPayload);
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading company-size growth trend chart:', error);
    }

    try {
        const comparisonResponse = await fetch(
            `${API_BASE}/api/company-growth-vs-digital-intensity-scatter-eurozone?start_year=2021&end_year=2023&size_emp=${encodeURIComponent(sizeEmp)}&indic_is=${encodeURIComponent(selectedIndicator)}`
        );
        if (!comparisonResponse.ok) throw new Error(`Server error ${comparisonResponse.status}`);
        const comparisonPayload = await comparisonResponse.json();
        renderCompanyGrowthVsDigitalIntensityScatterEurozoneChart(comparisonPayload, sizeEmp, selectedIndicator);
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading company-growth vs digital-intensity scatter (eurozone) chart:', error);
    }

    try {
        const rbResponse = await fetch(`${API_BASE}/api/business-registration-bankruptcy-growth-trend?nace_r2=${encodeURIComponent(selectedNaceR2)}&s_adj=SCA&start_time=2015-Q1&unit=PCH_PRE`);
        if (!rbResponse.ok) throw new Error(`Server error ${rbResponse.status}`);
        const rbPayload = await rbResponse.json();
        const sectorLabel = (NACE_CONFIG[selectedNaceR2] || {}).label || selectedNaceR2;
        renderBusinessIndexGrowthChart(
            'registrationGrowthTrendChart',
            'registrationGrowthTitle',
            rbPayload.registration_series,
            `Business Registration Index — Annual average of quarterly % change (${sectorLabel}, from 2015)`
        );
        renderBusinessIndexGrowthChart(
            'bankruptcyGrowthTrendChart',
            'bankruptcyGrowthTitle',
            rbPayload.bankruptcy_series,
            `Bankruptcy Index — Annual average of quarterly % change (${sectorLabel}, from 2015)`
        );
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading business registration/bankruptcy growth charts:', error);
    }

    try {
        const r2Response = await fetch(`${API_BASE}/api/productivity-bankruptcy-r2-trend?start_time=2015-Q1&s_adj=SCA&bankruptcy_unit=PCH_PRE&nace_r2=${encodeURIComponent(selectedNaceR2)}`);
        if (!r2Response.ok) throw new Error(`Server error ${r2Response.status}`);
        const r2Payload = await r2Response.json();
        renderProductivityBankruptcyR2TrendChart(r2Payload);
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading productivity-bankruptcy R2 trend chart:', error);
    }

    try {
        const pbScatterResponse = await fetch(`${API_BASE}/api/productivity-bankruptcy-scatter-annual?year=2024&start_time=2015-Q1&s_adj=SCA&bankruptcy_unit=PCH_PRE&nace_r2=${encodeURIComponent(selectedNaceR2)}`);
        if (!pbScatterResponse.ok) throw new Error(`Server error ${pbScatterResponse.status}`);
        const pbScatterPayload = await pbScatterResponse.json();
        renderProductivityBankruptcyScatter2024Chart(pbScatterPayload);
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading productivity-bankruptcy scatter (2024) chart:', error);
    }

    try {
        const regR2Response = await fetch(`${API_BASE}/api/productivity-registration-r2-trend?start_time=2015-Q1&s_adj=SCA&registration_unit=PCH_PRE&nace_r2=${encodeURIComponent(selectedNaceR2)}`);
        if (!regR2Response.ok) throw new Error(`Server error ${regR2Response.status}`);
        const regR2Payload = await regR2Response.json();
        renderProductivityRegistrationR2TrendChart(regR2Payload);
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading productivity-registration R2 trend chart:', error);
    }

    try {
        const regScatterResponse = await fetch(`${API_BASE}/api/productivity-registration-scatter-annual?year=2024&start_time=2015-Q1&s_adj=SCA&registration_unit=PCH_PRE&nace_r2=${encodeURIComponent(selectedNaceR2)}`);
        if (!regScatterResponse.ok) throw new Error(`Server error ${regScatterResponse.status}`);
        const regScatterPayload = await regScatterResponse.json();
        renderProductivityRegistrationScatter2024Chart(regScatterPayload);
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading productivity-registration scatter (2024) chart:', error);
    }

    try {
        const netTrendResponse = await fetch(`${API_BASE}/api/net-business-dynamics-balance-trend?start_time=2015-Q1&s_adj=SCA&unit=PCH_PRE&nace_r2=${encodeURIComponent(selectedNaceR2)}`);
        if (!netTrendResponse.ok) throw new Error(`Server error ${netTrendResponse.status}`);
        const netTrendPayload = await netTrendResponse.json();
        renderNetBusinessDynamicsBalanceTrendChart(netTrendPayload);
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading net business dynamics balance trend chart:', error);
    }

    try {
        const netR2Response = await fetch(`${API_BASE}/api/productivity-net-business-dynamics-r2-trend?start_time=2015-Q1&s_adj=SCA&unit=PCH_PRE&nace_r2=${encodeURIComponent(selectedNaceR2)}`);
        if (!netR2Response.ok) throw new Error(`Server error ${netR2Response.status}`);
        const netR2Payload = await netR2Response.json();
        renderProductivityNetBusinessDynamicsR2TrendChart(netR2Payload);
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading productivity-net-business-dynamics R2 trend chart:', error);
    }

    try {
        const netScatterResponse = await fetch(`${API_BASE}/api/productivity-net-business-dynamics-scatter-annual?year=2024&start_time=2015-Q1&s_adj=SCA&unit=PCH_PRE&nace_r2=${encodeURIComponent(selectedNaceR2)}`);
        if (!netScatterResponse.ok) throw new Error(`Server error ${netScatterResponse.status}`);
        const netScatterPayload = await netScatterResponse.json();
        renderProductivityNetBusinessDynamicsScatter2024Chart(netScatterPayload);
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading productivity-net-business-dynamics scatter (2024) chart:', error);
    }

    if (!loadedAtLeastOneChart) {
        alert('Could not load Digital Intensity data. Please check API server and try again.');
    }

    isChartsLoading = false;
}

window.addEventListener('DOMContentLoaded', async () => {
    setupDownloadAllChartsControl();
    setupTrendIndicatorControls();
    setupNaceControls();
    await checkServerStatus();
    await fetchAndRenderDigitalIntensity();
});
