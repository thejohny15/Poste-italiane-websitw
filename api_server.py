"""
Simple Flask API server to fetch economic data
Fetches Core CPI, Headline CPI from FRED and Oil prices from Yahoo Finance
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
import requests
import re

app = Flask(__name__)
CORS(app)  # Enable CORS for browser requests

# FRED API - Register for free at https://fred.stlouisfed.org/docs/api/api_key.html
# For now, using public data endpoints
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

def fetch_fred_data(series_id, start_date, end_date, api_key="demo"):
    """Fetch data from FRED API"""
    try:
        params = {
            'series_id': series_id,
            'api_key': api_key,
            'file_type': 'json',
            'observation_start': start_date,
            'observation_end': end_date
        }
        response = requests.get(FRED_BASE, params=params)
        data = response.json()
        
        if 'observations' in data:
            return [(obs['date'], float(obs['value'])) for obs in data['observations'] if obs['value'] != '.']
        return []
    except Exception as e:
        print(f"Error fetching FRED data: {e}")
        return []

def calculate_monthly_change(data):
    """Calculate month-over-month percentage change"""
    if not data or len(data) < 2:
        return []
    
    changes = []
    for i in range(1, len(data)):
        prev_val = data[i-1][1]
        curr_val = data[i][1]
        if prev_val > 0:
            pct_change = ((curr_val - prev_val) / prev_val) * 100
            changes.append((data[i][0], round(pct_change, 2)))
    
    return changes

def fetch_oil_data(start_date, end_date):
    """Fetch WTI Crude Oil prices from Yahoo Finance"""
    try:
        oil = yf.Ticker("CL=F")  # WTI Crude Oil Futures
        df = oil.history(start=start_date, end=end_date, interval="1mo")
        
        if df.empty:
            return []
        
        # Calculate monthly percentage changes
        df['Pct_Change'] = df['Close'].pct_change() * 100
        
        # Filter out NaN values and create result list
        df_clean = df[df['Pct_Change'].notna()].copy()
        
        result = []
        for idx, row in df.iterrows():
            if pd.notna(row['Pct_Change']):
                # Convert index to string directly
                if isinstance(idx, pd.Timestamp):
                    date_str = idx.strftime('%Y-%m-%d')
                else:
                    date_str = str(idx)[:10]  # Take first 10 chars (YYYY-MM-DD)
                result.append((date_str, round(row['Pct_Change'], 2)))
        
        return result
    except Exception as e:
        print(f"Error fetching oil data: {e}")
        return []

@app.route('/api/economic-data', methods=['GET'])
def get_economic_data():
    """API endpoint to fetch all economic indicators"""
    start_date = request.args.get('start_date', '2006-01-01')
    end_date = request.args.get('end_date', datetime.now().strftime('%Y-%m-%d'))
    
    # Note: Replace 'demo' with your actual FRED API key
    # Get it free at: https://fred.stlouisfed.org/docs/api/api_key.html
    fred_api_key = "e1260575e1dbea9b426f27505c956e8b"  # Your FRED API key
    
    # Fetch CPI data from FRED
    # CPIAUCSL = All Items CPI (Headline)
    # CPILFESL = CPI Less Food & Energy (Core)
    
    core_cpi_data = fetch_fred_data('CPILFESL', start_date, end_date, fred_api_key)
    headline_cpi_data = fetch_fred_data('CPIAUCSL', start_date, end_date, fred_api_key)
    
    # Calculate monthly changes
    core_inflation = calculate_monthly_change(core_cpi_data)
    headline_inflation = calculate_monthly_change(headline_cpi_data)
    
    # Fetch oil data
    oil_data = fetch_oil_data(start_date, end_date)
    
    # Combine and format data
    # Create a unified date list
    all_dates = sorted(set([d[0] for d in core_inflation + headline_inflation + oil_data]))
    
    # Create dictionaries for easy lookup
    core_dict = dict(core_inflation)
    headline_dict = dict(headline_inflation)
    oil_dict = dict(oil_data)
    
    # Build response
    response_data = {
        'dates': [],
        'coreInflation': [],
        'headlineInflation': [],
        'oilPrices': []
    }
    
    for date in all_dates:
        # Convert to YYYY-MM format for consistency
        date_obj = datetime.strptime(date, '%Y-%m-%d')
        month_key = date_obj.strftime('%Y-%m')
        
        response_data['dates'].append(month_key)
        response_data['coreInflation'].append(core_dict.get(date, None))
        response_data['headlineInflation'].append(headline_dict.get(date, None))
        response_data['oilPrices'].append(oil_dict.get(date, None))
    
    return jsonify(response_data)

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'message': 'API server is running'})

@app.route('/api/foreign-holders', methods=['GET'])
def get_foreign_holders():
    """Fetch foreign holders data - properly parses the grid structure by year sections"""
    try:
        url = 'https://ticdata.treasury.gov/Publish/mfhhis01.txt'
        
        print(f"\nFetching foreign holders data from {url}")
        
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        text = response.text
        lines = text.split('\n')
        
        # Storage for all data
        all_data = {
            'Japan': [],
            'China': [],
            'United Kingdom': [],
            'Belgium': [],
            'Cayman Islands': []
        }
        
        country_patterns = {
            'Japan': 'Japan',
            'China': ['"China, Mainland"', 'China, Mainland'],
            'United Kingdom': 'United Kingdom',
            'Belgium': 'Belgium',
            'Cayman Islands': 'Cayman Islands'
        }
        
        # Find each year section by looking for "Country" keyword
        i = 0
        while i < len(lines):
            line = lines[i]
            
            # Check if this line contains "Country" - marks start of a year section
            if 'Country' in line and not line.strip().startswith('#'):
                print(f"\nFound 'Country' at line {i}")
                
                # Extract years from this line or next few lines
                years = []
                for j in range(i, min(i+3, len(lines))):
                    years_in_line = re.findall(r'\b(20\d{2}|19\d{2})\b', lines[j])
                    if years_in_line:
                        years = years_in_line
                        print(f"Found years: {years}")
                        break
                
                if not years:
                    i += 1
                    continue
                
                # Get the primary year for this section (usually first one)
                primary_year = years[0]
                
                # The months are typically: Dec, Nov, Oct, Sep, Aug, Jul, Jun, May, Apr, Mar, Feb, Jan
                # (in reverse chronological order)
                months = ['Dec', 'Nov', 'Oct', 'Sep', 'Aug', 'Jul', 'Jun', 'May', 'Apr', 'Mar', 'Feb', 'Jan']
                
                # Now parse country data in this section (next ~40 lines typically)
                section_end = min(i + 50, len(lines))
                
                for country_key, patterns in country_patterns.items():
                    pattern_list = patterns if isinstance(patterns, list) else [patterns]
                    
                    # Search for this country in the current section
                    for j in range(i+1, section_end):
                        data_line = lines[j]
                        
                        # Check if this line is for our country
                        if any(p in data_line for p in pattern_list):
                            print(f"Found {country_key} at line {j}")
                            
                            # Extract all numeric values (holdings in billions)
                            numbers = re.findall(r'\d+\.\d+', data_line)
                            values = [float(n) for n in numbers if float(n) > 40]
                            
                            print(f"  Extracted {len(values)} values: {values[:3]}...")
                            
                            # Match values to months (should be 12 values for 12 months)
                            for k in range(min(len(values), len(months))):
                                all_data[country_key].append({
                                    'date': f"{months[k]} {primary_year}",
                                    'holdings': values[k]
                                })
                            break
                
                # Move to next potential section
                i += 40
            else:
                i += 1
        
        # Remove duplicates and sort chronologically
        result = {}
        for country, data_list in all_data.items():
            # Remove duplicates by date (keep first occurrence)
            seen = {}
            for item in data_list:
                if item['date'] not in seen:
                    seen[item['date']] = item
            
            # Sort chronologically
            sorted_data = sorted(seen.values(), key=lambda x: datetime.strptime(x['date'], '%b %Y'))
            
            result[country] = sorted_data
            
            if sorted_data:
                print(f"{country}: {len(sorted_data)} data points, from {sorted_data[0]['date']} to {sorted_data[-1]['date']}")
            else:
                print(f"{country}: No data")
        
        return jsonify(result)
        
    except Exception as e:
        print(f"Error in foreign-holders endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/foreign-holders-percentage', methods=['GET'])
def get_foreign_holders_percentage():
    """Calculate foreign holdings as percentage of total US Treasury debt"""
    try:
        # Fetch total US Treasury debt
        treasury_url = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny'
        treasury_params = {
            'fields': 'record_date,tot_pub_debt_out_amt',
            'filter': 'record_date:gte:2006-01-01',
            'page[size]': 10000,
            'sort': '-record_date'
        }
        
        treasury_response = requests.get(treasury_url, params=treasury_params, timeout=30)
        treasury_response.raise_for_status()
        treasury_data = treasury_response.json()
        
        # Build dictionary of date -> total debt (in billions)
        total_debt_by_date = {}
        for item in treasury_data.get('data', []):
            date_str = item['record_date']
            debt_amt = float(item['tot_pub_debt_out_amt']) / 1_000_000_000  # Convert to billions
            # Convert to "Mon YYYY" format
            date_obj = datetime.strptime(date_str, '%Y-%m-%d')
            formatted_date = date_obj.strftime('%b %Y')
            total_debt_by_date[formatted_date] = debt_amt
        
        print(f"Loaded {len(total_debt_by_date)} total debt records")
        
        # Fetch foreign holders data (reuse logic from above)
        url = 'https://ticdata.treasury.gov/Publish/mfhhis01.txt'
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        text = response.text
        lines = text.split('\n')
        
        # Storage for all data
        all_data = {
            'Japan': [],
            'China': [],
            'United Kingdom': [],
            'Belgium': [],
            'Cayman Islands': []
        }
        
        country_patterns = {
            'Japan': 'Japan',
            'China': ['"China, Mainland"', 'China, Mainland'],
            'United Kingdom': 'United Kingdom',
            'Belgium': 'Belgium',
            'Cayman Islands': 'Cayman Islands'
        }
        
        # Parse foreign holders data
        i = 0
        while i < len(lines):
            line = lines[i]
            
            if 'Country' in line and not line.strip().startswith('#'):
                years = []
                for j in range(i, min(i+3, len(lines))):
                    years_in_line = re.findall(r'\b(20\d{2}|19\d{2})\b', lines[j])
                    if years_in_line:
                        years = years_in_line
                        break
                
                if not years:
                    i += 1
                    continue
                
                primary_year = years[0]
                months = ['Dec', 'Nov', 'Oct', 'Sep', 'Aug', 'Jul', 'Jun', 'May', 'Apr', 'Mar', 'Feb', 'Jan']
                section_end = min(i + 50, len(lines))
                
                for country_key, patterns in country_patterns.items():
                    pattern_list = patterns if isinstance(patterns, list) else [patterns]
                    
                    for j in range(i+1, section_end):
                        data_line = lines[j]
                        
                        if any(p in data_line for p in pattern_list):
                            numbers = re.findall(r'\d+\.\d+', data_line)
                            values = [float(n) for n in numbers if float(n) > 40]
                            
                            for k in range(min(len(values), len(months))):
                                all_data[country_key].append({
                                    'date': f"{months[k]} {primary_year}",
                                    'holdings': values[k]
                                })
                            break
                
                i += 40
            else:
                i += 1
        
        # Calculate percentages
        result = {}
        for country, data_list in all_data.items():
            # Remove duplicates
            seen = {}
            for item in data_list:
                if item['date'] not in seen:
                    seen[item['date']] = item
            
            # Calculate percentage for each date
            percentage_data = []
            for date, item in seen.items():
                if date in total_debt_by_date:
                    percentage = (item['holdings'] / total_debt_by_date[date]) * 100
                    percentage_data.append({
                        'date': date,
                        'percentage': round(percentage, 2)
                    })
            
            # Sort chronologically
            percentage_data.sort(key=lambda x: datetime.strptime(x['date'], '%b %Y'))
            result[country] = percentage_data
            
            if percentage_data:
                print(f"{country}: {len(percentage_data)} percentage points")
        
        return jsonify(result)
        
    except Exception as e:
        print(f"Error in foreign-holders-percentage endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    import sys
    print("Starting API server on http://localhost:5001")
    print("Get your free FRED API key at: https://fred.stlouisfed.org/docs/api/api_key.html")
    print("Update the fred_api_key variable in this file with your key")
    
    # Use debug=False when running in background to avoid terminal issues
    debug_mode = sys.stdin.isatty()
    app.run(debug=debug_mode, port=5001, host='127.0.0.1')
