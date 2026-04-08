const API_BASE = 'http://localhost:5001';
let gulfUreaDependenceChart = null;
let gulfUreaVolumeChart = null;
let ureaTopExportersChart = null;
let eurozoneUreaStructureChart = null;

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
    const topPadding = title ? 72 : 0;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = sourceCanvas.width;
    exportCanvas.height = sourceCanvas.height + topPadding;

    const exportCtx = exportCanvas.getContext('2d');
    exportCtx.fillStyle = '#FFFFFF';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    if (title) {
        exportCtx.fillStyle = '#0B3A75';
        exportCtx.font = 'bold 36px Arial';
        exportCtx.textAlign = 'center';
        exportCtx.textBaseline = 'middle';
        exportCtx.fillText(title, exportCanvas.width / 2, 36);
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
            label: country.name || country.code || 'Country',
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
    const canvas = document.getElementById('gulfUreaDependenceChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.dependence_points) ? payload.dependence_points : [];
    const countries = Array.isArray(payload?.dependence_countries) ? payload.dependence_countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No Gulf urea dependence data returned.');
    }

    if (gulfUreaDependenceChart) {
        gulfUreaDependenceChart.destroy();
    }

    gulfUreaDependenceChart = new Chart(canvas.getContext('2d'), {
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
                    title: { display: true, text: 'Share of importer urea imports supplied by Gulf countries (%)' },
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

    const title = document.getElementById('gulfUreaDependenceTitle');
    if (title) {
        title.textContent = `Top ${countries.length} importers by dependence on Gulf urea (${payload.start_year || 'N/A'} to ${payload.end_year || 'N/A'})`;
    }
}

function renderVolumeChart(payload) {
    const canvas = document.getElementById('gulfUreaVolumeChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.volume_points) ? payload.volume_points : [];
    const countries = Array.isArray(payload?.volume_countries) ? payload.volume_countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No Gulf urea volume data returned.');
    }

    if (gulfUreaVolumeChart) {
        gulfUreaVolumeChart.destroy();
    }

    gulfUreaVolumeChart = new Chart(canvas.getContext('2d'), {
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
                    title: { display: true, text: 'Gulf urea imports (USD)' },
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

    const title = document.getElementById('gulfUreaVolumeTitle');
    if (title) {
        title.textContent = `Top ${countries.length} urea importers by value of imports from Gulf suppliers (${payload.start_year || 'N/A'} to ${payload.end_year || 'N/A'})`;
    }
}

function renderExportersChart(payload) {
    const canvas = document.getElementById('ureaTopExportersChart');
    if (!canvas) return;

    const points = Array.isArray(payload?.points) ? payload.points : [];
    const countries = Array.isArray(payload?.countries) ? payload.countries : [];
    if (!points.length || !countries.length) {
        throw new Error('No urea exporter data returned.');
    }

    if (ureaTopExportersChart) {
        ureaTopExportersChart.destroy();
    }

    ureaTopExportersChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: points.map(point => String(point.year)),
            datasets: buildDatasets(points, countries, ['#B91C1C', '#2563EB', '#16A34A', '#F97316', '#6D28D9']),
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
                    title: { display: true, text: 'Share of world urea exports (%)' },
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

    const title = document.getElementById('ureaTopExportersTitle');
    if (title) {
        title.textContent = `Top ${countries.length} urea exporters (${payload.start_year || 'N/A'} to ${payload.end_year || 'N/A'})`;
    }
}

function renderEurozoneUreaStructureChart(payload) {
    const canvas = document.getElementById('eurozoneUreaStructureChart');
    if (!canvas) return;

    const bars = Array.isArray(payload?.bars) ? payload.bars : [];
    if (!bars.length) {
        throw new Error('No Eurozone urea supplier-structure data returned.');
    }

    const labels = bars.map(item => item.label);
    const values = bars.map(item => item.share_pct == null ? null : Number(item.share_pct));
    const defaultFillColors = ['#0B5FFF', '#3D7BFF', '#7AA6FF', '#B8CEFF'];
    const defaultBorderColors = ['#0847BF', '#2F63CC', '#5C87D6', '#8CAAE0'];
    const backgroundColors = bars.map((item, index) => (
        item.category === 'hormuz_combined' ? '#1F9D55' : defaultFillColors[index % defaultFillColors.length]
    ));
    const borderColors = bars.map((item, index) => (
        item.category === 'hormuz_combined' ? '#15703D' : defaultBorderColors[index % defaultBorderColors.length]
    ));

    if (eurozoneUreaStructureChart) {
        eurozoneUreaStructureChart.destroy();
    }

    eurozoneUreaStructureChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Share of extra-Eurozone urea imports',
                data: values,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 1.5,
                borderRadius: 10,
                borderSkipped: false,
            }],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 900,
                easing: 'easeOutQuart',
            },
            scales: {
                x: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Share of extra-Eurozone urea imports (%)',
                        color: '#003D7A',
                        font: {
                            size: 14,
                            weight: '600',
                        },
                    },
                    ticks: {
                        callback: value => `${Number(value).toFixed(1)}%`,
                        color: '#4B5563',
                    },
                    grid: { color: '#E5E7EB' },
                },
                y: {
                    ticks: {
                        color: '#1F2937',
                        font: {
                            size: 13,
                            weight: '600',
                        },
                    },
                    grid: { display: false },
                },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const bar = bars[context.dataIndex];
                            if (!bar) return 'N/A';
                            const share = bar.share_pct == null ? 'N/A' : `${Number(bar.share_pct).toFixed(2)}%`;
                            const value = formatUsdMillions(bar.value_usd);
                            return `${share} (${value})`;
                        },
                    },
                },
            },
        },
        plugins: [{
            id: 'valueLabels',
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                ctx.save();
                ctx.fillStyle = '#111827';
                ctx.font = '600 12px Arial';
                ctx.textBaseline = 'middle';

                chart.getDatasetMeta(0).data.forEach((bar, index) => {
                    const value = values[index];
                    if (value == null) return;
                    ctx.fillText(`${value.toFixed(2)}%`, bar.x + 8, bar.y);
                });

                ctx.restore();
            },
        }],
    });

    const title = document.getElementById('eurozoneUreaStructureTitle');
    if (title) {
        title.textContent = `Eurozone extra-Eurozone urea imports by supplier share (${payload.selection_year || 'N/A'})`;
    }
}

