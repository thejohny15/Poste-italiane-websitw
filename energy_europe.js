const electricityCharts = {};
const API_BASE = 'http://localhost:5001';
let europeUsePriceChart = null;
let worldOilProductionChart = null;

const pageParams = new URLSearchParams(window.location.search);
const eiaProductionApiKey = pageParams.get('eia_production_api_key') || '';
const eiaConsumptionApiKey = pageParams.get('eia_consumption_api_key') || '';

function withApiKey(url, key) {
    if (!key) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}api_key=${encodeURIComponent(key)}`;
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

function formatMonthLabel(dateString) {
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return dateString;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function renderElectricityShareChart(payload, canvasId, titleId, displayName) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const points = Array.isArray(payload && payload.points) ? payload.points : [];
    if (!points.length) {
        throw new Error('No monthly EU electricity share data available.');
    }

    const labels = points.map(point => formatMonthLabel(point.date));

    const series = {
        solar: points.map(point => point.solar == null ? null : Number(point.solar)),
        wind: points.map(point => point.wind == null ? null : Number(point.wind)),
        hydro: points.map(point => point.hydro == null ? null : Number(point.hydro)),
        bioenergy: points.map(point => point.bioenergy == null ? null : Number(point.bioenergy)),
        otherRenewables: points.map(point => point.other_renewables == null ? null : Number(point.other_renewables)),
        nuclear: points.map(point => point.nuclear == null ? null : Number(point.nuclear)),
        gas: points.map(point => point.gas == null ? null : Number(point.gas)),
        coal: points.map(point => point.coal == null ? null : Number(point.coal)),
        otherFossil: points.map(point => point.other_fossil == null ? null : Number(point.other_fossil)),
    };

    const datasetsBase = [
        { label: 'Solar', data: series.solar, borderColor: '#2ECC71', backgroundColor: '#2ECC71CC' },
        { label: 'Wind', data: series.wind, borderColor: '#176B3A', backgroundColor: '#176B3ACC' },
        { label: 'Hydro', data: series.hydro, borderColor: '#7FB3D5', backgroundColor: '#7FB3D5CC' },
        { label: 'Bioenergy', data: series.bioenergy, borderColor: '#2E6BAE', backgroundColor: '#2E6BAECC' },
        { label: 'Other renewables', data: series.otherRenewables, borderColor: '#A9D6DE', backgroundColor: '#A9D6DECC' },
        { label: 'Nuclear', data: series.nuclear, borderColor: '#2C4587', backgroundColor: '#2C4587CC' },
        { label: 'Gas', data: series.gas, borderColor: '#8C7B7B', backgroundColor: '#8C7B7BCC' },
        { label: 'Coal', data: series.coal, borderColor: '#5A423B', backgroundColor: '#5A423BCC' },
        { label: 'Other fossil', data: series.otherFossil, borderColor: '#A9A3A3', backgroundColor: '#A9A3A3CC' },
    ];

    const latestValue = (arr) => {
        for (let index = arr.length - 1; index >= 0; index -= 1) {
            const value = arr[index];
            if (value != null && Number.isFinite(Number(value))) return Number(value);
        }
        return -Infinity;
    };

    const datasets = datasetsBase
        .sort((a, b) => latestValue(b.data) - latestValue(a.data))
        .map(item => ({
        ...item,
        type: 'line',
        borderWidth: 1,
        pointRadius: 0,
        tension: 0.2,
        fill: true,
        stack: 'share',
        spanGaps: true,
    }));

    if (electricityCharts[canvasId]) {
        electricityCharts[canvasId].destroy();
    }

    electricityCharts[canvasId] = new Chart(canvas.getContext('2d'), {
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
                    stacked: true,
                    title: {
                        display: true,
                        text: 'Month',
                    },
                    grid: {
                        display: false,
                    },
                    ticks: {
                        maxRotation: 0,
                        callback: (value, index) => {
                            if (index % 6 === 0) return labels[index];
                            return '';
                        },
                    },
                },
                y: {
                    stacked: true,
                    min: 0,
                    max: 100,
                    title: {
                        display: true,
                        text: 'Percentage share',
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(0)}%`,
                    },
                    grid: {
                        color: '#D1D5DB',
                    },
                },
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'right',
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

    const title = document.getElementById(titleId);
    if (title) {
        title.textContent = `${displayName} — percentage share (monthly, stacked) (${payload.start_date || 'N/A'} → ${payload.end_date || 'N/A'})`;
    }
}

