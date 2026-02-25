let ccLeverageChart = null;
let ccCostChart = null;
let ccStressChart = null;

const API_BASE = 'http://localhost:5001';

const crisisPeriods = [
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

function rollingAveragePoints(points, monthsWindow) {
    const millisPerDay = 24 * 60 * 60 * 1000;
    const approxWindowMs = monthsWindow * 30.44 * millisPerDay;

    return points.map((p, i) => {
        if (!p || p.y == null || !(p.x instanceof Date)) return { x: p.x, y: null };

        const t = p.x.getTime();
        const windowStart = t - approxWindowMs;
        const inWindow = points.filter(q => q && q.y != null && q.x instanceof Date && q.x.getTime() <= t && q.x.getTime() >= windowStart);
        if (!inWindow.length) return { x: p.x, y: null };

        const avg = inWindow.reduce((sum, q) => sum + q.y, 0) / inWindow.length;
        return { x: p.x, y: avg };
    });
}

function makeRollingDatasets(baseLabel, basePoints, color) {
    return [
        {
            label: `${baseLabel} (6M MA)`,
            data: rollingAveragePoints(basePoints, 6),
            borderColor: color,
            borderDash: [6, 4],
            borderWidth: 1.6,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
            spanGaps: true,
        },
        {
            label: `${baseLabel} (12M MA)`,
            data: rollingAveragePoints(basePoints, 12),
            borderColor: color,
            borderDash: [2, 4],
            borderWidth: 1.6,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
            spanGaps: true,
        }
    ];
}

function commonTimeOptions(yTitle, suffix = '') {
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
                    callback: value => `${Number(value).toFixed(1)}${suffix}`
                }
            }
        },
        plugins: {
            legend: { display: true, position: 'top' },
            subtitle: {
                display: true,
                text: 'Shaded periods: Dot-com bust, Global Financial Crisis, COVID shock, Banking stress',
                color: '#4B5563',
                padding: { top: 0, bottom: 8 }
            },
            tooltip: {
                callbacks: {
                    label: function (context) {
                        const v = context.parsed.y;
                        if (v == null) return `${context.dataset.label}: N/A`;
                        return `${context.dataset.label}: ${v.toFixed(2)}${suffix}`;
                    }
                }
            }
        }
    };
}

function renderLeverageChart(data) {
    const ctx = document.getElementById('ccLeverageChart').getContext('2d');
    if (ccLeverageChart) ccLeverageChart.destroy();

    const debtGdpPoints = toPoints(data.leverage, 'debt_to_gdp');
    const debtDpiPoints = toPoints(data.leverage, 'debt_to_disposable_income');

    const datasets = [
        {
            label: 'Debt / GDP',
            data: debtGdpPoints,
            borderColor: '#1D4ED8',
            backgroundColor: '#1D4ED822',
            borderWidth: 2.2,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
            spanGaps: true,
        },
        ...makeRollingDatasets('Debt / GDP', debtGdpPoints, '#1D4ED8'),
        {
            label: 'Debt / Disposable Income',
            data: debtDpiPoints,
            borderColor: '#059669',
            backgroundColor: '#05966922',
            borderWidth: 2.2,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
            spanGaps: true,
        },
        ...makeRollingDatasets('Debt / Disposable Income', debtDpiPoints, '#059669')
    ];

    ccLeverageChart = new Chart(ctx, {
        plugins: [crisisShadingPlugin],
        type: 'line',
        data: { datasets },
        options: commonTimeOptions('Leverage (%)', '%')
    });
}

function renderCostChart(data) {
    const ctx = document.getElementById('ccCostChart').getContext('2d');
    if (ccCostChart) ccCostChart.destroy();

    const aprPoints = toPoints(data.cost_of_credit, 'credit_card_apr');
    const fedPoints = toPoints(data.cost_of_credit, 'fed_funds_rate');
    const spreadPoints = toPoints(data.cost_of_credit, 'spread_apr_minus_fedfunds');

    const datasets = [
        {
            label: 'Credit Card APR',
            data: aprPoints,
            borderColor: '#DC2626',
            backgroundColor: '#DC262622',
            borderWidth: 2.2,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
            spanGaps: true,
        },
        ...makeRollingDatasets('Credit Card APR', aprPoints, '#DC2626'),
        {
            label: 'Fed Funds Rate',
            data: fedPoints,
            borderColor: '#7C3AED',
            backgroundColor: '#7C3AED22',
            borderWidth: 2.2,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
            spanGaps: true,
        },
        ...makeRollingDatasets('Fed Funds Rate', fedPoints, '#7C3AED'),
        {
            label: 'Spread (APR − Fed Funds)',
            data: spreadPoints,
            borderColor: '#D97706',
            backgroundColor: '#D9770622',
            borderWidth: 2.2,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
            spanGaps: true,
        },
        ...makeRollingDatasets('Spread (APR − Fed Funds)', spreadPoints, '#D97706')
    ];

    ccCostChart = new Chart(ctx, {
        plugins: [crisisShadingPlugin],
        type: 'line',
        data: { datasets },
        options: commonTimeOptions('Rate (%)', '%')
    });
}

function renderStressChart(data) {
    const ctx = document.getElementById('ccStressChart').getContext('2d');
    if (ccStressChart) ccStressChart.destroy();

    const delinqPoints = toPoints(data.stress, 'delinquency_rate');
    const chargeoffPoints = toPoints(data.stress, 'chargeoff_rate');

    ccStressChart = new Chart(ctx, {
        plugins: [crisisShadingPlugin],
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Delinquency Rate',
                    data: delinqPoints,
                    borderColor: '#111827',
                    backgroundColor: '#11182722',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                },
                ...makeRollingDatasets('Delinquency Rate', delinqPoints, '#111827'),
                {
                    label: 'Net Charge-off Rate',
                    data: chargeoffPoints,
                    borderColor: '#BE123C',
                    backgroundColor: '#BE123C22',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                },
                ...makeRollingDatasets('Net Charge-off Rate', chargeoffPoints, '#BE123C')
            ]
        },
        options: commonTimeOptions('Rate (%)', '%')
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

async function fetchAndRenderCreditCardData() {
    try {
        const response = await fetch(`${API_BASE}/api/credit-card-dashboard`);
        if (!response.ok) throw new Error(`Server error ${response.status}`);
        const data = await response.json();

        renderLeverageChart(data);
        renderCostChart(data);
        renderStressChart(data);
    } catch (error) {
        console.error('Error loading credit card dashboard data:', error);
        alert('Could not load credit card dashboard data. Please check API server and try again.');
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    await checkServerStatus();
    await fetchAndRenderCreditCardData();
});
