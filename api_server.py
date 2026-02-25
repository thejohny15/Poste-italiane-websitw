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
import json
from io import StringIO
import time
from typing import Any
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

app = Flask(__name__)
CORS(app)  # Enable CORS for browser requests

DATA_CACHE: dict[str, Any] = {
    'us_equity_holders': None,
    'us_equity_holders_percentage': None,
    'us_equity_holders_percentage_sp500': None,
    'us_equity_updated_at': None,
}

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


def parse_slt1_equity_holdings_text(text, country_names):
    """Parse TIC SLT Table 1 and return U.S. corporate equity holdings by country/date (billions USD)."""
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

    # Preferred: HTML parsing (slt_table1.html)
    if '<table' in text.lower() and '<td' in text.lower():
        try:
            tables = pd.read_html(StringIO(text))
            if tables:
                df = tables[0]
                first_col = df.iloc[:, 0].astype(str).str.strip().str.lower()
                header_rows = first_col[first_col == 'country'].index.tolist()
                start_idx = header_rows[0] + 2 if header_rows else 0
                body = df.iloc[start_idx:].copy()

                for row in body.itertuples(index=False):
                    if len(row) < 16:
                        continue

                    country = resolve_country(row[0])
                    if not country:
                        continue

                    date = str(row[2]).strip()
                    if not re.match(r'^\d{4}-\d{2}$', date):
                        continue

                    equity_mn = to_float_or_none(row[15])
                    if equity_mn is None:
                        continue

                    data[country].append({'date': f"{date}-01", 'holdings': equity_mn / 1000.0})

                return data
        except Exception as e:
            print(f"Error parsing SLT Table 1 HTML: {e}")

    # Fallback: TXT parsing
    line_pattern = re.compile(
        r'^(.*?)\s+\d+\s+(\d{4}-\d{2})\s+'  # country, date
        r'(?:\S+\s+){12}'                        # skip first 12 numeric fields
        r'(\S+)\s+\S+\s+\S+$'              # equity holdings, then net, then valuation
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
        equity_mn = to_float_or_none(m.group(3))
        if equity_mn is None:
            continue

        data[country].append({'date': f"{date}-01", 'holdings': equity_mn / 1000.0})

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


def fetch_text_with_retries(urls, timeout=30, retries=3, backoff_seconds=1.5):
    """Fetch text from a list of URLs with retries, returning first successful response text."""
    if isinstance(urls, str):
        urls = [urls]

    last_error = None
    for url in urls:
        for attempt in range(1, retries + 1):
            try:
                response = requests.get(url, timeout=timeout)
                response.raise_for_status()
                return response.text
            except Exception as e:
                last_error = e
                print(f"Fetch failed for {url} (attempt {attempt}/{retries}): {e}")
                if attempt < retries:
                    time.sleep(backoff_seconds * attempt)

    raise RuntimeError(f"Failed to fetch URLs after retries: {urls}; last_error={last_error}")


def fetch_crsp_total_market_denom_map(total_foreign_map, start_date='2020-01-01'):
    """
    Build monthly denominator in billions USD from CRSP US Total Market Index levels.
    We anchor the index to the latest month where total foreign-held equity is available:
        denom_t = total_foreign_anchor * (CRSP_t / CRSP_anchor)
    """
    if not total_foreign_map:
        raise RuntimeError('Total foreign equity map is empty; cannot anchor CRSP denominator')

    df = yf.Ticker('^CRSPTM1').history(start=start_date, interval='1mo')
    if df.empty or 'Close' not in df.columns:
        # Alternate symbol fallback if needed
        df = yf.Ticker('^CRSPTMT').history(start=start_date, interval='1mo')

    if df.empty or 'Close' not in df.columns:
        raise RuntimeError('Unable to fetch CRSP US Total Market Index monthly levels')

    levels = {}
    for idx, row in df.iterrows():
        if pd.isna(row['Close']):
            continue
        date_key = idx.strftime('%Y-%m-01') if isinstance(idx, pd.Timestamp) else str(idx)[:7] + '-01'
        levels[date_key] = float(row['Close'])

    if not levels:
        raise RuntimeError('CRSP US Total Market Index levels are empty after cleaning')

    common_dates = sorted(set(total_foreign_map.keys()).intersection(levels.keys()))
    if not common_dates:
        raise RuntimeError('No overlapping dates between total foreign equity and CRSP index')

    anchor_date = common_dates[-1]
    anchor_total = total_foreign_map[anchor_date]
    anchor_level = levels[anchor_date]

    if anchor_level == 0:
        raise RuntimeError('CRSP anchor level is zero')

    return {date: anchor_total * (level / anchor_level) for date, level in levels.items()}


def fetch_sp500_market_cap_denom_map(start_date='2020-01-01'):
    """
    Build monthly S&P 500 market-cap proxy (billions USD).
    Method: scrape latest S&P 500 total market cap anchor from Slickcharts,
    then scale monthly ^GSPC index levels by that anchor.
    """
    anchor_cap_b = 62000.0  # fallback in billions USD

    try:
        page = requests.get('https://www.slickcharts.com/sp500', timeout=30).text
        m = re.search(r'total market cap[^$]*\$\s*([\d,.]+)\s*T', page, flags=re.I)
        if m:
            anchor_cap_b = float(m.group(1).replace(',', '')) * 1000.0
    except Exception as e:
        print(f"S&P 500 market cap anchor fetch failed, using fallback: {e}")

    df = yf.Ticker('^GSPC').history(start=start_date, interval='1mo')
    if df.empty or 'Close' not in df.columns:
        raise RuntimeError('Unable to fetch S&P 500 (^GSPC) monthly levels')

    levels = {}
    for idx, row in df.iterrows():
        if pd.isna(row['Close']):
            continue
        date_key = idx.strftime('%Y-%m-01') if isinstance(idx, pd.Timestamp) else str(idx)[:7] + '-01'
        levels[date_key] = float(row['Close'])

    if not levels:
        raise RuntimeError('S&P 500 levels are empty after cleaning')

    anchor_date = sorted(levels.keys())[-1]
    anchor_level = levels[anchor_date]
    if anchor_level == 0:
        raise RuntimeError('S&P 500 anchor level is zero')

    return {date: anchor_cap_b * (level / anchor_level) for date, level in levels.items()}

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


@app.route('/api/credit-card-dashboard', methods=['GET'])
def get_credit_card_dashboard():
    """Return U.S. credit card leverage, pricing, and stress metrics."""
    try:
        start_date = request.args.get('start_date', '1990-01-01')
        end_date = request.args.get('end_date', datetime.utcnow().strftime('%Y-%m-%d'))

        # Core series
        # REVOLSL: Revolving consumer credit (millions USD, monthly)
        # GDP: Gross Domestic Product (billions USD, quarterly)
        # DPI: Disposable Personal Income (billions USD, monthly SAAR)
        # TERMCBCCALLNS: Commercial bank interest rates on credit card plans, all accounts (%)
        # FEDFUNDS: Effective federal funds rate (%)
        # DRCCLACBS: Delinquency rate on credit card loans, all commercial banks (%)
        # CORCCACBS: Net charge-off rate on credit card loans, all commercial banks (%)
        series_ids = {
            'debt': 'REVOLSL',
            'gdp': 'GDP',
            'dpi': 'DPI',
            'apr': 'TERMCBCCALLNS',
            'fed_funds': 'FEDFUNDS',
            'delinquency': 'DRCCLACBS',
            'chargeoff': 'CORCCACBS',
        }

        raw = {
            key: fetch_fred_data(series_id, start_date, end_date, FRED_API_KEY)
            for key, series_id in series_ids.items()
        }

        def to_map(series):
            return {d: v for d, v in series}

        debt_map = to_map(raw['debt'])
        gdp_map = to_map(raw['gdp'])
        dpi_map = to_map(raw['dpi'])
        apr_map = to_map(raw['apr'])
        fed_map = to_map(raw['fed_funds'])
        delinq_map = to_map(raw['delinquency'])
        chargeoff_map = to_map(raw['chargeoff'])

        def forward_fill_value(date_key, source_map):
            if date_key in source_map:
                return source_map[date_key]
            prior_dates = [d for d in source_map.keys() if d <= date_key]
            if not prior_dates:
                return None
            return source_map[max(prior_dates)]

        # Base monthly calendar from debt data
        monthly_dates = sorted(debt_map.keys())

        leverage = []
        for d in monthly_dates:
            debt_val_mn = debt_map.get(d)
            gdp_val = forward_fill_value(d, gdp_map)
            dpi_val = forward_fill_value(d, dpi_map)
            if debt_val_mn is None:
                continue

            # Unit harmonization: REVOLSL is in millions; GDP/DPI are in billions.
            debt_val = debt_val_mn / 1000.0

            debt_gdp = (debt_val / gdp_val) * 100.0 if gdp_val else None
            debt_dpi = (debt_val / dpi_val) * 100.0 if dpi_val else None

            leverage.append({
                'date': d,
                'debt': debt_val,
                'debt_to_gdp': (round(debt_gdp, 2) if debt_gdp is not None else None),
                'debt_to_disposable_income': (round(debt_dpi, 2) if debt_dpi is not None else None),
            })

        # Cost of credit on union dates for APR/Fed Funds
        cost_dates = sorted(set(apr_map.keys()).union(fed_map.keys()))
        cost = []
        for d in cost_dates:
            apr_val = forward_fill_value(d, apr_map)
            fed_val = forward_fill_value(d, fed_map)
            if apr_val is None and fed_val is None:
                continue
            spread = (apr_val - fed_val) if (apr_val is not None and fed_val is not None) else None
            cost.append({
                'date': d,
                'credit_card_apr': (round(apr_val, 2) if apr_val is not None else None),
                'fed_funds_rate': (round(fed_val, 2) if fed_val is not None else None),
                'spread_apr_minus_fedfunds': (round(spread, 2) if spread is not None else None),
            })

        # Stress on union dates for delinquencies/charge-offs
        stress_dates = sorted(set(delinq_map.keys()).union(chargeoff_map.keys()))
        stress = []
        for d in stress_dates:
            delinq_val = forward_fill_value(d, delinq_map)
            chargeoff_val = forward_fill_value(d, chargeoff_map)
            if delinq_val is None and chargeoff_val is None:
                continue
            stress.append({
                'date': d,
                'delinquency_rate': (round(delinq_val, 2) if delinq_val is not None else None),
                'chargeoff_rate': (round(chargeoff_val, 2) if chargeoff_val is not None else None),
            })

        return jsonify({
            'leverage': leverage,
            'cost_of_credit': cost,
            'stress': stress,
        })

    except Exception as e:
        print(f"Error in credit-card-dashboard endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/mortgage-dashboard', methods=['GET'])
def get_mortgage_dashboard():
    """Return mortgage rates, house price YoY, and mortgage burden/distress series."""
    try:
        start_date = request.args.get('start_date', '1991-01-01')
        end_date = request.args.get('end_date', datetime.utcnow().strftime('%Y-%m-%d'))

        # FRED series:
        # MORTGAGE30US: 30-Year Fixed Rate Mortgage Average in the United States
        # MORTGAGE15US: 15-Year Fixed Rate Mortgage Average in the United States
        # MORTGAGE5US: 5/1-Year Adjustable Rate Mortgage Average in the United States
        # CSUSHPINSA: S&P CoreLogic Case-Shiller U.S. National Home Price Index (NSA)
        # MEHOINUSA646N: Real Median Household Income in the United States (annual)
        # MDSP: Mortgage Debt Service Payments as a Percent of Disposable Personal Income
        # DRSFRMACBS: Delinquency Rate on Single-Family Residential Mortgages, All Commercial Banks
        # TDSP: Household Debt Service Payments as a Percent of Disposable Personal Income
        # UNRATE: Civilian Unemployment Rate
        series_ids = {
            'rate_30y': 'MORTGAGE30US',
            'rate_15y': 'MORTGAGE15US',
            'rate_5_1_arm': 'MORTGAGE5US',
            'home_price_index': 'CSUSHPINSA',
            'median_household_income': 'MEHOINUSA646N',
            'mortgage_dsp': 'MDSP',
            'mortgage_delinquency': 'DRSFRMACBS',
            'total_dsp': 'TDSP',
            'unemployment_rate': 'UNRATE',
        }

        raw = {
            key: fetch_fred_data(series_id, start_date, end_date, FRED_API_KEY)
            for key, series_id in series_ids.items()
        }

        def to_map(series):
            return {d: v for d, v in series}

        def forward_fill_value(date_key, source_map):
            if date_key in source_map:
                return source_map[date_key]
            prior_dates = [d for d in source_map.keys() if d <= date_key]
            if not prior_dates:
                return None
            return source_map[max(prior_dates)]

        rate30_map = to_map(raw['rate_30y'])
        rate15_map = to_map(raw['rate_15y'])
        arm_map = to_map(raw['rate_5_1_arm'])
        hpi_map = to_map(raw['home_price_index'])
        mhi_map = to_map(raw['median_household_income'])
        mdsp_map = to_map(raw['mortgage_dsp'])
        delinq_map = to_map(raw['mortgage_delinquency'])
        tdsp_map = to_map(raw['total_dsp'])
        unrate_map = to_map(raw['unemployment_rate'])

        # Compute house price YoY % change from the home price index.
        hpi_sorted = sorted(hpi_map.items(), key=lambda x: x[0])
        hpi_yoy_map = {}
        for i in range(12, len(hpi_sorted)):
            date, curr_val = hpi_sorted[i]
            prev_val = hpi_sorted[i - 12][1]
            if prev_val:
                hpi_yoy_map[date] = round(((curr_val / prev_val) - 1.0) * 100.0, 2)

        # Compute median household income growth (%), typically annual frequency.
        mhi_sorted = sorted(mhi_map.items(), key=lambda x: x[0])
        mhi_growth_map = {}
        for i in range(1, len(mhi_sorted)):
            date, curr_val = mhi_sorted[i]
            prev_val = mhi_sorted[i - 1][1]
            if prev_val:
                mhi_growth_map[date] = round(((curr_val / prev_val) - 1.0) * 100.0, 2)

        all_dates = sorted(set(rate30_map.keys()) | set(rate15_map.keys()) | set(arm_map.keys()) | set(hpi_yoy_map.keys()))

        series = []
        for d in all_dates:
            r30 = forward_fill_value(d, rate30_map)
            r15 = forward_fill_value(d, rate15_map)
            arm = forward_fill_value(d, arm_map)
            hpi_yoy = hpi_yoy_map.get(d)

            if r30 is None and r15 is None and arm is None and hpi_yoy is None:
                continue

            series.append({
                'date': d,
                'mortgage_30y_fixed': (round(r30, 2) if r30 is not None else None),
                'mortgage_15y_fixed': (round(r15, 2) if r15 is not None else None),
                'mortgage_5_1_arm': (round(arm, 2) if arm is not None else None),
                'house_price_yoy': hpi_yoy,
            })

        stress_dates = sorted(set(mdsp_map.keys()) | set(delinq_map.keys()) | set(tdsp_map.keys()) | set(unrate_map.keys()))
        burden_distress = []
        for d in stress_dates:
            mdsp = forward_fill_value(d, mdsp_map)
            delinq = forward_fill_value(d, delinq_map)
            tdsp = forward_fill_value(d, tdsp_map)
            unrate = forward_fill_value(d, unrate_map)

            if mdsp is None and delinq is None and tdsp is None and unrate is None:
                continue

            burden_distress.append({
                'date': d,
                'mortgage_debt_service_ratio': (round(mdsp, 2) if mdsp is not None else None),
                'mortgage_delinquency_rate': (round(delinq, 2) if delinq is not None else None),
                'total_debt_service_ratio': (round(tdsp, 2) if tdsp is not None else None),
                'unemployment_rate': (round(unrate, 2) if unrate is not None else None),
            })

        affordability_dates = sorted(set(rate30_map.keys()) | set(hpi_yoy_map.keys()) | set(mhi_growth_map.keys()) | set(unrate_map.keys()))
        affordability = []
        for d in affordability_dates:
            r30 = forward_fill_value(d, rate30_map)
            hpi_growth = forward_fill_value(d, hpi_yoy_map)
            income_growth = forward_fill_value(d, mhi_growth_map)
            unrate = forward_fill_value(d, unrate_map)

            if r30 is None and hpi_growth is None and income_growth is None and unrate is None:
                continue

            affordability.append({
                'date': d,
                'mortgage_30y_fixed': (round(r30, 2) if r30 is not None else None),
                'home_price_growth': (round(hpi_growth, 2) if hpi_growth is not None else None),
                'median_household_income_growth': (round(income_growth, 2) if income_growth is not None else None),
                'unemployment_rate': (round(unrate, 2) if unrate is not None else None),
            })

        return jsonify({
            'series': series,
            'burden_distress': burden_distress,
            'affordability': affordability,
        })

    except Exception as e:
        print(f"Error in mortgage-dashboard endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/household-equity-dashboard', methods=['GET'])
def get_household_equity_dashboard():
    """Return household equity exposure, wealth-effect, and mortgage-stress comparison series."""
    try:
        start_date = request.args.get('start_date', '1990-01-01')
        end_date = request.args.get('end_date', datetime.utcnow().strftime('%Y-%m-%d'))

        # W790RCQ027SBEA: Household equity (market value)
        # Fallback if unavailable: BOGZ1FL153064105Q
        # DPI: Disposable Personal Income
        # DSPIC96: Real Disposable Personal Income
        # PCEC96: Real Personal Consumption Expenditures
        # UNRATE: Civilian Unemployment Rate
        # DRSFRMACBS: Delinquency Rate on Single-Family Residential Mortgages, All Commercial Banks
        # TDSP: Household Debt Service Payments as a Percent of Disposable Personal Income
        household_equity = fetch_fred_data('W790RCQ027SBEA', start_date, end_date, FRED_API_KEY)
        if not household_equity:
            household_equity = fetch_fred_data('BOGZ1FL153064105Q', start_date, end_date, FRED_API_KEY)
        dpi = fetch_fred_data('DPI', start_date, end_date, FRED_API_KEY)
        real_dpi = fetch_fred_data('DSPIC96', start_date, end_date, FRED_API_KEY)
        real_pce = fetch_fred_data('PCEC96', start_date, end_date, FRED_API_KEY)
        unrate = fetch_fred_data('UNRATE', start_date, end_date, FRED_API_KEY)
        mortgage_delinquency = fetch_fred_data('DRSFRMACBS', start_date, end_date, FRED_API_KEY)
        debt_service_ratio = fetch_fred_data('TDSP', start_date, end_date, FRED_API_KEY)

        def to_map(series):
            return {d: v for d, v in series}

        def forward_fill_value(date_key, source_map):
            if date_key in source_map:
                return source_map[date_key]
            prior_dates = [d for d in source_map.keys() if d <= date_key]
            if not prior_dates:
                return None
            return source_map[max(prior_dates)]

        household_equity_map = to_map(household_equity)
        dpi_map = to_map(dpi)
        real_dpi_map = to_map(real_dpi)
        real_pce_map = to_map(real_pce)
        unrate_map = to_map(unrate)
        mortgage_delinquency_map = to_map(mortgage_delinquency)
        debt_service_ratio_map = to_map(debt_service_ratio)

        def yoy_growth_map(source_map):
            growth = {}
            for date_key in sorted(source_map.keys()):
                current = source_map.get(date_key)
                if current is None:
                    continue
                prior_date_key = (pd.to_datetime(date_key) - pd.DateOffset(years=1)).strftime('%Y-%m-%d')
                prior = forward_fill_value(prior_date_key, source_map)
                if prior:
                    growth[date_key] = ((current / prior) - 1.0) * 100.0
            return growth

        equity_growth_yoy_map = yoy_growth_map(household_equity_map)
        real_dpi_growth_yoy_map = yoy_growth_map(real_dpi_map)
        real_pce_growth_yoy_map = yoy_growth_map(real_pce_map)

        sp500_df = yf.Ticker('^GSPC').history(start=start_date, end=end_date, interval='1mo')
        sp500_map = {}
        if not sp500_df.empty and 'Close' in sp500_df.columns:
            for idx, row in sp500_df.iterrows():
                if pd.isna(row['Close']):
                    continue
                date_key = idx.strftime('%Y-%m-01') if isinstance(idx, pd.Timestamp) else str(idx)[:7] + '-01'
                sp500_map[date_key] = float(row['Close'])

        sp500_norm_map = {}
        if sp500_map:
            first_date = sorted(sp500_map.keys())[0]
            base = sp500_map[first_date]
            if base:
                sp500_norm_map = {d: (v / base) * 100.0 for d, v in sp500_map.items()}

        all_dates = sorted(set(household_equity_map.keys()) | set(dpi_map.keys()) | set(unrate_map.keys()) | set(sp500_norm_map.keys()))

        series = []
        for d in all_dates:
            hh_equity = forward_fill_value(d, household_equity_map)
            dpi_val = forward_fill_value(d, dpi_map)
            ur = forward_fill_value(d, unrate_map)
            spx = sp500_norm_map.get(d)

            ratio = (hh_equity / dpi_val) * 100.0 if (hh_equity is not None and dpi_val) else None

            if ratio is None and ur is None and spx is None:
                continue

            series.append({
                'date': d,
                'household_equity_to_dpi': (round(ratio, 2) if ratio is not None else None),
                'sp500_normalized': (round(spx, 2) if spx is not None else None),
                'unemployment_rate': (round(ur, 2) if ur is not None else None),
            })

        wealth_dates = sorted(set(equity_growth_yoy_map.keys()) | set(real_dpi_growth_yoy_map.keys()) | set(real_pce_growth_yoy_map.keys()))
        wealth_effect = []
        for d in wealth_dates:
            eq_growth = forward_fill_value(d, equity_growth_yoy_map)
            dpi_growth = forward_fill_value(d, real_dpi_growth_yoy_map)
            pce_growth = forward_fill_value(d, real_pce_growth_yoy_map)

            if eq_growth is None and dpi_growth is None and pce_growth is None:
                continue

            wealth_effect.append({
                'date': d,
                'household_equity_growth_yoy': (round(eq_growth, 2) if eq_growth is not None else None),
                'real_disposable_income_growth_yoy': (round(dpi_growth, 2) if dpi_growth is not None else None),
                'personal_consumption_growth_yoy': (round(pce_growth, 2) if pce_growth is not None else None),
            })

        stress_dates = sorted(set(household_equity_map.keys()) | set(dpi_map.keys()) | set(mortgage_delinquency_map.keys()) | set(debt_service_ratio_map.keys()))
        exposure_vs_stress = []
        for d in stress_dates:
            hh_equity = forward_fill_value(d, household_equity_map)
            dpi_val = forward_fill_value(d, dpi_map)
            delinq = forward_fill_value(d, mortgage_delinquency_map)
            dsr = forward_fill_value(d, debt_service_ratio_map)

            ratio = (hh_equity / dpi_val) * 100.0 if (hh_equity is not None and dpi_val) else None

            if ratio is None and delinq is None and dsr is None:
                continue

            exposure_vs_stress.append({
                'date': d,
                'household_equity_to_dpi': (round(ratio, 2) if ratio is not None else None),
                'mortgage_delinquency_rate': (round(delinq, 2) if delinq is not None else None),
                'debt_service_ratio': (round(dsr, 2) if dsr is not None else None),
            })

        return jsonify({
            'series': series,
            'wealth_effect': wealth_effect,
            'exposure_vs_stress': exposure_vs_stress,
        })

    except Exception as e:
        print(f"Error in household-equity-dashboard endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

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


@app.route('/api/us-equity-holders', methods=['GET'])
def get_us_equity_holders():
    """Fetch U.S. corporate equity holdings by foreign countries (billions USD) from TIC SLT Table 1."""
    try:
        def normalize_data(data_list):
            seen = {}
            for item in data_list:
                if item['date'] not in seen:
                    seen[item['date']] = item['holdings']
            return seen

        total_label = 'All Countries'
        total_label_alt = 'All Countries and International and Regional Organizations'
        countries = [
            'Japan', 'China', 'United Kingdom',
            'Belgium', 'Luxembourg', 'France', 'Ireland', 'Norway', 'Germany', 'Spain', 'Italy',
            total_label, total_label_alt
        ]
        euro_components = ['Belgium', 'Luxembourg', 'France', 'Ireland', 'Norway', 'Germany', 'Spain', 'Italy']

        urls = [
            'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table1.html',
            'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table1.txt'
        ]
        slt_text = fetch_text_with_retries(urls, timeout=45, retries=3)
        parsed = parse_slt1_equity_holdings_text(slt_text, countries)
        normalized = {country: normalize_data(parsed.get(country, [])) for country in countries}

        euro_maps = [normalized.get(c, {}) for c in euro_components]
        all_dates = sorted(set().union(*(set(m.keys()) for m in euro_maps))) if euro_maps else []
        euro_zone_map = {}
        for date in all_dates:
            vals = [m[date] for m in euro_maps if date in m]
            if vals:
                euro_zone_map[date] = sum(vals)

        result = {}
        for country in ['Japan', 'China', 'United Kingdom']:
            m = normalized.get(country, {})
            result[country] = sorted(
                [{'date': d, 'holdings': v} for d, v in m.items()],
                key=lambda x: datetime.strptime(x['date'], '%Y-%m-%d')
            )

        result['Euro Zone'] = sorted(
            [{'date': d, 'holdings': v} for d, v in euro_zone_map.items()],
            key=lambda x: datetime.strptime(x['date'], '%Y-%m-%d')
        )

        total_map = normalized.get(total_label, {})
        if not total_map:
            total_map = normalized.get(total_label_alt, {})
        result['Total Foreign'] = sorted(
            [{'date': d, 'holdings': v} for d, v in total_map.items()],
            key=lambda x: datetime.strptime(x['date'], '%Y-%m-%d')
        )

        for country in euro_components:
            m = normalized.get(country, {})
            result[country] = sorted(
                [{'date': d, 'holdings': v} for d, v in m.items()],
                key=lambda x: datetime.strptime(x['date'], '%Y-%m-%d')
            )

        DATA_CACHE['us_equity_holders'] = result
        DATA_CACHE['us_equity_updated_at'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

        return jsonify(result)

    except Exception as e:
        print(f"Error in us-equity-holders endpoint: {e}")
        if DATA_CACHE.get('us_equity_holders'):
            print("Serving stale cached us-equity-holders data")
            return jsonify(DATA_CACHE['us_equity_holders'])
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/us-equity-holders-percentage', methods=['GET'])
def get_us_equity_holders_percentage():
    """Return major holders as % of CRSP US Total Market Index-based denominator."""
    try:
        urls = [
            'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table1.html',
            'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table1.txt'
        ]
        slt_text = fetch_text_with_retries(urls, timeout=45, retries=3)

        total_label = 'All Countries'
        total_label_alt = 'All Countries and International and Regional Organizations'
        countries = [
            'Japan', 'China', 'United Kingdom',
            'Belgium', 'Luxembourg', 'France', 'Ireland', 'Norway', 'Germany', 'Spain', 'Italy',
            total_label, total_label_alt
        ]
        euro_components = ['Belgium', 'Luxembourg', 'France', 'Ireland', 'Norway', 'Germany', 'Spain', 'Italy']

        parsed = parse_slt1_equity_holdings_text(slt_text, countries)

        def normalize_data(data_list):
            seen = {}
            for item in data_list:
                if item['date'] not in seen:
                    seen[item['date']] = item['holdings']
            return seen

        normalized = {country: normalize_data(parsed.get(country, [])) for country in countries}
        total_map = normalized.get(total_label, {})
        if not total_map:
            total_map = normalized.get(total_label_alt, {})
        crsp_denom_map = fetch_crsp_total_market_denom_map(total_map, start_date='2020-01-01')

        component_maps = [normalized.get(c, {}) for c in euro_components]
        all_dates = sorted(set().union(*(set(m.keys()) for m in component_maps))) if component_maps else []
        euro_zone_map = {}
        for date in all_dates:
            vals = [m[date] for m in component_maps if date in m]
            if vals:
                euro_zone_map[date] = sum(vals)

        result = {}
        for country in ['Japan', 'China', 'United Kingdom']:
            percentage_data = []
            m = normalized.get(country, {})
            for date, value in m.items():
                total_value = crsp_denom_map.get(date)
                if total_value is not None and total_value != 0:
                    percentage_data.append({
                        'date': date,
                        'percentage': round((value / total_value) * 100.0, 2)
                    })
            percentage_data.sort(key=lambda x: datetime.strptime(x['date'], '%Y-%m-%d'))
            result[country] = percentage_data

        euro_percentage = []
        for date, value in euro_zone_map.items():
            total_value = crsp_denom_map.get(date)
            if total_value is not None and total_value != 0:
                euro_percentage.append({
                    'date': date,
                    'percentage': round((value / total_value) * 100.0, 2)
                })
        euro_percentage.sort(key=lambda x: datetime.strptime(x['date'], '%Y-%m-%d'))
        result['Euro Zone'] = euro_percentage

        DATA_CACHE['us_equity_holders_percentage'] = result

        return jsonify(result)

    except Exception as e:
        print(f"Error in us-equity-holders-percentage endpoint: {e}")
        if DATA_CACHE.get('us_equity_holders_percentage'):
            print("Serving stale cached us-equity-holders-percentage data")
            return jsonify(DATA_CACHE['us_equity_holders_percentage'])
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/us-equity-holders-percentage-sp500', methods=['GET'])
def get_us_equity_holders_percentage_sp500():
    """Return major holders as % of S&P 500 market capitalization proxy."""
    try:
        urls = [
            'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table1.html',
            'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table1.txt'
        ]
        slt_text = fetch_text_with_retries(urls, timeout=45, retries=3)

        total_label = 'All Countries'
        total_label_alt = 'All Countries and International and Regional Organizations'
        countries = [
            'Japan', 'China', 'United Kingdom',
            'Belgium', 'Luxembourg', 'France', 'Ireland', 'Norway', 'Germany', 'Spain', 'Italy',
            total_label, total_label_alt
        ]
        euro_components = ['Belgium', 'Luxembourg', 'France', 'Ireland', 'Norway', 'Germany', 'Spain', 'Italy']

        parsed = parse_slt1_equity_holdings_text(slt_text, countries)

        def normalize_data(data_list):
            seen = {}
            for item in data_list:
                if item['date'] not in seen:
                    seen[item['date']] = item['holdings']
            return seen

        normalized = {country: normalize_data(parsed.get(country, [])) for country in countries}
        sp500_denom_map = fetch_sp500_market_cap_denom_map(start_date='2020-01-01')

        component_maps = [normalized.get(c, {}) for c in euro_components]
        all_dates = sorted(set().union(*(set(m.keys()) for m in component_maps))) if component_maps else []
        euro_zone_map = {}
        for date in all_dates:
            vals = [m[date] for m in component_maps if date in m]
            if vals:
                euro_zone_map[date] = sum(vals)

        result = {}
        for country in ['Japan', 'China', 'United Kingdom']:
            percentage_data = []
            m = normalized.get(country, {})
            for date, value in m.items():
                total_value = sp500_denom_map.get(date)
                if total_value is not None and total_value != 0:
                    percentage_data.append({
                        'date': date,
                        'percentage': round((value / total_value) * 100.0, 2)
                    })
            percentage_data.sort(key=lambda x: datetime.strptime(x['date'], '%Y-%m-%d'))
            result[country] = percentage_data

        euro_percentage = []
        for date, value in euro_zone_map.items():
            total_value = sp500_denom_map.get(date)
            if total_value is not None and total_value != 0:
                euro_percentage.append({
                    'date': date,
                    'percentage': round((value / total_value) * 100.0, 2)
                })
        euro_percentage.sort(key=lambda x: datetime.strptime(x['date'], '%Y-%m-%d'))
        result['Euro Zone'] = euro_percentage

        DATA_CACHE['us_equity_holders_percentage_sp500'] = result
        return jsonify(result)

    except Exception as e:
        print(f"Error in us-equity-holders-percentage-sp500 endpoint: {e}")
        if DATA_CACHE.get('us_equity_holders_percentage_sp500'):
            print("Serving stale cached us-equity-holders-percentage-sp500 data")
            return jsonify(DATA_CACHE['us_equity_holders_percentage_sp500'])
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


def build_cpis_foreign_holders_dashboard(counterpart_area_code: str, country_label: str):
    """Return top foreign holders of a country's government debt securities (CPIS)."""
    try:
        counterpart_area_code = str(counterpart_area_code).upper()
        dimensions = {
            'FREQ': ['A'],
            'INDICATOR': ['I_A_D_T_T_BP6_USD'],
            'REF_SECTOR': ['T'],
            'COUNTERPART_SECTOR': ['GG'],
            'COUNTERPART_AREA': [counterpart_area_code],
        }

        series_url = 'https://api.db.nomics.world/v22/series/IMF/CPIS'
        params = {
            'metadata': 0,
            'observations': 1,
            'align_periods': 1,
            'dimensions': json.dumps(dimensions, separators=(',', ':')),
            'limit': 1000,
            'offset': 0,
        }
        series_resp = requests.get(series_url, params=params, timeout=60)
        series_resp.raise_for_status()
        series_payload = series_resp.json()
        docs = ((series_payload.get('series') or {}).get('docs') or [])

        if not docs:
            return jsonify({'error': f'No CPIS series found for {country_label} counterpart.'}), 404

        metadata_resp = requests.get('https://api.db.nomics.world/v22/datasets/IMF/CPIS', timeout=60)
        metadata_resp.raise_for_status()
        metadata_payload = metadata_resp.json()
        ref_area_labels = (
            (((metadata_payload.get('datasets') or {}).get('docs') or [{}])[0].get('dimensions_values_labels') or {})
            .get('REF_AREA', {})
        )

        country_series = {}
        latest_values = {}

        for doc in docs:
            dims = doc.get('dimensions') or {}
            holder_code = str(dims.get('REF_AREA', '')).upper()

            # Keep ISO-2 country reporters only, and exclude Italy itself.
            if not re.match(r'^[A-Z]{2}$', holder_code):
                continue
            if holder_code == counterpart_area_code:
                continue

            periods = doc.get('period') or []
            values = doc.get('value') or []
            if not periods or not values:
                continue

            observations = []
            for p, v in zip(periods, values):
                fv = to_float_or_none(v)
                if fv is None:
                    continue
                try:
                    year = int(str(p)[:4])
                except Exception:
                    continue
                observations.append((year, fv))

            if not observations:
                continue

            observations.sort(key=lambda x: x[0])
            country_series[holder_code] = observations
            latest_values[holder_code] = observations[-1][1]

        if not latest_values:
            return jsonify({'error': f'No usable CPIS observations found for {country_label} counterpart.'}), 404

        top_codes = [k for k, _ in sorted(latest_values.items(), key=lambda kv: kv[1], reverse=True)[:5]]

        totals_by_year = {}
        for _, obs in country_series.items():
            for year, value in obs:
                totals_by_year[year] = totals_by_year.get(year, 0.0) + value

        holdings = {}
        shares = {}
        ranking = []

        for code in top_codes:
            label = ref_area_labels.get(code, code)
            obs = country_series.get(code, [])

            holdings[label] = [
                {'date': f'{year}-01-01', 'holdings': round(value / 1_000_000_000.0, 3)}
                for year, value in obs
            ]

            shares[label] = [
                {
                    'date': f'{year}-01-01',
                    'percentage': round((value / totals_by_year[year]) * 100.0, 2) if totals_by_year.get(year) else None
                }
                for year, value in obs
            ]

            ranking.append({
                'country_code': code,
                'country': label,
                'latest_holdings_bn_usd': round((latest_values.get(code) or 0.0) / 1_000_000_000.0, 3),
            })

        latest_year = max(max(year for year, _ in obs) for obs in country_series.values())

        return jsonify({
            'title': f'Top 5 foreign holders of {country_label} government debt securities',
            'methodology': f'IMF CPIS annual assets in debt securities (indicator I_A_D_T_T_BP6_USD), counterpart sector GG (General Government), counterpart area {counterpart_area_code}.',
            'latest_year': latest_year,
            'ranking': ranking,
            'holdings': holdings,
            'shares': shares,
        })

    except Exception as e:
        print(f"Error in CPIS foreign holders dashboard endpoint ({country_label}): {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def fetch_te_indicator(country_slug: str, indicator_slug: str):
    """Fetch TradingEconomics indicator summary and chart URL from public country page."""
    slug = (country_slug or '').strip().lower()
    indicator = (indicator_slug or '').strip().lower()
    if not re.match(r'^[a-z-]+$', slug):
        raise ValueError('Invalid country slug')
    if not re.match(r'^[a-z-]+$', indicator):
        raise ValueError('Invalid indicator slug')

    url = f'https://tradingeconomics.com/{slug}/{indicator}'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept-Language': 'en-US,en;q=0.9'
    }

    response = requests.get(url, headers=headers, timeout=40)
    response.raise_for_status()
    html = response.text

    chart_url = None
    chart_match = re.search(r"TEChartUrl\s*=\s*'([^']*cloudfront\.net/charts/[^']+)'", html, flags=re.I)
    if chart_match:
        chart_url = chart_match.group(1)

    if not chart_url:
        symbol_match = re.search(r"TESymbol\s*=\s*'([A-Z0-9_]+)'", html)
        if symbol_match:
            symbol = symbol_match.group(1).lower()
            chart_url = f'https://d3fy651gv2fhd3.cloudfront.net/charts/{slug}-{indicator}.png?s={symbol}'

    description = None
    desc_match = re.search(r'<meta[^>]+name="description"[^>]+content="([^"]+)"', html, flags=re.I)
    if desc_match:
        description = re.sub(r'\s+', ' ', desc_match.group(1)).strip()

    if not chart_url and not description:
        raise RuntimeError('Could not extract TradingEconomics indicator data from page source')

    if chart_url:
        parsed = urlparse(chart_url)
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        query['d1'] = '1900-01-01'
        query['d2'] = '2100-01-01'
        chart_url = urlunparse(parsed._replace(query=urlencode(query)))

    return {
        'country_slug': slug,
        'indicator_slug': indicator,
        'source_url': url,
        'chart_url': chart_url,
        'description': description,
        'fetched_at': datetime.utcnow().isoformat() + 'Z'
    }


def fetch_te_productivity(country_slug: str):
    """Fetch TradingEconomics productivity summary and chart URL."""
    return fetch_te_indicator(country_slug, 'productivity')


def fetch_te_top_tax_rate(country_slug: str):
    """Fetch TradingEconomics personal income tax rate page and parse top bracket metrics."""
    payload = fetch_te_indicator(country_slug, 'personal-income-tax-rate')
    description = payload.get('description') or ''

    current_rate = None
    historical_high = None
    historical_low = None

    m_current = re.search(r'stands at\s+(-?\d+(?:\.\d+)?)\s+percent', description, flags=re.I)
    if m_current:
        current_rate = float(m_current.group(1))

    m_high = re.search(r'all\s+time\s+high\s+of\s+(-?\d+(?:\.\d+)?)\s+percent', description, flags=re.I)
    if m_high:
        historical_high = float(m_high.group(1))

    m_low = re.search(r'record\s+low\s+of\s+(-?\d+(?:\.\d+)?)\s+percent', description, flags=re.I)
    if m_low:
        historical_low = float(m_low.group(1))

    payload['current_rate_percent'] = current_rate
    payload['historical_high_percent'] = historical_high
    payload['historical_low_percent'] = historical_low
    return payload


def fetch_eurostat_digital_intensity_2025(size_emp='10-249'):
    """Fetch Eurostat isoc_e_dii for 2025 and a given enterprise size class (DII version 3 buckets)."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_e_dii'
    allowed_sizes = {
        '10-49': '10 to 49 employees',
        '50-249': '50 to 249 employees',
        '10-249': '10 to 249 employees',
        'GE10': '10 or more employees',
        'GE250': '250 or more employees',
    }
    if size_emp not in allowed_sizes:
        raise ValueError(f"Unsupported size_emp '{size_emp}'. Allowed: {', '.join(allowed_sizes.keys())}")

    indicator_codes = {
        'very_low': 'E_DI3_VLO',
        'low': 'E_DI3_LO',
        'high': 'E_DI3_HI',
        'very_high': 'E_DI3_VHI',
    }
    eu27_member_codes = {
        'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'EL',
        'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
        'SI', 'ES', 'SE'
    }

    rows_by_geo = {}

    for bucket_key, indicator_code in indicator_codes.items():
        params = {
            'lang': 'en',
            'freq': 'A',
            'size_emp': size_emp,
            'nace_r2': 'C10-S951_X_K',
            'unit': 'PC_ENT',
            'time': '2025',
            'indic_is': indicator_code,
        }

        payload = None
        last_error = None
        for attempt in range(1, 4):
            try:
                response = requests.get(base_url, params=params, timeout=40)
                response.raise_for_status()
                payload = response.json()
                break
            except Exception as e:
                last_error = e
                print(f"Eurostat fetch failed (attempt {attempt}/3, indic={indicator_code}, size_emp={size_emp}): {e}")
                if attempt < 3:
                    time.sleep(1.2 * attempt)

        if payload is None:
            raise RuntimeError(f"Eurostat fetch failed for indic={indicator_code}, size_emp={size_emp}: {last_error}")

        dimension = payload.get('dimension', {})
        geo_category = dimension.get('geo', {}).get('category', {})
        geo_index = geo_category.get('index', {})
        geo_labels = geo_category.get('label', {})
        values = payload.get('value', {})

        for geo_code, geo_pos in geo_index.items():
            # Keep EU-27 country rows only (exclude aggregates and non-EU countries)
            if not re.match(r'^[A-Z]{2}$', str(geo_code)):
                continue
            if geo_code not in eu27_member_codes:
                continue

            value = values.get(str(geo_pos))
            if value is None:
                continue

            if geo_code not in rows_by_geo:
                rows_by_geo[geo_code] = {
                    'geo': geo_code,
                    'country': geo_labels.get(geo_code, geo_code),
                    'very_low': None,
                    'low': None,
                    'high': None,
                    'very_high': None,
                }

            rows_by_geo[geo_code][bucket_key] = float(value)

    rows = []
    for row in rows_by_geo.values():
        if any(row[k] is None for k in ['very_low', 'low', 'high', 'very_high']):
            continue
        rows.append(row)

    rows.sort(key=lambda item: (item['high'] + item['very_high']), reverse=True)
    return {
        'year': 2025,
        'size_class': size_emp,
        'size_label': allowed_sizes[size_emp],
        'indicator_version': 'DII version 3',
        'source_dataset': 'isoc_e_dii',
        'rows': rows,
    }


@app.route('/api/digital-intensity-index', methods=['GET'])
def get_digital_intensity_index():
    """Return Digital Intensity Index buckets for 2025 and selected enterprise size class."""
    try:
        size_emp = (request.args.get('size_emp') or '10-249').strip()
        payload = fetch_eurostat_digital_intensity_2025(size_emp=size_emp)
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in digital-intensity-index endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def fetch_eurostat_digital_intensity_trend_2021_2025(size_emp='GE250', indic_is='E_DI3_VHI'):
    """Fetch DII share trend (2021-2025) for selected EU countries, size class, and indicator bucket."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_e_dii'
    allowed_sizes = {
        '10-49': '10-49 employees',
        '50-249': '50-249 employees',
        '10-249': '10-249 employees',
        'GE10': '10 or more employees',
        'GE250': '250 or more employees',
    }
    allowed_indicators = {
        'E_DI3_VHI': 'Very high digital intensity share',
        'E_DI3_HI': 'High digital intensity share',
        'E_DI3_LO': 'Low digital intensity share',
        'E_DI3_VLO': 'Very low digital intensity share',
    }
    if size_emp not in allowed_sizes:
        raise ValueError(f"Unsupported size_emp '{size_emp}'. Allowed: {', '.join(allowed_sizes.keys())}")
    if indic_is not in allowed_indicators:
        raise ValueError(f"Unsupported indic_is '{indic_is}'. Allowed: {', '.join(allowed_indicators.keys())}")

    countries = {
        'EU27_2020': 'European Union',
        'BE': 'Belgium',
        'FR': 'France',
        'ES': 'Spain',
        'IT': 'Italy',
        'DE': 'Germany',
        'PL': 'Poland',
    }
    years = [2021, 2022, 2023, 2024, 2025]

    values_by_country = {geo: {} for geo in countries.keys()}

    for year in years:
        params = {
            'lang': 'en',
            'freq': 'A',
            'size_emp': size_emp,
            'nace_r2': 'C10-S951_X_K',
            'unit': 'PC_ENT',
            'time': str(year),
            'indic_is': indic_is,
        }

        payload = None
        last_error = None
        for attempt in range(1, 4):
            try:
                response = requests.get(base_url, params=params, timeout=40)
                response.raise_for_status()
                payload = response.json()
                break
            except Exception as e:
                last_error = e
                print(f"Eurostat trend fetch failed (attempt {attempt}/3, year={year}, size_emp={size_emp}): {e}")
                if attempt < 3:
                    time.sleep(1.2 * attempt)

        if payload is None:
            raise RuntimeError(f"Eurostat trend fetch failed for year={year}, size_emp={size_emp}: {last_error}")

        dimension = payload.get('dimension', {})
        geo_category = dimension.get('geo', {}).get('category', {})
        geo_index = geo_category.get('index', {})
        values = payload.get('value', {})

        for geo in countries.keys():
            geo_pos = geo_index.get(geo)
            if geo_pos is None:
                continue

            value = values.get(str(geo_pos))
            if value is None:
                continue
            values_by_country[geo][year] = float(value)

    series = []
    for geo, country_name in countries.items():
        points = []
        for year in years:
            points.append({
                'year': year,
                'value': values_by_country[geo].get(year)
            })
        series.append({
            'geo': geo,
            'country': country_name,
            'points': points
        })

    return {
        'indicator': allowed_indicators[indic_is],
        'indicator_code': indic_is,
        'years': years,
        'size_class': size_emp,
        'size_label': allowed_sizes[size_emp],
        'series': series,
    }


@app.route('/api/digital-intensity-very-high-trend', methods=['GET'])
def get_digital_intensity_very_high_trend():
    """Return digital intensity shares (2021-2025) for selected countries and indicator bucket."""
    try:
        size_emp = (request.args.get('size_emp') or 'GE250').strip()
        indic_is = (request.args.get('indic_is') or 'E_DI3_VHI').strip()
        payload = fetch_eurostat_digital_intensity_trend_2021_2025(size_emp=size_emp, indic_is=indic_is)
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in digital-intensity-very-high-trend endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def fetch_sbs_enterprise_counts_by_country(size_emp='10-249', year='2024'):
    """Fetch number of enterprises by country from SBS_SC_OVW for a selected size class."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw'

    size_to_components = {
        '10-49': ['10-19', '20-49'],
        '50-249': ['50-249'],
        '10-249': ['10-19', '20-49', '50-249'],
        'GE10': ['10-19', '20-49', '50-249', 'GE250'],
        'GE250': ['GE250'],
    }
    size_labels = {
        '10-49': '10-49 employees',
        '50-249': '50-249 employees',
        '10-249': '10-249 employees',
        'GE10': '10 or more employees',
        'GE250': '250 or more employees',
    }

    if size_emp not in size_to_components:
        raise ValueError(f"Unsupported size_emp '{size_emp}'. Allowed: {', '.join(size_to_components.keys())}")

    eu27_member_codes = {
        'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'EL',
        'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
        'SI', 'ES', 'SE'
    }

    counts_by_geo = {}
    for component_size in size_to_components[size_emp]:
        params = {
            'lang': 'en',
            'freq': 'A',
            'indic_sbs': 'ENT_NR',
            'nace_r2': 'B-S_X_O_S94',
            'size_emp': component_size,
            'time': str(year),
        }

        payload = None
        last_error = None
        for attempt in range(1, 4):
            try:
                response = requests.get(base_url, params=params, timeout=40)
                response.raise_for_status()
                payload = response.json()
                break
            except Exception as e:
                last_error = e
                print(f"SBS fetch failed (attempt {attempt}/3, size_emp={component_size}, year={year}): {e}")
                if attempt < 3:
                    time.sleep(1.2 * attempt)

        if payload is None:
            raise RuntimeError(f"SBS fetch failed for size_emp={component_size}, year={year}: {last_error}")

        dimension = payload.get('dimension', {})
        geo_category = dimension.get('geo', {}).get('category', {})
        geo_index = geo_category.get('index', {})
        geo_labels = geo_category.get('label', {})
        values = payload.get('value', {})

        for geo_code, geo_pos in geo_index.items():
            if not re.match(r'^[A-Z]{2}$', str(geo_code)):
                continue
            if geo_code not in eu27_member_codes:
                continue

            value = values.get(str(geo_pos))
            if value is None:
                continue

            if geo_code not in counts_by_geo:
                counts_by_geo[geo_code] = {
                    'geo': geo_code,
                    'country': geo_labels.get(geo_code, geo_code),
                    'count': 0.0,
                }
            counts_by_geo[geo_code]['count'] += float(value)

    rows = sorted(counts_by_geo.values(), key=lambda item: item['count'], reverse=True)
    return {
        'dataset': 'SBS_SC_OVW',
        'indicator': 'Enterprises - number',
        'nace_scope': 'B-S_X_O_S94',
        'year': int(year),
        'size_class': size_emp,
        'size_label': size_labels[size_emp],
        'rows': rows,
    }


@app.route('/api/enterprise-counts-by-country', methods=['GET'])
def get_enterprise_counts_by_country():
    """Return number of enterprises by country for selected enterprise size class."""
    try:
        size_emp = (request.args.get('size_emp') or '10-249').strip()
        year = (request.args.get('year') or '2024').strip()
        payload = fetch_sbs_enterprise_counts_by_country(size_emp=size_emp, year=year)
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in enterprise-counts-by-country endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def fetch_sbs_company_size_shares_by_country_2025(year='2025'):
    """Fetch company size shares by country for 2025: 10-49, 50-249, 250+ employees."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw'
    component_sizes = ['10-19', '20-49', '50-249', 'GE250']

    eu27_member_codes = {
        'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'EL',
        'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
        'SI', 'ES', 'SE'
    }

    counts_by_geo = {}
    for component_size in component_sizes:
        params = {
            'lang': 'en',
            'freq': 'A',
            'indic_sbs': 'ENT_NR',
            'nace_r2': 'B-S_X_O_S94',
            'size_emp': component_size,
            'time': str(year),
        }

        payload = None
        last_error = None
        for attempt in range(1, 4):
            try:
                response = requests.get(base_url, params=params, timeout=40)
                response.raise_for_status()
                payload = response.json()
                break
            except Exception as e:
                last_error = e
                print(f"SBS size-share fetch failed (attempt {attempt}/3, size_emp={component_size}, year={year}): {e}")
                if attempt < 3:
                    time.sleep(1.2 * attempt)

        if payload is None:
            raise RuntimeError(f"SBS size-share fetch failed for size_emp={component_size}, year={year}: {last_error}")

        dimension = payload.get('dimension', {})
        geo_category = dimension.get('geo', {}).get('category', {})
        geo_index = geo_category.get('index', {})
        geo_labels = geo_category.get('label', {})
        values = payload.get('value', {})

        for geo_code, geo_pos in geo_index.items():
            if not re.match(r'^[A-Z]{2}$', str(geo_code)):
                continue
            if geo_code not in eu27_member_codes:
                continue

            value = values.get(str(geo_pos))
            if value is None:
                continue

            if geo_code not in counts_by_geo:
                counts_by_geo[geo_code] = {
                    'geo': geo_code,
                    'country': geo_labels.get(geo_code, geo_code),
                    'count_10_19': 0.0,
                    'count_20_49': 0.0,
                    'count_50_249': 0.0,
                    'count_250_plus': 0.0,
                }

            if component_size == '10-19':
                counts_by_geo[geo_code]['count_10_19'] += float(value)
            elif component_size == '20-49':
                counts_by_geo[geo_code]['count_20_49'] += float(value)
            elif component_size == '50-249':
                counts_by_geo[geo_code]['count_50_249'] += float(value)
            elif component_size == 'GE250':
                counts_by_geo[geo_code]['count_250_plus'] += float(value)

    rows = []
    for row in counts_by_geo.values():
        count_10_49 = row['count_10_19'] + row['count_20_49']
        count_50_249 = row['count_50_249']
        count_250_plus = row['count_250_plus']
        total = count_10_49 + count_50_249 + count_250_plus

        if total <= 0:
            continue

        rows.append({
            'geo': row['geo'],
            'country': row['country'],
            'count_10_49': count_10_49,
            'count_50_249': count_50_249,
            'count_250_plus': count_250_plus,
            'share_10_49': (count_10_49 / total) * 100,
            'share_50_249': (count_50_249 / total) * 100,
            'share_250_plus': (count_250_plus / total) * 100,
            'total_count': total,
        })

    rows.sort(key=lambda item: item['share_250_plus'], reverse=True)
    return {
        'dataset': 'SBS_SC_OVW',
        'indicator': 'Enterprises - number (shares by size class)',
        'nace_scope': 'B-S_X_O_S94',
        'year': int(year),
        'rows': rows,
    }


@app.route('/api/company-size-shares-by-country', methods=['GET'])
def get_company_size_shares_by_country():
    """Return country-level shares for company sizes 10-49, 50-249 and 250+ (2024 by default)."""
    try:
        year = (request.args.get('year') or '2024').strip()
        payload = fetch_sbs_company_size_shares_by_country_2025(year=year)
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in company-size-shares-by-country endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def fetch_sbs_company_size_growth_selected_countries(start_year='2021', end_year='2024'):
    """Fetch growth in enterprise counts by size class for EU + selected countries."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw'
    component_sizes = ['10-19', '20-49', '50-249', 'GE250']

    selected_countries = {
        'EU27_2020': 'European Union',
        'BE': 'Belgium',
        'FR': 'France',
        'ES': 'Spain',
        'IT': 'Italy',
        'DE': 'Germany',
        'PL': 'Poland',
    }

    year_values = list(range(int(start_year), int(end_year) + 1))
    counts = {
        geo: {year: {} for year in year_values}
        for geo in selected_countries.keys()
    }

    for year in year_values:
        for component_size in component_sizes:
            params = {
                'lang': 'en',
                'freq': 'A',
                'indic_sbs': 'ENT_NR',
                'nace_r2': 'B-S_X_O_S94',
                'size_emp': component_size,
                'time': str(year),
                'geo': list(selected_countries.keys()),
            }

            payload = None
            last_error = None
            for attempt in range(1, 4):
                try:
                    response = requests.get(base_url, params=params, timeout=40)
                    response.raise_for_status()
                    payload = response.json()
                    break
                except Exception as e:
                    last_error = e
                    print(f"SBS growth fetch failed (attempt {attempt}/3, size_emp={component_size}, year={year}): {e}")
                    if attempt < 3:
                        time.sleep(1.2 * attempt)

            if payload is None:
                raise RuntimeError(f"SBS growth fetch failed for size_emp={component_size}, year={year}: {last_error}")

            dimension = payload.get('dimension', {})
            geo_category = dimension.get('geo', {}).get('category', {})
            geo_index = geo_category.get('index', {})
            values = payload.get('value', {})

            size_key = {
                '10-19': '10_19',
                '20-49': '20_49',
                '50-249': '50_249',
                'GE250': '250_plus',
            }[component_size]

            for geo_code in selected_countries.keys():
                geo_pos = geo_index.get(geo_code)
                if geo_pos is None:
                    continue
                value = values.get(str(geo_pos))
                if value is None:
                    continue
                counts[geo_code][year][size_key] = float(value)

    rows = []
    for geo_code, country_name in selected_countries.items():
        per_year = counts[geo_code]

        series_10_49 = []
        series_50_249 = []
        series_250_plus = []

        for year in year_values:
            c10 = per_year[year].get('10_19')
            c20 = per_year[year].get('20_49')
            c50 = per_year[year].get('50_249')
            c250 = per_year[year].get('250_plus')

            count_10_49 = (c10 if c10 is not None else 0.0) + (c20 if c20 is not None else 0.0)
            series_10_49.append({'year': year, 'count': (count_10_49 if (c10 is not None or c20 is not None) else None)})
            series_50_249.append({'year': year, 'count': c50})
            series_250_plus.append({'year': year, 'count': c250})

        def growth_pct(series):
            available = [point for point in series if point['count'] is not None]
            if len(available) < 2:
                return None, None, None
            first = available[0]
            last = available[-1]
            if first['count'] == 0:
                return None, first['year'], last['year']
            return ((last['count'] - first['count']) / abs(first['count'])) * 100.0, first['year'], last['year']

        growth_10_49, from_10_49, to_10_49 = growth_pct(series_10_49)
        growth_50_249, from_50_249, to_50_249 = growth_pct(series_50_249)
        growth_250_plus, from_250_plus, to_250_plus = growth_pct(series_250_plus)

        rows.append({
            'geo': geo_code,
            'country': country_name,
            'growth_10_49': growth_10_49,
            'growth_50_249': growth_50_249,
            'growth_250_plus': growth_250_plus,
            'period_10_49': {'from_year': from_10_49, 'to_year': to_10_49},
            'period_50_249': {'from_year': from_50_249, 'to_year': to_50_249},
            'period_250_plus': {'from_year': from_250_plus, 'to_year': to_250_plus},
        })

    return {
        'dataset': 'SBS_SC_OVW',
        'indicator': 'Enterprises - number (growth by size class)',
        'nace_scope': 'B-S_X_O_S94',
        'start_year': int(start_year),
        'end_year': int(end_year),
        'rows': rows,
    }


def fetch_share_250_plus_vs_productivity_2024(start_year='2021', end_year='2024', quarter='Q4'):
    """Return scatter-ready rows of % change in company counts vs % change in productivity."""
    sbs_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw'
    namq_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/namq_10_lp_ulc'

    component_sizes = ['10-19', '20-49', '50-249', 'GE250']
    eu27_member_codes = {
        'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'EL',
        'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
        'SI', 'ES', 'SE'
    }

    geo_list = ['EU27_2020'] + sorted(eu27_member_codes)

    def fetch_company_counts_for_year(year_value):
        counts_by_geo = {
            geo: {
                'count_10_19': 0.0,
                'count_20_49': 0.0,
                'count_50_249': 0.0,
                'count_250_plus': 0.0,
                'country': geo,
            }
            for geo in geo_list
        }

        for component_size in component_sizes:
            params = {
                'lang': 'en',
                'freq': 'A',
                'indic_sbs': 'ENT_NR',
                'nace_r2': 'B-S_X_O_S94',
                'size_emp': component_size,
                'time': str(year_value),
                'geo': geo_list,
            }

            payload = None
            last_error = None
            for attempt in range(1, 4):
                try:
                    response = requests.get(sbs_url, params=params, timeout=40)
                    response.raise_for_status()
                    payload = response.json()
                    break
                except Exception as e:
                    last_error = e
                    print(f"SBS scatter fetch failed (attempt {attempt}/3, size_emp={component_size}, year={year_value}): {e}")
                    if attempt < 3:
                        time.sleep(1.2 * attempt)

            if payload is None:
                raise RuntimeError(f"SBS scatter fetch failed for size_emp={component_size}, year={year_value}: {last_error}")

            dimension = payload.get('dimension', {})
            geo_category = dimension.get('geo', {}).get('category', {})
            geo_index = geo_category.get('index', {})
            geo_labels = geo_category.get('label', {})
            values = payload.get('value', {})

            for geo_code in geo_list:
                geo_pos = geo_index.get(geo_code)
                if geo_pos is None:
                    continue

                value = values.get(str(geo_pos))
                if value is None:
                    continue

                counts_by_geo[geo_code]['country'] = geo_labels.get(geo_code, counts_by_geo[geo_code]['country'])

                if component_size == '10-19':
                    counts_by_geo[geo_code]['count_10_19'] += float(value)
                elif component_size == '20-49':
                    counts_by_geo[geo_code]['count_20_49'] += float(value)
                elif component_size == '50-249':
                    counts_by_geo[geo_code]['count_50_249'] += float(value)
                elif component_size == 'GE250':
                    counts_by_geo[geo_code]['count_250_plus'] += float(value)

        return counts_by_geo

    def fetch_productivity_for_time(year_value):
        time_code = f"{year_value}-{quarter}"
        prod_params = {
            'lang': 'en',
            'freq': 'Q',
            'unit': 'I20',
            's_adj': 'SCA',
            'na_item': 'RLPR_HW',
            'time': time_code,
            'geo': geo_list,
        }

        prod_payload = None
        last_error = None
        for attempt in range(1, 4):
            try:
                response = requests.get(namq_url, params=prod_params, timeout=40)
                response.raise_for_status()
                prod_payload = response.json()
                break
            except Exception as e:
                last_error = e
                print(f"NAMQ scatter fetch failed (attempt {attempt}/3, time={time_code}): {e}")
                if attempt < 3:
                    time.sleep(1.2 * attempt)

        if prod_payload is None:
            raise RuntimeError(f"NAMQ scatter fetch failed for time={time_code}: {last_error}")

        prod_geo_category = prod_payload.get('dimension', {}).get('geo', {}).get('category', {})
        prod_geo_index = prod_geo_category.get('index', {})
        prod_values = prod_payload.get('value', {})

        productivity_by_geo = {}
        for geo_code in geo_list:
            geo_pos = prod_geo_index.get(geo_code)
            if geo_pos is None:
                continue
            value = prod_values.get(str(geo_pos))
            if value is None:
                continue
            productivity_by_geo[geo_code] = float(value)

        return productivity_by_geo

    start_year_int = int(start_year)
    end_year_int = int(end_year)

    counts_start = fetch_company_counts_for_year(start_year_int)
    counts_end = fetch_company_counts_for_year(end_year_int)

    productivity_start = fetch_productivity_for_time(start_year_int)
    productivity_end = fetch_productivity_for_time(end_year_int)

    rows = []
    for geo_code in geo_list:
        if geo_code != 'EU27_2020' and geo_code not in eu27_member_codes:
            continue

        start_counts = counts_start.get(geo_code)
        end_counts = counts_end.get(geo_code)
        prod_start = productivity_start.get(geo_code)
        prod_end = productivity_end.get(geo_code)

        if start_counts is None or end_counts is None or prod_start is None or prod_end is None:
            continue

        start_10_49 = start_counts['count_10_19'] + start_counts['count_20_49']
        end_10_49 = end_counts['count_10_19'] + end_counts['count_20_49']
        start_50_249 = start_counts['count_50_249']
        end_50_249 = end_counts['count_50_249']
        start_250_plus = start_counts['count_250_plus']
        end_250_plus = end_counts['count_250_plus']

        if start_10_49 == 0 or start_50_249 == 0 or start_250_plus == 0 or prod_start == 0:
            continue

        change_10_49 = ((end_10_49 - start_10_49) / abs(start_10_49)) * 100.0
        change_50_249 = ((end_50_249 - start_50_249) / abs(start_50_249)) * 100.0
        change_250_plus = ((end_250_plus - start_250_plus) / abs(start_250_plus)) * 100.0
        productivity_change = ((prod_end - prod_start) / abs(prod_start)) * 100.0

        country_name = end_counts.get('country', geo_code)
        if geo_code == 'EU27_2020':
            country_name = 'European Union'

        rows.append({
            'geo': geo_code,
            'country': country_name,
            'company_change_10_49_pct': change_10_49,
            'company_change_50_249_pct': change_50_249,
            'company_change_250_plus_pct': change_250_plus,
            'productivity_change_pct': productivity_change,
        })

    rows.sort(key=lambda item: item['country'])

    def linear_regression_stats(points):
        n = len(points)
        if n < 2:
            return {'slope': None, 'intercept': None, 'r2': None, 'n': n}

        x_vals = [float(p[0]) for p in points]
        y_vals = [float(p[1]) for p in points]
        x_mean = sum(x_vals) / n
        y_mean = sum(y_vals) / n

        ss_xx = sum((x - x_mean) ** 2 for x in x_vals)
        if ss_xx == 0:
            return {'slope': None, 'intercept': None, 'r2': None, 'n': n}

        ss_xy = sum((x_vals[i] - x_mean) * (y_vals[i] - y_mean) for i in range(n))
        slope = ss_xy / ss_xx
        intercept = y_mean - slope * x_mean

        y_hat = [intercept + slope * x for x in x_vals]
        ss_res = sum((y_vals[i] - y_hat[i]) ** 2 for i in range(n))
        ss_tot = sum((y - y_mean) ** 2 for y in y_vals)
        r2 = (1.0 - (ss_res / ss_tot)) if ss_tot != 0 else None

        return {
            'slope': slope,
            'intercept': intercept,
            'r2': r2,
            'n': n,
        }

    points_10_49 = [(row['company_change_10_49_pct'], row['productivity_change_pct']) for row in rows]
    points_50_249 = [(row['company_change_50_249_pct'], row['productivity_change_pct']) for row in rows]
    points_250_plus = [(row['company_change_250_plus_pct'], row['productivity_change_pct']) for row in rows]

    return {
        'x_metric': 'Percentage change in number of companies by size class (%)',
        'x_dataset': 'SBS_SC_OVW',
        'x_start_year': start_year_int,
        'x_end_year': end_year_int,
        'y_metric': 'Percentage change in real labour productivity per hour worked (%)',
        'y_dataset': 'namq_10_lp_ulc',
        'y_start_time': f"{start_year_int}-{quarter}",
        'y_end_time': f"{end_year_int}-{quarter}",
        'regression': {
            'company_change_10_49_pct': linear_regression_stats(points_10_49),
            'company_change_50_249_pct': linear_regression_stats(points_50_249),
            'company_change_250_plus_pct': linear_regression_stats(points_250_plus),
        },
        'rows': rows,
    }


def fetch_company_size_levels_vs_productivity_2024(year='2024', quarter='Q4'):
    """Return scatter-ready rows of company size shares vs productivity level for a given year."""
    sbs_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw'
    namq_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/namq_10_lp_ulc'

    component_sizes = ['10-19', '20-49', '50-249', 'GE250']
    eu27_member_codes = {
        'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'EL',
        'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
        'SI', 'ES', 'SE'
    }

    geo_list = ['EU27_2020'] + sorted(eu27_member_codes)

    counts_by_geo = {
        geo: {
            'count_10_19': 0.0,
            'count_20_49': 0.0,
            'count_50_249': 0.0,
            'count_250_plus': 0.0,
            'country': geo,
        }
        for geo in geo_list
    }

    for component_size in component_sizes:
        params = {
            'lang': 'en',
            'freq': 'A',
            'indic_sbs': 'ENT_NR',
            'nace_r2': 'B-S_X_O_S94',
            'size_emp': component_size,
            'time': str(year),
            'geo': geo_list,
        }

        payload = None
        last_error = None
        for attempt in range(1, 4):
            try:
                response = requests.get(sbs_url, params=params, timeout=40)
                response.raise_for_status()
                payload = response.json()
                break
            except Exception as e:
                last_error = e
                print(f"SBS level-scatter fetch failed (attempt {attempt}/3, size_emp={component_size}, year={year}): {e}")
                if attempt < 3:
                    time.sleep(1.2 * attempt)

        if payload is None:
            raise RuntimeError(f"SBS level-scatter fetch failed for size_emp={component_size}, year={year}: {last_error}")

        dimension = payload.get('dimension', {})
        geo_category = dimension.get('geo', {}).get('category', {})
        geo_index = geo_category.get('index', {})
        geo_labels = geo_category.get('label', {})
        values = payload.get('value', {})

        for geo_code in geo_list:
            geo_pos = geo_index.get(geo_code)
            if geo_pos is None:
                continue

            value = values.get(str(geo_pos))
            if value is None:
                continue

            counts_by_geo[geo_code]['country'] = geo_labels.get(geo_code, counts_by_geo[geo_code]['country'])

            if component_size == '10-19':
                counts_by_geo[geo_code]['count_10_19'] += float(value)
            elif component_size == '20-49':
                counts_by_geo[geo_code]['count_20_49'] += float(value)
            elif component_size == '50-249':
                counts_by_geo[geo_code]['count_50_249'] += float(value)
            elif component_size == 'GE250':
                counts_by_geo[geo_code]['count_250_plus'] += float(value)

    time_code = f"{year}-{quarter}"
    prod_params = {
        'lang': 'en',
        'freq': 'Q',
        'unit': 'I20',
        's_adj': 'SCA',
        'na_item': 'RLPR_HW',
        'time': time_code,
        'geo': geo_list,
    }

    prod_payload = None
    last_error = None
    for attempt in range(1, 4):
        try:
            response = requests.get(namq_url, params=prod_params, timeout=40)
            response.raise_for_status()
            prod_payload = response.json()
            break
        except Exception as e:
            last_error = e
            print(f"NAMQ level-scatter fetch failed (attempt {attempt}/3, time={time_code}): {e}")
            if attempt < 3:
                time.sleep(1.2 * attempt)

    if prod_payload is None:
        raise RuntimeError(f"NAMQ level-scatter fetch failed for time={time_code}: {last_error}")

    prod_geo_category = prod_payload.get('dimension', {}).get('geo', {}).get('category', {})
    prod_geo_index = prod_geo_category.get('index', {})
    prod_values = prod_payload.get('value', {})

    productivity_by_geo = {}
    for geo_code in geo_list:
        geo_pos = prod_geo_index.get(geo_code)
        if geo_pos is None:
            continue
        value = prod_values.get(str(geo_pos))
        if value is None:
            continue
        productivity_by_geo[geo_code] = float(value)

    rows = []
    for geo_code in geo_list:
        if geo_code != 'EU27_2020' and geo_code not in eu27_member_codes:
            continue

        row = counts_by_geo.get(geo_code)
        if row is None:
            continue

        count_10_49 = row['count_10_19'] + row['count_20_49']
        count_50_249 = row['count_50_249']
        count_250_plus = row['count_250_plus']
        total = count_10_49 + count_50_249 + count_250_plus
        productivity = productivity_by_geo.get(geo_code)

        if total <= 0 or productivity is None:
            continue

        country_name = row.get('country', geo_code)
        if geo_code == 'EU27_2020':
            country_name = 'European Union'

        rows.append({
            'geo': geo_code,
            'country': country_name,
            'share_10_49': (count_10_49 / total) * 100.0,
            'share_50_249': (count_50_249 / total) * 100.0,
            'share_250_plus': (count_250_plus / total) * 100.0,
            'real_labour_productivity_per_hour': productivity,
        })

    rows.sort(key=lambda item: item['country'])

    def linear_regression_stats(points):
        n = len(points)
        if n < 2:
            return {'slope': None, 'intercept': None, 'r2': None, 'n': n}

        x_vals = [float(p[0]) for p in points]
        y_vals = [float(p[1]) for p in points]
        x_mean = sum(x_vals) / n
        y_mean = sum(y_vals) / n

        ss_xx = sum((x - x_mean) ** 2 for x in x_vals)
        if ss_xx == 0:
            return {'slope': None, 'intercept': None, 'r2': None, 'n': n}

        ss_xy = sum((x_vals[i] - x_mean) * (y_vals[i] - y_mean) for i in range(n))
        slope = ss_xy / ss_xx
        intercept = y_mean - slope * x_mean

        y_hat = [intercept + slope * x for x in x_vals]
        ss_res = sum((y_vals[i] - y_hat[i]) ** 2 for i in range(n))
        ss_tot = sum((y - y_mean) ** 2 for y in y_vals)
        r2 = (1.0 - (ss_res / ss_tot)) if ss_tot != 0 else None

        return {
            'slope': slope,
            'intercept': intercept,
            'r2': r2,
            'n': n,
        }

    points_10_49 = [(row['share_10_49'], row['real_labour_productivity_per_hour']) for row in rows]
    points_50_249 = [(row['share_50_249'], row['real_labour_productivity_per_hour']) for row in rows]
    points_250_plus = [(row['share_250_plus'], row['real_labour_productivity_per_hour']) for row in rows]

    return {
        'x_metric': 'Share of companies by size class (%)',
        'x_dataset': 'SBS_SC_OVW',
        'x_year': int(year),
        'y_metric': 'Real labour productivity per hour worked (index, I20, SCA)',
        'y_dataset': 'namq_10_lp_ulc',
        'y_time': time_code,
        'regression': {
            'share_10_49': linear_regression_stats(points_10_49),
            'share_50_249': linear_regression_stats(points_50_249),
            'share_250_plus': linear_regression_stats(points_250_plus),
        },
        'rows': rows,
    }


@app.route('/api/company-size-growth-selected-countries', methods=['GET'])
def get_company_size_growth_selected_countries():
    """Return growth in company counts by size class for EU + selected countries."""
    try:
        start_year = (request.args.get('start_year') or '2021').strip()
        end_year = (request.args.get('end_year') or '2024').strip()
        payload = fetch_sbs_company_size_growth_selected_countries(start_year=start_year, end_year=end_year)
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in company-size-growth-selected-countries endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/company-size-vs-productivity-scatter', methods=['GET'])
def get_company_size_vs_productivity_scatter():
    """Return scatter payload: company-size % changes vs productivity % changes."""
    try:
        start_year = (request.args.get('start_year') or '2021').strip()
        end_year = (request.args.get('end_year') or '2024').strip()
        quarter = (request.args.get('quarter') or 'Q4').strip().upper()
        payload = fetch_share_250_plus_vs_productivity_2024(start_year=start_year, end_year=end_year, quarter=quarter)
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in company-size-vs-productivity-scatter endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/company-size-vs-productivity-scatter-levels', methods=['GET'])
def get_company_size_vs_productivity_scatter_levels():
    """Return scatter payload: company size shares vs productivity level for the same year."""
    try:
        year = (request.args.get('year') or '2024').strip()
        quarter = (request.args.get('quarter') or 'Q4').strip().upper()
        payload = fetch_company_size_levels_vs_productivity_2024(year=year, quarter=quarter)
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in company-size-vs-productivity-scatter-levels endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def fetch_dii_size_very_high_vs_productivity(year='2025', quarter='Q3', size_emp='GE250'):
    """Return scatter-ready rows: very-high digital-intensity share for selected size class vs productivity level."""
    dii_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_e_dii'
    namq_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/namq_10_lp_ulc'

    allowed_sizes = {
        '10-49': '10 to 49 employees',
        '50-249': '50 to 249 employees',
        '10-249': '10 to 249 employees',
        'GE10': '10 or more employees',
        'GE250': '250 or more employees',
    }
    if size_emp not in allowed_sizes:
        raise ValueError(f"Unsupported size_emp '{size_emp}'. Allowed: {', '.join(allowed_sizes.keys())}")

    eu27_member_codes = {
        'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'EL',
        'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
        'SI', 'ES', 'SE'
    }
    geo_list = ['EU27_2020'] + sorted(eu27_member_codes)

    dii_params = {
        'lang': 'en',
        'freq': 'A',
        'size_emp': size_emp,
        'nace_r2': 'C10-S951_X_K',
        'unit': 'PC_ENT',
        'time': str(year),
        'indic_is': 'E_DI3_VHI',
        'geo': geo_list,
    }

    dii_payload = None
    last_error = None
    for attempt in range(1, 4):
        try:
            response = requests.get(dii_url, params=dii_params, timeout=40)
            response.raise_for_status()
            dii_payload = response.json()
            break
        except Exception as e:
            last_error = e
            print(f"DII size-VHI fetch failed (attempt {attempt}/3, year={year}, size_emp={size_emp}): {e}")
            if attempt < 3:
                time.sleep(1.2 * attempt)

    if dii_payload is None:
        raise RuntimeError(f"DII size-VHI fetch failed for year={year}, size_emp={size_emp}: {last_error}")

    dii_dimension = dii_payload.get('dimension', {})
    dii_geo_category = dii_dimension.get('geo', {}).get('category', {})
    dii_geo_index = dii_geo_category.get('index', {})
    dii_geo_labels = dii_geo_category.get('label', {})
    dii_values = dii_payload.get('value', {})

    dii_share_by_geo = {}
    country_by_geo = {}
    for geo_code in geo_list:
        geo_pos = dii_geo_index.get(geo_code)
        if geo_pos is None:
            continue
        value = dii_values.get(str(geo_pos))
        if value is None:
            continue
        dii_share_by_geo[geo_code] = float(value)
        country_by_geo[geo_code] = dii_geo_labels.get(geo_code, geo_code)

    time_code = f"{year}-{quarter}"
    prod_params = {
        'lang': 'en',
        'freq': 'Q',
        'unit': 'I20',
        's_adj': 'SCA',
        'na_item': 'RLPR_HW',
        'time': time_code,
        'geo': geo_list,
    }

    prod_payload = None
    last_error = None
    for attempt in range(1, 4):
        try:
            response = requests.get(namq_url, params=prod_params, timeout=40)
            response.raise_for_status()
            prod_payload = response.json()
            break
        except Exception as e:
            last_error = e
            print(f"NAMQ DII-scatter fetch failed (attempt {attempt}/3, time={time_code}): {e}")
            if attempt < 3:
                time.sleep(1.2 * attempt)

    if prod_payload is None:
        raise RuntimeError(f"NAMQ DII-scatter fetch failed for time={time_code}: {last_error}")

    prod_geo_category = prod_payload.get('dimension', {}).get('geo', {}).get('category', {})
    prod_geo_index = prod_geo_category.get('index', {})
    prod_values = prod_payload.get('value', {})

    productivity_by_geo = {}
    for geo_code in geo_list:
        geo_pos = prod_geo_index.get(geo_code)
        if geo_pos is None:
            continue
        value = prod_values.get(str(geo_pos))
        if value is None:
            continue
        productivity_by_geo[geo_code] = float(value)

    rows = []
    for geo_code in geo_list:
        dii_share = dii_share_by_geo.get(geo_code)
        productivity = productivity_by_geo.get(geo_code)
        if dii_share is None or productivity is None:
            continue

        country_name = country_by_geo.get(geo_code, geo_code)
        if geo_code == 'EU27_2020':
            country_name = 'European Union'

        rows.append({
            'geo': geo_code,
            'country': country_name,
            'dii_very_high_share': dii_share,
            'real_labour_productivity_per_hour': productivity,
        })

    rows.sort(key=lambda item: item['country'])

    n = len(rows)
    regression = {'slope': None, 'intercept': None, 'r2': None, 'n': n}
    if n >= 2:
        x_vals = [float(item['dii_very_high_share']) for item in rows]
        y_vals = [float(item['real_labour_productivity_per_hour']) for item in rows]
        x_mean = sum(x_vals) / n
        y_mean = sum(y_vals) / n
        ss_xx = sum((x - x_mean) ** 2 for x in x_vals)
        if ss_xx != 0:
            ss_xy = sum((x_vals[i] - x_mean) * (y_vals[i] - y_mean) for i in range(n))
            slope = ss_xy / ss_xx
            intercept = y_mean - slope * x_mean
            y_hat = [intercept + slope * x for x in x_vals]
            ss_res = sum((y_vals[i] - y_hat[i]) ** 2 for i in range(n))
            ss_tot = sum((y - y_mean) ** 2 for y in y_vals)
            r2 = (1.0 - (ss_res / ss_tot)) if ss_tot != 0 else None
            regression = {'slope': slope, 'intercept': intercept, 'r2': r2, 'n': n}

    return {
        'x_metric': 'Very high digital intensity share among selected company size class (%)',
        'x_dataset': 'isoc_e_dii',
        'x_year': int(year),
        'size_class': size_emp,
        'size_label': allowed_sizes[size_emp],
        'y_metric': 'Real labour productivity per hour worked (index, I20, SCA)',
        'y_dataset': 'namq_10_lp_ulc',
        'y_time': time_code,
        'regression': regression,
        'rows': rows,
    }


@app.route('/api/dii-ge250-very-high-vs-productivity-scatter', methods=['GET'])
def get_dii_ge250_very_high_vs_productivity_scatter():
    """Return scatter payload: very-high digital intensity share (selected size class) vs productivity."""
    try:
        year = (request.args.get('year') or '2025').strip()
        quarter = (request.args.get('quarter') or 'Q3').strip().upper()
        size_emp = (request.args.get('size_emp') or 'GE250').strip()
        payload = fetch_dii_size_very_high_vs_productivity(year=year, quarter=quarter, size_emp=size_emp)
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in dii-ge250-very-high-vs-productivity-scatter endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/italy-treasury-dashboard', methods=['GET'])
def get_italy_treasury_dashboard():
    """Return top foreign holders of Italian government debt securities (CPIS)."""
    return build_cpis_foreign_holders_dashboard('IT', 'Italian')


@app.route('/api/spain-treasury-dashboard', methods=['GET'])
def get_spain_treasury_dashboard():
    """Return top foreign holders of Spanish government debt securities (CPIS)."""
    return build_cpis_foreign_holders_dashboard('ES', 'Spanish')


@app.route('/api/france-treasury-dashboard', methods=['GET'])
def get_france_treasury_dashboard():
    """Return top foreign holders of French government debt securities (CPIS)."""
    return build_cpis_foreign_holders_dashboard('FR', 'French')


@app.route('/api/germany-treasury-dashboard', methods=['GET'])
def get_germany_treasury_dashboard():
    """Return top foreign holders of German government debt securities (CPIS)."""
    return build_cpis_foreign_holders_dashboard('DE', 'German')


@app.route('/api/belgium-treasury-dashboard', methods=['GET'])
def get_belgium_treasury_dashboard():
    """Return top foreign holders of Belgian government debt securities (CPIS)."""
    return build_cpis_foreign_holders_dashboard('BE', 'Belgian')


@app.route('/api/poland-treasury-dashboard', methods=['GET'])
def get_poland_treasury_dashboard():
    """Return top foreign holders of Polish government debt securities (CPIS)."""
    return build_cpis_foreign_holders_dashboard('PL', 'Polish')


@app.route('/api/tradingeconomics-productivity', methods=['GET'])
def get_tradingeconomics_productivity():
    """Return TradingEconomics productivity summary for a country slug."""
    try:
        country = (request.args.get('country') or '').strip().lower()
        if not country:
            return jsonify({'error': 'Missing required query param: country'}), 400

        payload = fetch_te_productivity(country)
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in tradingeconomics-productivity endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/tradingeconomics-top-tax-rate', methods=['GET'])
def get_tradingeconomics_top_tax_rate():
    """Return TradingEconomics top personal income tax rate information for a country slug."""
    try:
        country = (request.args.get('country') or '').strip().lower()
        if not country:
            return jsonify({'error': 'Missing required query param: country'}), 400

        payload = fetch_te_top_tax_rate(country)
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in tradingeconomics-top-tax-rate endpoint: {e}")
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