function renderEuropeUseAndPricesChart(payload) {
    const canvas = document.getElementById('europeUsePriceChart');
    if (!canvas) return;

    const points = Array.isArray(payload && payload.points) ? payload.points : [];
    if (!points.length) {
        throw new Error('No monthly Europe electricity use/price data available.');
    }

    const labels = points.map(point => formatMonthLabel(point.date));
    const totalGeneration = points.map(point => point.total_generation_twh == null ? null : Number(point.total_generation_twh));
    const gasGeneration = points.map(point => point.gas_generation_twh == null ? null : Number(point.gas_generation_twh));
    const coalGeneration = points.map(point => point.coal_generation_twh == null ? null : Number(point.coal_generation_twh));
    const euGasPrice = points.map(point => {
        const value = point.eu_natural_gas_price_eur_per_mwh ?? point.eu_natural_gas_price_usd_per_mmbtu;
        return value == null ? null : Number(value);
    });
    const coalPrice = points.map(point => point.coal_price_usd_per_ton == null ? null : Number(point.coal_price_usd_per_ton));

    if (europeUsePriceChart) {
        europeUsePriceChart.destroy();
    }

    europeUsePriceChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Total electricity use / generation (TWh)',
                    data: totalGeneration,
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED822',
                    borderWidth: 2.4,
                    pointRadius: 1.5,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                    yAxisID: 'y',
                },
                {
                    label: 'Use from gas (TWh)',
                    data: gasGeneration,
                    borderColor: '#B45309',
                    backgroundColor: '#B4530922',
                    borderWidth: 2.2,
                    pointRadius: 1.5,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                    yAxisID: 'y',
                },
                {
                    label: 'Use from coal (TWh)',
                    data: coalGeneration,
                    borderColor: '#374151',
                    backgroundColor: '#37415122',
                    borderWidth: 2.2,
                    pointRadius: 1.5,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                    yAxisID: 'y',
                },
                {
                    label: 'EU natural gas price (EUR/MWh)',
                    data: euGasPrice,
                    borderColor: '#7C3AED',
                    backgroundColor: '#7C3AED22',
                    borderWidth: 2.2,
                    pointRadius: 1.2,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                    yAxisID: 'y1',
                },
                {
                    label: 'Coal price (USD/ton)',
                    data: coalPrice,
                    borderColor: '#059669',
                    backgroundColor: '#05966922',
                    borderWidth: 2.2,
                    pointRadius: 1.2,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                    yAxisID: 'y1',
                }
            ]
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
                    ticks: {
                        maxRotation: 0,
                        callback: (value, index) => {
                            if (index % 6 === 0) return labels[index];
                            return '';
                        },
                    },
                },
                y: {
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Electricity use / generation (TWh)'
                    },
                    grid: {
                        color: '#D1D5DB',
                    }
                },
                y1: {
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Price (gas EUR/MWh, coal USD/ton)'
                    },
                    grid: {
                        drawOnChartArea: false,
                    }
                }
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
                                return `${context.dataset.label}: ${Number(value).toFixed(2)}`;
                            }
                            return `${context.dataset.label}: ${Number(value).toFixed(2)} TWh`;
                        },
                    },
                },
            },
        },
    });

    const title = document.getElementById('europeUsePriceTitle');
    if (title) {
        title.textContent = `Europe electricity use: total, gas, coal + fossil prices (${payload.start_date || 'N/A'} → ${payload.end_date || 'N/A'})`;
    }
}

