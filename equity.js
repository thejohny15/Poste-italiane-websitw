let equityMajorChart = null;
let equityEuroComponentsChart = null;
let equityPercentageChart = null;
let equitySP500PercentageChart = null;

const API_BASE = 'http://localhost:5001';

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

function seriesToPoints(series) {
    return (series || []).map(item => ({ x: new Date(item.date), y: item.holdings }));
}

function buildLineDataset(label, series, color) {
    return {
        label,
        data: seriesToPoints(series),
        borderColor: color,
        backgroundColor: `${color}22`,
        borderWidth: 2.2,
        fill: false,
        tension: 0.15,
        pointRadius: 0,
        spanGaps: true
    };
}

function chartOptions(yTitle) {
    return {
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
                    text: 'Date'
                }
            },
            y: {
                beginAtZero: false,
                title: {
                    display: true,
                    text: yTitle
                },
                ticks: {
                    callback: value => {
                        const formatted = Number(value)
                            .toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                            .replace(/,/g, "'");
                        return `$${formatted}B`;
                    }
                }
            }
        },
        plugins: {
            legend: {
                display: true,
                position: 'top'
            },
            tooltip: {
                callbacks: {
                    label: function (context) {
                        const v = context.parsed.y;
                        if (v == null) return `${context.dataset.label}: N/A`;
                        return `${context.dataset.label}: $${v.toFixed(2)}B`;
                    }
                }
            }
        }
    };
}

function percentageChartOptions(yTitle) {
    return {
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
                    text: 'Date'
                }
            },
            y: {
                beginAtZero: true,
                title: {
                    display: true,
                    text: yTitle
                },
                ticks: {
                    callback: value => `${Number(value).toFixed(1)}%`
                }
            }
        },
        plugins: {
            legend: {
                display: true,
                position: 'top'
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
    };
}

function renderMajorChart(data) {
    const canvas = document.getElementById('equityMajorChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const datasets = [
        buildLineDataset('Japan', data['Japan'], '#1D4ED8'),
        buildLineDataset('China', data['China'], '#DC2626'),
        buildLineDataset('United Kingdom', data['United Kingdom'], '#059669'),
        buildLineDataset('Euro Zone', data['Euro Zone'], '#EAB308')
    ];

    if (equityMajorChart) equityMajorChart.destroy();
    equityMajorChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: chartOptions('Holdings (Billions USD)')
    });
}

function renderEuroComponentsChart(data) {
    const canvas = document.getElementById('equityEuroComponentsChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const countries = ['Belgium', 'Luxembourg', 'France', 'Ireland', 'Norway', 'Germany', 'Spain', 'Italy'];
    const colors = {
        'Belgium': '#2563EB',
        'Luxembourg': '#7C3AED',
        'France': '#DC2626',
        'Ireland': '#16A34A',
        'Norway': '#D97706',
        'Germany': '#111827',
        'Spain': '#0891B2',
        'Italy': '#EC4899'
    };

    const countryMaps = {};
    countries.forEach(country => {
        countryMaps[country] = new Map((data[country] || []).map(item => [item.date, item.holdings]));
    });

    const allDateStrings = Array.from(new Set(
        countries.flatMap(country => (data[country] || []).map(item => item.date))
    )).sort();
    const labels = allDateStrings.map(dateStr => new Date(`${dateStr}T00:00:00`));

    const totalsByDate = new Map();
    allDateStrings.forEach(date => {
        const total = countries.reduce((sum, country) => {
            const v = countryMaps[country].get(date);
            return sum + (v != null ? v : 0);
        }, 0);
        totalsByDate.set(date, total);
    });

    const datasets = countries.map(country => ({
        label: country,
        data: allDateStrings.map(date => {
            const v = countryMaps[country].get(date);
            const total = totalsByDate.get(date);
            if (v == null || !total) return null;
            return (v / total) * 100;
        }),
        borderColor: colors[country],
        backgroundColor: `${colors[country]}22`,
        borderWidth: 2.2,
        fill: false,
        tension: 0.15,
        pointRadius: 0,
        spanGaps: true
    }));

    if (equityEuroComponentsChart) equityEuroComponentsChart.destroy();
    equityEuroComponentsChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: percentageChartOptions('Share of Euro Zone U.S. corporate equity (%)')
    });
}

