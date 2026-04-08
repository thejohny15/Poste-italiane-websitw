const electricityCharts = {};
const API_BASE = 'http://localhost:5001';
let europeUsePriceChart = null;
let worldOilProductionChart = null;
let aluminumTopExportersChart = null;
let lngTopExportersChart = null;
let nglTopExportersChart = null;
let sulfurTopExportersChart = null;
let naphthaNetExportsChart = null;

const pageParams = new URLSearchParams(window.location.search);
const eiaProductionApiKey = pageParams.get('eia_production_api_key') || '';
const eiaConsumptionApiKey = pageParams.get('eia_consumption_api_key') || '';

function withApiKey(url, key) {
    if (!key) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}api_key=${encodeURIComponent(key)}`;
}

function downloadChartFromInstance(chartInstance, fileName, titleText = '') {
    if (!chartInstance || !chartInstance.canvas) return false;

    const sourceCanvas = chartInstance.canvas;
    const title = String(titleText || '').trim();
    const topPadding = title ? 52 : 0;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = sourceCanvas.width;
    exportCanvas.height = sourceCanvas.height + topPadding;

    const exportCtx = exportCanvas.getContext('2d');
    exportCtx.fillStyle = '#FFFFFF';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    if (title) {
        exportCtx.fillStyle = '#0B3A75';
        exportCtx.font = 'bold 26px Arial';
        exportCtx.textAlign = 'center';
        exportCtx.textBaseline = 'middle';
        exportCtx.fillText(title, exportCanvas.width / 2, 26);
    }

    exportCtx.drawImage(sourceCanvas, 0, topPadding);

    const link = document.createElement('a');
    link.href = exportCanvas.toDataURL('image/png', 1.0);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
}

function renderAluminumTopExportersChart(payload) {
    const canvas = document.getElementById('aluminumTopExportersChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No aluminum exporter data returned.');
    }

    const labels = points.map(point => String(point.year));
    const palette = ['#1D4ED8', '#059669', '#EA580C', '#A855F7', '#7C2D12'];

    const datasets = countries.map((country, index) => {
        const color = palette[index % palette.length];
        return {
            label: country.name || country.code || 'Country',
            data: points.map(point => {
                const value = point[country.series_key];
                return value == null ? null : Number(value);
            }),
            borderColor: color,
            backgroundColor: `${color}22`,
            borderWidth: 2.2,
            pointRadius: 1.8,
            tension: 0.2,
            spanGaps: true,
            fill: false,
        };
    });

    if (aluminumTopExportersChart) {
        aluminumTopExportersChart.destroy();
    }

    aluminumTopExportersChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { title: { display: true, text: 'Year' }, grid: { display: false } },
                y: {
                    title: { display: true, text: 'Share of world exports (%)' },
                    ticks: { callback: value => `${Number(value).toFixed(2)}%` },
                    grid: { color: '#D1D5DB' },
                },
            },
            plugins: {
                legend: { display: true, position: 'bottom' },
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

    const title = document.getElementById('aluminumTopExportersTitle');
    if (title) {
        title.textContent = `Top ${countries.length} aluminium exporters — share of world exports (${payload.start_year || 'N/A'}→${payload.end_year || 'N/A'})`;
    }
}

function renderAluminumRankingTable(payload) {
    const container = document.getElementById('aluminumRankingTable');
    const title = document.getElementById('aluminumRankingTitle');
    if (!container) return;

    const rankings = Array.isArray(payload?.latest_rankings) ? payload.latest_rankings : [];
    const year = payload?.selection_year || 'N/A';

    if (title) {
        title.textContent = `Latest available rankings (latest year per country, overall ${year})`;
    }

    if (!rankings.length) {
        container.textContent = 'No ranking data available.';
        return;
    }

    const rows = rankings.map(item => {
        const rank = item.rank == null ? 'N/A' : `#${item.rank}`;
        const share = item.share_pct == null ? 'N/A' : `${Number(item.share_pct).toFixed(2)}%`;
        return `<tr><td>${item.name}</td><td>${rank}</td><td>${share}</td></tr>`;
    }).join('');

    container.innerHTML = `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr>
                    <th style="text-align:left; padding: 6px 0;">Country</th>
                    <th style="text-align:left; padding: 6px 0;">Rank</th>
                    <th style="text-align:left; padding: 6px 0;">Share of world exports</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function renderLngTopExportersChart(payload) {
    const canvas = document.getElementById('lngTopExportersChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No LNG exporter data returned.');
    }

    const labels = points.map(point => String(point.year));
    const palette = ['#0EA5E9', '#14B8A6', '#F97316', '#8B5CF6', '#1D4ED8'];

    const datasets = countries.map((country, index) => {
        const color = palette[index % palette.length];
        return {
            label: country.name || country.code || 'Country',
            data: points.map(point => {
                const value = point[country.series_key];
                return value == null ? null : Number(value);
            }),
            borderColor: color,
            backgroundColor: `${color}22`,
            borderWidth: 2.2,
            pointRadius: 1.8,
            tension: 0.2,
            spanGaps: true,
            fill: false,
        };
    });

    if (lngTopExportersChart) {
        lngTopExportersChart.destroy();
    }

    lngTopExportersChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { title: { display: true, text: 'Year' }, grid: { display: false } },
                y: {
                    title: { display: true, text: 'Share of world exports (%)' },
                    ticks: { callback: value => `${Number(value).toFixed(2)}%` },
                    grid: { color: '#D1D5DB' },
                },
            },
            plugins: {
                legend: { display: true, position: 'bottom' },
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

    const title = document.getElementById('lngTopExportersTitle');
    if (title) {
        title.textContent = `Top ${countries.length} LNG exporters — share of world exports (${payload.start_year || 'N/A'}→${payload.end_year || 'N/A'})`;
    }
}

function renderLngRankingTable(payload) {
    const container = document.getElementById('lngRankingTable');
    const title = document.getElementById('lngRankingTitle');
    if (!container) return;

    const rankings = Array.isArray(payload?.latest_rankings) ? payload.latest_rankings : [];
    const year = payload?.selection_year || 'N/A';

    if (title) {
        title.textContent = `Latest available ranking (${year})`;
    }

    if (!rankings.length) {
        container.textContent = 'No ranking data available.';
        return;
    }

    const rows = rankings.map(item => {
        const rank = item.rank == null ? 'N/A' : `#${item.rank}`;
        const share = item.share_pct == null ? 'N/A' : `${Number(item.share_pct).toFixed(2)}%`;
        return `<tr><td>${item.name}</td><td>${rank}</td><td>${share}</td></tr>`;
    }).join('');

    container.innerHTML = `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr>
                    <th style="text-align:left; padding: 6px 0;">Country</th>
                    <th style="text-align:left; padding: 6px 0;">Rank</th>
                    <th style="text-align:left; padding: 6px 0;">Share of world exports</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function renderNglTopExportersChart(payload) {
    const canvas = document.getElementById('nglTopExportersChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No NGL exporter data returned.');
    }

    const labels = points.map(point => String(point.year));
    const palette = ['#0F766E', '#2563EB', '#F97316', '#7C3AED', '#1F2937'];

    const datasets = countries.map((country, index) => {
        const color = palette[index % palette.length];
        return {
            label: country.name || country.code || 'Country',
            data: points.map(point => {
                const value = point[country.series_key];
                return value == null ? null : Number(value);
            }),
            borderColor: color,
            backgroundColor: `${color}22`,
            borderWidth: 2.2,
            pointRadius: 1.8,
            tension: 0.2,
            spanGaps: true,
            fill: false,
        };
    });

    if (nglTopExportersChart) {
        nglTopExportersChart.destroy();
    }

    nglTopExportersChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { title: { display: true, text: 'Year' }, grid: { display: false } },
                y: {
                    title: { display: true, text: 'Share of world exports (%)' },
                    ticks: { callback: value => `${Number(value).toFixed(2)}%` },
                    grid: { color: '#D1D5DB' },
                },
            },
            plugins: {
                legend: { display: true, position: 'bottom' },
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

    const title = document.getElementById('nglTopExportersTitle');
    if (title) {
        title.textContent = `Top ${countries.length} NGL exporters — share of world exports (${payload.start_year || 'N/A'}→${payload.end_year || 'N/A'})`;
    }
}

function renderNglRankingTable(payload) {
    const container = document.getElementById('nglRankingTable');
    const title = document.getElementById('nglRankingTitle');
    if (!container) return;

    const rankings = Array.isArray(payload?.latest_rankings) ? payload.latest_rankings : [];
    const year = payload?.selection_year || 'N/A';

    if (title) {
        title.textContent = `Latest available ranking (${year})`;
    }

    if (!rankings.length) {
        container.textContent = 'No ranking data available.';
        return;
    }

    const rows = rankings.map(item => {
        const rank = item.rank == null ? 'N/A' : `#${item.rank}`;
        const share = item.share_pct == null ? 'N/A' : `${Number(item.share_pct).toFixed(2)}%`;
        return `<tr><td>${item.name}</td><td>${rank}</td><td>${share}</td></tr>`;
    }).join('');

    container.innerHTML = `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr>
                    <th style="text-align:left; padding: 6px 0;">Country</th>
                    <th style="text-align:left; padding: 6px 0;">Rank</th>
                    <th style="text-align:left; padding: 6px 0;">Share of world exports</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function renderSulfurTopExportersChart(payload) {
    const canvas = document.getElementById('sulfurTopExportersChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No sulfur exporter data returned.');
    }

    const labels = points.map(point => String(point.year));
    const palette = ['#B91C1C', '#2563EB', '#16A34A', '#F97316', '#6D28D9'];

    const datasets = countries.map((country, index) => {
        const color = palette[index % palette.length];
        return {
            label: country.name || country.code || 'Country',
            data: points.map(point => {
                const value = point[country.series_key];
                return value == null ? null : Number(value);
            }),
            borderColor: color,
            backgroundColor: `${color}22`,
            borderWidth: 2.2,
            pointRadius: 1.8,
            tension: 0.2,
            spanGaps: true,
            fill: false,
        };
    });

    if (sulfurTopExportersChart) {
        sulfurTopExportersChart.destroy();
    }

    sulfurTopExportersChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { title: { display: true, text: 'Year' }, grid: { display: false } },
                y: {
                    title: { display: true, text: 'Share of world exports (%)' },
                    ticks: { callback: value => `${Number(value).toFixed(2)}%` },
                    grid: { color: '#D1D5DB' },
                },
            },
            plugins: {
                legend: { display: true, position: 'bottom' },
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

    const title = document.getElementById('sulfurTopExportersTitle');
    if (title) {
        title.textContent = `Top ${countries.length} sulfur exporters — share of world exports (${payload.start_year || 'N/A'}→${payload.end_year || 'N/A'})`;
    }
}

function renderSulfurRankingTable(payload) {
    const container = document.getElementById('sulfurRankingTable');
    const title = document.getElementById('sulfurRankingTitle');
    if (!container) return;

    const rankings = Array.isArray(payload?.latest_rankings) ? payload.latest_rankings : [];
    const year = payload?.selection_year || 'N/A';

    if (title) {
        title.textContent = `Latest available ranking (${year})`;
    }

    if (!rankings.length) {
        container.textContent = 'No ranking data available.';
        return;
    }

    const rows = rankings.map(item => {
        const rank = item.rank == null ? 'N/A' : `#${item.rank}`;
        const share = item.share_pct == null ? 'N/A' : `${Number(item.share_pct).toFixed(2)}%`;
        return `<tr><td>${item.name}</td><td>${rank}</td><td>${share}</td></tr>`;
    }).join('');

    container.innerHTML = `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr>
                    <th style="text-align:left; padding: 6px 0;">Country</th>
                    <th style="text-align:left; padding: 6px 0;">Rank</th>
                    <th style="text-align:left; padding: 6px 0;">Share of world exports</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function renderNaphthaNetExportsChart(payload) {
    const canvas = document.getElementById('naphthaNetExportsChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No naphtha net export data returned.');
    }

    const labels = points.map(point => String(point.year));
    const palette = ['#0B3A75', '#16A34A', '#F97316', '#7C3AED', '#DC2626'];

    const datasets = countries.map((country, index) => {
        const color = palette[index % palette.length];
        return {
            label: country.name || country.code || 'Country',
            data: points.map(point => {
                const value = point[country.series_key];
                return value == null ? null : Number(value);
            }),
            borderColor: color,
            backgroundColor: `${color}22`,
            borderWidth: 2.2,
            pointRadius: 1.8,
            tension: 0.2,
            spanGaps: true,
            fill: false,
        };
    });

    if (naphthaNetExportsChart) {
        naphthaNetExportsChart.destroy();
    }

    naphthaNetExportsChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { title: { display: true, text: 'Year' }, grid: { display: false } },
                y: {
                    title: { display: true, text: 'Share of world exports (%)' },
                    ticks: { callback: value => `${Number(value).toFixed(2)}%` },
                    grid: { color: '#D1D5DB' },
                },
            },
            plugins: {
                legend: { display: true, position: 'bottom' },
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

    const title = document.getElementById('naphthaNetExportsTitle');
    if (title) {
        title.textContent = `Top ${countries.length} naphtha exporters — share of world exports (${payload.start_year || 'N/A'}→${payload.end_year || 'N/A'})`;
    }
}

function renderNaphthaNetRankingTable(payload) {
    const container = document.getElementById('naphthaNetRankingTable');
    const title = document.getElementById('naphthaNetRankingTitle');
    if (!container) return;

    const rankings = Array.isArray(payload?.latest_rankings) ? payload.latest_rankings : [];
    const year = payload?.selection_year || 'N/A';

    if (title) {
        title.textContent = `Latest available ranking (${year})`;
    }

    if (!rankings.length) {
        container.textContent = 'No ranking data available.';
        return;
    }

    const rows = rankings.map(item => {
        const rank = item.rank == null ? 'N/A' : `#${item.rank}`;
        const share = item.share_pct == null ? 'N/A' : `${Number(item.share_pct).toFixed(2)}%`;
        return `<tr><td>${item.name}</td><td>${rank}</td><td>${share}</td></tr>`;
    }).join('');

    container.innerHTML = `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr>
                    <th style="text-align:left; padding: 6px 0;">Country</th>
                    <th style="text-align:left; padding: 6px 0;">Rank</th>
                    <th style="text-align:left; padding: 6px 0;">Share of world exports</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

async function fetchAndRenderLngExporters() {
    const response = await fetch(`${API_BASE}/api/lng-top-exporters-share-world?top_n=5`);
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const payload = await response.json();
    renderLngTopExportersChart(payload);
    renderLngRankingTable(payload);
}

async function fetchAndRenderNglExporters() {
    const response = await fetch(`${API_BASE}/api/ngl-top-exporters-share-world?top_n=5`);
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const payload = await response.json();
    renderNglTopExportersChart(payload);
    renderNglRankingTable(payload);
}

async function fetchAndRenderSulfurExporters() {
    const response = await fetch(`${API_BASE}/api/sulfur-top-exporters-share-world?top_n=5`);
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const payload = await response.json();
    renderSulfurTopExportersChart(payload);
    renderSulfurRankingTable(payload);
}

async function fetchAndRenderNaphthaNetExports() {
    const response = await fetch(`${API_BASE}/api/naphtha-net-exports?top_n=5&end_year=2023`);
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const payload = await response.json();
    renderNaphthaNetExportsChart(payload);
    renderNaphthaNetRankingTable(payload);
}

async function fetchAndRenderAluminumExporters() {
    const response = await fetch(`${API_BASE}/api/aluminum-top-exporters-share-world?top_n=5&source=oec`);
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const payload = await response.json();
    renderAluminumTopExportersChart(payload);
    renderAluminumRankingTable(payload);
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

    const importedElectricity = points.map((_, index) => {
        const values = [
            series.solar[index],
            series.wind[index],
            series.hydro[index],
            series.bioenergy[index],
            series.otherRenewables[index],
            series.nuclear[index],
            series.gas[index],
            series.coal[index],
            series.otherFossil[index],
        ].filter(value => value != null && Number.isFinite(value));

        if (!values.length) return null;

        const domesticTotal = values.reduce((sum, value) => sum + value, 0);
        const residual = 100 - domesticTotal;
        if (residual <= 0) return 0;
        return Math.min(100, residual);
    });

    const datasets = [
        { label: 'Gas', data: series.gas, borderColor: '#8C7B7B', backgroundColor: '#8C7B7BCC' },
        { label: 'Nuclear', data: series.nuclear, borderColor: '#2C4587', backgroundColor: '#2C4587CC' },
        { label: 'Wind', data: series.wind, borderColor: '#176B3A', backgroundColor: '#176B3ACC' },
        { label: 'Hydro', data: series.hydro, borderColor: '#7FB3D5', backgroundColor: '#7FB3D5CC' },
        { label: 'Coal', data: series.coal, borderColor: '#5A423B', backgroundColor: '#5A423BCC' },
        { label: 'Solar', data: series.solar, borderColor: '#2ECC71', backgroundColor: '#2ECC71CC' },
        { label: 'Bioenergy', data: series.bioenergy, borderColor: '#2E6BAE', backgroundColor: '#2E6BAECC' },
        { label: 'Other renewables', data: series.otherRenewables, borderColor: '#A9D6DE', backgroundColor: '#A9D6DECC' },
        { label: 'Other fossil', data: series.otherFossil, borderColor: '#A9A3A3', backgroundColor: '#A9A3A3CC' },
        { label: 'Imported electricity', data: importedElectricity, borderColor: '#F59E0B', backgroundColor: '#F59E0BCC' },
    ].map(item => ({
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
        title.textContent = `${displayName} — energy-source share of electricity supply (production + imports, monthly, stacked) (${payload.start_date || 'N/A'} → ${payload.end_date || 'N/A'})`;
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

    const downloadEuropeBtn = document.getElementById('downloadEuropeElectricityChartBtn');
    if (downloadEuropeBtn) {
        downloadEuropeBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('europeElectricityTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartFromInstance(
                electricityCharts.europeElectricityChart,
                `europe-electricity-share-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('europeElectricityTitle');
                if (title) {
                    title.textContent = 'Europe chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    const downloadUsBtn = document.getElementById('downloadUsElectricityChartBtn');
    if (downloadUsBtn) {
        downloadUsBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('usElectricityTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartFromInstance(
                electricityCharts.usElectricityChart,
                `united-states-electricity-share-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('usElectricityTitle');
                if (title) {
                    title.textContent = 'United States chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    const downloadItalyBtn = document.getElementById('downloadItalyElectricityChartBtn');
    if (downloadItalyBtn) {
        downloadItalyBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('italyElectricityTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartFromInstance(
                electricityCharts.italyElectricityChart,
                `italy-electricity-share-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('italyElectricityTitle');
                if (title) {
                    title.textContent = 'Italy chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    const downloadBelgiumBtn = document.getElementById('downloadBelgiumElectricityChartBtn');
    if (downloadBelgiumBtn) {
        downloadBelgiumBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('belgiumElectricityTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartFromInstance(
                electricityCharts.belgiumElectricityChart,
                `belgium-electricity-share-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('belgiumElectricityTitle');
                if (title) {
                    title.textContent = 'Belgium chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    const downloadFranceBtn = document.getElementById('downloadFranceElectricityChartBtn');
    if (downloadFranceBtn) {
        downloadFranceBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('franceElectricityTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartFromInstance(
                electricityCharts.franceElectricityChart,
                `france-electricity-share-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('franceElectricityTitle');
                if (title) {
                    title.textContent = 'France chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    const downloadSpainBtn = document.getElementById('downloadSpainElectricityChartBtn');
    if (downloadSpainBtn) {
        downloadSpainBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('spainElectricityTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartFromInstance(
                electricityCharts.spainElectricityChart,
                `spain-electricity-share-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('spainElectricityTitle');
                if (title) {
                    title.textContent = 'Spain chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    const downloadGermanyBtn = document.getElementById('downloadGermanyElectricityChartBtn');
    if (downloadGermanyBtn) {
        downloadGermanyBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('germanyElectricityTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartFromInstance(
                electricityCharts.germanyElectricityChart,
                `germany-electricity-share-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('germanyElectricityTitle');
                if (title) {
                    title.textContent = 'Germany chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    const downloadSwedenBtn = document.getElementById('downloadSwedenElectricityChartBtn');
    if (downloadSwedenBtn) {
        downloadSwedenBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('swedenElectricityTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartFromInstance(
                electricityCharts.swedenElectricityChart,
                `sweden-electricity-share-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok) {
                const title = document.getElementById('swedenElectricityTitle');
                if (title) {
                    title.textContent = 'Sweden chart is not ready yet. Wait for it to load, then click download again.';
                }
            }
        });
    }

    const downloadAluminumBtn = document.getElementById('downloadAluminumTopExportersBtn');
    if (downloadAluminumBtn) {
        downloadAluminumBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('aluminumTopExportersTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartFromInstance(
                aluminumTopExportersChart,
                `aluminum-top-exporters-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok && titleElement) {
                titleElement.textContent = 'Aluminum exporters chart is not ready yet. Wait for it to load, then click download again.';
            }
        });
    }

    const downloadLngBtn = document.getElementById('downloadLngTopExportersBtn');
    if (downloadLngBtn) {
        downloadLngBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('lngTopExportersTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartFromInstance(
                lngTopExportersChart,
                `lng-top-exporters-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok && titleElement) {
                titleElement.textContent = 'LNG exporters chart is not ready yet. Wait for it to load, then click download again.';
            }
        });
    }

    const downloadNglBtn = document.getElementById('downloadNglTopExportersBtn');
    if (downloadNglBtn) {
        downloadNglBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('nglTopExportersTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartFromInstance(
                nglTopExportersChart,
                `ngl-top-exporters-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok && titleElement) {
                titleElement.textContent = 'NGL exporters chart is not ready yet. Wait for it to load, then click download again.';
            }
        });
    }

    const downloadSulfurBtn = document.getElementById('downloadSulfurTopExportersBtn');
    if (downloadSulfurBtn) {
        downloadSulfurBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('sulfurTopExportersTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartFromInstance(
                sulfurTopExportersChart,
                `sulfur-top-exporters-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok && titleElement) {
                titleElement.textContent = 'Sulfur exporters chart is not ready yet. Wait for it to load, then click download again.';
            }
        });
    }

    const downloadNaphthaNetBtn = document.getElementById('downloadNaphthaNetExportsBtn');
    if (downloadNaphthaNetBtn) {
        downloadNaphthaNetBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('naphthaNetExportsTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartFromInstance(
                naphthaNetExportsChart,
                `naphtha-net-exports-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok && titleElement) {
                titleElement.textContent = 'Naphtha net exports chart is not ready yet. Wait for it to load, then click download again.';
            }
        });
    }

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

    try {
        await fetchAndRenderAluminumExporters();
    } catch (error) {
        const title = document.getElementById('aluminumTopExportersTitle');
        if (title) {
            title.textContent = `Aluminum exporters chart failed: ${error.message}`;
        }
    }

    try {
        await fetchAndRenderLngExporters();
    } catch (error) {
        const title = document.getElementById('lngTopExportersTitle');
        if (title) {
            title.textContent = `LNG exporters chart failed: ${error.message}`;
        }
    }

    try {
        await fetchAndRenderNglExporters();
    } catch (error) {
        const title = document.getElementById('nglTopExportersTitle');
        if (title) {
            title.textContent = `NGL exporters chart failed: ${error.message}`;
        }
    }

    try {
        await fetchAndRenderSulfurExporters();
    } catch (error) {
        const title = document.getElementById('sulfurTopExportersTitle');
        if (title) {
            title.textContent = `Sulfur exporters chart failed: ${error.message}`;
        }
    }

    try {
        await fetchAndRenderNaphthaNetExports();
    } catch (error) {
        const title = document.getElementById('naphthaNetExportsTitle');
        if (title) {
            title.textContent = `Naphtha net exports chart failed: ${error.message}`;
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
        { entity: 'Sweden', canvasId: 'swedenElectricityChart', titleId: 'swedenElectricityTitle', displayName: 'Sweden' },
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