function renderWorldOilProductionChart(payload, consumptionPayload = null) {
    const canvas = document.getElementById('worldOilProductionChart');
    if (!canvas) return;

    const points = Array.isArray(payload && payload.points) ? payload.points : [];
    if (!points.length) {
        throw new Error('No world oil production data available.');
    }

    const labels = points.map(point => formatMonthLabel(point.date));
    const annualPoints = Array.isArray(consumptionPayload && consumptionPayload.points) ? consumptionPayload.points : [];
    const annualMap = {};
    for (const point of annualPoints) {
        const date = String(point && point.date ? point.date : '');
        const year = date.slice(0, 4);
        const pct = point && point.world_pct_from_2018;
        const value = pct == null ? null : Number(pct);
        if (year && Number.isFinite(value)) {
            annualMap[year] = value;
        }
    }

    const worldSeries = points.map(point => point.world_tbpd == null ? null : Number(point.world_tbpd));
    const toWorldShare = (seriesKey) => points.map((point, index) => {
        const worldValue = worldSeries[index];
        const value = point[seriesKey] == null ? null : Number(point[seriesKey]);
        if (value == null || worldValue == null || worldValue === 0 || Number.isNaN(value) || Number.isNaN(worldValue)) {
            return null;
        }
        return (value / worldValue) * 100;
    });

    const russiaSeries = toWorldShare('russia_tbpd');
    const unitedStatesSeries = toWorldShare('united_states_tbpd');
    const saudiSeries = toWorldShare('saudi_arabia_tbpd');
    const kuwaitSeries = toWorldShare('kuwait_tbpd');
    const qatarSeries = toWorldShare('qatar_tbpd');
    const uaeSeries = toWorldShare('uae_tbpd');
    const iraqSeries = toWorldShare('iraq_tbpd');
    const worldConsumptionAnnualSeries = labels.map(label => {
        if (!label.endsWith('-01')) return null;
        const year = label.slice(0, 4);
        const value = annualMap[year];
        return Number.isFinite(value) ? value : null;
    });

    if (worldOilProductionChart) {
        worldOilProductionChart.destroy();
    }

    worldOilProductionChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Russia',
                    data: russiaSeries,
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED822',
                    borderWidth: 2.0,
                    pointRadius: 0.8,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'United States',
                    data: unitedStatesSeries,
                    borderColor: '#111827',
                    backgroundColor: '#11182722',
                    borderWidth: 2.1,
                    pointRadius: 0.8,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'Saudi Arabia',
                    data: saudiSeries,
                    borderColor: '#B45309',
                    backgroundColor: '#B4530922',
                    borderWidth: 2.0,
                    pointRadius: 0.8,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'Kuwait',
                    data: kuwaitSeries,
                    borderColor: '#7C3AED',
                    backgroundColor: '#7C3AED22',
                    borderWidth: 1.9,
                    pointRadius: 0.8,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'Qatar',
                    data: qatarSeries,
                    borderColor: '#059669',
                    backgroundColor: '#05966922',
                    borderWidth: 1.9,
                    pointRadius: 0.8,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'UAE',
                    data: uaeSeries,
                    borderColor: '#DC2626',
                    backgroundColor: '#DC262622',
                    borderWidth: 1.9,
                    pointRadius: 0.8,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'Iraq',
                    data: iraqSeries,
                    borderColor: '#0F766E',
                    backgroundColor: '#0F766E22',
                    borderWidth: 1.9,
                    pointRadius: 0.8,
                    tension: 0.2,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'World consumption growth (annual, % vs 2018)',
                    data: worldConsumptionAnnualSeries,
                    borderColor: '#BE185D',
                    backgroundColor: '#BE185D22',
                    borderWidth: 2.2,
                    pointRadius: 2.8,
                    tension: 0,
                    spanGaps: true,
                    fill: false,
                    yAxisID: 'y1',
                },
            ]
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
                    ticks: {
                        maxRotation: 0,
                        callback: (value, index) => {
                            if (index % 6 === 0) return labels[index];
                            return '';
                        },
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
                        text: 'World consumption growth (% vs 2018, annual)',
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

    const title = document.getElementById('worldOilProductionTitle');
    if (title) {
        const annualStart = consumptionPayload && consumptionPayload.start_date ? consumptionPayload.start_date : 'N/A';
        const annualEnd = consumptionPayload && consumptionPayload.end_date ? consumptionPayload.end_date : 'N/A';
        title.textContent = `Selected producers monthly share of world production + annual world consumption growth (${payload.start_date || 'N/A'} → ${payload.end_date || 'N/A'}; annual ${annualStart} → ${annualEnd})`;
    }
}

