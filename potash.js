const potashExporterData = [
    { label: 'Canada', share: 33.832902356599675, value: 6812818253 },
    { label: 'Russia', share: 23.491952869483917, value: 4730495883 },
    { label: 'Germany', share: 7.252949960723474, value: 1460502246 },
    { label: 'Belarus', share: 5.298457256189557, value: 1066932595 },
    { label: 'Gulf / Hormuz countries combined', share: 0.1765064709658539, value: 35542617 }
];

const totalWorldExports = 20136665135;
const top4CombinedShare = potashExporterData
    .slice(0, 4)
    .reduce((sum, item) => sum + item.share, 0);

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

document.getElementById('top4CombinedShare').textContent = `${top4CombinedShare.toFixed(1)}%`;
document.getElementById('gulfCombinedShare').textContent = `${potashExporterData[4].share.toFixed(2)}%`;

const chartColors = [
    '#0B5FFF',
    '#3D7BFF',
    '#7AA6FF',
    '#B8CEFF',
    '#1F9D55'
];

const borderColors = [
    '#0847BF',
    '#2F63CC',
    '#5C87D6',
    '#8CAAE0',
    '#15703D'
];

const ctx = document.getElementById('potashExportersChart');
const downloadButton = document.getElementById('downloadPotashChartBtn');
const titleElement = document.getElementById('potashExportersTitle');

const potashChart = new Chart(ctx, {
    type: 'bar',
    data: {
        labels: potashExporterData.map((item) => item.label),
        datasets: [
            {
                label: 'Share of world exports (%)',
                data: potashExporterData.map((item) => item.share),
                backgroundColor: chartColors,
                borderColor: borderColors,
                borderWidth: 1.5,
                borderRadius: 10,
                borderSkipped: false
            }
        ]
    },
    options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: {
            duration: 900,
            easing: 'easeOutQuart'
        },
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                callbacks: {
                    label(context) {
                        const item = potashExporterData[context.dataIndex];
                        const valueInBillions = item.value / 1e9;
                        return `${item.share.toFixed(2)}% of world exports (${valueInBillions.toFixed(2)} bn USD)`;
                    }
                }
            }
        },
        scales: {
            x: {
                beginAtZero: true,
                suggestedMax: 40,
                title: {
                    display: true,
                    text: 'Share of world exports (%)',
                    color: '#003D7A',
                    font: {
                        size: 14,
                        weight: '600'
                    }
                },
                ticks: {
                    callback(value) {
                        return `${value}%`;
                    },
                    color: '#4B5563'
                },
                grid: {
                    color: '#E5E7EB'
                }
            },
            y: {
                ticks: {
                    color: '#1F2937',
                    font: {
                        size: 13,
                        weight: '600'
                    }
                },
                grid: {
                    display: false
                }
            }
        }
    },
    plugins: [
        {
            id: 'valueLabels',
            afterDatasetsDraw(chart) {
                const { ctx: chartCtx } = chart;
                chartCtx.save();
                chartCtx.fillStyle = '#111827';
                chartCtx.font = '600 12px Arial';
                chartCtx.textBaseline = 'middle';

                chart.getDatasetMeta(0).data.forEach((bar, index) => {
                    const value = potashExporterData[index].share;
                    chartCtx.fillText(`${value.toFixed(2)}%`, bar.x + 8, bar.y);
                });

                chartCtx.restore();
            }
        }
    ]
});

downloadButton.addEventListener('click', () => {
    downloadChartAsPng(
        potashChart,
        `potash-top-exporters-oec-2024-${new Date().toISOString().slice(0, 10)}.png`,
        titleElement ? titleElement.textContent : ''
    );
});

console.log('Potash chart loaded from OEC 2024 exporter data.', {
    totalWorldExports,
    top4CombinedShare
});
