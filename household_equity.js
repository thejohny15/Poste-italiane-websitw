let householdEquityChart = null;
let wealthEffectChart = null;
let equityStressChart = null;

const API_BASE = 'http://localhost:5001';

function toPoints(series, valueKey) {
    return (series || []).map(item => ({ x: new Date(item.date), y: item[valueKey] }));
}

function chartOptions() {
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
                title: { display: true, text: 'Ratio / Index Level' },
                ticks: {
                    callback: value => Number(value).toFixed(1)
                }
            },
            y1: {
                position: 'right',
                beginAtZero: false,
                title: { display: true, text: 'Unemployment Rate (%)' },
                grid: { drawOnChartArea: false },
                ticks: {
                    callback: value => `${Number(value).toFixed(1)}%`
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
                        if (context.dataset.label.includes('Unemployment')) {
                            return `${context.dataset.label}: ${v.toFixed(2)}%`;
                        }
                        return `${context.dataset.label}: ${v.toFixed(2)}`;
                    }
                }
            }
        }
    };
}

function percentChartOptions(yTitle = 'YoY Growth (%)') {
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
                    callback: value => `${Number(value).toFixed(1)}%`
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
                        return `${context.dataset.label}: ${v.toFixed(2)}%`;
                    }
                }
            }
        }
    };
}

function wealthEffectOptions() {
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
                title: { display: true, text: 'YoY Growth (%)' },
                ticks: {
                    callback: value => `${Number(value).toFixed(1)}%`
                }
            },
            y1: {
                position: 'right',
                beginAtZero: false,
                title: { display: true, text: 'Household Equity / Disposable Income (%)' },
                grid: { drawOnChartArea: false },
                ticks: {
                    callback: value => `${Number(value).toFixed(1)}%`
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
                        return `${context.dataset.label}: ${v.toFixed(2)}%`;
                    }
                }
            }
        }
    };
}

function stressChartOptions() {
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
                title: { display: true, text: 'Household Equity / DPI (%)' },
                ticks: {
                    callback: value => `${Number(value).toFixed(1)}%`
                }
            },
            y1: {
                position: 'right',
                beginAtZero: false,
                title: { display: true, text: 'Stress Rates (%)' },
                grid: { drawOnChartArea: false },
                ticks: {
                    callback: value => `${Number(value).toFixed(1)}%`
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
                        return `${context.dataset.label}: ${v.toFixed(2)}%`;
                    }
                }
            }
        }
    };
}

function renderChart(data) {
    const ctx = document.getElementById('householdEquityChart').getContext('2d');
    if (householdEquityChart) householdEquityChart.destroy();

    householdEquityChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Household Equity / Disposable Income',
                    data: toPoints(data.series, 'household_equity_to_dpi'),
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
                    label: 'S&P 500 (Normalized = 100)',
                    data: toPoints(data.series, 'sp500_normalized'),
                    borderColor: '#059669',
                    backgroundColor: '#05966922',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Unemployment Rate',
                    data: toPoints(data.series, 'unemployment_rate'),
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
        options: chartOptions()
    });
}

function renderWealthEffectChart(data) {
    const ctx = document.getElementById('wealthEffectChart').getContext('2d');
    if (wealthEffectChart) wealthEffectChart.destroy();

    wealthEffectChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Growth in Household Equity (YoY)',
                    data: toPoints(data.wealth_effect, 'household_equity_growth_yoy'),
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
                    label: 'Growth in Real Disposable Income (YoY)',
                    data: toPoints(data.wealth_effect, 'real_disposable_income_growth_yoy'),
                    borderColor: '#059669',
                    backgroundColor: '#05966922',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Personal Consumption Growth (YoY)',
                    data: toPoints(data.wealth_effect, 'personal_consumption_growth_yoy'),
                    borderColor: '#DC2626',
                    backgroundColor: '#DC262622',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Household Equity / Disposable Income',
                    data: toPoints(data.series, 'household_equity_to_dpi'),
                    borderColor: '#0EA5E9',
                    backgroundColor: '#0EA5E922',
                    borderWidth: 2.4,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                    yAxisID: 'y1'
                }
            ]
        },
        options: wealthEffectOptions()
    });
}

function renderEquityStressChart(data) {
    const ctx = document.getElementById('equityStressChart').getContext('2d');
    if (equityStressChart) equityStressChart.destroy();

    equityStressChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Household Equity / Disposable Income',
                    data: toPoints(data.exposure_vs_stress, 'household_equity_to_dpi'),
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED822',
                    borderWidth: 2.6,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Mortgage Delinquency Rate',
                    data: toPoints(data.exposure_vs_stress, 'mortgage_delinquency_rate'),
                    borderColor: '#DC2626',
                    backgroundColor: '#DC262622',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                    yAxisID: 'y1'
                },
                {
                    label: 'Debt Service Ratio',
                    data: toPoints(data.exposure_vs_stress, 'debt_service_ratio'),
                    borderColor: '#7C3AED',
                    backgroundColor: '#7C3AED22',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15,
                    spanGaps: true,
                    yAxisID: 'y1'
                }
            ]
        },
        options: stressChartOptions()
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

async function fetchAndRenderData() {
    try {
        const response = await fetch(`${API_BASE}/api/household-equity-dashboard`);
        if (!response.ok) throw new Error(`Server error ${response.status}`);
        const data = await response.json();

        renderChart(data);
        renderWealthEffectChart(data);
        renderEquityStressChart(data);
    } catch (error) {
        console.error('Error loading household equity dashboard data:', error);
        alert('Could not load household equity dashboard data. Please check API server and try again.');
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    await checkServerStatus();
    await fetchAndRenderData();
});