function renderPercentageChart(data) {
    const canvas = document.getElementById('equityPercentageChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const toPoints = (series) => (series || []).map(item => ({ x: new Date(item.date), y: item.percentage }));

    const datasets = [
        {
            label: 'Japan',
            data: toPoints(data['Japan']),
            borderColor: '#1D4ED8',
            backgroundColor: '#1D4ED822',
            borderWidth: 2.2,
            fill: false,
            tension: 0.15,
            pointRadius: 0,
            spanGaps: true
        },
        {
            label: 'China',
            data: toPoints(data['China']),
            borderColor: '#DC2626',
            backgroundColor: '#DC262622',
            borderWidth: 2.2,
            fill: false,
            tension: 0.15,
            pointRadius: 0,
            spanGaps: true
        },
        {
            label: 'United Kingdom',
            data: toPoints(data['United Kingdom']),
            borderColor: '#059669',
            backgroundColor: '#05966922',
            borderWidth: 2.2,
            fill: false,
            tension: 0.15,
            pointRadius: 0,
            spanGaps: true
        },
        {
            label: 'Euro Zone',
            data: toPoints(data['Euro Zone']),
            borderColor: '#EAB308',
            backgroundColor: '#EAB30822',
            borderWidth: 2.2,
            fill: false,
            tension: 0.15,
            pointRadius: 0,
            spanGaps: true
        }
    ];

    if (equityPercentageChart) equityPercentageChart.destroy();
    equityPercentageChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: percentageChartOptions('Share of CRSP US Total Market Index-based denominator (%)')
    });
}

function renderSP500PercentageChart(data) {
    const canvas = document.getElementById('equitySP500PercentageChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const toPoints = (series) => (series || []).map(item => ({ x: new Date(item.date), y: item.percentage }));

    const datasets = [
        {
            label: 'Japan',
            data: toPoints(data['Japan']),
            borderColor: '#1D4ED8',
            backgroundColor: '#1D4ED822',
            borderWidth: 2.2,
            fill: false,
            tension: 0.15,
            pointRadius: 0,
            spanGaps: true
        },
        {
            label: 'China',
            data: toPoints(data['China']),
            borderColor: '#DC2626',
            backgroundColor: '#DC262622',
            borderWidth: 2.2,
            fill: false,
            tension: 0.15,
            pointRadius: 0,
            spanGaps: true
        },
        {
            label: 'United Kingdom',
            data: toPoints(data['United Kingdom']),
            borderColor: '#059669',
            backgroundColor: '#05966922',
            borderWidth: 2.2,
            fill: false,
            tension: 0.15,
            pointRadius: 0,
            spanGaps: true
        },
        {
            label: 'Euro Zone',
            data: toPoints(data['Euro Zone']),
            borderColor: '#EAB308',
            backgroundColor: '#EAB30822',
            borderWidth: 2.2,
            fill: false,
            tension: 0.15,
            pointRadius: 0,
            spanGaps: true
        }
    ];

    if (equitySP500PercentageChart) equitySP500PercentageChart.destroy();
    equitySP500PercentageChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: percentageChartOptions('Share of S&P 500 market capitalization (%)')
    });
}

async function fetchAndRenderEquityData() {
    try {
        const [holdingsResp, percentageResp, sp500PercentageResp] = await Promise.allSettled([
            fetch(`${API_BASE}/api/us-equity-holders`),
            fetch(`${API_BASE}/api/us-equity-holders-percentage`),
            fetch(`${API_BASE}/api/us-equity-holders-percentage-sp500`)
        ]);

        let holdingsLoaded = false;
        let percentageLoaded = false;
        let sp500PercentageLoaded = false;

        if (holdingsResp.status === 'fulfilled' && holdingsResp.value.ok) {
            const data = await holdingsResp.value.json();
            renderMajorChart(data);
            renderEuroComponentsChart(data);
            holdingsLoaded = true;
        } else {
            console.error('Error loading /api/us-equity-holders', holdingsResp);
        }

        if (percentageResp.status === 'fulfilled' && percentageResp.value.ok) {
            const percentageData = await percentageResp.value.json();
            renderPercentageChart(percentageData);
            percentageLoaded = true;
        } else {
            console.error('Error loading /api/us-equity-holders-percentage', percentageResp);
        }

        if (sp500PercentageResp.status === 'fulfilled' && sp500PercentageResp.value.ok) {
            const sp500PercentageData = await sp500PercentageResp.value.json();
            renderSP500PercentageChart(sp500PercentageData);
            sp500PercentageLoaded = true;
        } else {
            console.error('Error loading /api/us-equity-holders-percentage-sp500', sp500PercentageResp);
        }

        if (!holdingsLoaded && !percentageLoaded && !sp500PercentageLoaded) {
            throw new Error('All equity endpoints failed');
        }
    } catch (error) {
        console.error('Error loading US equity holders data:', error);
        alert('Could not load US equity data. Please check API server and try again.');
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    await checkServerStatus();
    await fetchAndRenderEquityData();
});
