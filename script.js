let chart = null;
let economicChart = null;
let foreignHoldersChart = null;
let percentageChart = null;
let transactionsChart = null;
let japanNetSalesChart = null;
let japanHoldingsCheckChart = null;
let japanMagicChart = null;
let chinaNetSalesChart = null;
let chinaHoldingsCheckChart = null;
let ukNetSalesChart = null;
let ukHoldingsCheckChart = null;
let euroNetSalesChart = null;
let euroHoldingsCheckChart = null;
let euroZoneComponentsShareChart = null;

// Format number as billions with B suffix
function formatBillions(value) {
    return `$${(value / 1e9).toFixed(2)}B`;
}

function getSelectedDateRange() {
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    return {
        startDate: (startInput && startInput.value) ? startInput.value : '2000-01-01',
        endDate: (endInput && endInput.value) ? endInput.value : '2026-12-31'
    };
}

// Fetch data from Treasury API
async function fetchData() {
    try {
        // Fetch and update foreign holders data
        await fetchForeignHoldersData();
        
        // Fetch and update foreign holders percentage data
        await fetchForeignHoldersPercentage();

        // Fetch Euro Zone component shares
        await fetchEuroZoneComponentShares();
        
    } catch (error) {
        console.error('Error fetching data:', error);
        alert('Error fetching data. Please try again.');
    }
}

// Fetch Euro Zone component share data
async function fetchEuroZoneComponentShares() {
    try {
        const response = await fetch('http://localhost:5001/api/euro-zone-component-shares');
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        const data = await response.json();
        updateEuroZoneComponentSharesChart(data);
    } catch (error) {
        console.error('Error fetching Euro Zone component shares:', error);
    }
}

function updateEuroZoneComponentSharesChart(data) {
    const canvas = document.getElementById('euroZoneComponentsShareChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const countries = ['Belgium', 'Luxembourg', 'France', 'Ireland', 'Norway', 'Germany', 'Spain', 'Italy'];
    const colors = {
        'Belgium': '#2563EB',
        'Luxembourg': '#7C3AED',
        'France': '#DC2626',
        'Ireland': '#16A34A',
        'Norway': '#D97706',
        'Germany': '#111827',
        'Spain': '#0891B2',
        'Italy': '#EC4899'
    };

    const allDateStrings = Array.from(new Set(
        countries.flatMap(country => (data[country] || []).map(item => item.date))
    )).sort();

    const labels = allDateStrings.map(dateStr => new Date(`${dateStr}T00:00:00`));

    const datasets = countries.map(country => {
        const series = data[country] || [];
        const seriesMap = new Map(series.map(item => [item.date, item.percentage]));

        return {
            label: country,
            data: allDateStrings.map(dateStr => seriesMap.has(dateStr) ? seriesMap.get(dateStr) : null),
            borderColor: colors[country],
            backgroundColor: colors[country] + '22',
            borderWidth: 2,
            fill: false,
            tension: 0.15,
            pointRadius: 0,
            spanGaps: true
        };
    });

    if (euroZoneComponentsShareChart) {
        euroZoneComponentsShareChart.destroy();
    }

    euroZoneComponentsShareChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            aspectRatio: 2.4,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'year',
                        displayFormats: {
                            year: 'yyyy'
                        }
                    },
                    title: {
                        display: true,
                        text: 'Date'
                    }
                },
                y: {
                    beginAtZero: true,
                    max: 60,
                    title: {
                        display: true,
                        text: 'Share of Euro Zone Holdings (%)'
                    },
                    ticks: {
                        callback: function(value) {
                            return value.toFixed(0) + '%';
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value == null) return context.dataset.label + ': N/A';
                            return `${context.dataset.label}: ${value.toFixed(2)}%`;
                        }
                    }
                }
            }
        }
    });
}

// Process debt data to calculate issuance and expiry
function processDebtData(rawData) {
    if (!rawData || rawData.length === 0) return { dates: [], issued: [], expired: [], net: [] };
    
    const dates = [];
    const issued = [];
    const expired = [];
    const net = [];
    
    // Group by month
    const monthlyData = {};
    
    rawData.forEach(item => {
        const date = new Date(item.record_date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const debt = parseFloat(item.tot_pub_debt_out_amt);
        
        if (!monthlyData[monthKey]) {
            monthlyData[monthKey] = [];
        }
        monthlyData[monthKey].push(debt);
    });
    
    // Calculate monthly changes
    const months = Object.keys(monthlyData).sort();
    let previousDebt = null;
    
    months.forEach(month => {
        const monthDebts = monthlyData[month];
        const endMonthDebt = monthDebts[monthDebts.length - 1];
        
        if (previousDebt !== null) {
            const change = endMonthDebt - previousDebt;
            dates.push(month);
            
            if (change > 0) {
                issued.push(change);
                expired.push(0);
                net.push(change);
            } else {
                issued.push(0);
                expired.push(Math.abs(change));
                net.push(change);
            }
        }
        
        previousDebt = endMonthDebt;
    });
    
    return { dates, issued, expired, net };
}

// Update the chart
function updateChart(data) {
    const ctx = document.getElementById('treasuryChart').getContext('2d');
    
    if (chart) {
        chart.destroy();
    }
    
    chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.dates,
            datasets: [
                {
                    label: 'Issued (bn USD)',
                    data: data.issued.map(v => v / 1e9),
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Expired/Matured (bn USD)',
                    data: data.expired.map(v => -v / 1e9),
                    backgroundColor: 'rgba(255, 159, 64, 0.6)',
                    borderColor: 'rgba(255, 159, 64, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Net (Issued - Expired) (bn USD)',
                    data: data.net.map(v => v / 1e9),
                    type: 'line',
                    borderColor: 'rgb(34, 197, 94)',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    borderWidth: 3,
                    fill: false,
                    tension: 0.1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                title: {
                    display: true,
                    text: 'US Treasury Debt Issuance vs Expiry',
                    font: {
                        size: 18
                    }
                },
                legend: {
                    display: true,
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'USD (Billions)'
                    },
                    ticks: {
                        callback: function(value) {
                            return '$' + value + 'B';
                        }
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Month'
                    }
                }
            }
        }
    });
}

