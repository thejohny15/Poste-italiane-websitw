let aiTypeByGeoChart = null;
let aiTypeCountryComparisonChart = null;
let aiTypeTrendChart = null;
let aiProductivityScatterChart = null;
let aiGrowthByTypeChart = null;

const countryPointLabelPlugin = {
    id: 'countryPointLabels',
    afterDatasetsDraw(chart, args, pluginOptions) {
        const opts = pluginOptions || {};
        if (opts.enabled === false) return;

        const ctx = chart.ctx;
        const color = opts.color || '#374151';
        const fontSize = opts.fontSize || 10;
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

const API_BASE = 'http://localhost:5001';
const SIZE_OPTIONS = ['10-49', '50-249', '10-249', 'GE10', 'GE250'];
const YEAR_OPTIONS = ['2021', '2023', '2024', '2025'];

function getSelectedSizeEmp() {
    const raw = new URLSearchParams(window.location.search).get('size_emp') || 'GE10';
    return SIZE_OPTIONS.includes(raw) ? raw : 'GE10';
}

function getSelectedYear() {
    const raw = new URLSearchParams(window.location.search).get('year') || '2025';
    return YEAR_OPTIONS.includes(raw) ? raw : '2025';
}

function getSelectedGeo() {
    return new URLSearchParams(window.location.search).get('geo') || 'EU27_2020';
}

function getSelectedIndicator() {
    return new URLSearchParams(window.location.search).get('indic_is') || 'E_AI_TANY';
}

function setQueryParamAndReload(key, value) {
    const params = new URLSearchParams(window.location.search);
    params.set(key, value);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.location.href = newUrl;
}

function updateFilterLinks() {
    const size = getSelectedSizeEmp();
    const year = getSelectedYear();

    const sizeMap = {
        size10to49Link: '10-49',
        size50to249Link: '50-249',
        size10to249Link: '10-249',
        sizeGE10Link: 'GE10',
        sizeGE250Link: 'GE250'
    };
    Object.entries(sizeMap).forEach(([id, code]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('active', size === code);
        el.onclick = (event) => {
            event.preventDefault();
            setQueryParamAndReload('size_emp', code);
        };
    });

    const yearMap = {
        year2021Link: '2021',
        year2023Link: '2023',
        year2024Link: '2024',
        year2025Link: '2025'
    };
    Object.entries(yearMap).forEach(([id, code]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('active', year === code);
        el.onclick = (event) => {
            event.preventDefault();
            setQueryParamAndReload('year', code);
        };
    });
}

function shortIndicatorLabel(label) {
    if (!label) return '';
    return String(label)
        .replace(/^Enterprises using /, '')
        .replace(/^Enterprises don't use /, 'Do not use ')
        .replace(/AI technologies /g, '')
        .trim();
}

function conciseIndicatorLabel(code, fallbackLabel) {
    const map = {
        E_AI_TTM: 'Text mining',
        E_AI_TSR: 'Speech recognition',
        E_AI_TNLG: 'Text/speech/code generation',
        E_AI_TIR: 'Image recognition',
        E_AI_TML: 'Machine learning',
        E_AI_TPA: 'Workflow/decision automation',
        E_AI_TAR: 'Autonomous movement robots/vehicles',
        E_AI_TPVSG: 'Image/video/audio generation',
        E_AI_TANY: 'Any AI technology',
        E_AI_TX: 'No AI technology',
        E_AI_TGE2: 'At least 2 AI technologies',
        E_AI_TGE3: 'At least 3 AI technologies'
    };

    const base = map[code] || shortIndicatorLabel(fallbackLabel || code) || code;
    return `${base} (${code})`;
}

function buildGeoAndIndicatorSelectors(payload) {
    const geoSelect = document.getElementById('geoSelect');
    const indicSelect = document.getElementById('indicSelect');
    if (!geoSelect || !indicSelect) return;

    const selectedGeo = getSelectedGeo();
    const selectedIndic = getSelectedIndicator();

    const geos = (payload.rows || []).map(row => ({ code: row.geo, label: row.country }));
    const indicators = payload.indicators || [];

    geoSelect.innerHTML = geos
        .map(g => `<option value="${g.code}" ${g.code === selectedGeo ? 'selected' : ''}>${g.label}</option>`)
        .join('');

    indicSelect.innerHTML = indicators
        .map(i => `<option value="${i.code}" ${i.code === selectedIndic ? 'selected' : ''}>${conciseIndicatorLabel(i.code, i.label)}</option>`)
        .join('');

    geoSelect.onchange = () => setQueryParamAndReload('geo', geoSelect.value);
    indicSelect.onchange = () => setQueryParamAndReload('indic_is', indicSelect.value);
}

function renderAiTypesByGeoChart(payload) {
    const canvas = document.getElementById('aiTypeByGeoChart');
    if (!canvas) return;

    const selectedGeo = getSelectedGeo();
    const row = (payload.rows || []).find(item => item.geo === selectedGeo) || (payload.rows || [])[0];
    if (!row) return;

    const labels = (payload.indicators || []).map(ind => conciseIndicatorLabel(ind.code, ind.label));
    const data = (payload.indicators || []).map(ind => row.values ? row.values[ind.code] : null);

    if (aiTypeByGeoChart) aiTypeByGeoChart.destroy();

    aiTypeByGeoChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: `${row.country} (${payload.year})`,
                data,
                backgroundColor: '#1E4D67'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            scales: {
                x: {
                    beginAtZero: true,
                    title: { display: true, text: 'Enterprises (%)' },
                    ticks: { callback: value => `${Number(value).toFixed(1)}%` },
                    grid: { color: '#D1D5DB' }
                },
                y: { grid: { display: false } }
            },
            plugins: {
                legend: { display: true, position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const v = context.parsed.x;
                            return `${context.dataset.label}: ${v == null ? 'N/A' : `${v.toFixed(2)}%`}`;
                        }
                    }
                }
            }
        }
    });

    const titleEl = document.getElementById('aiTypeByGeoTitle');
    if (titleEl) {
        titleEl.textContent = `AI utilization by type — ${row.country} (${payload.year}, ${payload.size_emp})`;
    }
}

