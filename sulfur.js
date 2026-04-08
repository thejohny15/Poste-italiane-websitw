const API_BASE = 'http://localhost:5001';
let gulfSulfurDependenceChart = null;
let gulfSulfurVolumeChart = null;
let eurozoneDapChart = null;
let eurozoneDapVolumeChart = null;

function formatUsdMillions(value) {
    if (value == null || Number.isNaN(Number(value))) {
        return 'N/A';
    }
    return `$${(Number(value) / 1000000).toFixed(1)}M`;
}

function downloadChartAsPng(chartInstance, fileName, titleText = '') {
    if (!chartInstance || !chartInstance.canvas) {
        return false;
    }

    const sourceCanvas = chartInstance.canvas;
    const title = String(titleText || '').trim();
    const topPadding = title ? 54 : 0;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = sourceCanvas.width;
    exportCanvas.height = sourceCanvas.height + topPadding;

    const exportCtx = exportCanvas.getContext('2d');
    exportCtx.fillStyle = '#FFFFFF';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    if (title) {
        exportCtx.fillStyle = '#0B3A75';
        exportCtx.font = 'bold 28px Arial';
        exportCtx.textAlign = 'center';
        exportCtx.textBaseline = 'middle';
        exportCtx.fillText(title, exportCanvas.width / 2, 28);
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

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function downloadElementAsPng(element, fileName, titleText = '') {
    if (!element) {
        return false;
    }

    const rect = element.getBoundingClientRect();
    const width = Math.max(900, Math.ceil(rect.width) || 900);
    const height = Math.max(240, Math.ceil(rect.height) || 240);
    const title = String(titleText || '').trim();
    const titleBlock = title
        ? `<div style="font:700 24px Arial,sans-serif;color:#0B3A75;margin:0 0 16px 0;">${escapeHtml(title)}</div>`
        : '';

    const serialized = new XMLSerializer().serializeToString(element.cloneNode(true));
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + (title ? 56 : 0)}">
            <foreignObject x="0" y="0" width="100%" height="100%">
                <div xmlns="http://www.w3.org/1999/xhtml" style="background:#FFFFFF;padding:16px;width:${width - 32}px;height:${height + (title ? 24 : 0)}px;font:14px Arial,sans-serif;color:#111827;">
                    ${titleBlock}
                    <div style="width:100%;">${serialized}</div>
                </div>
            </foreignObject>
        </svg>
    `;

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    try {
        const image = new Image();
        image.decoding = 'sync';

        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
            image.src = url;
        });

        const canvas = document.createElement('canvas');
        canvas.width = width * 2;
        canvas.height = (height + (title ? 56 : 0)) * 2;
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height + (title ? 56 : 0));
        ctx.drawImage(image, 0, 0, width, height + (title ? 56 : 0));

        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png', 1.0);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return true;
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function checkServerStatus() {
    const statusElement = document.getElementById('serverStatus');
    if (!statusElement) return;

    try {
        const response = await fetch(`${API_BASE}/api/health`);
        if (!response.ok) throw new Error(`Server error ${response.status}`);
        statusElement.textContent = 'Connected to API server';
        statusElement.style.background = '#DCFCE7';
        statusElement.style.color = '#166534';
    } catch (error) {
        statusElement.textContent = 'API server offline. Start api_server.py on port 5001.';
        statusElement.style.background = '#FEE2E2';
        statusElement.style.color = '#991B1B';
    }
}

function buildDatasets(points, countries, palette) {
    return countries.map((country, index) => {
        const color = palette[index % palette.length];
        return {
            label: country.name || country.code || 'Importer',
            data: points.map(point => {
                const value = point[country.series_key];
                return value == null ? null : Number(value);
            }),
            borderColor: color,
            backgroundColor: `${color}22`,
            borderWidth: 2.2,
            pointRadius: 2,
            tension: 0.2,
            spanGaps: true,
            fill: false,
        };
    });
}

function renderDependenceChart(payload) {
    const canvas = document.getElementById('gulfSulfurDependenceChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.dependence_points) ? payload.dependence_points : [];
    const countries = Array.isArray(payload?.dependence_countries) ? payload.dependence_countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No Gulf sulfur dependence data returned.');
    }

    if (gulfSulfurDependenceChart) {
        gulfSulfurDependenceChart.destroy();
    }

    gulfSulfurDependenceChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: points.map(point => String(point.year)),
            datasets: buildDatasets(points, countries, ['#1D4ED8', '#DC2626', '#059669', '#D97706', '#7C3AED']),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    title: { display: true, text: 'Year' },
                    grid: { display: false },
                },
                y: {
                    title: { display: true, text: 'Share of importer sulfur imports supplied by Gulf countries (%)' },
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

    const title = document.getElementById('gulfSulfurDependenceTitle');
    if (title) {
        title.textContent = `Top ${countries.length} importers by dependence on Gulf sulfur (${payload.start_year || 'N/A'} to ${payload.end_year || 'N/A'})`;
    }
}

function renderVolumeChart(payload) {
    const canvas = document.getElementById('gulfSulfurVolumeChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.volume_points) ? payload.volume_points : [];
    const countries = Array.isArray(payload?.volume_countries) ? payload.volume_countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No Gulf sulfur volume data returned.');
    }

    if (gulfSulfurVolumeChart) {
        gulfSulfurVolumeChart.destroy();
    }

    gulfSulfurVolumeChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: points.map(point => String(point.year)),
            datasets: buildDatasets(points, countries, ['#0F766E', '#2563EB', '#B91C1C', '#CA8A04', '#9333EA']),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    title: { display: true, text: 'Year' },
                    grid: { display: false },
                },
                y: {
                    title: { display: true, text: 'Gulf sulfur imports (USD)' },
                    ticks: {
                        callback: value => formatUsdMillions(value),
                    },
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
                            return `${context.dataset.label}: ${formatUsdMillions(value)}`;
                        },
                    },
                },
            },
        },
    });

    const title = document.getElementById('gulfSulfurVolumeTitle');
    if (title) {
        title.textContent = `Top ${countries.length} sulfur importers by value of imports from Gulf suppliers (${payload.start_year || 'N/A'} to ${payload.end_year || 'N/A'})`;
    }
}

function renderRankingTable(containerId, titleId, rankings, year, rankingType) {
    const container = document.getElementById(containerId);
    const title = document.getElementById(titleId);
    if (!container) return;

    if (title) {
        title.textContent = `Latest available ranking (${year || 'N/A'})`;
    }

    if (!Array.isArray(rankings) || !rankings.length) {
        container.textContent = 'No ranking data available.';
        return;
    }

    const rows = rankings.map(item => {
        const share = item.share_pct == null ? 'N/A' : `${Number(item.share_pct).toFixed(2)}%`;
        const largestNonGulf = item?.largest_non_gulf_supplier;
        const largestNonGulfLabel = largestNonGulf && largestNonGulf.value_usd != null
            ? `${largestNonGulf.name} (${formatUsdMillions(largestNonGulf.value_usd)}, ${largestNonGulf.share_pct == null ? 'N/A' : `${Number(largestNonGulf.share_pct).toFixed(2)}%`})`
            : 'N/A';
        const suppliers = Array.isArray(item.gulf_suppliers)
            ? item.gulf_suppliers
                .filter(supplier => supplier && supplier.value_usd != null)
                .slice(0, 3)
                .map(supplier => `${supplier.name} (${formatUsdMillions(supplier.value_usd)})`)
                .join(', ')
            : '';

        return `
            <tr>
                <td style="padding: 8px 0;">${item.rank}</td>
                <td style="padding: 8px 0;">${item.name}</td>
                <td style="padding: 8px 0;">${formatUsdMillions(item.gulf_imports_usd)}</td>
                <td style="padding: 8px 0;">${formatUsdMillions(item.total_imports_usd)}</td>
                <td style="padding: 8px 0;">${share}</td>
                <td style="padding: 8px 0;">${suppliers || 'N/A'}</td>
                <td style="padding: 8px 0;">${largestNonGulfLabel}</td>
            </tr>
        `;
    }).join('');

    const metricLabel = rankingType === 'volume' ? 'Top 5 importers by Gulf sulfur import value' : 'Top 5 importers by Gulf share of sulfur imports';

    container.innerHTML = `
        <div style="margin-bottom: 10px;"><strong>${metricLabel}</strong></div>
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr>
                    <th style="text-align:left; padding: 6px 0;">Rank</th>
                    <th style="text-align:left; padding: 6px 0;">Importer</th>
                    <th style="text-align:left; padding: 6px 0;">Gulf imports</th>
                    <th style="text-align:left; padding: 6px 0;">Total sulfur imports</th>
                    <th style="text-align:left; padding: 6px 0;">Share from Gulf</th>
                    <th style="text-align:left; padding: 6px 0;">Main Gulf suppliers</th>
                    <th style="text-align:left; padding: 6px 0;">Largest non-Gulf supplier</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function renderEurozoneDapChart(payload) {
    const canvas = document.getElementById('eurozoneDapChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No Eurozone DAP dependency data returned.');
    }

    if (eurozoneDapChart) {
        eurozoneDapChart.destroy();
    }

    eurozoneDapChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: points.map(point => String(point.year)),
            datasets: buildDatasets(points, countries, ['#1D4ED8', '#DC2626', '#059669', '#D97706', '#7C3AED']),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    title: { display: true, text: 'Year' },
                    grid: { display: false },
                },
                y: {
                    title: { display: true, text: 'Share of Eurozone extra-DAP imports (%)' },
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

    const title = document.getElementById('eurozoneDapTitle');
    if (title) {
        title.textContent = `Top ${countries.length} non-Eurozone suppliers of Eurozone DAP imports (${payload.start_year || 'N/A'} to ${payload.end_year || 'N/A'})`;
    }
}

function renderEurozoneDapVolumeChart(payload) {
    const canvas = document.getElementById('eurozoneDapVolumeChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.volume_points) ? payload.volume_points : [];
    const countries = Array.isArray(payload?.volume_countries) ? payload.volume_countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No Eurozone DAP volume data returned.');
    }

    if (eurozoneDapVolumeChart) {
        eurozoneDapVolumeChart.destroy();
    }

    eurozoneDapVolumeChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: points.map(point => String(point.year)),
            datasets: buildDatasets(points, countries, ['#0F766E', '#2563EB', '#B91C1C', '#CA8A04', '#9333EA']),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    title: { display: true, text: 'Year' },
                    grid: { display: false },
                },
                y: {
                    title: { display: true, text: 'Eurozone DAP imports from outside suppliers (USD)' },
                    ticks: { callback: value => formatUsdMillions(value) },
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
                            return `${context.dataset.label}: ${formatUsdMillions(value)}`;
                        },
                    },
                },
            },
        },
    });

    const title = document.getElementById('eurozoneDapVolumeTitle');
    if (title) {
        title.textContent = `Top ${countries.length} eurozone countries importing DAP in absolute volume (${payload.start_year || 'N/A'} to ${payload.end_year || 'N/A'})`;
    }
}