// Update statistics cards
function updateStats(data) {
    const totalIssued = data.issued.reduce((a, b) => a + b, 0);
    const totalExpired = data.expired.reduce((a, b) => a + b, 0);
    const netChange = totalIssued - totalExpired;
    
    document.getElementById('totalIssued').textContent = formatBillions(totalIssued);
    document.getElementById('totalExpired').textContent = formatBillions(totalExpired);
    document.getElementById('netChange').textContent = formatBillions(netChange);
    
    // Color code net change
    const netElement = document.getElementById('netChange');
    netElement.style.color = netChange >= 0 ? '#22c55e' : '#ef4444';
}

// Fetch economic indicators data
async function fetchEconomicData() {
    try {
        const { startDate, endDate } = getSelectedDateRange();
        
        // MUST use local API server - FRED and Yahoo Finance APIs don't allow direct browser access (CORS)
        const response = await fetch(`http://localhost:5001/api/economic-data?start_date=${startDate}&end_date=${endDate}`);
        
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        
        const economicData = await response.json();
        updateEconomicChart(economicData);
        
    } catch (error) {
        console.error('Error fetching economic data:', error);
        showEconomicChartError();
    }
}

// Show error message for economic chart
function showEconomicChartError() {
    const chartContainer = document.getElementById('economicChart').parentElement;
    chartContainer.innerHTML = `
        <div style="padding: 40px; text-align: center; background: #FEF2F2; border-radius: 8px; border: 2px solid #FCA5A5;">
            <h3 style="color: #DC2626; margin-bottom: 15px;">⚠️ API Server Required</h3>
            <p style="color: #991B1B; margin-bottom: 15px; font-size: 16px;">
                Economic indicators require the Flask API server to be running.
            </p>
            <div style="background: white; padding: 15px; border-radius: 6px; margin: 20px auto; max-width: 500px; text-align: left;">
                <p style="color: #666; margin-bottom: 10px; font-weight: 600;">To start the server:</p>
                <code style="display: block; background: #1F2937; color: #10B981; padding: 12px; border-radius: 4px; font-family: monospace;">python3 api_server.py</code>
                <p style="color: #666; margin-top: 15px; font-size: 14px;">
                    The server fetches data from FRED (Federal Reserve) and Yahoo Finance APIs, 
                    which cannot be accessed directly from the browser due to CORS restrictions.
                </p>
            </div>
            <p style="color: #666; font-size: 13px; margin-top: 10px;">
                Server runs on <strong>http://localhost:5001</strong> - Refresh the page after starting
            </p>
        </div>
        <canvas id="economicChart" style="display: none;"></canvas>
    `;
}

// Update economic indicators chart
function updateEconomicChart(data) {
    const ctx = document.getElementById('economicChart').getContext('2d');
    
    if (economicChart) {
        economicChart.destroy();
    }
    
    economicChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.dates,
            datasets: [
                {
                    label: 'Core Inflation (%)',
                    data: data.coreInflation,
                    borderColor: '#003D7A',
                    backgroundColor: 'rgba(0, 61, 122, 0.1)',
                    borderWidth: 2,
                    tension: 0.1,
                    fill: false
                },
                {
                    label: 'Headline Inflation (%)',
                    data: data.headlineInflation,
                    borderColor: '#FFDD00',
                    backgroundColor: 'rgba(255, 221, 0, 0.1)',
                    borderWidth: 2,
                    tension: 0.1,
                    fill: false
                },
                {
                    label: 'Oil Prices % Change',
                    data: data.oilPrices,
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    borderWidth: 2,
                    tension: 0.1,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                title: {
                    display: false
                },
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.parsed.y.toFixed(2) + '%';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    title: {
                        display: true,
                        text: 'Monthly % Change'
                    },
                    ticks: {
                        callback: function(value) {
                            return value.toFixed(1) + '%';
                        }
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Month'
                    }
                }
            }
        }
    });
}