function renderCountryComparisonChart(payload) {
    const canvas = document.getElementById('aiTypeCountryComparisonChart');
    if (!canvas) return;

    const selectedIndic = getSelectedIndicator();
    const indicatorMeta = (payload.indicators || []).find(ind => ind.code === selectedIndic) || (payload.indicators || [])[0];
    if (!indicatorMeta) return;

    const rows = (payload.rows || [])
        .map(row => ({
            country: row.country,
            value: row.values ? row.values[indicatorMeta.code] : null
        }))
        .filter(row => row.value != null)
        .sort((a, b) => b.value - a.value);

    if (aiTypeCountryComparisonChart) aiTypeCountryComparisonChart.destroy();

    aiTypeCountryComparisonChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: rows.map(r => r.country),
            datasets: [{
                label: conciseIndicatorLabel(indicatorMeta.code, indicatorMeta.label),
                data: rows.map(r => r.value),
                backgroundColor: '#6D9C5F'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            scales: {
                x: {
                    beginAtZero: true,
                    title: { display: true, text: 'Enterprises (%)' },
                    ticks: { callback: value => `${Number(value).toFixed(1)}%` },
                    grid: { color: '#D1D5DB' }
                },
                y: { grid: { display: false } }
            },
            plugins: {
                legend: { display: true, position: 'bottom' }
            }
        }
    });

    const titleEl = document.getElementById('aiTypeCountryComparisonTitle');
    if (titleEl) {
        titleEl.textContent = `Country comparison — ${conciseIndicatorLabel(indicatorMeta.code, indicatorMeta.label)} (${payload.year}, ${payload.size_emp})`;
    }
}

function renderAiTrendChart(payload) {
    const canvas = document.getElementById('aiTypeTrendChart');
    if (!canvas) return;

    if (aiTypeTrendChart) aiTypeTrendChart.destroy();

    aiTypeTrendChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            datasets: [{
                label: payload.geo_label,
                data: (payload.points || []).map(point => ({ x: point.year, y: point.value })),
                borderColor: '#DC2626',
                backgroundColor: '#DC262622',
                borderWidth: 2.8,
                pointRadius: 4,
                fill: false,
                tension: 0.1,
                spanGaps: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'category',
                    title: { display: true, text: 'Year' }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Enterprises (%)' },
                    ticks: { callback: value => `${Number(value).toFixed(1)}%` },
                    grid: { color: '#D1D5DB' }
                }
            },
            plugins: {
                legend: { display: true, position: 'bottom' }
            }
        }
    });

    const titleEl = document.getElementById('aiTypeTrendTitle');
    if (titleEl) {
        titleEl.textContent = `Trend — ${conciseIndicatorLabel(payload.indic_is, payload.indic_label)} (${payload.geo_label}, ${payload.size_emp})`;
    }
}

