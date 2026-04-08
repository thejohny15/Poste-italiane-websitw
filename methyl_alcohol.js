const methylAlcoholExporterData = [
    { label: 'Trinidad and Tobago', share: 14.479183285539438, value: 1849442894 },
    { label: 'Oman', share: 12.5397448688566, value: 1601716173.0000002 },
    { label: 'Saudi Arabia', share: 11.669621909249443, value: 1490574357 },
    { label: 'United States', share: 8.943954485703674, value: 1142421692 },
    { label: 'Gulf / Hormuz countries combined', share: 41.289147153120716, value: 5279910709 }
];

const methylAlcoholEurozoneImportData = [
    { label: 'Trinidad and Tobago', share: 33.13618333936562, value: 714461123 },
    { label: 'United States', share: 25.80964975511835, value: 556491107 },
    { label: 'Equatorial Guinea', share: 9.073914635380063, value: 195645925 },
    { label: 'Egypt', share: 7.250554558521381, value: 156331805 },
    { label: 'Gulf countries combined', share: 6.350164068559328, value: 136918163 }
];

const totalWorldExports = 12773116118;
const top4CombinedShare = methylAlcoholExporterData
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

document.getElementById('methylAlcoholTop4CombinedShare').textContent = `${top4CombinedShare.toFixed(1)}%`;
document.getElementById('methylAlcoholGulfCombinedShare').textContent = `${methylAlcoholExporterData[4].share.toFixed(2)}%`;

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

const ctx = document.getElementById('methylAlcoholExportersChart');
const downloadButton = document.getElementById('downloadMethylAlcoholChartBtn');
const titleElement = document.getElementById('methylAlcoholExportersTitle');
const eurozoneCtx = document.getElementById('methylAlcoholEurozoneChart');
const eurozoneDownloadButton = document.getElementById('downloadMethylAlcoholEurozoneChartBtn');
const eurozoneTitleElement = document.getElementById('methylAlcoholEurozoneTitle');

const methylAlcoholChart = new Chart(ctx, {
    type: 'bar',
    data: {
        labels: methylAlcoholExporterData.map((item) => item.label),
        datasets: [
            {
                label: 'Share of world exports (%)',
                data: methylAlcoholExporterData.map((item) => item.share),
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
                        const item = methylAlcoholExporterData[context.dataIndex];
                        const valueInBillions = item.value / 1e9;
                        return `${item.share.toFixed(2)}% of world exports (${valueInBillions.toFixed(2)} bn USD)`;
                    }
                }
            }
        },
        scales: {
            x: {
                beginAtZero: true,
                suggestedMax: 45,
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
                    const value = methylAlcoholExporterData[index].share;
                    chartCtx.fillText(`${value.toFixed(2)}%`, bar.x + 8, bar.y);
                });

                chartCtx.restore();
            }
        }
    ]
});

const methylAlcoholEurozoneChart = new Chart(eurozoneCtx, {
    type: 'bar',
    data: {
        labels: methylAlcoholEurozoneImportData.map((item) => item.label),
        datasets: [
            {
                label: 'Share of extra-Eurozone imports (%)',
                data: methylAlcoholEurozoneImportData.map((item) => item.share),
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
                        const item = methylAlcoholEurozoneImportData[context.dataIndex];
                        const valueInBillions = item.value / 1e9;
                        return `${item.share.toFixed(2)}% of extra-Eurozone imports (${valueInBillions.toFixed(2)} bn USD)`;
                    }
                }
            }
        },
        scales: {
            x: {
                beginAtZero: true,
                suggestedMax: 35,
                title: {
                    display: true,
                    text: 'Share of extra-Eurozone imports (%)',
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
                    const value = methylAlcoholEurozoneImportData[index].share;
                    chartCtx.fillText(`${value.toFixed(2)}%`, bar.x + 8, bar.y);
                });

                chartCtx.restore();
            }
        }
    ]
});

downloadButton.addEventListener('click', () => {
    downloadChartAsPng(
        methylAlcoholChart,
        `methyl-alcohol-top-exporters-oec-2024-${new Date().toISOString().slice(0, 10)}.png`,
        titleElement ? titleElement.textContent : ''
    );
});

eurozoneDownloadButton.addEventListener('click', () => {
    downloadChartAsPng(
        methylAlcoholEurozoneChart,
        `methyl-alcohol-eurozone-import-structure-2024-${new Date().toISOString().slice(0, 10)}.png`,
        eurozoneTitleElement ? eurozoneTitleElement.textContent : ''
    );
});

console.log('Methyl alcohol chart loaded from OEC 2024 exporter data.', {
    totalWorldExports,
    top4CombinedShare
});
