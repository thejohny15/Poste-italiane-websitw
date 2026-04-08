const API_BASE = 'http://localhost:5001';
let aluminumTopExportersChart = null;

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
        title.textContent = `Top ${countries.length} exporters (HS ${payload.commodity_code}) — share of world exports (${payload.start_year || 'N/A'}→${payload.end_year || 'N/A'})`;
    }
}

function renderAluminumRankingTable(payload) {
    const container = document.getElementById('aluminumRankingTable');
    const title = document.getElementById('aluminumRankingTitle');
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

async function fetchAndRenderAluminumExporters() {
    const response = await fetch(`${API_BASE}/api/aluminum-top-exporters-share-world?top_n=5`);
    if (!response.ok) throw new Error(`Server error ${response.status}`);
    const payload = await response.json();
    renderAluminumTopExportersChart(payload);
    renderAluminumRankingTable(payload);
}

window.addEventListener('DOMContentLoaded', async () => {
    await checkServerStatus();

    const downloadBtn = document.getElementById('downloadAluminumTopExportersBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            const titleElement = document.getElementById('aluminumTopExportersTitle');
            const titleText = titleElement ? titleElement.textContent : '';
            const ok = downloadChartAsPng(
                aluminumTopExportersChart,
                `aluminum-top-exporters-${new Date().toISOString().slice(0, 10)}.png`,
                titleText
            );
            if (!ok && titleElement) {
                titleElement.textContent = 'Aluminum exporters chart is not ready yet. Wait for it to load, then click download again.';
            }
        });
    }

    try {
        await fetchAndRenderAluminumExporters();
    } catch (error) {
        const title = document.getElementById('aluminumTopExportersTitle');
        if (title) {
            title.textContent = `Aluminum exporters chart failed: ${error.message}`;
        }
    }
});