function renderEurozoneDapPartnersTable(payload) {
    const container = document.getElementById('eurozoneDapPartnersTable');
    const title = document.getElementById('eurozoneDapPartnersTitle');
    if (!container) return;

    const rankings = Array.isArray(payload?.latest_volume_rankings) ? payload.latest_volume_rankings : [];
    const year = payload?.selection_year || 'N/A';
    if (title) {
        title.textContent = `Latest available ranking (${year})`;
    }

    if (!rankings.length) {
        container.textContent = 'No partner data available.';
        return;
    }

    const rows = rankings.map(item => {
        const partners = Array.isArray(item.top_non_eurozone_suppliers)
            ? item.top_non_eurozone_suppliers
                .filter(partner => partner && partner.value_usd != null)
                .map(partner => `${partner.name} (${formatUsdMillions(partner.value_usd)})`)
                .join(', ')
            : '';

        return `
            <tr>
                <td style="padding: 8px 0;">${item.rank}</td>
                <td style="padding: 8px 0;">${item.name}</td>
                <td style="padding: 8px 0;">${formatUsdMillions(item.value_usd)}</td>
                <td style="padding: 8px 0;">${item.share_pct == null ? 'N/A' : `${Number(item.share_pct).toFixed(2)}%`}</td>
                <td style="padding: 8px 0;">${partners || 'N/A'}</td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr>
                    <th style="text-align:left; padding: 6px 0;">Rank</th>
                    <th style="text-align:left; padding: 6px 0;">Eurozone importer</th>
                    <th style="text-align:left; padding: 6px 0;">Import value</th>
                    <th style="text-align:left; padding: 6px 0;">Share of extra-Eurozone DAP imports</th>
                    <th style="text-align:left; padding: 6px 0;">Top 3 non-Eurozone suppliers</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

async function fetchAndRenderGulfSulfur() {
    const response = await fetch(`${API_BASE}/api/gulf-sulfur-top-importers?top_n=5`);
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const payload = await response.json();

    renderDependenceChart(payload);
    renderVolumeChart(payload);
    renderRankingTable(
        'gulfSulfurDependenceRankingTable',
        'gulfSulfurDependenceRankingTitle',
        payload.dependence_latest_rankings,
        payload.selection_year,
        'dependence'
    );
    renderRankingTable(
        'gulfSulfurVolumeRankingTable',
        'gulfSulfurVolumeRankingTitle',
        payload.volume_latest_rankings,
        payload.selection_year,
        'volume'
    );
}

async function fetchAndRenderEurozoneDap() {
    const response = await fetch(`${API_BASE}/api/eurozone-dap-import-dependencies?top_n=5`);
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const payload = await response.json();
    renderEurozoneDapChart(payload);
    renderEurozoneDapVolumeChart(payload);
    renderEurozoneDapPartnersTable(payload);
}

function bindDownload(buttonId, chartRef, titleId, fileName) {
    const button = document.getElementById(buttonId);
    if (!button) return;

    button.addEventListener('click', () => {
        const titleElement = document.getElementById(titleId);
        const chartInstance = chartRef();
        const ok = downloadChartAsPng(
            chartInstance,
            `${fileName}-${new Date().toISOString().slice(0, 10)}.png`,
            titleElement ? titleElement.textContent : ''
        );
        if (!ok && titleElement) {
            titleElement.textContent = 'Chart is not ready yet. Wait for it to load, then click download again.';
        }
    });
}

window.addEventListener('DOMContentLoaded', async () => {
    await checkServerStatus();

    bindDownload(
        'downloadGulfSulfurDependenceBtn',
        () => gulfSulfurDependenceChart,
        'gulfSulfurDependenceTitle',
        'gulf-sulfur-dependence'
    );
    bindDownload(
        'downloadGulfSulfurVolumeBtn',
        () => gulfSulfurVolumeChart,
        'gulfSulfurVolumeTitle',
        'gulf-sulfur-volume'
    );
    bindDownload(
        'downloadEurozoneDapBtn',
        () => eurozoneDapChart,
        'eurozoneDapTitle',
        'eurozone-dap-import-dependency'
    );
    bindDownload(
        'downloadEurozoneDapVolumeBtn',
        () => eurozoneDapVolumeChart,
        'eurozoneDapVolumeTitle',
        'eurozone-dap-import-volume'
    );

    const volumeRankingBtn = document.getElementById('downloadGulfSulfurVolumeRankingBtn');
    if (volumeRankingBtn) {
        volumeRankingBtn.addEventListener('click', async () => {
            const tableElement = document.getElementById('gulfSulfurVolumeRankingTable');
            const titleElement = document.getElementById('gulfSulfurVolumeRankingTitle');
            const ok = await downloadElementAsPng(
                tableElement,
                `gulf-sulfur-volume-ranking-${new Date().toISOString().slice(0, 10)}.png`,
                titleElement ? titleElement.textContent : ''
            );
            if (!ok && titleElement) {
                titleElement.textContent = 'Volume ranking table is not ready yet. Wait for it to load, then click download again.';
            }
        });
    }

    try {
        await fetchAndRenderGulfSulfur();
    } catch (error) {
        const dependenceTitle = document.getElementById('gulfSulfurDependenceTitle');
        const volumeTitle = document.getElementById('gulfSulfurVolumeTitle');
        if (dependenceTitle) {
            dependenceTitle.textContent = `Sulfur chart failed: ${error.message}`;
        }
        if (volumeTitle) {
            volumeTitle.textContent = `Sulfur chart failed: ${error.message}`;
        }
    }

    try {
        await fetchAndRenderEurozoneDap();
    } catch (error) {
        const title = document.getElementById('eurozoneDapTitle');
        const volumeTitle = document.getElementById('eurozoneDapVolumeTitle');
        if (title) {
            title.textContent = `Eurozone DAP chart failed: ${error.message}`;
        }
        if (volumeTitle) {
            volumeTitle.textContent = `Eurozone DAP chart failed: ${error.message}`;
        }
    }
});
