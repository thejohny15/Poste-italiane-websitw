const EIA_KEY_STORAGE_KEY = 'poste_eia_api_key';
const EIA_BASE_URL = 'https://api.eia.gov/v2/international/data/';
let usOecdConsumptionChart = null;

function normalizeEiaKey(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return '';
    if (!/^[A-Za-z0-9]{20,80}$/.test(value)) return '';
    return value;
}

function buildEiaUrl(apiKey) {
    const url = new URL(EIA_BASE_URL);
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
    return url;
}

function parseRowsToSeries(rows) {
    const periodMap = new Map();
    let unitLabel = '';

    for (const row of rows) {
        const period = String(row?.period || '').trim();
        const code = String(row?.countryRegionId || '').trim().toUpperCase();
        const value = row?.value == null ? null : Number(row.value);
        if (!period || !Number.isFinite(value)) continue;
        if (code !== 'USA' && code !== 'OEEU') continue;

        if (!periodMap.has(period)) {
            periodMap.set(period, { usa: null, oeeu: null });
        }

        const bucket = periodMap.get(period);
        if (code === 'USA') bucket.usa = value;
        if (code === 'OEEU') bucket.oeeu = value;

        if (!unitLabel && row?.unit) {
            unitLabel = String(row.unit);
        }
    }

    const periods = Array.from(periodMap.keys()).sort();
    const labels = periods;
    const usa = periods.map(period => periodMap.get(period)?.usa ?? null);
    const oeeu = periods.map(period => periodMap.get(period)?.oeeu ?? null);

    return {
        labels,
        usa,
        oeeu,
        unitLabel: unitLabel || 'QBTU',
    };
}

function renderChart(series) {
    const canvas = document.getElementById('usOecdConsumptionChart');
    if (!canvas) return;

    if (usOecdConsumptionChart) {
        usOecdConsumptionChart.destroy();
    }

    usOecdConsumptionChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: series.labels,
            datasets: [
                {
                    label: 'United States',
                    data: series.usa,
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED822',
                    borderWidth: 2,
                    pointRadius: 0.8,
                    tension: 0.15,
                    spanGaps: true,
                    fill: false,
                },
                {
                    label: 'OECD Europe',
                    data: series.oeeu,
                    borderColor: '#DC2626',
                    backgroundColor: '#DC262622',
                    borderWidth: 2,
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
                        callback: (value, index) => (index % 6 === 0 ? series.labels[index] : ''),
                    },
                    grid: {
                        display: false,
                    },
                },
                y: {
                    title: {
                        display: true,
                        text: `Consumption (${series.unitLabel})`,
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
                            return `${context.dataset.label}: ${Number(value).toFixed(2)} ${series.unitLabel}`;
                        },
                    },
                },
            },
        },
    });
}

async function loadData() {
    const title = document.getElementById('usOecdConsumptionTitle');
    const keyInput = document.getElementById('eiaApiKeyInput');
    const keyStatus = document.getElementById('eiaKeyStatus');

    const pageParams = new URLSearchParams(window.location.search);
    const queryKey = normalizeEiaKey(pageParams.get('eia_api_key'));
    const storedKey = normalizeEiaKey(localStorage.getItem(EIA_KEY_STORAGE_KEY) || '');
    const apiKey = queryKey || storedKey;

    if (keyInput && apiKey) {
        keyInput.value = apiKey;
    }

    if (!apiKey) {
        if (title) title.textContent = 'Missing EIA key. Add ?eia_api_key=YOUR_KEY or paste key above.';
        if (keyStatus) keyStatus.textContent = 'No key stored.';
        return;
    }

    if (keyStatus) keyStatus.textContent = queryKey ? 'Using key from URL.' : 'Using key from local storage.';

    const url = buildEiaUrl(apiKey);

    try {
        const response = await fetch(url.toString());
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            const message = payload?.error?.message || payload?.error || `Request failed (${response.status})`;
            throw new Error(message);
        }

        const rows = Array.isArray(payload?.response?.data) ? payload.response.data : [];
        const series = parseRowsToSeries(rows);

        if (!series.labels.length) {
            throw new Error('No rows returned for USA/OECD Europe with selected parameters.');
        }

        renderChart(series);
        if (title) {
            const start = series.labels[0] || 'N/A';
            const end = series.labels[series.labels.length - 1] || 'N/A';
            title.textContent = `Monthly consumption: United States vs OECD Europe (${start} → ${end})`;
        }
    } catch (error) {
        if (title) title.textContent = `Chart failed: ${error.message}`;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const keyInput = document.getElementById('eiaApiKeyInput');
    const keyStatus = document.getElementById('eiaKeyStatus');
    const saveBtn = document.getElementById('saveEiaKeyBtn');
    const clearBtn = document.getElementById('clearEiaKeyBtn');

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const value = normalizeEiaKey((keyInput && keyInput.value) || '');
            if (!value) {
                if (keyStatus) keyStatus.textContent = 'Invalid key format. Paste your EIA API key and try again.';
                return;
            }
            localStorage.setItem(EIA_KEY_STORAGE_KEY, value);
            if (keyStatus) keyStatus.textContent = 'Key saved. Reloading chart...';
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

    loadData();
});