async function fetchAndRenderElectricityEntity(entity, canvasId, titleId, displayName) {
    const response = await fetch(`${API_BASE}/api/europe-electricity-share-monthly?entity=${encodeURIComponent(entity)}&date_from=2021-01-01&date_to=2025-12-01`);
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const payload = await response.json();
    renderElectricityShareChart(payload, canvasId, titleId, displayName);
}

window.addEventListener('DOMContentLoaded', async () => {
    await checkServerStatus();

    try {
        const [productionResponse, consumptionResponse] = await Promise.all([
            fetch(withApiKey(`${API_BASE}/api/world-oil-production-monthly?date_from=2018-01`, eiaProductionApiKey)),
            fetch(withApiKey(`${API_BASE}/api/world-oil-consumption-annual?date_from=2018`, eiaConsumptionApiKey)),
        ]);

        if (!productionResponse.ok) throw new Error(`Server error ${productionResponse.status}`);
        const productionPayload = await productionResponse.json();

        let consumptionPayload = null;
        if (consumptionResponse.ok) {
            consumptionPayload = await consumptionResponse.json();
        } else {
            console.warn(`Annual world consumption request failed with status ${consumptionResponse.status}`);
        }

        renderWorldOilProductionChart(productionPayload, consumptionPayload);
    } catch (error) {
        console.error('Error loading world oil production chart:', error);
        const title = document.getElementById('worldOilProductionTitle');
        if (title) {
            title.textContent = 'World oil production chart failed to load (check production API key/rate limit)';
        }
    }

    try {
        const response = await fetch(`${API_BASE}/api/europe-electricity-use-fossil-prices-monthly?entity=Europe&date_from=2021-01-01&date_to=2025-12-01`);
        if (!response.ok) throw new Error(`Server error ${response.status}`);
        const payload = await response.json();
        renderEuropeUseAndPricesChart(payload);
    } catch (error) {
        console.error('Error loading Europe use/price chart:', error);
        const title = document.getElementById('europeUsePriceTitle');
        if (title) {
            title.textContent = 'Europe electricity use/price chart failed to load';
        }
    }

    const chartConfigs = [
        { entity: 'Europe', canvasId: 'europeElectricityChart', titleId: 'europeElectricityTitle', displayName: 'Europe' },
        { entity: 'United States of America', canvasId: 'usElectricityChart', titleId: 'usElectricityTitle', displayName: 'United States of America' },
        { entity: 'Italy', canvasId: 'italyElectricityChart', titleId: 'italyElectricityTitle', displayName: 'Italy' },
        { entity: 'Belgium', canvasId: 'belgiumElectricityChart', titleId: 'belgiumElectricityTitle', displayName: 'Belgium' },
        { entity: 'France', canvasId: 'franceElectricityChart', titleId: 'franceElectricityTitle', displayName: 'France' },
        { entity: 'Spain', canvasId: 'spainElectricityChart', titleId: 'spainElectricityTitle', displayName: 'Spain' },
        { entity: 'Germany', canvasId: 'germanyElectricityChart', titleId: 'germanyElectricityTitle', displayName: 'Germany' },
    ];

    for (const cfg of chartConfigs) {
        try {
            await fetchAndRenderElectricityEntity(cfg.entity, cfg.canvasId, cfg.titleId, cfg.displayName);
        } catch (error) {
            console.error(`Error loading ${cfg.displayName} electricity chart:`, error);
            const title = document.getElementById(cfg.titleId);
            if (title) {
                title.textContent = `${cfg.displayName} chart failed to load`;
            }
        }
    }
});
