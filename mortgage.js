let mortgageMainChart = null;
let mortgageStressChart = null;
let mortgageAffordabilityChart = null;

const API_BASE = 'http://localhost:5001';

const crisisPeriods = [
    { label: 'Early 1990s recession', start: '1990-07-01', end: '1991-03-31', color: 'rgba(107, 114, 128, 0.10)' },
    { label: 'Dot-com bust', start: '2001-03-01', end: '2001-11-30', color: 'rgba(239, 68, 68, 0.10)' },
    { label: 'Global Financial Crisis', start: '2007-12-01', end: '2009-06-30', color: 'rgba(220, 38, 38, 0.12)' },
    { label: 'COVID shock', start: '2020-02-01', end: '2020-04-30', color: 'rgba(249, 115, 22, 0.12)' },
    { label: 'Banking stress', start: '2023-03-01', end: '2023-06-30', color: 'rgba(234, 179, 8, 0.10)' },
];

const crisisShadingPlugin = {
    id: 'crisisShading',
    beforeDatasetsDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        const xScale = scales.x;
        if (!ctx || !chartArea || !xScale) return;

        ctx.save();
        for (const p of crisisPeriods) {
            const startX = xScale.getPixelForValue(new Date(p.start));
            const endX = xScale.getPixelForValue(new Date(p.end));
            const left = Math.max(chartArea.left, Math.min(startX, endX));
            const right = Math.min(chartArea.right, Math.max(startX, endX));
            if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) continue;

            ctx.fillStyle = p.color;
            ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
        }
        ctx.restore();
    }
};

function toPoints(series, valueKey) {
    return (series || []).map(item => ({ x: new Date(item.date), y: item[valueKey] }));
}

function commonTimeOptions() {
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
                title: { display: true, text: 'Percent (%)' },
                ticks: {
                    callback: value => `${Number(value).toFixed(1)}%`
                }
            }
        },
        plugins: {
            legend: { display: true, position: 'top' },
            subtitle: {
                display: true,
                text: 'Shaded periods: Early 1990s recession, Dot-com bust, GFC, COVID shock, Banking stress',
                color: '#4B5563',
                padding: { top: 0, bottom: 8 }
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

function renderMortgageMainChart(data) {
    const ctx = document.getElementById('mortgageMainChart').getContext('2d');
    if (mortgageMainChart) mortgageMainChart.destroy();

    mortgageMainChart = new Chart(ctx, {
        plugins: [crisisShadingPlugin],
        type: 'line',
        data: {
            datasets: [
                {
                    label: '30Y Fixed Mortgage Rate',
                    data: toPoints(data.series, 'mortgage_30y_fixed'),
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED822',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                },
                {
                    label: '15Y Fixed Mortgage Rate',
                    data: toPoints(data.series, 'mortgage_15y_fixed'),
                    borderColor: '#059669',
                    backgroundColor: '#05966922',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                },
                {
                    label: '5/1 ARM Rate',
                    data: toPoints(data.series, 'mortgage_5_1_arm'),
                    borderColor: '#7C3AED',
                    backgroundColor: '#7C3AED22',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                },
                {
                    label: 'House Price YoY % Change',
                    data: toPoints(data.series, 'house_price_yoy'),
                    borderColor: '#DC2626',
                    backgroundColor: '#DC262622',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                }
            ]
        },
        options: commonTimeOptions()
    });
}

function renderMortgageStressChart(data) {
    const ctx = document.getElementById('mortgageStressChart').getContext('2d');
    if (mortgageStressChart) mortgageStressChart.destroy();

    mortgageStressChart = new Chart(ctx, {
        plugins: [crisisShadingPlugin],
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Mortgage Debt Service Ratio (MDSP)',
                    data: toPoints(data.burden_distress, 'mortgage_debt_service_ratio'),
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED822',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                },
                {
                    label: 'Mortgage Delinquency Rate (Single-Family)',
                    data: toPoints(data.burden_distress, 'mortgage_delinquency_rate'),
                    borderColor: '#DC2626',
                    backgroundColor: '#DC262622',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                },
                {
                    label: 'Total Debt Service Ratio (TDSP)',
                    data: toPoints(data.burden_distress, 'total_debt_service_ratio'),
                    borderColor: '#7C3AED',
                    backgroundColor: '#7C3AED22',
                    borderWidth: 2.0,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                },
                {
                    label: 'Unemployment Rate',
                    data: toPoints(data.burden_distress, 'unemployment_rate'),
                    borderColor: '#D97706',
                    backgroundColor: '#D9770622',
                    borderWidth: 2.0,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                }
            ]
        },
        options: commonTimeOptions()
    });
}

function renderMortgageAffordabilityChart(data) {
    const ctx = document.getElementById('mortgageAffordabilityChart').getContext('2d');
    if (mortgageAffordabilityChart) mortgageAffordabilityChart.destroy();

    mortgageAffordabilityChart = new Chart(ctx, {
        plugins: [crisisShadingPlugin],
        type: 'line',
        data: {
            datasets: [
                {
                    label: '30Y Mortgage Rate',
                    data: toPoints(data.affordability, 'mortgage_30y_fixed'),
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED822',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                },
                {
                    label: 'Median Household Income Growth',
                    data: toPoints(data.affordability, 'median_household_income_growth'),
                    borderColor: '#059669',
                    backgroundColor: '#05966922',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                },
                {
                    label: 'Home Price Growth',
                    data: toPoints(data.affordability, 'home_price_growth'),
                    borderColor: '#DC2626',
                    backgroundColor: '#DC262622',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                },
                {
                    label: 'Unemployment Rate',
                    data: toPoints(data.affordability, 'unemployment_rate'),
                    borderColor: '#D97706',
                    backgroundColor: '#D9770622',
                    borderWidth: 2.0,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                }
            ]
        },
        options: commonTimeOptions()
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

async function fetchAndRenderMortgageData() {
    try {
        const response = await fetch(`${API_BASE}/api/mortgage-dashboard`);
        if (!response.ok) throw new Error(`Server error ${response.status}`);
        const data = await response.json();

        renderMortgageMainChart(data);
        renderMortgageStressChart(data);
        renderMortgageAffordabilityChart(data);
    } catch (error) {
        console.error('Error loading mortgage dashboard data:', error);
        alert('Could not load mortgage dashboard data. Please check API server and try again.');
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    await checkServerStatus();
    await fetchAndRenderMortgageData();
});
