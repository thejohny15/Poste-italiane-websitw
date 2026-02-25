let germanyHoldingsChart = null;
let germanyPercentageChart = null;

const API_BASE = 'http://localhost:5001';

function toPoints(series, key) {
    return (series || []).map(item => ({ x: new Date(item.date), y: item[key] }));
}

function colorForIndex(i) {
    const palette = ['#1D4ED8', '#DC2626', '#059669', '#7C3AED', '#D97706'];
    return palette[i % palette.length];
}

function chartOptions(yTitle, isPercent = false) {
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
                beginAtZero: false,
                title: { display: true, text: yTitle },
                ticks: {
                    callback: value => isPercent
                        ? `${Number(value).toFixed(2)}%`
                        : `$${Number(value).toFixed(0)}B`
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
                        return isPercent
                            ? `${context.dataset.label}: ${v.toFixed(2)}%`
                            : `${context.dataset.label}: $${v.toFixed(2)}B`;
                    }
                }
            }
        }
    };
}

function renderHoldingsChart(data) {
    const ctx = document.getElementById('germanyHoldingsChart').getContext('2d');
    if (germanyHoldingsChart) germanyHoldingsChart.destroy();

    const countries = Object.keys(data.holdings || {});
    const datasets = countries.map((country, i) => {
        const c = colorForIndex(i);
        return {
            label: country,
            data: toPoints(data.holdings[country], 'holdings'),
            borderColor: c,
            backgroundColor: `${c}22`,
            borderWidth: 2.4,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
            spanGaps: true,
        };
    });

    germanyHoldingsChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: chartOptions('Treasury Holdings (Billions USD)', false)
    });
}

function renderPercentageChart(data) {
    const ctx = document.getElementById('germanyPercentageChart').getContext('2d');
    if (germanyPercentageChart) germanyPercentageChart.destroy();

    const countries = Object.keys(data.shares || {});
    const datasets = countries.map((country, i) => {
        const c = colorForIndex(i);
        return {
            label: country,
            data: toPoints(data.shares[country], 'percentage'),
            borderColor: c,
            backgroundColor: `${c}22`,
            borderWidth: 2.4,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
            spanGaps: true,
        };
    });

    germanyPercentageChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: chartOptions('Share of total foreign holdings in Germany (%)', true)
    });
}

async function checkServerStatus() {
    const statusElement = document.getElementById('serverStatus');
    if (!statusElement) return false;

    try {
        const response = await fetch(`${API_BASE}/api/health`);
        if (!response.ok) throw new Error(`Server error ${response.status}`);
        statusElement.textContent = '✅ Connected to API server';
        statusElement.style.background = '#DCFCE7';
        statusElement.style.color = '#166534';
        return true;
    } catch (error) {
        statusElement.textContent = '❌ API server offline. Start api_server.py on port 5001.';
        statusElement.style.background = '#FEE2E2';
        statusElement.style.color = '#991B1B';
        return false;
    }
}

async function fetchAndRenderGermanyData() {
    try {
        const response = await fetch(`${API_BASE}/api/germany-treasury-dashboard`);
        if (!response.ok) throw new Error(`Server error ${response.status}`);
        const data = await response.json();

        const titleEl = document.getElementById('germanySubtitleYear');
        if (titleEl && data.latest_year) {
            titleEl.textContent = `Latest ranking year: ${data.latest_year}`;
        }

        renderHoldingsChart(data);
        renderPercentageChart(data);
    } catch (error) {
        console.error('Error loading Germany treasury dashboard data:', error);
        alert('Could not load Germany Treasury data. Please check API server and try again.');
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    await checkServerStatus();
    await fetchAndRenderGermanyData();

    if (typeof window.fetchEcbShssByIssuer === 'function') {
        await window.fetchEcbShssByIssuer({
            issuerCode: 'DE',
            startPeriod: '2021-Q1',
            canvasId: 'germanyEcbFlowsChart',
            statusId: 'germanyEcbStatus',
            logId: 'germanyEcbLog'
        });
    }

    if (typeof window.loadTradingEconomicsProductivity === 'function') {
        await window.loadTradingEconomicsProductivity({
            countrySlug: 'germany',
            statusId: 'germanyProductivityStatus',
            imageId: 'germanyProductivityImage',
            textId: 'germanyProductivityText',
            linkId: 'germanyProductivitySource'
        });
    }

    if (typeof window.loadTradingEconomicsTopTaxRate === 'function') {
        await window.loadTradingEconomicsTopTaxRate({
            countrySlug: 'germany',
            statusId: 'germanyTaxStatus',
            imageId: 'germanyTaxImage',
            textId: 'germanyTaxText',
            linkId: 'germanyTaxSource',
            metricsId: 'germanyTaxMetrics'
        });
    }
});
