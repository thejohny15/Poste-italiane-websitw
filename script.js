let chart = null;
let economicChart = null;
let foreignHoldersChart = null;
let percentageChart = null;

// Format number as billions with B suffix
function formatBillions(value) {
    return `$${(value / 1e9).toFixed(2)}B`;
}

// Fetch data from Treasury API
async function fetchData() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    try {
        // Show loading state
        document.getElementById('totalIssued').textContent = 'Loading...';
        document.getElementById('totalExpired').textContent = 'Loading...';
        document.getElementById('netChange').textContent = 'Loading...';
        
        // Fetch debt data from Treasury API
        const url = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?filter=record_date:gte:${startDate},record_date:lte:${endDate}&fields=record_date,tot_pub_debt_out_amt&page[size]=10000&sort=record_date`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        // Process the data
        const processedData = processDebtData(data.data);
        
        // Update chart
        updateChart(processedData);
        
        // Update statistics
        updateStats(processedData);
        
        // Fetch and update economic indicators
        await fetchEconomicData();
        
        // Fetch and update foreign holders data
        await fetchForeignHoldersData();
        
        // Fetch and update foreign holders percentage data
        await fetchForeignHoldersPercentage();
        
    } catch (error) {
        console.error('Error fetching data:', error);
        alert('Error fetching data. Please try again.');
    }
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
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        
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
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        
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
        'Belgium': [],
        'Cayman Islands': []
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
            } else if (country === 'Cayman Islands') {
                isMatch = line.includes('Cayman Islands');
            } else if (country === 'United Kingdom') {
                isMatch = line.includes('United Kingdom');
            } else if (country === 'Japan') {
                isMatch = line.trim().startsWith('Japan');
            } else if (country === 'Belgium') {
                isMatch = line.includes('Belgium');
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
        'Belgium': '#FFDD00',
        'Cayman Islands': '#8B5CF6'
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
                            return '$' + value.toFixed(0) + 'B';
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
    const countries = ['Japan', 'China', 'United Kingdom', 'Belgium', 'Cayman Islands'];
    const colors = {
        'Japan': '#003D7A',
        'China': '#DC143C',
        'United Kingdom': '#2E8B57',
        'Belgium': '#FFDD00',
        'Cayman Islands': '#BA55D3'
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
                    max: 8,
                    title: {
                        display: true,
                        text: 'Percentage of Total US Debt (%)',
                        font: { size: 14, weight: 'bold' }
                    },
                    ticks: {
                        stepSize: 1,
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