function renderAiProductivityScatterChart(payload) {
    const canvas = document.getElementById('aiProductivityScatterChart');
    if (!canvas) return;

    const rows = payload.rows || [];
    const regression = payload.regression || {};

    const xVals = rows.map(r => r.ai_utilization_pct).filter(v => v != null);
    const yVals = rows.map(r => r.real_labour_productivity_per_hour).filter(v => v != null);
    const xMin = xVals.length ? Math.min(...xVals) : 0;
    const xMax = xVals.length ? Math.max(...xVals) : 100;
    const yMin = yVals.length ? Math.min(...yVals) : 0;
    const yMax = yVals.length ? Math.max(...yVals) : 120;

    const scatterData = rows.map(row => ({
        x: row.ai_utilization_pct,
        y: row.real_labour_productivity_per_hour,
        country: row.country
    }));

    const lineData = [];
    if (regression && regression.slope != null && regression.intercept != null && xVals.length) {
        const minX = Math.min(...xVals);
        const maxX = Math.max(...xVals);
        lineData.push(
            { x: minX, y: regression.intercept + regression.slope * minX },
            { x: maxX, y: regression.intercept + regression.slope * maxX }
        );
    }

    if (aiProductivityScatterChart) aiProductivityScatterChart.destroy();

    aiProductivityScatterChart = new Chart(canvas.getContext('2d'), {
        type: 'scatter',
        plugins: [countryPointLabelPlugin],
        data: {
            datasets: [
                {
                    label: 'Countries',
                    data: scatterData,
                    backgroundColor: '#1E4D67',
                    borderColor: '#1E4D67',
                    pointRadius: 5,
                    pointHoverRadius: 7
                },
                {
                    label: 'Trend line',
                    type: 'line',
                    data: lineData,
                    borderColor: '#111827',
                    borderWidth: 1.8,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    fill: false,
                    tension: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    min: Math.floor(xMin - 1),
                    max: Math.ceil(xMax + 1),
                    title: {
                        display: true,
                        text: 'AI utilization (enterprises, %)'
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`
                    },
                    grid: { color: '#D1D5DB' }
                },
                y: {
                    min: Math.floor(yMin - 2),
                    max: Math.ceil(yMax + 2),
                    title: {
                        display: true,
                        text: 'Real labour productivity per hour worked (index)'
                    },
                    grid: { color: '#D1D5DB' }
                }
            },
            plugins: {
                legend: { display: true, position: 'bottom' },
                tooltip: {
                    callbacks: {
                        title: function (items) {
                            if (!items || !items.length) return '';
                            return items[0].raw.country || '';
                        },
                        label: function (context) {
                            if (context.dataset && context.dataset.label === 'Trend line') return '';
                            const x = context.raw.x;
                            const y = context.raw.y;
                            return `AI utilization: ${Number(x).toFixed(2)}% · Productivity: ${Number(y).toFixed(2)}`;
                        }
                    }
                },
                countryPointLabels: {
                    enabled: true,
                    fontSize: 10,
                    color: '#374151',
                    offsetX: 6,
                    offsetY: -6
                }
            }
        }
    });

    const titleEl = document.getElementById('aiProductivityScatterTitle');
    if (titleEl) {
        const r2 = regression.r2;
        const r2Text = (r2 == null) ? 'N/A' : r2.toFixed(4);
        titleEl.textContent = `AI utilization vs productivity (${payload.year}, ${payload.size_emp}) · R² = ${r2Text}`;
    }
}

function renderAiGrowthByTypeChart(payload) {
    const canvas = document.getElementById('aiGrowthByTypeChart');
    if (!canvas) return;

    const labels = payload.years || [];
    const series = payload.series || [];

    const palette = {
        'Eurozone': '#0F766E',
        'Germany': '#111827',
        'Italy': '#16A34A',
        'Belgium': '#2563EB',
        'France': '#DC2626',
        'Spain': '#D97706'
    };

    const datasets = series.map(item => ({
        label: item.country,
        data: labels.map(year => {
            const p = (item.points || []).find(point => point.year === year);
            return p && p.value != null ? Number(p.value) : null;
        }),
        backgroundColor: palette[item.country] || '#1E4D67',
        borderWidth: 0
    }));

    const allValues = [];
    datasets.forEach(ds => {
        (ds.data || []).forEach(v => {
            if (v != null) allValues.push(Number(v));
        });
    });
    const minVal = allValues.length ? Math.min(...allValues) : -10;
    const maxVal = allValues.length ? Math.max(...allValues) : 10;

    if (aiGrowthByTypeChart) aiGrowthByTypeChart.destroy();

    aiGrowthByTypeChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels, datasets },
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
                    min: Math.floor(minVal - 5),
                    max: Math.ceil(maxVal + 5),
                    title: {
                        display: true,
                        text: 'Growth in AI utilization (%)'
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
                            return `Year ${items[0].label || ''}`;
                        },
                        label: function (context) {
                            const v = context.parsed.y;
                            if (v == null) return `${context.dataset.label}: N/A`;
                            const year = context.label;
                            const fromYear = payload.years && payload.years.length ? payload.years[payload.years.indexOf(year) - 1] : null;
                            const periodText = fromYear ? `${fromYear}→${year}` : `previous→${year}`;
                            return `${context.dataset.label}: ${v.toFixed(2)}% (${periodText})`;
                        }
                    }
                }
            }
        }
    });

    const titleEl = document.getElementById('aiGrowthByTypeTitle');
    if (titleEl) {
        titleEl.textContent = `Yearly growth in AI utilization — ${conciseIndicatorLabel(payload.indic_is, payload.indic_label)} (Germany, Italy, Belgium, France, Spain, Eurozone)`;
    }
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

async function loadAiUtilizationDashboard() {
    const sizeEmp = getSelectedSizeEmp();
    const year = getSelectedYear();
    const geo = getSelectedGeo();
    const indic = getSelectedIndicator();

    updateFilterLinks();

    const subtitle = document.getElementById('aiSubtitle');
    if (subtitle) {
        subtitle.textContent = `Enterprises using AI technologies · Year ${year} · Size ${sizeEmp} · Eurostat isoc_eb_ai`;
    }

    const snapshotResponse = await fetch(`${API_BASE}/api/ai-utilization-types?year=${encodeURIComponent(year)}&size_emp=${encodeURIComponent(sizeEmp)}&unit=PC_ENT`);
    if (!snapshotResponse.ok) {
        throw new Error(`Snapshot API error ${snapshotResponse.status}`);
    }
    const snapshotPayload = await snapshotResponse.json();

    buildGeoAndIndicatorSelectors(snapshotPayload);
    renderAiTypesByGeoChart(snapshotPayload);
    renderCountryComparisonChart(snapshotPayload);

    const trendResponse = await fetch(`${API_BASE}/api/ai-utilization-type-trend?size_emp=${encodeURIComponent(sizeEmp)}&geo=${encodeURIComponent(geo)}&indic_is=${encodeURIComponent(indic)}&unit=PC_ENT`);
    if (!trendResponse.ok) {
        throw new Error(`Trend API error ${trendResponse.status}`);
    }
    const trendPayload = await trendResponse.json();
    renderAiTrendChart(trendPayload);

    const scatterResponse = await fetch(`${API_BASE}/api/ai-utilization-vs-productivity-scatter?year=${encodeURIComponent(year)}&size_emp=${encodeURIComponent(sizeEmp)}&indic_is=${encodeURIComponent(indic)}&unit=PC_ENT&s_adj=SCA`);
    if (!scatterResponse.ok) {
        throw new Error(`Scatter API error ${scatterResponse.status}`);
    }
    const scatterPayload = await scatterResponse.json();
    renderAiProductivityScatterChart(scatterPayload);

    const growthResponse = await fetch(`${API_BASE}/api/ai-utilization-growth-by-year-selected-countries?size_emp=${encodeURIComponent(sizeEmp)}&indic_is=${encodeURIComponent(indic)}&unit=PC_ENT`);
    if (!growthResponse.ok) {
        throw new Error(`Growth API error ${growthResponse.status}`);
    }
    const growthPayload = await growthResponse.json();
    renderAiGrowthByTypeChart(growthPayload);
}

window.addEventListener('DOMContentLoaded', async () => {
    await checkServerStatus();
    try {
        await loadAiUtilizationDashboard();
    } catch (error) {
        console.error('Error loading AI utilization dashboard:', error);
        alert('Could not load AI utilization data. Please check API server and try again.');
    }
});