function renderEurozoneUreaTakeaway(payload) {
    const container = document.getElementById('eurozoneUreaTakeawayContent');
    if (!container) return;

    const takeaways = Array.isArray(payload?.takeaways) ? payload.takeaways : [];
    if (!takeaways.length) {
        container.textContent = 'No takeaway available.';
        return;
    }

    container.innerHTML = `
        <ul style="margin: 0; padding-left: 18px;">
            ${takeaways.map(item => `<li style="margin-bottom: 10px;">${escapeHtml(item)}</li>`).join('')}
        </ul>
    `;
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

    const metricLabel = rankingType === 'volume' ? 'Top 5 importers by Gulf urea import value' : 'Top 5 importers by Gulf share of urea imports';

    container.innerHTML = `
        <div style="margin-bottom: 10px;"><strong>${metricLabel}</strong></div>
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr>
                    <th style="text-align:left; padding: 6px 0;">Rank</th>
                    <th style="text-align:left; padding: 6px 0;">Importer</th>
                    <th style="text-align:left; padding: 6px 0;">Gulf imports</th>
                    <th style="text-align:left; padding: 6px 0;">Total urea imports</th>
                    <th style="text-align:left; padding: 6px 0;">Share from Gulf</th>
                    <th style="text-align:left; padding: 6px 0;">Main Gulf suppliers</th>
                    <th style="text-align:left; padding: 6px 0;">Largest non-Gulf supplier</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

async function fetchAndRenderGulfUrea() {
    const response = await fetch(`${API_BASE}/api/gulf-urea-top-importers?top_n=5`);
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const payload = await response.json();

    renderDependenceChart(payload);
    renderVolumeChart(payload);
    renderRankingTable(
        'gulfUreaDependenceRankingTable',
        'gulfUreaDependenceRankingTitle',
        payload.dependence_latest_rankings,
        payload.selection_year,
        'dependence'
    );
    renderRankingTable(
        'gulfUreaVolumeRankingTable',
        'gulfUreaVolumeRankingTitle',
        payload.volume_latest_rankings,
        payload.selection_year,
        'volume'
    );
}

async function fetchAndRenderUreaExporters() {
    const response = await fetch(`${API_BASE}/api/urea-top-exporters?top_n=5`);
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const payload = await response.json();
    renderExportersChart(payload);
}

async function fetchAndRenderEurozoneUreaStructure() {
    const response = await fetch(`${API_BASE}/api/eurozone-urea-supplier-structure?top_n=4`);
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const payload = await response.json();
    renderEurozoneUreaStructureChart(payload);
    renderEurozoneUreaTakeaway(payload);
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

    bindDownload('downloadGulfUreaDependenceBtn', () => gulfUreaDependenceChart, 'gulfUreaDependenceTitle', 'gulf-urea-dependence');
    bindDownload('downloadGulfUreaVolumeBtn', () => gulfUreaVolumeChart, 'gulfUreaVolumeTitle', 'gulf-urea-volume');
    bindDownload('downloadUreaTopExportersBtn', () => ureaTopExportersChart, 'ureaTopExportersTitle', 'urea-top-exporters');
    bindDownload('downloadEurozoneUreaStructureBtn', () => eurozoneUreaStructureChart, 'eurozoneUreaStructureTitle', 'eurozone-urea-structure');

    const volumeRankingBtn = document.getElementById('downloadGulfUreaVolumeRankingBtn');
    if (volumeRankingBtn) {
        volumeRankingBtn.addEventListener('click', async () => {
            const tableElement = document.getElementById('gulfUreaVolumeRankingTable');
            const titleElement = document.getElementById('gulfUreaVolumeRankingTitle');
            const ok = await downloadElementAsPng(
                tableElement,
                `gulf-urea-volume-ranking-${new Date().toISOString().slice(0, 10)}.png`,
                titleElement ? titleElement.textContent : ''
            );
            if (!ok && titleElement) {
                titleElement.textContent = 'Volume ranking table is not ready yet. Wait for it to load, then click download again.';
            }
        });
    }

    try {
        await fetchAndRenderGulfUrea();
    } catch (error) {
        const dependenceTitle = document.getElementById('gulfUreaDependenceTitle');
        const volumeTitle = document.getElementById('gulfUreaVolumeTitle');
        if (dependenceTitle) dependenceTitle.textContent = `Urea chart failed: ${error.message}`;
        if (volumeTitle) volumeTitle.textContent = `Urea chart failed: ${error.message}`;
    }

    try {
        await fetchAndRenderUreaExporters();
    } catch (error) {
        const title = document.getElementById('ureaTopExportersTitle');
        if (title) title.textContent = `Urea exporters chart failed: ${error.message}`;
    }

    try {
        await fetchAndRenderEurozoneUreaStructure();
    } catch (error) {
        const title = document.getElementById('eurozoneUreaStructureTitle');
        const takeaway = document.getElementById('eurozoneUreaTakeawayContent');
        if (title) title.textContent = `Eurozone urea structure chart failed: ${error.message}`;
        if (takeaway) takeaway.textContent = `Takeaway failed: ${error.message}`;
    }
});
