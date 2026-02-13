"""
Simple Flask API server to fetch economic data
Fetches Core CPI, Headline CPI from FRED and Oil prices from Yahoo Finance
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import requests
import re
from io import StringIO

app = Flask(__name__)
CORS(app)  # Enable CORS for browser requests

# FRED API - Register for free at https://fred.stlouisfed.org/docs/api/api_key.html
# For now, using public data endpoints
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
# Replace with your FRED API key or set via environment in production
FRED_API_KEY = "e1260575e1dbea9b426f27505c956e8b"


def to_float_or_none(value):
    if value is None:
        return None
    v = str(value).strip().lower()
    if v in {'n.a.', 'n.a', 'na', '.', '-'}:
        return None
    try:
        return float(value)
    except ValueError:
        return None

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


def monthly_average_from_daily(series):
    """Convert daily (date, value) series to monthly average keyed by YYYY-MM."""
    buckets = {}
    for date_str, value in series:
        month_key = date_str[:7]
        buckets.setdefault(month_key, []).append(value)
    return {k: sum(v) / len(v) for k, v in buckets.items() if v}


def parse_slt3_holdings_text(text, country_names):
    """Parse TIC SLT table 3 (txt or html) and return long-term holdings by country/date."""
    data = {country: [] for country in country_names}

    alias_map = {}
    for country in country_names:
        key = country.strip().lower()
        alias_map[key] = country
        if country == 'China':
            alias_map['china, mainland'] = country
            alias_map['"china, mainland"'] = country

    def resolve_country(raw_country):
        raw = str(raw_country).strip().lower()
        raw = re.sub(r'\s+', ' ', raw)
        return alias_map.get(raw)

    # HTML source (slt_table3.html)
    if '<table' in text.lower() and '<td' in text.lower():
        try:
            tables = pd.read_html(StringIO(text))
            if tables:
                df = tables[0]
                first_col = df.iloc[:, 0].astype(str).str.strip().str.lower()
                header_rows = first_col[first_col == 'country'].index.tolist()
                start_idx = header_rows[0] + 1 if header_rows else 0
                body = df.iloc[start_idx:].copy()

                for row in body.itertuples(index=False):
                    if len(row) < 6:
                        continue
                    country = resolve_country(row[0])
                    if not country:
                        continue

                    date = str(row[2]).strip()
                    if not re.match(r'^\d{4}-\d{2}$', date):
                        continue

                    long_term_holdings_mn = to_float_or_none(row[5])
                    if long_term_holdings_mn is None:
                        continue
                    long_term_holdings = long_term_holdings_mn / 1000.0

                    data[country].append({'date': f"{date}-01", 'holdings': long_term_holdings})
                return data
        except Exception as e:
            print(f"Error parsing SLT HTML table: {e}")

    # TXT source (slt_table3.txt)
    line_pattern = re.compile(
        r'^(.*?)\s+\d+\s+(\d{4}-\d{2})\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)'
    )

    for raw_line in text.split('\n'):
        line = raw_line.strip()
        if not line:
            continue

        m = line_pattern.match(line)
        if not m:
            continue

        country = resolve_country(m.group(1))
        if not country:
            continue

        date = m.group(2)
        long_term_holdings_mn = to_float_or_none(m.group(5))
        if long_term_holdings_mn is None:
            continue
        long_term_holdings = long_term_holdings_mn / 1000.0

        data[country].append({'date': f"{date}-01", 'holdings': long_term_holdings})

    return data


def merge_historical_recent_maps(historical_map, recent_map, override_last_months=12):
    """
    Merge two date->value maps:
    - keep full historical baseline
    - overwrite with recent source for the last N months of historical overlap
    - always include dates that exist only in recent source (e.g. newest year)
    """
    if not historical_map:
        return dict(recent_map)
    if not recent_map:
        return dict(historical_map)

    merged = dict(historical_map)
    max_hist = max(pd.to_datetime(list(historical_map.keys())))
    cutoff_ts = max_hist - pd.DateOffset(months=max(override_last_months - 1, 0))
    cutoff = cutoff_ts.strftime('%Y-%m-%d')

    for date, value in recent_map.items():
        if date not in merged or date >= cutoff:
            merged[date] = value

    return merged

def parse_tic_text(text, country_patterns):
    month_map = {
        'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
        'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
    }
    data = {key: [] for key in country_patterns.keys()}
    lines = text.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]
        if 'Country' in line and not line.strip().startswith('#'):
            date_tokens = re.findall(r'\b\d{4}-\d{2}\b', line)
            dates = []
            if date_tokens:
                dates = [f"{d}-01" for d in date_tokens]
            else:
                months = []
                years = []
                for j in range(i, min(i + 6, len(lines))):
                    months = re.findall(r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b', lines[j])
                    if len(months) >= 6:
                        break
                for j in range(i, min(i + 6, len(lines))):
                    years = re.findall(r'\b(?:19|20)\d{2}\b', lines[j])
                    if years:
                        break
                if years:
                    fixed_months = ['Dec', 'Nov', 'Oct', 'Sep', 'Aug', 'Jul', 'Jun', 'May', 'Apr', 'Mar', 'Feb', 'Jan']
                    if len(years) >= len(fixed_months):
                        years = years[:len(fixed_months)]
                    else:
                        years = [years[0]] * len(fixed_months)
                    dates = [f"{year}-{month_map[month]:02d}-01" for month, year in zip(fixed_months, years)]
                elif months and years and len(months) == len(years):
                    dates = [f"{year}-{month_map[month]:02d}-01" for month, year in zip(months, years)]

            if not dates:
                i += 1
                continue

            j = i + 1
            while j < len(lines):
                data_line = lines[j]
                if not data_line.strip() or data_line.strip().startswith('Of which'):
                    break
                if 'Country' in data_line and j != i:
                    break

                number_matches = list(re.finditer(r'\d+\.\d+', data_line))
                if not number_matches:
                    j += 1
                    continue

                country_name = data_line[:number_matches[0].start()].strip()
                for country_key, patterns in country_patterns.items():
                    pattern_list = patterns if isinstance(patterns, list) else [patterns]
                    if any(p in country_name for p in pattern_list):
                        values = [float(m.group()) for m in number_matches]
                        for idx, date in enumerate(dates[:len(values)]):
                            data[country_key].append({
                                'date': date,
                                'holdings': values[idx]
                            })
                        break
                j += 1
            i = j
        else:
            i += 1
    return data

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
    fred_api_key = FRED_API_KEY
    
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
        historical_url = 'https://ticdata.treasury.gov/Publish/mfhhis01.txt'
        recent_url = 'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.html'
        
        # Storage for historical + recent data separately
        hist_data = {
            'Japan': [],
            'China': [],
            'United Kingdom': [],
            'Belgium': [],
            'Luxembourg': [],
            'France': [],
            'Ireland': [],
            'Norway': [],
            'Germany': [],
            'Spain': [],
            'Italy': []
        }
        recent_data = {k: [] for k in hist_data.keys()}
        
        country_patterns = {
            'Japan': 'Japan',
            'China': ['"China, Mainland"', 'China, Mainland'],
            'United Kingdom': 'United Kingdom',
            'Belgium': 'Belgium',
            'Luxembourg': 'Luxembourg',
            'France': 'France',
            'Ireland': 'Ireland',
            'Norway': 'Norway',
            'Germany': 'Germany',
            'Spain': 'Spain',
            'Italy': 'Italy'
        }
        
        try:
            print(f"\nFetching foreign holders data from {historical_url}")
            response = requests.get(historical_url, timeout=30)
            response.raise_for_status()
            parsed_hist = parse_tic_text(response.text, country_patterns)
            for country_key in hist_data.keys():
                hist_data[country_key].extend(parsed_hist.get(country_key, []))
        except Exception as e:
            print(f"Error fetching from {historical_url}: {e}")

        try:
            print(f"\nFetching foreign holders data from {recent_url}")
            response = requests.get(recent_url, timeout=30)
            response.raise_for_status()
            parsed_recent = parse_slt3_holdings_text(response.text, list(recent_data.keys()))
            for country_key in recent_data.keys():
                recent_data[country_key].extend(parsed_recent.get(country_key, []))
        except Exception as e:
            print(f"Error fetching from {recent_url}: {e}")
        
        euro_components = ['Belgium', 'Luxembourg', 'France', 'Ireland', 'Norway', 'Germany', 'Spain', 'Italy']

        def normalize_data(data_list):
            seen = {}
            for item in data_list:
                if item['date'] not in seen:
                    seen[item['date']] = item['holdings']
            return seen

        merged_country_maps = {}
        for country in hist_data.keys():
            hist_map = normalize_data(hist_data.get(country, []))
            rec_map = normalize_data(recent_data.get(country, []))
            merged_country_maps[country] = merge_historical_recent_maps(hist_map, rec_map, override_last_months=12)

        component_maps = [merged_country_maps.get(component, {}) for component in euro_components]
        all_dates = sorted(set().union(*(set(m.keys()) for m in component_maps))) if component_maps else []

        euro_zone_map = {}
        for date in all_dates:
            available_values = [m[date] for m in component_maps if date in m]
            if available_values:
                euro_zone_map[date] = sum(available_values)

        result = {}
        for country in ['Japan', 'China', 'United Kingdom']:
            country_map = merged_country_maps.get(country, {})
            sorted_data = sorted(
                [{'date': d, 'holdings': v} for d, v in country_map.items()],
                key=lambda x: datetime.strptime(x['date'], '%Y-%m-%d')
            )
            result[country] = sorted_data

        euro_sorted = sorted(
            [{'date': d, 'holdings': v} for d, v in euro_zone_map.items()],
            key=lambda x: datetime.strptime(x['date'], '%Y-%m-%d')
        )
        result['Euro Zone'] = euro_sorted

        for country, data_list in result.items():
            if data_list:
                print(f"{country}: {len(data_list)} data points, from {data_list[0]['date']} to {data_list[-1]['date']}")
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
        # Fetch total US public debt from FRED (GFDEBTN, in millions of dollars)
        end_date = datetime.utcnow().strftime('%Y-%m-%d')
        fred_debt_data = fetch_fred_data('GFDEBTN', '2000-01-01', end_date, FRED_API_KEY)
        
        # Build dictionary of date -> total debt (in billions)
        total_debt_by_date = {
            date: value / 1000 for date, value in fred_debt_data
        }

        # Prepare sorted debt dates for forward-fill
        debt_dates_sorted = sorted(total_debt_by_date.keys())

        def get_debt_for_date(target_date):
            # Return exact match if available
            if target_date in total_debt_by_date:
                return total_debt_by_date[target_date]
            # Forward-fill from the most recent prior date
            for date in reversed(debt_dates_sorted):
                if date <= target_date:
                    return total_debt_by_date[date]
            return None
        
        print(f"Loaded {len(total_debt_by_date)} total debt records from FRED")
        
        historical_url = 'https://ticdata.treasury.gov/Publish/mfhhis01.txt'
        recent_url = 'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.html'
        
        # Storage for historical + recent data separately
        hist_data = {
            'Japan': [],
            'China': [],
            'United Kingdom': [],
            'Belgium': [],
            'Luxembourg': [],
            'France': [],
            'Ireland': [],
            'Norway': [],
            'Germany': [],
            'Spain': [],
            'Italy': []
        }
        recent_data = {k: [] for k in hist_data.keys()}
        
        country_patterns = {
            'Japan': 'Japan',
            'China': ['"China, Mainland"', 'China, Mainland'],
            'United Kingdom': 'United Kingdom',
            'Belgium': 'Belgium',
            'Luxembourg': 'Luxembourg',
            'France': 'France',
            'Ireland': 'Ireland',
            'Norway': 'Norway',
            'Germany': 'Germany',
            'Spain': 'Spain',
            'Italy': 'Italy'
        }
        
        try:
            response = requests.get(historical_url, timeout=30)
            response.raise_for_status()
            parsed_hist = parse_tic_text(response.text, country_patterns)
            for country_key in hist_data.keys():
                hist_data[country_key].extend(parsed_hist.get(country_key, []))
        except Exception as e:
            print(f"Error fetching from {historical_url}: {e}")

        try:
            response = requests.get(recent_url, timeout=30)
            response.raise_for_status()
            parsed_recent = parse_slt3_holdings_text(response.text, list(recent_data.keys()))
            for country_key in recent_data.keys():
                recent_data[country_key].extend(parsed_recent.get(country_key, []))
        except Exception as e:
            print(f"Error fetching from {recent_url}: {e}")
        
        euro_components = ['Belgium', 'Luxembourg', 'France', 'Ireland', 'Norway', 'Germany', 'Spain', 'Italy']

        def normalize_data(data_list):
            seen = {}
            for item in data_list:
                if item['date'] not in seen:
                    seen[item['date']] = item['holdings']
            return seen

        merged_country_maps = {}
        for country in hist_data.keys():
            hist_map = normalize_data(hist_data.get(country, []))
            rec_map = normalize_data(recent_data.get(country, []))
            merged_country_maps[country] = merge_historical_recent_maps(hist_map, rec_map, override_last_months=12)

        component_maps = [merged_country_maps.get(component, {}) for component in euro_components]
        all_dates = sorted(set().union(*(set(m.keys()) for m in component_maps))) if component_maps else []

        euro_zone_map = {}
        for date in all_dates:
            available_values = [m[date] for m in component_maps if date in m]
            if available_values:
                euro_zone_map[date] = sum(available_values)

        result = {}
        for country in ['Japan', 'China', 'United Kingdom']:
            country_map = merged_country_maps.get(country, {})
            percentage_data = []
            for date, value in country_map.items():
                debt_value = get_debt_for_date(date)
                if debt_value is not None:
                    percentage = (value / debt_value) * 100
                    percentage_data.append({
                        'date': date,
                        'percentage': round(percentage, 2)
                    })
            percentage_data.sort(key=lambda x: datetime.strptime(x['date'], '%Y-%m-%d'))
            result[country] = percentage_data

        euro_percentage = []
        for date, value in euro_zone_map.items():
            debt_value = get_debt_for_date(date)
            if debt_value is not None:
                percentage = (value / debt_value) * 100
                euro_percentage.append({
                    'date': date,
                    'percentage': round(percentage, 2)
                })
        euro_percentage.sort(key=lambda x: datetime.strptime(x['date'], '%Y-%m-%d'))
        result['Euro Zone'] = euro_percentage

        for country, percentage_data in result.items():
            if percentage_data:
                print(f"{country}: {len(percentage_data)} percentage points")
        
        return jsonify(result)
        
    except Exception as e:
        print(f"Error in foreign-holders-percentage endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/euro-zone-component-shares', methods=['GET'])
def get_euro_zone_component_shares():
    """Return Euro Zone component holdings as % share of total Euro Zone holdings."""
    try:
        historical_url = 'https://ticdata.treasury.gov/Publish/mfhhis01.txt'
        recent_url = 'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.html'

        euro_components = ['Belgium', 'Luxembourg', 'France', 'Ireland', 'Norway', 'Germany', 'Spain', 'Italy']

        hist_data = {country: [] for country in euro_components}
        recent_data = {country: [] for country in euro_components}
        country_patterns = {country: country for country in euro_components}

        try:
            response = requests.get(historical_url, timeout=30)
            response.raise_for_status()
            parsed_hist = parse_tic_text(response.text, country_patterns)
            for country in euro_components:
                hist_data[country].extend(parsed_hist.get(country, []))
        except Exception as e:
            print(f"Error fetching from {historical_url}: {e}")

        try:
            response = requests.get(recent_url, timeout=30)
            response.raise_for_status()
            parsed_recent = parse_slt3_holdings_text(response.text, euro_components)
            for country in euro_components:
                recent_data[country].extend(parsed_recent.get(country, []))
        except Exception as e:
            print(f"Error fetching from {recent_url}: {e}")

        def normalize_data(data_list):
            seen = {}
            for item in data_list:
                if item['date'] not in seen:
                    seen[item['date']] = item['holdings']
            return seen

        component_maps = {}
        for country in euro_components:
            hist_map = normalize_data(hist_data[country])
            rec_map = normalize_data(recent_data[country])
            component_maps[country] = merge_historical_recent_maps(hist_map, rec_map, override_last_months=12)

        # Use union of dates so series starts as early as possible.
        # Countries appear later naturally when their data becomes available.
        all_dates = sorted(set().union(*(set(m.keys()) for m in component_maps.values()))) if component_maps else []

        result = {country: [] for country in euro_components}
        for date in all_dates:
            available = {c: component_maps[c][date] for c in euro_components if date in component_maps[c]}
            total = sum(available.values())
            if not total:
                continue

            for country, value in available.items():
                share = (value / total) * 100.0
                result[country].append({'date': date, 'percentage': round(share, 2)})

        for country in euro_components:
            result[country].sort(key=lambda x: datetime.strptime(x['date'], '%Y-%m-%d'))

        return jsonify(result)

    except Exception as e:
        print(f"Error in euro-zone-component-shares endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/treasury-net-sales-japan', methods=['GET'])
def get_treasury_net_sales_japan():
    """Fetch Japan net U.S. sales and valuation change from TIC SLT Table 3"""
    try:
        url = 'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.txt'
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        lines = response.text.split('\n')
        data = []
        pattern = re.compile(
            r'^Japan\s+\d+\s+(\d{4}-\d{2})\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)'
        )

        def to_float_or_none(value):
            if value is None:
                return None
            v = str(value).strip().lower()
            if v in {'n.a.', 'n.a', 'na', '.', '-'}:
                return None
            try:
                return float(value)
            except ValueError:
                return None

        for line in lines:
            match = pattern.match(line.strip())
            if not match:
                continue

            date = match.group(1)
            # Columns: total holdings, total net, long-term holdings, long-term net, long-term valchg, short-term holdings, short-term net
            long_term_holdings = to_float_or_none(match.group(4))
            long_term_net = to_float_or_none(match.group(5))
            long_term_valchg = to_float_or_none(match.group(6))

            if long_term_holdings is None:
                continue

            data.append({
                'date': date,
                'holdings': long_term_holdings,
                'net_sales': long_term_net,
                'valuation_change': long_term_valchg
            })

        data.sort(key=lambda x: x['date'])

        # Compute holdings using H_t = H_{t-1} + net_sales + valuation_change
        prev_holdings = None
        for item in data:
            if prev_holdings is None or item['net_sales'] is None or item['valuation_change'] is None:
                item['holdings_computed'] = None
            else:
                item['holdings_computed'] = prev_holdings + item['net_sales'] + item['valuation_change']
            prev_holdings = item['holdings']

        return jsonify(data)

    except Exception as e:
        print(f"Error in treasury-net-sales-japan endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/treasury-net-sales-china', methods=['GET'])
def get_treasury_net_sales_china():
    """Fetch China net U.S. sales and valuation change from TIC SLT Table 3"""
    try:
        url = 'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.txt'
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        lines = response.text.split('\n')
        data = []
        pattern = re.compile(
            r'^"?China, Mainland"?\s+\d+\s+(\d{4}-\d{2})\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)'
        )

        for line in lines:
            match = pattern.match(line.strip())
            if not match:
                continue

            date = match.group(1)
            long_term_holdings = to_float_or_none(match.group(4))
            long_term_net = to_float_or_none(match.group(5))
            long_term_valchg = to_float_or_none(match.group(6))

            if long_term_holdings is None:
                continue

            data.append({
                'date': date,
                'holdings': long_term_holdings,
                'net_sales': long_term_net,
                'valuation_change': long_term_valchg
            })

        data.sort(key=lambda x: x['date'])

        prev_holdings = None
        for item in data:
            if prev_holdings is None or item['net_sales'] is None or item['valuation_change'] is None:
                item['holdings_computed'] = None
            else:
                item['holdings_computed'] = prev_holdings + item['net_sales'] + item['valuation_change']
            prev_holdings = item['holdings']

        return jsonify(data)

    except Exception as e:
        print(f"Error in treasury-net-sales-china endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/treasury-net-sales-uk', methods=['GET'])
def get_treasury_net_sales_uk():
    """Fetch UK net U.S. sales and valuation change from TIC SLT Table 3"""
    try:
        url = 'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.txt'
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        lines = response.text.split('\n')
        data = []
        pattern = re.compile(
            r'^United Kingdom\s+\d+\s+(\d{4}-\d{2})\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)'
        )

        for line in lines:
            match = pattern.match(line.strip())
            if not match:
                continue

            date = match.group(1)
            long_term_holdings = to_float_or_none(match.group(4))
            long_term_net = to_float_or_none(match.group(5))
            long_term_valchg = to_float_or_none(match.group(6))

            if long_term_holdings is None:
                continue

            data.append({
                'date': date,
                'holdings': long_term_holdings,
                'net_sales': long_term_net,
                'valuation_change': long_term_valchg
            })

        data.sort(key=lambda x: x['date'])

        prev_holdings = None
        for item in data:
            if prev_holdings is None or item['net_sales'] is None or item['valuation_change'] is None:
                item['holdings_computed'] = None
            else:
                item['holdings_computed'] = prev_holdings + item['net_sales'] + item['valuation_change']
            prev_holdings = item['holdings']

        return jsonify(data)

    except Exception as e:
        print(f"Error in treasury-net-sales-uk endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/treasury-net-sales-euro-zone', methods=['GET'])
def get_treasury_net_sales_euro_zone():
    """Fetch Euro Zone net U.S. sales and valuation change from TIC SLT Table 3"""
    try:
        url = 'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.txt'
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        lines = response.text.split('\n')
        pattern = re.compile(
            r'^(Belgium|Luxembourg|France|Ireland|Norway|Germany|Spain|Italy)\s+\d+\s+(\d{4}-\d{2})\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)'
        )

        aggregated = {}

        for line in lines:
            match = pattern.match(line.strip())
            if not match:
                continue

            date = match.group(2)
            long_term_holdings = to_float_or_none(match.group(5))
            long_term_net = to_float_or_none(match.group(6))
            long_term_valchg = to_float_or_none(match.group(7))

            if long_term_holdings is None:
                continue

            if date not in aggregated:
                aggregated[date] = {
                    'date': date,
                    'holdings': 0.0,
                    'net_sales': 0.0,
                    'valuation_change': 0.0,
                    '_net_count': 0,
                    '_val_count': 0
                }

            aggregated[date]['holdings'] += long_term_holdings
            if long_term_net is not None:
                aggregated[date]['net_sales'] += long_term_net
                aggregated[date]['_net_count'] += 1
            if long_term_valchg is not None:
                aggregated[date]['valuation_change'] += long_term_valchg
                aggregated[date]['_val_count'] += 1

        data = list(aggregated.values())
        data.sort(key=lambda x: x['date'])

        for item in data:
            item['net_sales'] = item['net_sales'] if item['_net_count'] > 0 else None
            item['valuation_change'] = item['valuation_change'] if item['_val_count'] > 0 else None
            item.pop('_net_count', None)
            item.pop('_val_count', None)

        prev_holdings = None
        for item in data:
            if prev_holdings is None or item['net_sales'] is None or item['valuation_change'] is None:
                item['holdings_computed'] = None
            else:
                item['holdings_computed'] = prev_holdings + item['net_sales'] + item['valuation_change']
            prev_holdings = item['holdings']

        return jsonify(data)

    except Exception as e:
        print(f"Error in treasury-net-sales-euro-zone endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/japan-estimated-decomposition', methods=['GET'])
def get_japan_estimated_decomposition():
    """
    Estimate Japan valuation changes for periods without TIC flow decomposition,
    calibrating sensitivity to yield changes on a training window and leaving
    the most recent observed months as holdout for validation.
    """
    try:
        holdout_months = int(request.args.get('holdout_months', 15))
        holdout_months = max(1, holdout_months)
        lambda_reg = float(request.args.get('lambda_reg', 0.25))
        lambda_reg = max(0.0, lambda_reg)

        # Fixed duration assumptions; weights are calibrated under constraints:
        # w_i >= 0 and sum_i w_i = 1
        durations = {
            '2y': 1.9,
            '10y': 8.5,
            '20y': 15.0,
            '30y': 19.0,
        }
        base_weights = np.array([0.55, 0.35, 0.05, 0.05], dtype=float)

        def project_to_simplex(v):
            """Project vector v onto simplex {w >= 0, sum(w)=1}."""
            if np.all(v >= 0) and np.isclose(np.sum(v), 1.0):
                return v
            u = np.sort(v)[::-1]
            cssv = np.cumsum(u)
            rho = np.where(u * np.arange(1, len(u) + 1) > (cssv - 1))[0]
            if len(rho) == 0:
                return np.ones_like(v) / len(v)
            rho = rho[-1]
            theta = (cssv[rho] - 1.0) / (rho + 1)
            w = np.maximum(v - theta, 0)
            s = np.sum(w)
            return (w / s) if s > 0 else (np.ones_like(v) / len(v))

        # 1) Pull Japan holdings + observed decomposition from TIC SLT table 3
        url = 'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.txt'
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        pattern = re.compile(
            r'^Japan\s+\d+\s+(\d{4}-\d{2})\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)'
        )

        rows = []
        for line in response.text.split('\n'):
            m = pattern.match(line.strip())
            if not m:
                continue

            date = m.group(1)
            holdings = to_float_or_none(m.group(4))
            net_sales = to_float_or_none(m.group(5))
            valuation_change = to_float_or_none(m.group(6))
            if holdings is None:
                continue

            rows.append({
                'date': date,
                'holdings': holdings,
                'actual_net_sales': net_sales,
                'actual_valuation_change': valuation_change,
            })

        rows.sort(key=lambda x: x['date'])
        if not rows:
            return jsonify([])

        # 2) Pull Treasury yields from FRED and build monthly averages
        start_date = f"{rows[0]['date']}-01"
        end_date = datetime.utcnow().strftime('%Y-%m-%d')

        y2 = monthly_average_from_daily(fetch_fred_data('DGS2', start_date, end_date, FRED_API_KEY))
        y10 = monthly_average_from_daily(fetch_fred_data('DGS10', start_date, end_date, FRED_API_KEY))
        y20 = monthly_average_from_daily(fetch_fred_data('DGS20', start_date, end_date, FRED_API_KEY))
        y30 = monthly_average_from_daily(fetch_fred_data('DGS30', start_date, end_date, FRED_API_KEY))

        # 3) Prepare full monthly feature table
        result = []
        prev_holdings = None
        prev_month = None

        for r in rows:
            month = r['date']
            holdings = r['holdings']
            delta_holdings = None if prev_holdings is None else holdings - prev_holdings

            dy2 = dy10 = dy20 = dy30 = None
            if prev_month is not None:
                needed = [month, prev_month]
                have_all = all(m in y2 and m in y10 and m in y20 and m in y30 for m in needed)
                if have_all:
                    dy2 = (y2[month] - y2[prev_month]) / 100.0
                    dy10 = (y10[month] - y10[prev_month]) / 100.0
                    dy20 = (y20[month] - y20[prev_month]) / 100.0
                    dy30 = (y30[month] - y30[prev_month]) / 100.0

            result.append({
                'date': month,
                'holdings': holdings,
                'delta_holdings': delta_holdings,
                'dy2': dy2,
                'dy10': dy10,
                'dy20': dy20,
                'dy30': dy30,
                'actual_net_sales': r['actual_net_sales'],
                'actual_valuation_change': r['actual_valuation_change'],
            })

            prev_holdings = holdings
            prev_month = month

        # 4) Build observed sample where actual decomposition exists
        observed = []
        for i, item in enumerate(result):
            if i == 0:
                continue
            if item['actual_net_sales'] is None or item['actual_valuation_change'] is None:
                continue
            if any(item[k] is None for k in ['dy2', 'dy10', 'dy20', 'dy30']):
                continue
            lag_holdings = result[i - 1]['holdings']
            if lag_holdings is None or lag_holdings == 0:
                continue

            # Target is valuation return scaled by prior holdings
            y_val = item['actual_valuation_change'] / lag_holdings
            x_val = [1.0, item['dy2'], item['dy10'], item['dy20'], item['dy30']]
            observed.append((i, x_val, y_val))

        if len(observed) < 8:
            return jsonify({'error': 'Not enough observed months to calibrate model'}), 400

        effective_holdout = min(holdout_months, max(1, len(observed) - 6))
        split = len(observed) - effective_holdout
        train_obs = observed[:split]
        holdout_obs = observed[split:]

        train_indices = {i for i, _, _ in train_obs}
        train_months = {result[i]['date'] for i, _, _ in train_obs}
        holdout_months_set = {result[i]['date'] for i, _, _ in holdout_obs}

        # 5) Dynamic state-like model (online, constrained weights)
        # w_t is updated only on training months using observed valuation,
        # then frozen on holdout/inference months.
        w = base_weights.copy()
        lr = 0.6
        inner_steps = 80
        lambda_anchor = lambda_reg         # pull toward prior/base weights
        lambda_smooth = 2.0 * lambda_reg   # smooth state transition

        model_name = 'dynamic_constrained_weights_v1'

        errors_train = []
        errors_holdout = []
        sign_hits_train = []
        sign_hits_holdout = []

        for i, item in enumerate(result):
            est_valuation = None
            implied_net_sales = None
            weighted_return = None
            z = None

            if i > 0 and all(item[k] is not None for k in ['dy2', 'dy10', 'dy20', 'dy30']):
                lag_holdings = result[i - 1]['holdings']
                if lag_holdings is not None:
                    z = np.array([
                        -durations['2y'] * item['dy2'],
                        -durations['10y'] * item['dy10'],
                        -durations['20y'] * item['dy20'],
                        -durations['30y'] * item['dy30'],
                    ], dtype=float)

                    # Update only on training months with observed valuation
                    if i in train_indices and item['actual_valuation_change'] is not None and lag_holdings != 0:
                        y_obs = item['actual_valuation_change'] / lag_holdings
                        w_prev = w.copy()

                        for _ in range(inner_steps):
                            pred = float(z @ w)
                            grad = (
                                2.0 * (pred - y_obs) * z
                                + 2.0 * lambda_anchor * (w - base_weights)
                                + 2.0 * lambda_smooth * (w - w_prev)
                            )
                            w = project_to_simplex(w - lr * grad)

                    weighted_return = float(z @ w)
                    est_valuation = lag_holdings * weighted_return
                    if item['delta_holdings'] is not None:
                        implied_net_sales = item['delta_holdings'] - est_valuation

            item['weighted_price_return_pct'] = None if weighted_return is None else weighted_return * 100.0
            item['estimated_valuation_change'] = est_valuation
            item['implied_net_sales'] = implied_net_sales

            if item['date'] in train_months:
                item['model_segment'] = 'train'
            elif item['date'] in holdout_months_set:
                item['model_segment'] = 'holdout'
            else:
                item['model_segment'] = 'inference'

            if item['actual_valuation_change'] is not None and est_valuation is not None:
                err = item['actual_valuation_change'] - est_valuation
                item['valuation_error'] = err

                if item['model_segment'] == 'train':
                    errors_train.append(abs(err))
                    sign_hits_train.append(int(np.sign(item['actual_valuation_change']) == np.sign(est_valuation)))
                elif item['model_segment'] == 'holdout':
                    errors_holdout.append(abs(err))
                    sign_hits_holdout.append(int(np.sign(item['actual_valuation_change']) == np.sign(est_valuation)))
            else:
                item['valuation_error'] = None

            # Expose current effective coefficients and state
            b2 = -w[0] * durations['2y']
            b10 = -w[1] * durations['10y']
            b20 = -w[2] * durations['20y']
            b30 = -w[3] * durations['30y']

            item['calibrated_coefficients'] = {
                'intercept': 0.0,
                'beta_2y': float(b2),
                'beta_10y': float(b10),
                'beta_20y': float(b20),
                'beta_30y': float(b30),
                'holdout_months': effective_holdout,
                'lambda_reg': lambda_reg,
            }
            item['calibrated_weights'] = {
                'w_2y': float(w[0]),
                'w_10y': float(w[1]),
                'w_20y': float(w[2]),
                'w_30y': float(w[3]),
            }
            item['duration_assumptions'] = durations
            item['model_name'] = model_name

        # Model quality summary (added to all rows for easy frontend use)
        summary = {
            'train_mae': (float(np.mean(errors_train)) if errors_train else None),
            'holdout_mae': (float(np.mean(errors_holdout)) if errors_holdout else None),
            'train_sign_hit_rate': (float(np.mean(sign_hits_train)) if sign_hits_train else None),
            'holdout_sign_hit_rate': (float(np.mean(sign_hits_holdout)) if sign_hits_holdout else None),
            'train_points': len(errors_train),
            'holdout_points': len(errors_holdout),
            'holdout_months': effective_holdout,
            'lambda_reg': lambda_reg,
            'model_name': model_name,
        }
        for item in result:
            item['model_summary'] = summary

        # Add YoY delta: H_t - H_{t-12}
        for i, item in enumerate(result):
            if i >= 12:
                prior = result[i - 12]['holdings']
                item['delta_holdings_yoy'] = item['holdings'] - prior if prior is not None else None
            else:
                item['delta_holdings_yoy'] = None

        return jsonify(result)

    except Exception as e:
        print(f"Error in japan-estimated-decomposition endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    import sys
    print("Starting API server on http://localhost:5001")
    print("Get your free FRED API key at: https://fred.stlouisfed.org/docs/api/api_key.html")
    print("Update the fred_api_key variable in this file with your key")
    
    # Keep debug logs in terminal, but disable reloader to avoid duplicate processes
    # that can leave port 5001 occupied after interrupted runs.
    debug_mode = sys.stdin.isatty()
    app.run(debug=debug_mode, use_reloader=False, port=5001, host='127.0.0.1')
