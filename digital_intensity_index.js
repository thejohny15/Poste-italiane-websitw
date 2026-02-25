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

const API_BASE = 'http://localhost:5001';
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

function getSelectedSizeEmp() {
    const raw = new URLSearchParams(window.location.search).get('size_emp') || '10-249';
    return SIZE_CONFIG[raw] ? raw : '10-249';
}

function getSelectedTrendIndicator() {
    const raw = new URLSearchParams(window.location.search).get('indic_is') || 'E_DI3_VHI';
    return TREND_INDICATOR_CONFIG[raw] ? raw : 'E_DI3_VHI';
}

function setQueryParamAndReload(key, value) {
    const params = new URLSearchParams(window.location.search);
    params.set(key, value);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.location.href = newUrl;
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
        trendChangeTitle.textContent = `% change between available years in ${indicatorLabel.toLowerCase()} digital intensity share (2021-2025, enterprise size: ${sizeLabel})`;
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
    const rows = payload.rows || [];

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
        options: {
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
        }
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

    const euPoint = rows.find(row => row.geo === 'EU27_2020');
    const countryPoints = rows.filter(row => row.geo !== 'EU27_2020');

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

    if (euPoint) {
        datasets.push({
            label: 'European Union',
            data: [pointFromRow(euPoint)],
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

    const euPoint = rows.find(row => row.geo === 'EU27_2020');
    const countryPoints = rows.filter(row => row.geo !== 'EU27_2020');

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

    if (euPoint) {
        datasets.push({
            label: 'European Union',
            data: [toPoint(euPoint)],
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
                        text: 'Very high digital intensity share among 250+ companies (%)'
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

    const euPoint = rows.find(row => row.geo === 'EU27_2020');
    const countryPoints = rows.filter(row => row.geo !== 'EU27_2020');

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

    if (euPoint) {
        datasets.push({
            label: 'European Union',
            data: [pointFromRow(euPoint)],
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
        options: {
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
    return {
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
    };
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
    const sizeEmp = getSelectedSizeEmp();
    const selectedIndicator = getSelectedTrendIndicator();
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
        const growthResponse = await fetch(`${API_BASE}/api/company-size-growth-selected-countries?start_year=2021&end_year=2024`);
        if (!growthResponse.ok) throw new Error(`Server error ${growthResponse.status}`);
        const growthPayload = await growthResponse.json();
        renderCompanySizeGrowthTrendChart(growthPayload);
        loadedAtLeastOneChart = true;
    } catch (error) {
        console.error('Error loading company-size growth trend chart:', error);
    }

    if (!loadedAtLeastOneChart) {
        alert('Could not load Digital Intensity data. Please check API server and try again.');
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    setupTrendIndicatorControls();
    await checkServerStatus();
    await fetchAndRenderDigitalIntensity();
});