// Fetch Major Foreign Holders data from Treasury
async function fetchForeignHoldersData() {
    try {
        const { startDate, endDate } = getSelectedDateRange();
        
        // Fetch from API which downloads and parses Treasury data
        const url = `http://localhost:5001/api/foreign-holders?start_date=${startDate}&end_date=${endDate}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Received foreign holders data:', data);
        
        // Update the chart
        updateForeignHoldersChart(data);
        updateTransactionsChart(data);
        fetchJapanNetSales();
        fetchJapanMagicDecomposition();
        fetchChinaNetSales();
        fetchUkNetSales();
        fetchEuroNetSales();
    } catch (error) {
        console.error('Error fetching foreign holders data:', error);
        showForeignHoldersError();
    }
}

// Show error message for foreign holders chart
function showForeignHoldersError() {
    const chartContainer = document.getElementById('foreignHoldersChart').parentElement;
    chartContainer.innerHTML = `
        <div style="padding: 40px; text-align: center; background: #FEF2F2; border-radius: 8px; border: 2px solid #FCA5A5;">
            <h3 style="color: #DC2626; margin-bottom: 15px;">⚠️ API Server Required</h3>
            <p style="color: #991B1B; margin-bottom: 15px; font-size: 16px;">
                Foreign holders data requires the Flask API server to be running.
            </p>
            <div style="background: white; padding: 15px; border-radius: 6px; margin: 20px auto; max-width: 500px; text-align: left;">
                <p style="color: #666; margin-bottom: 10px; font-weight: 600;">To start the server:</p>
                <code style="display: block; background: #1F2937; color: #10B981; padding: 12px; border-radius: 4px; font-family: monospace;">python3 api_server.py</code>
                <p style="color: #666; margin-top: 15px; font-size: 14px;">
                    The server proxies data from the Treasury's TIC (Treasury International Capital) database, 
                    which cannot be accessed directly from the browser due to CORS restrictions.
                </p>
            </div>
            <p style="color: #666; font-size: 13px; margin-top: 10px;">
                Server runs on <strong>http://localhost:5001</strong> - Refresh the page after starting
            </p>
        </div>
        <canvas id="foreignHoldersChart" style="display: none;"></canvas>
    `;
}

// Process foreign holders data for the top 5 countries from text file
function processForeignHoldersData(text) {
    console.log('Starting to process foreign holders data...');
    
    const lines = text.split('\n');
    const countries = {
        'Japan': [],
        'China, Mainland': [],
        'United Kingdom': [],
        'Euro Zone': []
    };
    
    // Find the header line with months
    let monthLine = '';
    let yearLine = '';
    
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('Dec') && lines[i].includes('Jan')) {
            monthLine = lines[i];
            // Year line should be right after
            if (i + 1 < lines.length) {
                yearLine = lines[i + 1];
            }
            break;
        }
    }
    
    // Extract months and years
    const months = monthLine.trim().split(/\s+/).filter(m => 
        ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].includes(m)
    );
    const years = yearLine.trim().split(/\s+/).filter(y => y.match(/^\d{4}$/));
    
    console.log('Found months:', months.length, 'years:', years.length);
    
    // Create date labels (newest first)
    const dates = [];
    for (let i = 0; i < Math.min(months.length, years.length); i++) {
        dates.push(`${months[i]} ${years[i]}`);
    }
    
    console.log('Created dates:', dates);
    
    // Process each country
    for (const country of Object.keys(countries)) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let isMatch = false;
            
            if (country === 'China, Mainland') {
                isMatch = line.includes('"China, Mainland"') || 
                         (line.includes('China,') && line.includes('Mainland'));
            } else if (country === 'Euro Zone') {
                isMatch = line.includes('Belgium') || line.includes('Luxembourg') || line.includes('France') || line.includes('Ireland') || line.includes('Norway') || line.includes('Germany') || line.includes('Spain') || line.includes('Italy');
            } else if (country === 'United Kingdom') {
                isMatch = line.includes('United Kingdom');
            } else if (country === 'Japan') {
                isMatch = line.trim().startsWith('Japan');
            }
            
            if (isMatch) {
                console.log(`Found line for ${country}:`, line.substring(0, 100));
                
                // Extract all numeric values from the line
                const numericPattern = /\d+\.\d+|\d+/g;
                const matches = line.match(numericPattern);
                
                if (matches) {
                    const values = matches.map(v => parseFloat(v)).filter(v => v > 100); // Filter out years
                    console.log(`${country} values:`, values.length, 'samples:', values.slice(0, 5));
                    
                    // Match values to dates
                    for (let j = 0; j < Math.min(values.length, dates.length); j++) {
                        if (values[j] && dates[j]) {
                            countries[country].push({
                                date: dates[j],
                                holdings: values[j]
                            });
                        }
                    }
                }
                break;
            }
        }
    }
    
    // Log results
    Object.keys(countries).forEach(country => {
        console.log(`${country}: ${countries[country].length} data points`);
    });
    
    return countries;
}

// Update foreign holders chart
function updateForeignHoldersChart(data) {
    const ctx = document.getElementById('foreignHoldersChart').getContext('2d');
    
    if (foreignHoldersChart) {
        foreignHoldersChart.destroy();
    }
    
    // Get all unique dates from all countries
    const allDates = new Set();
    Object.values(data).forEach(countryData => {
        countryData.forEach(record => allDates.add(record.date));
    });
    
    const dates = Array.from(allDates).sort((a, b) => {
        const dateA = new Date(a);
        const dateB = new Date(b);
        return dateA - dateB;
    });
    
    console.log('Foreign holders dates:', dates.length);
    
    // Define colors for each country
    const countryColors = {
        'Japan': '#003D7A',
        'China': '#DC2626',
        'United Kingdom': '#059669',
        'Euro Zone': '#FFDD00'
    };
    
    const datasets = Object.keys(data).map(country => {
        const holdings = dates.map(date => {
            const record = data[country].find(r => r.date === date);
            return record ? record.holdings : null;
        });
        
        return {
            label: country,
            data: holdings,
            borderColor: countryColors[country] || '#999',
            backgroundColor: (countryColors[country] || '#999') + '20',
            borderWidth: 2,
            tension: 0.1,
            fill: false,
            spanGaps: true
        };
    });
    
    foreignHoldersChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                title: {
                    display: false
                },
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': $' + context.parsed.y.toFixed(1) + 'B';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    title: {
                        display: true,
                        text: 'Treasury Holdings (Billions USD)'
                    },
                    ticks: {
                        callback: function(value) {
                            const formatted = Number(value).toLocaleString('en-US', {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0
                            }).replace(/,/g, "'");
                            return '$' + formatted + 'B';
                        }
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Date'
                    },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45,
                        autoSkip: true,
                        maxTicksLimit: 20
                    }
                }
            }
        }
    });
}

// Update transactions chart (net monthly change in holdings)
function updateTransactionsChart(data) {
    const ctx = document.getElementById('transactionsChart').getContext('2d');

    if (transactionsChart) {
        transactionsChart.destroy();
    }

    const allDates = new Set();
    Object.values(data).forEach(countryData => {
        countryData.forEach(record => allDates.add(record.date));
    });

    const dates = Array.from(allDates)
        .filter(date => new Date(date) >= new Date('2020-01-01'))
        .sort((a, b) => new Date(a) - new Date(b));
    const countryColors = {
        'Japan': '#003D7A',
        'China': '#DC2626',
        'United Kingdom': '#059669',
        'Euro Zone': '#FFDD00'
    };

    const datasets = Object.keys(data).map(country => {
        const countryMap = new Map(data[country].map(item => [item.date, item.holdings]));
        let prevValue = null;
        const deltas = dates.map(date => {
            const current = countryMap.get(date);
            if (current == null || prevValue == null) {
                prevValue = current != null ? current : prevValue;
                return null;
            }
            const delta = current - prevValue;
            prevValue = current;
            return delta;
        });

        // 6-month rolling average of deltas
        const rolling = deltas.map((value, idx) => {
            if (value == null) return null;
            const window = deltas.slice(Math.max(0, idx - 5), idx + 1).filter(v => v != null);
            if (!window.length) return null;
            const avg = window.reduce((sum, v) => sum + v, 0) / window.length;
            return avg;
        });

        return {
            label: country,
            data: rolling,
            borderColor: countryColors[country] || '#999',
            backgroundColor: (countryColors[country] || '#999') + '20',
            borderWidth: 2,
            tension: 0.2,
            fill: false,
            spanGaps: true
        };
    });

    transactionsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Date'
                    }
                },
                y: {
                    min: -90,
                    max: 75,
                    title: {
                        display: true,
                        text: '6-Month Rolling Net Change (Billions USD)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value == null) return context.dataset.label + ': N/A';
                            const direction = value >= 0 ? 'Buy' : 'Sell';
                            return `${context.dataset.label}: ${direction} $${Math.abs(value).toFixed(1)}B (6M avg)`;
                        }
                    }
                }
            }
        }
    });
}

// Fetch Japan net sales and valuation change data
async function fetchJapanNetSales() {
    try {
        const response = await fetch('http://localhost:5001/api/treasury-net-sales-japan');
        const data = await response.json();
        updateJapanNetSalesChart(data);
    } catch (error) {
        console.error('Error fetching Japan net sales data:', error);
    }
}

// Fetch Japan estimated decomposition (valuation proxy + implied net sales)
async function fetchJapanMagicDecomposition() {
    try {
        const response = await fetch('http://localhost:5001/api/japan-estimated-decomposition');
        const data = await response.json();
        updateJapanMagicChart(data);
    } catch (error) {
        console.error('Error fetching Japan estimated decomposition data:', error);
    }
}

// Update Japan magic chart: YoY delta vs estimated decomposition
function updateJapanMagicChart(data) {
    const canvas = document.getElementById('japanMagicChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    if (japanMagicChart) {
        japanMagicChart.destroy();
    }

    const labels = data.map(item => item.date);
    const modelSegments = data.map(item => item.model_segment || 'inference');
    const holdings = data.map(item => item.holdings ?? null);
    const deltaYoY = data.map(item => item.delta_holdings_yoy ?? null);
    const estVal = data.map(item => item.estimated_valuation_change ?? null);
    const impliedNet = data.map(item => item.implied_net_sales ?? null);

    const rolling12m = (arr, idx) => {
        if (idx < 11) return null;
        const window = arr.slice(idx - 11, idx + 1);
        if (window.some(v => v == null)) return null;
        return window.reduce((sum, v) => sum + v, 0);
    };

    // 12M sums for decomposition bars so they align with YoY holdings delta
    const estVal12m = estVal.map((_, idx) => rolling12m(estVal, idx));
    const impliedNet12m = impliedNet.map((_, idx) => rolling12m(impliedNet, idx));

    const validHoldings = holdings.filter(v => v != null);
    const rhsMin = validHoldings.length ? Math.floor((Math.min(...validHoldings) * 0.95) / 10000) * 10000 : undefined;

    const segmentColors = {
        train: 'rgba(59, 130, 246, 0.08)',
        holdout: 'rgba(168, 85, 247, 0.10)',
        inference: 'rgba(107, 114, 128, 0.08)'
    };

    const segmentShadingPlugin = {
        id: 'segmentShading',
        beforeDatasetsDraw(chart) {
            const { ctx, chartArea, scales } = chart;
            const x = scales.x;
            if (!x || !chartArea) return;

            const ranges = [];
            let start = 0;
            for (let i = 1; i <= modelSegments.length; i++) {
                if (i === modelSegments.length || modelSegments[i] !== modelSegments[start]) {
                    ranges.push({ start, end: i - 1, segment: modelSegments[start] });
                    start = i;
                }
            }

            ctx.save();
            for (const r of ranges) {
                const color = segmentColors[r.segment] || segmentColors.inference;
                const startPx = x.getPixelForValue(r.start);
                const endPx = x.getPixelForValue(r.end);

                const left = r.start === 0
                    ? chartArea.left
                    : (x.getPixelForValue(r.start - 1) + startPx) / 2;
                const right = r.end === modelSegments.length - 1
                    ? chartArea.right
                    : (endPx + x.getPixelForValue(r.end + 1)) / 2;

                ctx.fillStyle = color;
                ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
            }
            ctx.restore();
        }
    };

    japanMagicChart = new Chart(ctx, {
        plugins: [segmentShadingPlugin],
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: '12M Implied Net Sales',
                    data: impliedNet12m,
                    backgroundColor: '#2563EB',
                    yAxisID: 'y',
                    stack: 'flow',
                    order: 3
                },
                {
                    label: '12M Estimated Valuation',
                    data: estVal12m,
                    backgroundColor: '#F59E0B',
                    yAxisID: 'y',
                    stack: 'flow',
                    order: 3
                },
                {
                    label: 'Delta Holdings YoY',
                    data: deltaYoY,
                    type: 'line',
                    borderColor: '#16A34A',
                    backgroundColor: '#16A34A20',
                    borderWidth: 3,
                    tension: 0.15,
                    fill: false,
                    pointRadius: 0,
                    spanGaps: true,
                    yAxisID: 'y',
                    order: 1
                },
                {
                    label: 'Holdings Stocks (RHS)',
                    data: holdings,
                    type: 'line',
                    borderColor: '#111827',
                    borderDash: [6, 4],
                    backgroundColor: '#11182720',
                    borderWidth: 2.2,
                    tension: 0.2,
                    fill: false,
                    pointRadius: 0,
                    yAxisID: 'yRhs',
                    order: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            aspectRatio: 2.2,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Date'
                    },
                    ticks: {
                        maxTicksLimit: 12
                    }
                },
                y: {
                    stacked: true,
                    grid: {
                        color: (ctx) => (ctx.tick && ctx.tick.value === 0 ? '#374151' : '#E5E7EB'),
                        lineWidth: (ctx) => (ctx.tick && ctx.tick.value === 0 ? 2 : 1)
                    },
                    title: {
                        display: true,
                        text: 'YoY Delta / 12M Estimated Contributions (Millions USD)'
                    }
                },
                yRhs: {
                    position: 'right',
                    min: rhsMin,
                    grid: {
                        drawOnChartArea: false
                    },
                    title: {
                        display: true,
                        text: 'Holdings Stocks (Millions USD)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                subtitle: {
                    display: true,
                    text: 'Shading: blue = train, purple = holdout, gray = inference',
                    color: '#4B5563',
                    padding: {
                        top: 0,
                        bottom: 8
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value == null) return context.dataset.label + ': N/A';
                            return `${context.dataset.label}: ${value.toFixed(0)}M`;
                        }
                    }
                }
            }
        }
    });
}

// Fetch China net sales and valuation change data
async function fetchChinaNetSales() {
    try {
        const response = await fetch('http://localhost:5001/api/treasury-net-sales-china');
        const data = await response.json();
        updateChinaNetSalesChart(data);
    } catch (error) {
        console.error('Error fetching China net sales data:', error);
    }
}

// Fetch UK net sales and valuation change data
async function fetchUkNetSales() {
    try {
        const response = await fetch('http://localhost:5001/api/treasury-net-sales-uk');
        const data = await response.json();
        updateUkNetSalesChart(data);
    } catch (error) {
        console.error('Error fetching UK net sales data:', error);
    }
}

// Fetch Euro Zone net sales and valuation change data
async function fetchEuroNetSales() {
    try {
        const response = await fetch('http://localhost:5001/api/treasury-net-sales-euro-zone');
        const data = await response.json();
        updateEuroNetSalesChart(data);
    } catch (error) {
        console.error('Error fetching Euro Zone net sales data:', error);
    }
}

// Update Japan net sales vs valuation change chart
function updateJapanNetSalesChart(data) {
    const ctx = document.getElementById('japanNetSalesChart').getContext('2d');

    if (japanNetSalesChart) {
        japanNetSalesChart.destroy();
    }

    const labels = data.map(item => item.date);
    const holdings = data.map(item => item.holdings ?? null);
    const netSales = data.map(item => item.net_sales ?? null);
    const valuation = data.map(item => item.valuation_change ?? null);

    // Excel-like transforms:
    // - Delta holdings YoY: H_t - H_{t-12}
    // - Stacked bars: 12M rolling sum of net sales and valuation
    const deltaHoldingYoY = holdings.map((value, idx) => {
        if (idx < 12 || value == null || holdings[idx - 12] == null) return null;
        return value - holdings[idx - 12];
    });

    const rolling12m = (arr, idx) => {
        if (idx < 11) return null;
        const window = arr.slice(idx - 11, idx + 1);
        if (window.some(v => v == null)) return null;
        return window.reduce((sum, v) => sum + v, 0);
    };

    const netSales12m = netSales.map((_, idx) => rolling12m(netSales, idx));
    const valuation12m = valuation.map((_, idx) => rolling12m(valuation, idx));

    japanNetSalesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: '12M Net Sales',
                    data: netSales12m,
                    backgroundColor: '#2563EB',
                    yAxisID: 'y',
                    stack: 'flow',
                    order: 3
                },
                {
                    label: '12M Valuation Changes',
                    data: valuation12m,
                    backgroundColor: '#F59E0B',
                    yAxisID: 'y',
                    stack: 'flow',
                    order: 3
                },
                {
                    label: 'Delta Holdings YoY',
                    data: deltaHoldingYoY,
                    type: 'line',
                    borderColor: '#16A34A',
                    backgroundColor: '#16A34A20',
                    borderWidth: 3,
                    tension: 0.15,
                    fill: false,
                    pointRadius: 0,
                    spanGaps: true,
                    yAxisID: 'y',
                    order: 1
                },
                {
                    label: 'Holdings Stocks (RHS)',
                    data: holdings,
                    type: 'line',
                    borderColor: '#111827',
                    borderDash: [6, 4],
                    backgroundColor: '#11182720',
                    borderWidth: 2.2,
                    tension: 0.2,
                    fill: false,
                    pointRadius: 0,
                    yAxisID: 'yRhs',
                    order: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            aspectRatio: 2.2,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Date'
                    },
                    ticks: {
                        maxTicksLimit: 12
                    }
                },
                y: {
                    stacked: true,
                    grid: {
                        color: (ctx) => (ctx.tick && ctx.tick.value === 0 ? '#374151' : '#E5E7EB'),
                        lineWidth: (ctx) => (ctx.tick && ctx.tick.value === 0 ? 2 : 1)
                    },
                    title: {
                        display: true,
                        text: 'Delta / 12M Contributions (Millions USD)'
                    }
                },
                yRhs: {
                    position: 'right',
                    min: 900000,
                    grid: {
                        drawOnChartArea: false
                    },
                    title: {
                        display: true,
                        text: 'Holdings Stocks (Millions USD)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value == null) return context.dataset.label + ': N/A';
                            return `${context.dataset.label}: ${value.toFixed(0)}M`;
                        }
                    }
                }
            }
        }
    });
}

// Update Japan holdings check chart
function updateJapanHoldingsCheckChart(data) {
    const ctx = document.getElementById('japanHoldingsCheckChart').getContext('2d');

    if (japanHoldingsCheckChart) {
        japanHoldingsCheckChart.destroy();
    }

    const labels = data.map(item => item.date);
    const actual = data.map(item => item.holdings);
    const computed = data.map(item => item.holdings_computed);

    japanHoldingsCheckChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Actual Holdings',
                    data: actual,
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED820',
                    borderWidth: 2,
                    tension: 0.2,
                    fill: false,
                    spanGaps: true
                },
                {
                    label: 'Calculated Holdings',
                    data: computed,
                    borderColor: '#F97316',
                    backgroundColor: '#F9731620',
                    borderWidth: 2,
                    tension: 0.2,
                    borderDash: [6, 4],
                    fill: false,
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Date'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Holdings (Millions USD)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value == null) return context.dataset.label + ': N/A';
                            return `${context.dataset.label}: $${value.toFixed(0)}M`;
                        }
                    }
                }
            }
        }
    });
}

// Update China net sales vs valuation change chart
function updateChinaNetSalesChart(data) {
    const ctx = document.getElementById('chinaNetSalesChart').getContext('2d');

    if (chinaNetSalesChart) {
        chinaNetSalesChart.destroy();
    }

    const labels = data.map(item => item.date);
    const holdings = data.map(item => item.holdings ?? null);
    const netSales = data.map(item => item.net_sales ?? null);
    const valuation = data.map(item => item.valuation_change ?? null);

    const deltaHoldingYoY = holdings.map((value, idx) => {
        if (idx < 12 || value == null || holdings[idx - 12] == null) return null;
        return value - holdings[idx - 12];
    });

    const rolling12m = (arr, idx) => {
        if (idx < 11) return null;
        const window = arr.slice(idx - 11, idx + 1);
        if (window.some(v => v == null)) return null;
        return window.reduce((sum, v) => sum + v, 0);
    };

    const netSales12m = netSales.map((_, idx) => rolling12m(netSales, idx));
    const valuation12m = valuation.map((_, idx) => rolling12m(valuation, idx));
    const validHoldings = holdings.filter(v => v != null);
    const rhsMin = validHoldings.length ? Math.floor((Math.min(...validHoldings) * 0.95) / 10000) * 10000 : undefined;

    chinaNetSalesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: '12M Net Sales',
                    data: netSales12m,
                    backgroundColor: '#2563EB',
                    yAxisID: 'y',
                    stack: 'flow',
                    order: 3
                },
                {
                    label: '12M Valuation Changes',
                    data: valuation12m,
                    backgroundColor: '#F59E0B',
                    yAxisID: 'y',
                    stack: 'flow',
                    order: 3
                },
                {
                    label: 'Delta Holdings YoY',
                    data: deltaHoldingYoY,
                    type: 'line',
                    borderColor: '#16A34A',
                    backgroundColor: '#16A34A20',
                    borderWidth: 3,
                    tension: 0.15,
                    fill: false,
                    pointRadius: 0,
                    spanGaps: true,
                    yAxisID: 'y',
                    order: 1
                },
                {
                    label: 'Holdings Stocks (RHS)',
                    data: holdings,
                    type: 'line',
                    borderColor: '#111827',
                    borderDash: [6, 4],
                    backgroundColor: '#11182720',
                    borderWidth: 2.2,
                    tension: 0.2,
                    fill: false,
                    pointRadius: 0,
                    yAxisID: 'yRhs',
                    order: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            aspectRatio: 2.2,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Date'
                    },
                    ticks: {
                        maxTicksLimit: 12
                    }
                },
                y: {
                    stacked: true,
                    grid: {
                        color: (ctx) => (ctx.tick && ctx.tick.value === 0 ? '#374151' : '#E5E7EB'),
                        lineWidth: (ctx) => (ctx.tick && ctx.tick.value === 0 ? 2 : 1)
                    },
                    title: {
                        display: true,
                        text: 'Delta / 12M Contributions (Millions USD)'
                    }
                },
                yRhs: {
                    position: 'right',
                    min: rhsMin,
                    grid: {
                        drawOnChartArea: false
                    },
                    title: {
                        display: true,
                        text: 'Holdings Stocks (Millions USD)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value == null) return context.dataset.label + ': N/A';
                            return `${context.dataset.label}: ${value.toFixed(0)}M`;
                        }
                    }
                }
            }
        }
    });
}

// Update China holdings check chart
function updateChinaHoldingsCheckChart(data) {
    const ctx = document.getElementById('chinaHoldingsCheckChart').getContext('2d');

    if (chinaHoldingsCheckChart) {
        chinaHoldingsCheckChart.destroy();
    }

    const labels = data.map(item => item.date);
    const actual = data.map(item => item.holdings);
    const computed = data.map(item => item.holdings_computed);

    chinaHoldingsCheckChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Actual Holdings',
                    data: actual,
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED820',
                    borderWidth: 2,
                    tension: 0.2,
                    fill: false,
                    spanGaps: true
                },
                {
                    label: 'Calculated Holdings',
                    data: computed,
                    borderColor: '#F97316',
                    backgroundColor: '#F9731620',
                    borderWidth: 2,
                    tension: 0.2,
                    borderDash: [6, 4],
                    fill: false,
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Date'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Holdings (Millions USD)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value == null) return context.dataset.label + ': N/A';
                            return `${context.dataset.label}: $${value.toFixed(0)}M`;
                        }
                    }
                }
            }
        }
    });
}

// Update UK net sales vs valuation change chart
function updateUkNetSalesChart(data) {
    const ctx = document.getElementById('ukNetSalesChart').getContext('2d');

    if (ukNetSalesChart) {
        ukNetSalesChart.destroy();
    }

    const labels = data.map(item => item.date);
    const holdings = data.map(item => item.holdings ?? null);
    const netSales = data.map(item => item.net_sales ?? null);
    const valuation = data.map(item => item.valuation_change ?? null);

    const deltaHoldingYoY = holdings.map((value, idx) => {
        if (idx < 12 || value == null || holdings[idx - 12] == null) return null;
        return value - holdings[idx - 12];
    });

    const rolling12m = (arr, idx) => {
        if (idx < 11) return null;
        const window = arr.slice(idx - 11, idx + 1);
        if (window.some(v => v == null)) return null;
        return window.reduce((sum, v) => sum + v, 0);
    };

    const netSales12m = netSales.map((_, idx) => rolling12m(netSales, idx));
    const valuation12m = valuation.map((_, idx) => rolling12m(valuation, idx));
    const validHoldings = holdings.filter(v => v != null);
    const rhsMin = validHoldings.length ? Math.floor((Math.min(...validHoldings) * 0.95) / 10000) * 10000 : undefined;

    ukNetSalesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: '12M Net Sales',
                    data: netSales12m,
                    backgroundColor: '#2563EB',
                    yAxisID: 'y',
                    stack: 'flow',
                    order: 3
                },
                {
                    label: '12M Valuation Changes',
                    data: valuation12m,
                    backgroundColor: '#F59E0B',
                    yAxisID: 'y',
                    stack: 'flow',
                    order: 3
                },
                {
                    label: 'Delta Holdings YoY',
                    data: deltaHoldingYoY,
                    type: 'line',
                    borderColor: '#16A34A',
                    backgroundColor: '#16A34A20',
                    borderWidth: 3,
                    tension: 0.15,
                    fill: false,
                    pointRadius: 0,
                    spanGaps: true,
                    yAxisID: 'y',
                    order: 1
                },
                {
                    label: 'Holdings Stocks (RHS)',
                    data: holdings,
                    type: 'line',
                    borderColor: '#111827',
                    borderDash: [6, 4],
                    backgroundColor: '#11182720',
                    borderWidth: 2.2,
                    tension: 0.2,
                    fill: false,
                    pointRadius: 0,
                    yAxisID: 'yRhs',
                    order: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            aspectRatio: 2.2,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Date'
                    },
                    ticks: {
                        maxTicksLimit: 12
                    }
                },
                y: {
                    stacked: true,
                    grid: {
                        color: (ctx) => (ctx.tick && ctx.tick.value === 0 ? '#374151' : '#E5E7EB'),
                        lineWidth: (ctx) => (ctx.tick && ctx.tick.value === 0 ? 2 : 1)
                    },
                    title: {
                        display: true,
                        text: 'Delta / 12M Contributions (Millions USD)'
                    }
                },
                yRhs: {
                    position: 'right',
                    min: rhsMin,
                    grid: {
                        drawOnChartArea: false
                    },
                    title: {
                        display: true,
                        text: 'Holdings Stocks (Millions USD)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value == null) return context.dataset.label + ': N/A';
                            return `${context.dataset.label}: ${value.toFixed(0)}M`;
                        }
                    }
                }
            }
        }
    });
}

// Update UK holdings check chart
function updateUkHoldingsCheckChart(data) {
    const ctx = document.getElementById('ukHoldingsCheckChart').getContext('2d');

    if (ukHoldingsCheckChart) {
        ukHoldingsCheckChart.destroy();
    }

    const labels = data.map(item => item.date);
    const actual = data.map(item => item.holdings);
    const computed = data.map(item => item.holdings_computed);

    ukHoldingsCheckChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Actual Holdings',
                    data: actual,
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED820',
                    borderWidth: 2,
                    tension: 0.2,
                    fill: false,
                    spanGaps: true
                },
                {
                    label: 'Calculated Holdings',
                    data: computed,
                    borderColor: '#F97316',
                    backgroundColor: '#F9731620',
                    borderWidth: 2,
                    tension: 0.2,
                    borderDash: [6, 4],
                    fill: false,
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Date'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Holdings (Millions USD)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value == null) return context.dataset.label + ': N/A';
                            return `${context.dataset.label}: $${value.toFixed(0)}M`;
                        }
                    }
                }
            }
        }
    });
}

// Update Euro Zone net sales vs valuation change chart
function updateEuroNetSalesChart(data) {
    const ctx = document.getElementById('euroNetSalesChart').getContext('2d');

    if (euroNetSalesChart) {
        euroNetSalesChart.destroy();
    }

    const labels = data.map(item => item.date);
    const holdings = data.map(item => item.holdings ?? null);
    const netSales = data.map(item => item.net_sales ?? null);
    const valuation = data.map(item => item.valuation_change ?? null);

    const deltaHoldingYoY = holdings.map((value, idx) => {
        if (idx < 12 || value == null || holdings[idx - 12] == null) return null;
        return value - holdings[idx - 12];
    });

    const rolling12m = (arr, idx) => {
        if (idx < 11) return null;
        const window = arr.slice(idx - 11, idx + 1);
        if (window.some(v => v == null)) return null;
        return window.reduce((sum, v) => sum + v, 0);
    };

    const netSales12m = netSales.map((_, idx) => rolling12m(netSales, idx));
    const valuation12m = valuation.map((_, idx) => rolling12m(valuation, idx));
    const validHoldings = holdings.filter(v => v != null);
    const rhsMin = validHoldings.length ? Math.floor((Math.min(...validHoldings) * 0.95) / 10000) * 10000 : undefined;

    euroNetSalesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: '12M Net Sales',
                    data: netSales12m,
                    backgroundColor: '#2563EB',
                    yAxisID: 'y',
                    stack: 'flow',
                    order: 3
                },
                {
                    label: '12M Valuation Changes',
                    data: valuation12m,
                    backgroundColor: '#F59E0B',
                    yAxisID: 'y',
                    stack: 'flow',
                    order: 3
                },
                {
                    label: 'Delta Holdings YoY',
                    data: deltaHoldingYoY,
                    type: 'line',
                    borderColor: '#16A34A',
                    backgroundColor: '#16A34A20',
                    borderWidth: 3,
                    tension: 0.15,
                    fill: false,
                    pointRadius: 0,
                    spanGaps: true,
                    yAxisID: 'y',
                    order: 1
                },
                {
                    label: 'Holdings Stocks (RHS)',
                    data: holdings,
                    type: 'line',
                    borderColor: '#111827',
                    borderDash: [6, 4],
                    backgroundColor: '#11182720',
                    borderWidth: 2.2,
                    tension: 0.2,
                    fill: false,
                    pointRadius: 0,
                    yAxisID: 'yRhs',
                    order: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            aspectRatio: 2.2,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Date'
                    },
                    ticks: {
                        maxTicksLimit: 12
                    }
                },
                y: {
                    stacked: true,
                    grid: {
                        color: (ctx) => (ctx.tick && ctx.tick.value === 0 ? '#374151' : '#E5E7EB'),
                        lineWidth: (ctx) => (ctx.tick && ctx.tick.value === 0 ? 2 : 1)
                    },
                    title: {
                        display: true,
                        text: 'Delta / 12M Contributions (Millions USD)'
                    }
                },
                yRhs: {
                    position: 'right',
                    min: rhsMin,
                    grid: {
                        drawOnChartArea: false
                    },
                    title: {
                        display: true,
                        text: 'Holdings Stocks (Millions USD)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value == null) return context.dataset.label + ': N/A';
                            return `${context.dataset.label}: ${value.toFixed(0)}M`;
                        }
                    }
                }
            }
        }
    });
}

// Update Euro Zone holdings check chart
function updateEuroHoldingsCheckChart(data) {
    const ctx = document.getElementById('euroHoldingsCheckChart').getContext('2d');

    if (euroHoldingsCheckChart) {
        euroHoldingsCheckChart.destroy();
    }

    const labels = data.map(item => item.date);
    const actual = data.map(item => item.holdings);
    const computed = data.map(item => item.holdings_computed);

    euroHoldingsCheckChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Actual Holdings',
                    data: actual,
                    borderColor: '#1D4ED8',
                    backgroundColor: '#1D4ED820',
                    borderWidth: 2,
                    tension: 0.2,
                    fill: false,
                    spanGaps: true
                },
                {
                    label: 'Calculated Holdings',
                    data: computed,
                    borderColor: '#F97316',
                    backgroundColor: '#F9731620',
                    borderWidth: 2,
                    tension: 0.2,
                    borderDash: [6, 4],
                    fill: false,
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Date'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Holdings (Millions USD)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value == null) return context.dataset.label + ': N/A';
                            return `${context.dataset.label}: $${value.toFixed(0)}M`;
                        }
                    }
                }
            }
        }
    });
}

// Fetch foreign holders percentage data
async function fetchForeignHoldersPercentage() {
    try {
        const response = await fetch('http://localhost:5001/api/foreign-holders-percentage');
        const data = await response.json();
        
        console.log('Foreign holders percentage data:', data);
        updatePercentageChart(data);
        
    } catch (error) {
        console.error('Error fetching foreign holders percentage:', error);
    }
}

// Update percentage chart
function updatePercentageChart(data) {
    const ctx = document.getElementById('percentageChart').getContext('2d');
    
    // Prepare datasets
    const countries = ['Japan', 'China', 'United Kingdom', 'Euro Zone'];
    const colors = {
        'Japan': '#003D7A',
        'China': '#DC143C',
        'United Kingdom': '#2E8B57',
        'Euro Zone': '#FFDD00'
    };
    
    const datasets = countries.map(country => {
        const countryData = data[country] || [];
        return {
            label: country,
            data: countryData.map(item => {
                // Parse date "Mon YYYY" format
                const dateObj = new Date(item.date);
                return {
                    x: dateObj,
                    y: item.percentage
                };
            }),
            borderColor: colors[country],
            backgroundColor: colors[country] + '20',
            borderWidth: 2,
            fill: false,
            tension: 0.1
        };
    });
    
    if (percentageChart) {
        percentageChart.destroy();
    }
    
    percentageChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            aspectRatio: 3,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'year',
                        displayFormats: {
                            year: 'yyyy'
                        }
                    },
                    title: {
                        display: true,
                        text: 'Date',
                        font: { size: 14, weight: 'bold' }
                    }
                },
                y: {
                    beginAtZero: true,
                    max: 10,
                    title: {
                        display: true,
                        text: 'Percentage of Total US Debt (%)',
                        font: { size: 14, weight: 'bold' }
                    },
                    ticks: {
                        stepSize: 0.5,
                        callback: function(value) {
                            return value.toFixed(1) + '%';
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.parsed.y.toFixed(2) + '%';
                        }
                    }
                }
            }
        }
    });
}

// Check if API server is running
async function checkServerStatus() {
    try {
        const response = await fetch('http://localhost:5001/api/health', { timeout: 2000 });
        if (response.ok) {
            const statusDiv = document.getElementById('serverStatus');
            statusDiv.innerHTML = '✅ API Server: <strong>Online</strong> - All charts will load with real data';
            statusDiv.style.background = '#D1FAE5';
            statusDiv.style.color = '#065F46';
            statusDiv.style.border = '2px solid #10B981';
            return true;
        }
    } catch (error) {
        const statusDiv = document.getElementById('serverStatus');
        statusDiv.innerHTML = '⚠️ API Server: <strong>Offline</strong> - Start with: <code style="background: #1F2937; color: #10B981; padding: 4px 8px; border-radius: 4px; margin-left: 5px;">python3 api_server.py</code>';
        statusDiv.style.background = '#FEF2F2';
        statusDiv.style.color = '#991B1B';
        statusDiv.style.border = '2px solid #FCA5A5';
        return false;
    }
}

// Load data on page load
window.addEventListener('load', async () => {
    await checkServerStatus();
    fetchData();
});
