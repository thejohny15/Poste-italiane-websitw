"""
Simple Flask API server to fetch economic data
Fetches Core CPI, Headline CPI from FRED and Oil prices from Yahoo Finance
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, timezone
import requests
import re
import json
import base64
import zlib
import os
from io import StringIO
import time
from typing import Any
from pathlib import Path
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
from concurrent.futures import ThreadPoolExecutor

app = Flask(__name__)
CORS(app)  # Enable CORS for browser requests

DATA_CACHE: dict[str, Any] = {
    'us_equity_holders': None,
    'us_equity_holders_percentage': None,
    'us_equity_holders_percentage_sp500': None,
    'us_equity_updated_at': None,
}

US_REAL_ENERGY_CACHE: dict[tuple[int, int], dict[str, Any]] = {}
US_REAL_ENERGY_CACHE_TTL_SECONDS = 3600
EUROSTAT_COUNTRY_FUEL_CACHE: dict[str, dict[str, Any]] = {}
EUROSTAT_COUNTRY_FUEL_CACHE_TTL_SECONDS = 3600
EUROZONE_OIL_GAS_SPLIT_CACHE: dict[str, Any] = {}
EUROZONE_OIL_GAS_SPLIT_CACHE_TTL_SECONDS = 3600
EMBER_EUROPE_ELECTRICITY_SHARE_CACHE: dict[str, Any] = {}
EMBER_EUROPE_ELECTRICITY_SHARE_CACHE_TTL_SECONDS = 12 * 3600
EMBER_MONTHLY_DF_CACHE: dict[str, Any] = {
    'computed_at': 0.0,
    'df': None,
}
EMBER_MONTHLY_DF_CACHE_TTL_SECONDS = 6 * 3600
EMBER_MONTHLY_CSV_URL = 'https://files.ember-energy.org/public-downloads/monthly_full_release_long_format.csv'
TE_MARKETS_BASE_URL = 'https://d3ii0wo49og5mi.cloudfront.net/markets'
TE_CHARTS_TOKEN = '20240229:nazare'
TE_CHARTS_OBFUSCATION_KEY = 'tradingeconomics-charts-core-api-key'
TE_EU_GAS_SYMBOL = 'ngeu:com'
EIA_INTERNATIONAL_BASE_URL = 'https://api.eia.gov/v2/international/data/'
EIA_API_KEY_DEFAULT = os.getenv('EIA_API_KEY', 'DEMO_KEY')
EIA_CONSUMPTION_API_KEY_DEFAULT = os.getenv('EIA_CONSUMPTION_API_KEY', EIA_API_KEY_DEFAULT)
EIA_WORLD_OIL_COUNTRIES = {
    'WORL': 'world_tbpd',
    'USA': 'united_states_tbpd',
    'RUS': 'russia_tbpd',
    'SAU': 'saudi_arabia_tbpd',
    'KWT': 'kuwait_tbpd',
    'QAT': 'qatar_tbpd',
    'ARE': 'uae_tbpd',
    'IRQ': 'iraq_tbpd',
}
EIA_WORLD_OIL_PRODUCTION_CACHE: dict[str, Any] = {}
EIA_WORLD_OIL_PRODUCTION_CACHE_TTL_SECONDS = 6 * 3600
EIA_WORLD_OIL_CONSUMPTION_CACHE: dict[str, Any] = {}
EIA_WORLD_OIL_CONSUMPTION_CACHE_TTL_SECONDS = 6 * 3600
EIA_WORLD_EXPORTERS_SHARE_CACHE: dict[str, Any] = {}
EIA_WORLD_EXPORTERS_SHARE_CACHE_TTL_SECONDS = 6 * 3600
EIA_DISK_CACHE_DIR = Path(__file__).resolve().parent / '.cache' / 'eia'
EIA_DISK_CACHE_MAX_AGE_SECONDS = 7 * 24 * 3600

EUROZONE_MEMBER_CODES = {
    'AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'EL', 'IE',
    'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES'
}
EUROZONE_PLUS_POLAND_CODES = EUROZONE_MEMBER_CODES | {'PL'}
EUROZONE_AGG_GEO = 'EZ_AGG'
EUROZONE_AGG_LABEL = 'Eurozone (aggregate)'


def append_unweighted_aggregate_row(rows, metric_keys, aggregate_geo_codes=None):
    """Append an unweighted aggregate row (mean across available countries) for the given metrics."""
    if not rows:
        return

    geo_codes = aggregate_geo_codes or EUROZONE_MEMBER_CODES
    base_rows = [row for row in rows if row.get('geo') in geo_codes]
    if not base_rows:
        return

    aggregate: dict[str, Any] = {
        'geo': EUROZONE_AGG_GEO,
        'country': EUROZONE_AGG_LABEL,
    }

    for key in metric_keys:
        values = [row.get(key) for row in base_rows if row.get(key) is not None]
        if not values:
            return
        aggregate[key] = sum(values) / len(values)

    rows.append(aggregate)


def _eia_disk_cache_file(cache_key):
    safe_name = re.sub(r'[^a-zA-Z0-9._-]+', '_', str(cache_key))
    return EIA_DISK_CACHE_DIR / f"{safe_name}.json"


def load_eia_disk_cache_payload(cache_key, max_age_seconds: int | None = EIA_DISK_CACHE_MAX_AGE_SECONDS):
    try:
        path = _eia_disk_cache_file(cache_key)
        if not path.exists():
            return None
        with path.open('r', encoding='utf-8') as handle:
            wrapped = json.load(handle)
        computed_at = float((wrapped or {}).get('computed_at') or 0.0)
        payload = (wrapped or {}).get('payload')
        if not payload:
            return None
        if max_age_seconds is not None and computed_at > 0 and (time.time() - computed_at) > max_age_seconds:
            return None
        return payload
    except Exception:
        return None


def save_eia_disk_cache_payload(cache_key, payload):
    try:
        EIA_DISK_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path = _eia_disk_cache_file(cache_key)
        wrapped = {
            'computed_at': time.time(),
            'payload': payload,
        }
        with path.open('w', encoding='utf-8') as handle:
            json.dump(wrapped, handle)
    except Exception:
        return


def load_latest_eia_disk_cache_payload_by_prefix(prefix):
    try:
        if not EIA_DISK_CACHE_DIR.exists():
            return None

        matched = []
        for path in EIA_DISK_CACHE_DIR.glob('*.json'):
            try:
                safe_prefix = re.sub(r'[^a-zA-Z0-9._-]+', '_', str(prefix or ''))
                if safe_prefix and not path.name.startswith(safe_prefix):
                    continue
                with path.open('r', encoding='utf-8') as handle:
                    wrapped = json.load(handle)
                computed_at = float((wrapped or {}).get('computed_at') or 0.0)
                payload = (wrapped or {}).get('payload')
                if payload:
                    matched.append((computed_at, payload))
            except Exception:
                continue

        if not matched:
            return None

        matched.sort(key=lambda item: item[0], reverse=True)
        return matched[0][1]
    except Exception:
        return None


def build_source_url_with_api_key(source_url, api_key):
    """Return source_url with api_key query param injected when missing."""
    raw_url = str(source_url or '').strip()
    raw_key = str(api_key or '').strip()
    if not raw_url:
        return raw_url

    try:
        parsed = urlparse(raw_url)
        query_items = parse_qsl(parsed.query, keep_blank_values=True)
        has_api_key = any(k == 'api_key' and str(v or '').strip() for (k, v) in query_items)
        if raw_key and not has_api_key:
            query_items.append(('api_key', raw_key))
        new_query = urlencode(query_items, doseq=True)
        return urlunparse(parsed._replace(query=new_query))
    except Exception:
        return raw_url


def override_source_activity_id(source_url, activity_id):
    """Return source_url with facets[activityId][] overridden to the given activity id."""
    raw_url = str(source_url or '').strip()
    if not raw_url:
        return raw_url

    try:
        parsed = urlparse(raw_url)
        query_items = parse_qsl(parsed.query, keep_blank_values=True)
        filtered = [(k, v) for (k, v) in query_items if k != 'facets[activityId][]']
        filtered.append(('facets[activityId][]', str(activity_id)))
        new_query = urlencode(filtered, doseq=True)
        return urlunparse(parsed._replace(query=new_query))
    except Exception:
        return raw_url


def override_source_facets(source_url, activity_id=None, product_id=None, unit=None):
    """Return source_url with selected EIA facet query parameters overridden."""
    raw_url = str(source_url or '').strip()
    if not raw_url:
        return raw_url

    try:
        parsed = urlparse(raw_url)
        query_items = parse_qsl(parsed.query, keep_blank_values=True)
        skip_keys = {'facets[activityId][]', 'facets[productId][]', 'facets[unit][]'}
        filtered = [(k, v) for (k, v) in query_items if k not in skip_keys]
        if activity_id is not None:
            filtered.append(('facets[activityId][]', str(activity_id)))
        if product_id is not None:
            filtered.append(('facets[productId][]', str(product_id)))
        if unit is not None:
            filtered.append(('facets[unit][]', str(unit)))
        new_query = urlencode(filtered, doseq=True)
        return urlunparse(parsed._replace(query=new_query))
    except Exception:
        return raw_url


def drop_source_country_facets(source_url):
    """Return source_url without countryRegion facet filters."""
    raw_url = str(source_url or '').strip()
    if not raw_url:
        return raw_url

    try:
        parsed = urlparse(raw_url)
        query_items = parse_qsl(parsed.query, keep_blank_values=True)
        filtered = [(k, v) for (k, v) in query_items if k != 'facets[countryRegionId][]']
        new_query = urlencode(filtered, doseq=True)
        return urlunparse(parsed._replace(query=new_query))
    except Exception:
        return raw_url

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

def fetch_fred_data(series_id, start_date, end_date, api_key="demo", timeout_seconds=12, max_attempts=2):
    """Fetch data from FRED API"""
    try:
        params = {
            'series_id': series_id,
            'api_key': api_key,
            'file_type': 'json',
            'observation_start': start_date,
            'observation_end': end_date
        }
        last_error = None
        for attempt in range(1, max_attempts + 1):
            try:
                response = requests.get(FRED_BASE, params=params, timeout=timeout_seconds)
                response.raise_for_status()
                data = response.json()

                if 'observations' in data:
                    return [(obs['date'], float(obs['value'])) for obs in data['observations'] if obs['value'] != '.']
                return []
            except Exception as e:
                last_error = e
                if attempt < max_attempts:
                    time.sleep(0.8 * attempt)

        print(f"FRED fetch failed for {series_id} after {max_attempts} attempts: {last_error}")
        return []
    except Exception as e:
        print(f"Error fetching FRED data: {e}")
        return []


def decode_te_charts_payload(payload_text, obfuscation_key=TE_CHARTS_OBFUSCATION_KEY):
    """Decode TradingEconomics chart payload (base64 + XOR + gzip)."""
    payload = str(payload_text or '').strip()
    if not payload:
        return None

    if payload.startswith('"'):
        payload = json.loads(payload)

    raw = base64.b64decode(payload)
    key_bytes = obfuscation_key.encode('utf-8')
    data = bytearray(raw)
    for index in range(len(data)):
        data[index] ^= key_bytes[index % len(key_bytes)]

    decoded = zlib.decompress(bytes(data), 16 + zlib.MAX_WBITS).decode('utf-8')
    return json.loads(decoded)


def fetch_tradingeconomics_market_daily_series(symbol=TE_EU_GAS_SYMBOL, span='10y', interval='1d'):
    """Fetch daily market series from TradingEconomics chart endpoint."""
    url = f"{TE_MARKETS_BASE_URL}/{symbol}?interval={interval}&span={span}&key={TE_CHARTS_TOKEN}"
    response = requests.get(url, timeout=20)
    response.raise_for_status()

    decoded = decode_te_charts_payload(response.text)
    if not isinstance(decoded, dict):
        return []

    series_block = decoded.get('series')
    if not isinstance(series_block, list) or not series_block:
        return []

    rows = series_block[0].get('data')
    if not isinstance(rows, list):
        return []

    daily = []
    for row in rows:
        if not isinstance(row, list) or len(row) < 2:
            continue
        ts = row[0]
        price = row[1]
        if ts is None or price is None:
            continue
        try:
            dt = datetime.utcfromtimestamp(float(ts))
            daily.append((dt.strftime('%Y-%m-%d'), float(price)))
        except Exception:
            continue

    return daily


def get_ember_monthly_long_df(force_refresh=False):
    """Return cached Ember monthly long-format dataframe used by energy charts."""
    now_ts = time.time()
    cached_df = EMBER_MONTHLY_DF_CACHE.get('df')
    cached_at = EMBER_MONTHLY_DF_CACHE.get('computed_at', 0.0)

    if not force_refresh and cached_df is not None and (now_ts - cached_at) < EMBER_MONTHLY_DF_CACHE_TTL_SECONDS:
        return cached_df

    df = pd.read_csv(
        EMBER_MONTHLY_CSV_URL,
        usecols=['Area', 'Date', 'Category', 'Variable', 'Unit', 'Value']
    )
    EMBER_MONTHLY_DF_CACHE['df'] = df
    EMBER_MONTHLY_DF_CACHE['computed_at'] = now_ts
    return df


def normalize_area_name(area_name):
    return re.sub(r'[^a-z0-9]+', '', str(area_name or '').strip().lower())


def ember_area_aliases(entity_name):
    normalized = normalize_area_name(entity_name)
    aliases = {normalized}
    if normalized in {'europe', 'eu', 'europeanunion', 'eu27', 'eu272020'}:
        aliases.update({'europe', 'eu', 'eu27', 'eu272020', 'europeanunion'})
    return aliases


def fetch_ember_europe_electricity_share_monthly(date_from='2021-01-01', date_to=None, entity='Europe'):
    """Fetch monthly electricity generation percentage shares for Europe/EU from Ember monthly dataset."""
    if date_to is None:
        date_to = datetime.utcnow().strftime('%Y-%m-%d')

    now_ts = time.time()
    entity_norm = str(entity or 'Europe').strip()
    cache_key = f'monthly_pct_share::{entity_norm}'
    cached = EMBER_EUROPE_ELECTRICITY_SHARE_CACHE.get(cache_key)

    if cached and (now_ts - cached.get('computed_at', 0)) < EMBER_EUROPE_ELECTRICITY_SHARE_CACHE_TTL_SECONDS:
        records = cached.get('records', [])
    else:
        df = get_ember_monthly_long_df()
        area_aliases = ember_area_aliases(entity_norm)
        area_norm = df['Area'].astype(str).map(normalize_area_name)

        target_variables = [
            'Solar',
            'Wind',
            'Hydro',
            'Bioenergy',
            'Other renewables',
            'Nuclear',
            'Gas',
            'Coal',
            'Other fossil',
        ]

        filtered = df[
            (area_norm.isin(area_aliases)) &
            (df['Category'] == 'Electricity generation') &
            (df['Unit'] == '%') &
            (df['Variable'].isin(target_variables))
        ].copy()

        filtered['Date'] = pd.to_datetime(filtered['Date'], errors='coerce')
        filtered['Value'] = pd.to_numeric(filtered['Value'], errors='coerce')
        filtered = filtered.dropna(subset=['Date', 'Value'])

        pivot = filtered.pivot_table(
            index='Date',
            columns='Variable',
            values='Value',
            aggfunc='mean'
        ).sort_index()

        for variable in target_variables:
            if variable not in pivot.columns:
                pivot[variable] = np.nan

        key_map = {
            'Solar': 'solar',
            'Wind': 'wind',
            'Hydro': 'hydro',
            'Bioenergy': 'bioenergy',
            'Other renewables': 'other_renewables',
            'Nuclear': 'nuclear',
            'Gas': 'gas',
            'Coal': 'coal',
            'Other fossil': 'other_fossil',
        }

        records = []
        for idx, row in pivot.iterrows():
            idx_ts = pd.to_datetime(str(idx), errors='coerce')
            if pd.isna(idx_ts):
                continue
            point: dict[str, Any] = {
                'date': idx_ts.strftime('%Y-%m-%d'),
            }
            for original_name in target_variables:
                key = key_map[original_name]
                val = row.get(original_name)
                point[key] = float(val) if pd.notna(val) else None
            records.append(point)

        if filtered.empty and ('eu' in area_aliases or 'europe' in area_aliases):
            fallback_area_aliases = {'eu', 'europe'}
            filtered = df[
                (area_norm.isin(fallback_area_aliases)) &
                (df['Category'] == 'Electricity generation') &
                (df['Unit'] == '%') &
                (df['Variable'].isin(target_variables))
            ].copy()
            filtered['Date'] = pd.to_datetime(filtered['Date'], errors='coerce')
            filtered['Value'] = pd.to_numeric(filtered['Value'], errors='coerce')
            filtered = filtered.dropna(subset=['Date', 'Value'])

            pivot = filtered.pivot_table(
                index='Date',
                columns='Variable',
                values='Value',
                aggfunc='mean'
            ).sort_index()

            for variable in target_variables:
                if variable not in pivot.columns:
                    pivot[variable] = np.nan

            records = []
            for idx, row in pivot.iterrows():
                idx_ts = pd.to_datetime(str(idx), errors='coerce')
                if pd.isna(idx_ts):
                    continue
                point: dict[str, Any] = {
                    'date': idx_ts.strftime('%Y-%m-%d'),
                }
                for original_name in target_variables:
                    key = key_map[original_name]
                    val = row.get(original_name)
                    point[key] = float(val) if pd.notna(val) else None
                records.append(point)
            if not filtered.empty:
                entity_norm = 'EU'

        EMBER_EUROPE_ELECTRICITY_SHARE_CACHE[cache_key] = {
            'computed_at': now_ts,
            'records': records,
            'entity': entity_norm,
        }

    start_dt = pd.to_datetime(date_from, errors='coerce')
    end_dt = pd.to_datetime(date_to, errors='coerce')

    filtered_records = []
    for point in records:
        point_dt = pd.to_datetime(str(point.get('date')), errors='coerce')
        if pd.isna(point_dt):
            continue
        if not pd.isna(start_dt) and point_dt < start_dt:
            continue
        if not pd.isna(end_dt) and point_dt > end_dt:
            continue
        filtered_records.append(point)

    return {
        'dataset': 'Ember monthly electricity data (long format)',
        'dataset_url': EMBER_MONTHLY_CSV_URL,
        'entity': entity_norm,
        'metric': 'pct_share',
        'frequency': 'monthly',
        'start_date': filtered_records[0]['date'] if filtered_records else None,
        'end_date': filtered_records[-1]['date'] if filtered_records else None,
        'keys': [
            'solar', 'wind', 'hydro', 'bioenergy', 'other_renewables',
            'nuclear', 'gas', 'coal', 'other_fossil'
        ],
        'points': filtered_records,
    }


@app.route('/api/europe-electricity-share-monthly', methods=['GET'])
def get_europe_electricity_share_monthly():
    """Return monthly electricity generation shares for EU (stacked share categories)."""
    try:
        date_from = request.args.get('date_from', '2021-01-01')
        date_to = request.args.get('date_to', '2025-12-01')
        entity = request.args.get('entity', 'Europe')
        payload = fetch_ember_europe_electricity_share_monthly(date_from=date_from, date_to=date_to, entity=entity)
        return jsonify(payload)
    except Exception as e:
        print(f"Error in europe-electricity-share-monthly endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def fetch_europe_electricity_use_and_fossil_prices_monthly(date_from='2021-01-01', date_to='2025-12-01', entity='Europe'):
    """Return monthly total generation and gas/coal generation (TWh) with gas/coal prices for Europe."""
    entity_norm = str(entity or 'Europe').strip()

    df = get_ember_monthly_long_df()
    area_aliases = ember_area_aliases(entity_norm)
    area_norm = df['Area'].astype(str).map(normalize_area_name)

    target_variables = ['Total Generation', 'Gas', 'Coal']
    filtered = df[
        (area_norm.isin(area_aliases)) &
        (df['Category'] == 'Electricity generation') &
        (df['Unit'] == 'TWh') &
        (df['Variable'].isin(target_variables))
    ].copy()

    if filtered.empty and ('eu' in area_aliases or 'europe' in area_aliases):
        fallback_area_aliases = {'eu', 'europe'}
        filtered = df[
            (area_norm.isin(fallback_area_aliases)) &
            (df['Category'] == 'Electricity generation') &
            (df['Unit'] == 'TWh') &
            (df['Variable'].isin(target_variables))
        ].copy()
        if not filtered.empty:
            entity_norm = 'EU'

    filtered['Date'] = pd.to_datetime(filtered['Date'], errors='coerce')
    filtered['Value'] = pd.to_numeric(filtered['Value'], errors='coerce')
    filtered = filtered.dropna(subset=['Date', 'Value'])

    pivot = filtered.pivot_table(
        index='Date',
        columns='Variable',
        values='Value',
        aggfunc='mean'
    ).sort_index()

    for variable in target_variables:
        if variable not in pivot.columns:
            pivot[variable] = np.nan

    gas_price_source = 'TradingEconomics NGEU:COM'
    try:
        te_daily_series = fetch_tradingeconomics_market_daily_series(symbol=TE_EU_GAS_SYMBOL, span='10y', interval='1d')
        gas_price_map = monthly_average_from_daily(te_daily_series)
    except Exception as exc:
        print(f"TradingEconomics gas fetch failed, falling back to FRED PNGASEUUSDM: {exc}")
        gas_price_source = 'FRED PNGASEUUSDM (fallback)'
        gas_price_series = fetch_fred_data('PNGASEUUSDM', date_from, date_to, FRED_API_KEY)
        gas_price_map = {str(date)[:7]: float(value) for date, value in gas_price_series}

    coal_price_series = fetch_fred_data('PCOALAUUSDM', date_from, date_to, FRED_API_KEY)
    coal_price_map = {str(date)[:7]: float(value) for date, value in coal_price_series}

    start_dt = pd.to_datetime(date_from, errors='coerce')
    end_dt = pd.to_datetime(date_to, errors='coerce')

    points = []
    for idx, row in pivot.iterrows():
        idx_ts = pd.to_datetime(str(idx), errors='coerce')
        if pd.isna(idx_ts):
            continue
        if not pd.isna(start_dt) and idx_ts < start_dt:
            continue
        if not pd.isna(end_dt) and idx_ts > end_dt:
            continue

        month_key = idx_ts.strftime('%Y-%m')
        total_generation_value = to_float_or_none(row.get('Total Generation'))
        gas_generation_value = to_float_or_none(row.get('Gas'))
        coal_generation_value = to_float_or_none(row.get('Coal'))
        gas_price_value = gas_price_map.get(month_key)
        points.append({
            'date': idx_ts.strftime('%Y-%m-%d'),
            'total_generation_twh': total_generation_value,
            'gas_generation_twh': gas_generation_value,
            'coal_generation_twh': coal_generation_value,
            'eu_natural_gas_price_eur_per_mwh': gas_price_value,
            'eu_natural_gas_price_usd_per_mmbtu': gas_price_value,
            'coal_price_usd_per_ton': coal_price_map.get(month_key),
        })

    return {
        'dataset': 'Ember monthly electricity data + FRED commodity prices',
        'entity': entity_norm,
        'frequency': 'monthly',
        'start_date': points[0]['date'] if points else None,
        'end_date': points[-1]['date'] if points else None,
        'points': points,
        'price_series': {
            'eu_natural_gas': gas_price_source,
            'eu_natural_gas_unit': 'EUR/MWh',
            'coal': 'PCOALAUUSDM',
            'coal_unit': 'USD/ton',
        }
    }


def parse_month_period(period_value):
    period = str(period_value or '').strip()
    if not period:
        return None

    for fmt in ('%Y-%m', '%Y-%m-%d', '%Y%m'):
        try:
            return datetime.strptime(period, fmt)
        except ValueError:
            continue

    if re.match(r'^\d{4}$', period):
        try:
            return datetime.strptime(f"{period}-01", '%Y-%m')
        except ValueError:
            return None

    return None


def parse_year_period(period_value):
    period = str(period_value or '').strip()
    if not period:
        return None

    if re.match(r'^\d{4}$', period):
        try:
            return datetime.strptime(period, '%Y')
        except ValueError:
            return None

    for fmt in ('%Y-%m', '%Y-%m-%d'):
        try:
            return datetime.strptime(period, fmt)
        except ValueError:
            continue

    return None


def fetch_eia_world_oil_production_monthly(api_key=None, date_from='2018-01', date_to=None, source_url=None):
    """Fetch monthly oil production (TBPD) for World + selected producers from EIA v2."""
    effective_source_url = str(source_url or '').strip()
    effective_api_key = str(api_key or EIA_API_KEY_DEFAULT).strip()
    if not effective_source_url and not effective_api_key:
        raise ValueError('Missing EIA api_key. Provide api_key query parameter or set EIA_API_KEY_DEFAULT.')

    if not date_to:
        date_to = datetime.utcnow().strftime('%Y-%m')

    country_signature = ','.join(sorted(EIA_WORLD_OIL_COUNTRIES.keys()))
    source_signature = effective_source_url if effective_source_url else 'default'
    cache_key = f"v3:{date_from}:{date_to}:{country_signature}:{source_signature}"
    cached = EIA_WORLD_OIL_PRODUCTION_CACHE.get(cache_key)
    now_ts = time.time()
    if cached and (now_ts - cached.get('computed_at', 0.0)) < EIA_WORLD_OIL_PRODUCTION_CACHE_TTL_SECONDS:
        cached_payload = cached.get('payload') or {}
        cached_points = cached_payload.get('points') or []
        cached_has_us = bool(cached_points) and ('united_states_tbpd' in cached_points[0])
        if cached_has_us:
            return cached_payload

    disk_cached = load_eia_disk_cache_payload(cache_key)
    if disk_cached:
        EIA_WORLD_OIL_PRODUCTION_CACHE[cache_key] = {
            'computed_at': now_ts,
            'payload': disk_cached,
        }
        return disk_cached

    try:
        if effective_source_url:
            source_with_key = build_source_url_with_api_key(effective_source_url, effective_api_key)
            response = requests.get(source_with_key, timeout=60)
        else:
            params = {
                'api_key': effective_api_key,
                'frequency': 'monthly',
                'data[0]': 'value',
                'facets[activityId][]': '1',
                'facets[productId][]': '53',
                'facets[unit][]': 'TBPD',
                'start': date_from,
                'end': date_to,
                'sort[0][column]': 'period',
                'sort[0][direction]': 'asc',
                'offset': 0,
                'length': 5000,
            }

            for country_code in EIA_WORLD_OIL_COUNTRIES.keys():
                params[f'facets[countryRegionId][]'] = params.get('facets[countryRegionId][]', [])
                if isinstance(params['facets[countryRegionId][]'], list):
                    params['facets[countryRegionId][]'].append(country_code)

            response = requests.get(EIA_INTERNATIONAL_BASE_URL, params=params, timeout=40)
        response.raise_for_status()
    except Exception:
        fallback_payload = load_eia_disk_cache_payload(cache_key, max_age_seconds=None)
        if fallback_payload:
            EIA_WORLD_OIL_PRODUCTION_CACHE[cache_key] = {
                'computed_at': now_ts,
                'payload': fallback_payload,
            }
            return fallback_payload
        raise
    payload_json = response.json()

    rows = payload_json.get('response', {}).get('data', [])
    if not isinstance(rows, list):
        rows = []

    by_period: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue

        country_code = str(row.get('countryRegionId') or '').strip()
        period = str(row.get('period') or '').strip()
        metric_key = EIA_WORLD_OIL_COUNTRIES.get(country_code)

        if not metric_key or not period:
            continue

        period_dt = parse_month_period(period)
        if period_dt is None:
            continue

        period_key = period_dt.strftime('%Y-%m-01')
        point = by_period.setdefault(period_key, {
            'date': period_key,
            'world_tbpd': None,
            'united_states_tbpd': None,
            'russia_tbpd': None,
            'saudi_arabia_tbpd': None,
            'kuwait_tbpd': None,
            'qatar_tbpd': None,
            'uae_tbpd': None,
            'iraq_tbpd': None,
        })

        value = to_float_or_none(row.get('value'))
        point[metric_key] = value

    start_dt = parse_month_period(date_from)
    end_dt = parse_month_period(date_to)

    points = []
    for _, point in sorted(by_period.items(), key=lambda item: item[0]):
        point_dt = parse_month_period(point.get('date'))
        if point_dt is None:
            continue
        if start_dt is not None and point_dt < start_dt:
            continue
        if end_dt is not None and point_dt > end_dt:
            continue
        points.append(point)

    payload = {
        'dataset': 'EIA International Data Browser / API v2',
        'dataset_url': EIA_INTERNATIONAL_BASE_URL,
        'metric': 'monthly_oil_production',
        'unit': 'thousand barrels per day',
        'unit_code': 'TBPD',
        'frequency': 'monthly',
        'start_date': points[0]['date'] if points else None,
        'end_date': points[-1]['date'] if points else None,
        'countries': [
            'World',
            'United States',
            'Russia',
            'Saudi Arabia',
            'Kuwait',
            'Qatar',
            'United Arab Emirates',
            'Iraq',
        ],
        'points': points,
    }

    EIA_WORLD_OIL_PRODUCTION_CACHE[cache_key] = {
        'computed_at': now_ts,
        'payload': payload,
    }
    save_eia_disk_cache_payload(cache_key, payload)
    return payload


def fetch_eia_world_oil_consumption_annual(api_key=None, date_from='2018', date_to=None, source_url=None):
    """Fetch annual world oil consumption growth (% from 2018 baseline) from EIA v2."""
    effective_source_url = str(source_url or '').strip()
    effective_api_key = str(api_key or EIA_CONSUMPTION_API_KEY_DEFAULT).strip()
    if not effective_source_url and not effective_api_key:
        raise ValueError('Missing EIA consumption api_key. Provide api_key query parameter or set EIA_CONSUMPTION_API_KEY_DEFAULT.')

    if not date_to:
        date_to = datetime.utcnow().strftime('%Y')

    source_signature = effective_source_url if effective_source_url else 'default'
    cache_key = f"annual-v2:{date_from}:{date_to}:WORL:{source_signature}"
    cached = EIA_WORLD_OIL_CONSUMPTION_CACHE.get(cache_key)
    now_ts = time.time()
    if cached and (now_ts - cached.get('computed_at', 0.0)) < EIA_WORLD_OIL_CONSUMPTION_CACHE_TTL_SECONDS:
        return cached.get('payload')

    disk_cached = load_eia_disk_cache_payload(cache_key)
    if disk_cached:
        EIA_WORLD_OIL_CONSUMPTION_CACHE[cache_key] = {
            'computed_at': now_ts,
            'payload': disk_cached,
        }
        return disk_cached

    try:
        if effective_source_url:
            source_with_key = build_source_url_with_api_key(effective_source_url, effective_api_key)
            response = requests.get(source_with_key, timeout=60)
        else:
            params = {
                'api_key': effective_api_key,
                'frequency': 'annual',
                'data[0]': 'value',
                'facets[activityId][]': '2',
                'facets[productId][]': '5',
                'facets[unit][]': 'TBPD',
                'facets[countryRegionId][]': 'WORL',
                'start': date_from,
                'end': date_to,
                'sort[0][column]': 'period',
                'sort[0][direction]': 'asc',
                'offset': 0,
                'length': 5000,
            }

            response = requests.get(EIA_INTERNATIONAL_BASE_URL, params=params, timeout=40)
        response.raise_for_status()
    except Exception:
        fallback_payload = load_eia_disk_cache_payload(cache_key, max_age_seconds=None)
        if fallback_payload:
            EIA_WORLD_OIL_CONSUMPTION_CACHE[cache_key] = {
                'computed_at': now_ts,
                'payload': fallback_payload,
            }
            return fallback_payload
        raise
    payload_json = response.json()

    rows = payload_json.get('response', {}).get('data', [])
    if not isinstance(rows, list):
        rows = []

    raw_points = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        year_dt = parse_year_period(row.get('period'))
        if year_dt is None:
            continue
        value = to_float_or_none(row.get('value'))
        raw_points.append({
            'date': f"{year_dt.strftime('%Y')}-01-01",
            'world_tbpd': value,
        })

    raw_points = sorted(raw_points, key=lambda item: item.get('date') or '')

    baseline = None
    for point in raw_points:
        if str(point.get('date', '')).startswith('2018') and point.get('world_tbpd') is not None:
            baseline = point.get('world_tbpd')
            break

    points = []
    for point in raw_points:
        value = point.get('world_tbpd')
        pct = None
        if baseline is not None and baseline != 0 and value is not None:
            pct = ((value / baseline) - 1.0) * 100.0
        points.append({
            'date': point.get('date'),
            'world_tbpd': value,
            'world_pct_from_2018': pct,
        })

    payload = {
        'dataset': 'EIA International Data Browser / API v2',
        'dataset_url': EIA_INTERNATIONAL_BASE_URL,
        'metric': 'annual_world_oil_consumption_pct_change_from_2018',
        'unit': 'percent',
        'unit_code': 'PCT',
        'frequency': 'annual',
        'start_date': points[0]['date'] if points else None,
        'end_date': points[-1]['date'] if points else None,
        'countries': ['World'],
        'points': points,
    }

    EIA_WORLD_OIL_CONSUMPTION_CACHE[cache_key] = {
        'computed_at': now_ts,
        'payload': payload,
    }
    save_eia_disk_cache_payload(cache_key, payload)
    return payload


def slugify_series_key(value, fallback='series'):
    raw = re.sub(r'[^a-z0-9]+', '_', str(value or '').strip().lower()).strip('_')
    if not raw:
        raw = fallback
    return raw


def fetch_eia_top_exporters_share_annual(api_key=None, source_url=None, production_source_url=None, date_from='2018', date_to=None, top_n=5):
    """Return top N net-exporter series where net exports = production - consumption (annual, % of world net exports)."""
    effective_consumption_source_url = str(source_url or '').strip()
    effective_production_source_url = str(production_source_url or '').strip()
    effective_api_key = str(api_key or EIA_API_KEY_DEFAULT).strip()
    if not effective_consumption_source_url and not effective_api_key:
        raise ValueError('Missing EIA exports api_key. Provide api_key query parameter or set EIA_API_KEY_DEFAULT.')

    if effective_consumption_source_url:
        effective_consumption_source_url = drop_source_country_facets(effective_consumption_source_url)

    if effective_production_source_url:
        effective_production_source_url = drop_source_country_facets(effective_production_source_url)

    if effective_consumption_source_url and not effective_production_source_url:
        effective_production_source_url = override_source_activity_id(effective_consumption_source_url, 1)

    if not date_to:
        date_to = datetime.utcnow().strftime('%Y')

    top_n_safe = max(1, min(int(top_n), 10))
    consumption_signature = effective_consumption_source_url if effective_consumption_source_url else 'default-cons'
    production_signature = effective_production_source_url if effective_production_source_url else 'default-prod'
    cache_key = f"exports-v10:{date_from}:{date_to}:{top_n_safe}:{consumption_signature}:{production_signature}"
    cached = EIA_WORLD_EXPORTERS_SHARE_CACHE.get(cache_key)
    now_ts = time.time()
    if cached and (now_ts - cached.get('computed_at', 0.0)) < EIA_WORLD_EXPORTERS_SHARE_CACHE_TTL_SECONDS:
        return cached.get('payload')

    disk_cached = load_eia_disk_cache_payload(cache_key)
    if disk_cached:
        EIA_WORLD_EXPORTERS_SHARE_CACHE[cache_key] = {
            'computed_at': now_ts,
            'payload': disk_cached,
        }
        return disk_cached

    try:
        if effective_consumption_source_url:
            consumption_url = build_source_url_with_api_key(effective_consumption_source_url, effective_api_key)
            consumption_response = requests.get(consumption_url, timeout=60)
        else:
            consumption_params = {
                'api_key': effective_api_key,
                'frequency': 'annual',
                'data[0]': 'value',
                'facets[activityId][]': '2',
                'facets[productId][]': '4415',
                'facets[unit][]': 'QBTU',
                'start': date_from,
                'end': date_to,
                'sort[0][column]': 'period',
                'sort[0][direction]': 'desc',
                'offset': 0,
                'length': 5000,
            }
            consumption_response = requests.get(EIA_INTERNATIONAL_BASE_URL, params=consumption_params, timeout=60)

        if effective_production_source_url:
            production_url = build_source_url_with_api_key(effective_production_source_url, effective_api_key)
            production_response = requests.get(production_url, timeout=60)
        else:
            production_params = {
                'api_key': effective_api_key,
                'frequency': 'annual',
                'data[0]': 'value',
                'facets[activityId][]': '1',
                'facets[productId][]': '4415',
                'facets[unit][]': 'QBTU',
                'start': date_from,
                'end': date_to,
                'sort[0][column]': 'period',
                'sort[0][direction]': 'desc',
                'offset': 0,
                'length': 5000,
            }
            production_response = requests.get(EIA_INTERNATIONAL_BASE_URL, params=production_params, timeout=60)

        consumption_response.raise_for_status()
        production_response.raise_for_status()
    except Exception:
        fallback_payload = load_eia_disk_cache_payload(cache_key, max_age_seconds=None)
        if fallback_payload:
            EIA_WORLD_EXPORTERS_SHARE_CACHE[cache_key] = {
                'computed_at': now_ts,
                'payload': fallback_payload,
            }
            return fallback_payload

        fallback_any = load_latest_eia_disk_cache_payload_by_prefix('exports-v10:')
        if fallback_any:
            EIA_WORLD_EXPORTERS_SHARE_CACHE[cache_key] = {
                'computed_at': now_ts,
                'payload': fallback_any,
            }
            return fallback_any
        raise

    consumption_rows = consumption_response.json().get('response', {}).get('data', [])
    production_rows = production_response.json().get('response', {}).get('data', [])
    if not isinstance(consumption_rows, list):
        consumption_rows = []
    if not isinstance(production_rows, list):
        production_rows = []

    variant = 'source' if effective_consumption_source_url else 'default'

    def build_year_maps(consumption_rows_input, production_rows_input):
        consumption_map: dict[str, dict[str, Any]] = {}
        production_map: dict[str, dict[str, Any]] = {}
        names: dict[str, str] = {}

        for row in consumption_rows_input:
            if not isinstance(row, dict):
                continue

            year_dt = parse_year_period(row.get('period'))
            code = str(row.get('countryRegionId') or '').strip()
            value = to_float_or_none(row.get('value'))
            if year_dt is None or not code or value is None:
                continue

            year_key = year_dt.strftime('%Y')
            bucket = consumption_map.setdefault(year_key, {})
            bucket[code] = value

            name = str(row.get('countryRegionName') or code).strip()
            names[code] = name if name else code

        for row in production_rows_input:
            if not isinstance(row, dict):
                continue

            year_dt = parse_year_period(row.get('period'))
            code = str(row.get('countryRegionId') or '').strip()
            value = to_float_or_none(row.get('value'))
            if year_dt is None or not code or value is None:
                continue

            year_key = year_dt.strftime('%Y')
            bucket = production_map.setdefault(year_key, {})
            bucket[code] = value

            name = str(row.get('countryRegionName') or code).strip()
            names[code] = name if name else code

        return consumption_map, production_map, names

    def latest_positive_candidate_count(consumption_map, production_map):
        years = sorted(set(consumption_map.keys()) | set(production_map.keys()))
        if not years:
            return 0
        latest = years[-1]
        latest_consumption_map = consumption_map.get(latest, {})
        latest_production_map = production_map.get(latest, {})
        combined_codes = set(latest_consumption_map.keys()) | set(latest_production_map.keys())
        count = 0
        for code in combined_codes:
            if code == 'WORL' or len(code) != 3:
                continue
            cons_val = to_float_or_none(latest_consumption_map.get(code))
            prod_val = to_float_or_none(latest_production_map.get(code))
            if cons_val is None or prod_val is None:
                continue
            if float(prod_val) - float(cons_val) > 0:
                count += 1
        return count

    def max_positive_candidate_count(consumption_map, production_map):
        years = sorted(set(consumption_map.keys()) | set(production_map.keys()))
        max_count = 0
        for year in years:
            cons_map = consumption_map.get(year, {})
            prod_map = production_map.get(year, {})
            combined_codes = set(cons_map.keys()) | set(prod_map.keys())
            count = 0
            for code in combined_codes:
                if code == 'WORL' or len(code) != 3:
                    continue
                cons_val = to_float_or_none(cons_map.get(code))
                prod_val = to_float_or_none(prod_map.get(code))
                if cons_val is None or prod_val is None:
                    continue
                if float(prod_val) - float(cons_val) > 0:
                    count += 1
            if count > max_count:
                max_count = count
        return max_count

    consumption_by_year, production_by_year, code_name_map = build_year_maps(consumption_rows, production_rows)
    base_candidate_count = latest_positive_candidate_count(consumption_by_year, production_by_year)
    base_max_candidate_count = max_positive_candidate_count(consumption_by_year, production_by_year)

    if effective_consumption_source_url and base_candidate_count < top_n_safe:
        fallback_consumption_source = override_source_facets(
            effective_consumption_source_url,
            activity_id=2,
            product_id=57,
            unit='TBPD',
        )
        fallback_production_source_base = effective_production_source_url or effective_consumption_source_url
        fallback_production_source = override_source_facets(
            fallback_production_source_base,
            activity_id=1,
            product_id=57,
            unit='TBPD',
        )

        try:
            fallback_consumption_url = build_source_url_with_api_key(fallback_consumption_source, effective_api_key)
            fallback_production_url = build_source_url_with_api_key(fallback_production_source, effective_api_key)
            fallback_consumption_response = requests.get(fallback_consumption_url, timeout=60)
            fallback_production_response = requests.get(fallback_production_url, timeout=60)
            fallback_consumption_response.raise_for_status()
            fallback_production_response.raise_for_status()

            fallback_consumption_rows = fallback_consumption_response.json().get('response', {}).get('data', [])
            fallback_production_rows = fallback_production_response.json().get('response', {}).get('data', [])
            if not isinstance(fallback_consumption_rows, list):
                fallback_consumption_rows = []
            if not isinstance(fallback_production_rows, list):
                fallback_production_rows = []

            fallback_consumption_map, fallback_production_map, fallback_names = build_year_maps(
                fallback_consumption_rows,
                fallback_production_rows,
            )
            fallback_candidate_count = latest_positive_candidate_count(fallback_consumption_map, fallback_production_map)
            fallback_max_candidate_count = max_positive_candidate_count(fallback_consumption_map, fallback_production_map)

            if fallback_max_candidate_count > base_max_candidate_count:
                consumption_by_year = fallback_consumption_map
                production_by_year = fallback_production_map
                code_name_map = fallback_names
                base_candidate_count = fallback_candidate_count
                base_max_candidate_count = fallback_max_candidate_count
                variant = 'fallback_product57_tbpd'
        except Exception:
            pass

    if base_candidate_count < top_n_safe:
        focused_codes = [
            'USA', 'SAU', 'RUS', 'CAN', 'IRQ', 'ARE', 'KWT', 'NOR', 'BRA', 'QAT', 'KAZ', 'MEX',
            'NGA', 'DZA', 'LBY', 'AZE', 'OMN', 'VEN', 'AGO', 'ECU',
        ]

        consumption_params = {
            'api_key': effective_api_key,
            'frequency': 'annual',
            'data[0]': 'value',
            'facets[activityId][]': '2',
            'facets[productId][]': '57',
            'facets[unit][]': 'TBPD',
            'facets[countryRegionId][]': focused_codes,
            'start': date_from,
            'end': date_to,
            'sort[0][column]': 'period',
            'sort[0][direction]': 'desc',
            'offset': 0,
            'length': 5000,
        }

        production_params = {
            'api_key': effective_api_key,
            'frequency': 'annual',
            'data[0]': 'value',
            'facets[activityId][]': '1',
            'facets[productId][]': '57',
            'facets[unit][]': 'TBPD',
            'facets[countryRegionId][]': focused_codes,
            'start': date_from,
            'end': date_to,
            'sort[0][column]': 'period',
            'sort[0][direction]': 'desc',
            'offset': 0,
            'length': 5000,
        }

        try:
            focused_consumption_response = requests.get(EIA_INTERNATIONAL_BASE_URL, params=consumption_params, timeout=60)
            focused_production_response = requests.get(EIA_INTERNATIONAL_BASE_URL, params=production_params, timeout=60)
            focused_consumption_response.raise_for_status()
            focused_production_response.raise_for_status()

            focused_consumption_rows = focused_consumption_response.json().get('response', {}).get('data', [])
            focused_production_rows = focused_production_response.json().get('response', {}).get('data', [])
            if not isinstance(focused_consumption_rows, list):
                focused_consumption_rows = []
            if not isinstance(focused_production_rows, list):
                focused_production_rows = []

            focused_consumption_map, focused_production_map, focused_names = build_year_maps(
                focused_consumption_rows,
                focused_production_rows,
            )
            focused_candidate_count = latest_positive_candidate_count(focused_consumption_map, focused_production_map)
            focused_max_candidate_count = max_positive_candidate_count(focused_consumption_map, focused_production_map)

            if focused_max_candidate_count >= base_max_candidate_count and (focused_candidate_count > 0 or base_candidate_count == 0):
                consumption_by_year = focused_consumption_map
                production_by_year = focused_production_map
                code_name_map = focused_names
                base_candidate_count = focused_candidate_count
                base_max_candidate_count = focused_max_candidate_count
                variant = 'focused_major_exporters_product57_tbpd'
        except Exception:
            pass

    if not consumption_by_year and not production_by_year:
        payload = {
            'dataset': 'EIA International Data Browser / API v2',
            'dataset_url': EIA_INTERNATIONAL_BASE_URL,
            'metric': 'annual_top_net_exporters_share_of_world_net_exports',
            'unit': 'percent',
            'unit_code': 'PCT',
            'frequency': 'annual',
            'method': 'net_exports_proxy_production_minus_consumption',
            'top_n': top_n_safe,
            'exporters': [],
            'start_date': None,
            'end_date': None,
            'points': [],
        }
        EIA_WORLD_EXPORTERS_SHARE_CACHE[cache_key] = {
            'computed_at': now_ts,
            'payload': payload,
        }
        save_eia_disk_cache_payload(cache_key, payload)
        return payload

    years_sorted = sorted(set(consumption_by_year.keys()) | set(production_by_year.keys()))

    def compute_net_map(cons_map, prod_map):
        combined_codes = set(cons_map.keys()) | set(prod_map.keys())
        net_map: dict[str, float] = {}
        for code in combined_codes:
            cons_val = to_float_or_none(cons_map.get(code))
            prod_val = to_float_or_none(prod_map.get(code))
            if cons_val is None or prod_val is None:
                continue
            net_map[code] = float(prod_val) - float(cons_val)
        return net_map

    def net_candidates_for_year(year):
        year_consumption = consumption_by_year.get(year, {})
        year_production = production_by_year.get(year, {})
        year_net = compute_net_map(year_consumption, year_production)
        world_value = 0.0
        candidates = []

        for code, value in year_net.items():
            if code == 'WORL' or len(code) != 3:
                continue
            if value is None or value <= 0:
                continue
            numeric_value = float(value)
            world_value += numeric_value
            candidates.append((code, numeric_value))

        candidates.sort(key=lambda item: item[1], reverse=True)
        return year_net, candidates, world_value

    selection_year = None
    selection_candidates: list[tuple[str, float]] = []
    selection_world_value = 0.0
    selection_strategy = 'latest_sufficient'

    for year in reversed(years_sorted):
        _, candidates, world_value = net_candidates_for_year(year)
        if len(candidates) >= top_n_safe:
            selection_year = year
            selection_candidates = candidates
            selection_world_value = world_value
            break

    if selection_year is None:
        selection_strategy = 'max_positive_candidates'
        best_year = None
        best_candidates: list[tuple[str, float]] = []
        best_world_value = 0.0
        for year in years_sorted:
            _, candidates, world_value = net_candidates_for_year(year)
            if len(candidates) > len(best_candidates):
                best_year = year
                best_candidates = candidates
                best_world_value = world_value
            elif len(candidates) == len(best_candidates) and candidates and best_year is not None and year > best_year:
                best_year = year
                best_candidates = candidates
                best_world_value = world_value

        selection_year = best_year
        selection_candidates = best_candidates
        selection_world_value = best_world_value

    selected_codes = [code for code, _ in selection_candidates[:top_n_safe]]
    selected_set = set(selected_codes)
    for year in years_sorted:
        _, year_candidates, _ = net_candidates_for_year(year)
        for code, _ in year_candidates[:top_n_safe]:
            if code not in selected_set:
                selected_codes.append(code)
                selected_set.add(code)

    for forced_code in ['USA', 'NOR', 'BRA']:
        if forced_code not in selected_set:
            selected_codes.append(forced_code)
            selected_set.add(forced_code)

    if len(selected_codes) > top_n_safe:
        selection_strategy = f"{selection_strategy}_union_topn_over_time"

    exporters = []
    used_keys: set[str] = set()
    for code in selected_codes:
        label = code_name_map.get(code, code)
        series_key = f"{slugify_series_key(label, fallback=code.lower())}_share_pct"
        if series_key in used_keys:
            series_key = f"{slugify_series_key(code, fallback='code')}_share_pct"
        used_keys.add(series_key)
        exporters.append({
            'code': code,
            'name': label,
            'series_key': series_key,
        })

    points = []
    for year in years_sorted:
        year_consumption = consumption_by_year.get(year, {})
        year_production = production_by_year.get(year, {})
        year_net = compute_net_map(year_consumption, year_production)

        world_value = 0.0
        for code, value in year_net.items():
            if code == 'WORL':
                continue
            if len(code) != 3:
                continue
            if value > 0:
                world_value += value

        point: dict[str, Any] = {
            'date': f"{year}-01-01",
            'world_net_exports_qbtu': world_value,
        }

        for exporter in exporters:
            exporter_value = to_float_or_none(year_net.get(exporter['code']))
            share = None
            if exporter_value is not None and exporter_value > 0 and world_value not in (None, 0):
                share = (float(exporter_value) / float(world_value)) * 100.0
            point[exporter['series_key']] = share

        points.append(point)

    payload = {
        'dataset': 'EIA International Data Browser / API v2',
        'dataset_url': EIA_INTERNATIONAL_BASE_URL,
        'metric': 'annual_top_net_exporters_share_of_world_net_exports',
        'unit': 'percent',
        'unit_code': 'PCT',
        'frequency': 'annual',
        'method': 'net_exports_proxy_production_minus_consumption',
        'variant': variant,
        'selection_strategy': selection_strategy,
        'selection_positive_candidates': len(selection_candidates),
        'cohort_size': len(selected_codes),
        'top_n': top_n_safe,
        'selection_year': selection_year,
        'selection_world_net_exports_qbtu': selection_world_value,
        'exporters': exporters,
        'start_date': points[0]['date'] if points else None,
        'end_date': points[-1]['date'] if points else None,
        'points': points,
    }

    EIA_WORLD_EXPORTERS_SHARE_CACHE[cache_key] = {
        'computed_at': now_ts,
        'payload': payload,
    }
    save_eia_disk_cache_payload(cache_key, payload)
    return payload


@app.route('/api/europe-electricity-use-fossil-prices-monthly', methods=['GET'])
def get_europe_electricity_use_fossil_prices_monthly():
    """Return monthly Europe electricity use (total/gas/coal) and coal/gas prices."""
    try:
        date_from = request.args.get('date_from', '2021-01-01')
        date_to = request.args.get('date_to', '2025-12-01')
        entity = request.args.get('entity', 'Europe')
        payload = fetch_europe_electricity_use_and_fossil_prices_monthly(
            date_from=date_from,
            date_to=date_to,
            entity=entity,
        )
        return jsonify(payload)
    except Exception as e:
        print(f"Error in europe-electricity-use-fossil-prices-monthly endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/world-oil-production-monthly', methods=['GET'])
def get_world_oil_production_monthly():
    """Return monthly oil production for world + selected producers from EIA."""
    try:
        date_from = request.args.get('date_from', '2018-01')
        date_to = request.args.get('date_to')
        source_url = request.args.get('source_url')
        api_key = (
            request.args.get('api_key')
            or request.args.get('production_api_key')
            or EIA_API_KEY_DEFAULT
        )
        payload = fetch_eia_world_oil_production_monthly(
            api_key=api_key,
            date_from=date_from,
            date_to=date_to,
            source_url=source_url,
        )
        return jsonify(payload)
    except Exception as e:
        print(f"Error in world-oil-production-monthly endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/world-oil-consumption-annual', methods=['GET'])
def get_world_oil_consumption_annual():
    """Return annual world oil consumption growth (% from 2018 baseline) from EIA."""
    try:
        date_from = request.args.get('date_from', '2018')
        date_to = request.args.get('date_to')
        source_url = request.args.get('source_url')
        api_key = (
            request.args.get('api_key')
            or request.args.get('consumption_api_key')
            or EIA_CONSUMPTION_API_KEY_DEFAULT
        )
        payload = fetch_eia_world_oil_consumption_annual(
            api_key=api_key,
            date_from=date_from,
            date_to=date_to,
            source_url=source_url,
        )
        return jsonify(payload)
    except Exception as e:
        print(f"Error in world-oil-consumption-annual endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/world-oil-top-exporters-share-annual', methods=['GET'])
def get_world_oil_top_exporters_share_annual():
    """Return annual top exporters as share of world exports from EIA."""
    try:
        date_from = request.args.get('date_from', '2018')
        date_to = request.args.get('date_to')
        source_url = request.args.get('source_url')
        production_source_url = request.args.get('production_source_url')
        top_n = int(request.args.get('top_n', 5))
        api_key = (
            request.args.get('api_key')
            or request.args.get('exports_api_key')
            or EIA_API_KEY_DEFAULT
        )
        payload = fetch_eia_top_exporters_share_annual(
            api_key=api_key,
            source_url=source_url,
            production_source_url=production_source_url,
            date_from=date_from,
            date_to=date_to,
            top_n=top_n,
        )
        return jsonify(payload)
    except Exception as e:
        print(f"Error in world-oil-top-exporters-share-annual endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


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


@app.route('/api/eurozone-gas-prices', methods=['GET'])
def get_eurozone_gas_prices():
    """Return monthly natural gas and LNG price series (USD per MMBtu)."""
    try:
        start_date = request.args.get('start_date', '2002-01-01')
        end_date = request.args.get('end_date', datetime.utcnow().strftime('%Y-%m-%d'))

        # World Bank commodity prices via FRED
        # PNGASEUUSDM: Natural Gas, Europe
        # PNGASJPUSDM: Liquefied Natural Gas, Japan
        natural_gas_series = fetch_fred_data('PNGASEUUSDM', start_date, end_date, FRED_API_KEY)
        lng_series = fetch_fred_data('PNGASJPUSDM', start_date, end_date, FRED_API_KEY)

        ng_map = {date: value for date, value in natural_gas_series}
        lng_map = {date: value for date, value in lng_series}
        dates = sorted(set(ng_map.keys()) | set(lng_map.keys()))

        payload = {
            'unit': 'USD per MMBtu',
            'source': 'FRED commodity prices (World Bank Pink Sheet series)',
            'series': [
                {
                    'code': 'PNGASEUUSDM',
                    'label': 'Natural gas price (Europe)',
                    'points': [{'date': date, 'value': ng_map.get(date)} for date in dates]
                },
                {
                    'code': 'PNGASJPUSDM',
                    'label': 'Liquefied natural gas price (LNG, Japan)',
                    'points': [{'date': date, 'value': lng_map.get(date)} for date in dates]
                }
            ],
            'start_date': dates[0] if dates else None,
            'end_date': dates[-1] if dates else None,
        }

        return jsonify(payload)
    except Exception as e:
        print(f"Error in eurozone-gas-prices endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def fetch_brent_oil_annual(start_year=2002, end_year=None):
    """Fetch annual average Brent crude oil prices (USD per barrel) from Yahoo Finance chart API (BZ=F)."""
    if end_year is None:
        end_year = datetime.utcnow().year

    start_dt = datetime(int(start_year), 1, 1, tzinfo=timezone.utc)
    end_dt = datetime(int(end_year) + 1, 1, 1, tzinfo=timezone.utc)
    period1 = int(start_dt.timestamp())
    period2 = int(end_dt.timestamp()) - 1

    buckets = {}
    try:
        url = 'https://query1.finance.yahoo.com/v8/finance/chart/BZ=F'
        params = {
            'period1': period1,
            'period2': period2,
            'interval': '1mo',
            'events': 'history',
            'includeAdjustedClose': 'true',
        }
        headers = {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json',
        }
        response = requests.get(url, params=params, headers=headers, timeout=30)
        response.raise_for_status()
        payload = response.json()
        result = ((payload.get('chart') or {}).get('result') or [None])[0] or {}
        timestamps = result.get('timestamp') or []
        quote = (((result.get('indicators') or {}).get('quote') or [None])[0] or {})
        closes = quote.get('close') or []

        for ts, close in zip(timestamps, closes):
            if close is None:
                continue
            try:
                price = float(close)
                if not np.isfinite(price):
                    continue
                year = int(datetime.fromtimestamp(int(ts), tz=timezone.utc).year)
                buckets.setdefault(year, []).append(price)
            except Exception:
                continue
    except Exception as e:
        print(f"Brent Yahoo chart API fetch failed: {e}")

    years = sorted(buckets.keys())
    points = [
        {
            'year': int(year),
            'brent_usd_per_barrel': (sum(buckets[year]) / len(buckets[year])) if buckets[year] else None,
        }
        for year in years
    ]

    return {
        'series_id': 'BZ=F',
        'label': 'Brent crude oil futures (Yahoo Finance chart API)',
        'unit': 'USD per barrel',
        'frequency': 'A',
        'aggregation': 'Annual average of monthly close observations',
        'source': 'Yahoo Finance chart API',
        'start_year': years[0] if years else None,
        'end_year': years[-1] if years else None,
        'points': points,
    }


@app.route('/api/brent-oil-annual', methods=['GET'])
def get_brent_oil_annual():
    """Return annual Brent oil prices (USD per barrel)."""
    try:
        start_year = int(request.args.get('start_year', 2002))
        end_year = int(request.args.get('end_year', datetime.utcnow().year))
        payload = fetch_brent_oil_annual(start_year=start_year, end_year=end_year)
        return jsonify(payload)
    except Exception as e:
        print(f"Error in brent-oil-annual endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

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


def fetch_eurozone_energy_fuels_trade():
    """Fetch quarterly net trade section for oil and gases, plus total energy net line."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ext_st_eu27_2020sitc'

    series_codes = {
        'TOTAL': 'All traded items (TOTAL)',
        'SITC3': 'Total energy fuels (SITC3)',
        'SITC33': 'Oil / petroleum products (SITC33)',
        'SITC0_1': 'Food, drinks and tobacco (SITC0_1)',
        'SITC2': 'Raw materials (SITC2)',
        'SITC5': 'Chemicals (SITC5)',
        'SITC7': 'Machinery & vehicles (SITC7)',
        'SITC6_8': 'Manufactured goods (SITC6_8)',
    }

    # Source dataset is already EU aggregate-oriented in this custom table
    geo_code = 'EU27_2020'
    geo_label = 'Euro area / EU aggregate (EU27_2020 in source table)'
    partner_code = 'EXT_EU27_2020'
    partner_label = 'Extra-EU partner aggregate (EXT_EU27_2020)'

    monthly_by_code = {code: {} for code in series_codes.keys()}

    for sitc_code in series_codes.keys():
        params = {
            'lang': 'en',
            'stk_flow': 'BAL_RT',
            'indic_et': 'TRD_VAL_SCA',
            'partner': partner_code,
            'sitc06': sitc_code,
        }

        payload = None
        last_error = None
        for attempt in range(1, 4):
            try:
                response = requests.get(base_url, params=params, timeout=45)
                response.raise_for_status()
                payload = response.json()
                break
            except Exception as e:
                last_error = e
                print(f"Energy fuels section fetch failed (attempt {attempt}/3, sitc={sitc_code}): {e}")
                if attempt < 3:
                    time.sleep(1.2 * attempt)

        if payload is None:
            raise RuntimeError(f"Energy fuels section fetch failed for sitc={sitc_code}: {last_error}")

        dimension = payload.get('dimension', {})
        time_index = dimension.get('time', {}).get('category', {}).get('index', {})
        values = payload.get('value', {})

        for time_code, time_pos in time_index.items():
            value = values.get(str(time_pos))
            if value is None:
                continue
            monthly_by_code[sitc_code][str(time_code)] = float(value)

    def to_quarter_key(time_code: str):
        parts = str(time_code).split('-')
        if len(parts) != 2:
            return None
        year = parts[0]
        month = parts[1]
        if not (year.isdigit() and month.isdigit()):
            return None
        month_num = int(month)
        if month_num < 1 or month_num > 12:
            return None
        quarter = ((month_num - 1) // 3) + 1
        return f"Q{quarter}/{year}"

    quarterly = {}
    all_months = sorted(
        set(monthly_by_code['TOTAL'].keys())
        | set(monthly_by_code['SITC3'].keys())
        | set(monthly_by_code['SITC33'].keys())
    )
    for month_code in all_months:
        qkey = to_quarter_key(month_code)
        if qkey is None:
            continue
        quarterly.setdefault(qkey, {
            'total_all': 0.0,
            'total_energy': 0.0,
            'oil': 0.0,
            'food_tobacco': 0.0,
            'raw_materials': 0.0,
            'chemicals': 0.0,
            'machinery_vehicles': 0.0,
            'manufactured_total': 0.0,
            'total_all_count': 0,
            'total_energy_count': 0,
            'oil_count': 0,
            'food_tobacco_count': 0,
            'raw_materials_count': 0,
            'chemicals_count': 0,
            'machinery_vehicles_count': 0,
            'manufactured_total_count': 0,
        })

        total_all_val = monthly_by_code['TOTAL'].get(month_code)
        total_energy_val = monthly_by_code['SITC3'].get(month_code)
        oil_val = monthly_by_code['SITC33'].get(month_code)
        food_tobacco_val = monthly_by_code['SITC0_1'].get(month_code)
        raw_materials_val = monthly_by_code['SITC2'].get(month_code)
        chemicals_val = monthly_by_code['SITC5'].get(month_code)
        machinery_vehicles_val = monthly_by_code['SITC7'].get(month_code)
        manufactured_total_val = monthly_by_code['SITC6_8'].get(month_code)

        if total_all_val is not None:
            quarterly[qkey]['total_all'] += total_all_val
            quarterly[qkey]['total_all_count'] += 1
        if total_energy_val is not None:
            quarterly[qkey]['total_energy'] += total_energy_val
            quarterly[qkey]['total_energy_count'] += 1
        if oil_val is not None:
            quarterly[qkey]['oil'] += oil_val
            quarterly[qkey]['oil_count'] += 1
        if food_tobacco_val is not None:
            quarterly[qkey]['food_tobacco'] += food_tobacco_val
            quarterly[qkey]['food_tobacco_count'] += 1
        if raw_materials_val is not None:
            quarterly[qkey]['raw_materials'] += raw_materials_val
            quarterly[qkey]['raw_materials_count'] += 1
        if chemicals_val is not None:
            quarterly[qkey]['chemicals'] += chemicals_val
            quarterly[qkey]['chemicals_count'] += 1
        if machinery_vehicles_val is not None:
            quarterly[qkey]['machinery_vehicles'] += machinery_vehicles_val
            quarterly[qkey]['machinery_vehicles_count'] += 1
        if manufactured_total_val is not None:
            quarterly[qkey]['manufactured_total'] += manufactured_total_val
            quarterly[qkey]['manufactured_total_count'] += 1

    quarter_keys = sorted(
        quarterly.keys(),
        key=lambda q: (int(q.split('/')[1]), int(q[1]))
    )

    points = []
    for qkey in quarter_keys:
        bucket = quarterly[qkey]
        if bucket['total_all_count'] == 0 and bucket['total_energy_count'] == 0 and bucket['oil_count'] == 0:
            continue

        total_all_net = bucket['total_all'] if bucket['total_all_count'] > 0 else None
        total_energy_net = bucket['total_energy'] if bucket['total_energy_count'] > 0 else None
        oil_net = bucket['oil'] if bucket['oil_count'] > 0 else None
        gas_net = (total_energy_net - oil_net) if (total_energy_net is not None and oil_net is not None) else None

        food_tobacco_net = bucket['food_tobacco'] if bucket['food_tobacco_count'] > 0 else None
        raw_materials_net = bucket['raw_materials'] if bucket['raw_materials_count'] > 0 else None
        chemicals_net = bucket['chemicals'] if bucket['chemicals_count'] > 0 else None
        machinery_vehicles_net = bucket['machinery_vehicles'] if bucket['machinery_vehicles_count'] > 0 else None
        manufactured_total_net = bucket['manufactured_total'] if bucket['manufactured_total_count'] > 0 else None
        other_manufactured_net = (
            manufactured_total_net - machinery_vehicles_net
            if (manufactured_total_net is not None and machinery_vehicles_net is not None)
            else None
        )

        known_components = [
            oil_net,
            gas_net,
            food_tobacco_net,
            raw_materials_net,
            chemicals_net,
            machinery_vehicles_net,
            other_manufactured_net,
        ]
        known_sum = sum(value for value in known_components if value is not None)
        other_goods_net = (total_all_net - known_sum) if total_all_net is not None else None

        points.append({
            'period': qkey,
            'oil_net_million_eur': oil_net,
            'gases_net_million_eur': gas_net,
            'food_tobacco_net_million_eur': food_tobacco_net,
            'raw_materials_net_million_eur': raw_materials_net,
            'chemicals_net_million_eur': chemicals_net,
            'machinery_vehicles_net_million_eur': machinery_vehicles_net,
            'other_manufactured_net_million_eur': other_manufactured_net,
            'other_goods_net_million_eur': other_goods_net,
            'total_energy_net_million_eur': total_energy_net,
            'total_all_items_net_million_eur': total_all_net,
        })

    def extract_year(period_label: str):
        return int(period_label.split('/')[1])

    start_year = extract_year(points[0]['period']) if points else None
    end_year = extract_year(points[-1]['period']) if points else None

    return {
        'dataset': 'ext_st_eu27_2020sitc',
        'table_reference': 'DS-059331',
        'geo': geo_code,
        'geo_label': geo_label,
        'partner': partner_code,
        'partner_label': partner_label,
        'indicator': 'TRD_VAL',
        'indicator_label': 'Trade value, seasonally adjusted net balance',
        'currency': 'EUR',
        'unit': 'Million EUR',
        'frequency': 'M',
        'aggregation': 'Quarterly sum of monthly values',
        'start_year': start_year,
        'end_year': end_year,
        'component_labels': {
            'oil': series_codes['SITC33'],
            'gases': 'Gases section (derived as total energy SITC3 minus oil SITC33)',
            'food_tobacco': series_codes['SITC0_1'],
            'raw_materials': series_codes['SITC2'],
            'chemicals': series_codes['SITC5'],
            'machinery_vehicles': series_codes['SITC7'],
            'other_manufactured': 'Other manufactured goods (SITC6_8 - SITC7)',
            'other_goods': 'Residual other goods (TOTAL minus listed components)',
            'total_energy': series_codes['SITC3'],
            'total_all_items': series_codes['TOTAL'],
        },
        'points': points,
    }


@app.route('/api/eurozone-energy-fuels-trade', methods=['GET'])
def get_eurozone_energy_fuels_trade():
    """Return annual imports/exports/net trade for selected energy fuel categories."""
    try:
        payload = fetch_eurozone_energy_fuels_trade()
        return jsonify(payload)
    except Exception as e:
        print(f"Error in eurozone-energy-fuels-trade endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def fetch_eurozone_total_trade_net_quarterly():
    """Fetch quarterly all-items net trade totals (SITC TOTAL)."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ext_st_eu27_2020sitc'
    params = {
        'lang': 'en',
        'stk_flow': 'BAL_RT',
        'indic_et': 'TRD_VAL_SCA',
        'partner': 'EXT_EU27_2020',
        'sitc06': 'TOTAL',
    }

    payload = None
    last_error = None
    for attempt in range(1, 4):
        try:
            response = requests.get(base_url, params=params, timeout=45)
            response.raise_for_status()
            payload = response.json()
            break
        except Exception as e:
            last_error = e
            print(f"Total all-items trade fetch failed (attempt {attempt}/3): {e}")
            if attempt < 3:
                time.sleep(1.2 * attempt)

    if payload is None:
        raise RuntimeError(f"Total all-items trade fetch failed: {last_error}")

    time_index = payload.get('dimension', {}).get('time', {}).get('category', {}).get('index', {})
    values = payload.get('value', {})

    quarterly = {}
    for time_code, time_pos in time_index.items():
        value = values.get(str(time_pos))
        if value is None:
            continue

        parts = str(time_code).split('-')
        if len(parts) != 2 or (not parts[0].isdigit()) or (not parts[1].isdigit()):
            continue
        month_num = int(parts[1])
        if month_num < 1 or month_num > 12:
            continue
        quarter = ((month_num - 1) // 3) + 1
        period = f"Q{quarter}/{parts[0]}"
        quarterly[period] = quarterly.get(period, 0.0) + float(value)

    periods = sorted(quarterly.keys(), key=lambda p: (int(p.split('/')[1]), int(p[1])))
    points = [{'period': period, 'total_all_items_net_million_eur': quarterly[period]} for period in periods]

    start_year = int(periods[0].split('/')[1]) if periods else None
    end_year = int(periods[-1].split('/')[1]) if periods else None

    return {
        'dataset': 'ext_st_eu27_2020sitc',
        'sitc06': 'TOTAL',
        'indicator': 'TRD_VAL_SCA',
        'stk_flow': 'BAL_RT',
        'partner': 'EXT_EU27_2020',
        'start_year': start_year,
        'end_year': end_year,
        'points': points,
    }


def fetch_eurozone_imports_energy_weights_quarterly():
    """Fetch quarterly net imports and oil/gases shares in positive net-imports base."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ext_st_eu27_2020sitc'

    series_codes = {
        'TOTAL': 'All goods (TOTAL)',
        'SITC3': 'Total energy fuels (SITC3)',
        'SITC33': 'Oil / petroleum products (SITC33)',
        'SITC0_1': 'Food, drinks and tobacco (SITC0_1)',
        'SITC2': 'Raw materials (SITC2)',
        'SITC5': 'Chemicals (SITC5)',
        'SITC7': 'Machinery & vehicles (SITC7)',
        'SITC6_8': 'Manufactured goods (SITC6_8)',
    }

    monthly_imports_by_code = {code: {} for code in series_codes.keys()}
    monthly_exports_by_code = {code: {} for code in series_codes.keys()}

    def fetch_monthly_series(stk_flow, sitc_code):
        params = {
            'lang': 'en',
            'stk_flow': stk_flow,
            'indic_et': 'TRD_VAL',
            'partner': 'EXT_EU27_2020',
            'sitc06': sitc_code,
        }

        payload = None
        last_error = None
        for attempt in range(1, 4):
            try:
                response = requests.get(base_url, params=params, timeout=45)
                response.raise_for_status()
                payload = response.json()
                break
            except Exception as e:
                last_error = e
                print(f"Imports weights fetch failed (attempt {attempt}/3, flow={stk_flow}, sitc={sitc_code}): {e}")
                if attempt < 3:
                    time.sleep(1.2 * attempt)

        if payload is None:
            raise RuntimeError(f"Imports weights fetch failed for flow={stk_flow}, sitc={sitc_code}: {last_error}")

        time_index = payload.get('dimension', {}).get('time', {}).get('category', {}).get('index', {})
        values = payload.get('value', {})
        output = {}

        for time_code, time_pos in time_index.items():
            value = values.get(str(time_pos))
            if value is None:
                continue
            output[str(time_code)] = float(value)

        return output

    for sitc_code in series_codes.keys():
        monthly_imports_by_code[sitc_code] = fetch_monthly_series('IMP', sitc_code)
        monthly_exports_by_code[sitc_code] = fetch_monthly_series('EXP', sitc_code)

    quarterly = {}
    all_months = sorted(
        set(monthly_imports_by_code['TOTAL'].keys())
        | set(monthly_exports_by_code['TOTAL'].keys())
        | set(monthly_imports_by_code['SITC3'].keys())
        | set(monthly_exports_by_code['SITC3'].keys())
        | set(monthly_imports_by_code['SITC33'].keys())
        | set(monthly_exports_by_code['SITC33'].keys())
    )

    for month_code in all_months:
        parts = str(month_code).split('-')
        if len(parts) != 2 or (not parts[0].isdigit()) or (not parts[1].isdigit()):
            continue

        month_num = int(parts[1])
        if month_num < 1 or month_num > 12:
            continue

        quarter = ((month_num - 1) // 3) + 1
        period = f"Q{quarter}/{parts[0]}"
        quarterly.setdefault(period, {
            'total': 0.0,
            'energy': 0.0,
            'oil': 0.0,
            'food_tobacco': 0.0,
            'raw_materials': 0.0,
            'chemicals': 0.0,
            'machinery_vehicles': 0.0,
            'manufactured_total': 0.0,
            'total_count': 0,
            'energy_count': 0,
            'oil_count': 0,
            'food_tobacco_count': 0,
            'raw_materials_count': 0,
            'chemicals_count': 0,
            'machinery_vehicles_count': 0,
            'manufactured_total_count': 0,
        })

        def net_for(code):
            imp = monthly_imports_by_code[code].get(month_code)
            exp = monthly_exports_by_code[code].get(month_code)
            if imp is None and exp is None:
                return None
            return (imp or 0.0) - (exp or 0.0)

        total_val = net_for('TOTAL')
        energy_val = net_for('SITC3')
        oil_val = net_for('SITC33')
        food_tobacco_val = net_for('SITC0_1')
        raw_materials_val = net_for('SITC2')
        chemicals_val = net_for('SITC5')
        machinery_vehicles_val = net_for('SITC7')
        manufactured_total_val = net_for('SITC6_8')

        if total_val is not None:
            quarterly[period]['total'] += total_val
            quarterly[period]['total_count'] += 1
        if energy_val is not None:
            quarterly[period]['energy'] += energy_val
            quarterly[period]['energy_count'] += 1
        if oil_val is not None:
            quarterly[period]['oil'] += oil_val
            quarterly[period]['oil_count'] += 1
        if food_tobacco_val is not None:
            quarterly[period]['food_tobacco'] += food_tobacco_val
            quarterly[period]['food_tobacco_count'] += 1
        if raw_materials_val is not None:
            quarterly[period]['raw_materials'] += raw_materials_val
            quarterly[period]['raw_materials_count'] += 1
        if chemicals_val is not None:
            quarterly[period]['chemicals'] += chemicals_val
            quarterly[period]['chemicals_count'] += 1
        if machinery_vehicles_val is not None:
            quarterly[period]['machinery_vehicles'] += machinery_vehicles_val
            quarterly[period]['machinery_vehicles_count'] += 1
        if manufactured_total_val is not None:
            quarterly[period]['manufactured_total'] += manufactured_total_val
            quarterly[period]['manufactured_total_count'] += 1

    periods = sorted(quarterly.keys(), key=lambda p: (int(p.split('/')[1]), int(p[1])))
    points = []
    for period in periods:
        bucket = quarterly[period]

        total_net = bucket['total'] if bucket['total_count'] > 0 else None
        energy_net = bucket['energy'] if bucket['energy_count'] > 0 else None
        oil_net = bucket['oil'] if bucket['oil_count'] > 0 else None
        gases_net = (energy_net - oil_net) if (energy_net is not None and oil_net is not None) else None

        food_tobacco_net = bucket['food_tobacco'] if bucket['food_tobacco_count'] > 0 else None
        raw_materials_net = bucket['raw_materials'] if bucket['raw_materials_count'] > 0 else None
        chemicals_net = bucket['chemicals'] if bucket['chemicals_count'] > 0 else None
        machinery_vehicles_net = bucket['machinery_vehicles'] if bucket['machinery_vehicles_count'] > 0 else None
        manufactured_total_net = bucket['manufactured_total'] if bucket['manufactured_total_count'] > 0 else None
        other_manufactured_net = (
            manufactured_total_net - machinery_vehicles_net
            if (manufactured_total_net is not None and machinery_vehicles_net is not None)
            else None
        )
        known_components = [
            oil_net,
            gases_net,
            food_tobacco_net,
            raw_materials_net,
            chemicals_net,
            machinery_vehicles_net,
            other_manufactured_net,
        ]
        known_sum = sum(value for value in known_components if value is not None)
        other_goods_net = (total_net - known_sum) if total_net is not None else None

        components_for_base = [
            oil_net,
            gases_net,
            food_tobacco_net,
            raw_materials_net,
            chemicals_net,
            machinery_vehicles_net,
            other_manufactured_net,
            other_goods_net,
        ]
        positive_net_imports = sum(max(value, 0.0) for value in components_for_base if value is not None)

        oil_positive = max(oil_net, 0.0) if oil_net is not None else None
        gases_positive = max(gases_net, 0.0) if gases_net is not None else None

        oil_weight_pct = ((oil_positive / positive_net_imports) * 100.0) if (positive_net_imports > 0 and oil_positive is not None) else None
        gases_weight_pct = ((gases_positive / positive_net_imports) * 100.0) if (positive_net_imports > 0 and gases_positive is not None) else None

        points.append({
            'period': period,
            'total_net_imports_million_eur': positive_net_imports,
            'total_balance_million_eur': total_net,
            'oil_net_imports_million_eur': oil_net,
            'gases_net_imports_million_eur': gases_net,
            'oil_weight_pct_of_total_net_imports': oil_weight_pct,
            'gases_weight_pct_of_total_net_imports': gases_weight_pct,
        })

    start_year = int(periods[0].split('/')[1]) if periods else None
    end_year = int(periods[-1].split('/')[1]) if periods else None

    return {
        'dataset': 'ext_st_eu27_2020sitc',
        'table_reference': 'DS-059331',
        'partner': 'EXT_EU27_2020',
        'stk_flow': 'IMP & EXP (net imports = IMP - EXP)',
        'indic_et': 'TRD_VAL',
        'frequency': 'M',
        'aggregation': 'Quarterly sum of monthly values',
        'weight_method': 'Section weights are computed on positive net-imports base only; zero and negative sections are excluded from denominator.',
        'start_year': start_year,
        'end_year': end_year,
        'points': points,
    }


def fetch_eur_usd_exchange_quarterly(start_date='2000-01-01', end_date=None):
    """Fetch quarterly average EUR/USD exchange rate (USD per 1 EUR) from FRED."""
    if end_date is None:
        end_date = datetime.utcnow().strftime('%Y-%m-%d')

    # DEXUSEU is U.S. Dollars to One Euro, daily (USD per EUR)
    daily_series = fetch_fred_data('DEXUSEU', start_date, end_date, FRED_API_KEY)

    quarterly_buckets = {}
    for date_str, value in daily_series:
        try:
            date_obj = datetime.strptime(date_str, '%Y-%m-%d')
        except Exception:
            continue

        quarter = ((date_obj.month - 1) // 3) + 1
        period = f"Q{quarter}/{date_obj.year}"
        quarterly_buckets.setdefault(period, []).append(float(value))

    periods = sorted(quarterly_buckets.keys(), key=lambda p: (int(p.split('/')[1]), int(p[1])))
    points = [
        {
            'period': period,
            'eur_usd': (sum(quarterly_buckets[period]) / len(quarterly_buckets[period])) if quarterly_buckets[period] else None
        }
        for period in periods
    ]

    start_year = int(periods[0].split('/')[1]) if periods else None
    end_year = int(periods[-1].split('/')[1]) if periods else None

    return {
        'series_id': 'DEXUSEU',
        'label': 'EUR/USD (USD per 1 EUR)',
        'unit': 'USD per EUR',
        'frequency': 'Q',
        'aggregation': 'Quarterly average of daily observations',
        'start_year': start_year,
        'end_year': end_year,
        'points': points,
    }


@app.route('/api/eurozone-total-net-trade-all-items', methods=['GET'])
def get_eurozone_total_net_trade_all_items():
    """Return quarterly all-items net trade totals."""
    try:
        payload = fetch_eurozone_total_trade_net_quarterly()
        return jsonify(payload)
    except Exception as e:
        print(f"Error in eurozone-total-net-trade-all-items endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/eurozone-imports-energy-weights', methods=['GET'])
def get_eurozone_imports_energy_weights():
    """Return quarterly total imports and oil/gases shares in total imports."""
    try:
        payload = fetch_eurozone_imports_energy_weights_quarterly()
        return jsonify(payload)
    except Exception as e:
        print(f"Error in eurozone-imports-energy-weights endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def _find_excel_file(base_dir: Path, explicit_names: list[str], glob_patterns: list[str]) -> Path | None:
    for name in explicit_names:
        candidate = base_dir / name
        if candidate.exists() and candidate.is_file():
            return candidate

    for pattern in glob_patterns:
        matches = sorted(base_dir.glob(pattern))
        for match in matches:
            if match.is_file() and match.suffix.lower() in {'.xlsx', '.xls'}:
                return match

    return None


def _extract_monthly_value_eur_series_from_workbook(
    file_path: Path,
    product_hint: str,
    flow_hint: str,
    partner_hint: str | None = None,
    preferred_sheet: str | None = None,
) -> tuple[dict[str, float], str]:
    xls = pd.ExcelFile(file_path)

    flow_hint_norm = flow_hint.strip().lower()
    if flow_hint_norm not in {'import', 'export'}:
        raise ValueError("flow_hint must be 'import' or 'export'")

    partner_hint_norm = partner_hint.strip().lower() if partner_hint else None
    preferred_sheet_norm = preferred_sheet.strip().lower() if preferred_sheet else None

    for sheet_name_raw in xls.sheet_names:
        sheet_name = str(sheet_name_raw)
        if sheet_name.strip().lower() == 'summary':
            continue
        if preferred_sheet_norm and sheet_name.strip().lower() != preferred_sheet_norm:
            continue

        df = pd.read_excel(file_path, sheet_name=sheet_name, header=None)
        if df.empty:
            continue

        flattened_text = ' '.join(
            text for text in (
                str(value).strip().lower()
                for value in df.values.ravel().tolist()
            )
            if text and text != 'nan'
        )

        if product_hint.lower() not in flattened_text:
            continue
        if flow_hint_norm not in flattened_text:
            continue
        if partner_hint_norm and partner_hint_norm not in flattened_text:
            continue
        if 'value_eur' not in flattened_text:
            continue

        time_row_idx = None
        monthly_cols: list[int] = []
        monthly_labels: list[str] = []

        for row_idx in range(min(len(df), 30)):
            row_values = [str(v).strip() for v in df.iloc[row_idx].tolist()]
            if not any(v.upper() == 'TIME' for v in row_values):
                continue

            candidate_cols = []
            candidate_labels = []
            for col_idx, cell in enumerate(row_values):
                if re.match(r'^\d{4}-\d{2}$', cell):
                    candidate_cols.append(col_idx)
                    candidate_labels.append(cell)

            if len(candidate_cols) >= 12:
                time_row_idx = row_idx
                monthly_cols = candidate_cols
                monthly_labels = candidate_labels
                break

        if time_row_idx is None or not monthly_cols:
            continue

        best_row_idx = None
        best_count = -1

        for row_idx in range(time_row_idx + 1, len(df)):
            numeric = pd.to_numeric(df.iloc[row_idx, monthly_cols], errors='coerce')
            count = int(numeric.notna().sum())
            if count > best_count:
                best_count = count
                best_row_idx = row_idx

        if best_row_idx is None or best_count < 12:
            continue

        monthly_series: dict[str, float] = {}
        for col_idx, period in zip(monthly_cols, monthly_labels):
            value = pd.to_numeric(df.iat[best_row_idx, col_idx], errors='coerce')
            if pd.isna(value):
                continue
            monthly_series[period] = float(value)

        if monthly_series:
            return monthly_series, sheet_name

    raise RuntimeError(
        f"Could not parse monthly VALUE_EUR {flow_hint_norm} series for product '{product_hint}' in file {file_path.name}"
    )


def _extract_series_from_workbooks(
    workbooks: list[Path],
    product_hint: str,
    flow_hint: str,
    partner_hint: str | None = None,
    preferred_sheet: str | None = None,
) -> tuple[dict[str, float], str, str]:
    errors: list[str] = []
    for workbook in workbooks:
        try:
            monthly, sheet = _extract_monthly_value_eur_series_from_workbook(
                workbook,
                product_hint=product_hint,
                flow_hint=flow_hint,
                partner_hint=partner_hint,
                preferred_sheet=preferred_sheet,
            )
            return monthly, workbook.name, sheet
        except Exception as exc:
            errors.append(f"{workbook.name}: {exc}")

    raise RuntimeError(
        f"Could not locate series product='{product_hint}', flow='{flow_hint}'"
        + (f", partner='{partner_hint}'" if partner_hint else '')
        + (f", preferred_sheet='{preferred_sheet}'" if preferred_sheet else '')
        + f". Attempts: {' | '.join(errors)}"
    )


def _aggregate_monthly_to_quarterly(monthly_series: dict[str, float]) -> dict[str, float]:
    quarterly: dict[str, float] = {}

    for month_code, value in monthly_series.items():
        if not re.match(r'^\d{4}-\d{2}$', str(month_code)):
            continue

        year_str, month_str = str(month_code).split('-')
        month_num = int(month_str)
        if month_num < 1 or month_num > 12:
            continue

        quarter = ((month_num - 1) // 3) + 1
        period = f'Q{quarter}/{year_str}'
        quarterly[period] = quarterly.get(period, 0.0) + float(value)

    return quarterly


def fetch_eurozone_petrochem_imports_from_uploaded_excels(
    partner_scope: str = 'world',
    sheet_overrides: dict[str, str] | None = None,
):
    base_dir = Path(__file__).resolve().parent
    sheet_overrides = sheet_overrides or {}

    organic_file = _find_excel_file(
        base_dir,
        explicit_names=['organic_chemical.xlsx'],
        glob_patterns=['*organic*chem*.xlsx', '*organic*.xlsx']
    )
    plastics_file = _find_excel_file(
        base_dir,
        explicit_names=['plastics_in_prmary_forms.xlsx', 'plastics_in_primary_forms.xlsx'],
        glob_patterns=['*plastics*primary*form*.xlsx', '*plastic*form*.xlsx', '*plastics*.xlsx']
    )

    if organic_file is None:
        raise FileNotFoundError('organic_chemical.xlsx was not found in the project folder.')
    if plastics_file is None:
        raise FileNotFoundError('plastics_in_prmary_forms.xlsx was not found in the project folder.')

    partner_scope_norm = (partner_scope or 'world').strip().lower()
    partner_scope_map = {
        'world': 'all countries of the world',
        'extra': 'extra-eu27 (from 2020)',
        'intra': 'intra-eu27 (from 2020)',
        'auto': None,
    }
    if partner_scope_norm not in partner_scope_map:
        raise ValueError("partner_scope must be one of: world, extra, intra, auto")
    partner_hint = partner_scope_map[partner_scope_norm]

    workbooks = [organic_file, plastics_file]

    sitc51_imports_monthly, sitc51_imports_file, sitc51_imports_sheet = _extract_series_from_workbooks(
        workbooks,
        product_hint='organic chemicals',
        flow_hint='import',
        partner_hint=partner_hint,
        preferred_sheet=sheet_overrides.get('sitc51_imports_sheet'),
    )

    sitc51_exports_monthly: dict[str, float] = {}
    sitc51_exports_sheet: str | None = None
    sitc51_exports_file: str | None = None
    try:
        sitc51_exports_monthly, sitc51_exports_file, sitc51_exports_sheet = _extract_series_from_workbooks(
            workbooks,
            product_hint='organic chemicals',
            flow_hint='export',
            partner_hint=partner_hint,
            preferred_sheet=sheet_overrides.get('sitc51_exports_sheet'),
        )
    except Exception:
        sitc51_exports_monthly = {}
        sitc51_exports_sheet = None
        sitc51_exports_file = None

    sitc57_imports_monthly, sitc57_imports_file, sitc57_imports_sheet = _extract_series_from_workbooks(
        workbooks,
        product_hint='plastics in primary forms',
        flow_hint='import',
        partner_hint=partner_hint,
        preferred_sheet=sheet_overrides.get('sitc57_imports_sheet'),
    )

    sitc57_exports_monthly: dict[str, float] = {}
    sitc57_exports_sheet: str | None = None
    sitc57_exports_file: str | None = None
    try:
        sitc57_exports_monthly, sitc57_exports_file, sitc57_exports_sheet = _extract_series_from_workbooks(
            workbooks,
            product_hint='plastics in primary forms',
            flow_hint='export',
            partner_hint=partner_hint,
            preferred_sheet=sheet_overrides.get('sitc57_exports_sheet'),
        )
    except Exception:
        sitc57_exports_monthly = {}
        sitc57_exports_sheet = None
        sitc57_exports_file = None

    all_months = sorted(
        set(sitc51_imports_monthly.keys())
        | set(sitc51_exports_monthly.keys())
        | set(sitc57_imports_monthly.keys())
        | set(sitc57_exports_monthly.keys())
    )

    combined_imports_monthly: dict[str, float] = {}
    combined_exports_monthly: dict[str, float] = {}
    for month_code in all_months:
        combined_imports_monthly[month_code] = (
            float(sitc51_imports_monthly.get(month_code, 0.0))
            + float(sitc57_imports_monthly.get(month_code, 0.0))
        )
        combined_exports_monthly[month_code] = (
            float(sitc51_exports_monthly.get(month_code, 0.0))
            + float(sitc57_exports_monthly.get(month_code, 0.0))
        )

    imports_quarterly = _aggregate_monthly_to_quarterly(combined_imports_monthly)
    exports_quarterly = _aggregate_monthly_to_quarterly(combined_exports_monthly)

    periods = sorted(
        set(imports_quarterly.keys()) | set(exports_quarterly.keys()),
        key=lambda p: (int(p.split('/')[1]), int(p[1]))
    )

    points = [
        {
            'period': period,
            'imports_eur': imports_quarterly.get(period),
            'exports_eur': exports_quarterly.get(period),
            'net_imports_eur': (
                (imports_quarterly.get(period) or 0.0)
                - (exports_quarterly.get(period) or 0.0)
            ),
        }
        for period in periods
    ]

    start_year = int(periods[0].split('/')[1]) if periods else None
    end_year = int(periods[-1].split('/')[1]) if periods else None

    return {
        'source': 'uploaded_excel_files',
        'definition_label': (
            f"SITC51 + SITC57 from uploaded Excel files "
            f"(imports, exports, net imports; partner scope: {partner_scope_norm})"
        ),
        'partner_scope': partner_scope_norm,
        'partner_filter_used': partner_hint,
        'files': {
            'sitc51_file': organic_file.name,
            'sitc57_file': plastics_file.name,
            'sitc51_imports_file_used': sitc51_imports_file,
            'sitc51_exports_file_used': sitc51_exports_file,
            'sitc57_imports_file_used': sitc57_imports_file,
            'sitc57_exports_file_used': sitc57_exports_file,
            'sitc51_imports_sheet': sitc51_imports_sheet,
            'sitc51_exports_sheet': sitc51_exports_sheet,
            'sitc57_imports_sheet': sitc57_imports_sheet,
            'sitc57_exports_sheet': sitc57_exports_sheet,
        },
        'notes': [
            'Values are used as provided in Excel (raw VALUE_EUR units; no thousand/million/billion scaling).',
            'If an export flow sheet is missing in uploaded files, missing exports are treated as 0 for net calculation.',
        ],
        'unit': 'EUR',
        'frequency': 'Q',
        'aggregation': 'Quarterly sum of monthly VALUE_EUR values (raw units from Excel; no scaling)',
        'start_year': start_year,
        'end_year': end_year,
        'points': points,
    }


@app.route('/api/eurozone-petrochem-imports', methods=['GET'])
def get_eurozone_petrochem_imports():
    """Return quarterly Eurozone petrochemicals imports from uploaded SITC51/SITC57 Excel files."""
    try:
        partner_scope = (request.args.get('partner_scope') or 'world').strip().lower()
        sheet_overrides = {
            'sitc51_imports_sheet': request.args.get('sitc51_imports_sheet') or '',
            'sitc51_exports_sheet': request.args.get('sitc51_exports_sheet') or '',
            'sitc57_imports_sheet': request.args.get('sitc57_imports_sheet') or '',
            'sitc57_exports_sheet': request.args.get('sitc57_exports_sheet') or '',
        }
        sheet_overrides = {k: v for k, v in sheet_overrides.items() if str(v).strip()}

        payload = fetch_eurozone_petrochem_imports_from_uploaded_excels(
            partner_scope=partner_scope,
            sheet_overrides=sheet_overrides,
        )
        return jsonify(payload)
    except Exception as e:
        print(f"Error in eurozone-petrochem-imports endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def fetch_eurostat_country_petrochem_imports_annual(
    country_codes: list[str] | None = None,
    partner: str = 'WORLD',
    sitc_code: str = 'SITC5',
):
    """Fetch annual petrochemical imports for selected countries from Eurostat (ext_lt_intertrd)."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ext_lt_intertrd'
    allowed_countries = {
        'FR': 'France',
        'DE': 'Germany',
        'BE': 'Belgium',
        'IT': 'Italy',
        'ES': 'Spain',
    }

    if country_codes is None:
        country_codes = ['FR', 'DE', 'BE', 'IT']

    normalized_codes = []
    for code in country_codes:
        code_norm = str(code).strip().upper()
        if not code_norm:
            continue
        if code_norm not in allowed_countries:
            raise ValueError(f"Unsupported country code '{code_norm}'. Allowed: {', '.join(sorted(allowed_countries.keys()))}")
        normalized_codes.append(code_norm)

    if not normalized_codes:
        raise ValueError('No valid country codes provided.')

    partner_norm = str(partner or 'WORLD').strip().upper()

    def fetch_country_series(geo_code: str):
        params = {
            'lang': 'en',
            'freq': 'A',
            'geo': geo_code,
            'partner': partner_norm,
            'indic_et': 'MIO_IMP_VAL',
            'sitc06': sitc_code,
        }

        payload = None
        last_error = None
        for attempt in range(1, 3):
            try:
                response = requests.get(base_url, params=params, timeout=30)
                response.raise_for_status()
                payload = response.json()
                break
            except Exception as e:
                last_error = e
                print(f"Country petrochem imports fetch failed (attempt {attempt}/2, geo={geo_code}): {e}")
                if attempt < 2:
                    time.sleep(0.8 * attempt)

        if payload is None:
            raise RuntimeError(f"Country petrochem imports fetch failed for geo={geo_code}: {last_error}")

        time_index = payload.get('dimension', {}).get('time', {}).get('category', {}).get('index', {})
        values = payload.get('value', {})

        points = []
        for year_code, year_pos in time_index.items():
            year_str = str(year_code)
            if not year_str.isdigit():
                continue
            value = values.get(str(year_pos))
            if value is None:
                continue
            points.append({
                'year': int(year_str),
                'imports_eur': float(value) * 1_000_000.0,
            })

        points.sort(key=lambda item: item['year'])
        return {
            'geo': geo_code,
            'country': allowed_countries[geo_code],
            'points': points,
        }

    series = []
    all_years = set()
    for geo_code in normalized_codes:
        country_series = fetch_country_series(geo_code)
        series.append(country_series)
        for point in country_series['points']:
            all_years.add(point['year'])

    years = sorted(all_years)

    brent_payload = fetch_brent_oil_annual(
        start_year=years[0] if years else 2002,
        end_year=years[-1] if years else datetime.utcnow().year,
    )
    brent_by_year = {
        int(point['year']): float(point['brent_usd_per_barrel'])
        for point in (brent_payload.get('points') or [])
        if point.get('year') is not None and point.get('brent_usd_per_barrel') is not None
    }

    return {
        'source': 'Eurostat',
        'dataset': 'ext_lt_intertrd',
        'sitc06': sitc_code,
        'partner': partner_norm,
        'indicator': 'MIO_IMP_VAL',
        'frequency': 'A',
        'unit': 'EUR',
        'notes': 'Country values are annual imports and converted from million EUR to EUR.',
        'years': years,
        'series': series,
        'brent': {
            'series_id': brent_payload.get('series_id'),
            'unit': brent_payload.get('unit'),
            'by_year': brent_by_year,
        },
    }


@app.route('/api/petrochem-country-imports', methods=['GET'])
def get_petrochem_country_imports():
    """Return annual petrochemicals imports by country."""
    try:
        countries_arg = request.args.get('countries') or 'FR,DE,BE,IT'
        countries = [item.strip().upper() for item in countries_arg.split(',') if item.strip()]
        partner = request.args.get('partner') or 'WORLD'
        sitc_code = request.args.get('sitc06') or 'SITC5'
        payload = fetch_eurostat_country_petrochem_imports_annual(
            country_codes=countries,
            partner=partner,
            sitc_code=sitc_code,
        )
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in petrochem-country-imports endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def fetch_world_bank_indicator_series(country_code, indicator_code):
    """Fetch annual World Bank indicator values with basic retry/backoff."""
    url = f"https://api.worldbank.org/v2/country/{country_code}/indicator/{indicator_code}"
    params = {
        'format': 'json',
        'per_page': 20000,
    }

    last_error = None
    for attempt in range(1, 4):
        try:
            response = requests.get(url, params=params, timeout=45)
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, list) or len(payload) < 2 or not isinstance(payload[1], list):
                return {}

            series = {}
            for row in payload[1]:
                year = row.get('date')
                value = row.get('value')
                if year is None or value is None:
                    continue
                year_str = str(year)
                if not year_str.isdigit():
                    continue
                series[year_str] = float(value)
            return series
        except Exception as e:
            last_error = e
            print(f"World Bank fetch failed (attempt {attempt}/3, country={country_code}, indicator={indicator_code}): {e}")
            if attempt < 3:
                time.sleep(1.5 * attempt)

    raise RuntimeError(f"World Bank fetch failed for country={country_code}, indicator={indicator_code}: {last_error}")


def fetch_us_italy_imports_fuel_proxy():
    """Return annual imports and fuel-share composition for US and Italy (fuel combined proxy)."""
    countries = {
        'USA': 'United States',
        'ITA': 'Italy',
    }

    # NE.IMP.GNFS.CD: Imports of goods and services (current US$)
    # TM.VAL.FUEL.ZS.UN: Fuel imports (% of merchandise imports)
    imports_indicator = 'NE.IMP.GNFS.CD'
    fuel_share_indicator = 'TM.VAL.FUEL.ZS.UN'

    country_series = []
    all_years = set()

    for code, label in countries.items():
        imports_map = fetch_world_bank_indicator_series(code, imports_indicator)
        fuel_share_map = fetch_world_bank_indicator_series(code, fuel_share_indicator)

        years = sorted(set(imports_map.keys()) | set(fuel_share_map.keys()))
        points = []

        for year in years:
            imports_value = imports_map.get(year)
            fuel_share = fuel_share_map.get(year)

            if imports_value is None and fuel_share is None:
                continue

            other_share = (100.0 - fuel_share) if fuel_share is not None else None
            points.append({
                'year': int(year),
                'total_imports_usd': imports_value,
                'fuel_share_pct': fuel_share,
                'other_share_pct': other_share,
            })
            all_years.add(int(year))

        country_series.append({
            'country_code': code,
            'country_label': label,
            'points': sorted(points, key=lambda item: item['year'])
        })

    return {
        'source': 'World Bank Open Data',
        'notes': 'Fuel share is combined fuel imports percentage (no oil/gas split).',
        'indicators': {
            'total_imports': imports_indicator,
            'fuel_share_pct': fuel_share_indicator,
        },
        'start_year': min(all_years) if all_years else None,
        'end_year': max(all_years) if all_years else None,
        'countries': country_series,
    }


@app.route('/api/us-italy-imports-fuel-proxy', methods=['GET'])
def get_us_italy_imports_fuel_proxy():
    """Return US and Italy imports + combined fuel share composition (annual)."""
    try:
        payload = fetch_us_italy_imports_fuel_proxy()
        return jsonify(payload)
    except Exception as e:
        print(f"Error in us-italy-imports-fuel-proxy endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def fetch_eurostat_country_imports_fuel_real_annual(geo='IT'):
    """Return annual country imports/exports and net-imports composition from Eurostat (non-proxy)."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ext_lt_intertrd'
    geo_code = str(geo or 'IT').strip().upper()
    country_labels = {
        'IT': 'Italy',
        'DE': 'Germany',
        'FR': 'France',
        'ES': 'Spain',
        'BE': 'Belgium',
    }
    if geo_code not in country_labels:
        raise ValueError(f"Unsupported geo '{geo_code}'. Allowed: {', '.join(country_labels.keys())}")

    now_ts = time.time()
    cached = EUROSTAT_COUNTRY_FUEL_CACHE.get(geo_code)
    if cached and (now_ts - cached.get('computed_at', 0)) < EUROSTAT_COUNTRY_FUEL_CACHE_TTL_SECONDS:
        return cached['payload']

    def fetch_trade_series(sitc_code, indicator_code):
        params = {
            'lang': 'en',
            'freq': 'A',
            'geo': geo_code,
            'partner': 'WORLD',
            'indic_et': indicator_code,
            'sitc06': sitc_code,
        }

        payload = None
        last_error = None
        for attempt in range(1, 3):
            try:
                response = requests.get(base_url, params=params, timeout=20)
                response.raise_for_status()
                payload = response.json()
                break
            except Exception as e:
                last_error = e
                print(f"{geo_code} Eurostat fetch failed (attempt {attempt}/2, sitc={sitc_code}, indic={indicator_code}): {e}")
                if attempt < 2:
                    time.sleep(1.0 * attempt)

        if payload is None:
            raise RuntimeError(f"{geo_code} Eurostat fetch failed for sitc={sitc_code}, indic={indicator_code}: {last_error}")

        time_index = payload.get('dimension', {}).get('time', {}).get('category', {}).get('index', {})
        values = payload.get('value', {})

        annual = {}
        for year_code, year_pos in time_index.items():
            year_str = str(year_code)
            if not year_str.isdigit():
                continue
            value = values.get(str(year_pos))
            if value is None:
                continue
            annual[int(year_str)] = float(value)
        return annual

    def fetch_eurozone_oil_gas_split_annual():
        cache_key = 'EA20_EXT_EU27_2020_IMP_TRD_VAL'
        now_local = time.time()
        cached_split = EUROZONE_OIL_GAS_SPLIT_CACHE.get(cache_key)
        if cached_split and (now_local - cached_split.get('computed_at', 0)) < EUROZONE_OIL_GAS_SPLIT_CACHE_TTL_SECONDS:
            return cached_split.get('split_by_year', {})

        base_short = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ext_st_eu27_2020sitc'

        def fetch_monthly_series_short(sitc_code):
            params = {
                'lang': 'en',
                'stk_flow': 'IMP',
                'indic_et': 'TRD_VAL',
                'partner': 'EXT_EU27_2020',
                'sitc06': sitc_code,
            }

            payload = None
            last_error = None
            for attempt in range(1, 3):
                try:
                    response = requests.get(base_short, params=params, timeout=20)
                    response.raise_for_status()
                    payload = response.json()
                    break
                except Exception as e:
                    last_error = e
                    print(f"Eurozone split fetch failed (attempt {attempt}/2, sitc={sitc_code}): {e}")
                    if attempt < 2:
                        time.sleep(0.8 * attempt)

            if payload is None:
                raise RuntimeError(f"Eurozone split fetch failed for sitc={sitc_code}: {last_error}")

            time_index = payload.get('dimension', {}).get('time', {}).get('category', {}).get('index', {})
            values = payload.get('value', {})
            monthly = {}
            for month_code, month_pos in time_index.items():
                value = values.get(str(month_pos))
                if value is None:
                    continue
                monthly[str(month_code)] = float(value)
            return monthly

        energy_monthly = fetch_monthly_series_short('SITC3')
        oil_monthly = fetch_monthly_series_short('SITC33')

        annual_energy = {}
        annual_oil = {}

        for month_code, value in energy_monthly.items():
            year = str(month_code).split('-')[0]
            if year.isdigit():
                y = int(year)
                annual_energy[y] = annual_energy.get(y, 0.0) + float(value)

        for month_code, value in oil_monthly.items():
            year = str(month_code).split('-')[0]
            if year.isdigit():
                y = int(year)
                annual_oil[y] = annual_oil.get(y, 0.0) + float(value)

        split_by_year = {}
        years = sorted(set(annual_energy.keys()) | set(annual_oil.keys()))
        for year in years:
            energy_val = annual_energy.get(year)
            oil_val = annual_oil.get(year)
            if energy_val is None or oil_val is None or energy_val <= 0:
                continue
            oil_ratio = max(0.0, min(1.0, float(oil_val) / float(energy_val)))
            split_by_year[int(year)] = {
                'oil_ratio_in_fuels': oil_ratio,
                'gas_ratio_in_fuels': 1.0 - oil_ratio,
            }

        EUROZONE_OIL_GAS_SPLIT_CACHE[cache_key] = {
            'computed_at': now_local,
            'split_by_year': split_by_year,
        }
        return split_by_year

    series_specs = {
        'total_imp_map': ('TOTAL', 'MIO_IMP_VAL'),
        'total_exp_map': ('TOTAL', 'MIO_EXP_VAL'),
        'energy_imp_map': ('SITC3', 'MIO_IMP_VAL'),
        'energy_exp_map': ('SITC3', 'MIO_EXP_VAL'),
        'oil_imp_map': ('SITC33', 'MIO_IMP_VAL'),
        'oil_exp_map': ('SITC33', 'MIO_EXP_VAL'),
    }

    series_results: dict[str, dict[int, float]] = {}
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {
            key: executor.submit(fetch_trade_series, sitc_code, indicator_code)
            for key, (sitc_code, indicator_code) in series_specs.items()
        }
        for key, future in futures.items():
            try:
                series_results[key] = future.result()
            except Exception as e:
                print(f"{geo_code} Eurostat parallel fetch task failed ({key}): {e}")
                series_results[key] = {}

    total_imp_map = series_results.get('total_imp_map', {})
    total_exp_map = series_results.get('total_exp_map', {})
    energy_imp_map = series_results.get('energy_imp_map', {})
    energy_exp_map = series_results.get('energy_exp_map', {})
    oil_imp_map = series_results.get('oil_imp_map', {})
    oil_exp_map = series_results.get('oil_exp_map', {})
    eurozone_split = fetch_eurozone_oil_gas_split_annual()

    years = sorted(
        set(total_imp_map.keys()) | set(total_exp_map.keys()) |
        set(energy_imp_map.keys()) | set(energy_exp_map.keys()) |
        set(oil_imp_map.keys()) | set(oil_exp_map.keys())
    )
    points = []
    for year in years:
        total_imports = total_imp_map.get(year)
        total_exports = total_exp_map.get(year)
        energy_imports = energy_imp_map.get(year)
        energy_exports = energy_exp_map.get(year)
        oil_imports = oil_imp_map.get(year)
        oil_exports = oil_exp_map.get(year)

        split_method = 'direct'
        if oil_imports is None and energy_imports is not None:
            split = eurozone_split.get(int(year))
            if split:
                oil_imports = float(energy_imports) * float(split['oil_ratio_in_fuels'])
                split_method = 'estimated_from_eurozone_fuel_mix'

        if oil_exports is None and energy_exports is not None:
            split = eurozone_split.get(int(year))
            if split:
                oil_exports = float(energy_exports) * float(split['oil_ratio_in_fuels'])

        if split_method == 'direct' and oil_imports is None and energy_imports is not None:
            split_method = 'combined_fuels_only'

        total_net = (
            (total_imports if total_imports is not None else 0.0) -
            (total_exports if total_exports is not None else 0.0)
        ) if (total_imports is not None or total_exports is not None) else None

        energy_net = (
            (energy_imports if energy_imports is not None else 0.0) -
            (energy_exports if energy_exports is not None else 0.0)
        ) if (energy_imports is not None or energy_exports is not None) else None

        oil_net = (
            (oil_imports if oil_imports is not None else 0.0) -
            (oil_exports if oil_exports is not None else 0.0)
        ) if (oil_imports is not None or oil_exports is not None) else None

        gas_net = (energy_net - oil_net) if (energy_net is not None and oil_net is not None) else None

        gas_imports = (energy_imports - oil_imports) if (energy_imports is not None and oil_imports is not None) else None

        if total_imports is None or total_imports <= 0:
            oil_share = None
            gas_share = None
            energy_share = None
            other_share = None
        else:
            oil_share = (oil_imports / total_imports) * 100.0 if oil_imports is not None else None
            gas_share = (gas_imports / total_imports) * 100.0 if gas_imports is not None else None
            energy_share = (energy_imports / total_imports) * 100.0 if energy_imports is not None else None
            other_share = (100.0 - energy_share) if energy_share is not None else None

        points.append({
            'year': int(year),
            'total_imports_million_eur': total_imports,
            'total_exports_million_eur': total_exports,
            'total_net_imports_million_eur': total_net,
            'energy_imports_million_eur': energy_imports,
            'energy_exports_million_eur': energy_exports,
            'energy_net_imports_million_eur': energy_net,
            'oil_imports_million_eur': oil_imports,
            'oil_exports_million_eur': oil_exports,
            'oil_net_imports_million_eur': oil_net,
            'gas_imports_million_eur': gas_imports,
            'gas_net_imports_million_eur': gas_net,
            'fuel_share_pct': energy_share,
            'oil_share_pct': oil_share,
            'gas_share_pct': gas_share,
            'other_share_pct': other_share,
            'oil_gas_split_method': split_method,
        })

    payload = {
        'source': 'Eurostat (non-proxy)',
        'dataset': 'ext_lt_intertrd',
        'geo': geo_code,
        'country_label': country_labels[geo_code],
        'partner': 'WORLD',
        'indic_et': 'MIO_IMP_VAL & MIO_EXP_VAL',
        'frequency': 'A',
        'unit': 'million EUR',
        'net_imports_method': 'net imports = imports - exports',
        'share_method': 'Shares are based on imports only (component imports / total imports).',
        'oil_gas_split_note': 'Oil/gas split is estimated from Eurozone annual fuel mix when country-level oil code is unavailable.',
        'start_year': years[0] if years else None,
        'end_year': years[-1] if years else None,
        'points': points,
    }

    EUROSTAT_COUNTRY_FUEL_CACHE[geo_code] = {
        'computed_at': now_ts,
        'payload': payload,
    }

    return payload


@app.route('/api/eurostat-country-imports-fuel-real', methods=['GET'])
def get_eurostat_country_imports_fuel_real():
    """Return annual country real imports + oil/gas composition from Eurostat."""
    try:
        geo = request.args.get('geo', 'IT')
        payload = fetch_eurostat_country_imports_fuel_real_annual(geo=geo)
        return jsonify(payload)
    except Exception as e:
        print(f"Error in eurostat-country-imports-fuel-real endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/italy-imports-fuel-real', methods=['GET'])
def get_italy_imports_fuel_real():
    """Return annual Italy real imports + oil/gas composition from Eurostat."""
    try:
        payload = fetch_eurostat_country_imports_fuel_real_annual(geo='IT')
        return jsonify(payload)
    except Exception as e:
        print(f"Error in italy-imports-fuel-real endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def fetch_census_hs_annual_sum(flow, year, value_field, commodity_code=None, comm_lvl=None, timeout_seconds=25, max_attempts=2):
    """Fetch annual U.S. Census trade HS values and sum across returned rows."""
    if flow not in {'imports', 'exports'}:
        raise ValueError("flow must be 'imports' or 'exports'")

    base_url = f'https://api.census.gov/data/timeseries/intltrade/{flow}/hs'
    commodity_field = 'I_COMMODITY' if flow == 'imports' else 'E_COMMODITY'

    get_fields = [value_field]
    if commodity_code is not None:
        get_fields.append(commodity_field)

    params = {
        'get': ','.join(get_fields),
        'time': f'{year}-12',
    }
    if comm_lvl:
        params['COMM_LVL'] = comm_lvl
    if commodity_code is not None:
        params[commodity_field] = commodity_code

    payload = None
    last_error = None
    for attempt in range(1, max_attempts + 1):
        try:
            response = requests.get(base_url, params=params, timeout=timeout_seconds)
            if response.status_code == 204:
                return 0.0
            response.raise_for_status()
            payload = response.json()
            break
        except Exception as e:
            last_error = e
            print(f"Census HS fetch failed (attempt {attempt}/{max_attempts}, flow={flow}, year={year}, commodity={commodity_code}): {e}")
            if attempt < max_attempts:
                time.sleep(1.2 * attempt)

    if payload is None:
        raise RuntimeError(f"Census HS fetch failed for flow={flow}, year={year}, commodity={commodity_code}: {last_error}")

    if not isinstance(payload, list) or len(payload) < 2:
        return 0.0

    headers = payload[0]
    if value_field not in headers:
        return 0.0
    value_idx = headers.index(value_field)

    total = 0.0
    for row in payload[1:]:
        if value_idx >= len(row):
            continue
        raw_val = row[value_idx]
        if raw_val in (None, '', '.'):
            continue
        try:
            total += float(raw_val)
        except Exception:
            continue

    return total


def fetch_us_real_energy_imports_weights(start_year=2019, end_year=None, allow_slow_fallback=False):
    """Return annual U.S. real (non-proxy) oil/gas net-imports composition from Census HS trade values."""
    if end_year is None:
        end_year = datetime.now(timezone.utc).year - 1

    def fetch_census_annual_series(flow, commodity_code, value_field):
        base_url = f'https://api.census.gov/data/timeseries/intltrade/{flow}/hs'
        commodity_field = 'I_COMMODITY' if flow == 'imports' else 'E_COMMODITY'
        params = {
            'get': f'YEAR,{value_field},{commodity_field}',
            'COMM_LVL': 'HS4',
            commodity_field: commodity_code,
        }

        payload = None
        last_error = None
        for attempt in range(1, 2):
            try:
                response = requests.get(base_url, params=params, timeout=12)
                response.raise_for_status()
                payload = response.json()
                break
            except Exception as e:
                last_error = e
                print(f"Census bulk fetch failed (attempt {attempt}/1, flow={flow}, code={commodity_code}): {e}")
                status_code = getattr(getattr(e, 'response', None), 'status_code', None)
                if status_code in {429, 500, 502, 503, 504}:
                    break
                if attempt < 1:
                    time.sleep(1.2 * attempt)

        if payload is None:
            if not allow_slow_fallback:
                print(f"Skipping slow year-by-year fallback for flow={flow}, code={commodity_code}")
                return {}

            print(f"Falling back to year-by-year Census fetch for flow={flow}, code={commodity_code}")
            annual_fallback = {}
            annual_field = 'GEN_VAL_YR' if flow == 'imports' else 'ALL_VAL_YR'
            for year in range(int(start_year), int(end_year) + 1):
                try:
                    value = fetch_census_hs_annual_sum(
                        flow,
                        year,
                        annual_field,
                        commodity_code=commodity_code,
                        comm_lvl='HS4',
                        timeout_seconds=12,
                        max_attempts=1,
                    )
                except Exception:
                    value = 0.0
                annual_fallback[year] = annual_fallback.get(year, 0.0) + float(value or 0.0)
            return annual_fallback

        if not isinstance(payload, list) or len(payload) < 2:
            return {}

        headers = payload[0]
        year_idx = headers.index('YEAR') if 'YEAR' in headers else -1
        value_idx = headers.index(value_field) if value_field in headers else -1
        if year_idx < 0 or value_idx < 0:
            return {}

        annual = {}
        for row in payload[1:]:
            if year_idx >= len(row) or value_idx >= len(row):
                continue
            year_raw = str(row[year_idx])
            if not year_raw.isdigit():
                continue
            year = int(year_raw)
            try:
                value = float(row[value_idx])
            except Exception:
                continue
            annual[year] = annual.get(year, 0.0) + value
        return annual

    # Oil: HS 2709 (crude) + 2710 (refined oils), Gas: HS 2711 (petroleum gases)
    census_tasks = {
        'oil_imports_2709': ('imports', '2709', 'GEN_VAL_MO'),
        'oil_imports_2710': ('imports', '2710', 'GEN_VAL_MO'),
        'oil_exports_2709': ('exports', '2709', 'ALL_VAL_MO'),
        'oil_exports_2710': ('exports', '2710', 'ALL_VAL_MO'),
        'gas_imports_2711': ('imports', '2711', 'GEN_VAL_MO'),
        'gas_exports_2711': ('exports', '2711', 'ALL_VAL_MO'),
    }

    census_results = {}
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {
            key: executor.submit(fetch_census_annual_series, flow, code, value_field)
            for key, (flow, code, value_field) in census_tasks.items()
        }
        for key, future in futures.items():
            try:
                census_results[key] = future.result()
            except Exception as e:
                print(f"Census task failed ({key}): {e}")
                census_results[key] = {}

    oil_imports = dict(census_results.get('oil_imports_2709', {}))
    oil_imports_2 = dict(census_results.get('oil_imports_2710', {}))
    oil_exports = dict(census_results.get('oil_exports_2709', {}))
    oil_exports_2 = dict(census_results.get('oil_exports_2710', {}))
    gas_imports = dict(census_results.get('gas_imports_2711', {}))
    gas_exports = dict(census_results.get('gas_exports_2711', {}))

    for year, value in oil_imports_2.items():
        oil_imports[year] = oil_imports.get(year, 0.0) + value
    for year, value in oil_exports_2.items():
        oil_exports[year] = oil_exports.get(year, 0.0) + value

    # Fast total net imports proxy from FRED imports/exports of goods and services
    with ThreadPoolExecutor(max_workers=2) as executor:
        imports_future = executor.submit(
            fetch_fred_data,
            'IMPGS',
            f'{int(start_year)}-01-01',
            f'{int(end_year)}-12-31',
            FRED_API_KEY,
        )
        exports_future = executor.submit(
            fetch_fred_data,
            'EXPGS',
            f'{int(start_year)}-01-01',
            f'{int(end_year)}-12-31',
            FRED_API_KEY,
        )
        imports_gs = imports_future.result()
        exports_gs = exports_future.result()

    imports_by_year = {}
    exports_by_year = {}
    for date_str, value in imports_gs:
        year = int(str(date_str)[:4])
        imports_by_year.setdefault(year, []).append(float(value))
    for date_str, value in exports_gs:
        year = int(str(date_str)[:4])
        exports_by_year.setdefault(year, []).append(float(value))

    points = []
    for year in range(int(start_year), int(end_year) + 1):
        imp_vals = imports_by_year.get(year, [])
        exp_vals = exports_by_year.get(year, [])
        total_imports = (sum(imp_vals) / len(imp_vals) * 1_000_000_000.0) if imp_vals else None
        total_exports = (sum(exp_vals) / len(exp_vals) * 1_000_000_000.0) if exp_vals else None
        total_net = (total_imports - total_exports) if (total_imports is not None and total_exports is not None) else None

        oil_imp = oil_imports.get(year)
        oil_exp = oil_exports.get(year)
        gas_imp = gas_imports.get(year)
        gas_exp = gas_exports.get(year)

        oil_net = None if (oil_imp is None and oil_exp is None) else float(oil_imp or 0.0) - float(oil_exp or 0.0)
        gas_net = None if (gas_imp is None and gas_exp is None) else float(gas_imp or 0.0) - float(gas_exp or 0.0)
        oil_net_exports = None if oil_net is None else -oil_net
        gas_net_exports = None if gas_net is None else -gas_net

        known_energy = [v for v in [oil_net, gas_net] if v is not None]
        other_net = (total_net - sum(known_energy)) if (total_net is not None) else None
        total_net_exports = None if total_net is None else -total_net

        positive_components = [
            max(oil_net, 0.0) if oil_net is not None else None,
            max(gas_net, 0.0) if gas_net is not None else None,
            max(other_net, 0.0) if other_net is not None else None,
        ]
        positive_base = sum(v for v in positive_components if v is not None)
        has_any_component = any(v is not None for v in positive_components)
        total_net_imports = positive_base if (has_any_component and positive_base > 0) else None

        oil_weight = ((max(oil_net, 0.0) / positive_base) * 100.0) if (oil_net is not None and positive_base > 0) else None
        gas_weight = ((max(gas_net, 0.0) / positive_base) * 100.0) if (gas_net is not None and positive_base > 0) else None
        other_weight = ((max(other_net, 0.0) / positive_base) * 100.0) if (other_net is not None and positive_base > 0) else None

        points.append({
            'year': year,
            'total_net_imports_usd': total_net_imports,
            'total_trade_balance_usd': total_net,
            'oil_net_imports_usd': oil_net,
            'gas_net_imports_usd': gas_net,
            'oil_net_exports_usd': oil_net_exports,
            'gas_net_exports_usd': gas_net_exports,
            'total_net_exports_usd': total_net_exports,
            'other_net_imports_usd': other_net,
            'oil_weight_pct': oil_weight,
            'gas_weight_pct': gas_weight,
            'other_weight_pct': other_weight,
        })

    return {
        'source': 'U.S. Census Bureau International Trade API (HS)',
        'notes': 'Non-proxy values. Net imports = imports - exports; net exports = exports - imports. Weights computed on positive net-imports base.',
        'hs_mapping': {
            'oil': ['2709', '2710'],
            'gas': ['2711'],
        },
        'start_year': points[0]['year'] if points else None,
        'end_year': points[-1]['year'] if points else None,
        'points': points,
    }


@app.route('/api/us-real-energy-imports', methods=['GET'])
def get_us_real_energy_imports():
    """Return annual U.S. non-proxy oil/gas net-imports composition."""
    try:
        start_year = int(request.args.get('start_year', 2019))
        end_year = int(request.args.get('end_year', datetime.now(timezone.utc).year - 1))

        cache_key = (start_year, end_year)
        now_ts = time.time()
        cached = US_REAL_ENERGY_CACHE.get(cache_key)
        if cached and (now_ts - cached.get('computed_at', 0)) < US_REAL_ENERGY_CACHE_TTL_SECONDS:
            return jsonify(cached['payload'])

        allow_slow_fallback = str(request.args.get('allow_slow_fallback', '0')).strip().lower() in {'1', 'true', 'yes'}
        payload = fetch_us_real_energy_imports_weights(start_year, end_year, allow_slow_fallback=allow_slow_fallback)
        US_REAL_ENERGY_CACHE[cache_key] = {
            'computed_at': now_ts,
            'payload': payload,
        }
        return jsonify(payload)
    except Exception as e:
        print(f"Error in us-real-energy-imports endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/eur-usd-exchange-quarterly', methods=['GET'])
def get_eur_usd_exchange_quarterly():
    """Return quarterly EUR/USD exchange rate (USD per EUR)."""
    try:
        start_date = request.args.get('start_date', '2000-01-01')
        end_date = request.args.get('end_date', datetime.now(timezone.utc).strftime('%Y-%m-%d'))
        payload = fetch_eur_usd_exchange_quarterly(start_date, end_date)
        return jsonify(payload)
    except Exception as e:
        print(f"Error in eur-usd-exchange-quarterly endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


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
    included_country_codes = EUROZONE_PLUS_POLAND_CODES

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
            # Keep Eurozone + Poland country rows only (exclude aggregates and others)
            if not re.match(r'^[A-Z]{2}$', str(geo_code)):
                continue
            if geo_code not in included_country_codes:
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

    append_unweighted_aggregate_row(rows, ['very_low', 'low', 'high', 'very_high'])

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
        'EU27_2020': 'Eurozone',
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


def fetch_eurostat_digital_intensity_size_evolution_trend_2021_2025(geo='EA20'):
    """Fetch DII shares (2021-2025) across intensity buckets and size classes for one selected country."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_e_dii'

    allowed_geos = {
        'EA20': {
            'label': 'Eurozone',
            'fallback_codes': ['EA20', 'EA19', 'EU27_2020']
        },
        'BE': {'label': 'Belgium', 'fallback_codes': ['BE']},
        'FR': {'label': 'France', 'fallback_codes': ['FR']},
        'ES': {'label': 'Spain', 'fallback_codes': ['ES']},
        'IT': {'label': 'Italy', 'fallback_codes': ['IT']},
        'DE': {'label': 'Germany', 'fallback_codes': ['DE']},
        'PL': {'label': 'Poland', 'fallback_codes': ['PL']},
    }
    if geo not in allowed_geos:
        raise ValueError(f"Unsupported geo '{geo}'. Allowed: {', '.join(allowed_geos.keys())}")

    size_classes = {
        '10-49': '10-49 employees',
        '50-249': '50-249 employees',
        'GE250': '250+ employees',
    }
    indicators = {
        'E_DI3_VLO': 'Very low',
        'E_DI3_LO': 'Low',
        'E_DI3_HI': 'High',
        'E_DI3_VHI': 'Very high',
    }
    years = [2021, 2022, 2023, 2024, 2025]

    values_by_size_indicator = {
        size_emp: {indic_code: {} for indic_code in indicators.keys()}
        for size_emp in size_classes.keys()
    }

    resolved_geo_code = None

    for year in years:
        for size_emp in size_classes.keys():
            params = {
                'lang': 'en',
                'freq': 'A',
                'size_emp': size_emp,
                'nace_r2': 'C10-S951_X_K',
                'unit': 'PC_ENT',
                'time': str(year),
            }

            payload = None
            last_error = None
            for attempt in range(1, 4):
                try:
                    response = requests.get(base_url, params=params, timeout=45)
                    response.raise_for_status()
                    payload = response.json()
                    break
                except Exception as e:
                    last_error = e
                    print(f"Eurostat size-evolution trend fetch failed (attempt {attempt}/3, geo={geo}, size_emp={size_emp}, year={year}): {e}")
                    if attempt < 3:
                        time.sleep(1.2 * attempt)

            if payload is None:
                raise RuntimeError(f"Eurostat size-evolution trend fetch failed for geo={geo}, size_emp={size_emp}, year={year}: {last_error}")

            dim_order = payload.get('id', [])
            dim_sizes_list = payload.get('size', [])
            dimension = payload.get('dimension', {})
            values = payload.get('value', {})

            dim_sizes = {}
            for i, dim_name in enumerate(dim_order):
                dim_sizes[dim_name] = dim_sizes_list[i]

            geo_idx = dimension.get('geo', {}).get('category', {}).get('index', {})
            indic_idx = dimension.get('indic_is', {}).get('category', {}).get('index', {})
            time_idx = dimension.get('time', {}).get('category', {}).get('index', {})

            time_pos = time_idx.get(str(year), 0)

            geo_code_to_use = None
            for candidate in allowed_geos[geo]['fallback_codes']:
                if candidate in geo_idx:
                    geo_code_to_use = candidate
                    break

            if geo_code_to_use is None:
                continue

            if resolved_geo_code is None:
                resolved_geo_code = geo_code_to_use

            for indic_code in indicators.keys():
                indic_pos = indic_idx.get(indic_code)
                if indic_pos is None:
                    continue

                positions = {dim: 0 for dim in dim_order}
                if 'geo' in positions:
                    positions['geo'] = geo_idx[geo_code_to_use]
                if 'indic_is' in positions:
                    positions['indic_is'] = indic_pos
                if 'time' in positions:
                    positions['time'] = time_pos

                flat_index = _ai_flat_index(dim_order, dim_sizes, positions)
                value = values.get(str(flat_index))
                values_by_size_indicator[size_emp][indic_code][year] = (float(value) if value is not None else None)

    sizes_payload = []
    for size_emp, size_label in size_classes.items():
        intensities = []
        for indic_code, indic_label in indicators.items():
            points = [{'year': year, 'value': values_by_size_indicator[size_emp][indic_code].get(year)} for year in years]
            intensities.append({
                'indicator_code': indic_code,
                'indicator': indic_label,
                'points': points,
            })

        sizes_payload.append({
            'size_emp': size_emp,
            'size_label': size_label,
            'intensities': intensities,
        })

    return {
        'dataset': 'isoc_e_dii',
        'years': years,
        'geo': geo,
        'geo_resolved': resolved_geo_code,
        'country': allowed_geos[geo]['label'],
        'sizes': sizes_payload,
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


@app.route('/api/digital-intensity-size-evolution-trend', methods=['GET'])
def get_digital_intensity_size_evolution_trend():
    """Return digital intensity shares over time by intensity and company size for one selected country."""
    try:
        geo = (request.args.get('geo') or 'EA20').strip().upper()
        payload = fetch_eurostat_digital_intensity_size_evolution_trend_2021_2025(geo=geo)
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in digital-intensity-size-evolution-trend endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def fetch_business_registration_bankruptcy_growth_trend(nace_r2='K-N', s_adj='SCA', start_time='2015-Q1', unit='PCH_PRE'):
    """Fetch registration and bankruptcy trends (sts_rb_q) using Eurostat-provided percentage units."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sts_rb_q'

    selected_countries = {
        'EU27_2020': 'Eurozone',
        'BE': 'Belgium',
        'FR': 'France',
        'ES': 'Spain',
        'IT': 'Italy',
        'DE': 'Germany',
        'PL': 'Poland',
    }

    nace_aliases = {
        'B-N_S95_X_K': 'B-S_X_O_S94',
    }
    nace_r2 = nace_aliases.get(nace_r2, nace_r2)

    nace_labels = {
        'K-N': 'Financial and insurance activities; real estate activities; professional, scientific and technical activities; administrative and support service activities',
        'J': 'Information and communication',
        'B-S_X_O_S94': 'Industry, construction and market services (except public administration and defence; compulsory social security; activities of membership organisations)',
    }
    allowed_nace = set(nace_labels.keys())
    allowed_s_adj = {'SCA', 'NSA'}
    allowed_units = {
        'PCH_PRE': 'Percentage change on previous period',
        'PCH_SM': 'Percentage change compared to same period in previous year',
    }
    if nace_r2 not in allowed_nace:
        raise ValueError(f"Unsupported nace_r2 '{nace_r2}'. Allowed: {', '.join(sorted(allowed_nace))}")
    if s_adj not in allowed_s_adj:
        raise ValueError(f"Unsupported s_adj '{s_adj}'. Allowed: {', '.join(sorted(allowed_s_adj))}")
    if unit not in allowed_units:
        raise ValueError(f"Unsupported unit '{unit}'. Allowed: {', '.join(sorted(allowed_units.keys()))}")

    def fetch_indicator(indic_bt):
        params = {
            'lang': 'en',
            'freq': 'Q',
            'indic_bt': indic_bt,
            'nace_r2': nace_r2,
            's_adj': s_adj,
            'unit': unit,
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
                print(f"sts_rb_q fetch failed (attempt {attempt}/3, indic_bt={indic_bt}): {e}")
                if attempt < 3:
                    time.sleep(1.2 * attempt)

        if payload is None:
            raise RuntimeError(f"sts_rb_q fetch failed for indic_bt={indic_bt}: {last_error}")

        dimension = payload.get('dimension', {})
        geo_idx = dimension.get('geo', {}).get('category', {}).get('index', {})
        time_idx = dimension.get('time', {}).get('category', {}).get('index', {})
        values = payload.get('value', {})

        time_positions = sorted([(time_code, pos) for time_code, pos in time_idx.items()], key=lambda item: item[1])
        geo_positions = sorted([(geo_code, pos) for geo_code, pos in geo_idx.items() if geo_code in selected_countries], key=lambda item: item[1])

        num_time = len(time_positions)
        raw_by_geo = {geo: [] for geo, _ in geo_positions}

        for geo_code, geo_pos in geo_positions:
            for time_code, time_pos in time_positions:
                flat_index = geo_pos * num_time + time_pos
                value = values.get(str(flat_index))
                raw_by_geo[geo_code].append({'time': time_code, 'value': (float(value) if value is not None else None)})

        def aggregate_quarterly_to_yearly(points):
            yearly = {}
            for point in points:
                time_code = point.get('time')
                value = point.get('value')
                if time_code is None or value is None:
                    continue
                if time_code < start_time:
                    continue
                year = str(time_code).split('-')[0]
                yearly.setdefault(year, []).append(float(value))

            out = []
            for year in sorted(yearly.keys()):
                values = yearly[year]
                if not values:
                    out.append({'time': year, 'value': None})
                else:
                    out.append({'time': year, 'value': sum(values) / len(values)})
            return out

        series = []
        for geo_code, _ in geo_positions:
            series.append({
                'geo': geo_code,
                'country': selected_countries[geo_code],
                'points': aggregate_quarterly_to_yearly(raw_by_geo[geo_code])
            })

        years = sorted({str(time_code).split('-')[0] for time_code, _ in time_positions if time_code >= start_time})
        return series, years

    registration_series, times = fetch_indicator('REG')
    bankruptcy_series, _ = fetch_indicator('BKRT')

    return {
        'dataset': 'sts_rb_q',
        'nace_r2': nace_r2,
        'nace_label': nace_labels[nace_r2],
        'seasonal_adjustment': s_adj,
        'unit': unit,
        'unit_label': allowed_units[unit],
        'start_time': start_time,
        'frequency': 'A',
        'aggregation_method': 'Annual average of quarterly values',
        'times': times,
        'registration_series': registration_series,
        'bankruptcy_series': bankruptcy_series,
    }


@app.route('/api/business-registration-bankruptcy-growth-trend', methods=['GET'])
def get_business_registration_bankruptcy_growth_trend():
    """Return growth trends for registrations and bankruptcies for selected countries."""
    try:
        nace_r2 = (request.args.get('nace_r2') or 'K-N').strip()
        s_adj = (request.args.get('s_adj') or 'SCA').strip().upper()
        start_time = (request.args.get('start_time') or '2015-Q1').strip()
        unit = (request.args.get('unit') or 'PCH_PRE').strip().upper()
        payload = fetch_business_registration_bankruptcy_growth_trend(
            nace_r2=nace_r2,
            s_adj=s_adj,
            start_time=start_time,
            unit=unit,
        )
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in business-registration-bankruptcy-growth-trend endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def _linear_regression_stats(points):
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


def _fetch_productivity_bankruptcy_yearly_maps(start_time='2015-Q1', s_adj='SCA', bankruptcy_unit='PCH_PRE', indic_bt='BKRT', nace_r2='K-N'):
    """Fetch and aggregate quarterly sts_rb_q indicator and productivity series to yearly averages."""
    sts_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sts_rb_q'
    namq_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/namq_10_lp_ulc'

    geo_list = sorted(EUROZONE_MEMBER_CODES)

    allowed_s_adj = {'SCA', 'NSA'}
    allowed_bankruptcy_units = {
        'PCH_PRE': 'Percentage change on previous period',
        'PCH_SM': 'Percentage change compared to same period in previous year',
    }
    allowed_indicators = {'BKRT', 'REG'}
    nace_aliases = {
        'B-N_S95_X_K': 'B-S_X_O_S94',
    }
    nace_r2 = nace_aliases.get(nace_r2, nace_r2)

    allowed_nace = {'K-N', 'J', 'B-S_X_O_S94'}
    if s_adj not in allowed_s_adj:
        raise ValueError(f"Unsupported s_adj '{s_adj}'. Allowed: {', '.join(sorted(allowed_s_adj))}")
    if bankruptcy_unit not in allowed_bankruptcy_units:
        raise ValueError(
            f"Unsupported bankruptcy_unit '{bankruptcy_unit}'. Allowed: {', '.join(sorted(allowed_bankruptcy_units.keys()))}"
        )
    if indic_bt not in allowed_indicators:
        raise ValueError(f"Unsupported indic_bt '{indic_bt}'. Allowed: {', '.join(sorted(allowed_indicators))}")
    if nace_r2 not in allowed_nace:
        raise ValueError(f"Unsupported nace_r2 '{nace_r2}'. Allowed: {', '.join(sorted(allowed_nace))}")

    def fetch_json_with_retry(url, params, label):
        payload = None
        last_error = None
        for attempt in range(1, 4):
            try:
                response = requests.get(url, params=params, timeout=40)
                response.raise_for_status()
                payload = response.json()
                break
            except Exception as e:
                last_error = e
                print(f"{label} fetch failed (attempt {attempt}/3): {e}")
                if attempt < 3:
                    time.sleep(1.2 * attempt)

        if payload is None:
            raise RuntimeError(f"{label} fetch failed: {last_error}")
        return payload

    def extract_geo_time_values(payload):
        dimension = payload.get('dimension', {})
        geo_category = dimension.get('geo', {}).get('category', {})
        geo_idx = geo_category.get('index', {})
        geo_labels = geo_category.get('label', {})
        time_idx = dimension.get('time', {}).get('category', {}).get('index', {})
        values = payload.get('value', {})

        time_positions = sorted([(time_code, pos) for time_code, pos in time_idx.items()], key=lambda item: item[1])
        geo_positions = sorted(
            [(geo_code, pos) for geo_code, pos in geo_idx.items() if geo_code in EUROZONE_MEMBER_CODES],
            key=lambda item: item[1]
        )

        num_time = len(time_positions)
        by_geo = {geo: [] for geo, _ in geo_positions}
        for geo_code, geo_pos in geo_positions:
            for time_code, time_pos in time_positions:
                flat_index = geo_pos * num_time + time_pos
                value = values.get(str(flat_index))
                by_geo[geo_code].append({'time': time_code, 'value': (float(value) if value is not None else None)})
        labels = {
            geo_code: str(geo_labels.get(geo_code, geo_code))
            for geo_code, _ in geo_positions
        }
        return by_geo, labels

    def aggregate_quarterly_to_yearly(by_geo):
        yearly_by_geo = {}
        for geo_code, points in by_geo.items():
            yearly = {}
            for point in points:
                time_code = point.get('time')
                value = point.get('value')
                if time_code is None or value is None:
                    continue
                if time_code < start_time:
                    continue
                year = str(time_code).split('-')[0]
                yearly.setdefault(year, []).append(float(value))

            yearly_by_geo[geo_code] = {
                year: (sum(vals) / len(vals))
                for year, vals in yearly.items()
                if vals
            }
        return yearly_by_geo

    bankruptcy_payload = fetch_json_with_retry(
        sts_url,
        {
            'lang': 'en',
            'freq': 'Q',
            'indic_bt': indic_bt,
            'nace_r2': nace_r2,
            's_adj': s_adj,
            'unit': bankruptcy_unit,
            'geo': geo_list,
        },
        f"sts_rb_q {indic_bt} ({bankruptcy_unit})"
    )
    bankruptcy_values_by_geo, bankruptcy_labels = extract_geo_time_values(bankruptcy_payload)
    bankruptcy_yearly = aggregate_quarterly_to_yearly(bankruptcy_values_by_geo)

    productivity_payload = fetch_json_with_retry(
        namq_url,
        {
            'lang': 'en',
            'freq': 'Q',
            'unit': 'I20',
            's_adj': s_adj,
            'na_item': 'RLPR_HW',
            'geo': geo_list,
        },
        'namq_10_lp_ulc RLPR_HW (I20)'
    )
    productivity_values_by_geo, productivity_labels = extract_geo_time_values(productivity_payload)
    productivity_yearly = aggregate_quarterly_to_yearly(productivity_values_by_geo)

    start_year = str(start_time).split('-')[0]
    all_candidate_years = sorted({
        year
        for geo_code in geo_list
        for year in bankruptcy_yearly.get(geo_code, {}).keys()
        if year in productivity_yearly.get(geo_code, {}) and year >= start_year
    })

    eligible_geo = []
    for geo_code in geo_list:
        has_complete_coverage = all(
            (bankruptcy_yearly.get(geo_code, {}).get(year) is not None)
            and (productivity_yearly.get(geo_code, {}).get(year) is not None)
            for year in all_candidate_years
        )
        starts_in_2015 = (
            bankruptcy_yearly.get(geo_code, {}).get(start_year) is not None
            and productivity_yearly.get(geo_code, {}).get(start_year) is not None
        )
        if has_complete_coverage and starts_in_2015:
            eligible_geo.append(geo_code)

    selected_countries = {
        geo_code: str(
            bankruptcy_labels.get(geo_code)
            or productivity_labels.get(geo_code)
            or geo_code
        )
        for geo_code in eligible_geo
    }

    overlap_years = sorted({
        year
        for geo_code in eligible_geo
        for year in bankruptcy_yearly.get(geo_code, {}).keys()
        if year in productivity_yearly.get(geo_code, {}) and year >= start_year
    })

    return {
        'selected_countries': selected_countries,
        'geo_list': eligible_geo,
        'allowed_bankruptcy_units': allowed_bankruptcy_units,
        'bankruptcy_yearly': bankruptcy_yearly,
        'productivity_yearly': productivity_yearly,
        'overlap_years': overlap_years,
        'start_year': start_year,
        'all_candidate_years': all_candidate_years,
        'seasonal_adjustment': s_adj,
        'start_time': start_time,
        'bankruptcy_unit': bankruptcy_unit,
        'nace_r2': nace_r2,
    }


def fetch_productivity_bankruptcy_r2_trend(start_time='2015-Q1', s_adj='SCA', bankruptcy_unit='PCH_PRE', nace_r2='K-N'):
    """Compute yearly cross-country R² between bankruptcy growth and labour productivity."""
    data = _fetch_productivity_bankruptcy_yearly_maps(
        start_time=start_time,
        s_adj=s_adj,
        bankruptcy_unit=bankruptcy_unit,
        indic_bt='BKRT',
        nace_r2=nace_r2,
    )

    selected_countries = data['selected_countries']
    geo_list = data['geo_list']
    allowed_bankruptcy_units = data['allowed_bankruptcy_units']
    bankruptcy_yearly = data['bankruptcy_yearly']
    productivity_yearly = data['productivity_yearly']
    years = data['overlap_years']
    start_year = data['start_year']
    all_candidate_years = data['all_candidate_years']
    nace_r2_value = data['nace_r2']

    points = []
    for year in years:
        regression_points = []
        for geo_code in geo_list:
            bankruptcy_value = bankruptcy_yearly.get(geo_code, {}).get(year)
            productivity_value = productivity_yearly.get(geo_code, {}).get(year)
            if bankruptcy_value is None or productivity_value is None:
                continue
            regression_points.append((bankruptcy_value, productivity_value))

        stats = _linear_regression_stats(regression_points)
        x_values = [float(point[0]) for point in regression_points]
        y_values = [float(point[1]) for point in regression_points]
        points.append({
            'year': year,
            'r2': stats['r2'],
            'r2_pct': (stats['r2'] * 100.0) if stats['r2'] is not None else None,
            'n': stats['n'],
            'slope': stats['slope'],
            'intercept': stats['intercept'],
            'x_std': (float(np.std(x_values)) if x_values else None),
            'y_std': (float(np.std(y_values)) if y_values else None),
        })

    return {
        'x_metric': f"Bankruptcy growth ({allowed_bankruptcy_units[bankruptcy_unit]})",
        'x_dataset': 'sts_rb_q',
        'x_indicator': 'BKRT',
        'x_unit': bankruptcy_unit,
        'x_nace_r2': nace_r2_value,
        'y_metric': 'Real labour productivity per hour worked (index)',
        'y_dataset': 'namq_10_lp_ulc',
        'y_unit': 'I20',
        'y_na_item': 'RLPR_HW',
        'frequency': 'A',
        'aggregation_method': 'Annual average of quarterly values',
        'seasonal_adjustment': s_adj,
        'start_time': start_time,
        'start_year': start_year,
        'eurozone_scope': 'Countries with complete annual coverage from start_year onward for both series',
        'coverage_years': all_candidate_years,
        'eligible_country_count': len(geo_list),
        'countries': selected_countries,
        'points': points,
    }




def fetch_productivity_bankruptcy_scatter_annual(year='2024', start_time='2015-Q1', s_adj='SCA', bankruptcy_unit='PCH_PRE', nace_r2='K-N'):
    """Return cross-country scatter rows for a selected year: bankruptcy growth vs productivity level."""
    data = _fetch_productivity_bankruptcy_yearly_maps(
        start_time=start_time,
        s_adj=s_adj,
        bankruptcy_unit=bankruptcy_unit,
        indic_bt='BKRT',
        nace_r2=nace_r2,
    )

    selected_countries = data['selected_countries']
    geo_list = data['geo_list']
    allowed_bankruptcy_units = data['allowed_bankruptcy_units']
    bankruptcy_yearly = data['bankruptcy_yearly']
    productivity_yearly = data['productivity_yearly']
    start_year = data['start_year']
    all_candidate_years = data['all_candidate_years']
    nace_r2_value = data['nace_r2']

    year_str = str(year)
    rows = []
    for geo_code in geo_list:
        x_value = bankruptcy_yearly.get(geo_code, {}).get(year_str)
        y_value = productivity_yearly.get(geo_code, {}).get(year_str)
        if x_value is None or y_value is None:
            continue

        rows.append({
            'geo': geo_code,
            'country': selected_countries.get(geo_code, geo_code),
            'bankruptcy_growth_pct': float(x_value),
            'real_labour_productivity_per_hour': float(y_value),
        })

    rows.sort(key=lambda item: item['country'])
    regression_points = [(row['bankruptcy_growth_pct'], row['real_labour_productivity_per_hour']) for row in rows]
    regression = _linear_regression_stats(regression_points)

    return {
        'x_metric': f"Bankruptcy growth ({allowed_bankruptcy_units[bankruptcy_unit]})",
        'x_dataset': 'sts_rb_q',
        'x_indicator': 'BKRT',
        'x_unit': bankruptcy_unit,
        'x_nace_r2': nace_r2_value,
        'x_year': year_str,
        'y_metric': 'Real labour productivity per hour worked (index)',
        'y_dataset': 'namq_10_lp_ulc',
        'y_unit': 'I20',
        'y_na_item': 'RLPR_HW',
        'y_year': year_str,
        'frequency': 'A',
        'aggregation_method': 'Annual average of quarterly values',
        'seasonal_adjustment': s_adj,
        'start_time': start_time,
        'start_year': start_year,
        'eurozone_scope': 'Countries with complete annual coverage from start_year onward for both series',
        'coverage_years': all_candidate_years,
        'eligible_country_count': len(geo_list),
        'countries': selected_countries,
        'regression': regression,
        'rows': rows,
    }


def fetch_productivity_registration_r2_trend(start_time='2015-Q1', s_adj='SCA', registration_unit='PCH_PRE', nace_r2='K-N'):
    """Compute yearly cross-country R² between registration growth and labour productivity."""
    data = _fetch_productivity_bankruptcy_yearly_maps(
        start_time=start_time,
        s_adj=s_adj,
        bankruptcy_unit=registration_unit,
        indic_bt='REG',
        nace_r2=nace_r2,
    )

    selected_countries = data['selected_countries']
    geo_list = data['geo_list']
    allowed_units = data['allowed_bankruptcy_units']
    registration_yearly = data['bankruptcy_yearly']
    productivity_yearly = data['productivity_yearly']
    years = data['overlap_years']
    start_year = data['start_year']
    all_candidate_years = data['all_candidate_years']
    nace_r2_value = data['nace_r2']

    points = []
    for year in years:
        regression_points = []
        for geo_code in geo_list:
            registration_value = registration_yearly.get(geo_code, {}).get(year)
            productivity_value = productivity_yearly.get(geo_code, {}).get(year)
            if registration_value is None or productivity_value is None:
                continue
            regression_points.append((registration_value, productivity_value))

        stats = _linear_regression_stats(regression_points)
        x_values = [float(point[0]) for point in regression_points]
        y_values = [float(point[1]) for point in regression_points]
        points.append({
            'year': year,
            'r2': stats['r2'],
            'r2_pct': (stats['r2'] * 100.0) if stats['r2'] is not None else None,
            'n': stats['n'],
            'slope': stats['slope'],
            'intercept': stats['intercept'],
            'x_std': (float(np.std(x_values)) if x_values else None),
            'y_std': (float(np.std(y_values)) if y_values else None),
        })

    return {
        'x_metric': f"Business registration growth ({allowed_units[registration_unit]})",
        'x_dataset': 'sts_rb_q',
        'x_indicator': 'REG',
        'x_unit': registration_unit,
        'x_nace_r2': nace_r2_value,
        'y_metric': 'Real labour productivity per hour worked (index)',
        'y_dataset': 'namq_10_lp_ulc',
        'y_unit': 'I20',
        'y_na_item': 'RLPR_HW',
        'frequency': 'A',
        'aggregation_method': 'Annual average of quarterly values',
        'seasonal_adjustment': s_adj,
        'start_time': start_time,
        'start_year': start_year,
        'eurozone_scope': 'Countries with complete annual coverage from start_year onward for both series',
        'coverage_years': all_candidate_years,
        'eligible_country_count': len(geo_list),
        'countries': selected_countries,
        'points': points,
    }


def fetch_productivity_registration_scatter_annual(year='2024', start_time='2015-Q1', s_adj='SCA', registration_unit='PCH_PRE', nace_r2='K-N'):
    """Return cross-country scatter rows for a selected year: registration growth vs productivity level."""
    data = _fetch_productivity_bankruptcy_yearly_maps(
        start_time=start_time,
        s_adj=s_adj,
        bankruptcy_unit=registration_unit,
        indic_bt='REG',
        nace_r2=nace_r2,
    )

    selected_countries = data['selected_countries']
    geo_list = data['geo_list']
    allowed_units = data['allowed_bankruptcy_units']
    registration_yearly = data['bankruptcy_yearly']
    productivity_yearly = data['productivity_yearly']
    start_year = data['start_year']
    all_candidate_years = data['all_candidate_years']
    nace_r2_value = data['nace_r2']

    year_str = str(year)
    rows = []
    for geo_code in geo_list:
        x_value = registration_yearly.get(geo_code, {}).get(year_str)
        y_value = productivity_yearly.get(geo_code, {}).get(year_str)
        if x_value is None or y_value is None:
            continue

        rows.append({
            'geo': geo_code,
            'country': selected_countries.get(geo_code, geo_code),
            'registration_growth_pct': float(x_value),
            'real_labour_productivity_per_hour': float(y_value),
        })

    rows.sort(key=lambda item: item['country'])
    regression_points = [(row['registration_growth_pct'], row['real_labour_productivity_per_hour']) for row in rows]
    regression = _linear_regression_stats(regression_points)

    return {
        'x_metric': f"Business registration growth ({allowed_units[registration_unit]})",
        'x_dataset': 'sts_rb_q',
        'x_indicator': 'REG',
        'x_unit': registration_unit,
        'x_nace_r2': nace_r2_value,
        'x_year': year_str,
        'y_metric': 'Real labour productivity per hour worked (index)',
        'y_dataset': 'namq_10_lp_ulc',
        'y_unit': 'I20',
        'y_na_item': 'RLPR_HW',
        'y_year': year_str,
        'frequency': 'A',
        'aggregation_method': 'Annual average of quarterly values',
        'seasonal_adjustment': s_adj,
        'start_time': start_time,
        'start_year': start_year,
        'eurozone_scope': 'Countries with complete annual coverage from start_year onward for both series',
        'coverage_years': all_candidate_years,
        'eligible_country_count': len(geo_list),
        'countries': selected_countries,
        'regression': regression,
        'rows': rows,
    }


def _fetch_net_business_dynamics_context(start_time='2015-Q1', s_adj='SCA', unit='PCH_PRE', nace_r2='K-N'):
    """Build shared yearly context for net balance proxy: REG minus BKRT."""
    reg_data = _fetch_productivity_bankruptcy_yearly_maps(
        start_time=start_time,
        s_adj=s_adj,
        bankruptcy_unit=unit,
        indic_bt='REG',
        nace_r2=nace_r2,
    )
    bkrt_data = _fetch_productivity_bankruptcy_yearly_maps(
        start_time=start_time,
        s_adj=s_adj,
        bankruptcy_unit=unit,
        indic_bt='BKRT',
        nace_r2=nace_r2,
    )

    reg_yearly = reg_data['bankruptcy_yearly']
    bkrt_yearly = bkrt_data['bankruptcy_yearly']
    productivity_yearly = reg_data['productivity_yearly']
    start_year = reg_data['start_year']
    nace_r2_value = reg_data['nace_r2']

    candidate_geo = sorted(EUROZONE_MEMBER_CODES)
    coverage_years = sorted({
        year
        for geo_code in candidate_geo
        for year in reg_yearly.get(geo_code, {}).keys()
        if (
            year >= start_year
            and year in bkrt_yearly.get(geo_code, {})
            and year in productivity_yearly.get(geo_code, {})
        )
    })

    eligible_geo = []
    for geo_code in candidate_geo:
        has_full_coverage = all(
            reg_yearly.get(geo_code, {}).get(year) is not None
            and bkrt_yearly.get(geo_code, {}).get(year) is not None
            and productivity_yearly.get(geo_code, {}).get(year) is not None
            for year in coverage_years
        )
        if has_full_coverage and coverage_years:
            eligible_geo.append(geo_code)

    country_labels = {
        geo_code: (
            reg_data['selected_countries'].get(geo_code)
            or bkrt_data['selected_countries'].get(geo_code)
            or geo_code
        )
        for geo_code in eligible_geo
    }

    net_balance_by_geo = {}
    for geo_code in eligible_geo:
        net_balance_by_geo[geo_code] = {}
        for year in coverage_years:
            reg_value = reg_yearly.get(geo_code, {}).get(year)
            bkrt_value = bkrt_yearly.get(geo_code, {}).get(year)
            if reg_value is None or bkrt_value is None:
                continue
            net_balance_by_geo[geo_code][year] = float(reg_value) - float(bkrt_value)

    return {
        'eligible_geo': eligible_geo,
        'country_labels': country_labels,
        'coverage_years': coverage_years,
        'net_balance_by_geo': net_balance_by_geo,
        'productivity_yearly': productivity_yearly,
        'start_time': start_time,
        'start_year': start_year,
        'seasonal_adjustment': s_adj,
        'unit': unit,
        'unit_label': reg_data['allowed_bankruptcy_units'][unit],
        'nace_r2': nace_r2_value,
    }


def fetch_net_business_dynamics_balance_trend(start_time='2015-Q1', s_adj='SCA', unit='PCH_PRE', nace_r2='K-N'):
    """Return yearly net balance proxy (REG-BKRT) by country."""
    context = _fetch_net_business_dynamics_context(
        start_time=start_time,
        s_adj=s_adj,
        unit=unit,
        nace_r2=nace_r2,
    )

    series = []
    for geo_code in context['eligible_geo']:
        points = [
            {
                'time': year,
                'value': context['net_balance_by_geo'].get(geo_code, {}).get(year),
            }
            for year in context['coverage_years']
        ]
        series.append({
            'geo': geo_code,
            'country': context['country_labels'].get(geo_code, geo_code),
            'points': points,
        })

    return {
        'metric': 'Net business dynamics balance proxy (REG growth - BKRT growth)',
        'dataset': 'sts_rb_q',
        'nace_r2': context['nace_r2'],
        'unit': context['unit'],
        'unit_label': context['unit_label'],
        'frequency': 'A',
        'aggregation_method': 'Annual average of quarterly values',
        'seasonal_adjustment': context['seasonal_adjustment'],
        'start_time': context['start_time'],
        'start_year': context['start_year'],
        'coverage_years': context['coverage_years'],
        'eligible_country_count': len(context['eligible_geo']),
        'countries': context['country_labels'],
        'series': series,
    }


def fetch_productivity_net_business_dynamics_r2_trend(start_time='2015-Q1', s_adj='SCA', unit='PCH_PRE', nace_r2='K-N'):
    """Return yearly R² of productivity vs net business dynamics balance proxy."""
    context = _fetch_net_business_dynamics_context(
        start_time=start_time,
        s_adj=s_adj,
        unit=unit,
        nace_r2=nace_r2,
    )

    points = []
    for year in context['coverage_years']:
        regression_points = []
        for geo_code in context['eligible_geo']:
            x_value = context['net_balance_by_geo'].get(geo_code, {}).get(year)
            y_value = context['productivity_yearly'].get(geo_code, {}).get(year)
            if x_value is None or y_value is None:
                continue
            regression_points.append((x_value, y_value))

        stats = _linear_regression_stats(regression_points)
        x_values = [float(point[0]) for point in regression_points]
        y_values = [float(point[1]) for point in regression_points]
        points.append({
            'year': year,
            'r2': stats['r2'],
            'r2_pct': (stats['r2'] * 100.0) if stats['r2'] is not None else None,
            'n': stats['n'],
            'slope': stats['slope'],
            'intercept': stats['intercept'],
            'x_std': (float(np.std(x_values)) if x_values else None),
            'y_std': (float(np.std(y_values)) if y_values else None),
        })

    return {
        'x_metric': 'Net business dynamics balance proxy (REG growth - BKRT growth)',
        'x_dataset': 'sts_rb_q',
        'x_indicator': 'REG_MINUS_BKRT',
        'x_unit': context['unit'],
        'x_nace_r2': context['nace_r2'],
        'y_metric': 'Real labour productivity per hour worked (index)',
        'y_dataset': 'namq_10_lp_ulc',
        'y_unit': 'I20',
        'y_na_item': 'RLPR_HW',
        'frequency': 'A',
        'aggregation_method': 'Annual average of quarterly values',
        'seasonal_adjustment': context['seasonal_adjustment'],
        'start_time': context['start_time'],
        'start_year': context['start_year'],
        'eurozone_scope': 'Countries with complete annual coverage from start_year onward for REG, BKRT, and productivity',
        'coverage_years': context['coverage_years'],
        'eligible_country_count': len(context['eligible_geo']),
        'countries': context['country_labels'],
        'points': points,
    }


def fetch_productivity_net_business_dynamics_scatter_annual(year='2024', start_time='2015-Q1', s_adj='SCA', unit='PCH_PRE', nace_r2='K-N'):
    """Return annual scatter of productivity vs net business dynamics balance proxy."""
    context = _fetch_net_business_dynamics_context(
        start_time=start_time,
        s_adj=s_adj,
        unit=unit,
        nace_r2=nace_r2,
    )

    year_str = str(year)
    rows = []
    for geo_code in context['eligible_geo']:
        x_value = context['net_balance_by_geo'].get(geo_code, {}).get(year_str)
        y_value = context['productivity_yearly'].get(geo_code, {}).get(year_str)
        if x_value is None or y_value is None:
            continue

        rows.append({
            'geo': geo_code,
            'country': context['country_labels'].get(geo_code, geo_code),
            'net_business_dynamics_balance_pp': float(x_value),
            'real_labour_productivity_per_hour': float(y_value),
        })

    rows.sort(key=lambda item: item['country'])
    regression_points = [(row['net_business_dynamics_balance_pp'], row['real_labour_productivity_per_hour']) for row in rows]
    regression = _linear_regression_stats(regression_points)

    return {
        'x_metric': 'Net business dynamics balance proxy (REG growth - BKRT growth)',
        'x_dataset': 'sts_rb_q',
        'x_indicator': 'REG_MINUS_BKRT',
        'x_unit': context['unit'],
        'x_nace_r2': context['nace_r2'],
        'x_year': year_str,
        'y_metric': 'Real labour productivity per hour worked (index)',
        'y_dataset': 'namq_10_lp_ulc',
        'y_unit': 'I20',
        'y_na_item': 'RLPR_HW',
        'y_year': year_str,
        'frequency': 'A',
        'aggregation_method': 'Annual average of quarterly values',
        'seasonal_adjustment': context['seasonal_adjustment'],
        'start_time': context['start_time'],
        'start_year': context['start_year'],
        'eurozone_scope': 'Countries with complete annual coverage from start_year onward for REG, BKRT, and productivity',
        'coverage_years': context['coverage_years'],
        'eligible_country_count': len(context['eligible_geo']),
        'countries': context['country_labels'],
        'regression': regression,
        'rows': rows,
    }


@app.route('/api/productivity-bankruptcy-r2-trend', methods=['GET'])
def get_productivity_bankruptcy_r2_trend():
    """Return yearly R² trend between bankruptcy growth and productivity across selected countries."""
    try:
        start_time = (request.args.get('start_time') or '2015-Q1').strip()
        s_adj = (request.args.get('s_adj') or 'SCA').strip().upper()
        bankruptcy_unit = (request.args.get('bankruptcy_unit') or 'PCH_PRE').strip().upper()
        nace_r2 = (request.args.get('nace_r2') or 'K-N').strip()

        payload = fetch_productivity_bankruptcy_r2_trend(
            start_time=start_time,
            s_adj=s_adj,
            bankruptcy_unit=bankruptcy_unit,
            nace_r2=nace_r2,
        )
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in productivity-bankruptcy-r2-trend endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/productivity-bankruptcy-scatter-annual', methods=['GET'])
def get_productivity_bankruptcy_scatter_annual():
    """Return annual cross-country scatter of productivity vs bankruptcy growth for a selected year."""
    try:
        year = (request.args.get('year') or '2024').strip()
        start_time = (request.args.get('start_time') or '2015-Q1').strip()
        s_adj = (request.args.get('s_adj') or 'SCA').strip().upper()
        bankruptcy_unit = (request.args.get('bankruptcy_unit') or 'PCH_PRE').strip().upper()
        nace_r2 = (request.args.get('nace_r2') or 'K-N').strip()

        payload = fetch_productivity_bankruptcy_scatter_annual(
            year=year,
            start_time=start_time,
            s_adj=s_adj,
            bankruptcy_unit=bankruptcy_unit,
            nace_r2=nace_r2,
        )
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in productivity-bankruptcy-scatter-annual endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/productivity-registration-r2-trend', methods=['GET'])
def get_productivity_registration_r2_trend():
    """Return yearly R² trend between registration growth and productivity across selected countries."""
    try:
        start_time = (request.args.get('start_time') or '2015-Q1').strip()
        s_adj = (request.args.get('s_adj') or 'SCA').strip().upper()
        registration_unit = (request.args.get('registration_unit') or 'PCH_PRE').strip().upper()
        nace_r2 = (request.args.get('nace_r2') or 'K-N').strip()

        payload = fetch_productivity_registration_r2_trend(
            start_time=start_time,
            s_adj=s_adj,
            registration_unit=registration_unit,
            nace_r2=nace_r2,
        )
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in productivity-registration-r2-trend endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/productivity-registration-scatter-annual', methods=['GET'])
def get_productivity_registration_scatter_annual():
    """Return annual cross-country scatter of productivity vs registration growth for a selected year."""
    try:
        year = (request.args.get('year') or '2024').strip()
        start_time = (request.args.get('start_time') or '2015-Q1').strip()
        s_adj = (request.args.get('s_adj') or 'SCA').strip().upper()
        registration_unit = (request.args.get('registration_unit') or 'PCH_PRE').strip().upper()
        nace_r2 = (request.args.get('nace_r2') or 'K-N').strip()

        payload = fetch_productivity_registration_scatter_annual(
            year=year,
            start_time=start_time,
            s_adj=s_adj,
            registration_unit=registration_unit,
            nace_r2=nace_r2,
        )
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in productivity-registration-scatter-annual endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/net-business-dynamics-balance-trend', methods=['GET'])
def get_net_business_dynamics_balance_trend():
    """Return yearly net business dynamics balance proxy trend (REG-BKRT)."""
    try:
        start_time = (request.args.get('start_time') or '2015-Q1').strip()
        s_adj = (request.args.get('s_adj') or 'SCA').strip().upper()
        unit = (request.args.get('unit') or 'PCH_PRE').strip().upper()
        nace_r2 = (request.args.get('nace_r2') or 'K-N').strip()

        payload = fetch_net_business_dynamics_balance_trend(
            start_time=start_time,
            s_adj=s_adj,
            unit=unit,
            nace_r2=nace_r2,
        )
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in net-business-dynamics-balance-trend endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/productivity-net-business-dynamics-r2-trend', methods=['GET'])
def get_productivity_net_business_dynamics_r2_trend():
    """Return yearly R² trend between net business dynamics balance and productivity."""
    try:
        start_time = (request.args.get('start_time') or '2015-Q1').strip()
        s_adj = (request.args.get('s_adj') or 'SCA').strip().upper()
        unit = (request.args.get('unit') or 'PCH_PRE').strip().upper()
        nace_r2 = (request.args.get('nace_r2') or 'K-N').strip()

        payload = fetch_productivity_net_business_dynamics_r2_trend(
            start_time=start_time,
            s_adj=s_adj,
            unit=unit,
            nace_r2=nace_r2,
        )
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in productivity-net-business-dynamics-r2-trend endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/productivity-net-business-dynamics-scatter-annual', methods=['GET'])
def get_productivity_net_business_dynamics_scatter_annual():
    """Return annual scatter between net business dynamics balance and productivity."""
    try:
        year = (request.args.get('year') or '2024').strip()
        start_time = (request.args.get('start_time') or '2015-Q1').strip()
        s_adj = (request.args.get('s_adj') or 'SCA').strip().upper()
        unit = (request.args.get('unit') or 'PCH_PRE').strip().upper()
        nace_r2 = (request.args.get('nace_r2') or 'K-N').strip()

        payload = fetch_productivity_net_business_dynamics_scatter_annual(
            year=year,
            start_time=start_time,
            s_adj=s_adj,
            unit=unit,
            nace_r2=nace_r2,
        )
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in productivity-net-business-dynamics-scatter-annual endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def _ai_flat_index(dim_order, dim_sizes, positions):
    idx = 0
    for dim in dim_order:
        idx = idx * dim_sizes[dim] + positions[dim]
    return idx


def _fetch_isoc_eb_ai_snapshot(year='2025', size_emp='GE10', unit='PC_ENT'):
    """Fetch AI utilization snapshot by AI type and country for a given year and size class."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_eb_ai'
    params = {
        'lang': 'en',
        'freq': 'A',
        'size_emp': size_emp,
        'nace_r2': 'C10-S951_X_K',
        'unit': unit,
        'time': str(year),
    }

    payload = None
    last_error = None
    for attempt in range(1, 4):
        try:
            response = requests.get(base_url, params=params, timeout=45)
            response.raise_for_status()
            payload = response.json()
            break
        except Exception as e:
            last_error = e
            print(f"isoc_eb_ai snapshot fetch failed (attempt {attempt}/3): {e}")
            if attempt < 3:
                time.sleep(1.2 * attempt)

    if payload is None:
        raise RuntimeError(f"isoc_eb_ai snapshot fetch failed: {last_error}")

    dim_order = payload.get('id', [])
    dimension = payload.get('dimension', {})
    values = payload.get('value', {})

    def sorted_codes_for_dim(dim_name):
        category = dimension.get(dim_name, {}).get('category', {})
        idx_map = category.get('index', {})
        labels = category.get('label', {})
        codes = [code for code, _ in sorted(idx_map.items(), key=lambda item: item[1])]
        return codes, idx_map, labels

    dim_sizes = {}
    dim_indices = {}
    dim_labels = {}
    for dim_name in dim_order:
        codes, idx_map, labels = sorted_codes_for_dim(dim_name)
        dim_sizes[dim_name] = len(codes)
        dim_indices[dim_name] = idx_map
        dim_labels[dim_name] = labels

    indic_codes = [
        code for code in sorted(dim_indices.get('indic_is', {}).keys(), key=lambda c: dim_indices['indic_is'][c])
        if str(code).startswith('E_AI_T')
    ]
    geo_codes = [
        code for code in sorted(dim_indices.get('geo', {}).keys(), key=lambda c: dim_indices['geo'][c])
        if code not in {'EA'}
    ]

    fixed_positions = {}
    for dim_name in dim_order:
        if dim_name in {'indic_is', 'geo'}:
            continue
        idx_map = dim_indices.get(dim_name, {})
        if not idx_map:
            continue
        fixed_positions[dim_name] = next(iter(idx_map.values()))

    rows = []
    for geo in geo_codes:
        entry = {
            'geo': geo,
            'country': str(dim_labels.get('geo', {}).get(geo, geo)),
            'values': {},
        }

        for indic in indic_codes:
            pos = dict(fixed_positions)
            pos['geo'] = dim_indices['geo'][geo]
            pos['indic_is'] = dim_indices['indic_is'][indic]
            flat_idx = _ai_flat_index(dim_order, dim_sizes, pos)
            value = values.get(str(flat_idx))
            entry['values'][indic] = (float(value) if value is not None else None)

        rows.append(entry)

    rows.sort(key=lambda row: row['country'])

    return {
        'dataset': 'isoc_eb_ai',
        'year': str(year),
        'size_emp': size_emp,
        'nace_r2': 'C10-S951_X_K',
        'unit': unit,
        'indicators': [
            {
                'code': code,
                'label': str(dim_labels.get('indic_is', {}).get(code, code)),
            }
            for code in indic_codes
        ],
        'rows': rows,
    }


def _fetch_isoc_eb_ai_type_trend(size_emp='GE10', geo='EU27_2020', indic_is='E_AI_TANY', unit='PC_ENT'):
    """Fetch AI utilization trend for a selected country and AI type."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_eb_ai'
    params = {
        'lang': 'en',
        'freq': 'A',
        'size_emp': size_emp,
        'nace_r2': 'C10-S951_X_K',
        'unit': unit,
        'geo': geo,
        'indic_is': indic_is,
    }

    payload = None
    last_error = None
    for attempt in range(1, 4):
        try:
            response = requests.get(base_url, params=params, timeout=45)
            response.raise_for_status()
            payload = response.json()
            break
        except Exception as e:
            last_error = e
            print(f"isoc_eb_ai trend fetch failed (attempt {attempt}/3): {e}")
            if attempt < 3:
                time.sleep(1.2 * attempt)

    if payload is None:
        raise RuntimeError(f"isoc_eb_ai trend fetch failed: {last_error}")

    dim_order = payload.get('id', [])
    dimension = payload.get('dimension', {})
    values = payload.get('value', {})

    dim_sizes = {}
    dim_indices = {}
    dim_labels = {}
    for dim_name in dim_order:
        category = dimension.get(dim_name, {}).get('category', {})
        idx_map = category.get('index', {})
        labels = category.get('label', {})
        dim_sizes[dim_name] = len(idx_map)
        dim_indices[dim_name] = idx_map
        dim_labels[dim_name] = labels

    time_codes = [
        code for code in sorted(dim_indices.get('time', {}).keys(), key=lambda c: dim_indices['time'][c])
    ]

    fixed_positions = {}
    for dim_name in dim_order:
        idx_map = dim_indices.get(dim_name, {})
        if not idx_map:
            continue
        fixed_positions[dim_name] = next(iter(idx_map.values()))

    points = []
    for time_code in time_codes:
        pos = dict(fixed_positions)
        pos['time'] = dim_indices['time'][time_code]
        flat_idx = _ai_flat_index(dim_order, dim_sizes, pos)
        value = values.get(str(flat_idx))
        points.append({
            'year': str(time_code),
            'value': (float(value) if value is not None else None),
        })

    geo_label = str(dim_labels.get('geo', {}).get(geo, geo))
    indic_label = str(dim_labels.get('indic_is', {}).get(indic_is, indic_is))

    return {
        'dataset': 'isoc_eb_ai',
        'size_emp': size_emp,
        'geo': geo,
        'geo_label': geo_label,
        'indic_is': indic_is,
        'indic_label': indic_label,
        'nace_r2': 'C10-S951_X_K',
        'unit': unit,
        'points': points,
    }


@app.route('/api/ai-utilization-types', methods=['GET'])
def get_ai_utilization_types():
    """Return AI utilization by type for all countries for selected year/size."""
    try:
        year = (request.args.get('year') or '2025').strip()
        size_emp = (request.args.get('size_emp') or 'GE10').strip()
        unit = (request.args.get('unit') or 'PC_ENT').strip().upper()
        payload = _fetch_isoc_eb_ai_snapshot(year=year, size_emp=size_emp, unit=unit)
        return jsonify(payload)
    except Exception as e:
        print(f"Error in ai-utilization-types endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/ai-utilization-type-trend', methods=['GET'])
def get_ai_utilization_type_trend():
    """Return AI utilization trend for selected country and AI type."""
    try:
        size_emp = (request.args.get('size_emp') or 'GE10').strip()
        geo = (request.args.get('geo') or 'EU27_2020').strip()
        indic_is = (request.args.get('indic_is') or 'E_AI_TANY').strip()
        unit = (request.args.get('unit') or 'PC_ENT').strip().upper()
        payload = _fetch_isoc_eb_ai_type_trend(size_emp=size_emp, geo=geo, indic_is=indic_is, unit=unit)
        return jsonify(payload)
    except Exception as e:
        print(f"Error in ai-utilization-type-trend endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def _fetch_ai_vs_productivity_scatter(year='2025', size_emp='GE10', indic_is='E_AI_TANY', unit='PC_ENT', s_adj='SCA'):
    """Return cross-country scatter rows for AI utilization % vs productivity level."""
    ai_payload = _fetch_isoc_eb_ai_snapshot(year=year, size_emp=size_emp, unit=unit)
    rows = ai_payload.get('rows', [])

    ai_by_geo = {}
    for row in rows:
        geo_code = row.get('geo')
        if not geo_code:
            continue
        value = (row.get('values') or {}).get(indic_is)
        if value is None:
            continue
        ai_by_geo[geo_code] = {
            'country': row.get('country', geo_code),
            'ai_value': float(value),
        }

    geo_codes = sorted(ai_by_geo.keys())
    if not geo_codes:
        return {
            'dataset_x': 'isoc_eb_ai',
            'dataset_y': 'namq_10_lp_ulc',
            'year': str(year),
            'size_emp': size_emp,
            'indic_is': indic_is,
            'unit': unit,
            's_adj': s_adj,
            'rows': [],
            'regression': _linear_regression_stats([]),
        }

    namq_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/namq_10_lp_ulc'
    quarters = ['Q1', 'Q2', 'Q3', 'Q4']
    productivity_quarterly = {geo: [] for geo in geo_codes}

    for quarter in quarters:
        params = {
            'lang': 'en',
            'freq': 'Q',
            'unit': 'I20',
            's_adj': s_adj,
            'na_item': 'RLPR_HW',
            'time': f"{year}-{quarter}",
            'geo': geo_codes,
        }

        payload = None
        last_error = None
        for attempt in range(1, 4):
            try:
                response = requests.get(namq_url, params=params, timeout=45)
                response.raise_for_status()
                payload = response.json()
                break
            except Exception as e:
                last_error = e
                print(f"namq AI scatter fetch failed (attempt {attempt}/3, quarter={quarter}): {e}")
                if attempt < 3:
                    time.sleep(1.2 * attempt)

        if payload is None:
            raise RuntimeError(f"namq AI scatter fetch failed for quarter={quarter}: {last_error}")

        geo_category = payload.get('dimension', {}).get('geo', {}).get('category', {})
        geo_index = geo_category.get('index', {})
        values = payload.get('value', {})

        for geo in geo_codes:
            pos = geo_index.get(geo)
            if pos is None:
                continue
            value = values.get(str(pos))
            if value is None:
                continue
            productivity_quarterly[geo].append(float(value))

    rows_out = []
    for geo in geo_codes:
        prod_values = productivity_quarterly.get(geo, [])
        if not prod_values:
            continue
        prod_annual = sum(prod_values) / len(prod_values)
        rows_out.append({
            'geo': geo,
            'country': ai_by_geo[geo]['country'],
            'ai_utilization_pct': ai_by_geo[geo]['ai_value'],
            'real_labour_productivity_per_hour': prod_annual,
        })

    rows_out.sort(key=lambda item: item['country'])
    points = [(row['ai_utilization_pct'], row['real_labour_productivity_per_hour']) for row in rows_out]
    regression = _linear_regression_stats(points)

    indicator_label = indic_is
    for indicator in (ai_payload.get('indicators') or []):
        if indicator.get('code') == indic_is:
            indicator_label = indicator.get('label') or indic_is
            break

    return {
        'dataset_x': 'isoc_eb_ai',
        'dataset_y': 'namq_10_lp_ulc',
        'year': str(year),
        'size_emp': size_emp,
        'indic_is': indic_is,
        'indic_label': indicator_label,
        'unit': unit,
        's_adj': s_adj,
        'productivity_aggregation': 'Annual average of quarterly values',
        'rows': rows_out,
        'regression': regression,
    }


@app.route('/api/ai-utilization-vs-productivity-scatter', methods=['GET'])
def get_ai_utilization_vs_productivity_scatter():
    """Return cross-country scatter data: AI utilization percentage vs productivity level."""
    try:
        year = (request.args.get('year') or '2025').strip()
        size_emp = (request.args.get('size_emp') or 'GE10').strip()
        indic_is = (request.args.get('indic_is') or 'E_AI_TANY').strip()
        unit = (request.args.get('unit') or 'PC_ENT').strip().upper()
        s_adj = (request.args.get('s_adj') or 'SCA').strip().upper()
        payload = _fetch_ai_vs_productivity_scatter(
            year=year,
            size_emp=size_emp,
            indic_is=indic_is,
            unit=unit,
            s_adj=s_adj,
        )
        return jsonify(payload)
    except Exception as e:
        print(f"Error in ai-utilization-vs-productivity-scatter endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def _fetch_ai_utilization_growth_selected_countries(start_year='2021', end_year='2025', size_emp='GE10', unit='PC_ENT'):
    """Return growth by AI type between two years for selected countries."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_eb_ai'
    selected_countries = {
        'EU27_2020': 'Eurozone',
        'DE': 'Germany',
        'IT': 'Italy',
        'BE': 'Belgium',
        'FR': 'France',
        'ES': 'Spain',
    }

    params = {
        'lang': 'en',
        'freq': 'A',
        'size_emp': size_emp,
        'nace_r2': 'C10-S951_X_K',
        'unit': unit,
        'geo': list(selected_countries.keys()),
    }

    payload = None
    last_error = None
    for attempt in range(1, 4):
        try:
            response = requests.get(base_url, params=params, timeout=45)
            response.raise_for_status()
            payload = response.json()
            break
        except Exception as e:
            last_error = e
            print(f"isoc_eb_ai growth fetch failed (attempt {attempt}/3): {e}")
            if attempt < 3:
                time.sleep(1.2 * attempt)

    if payload is None:
        raise RuntimeError(f"isoc_eb_ai growth fetch failed: {last_error}")

    dim_order = payload.get('id', [])
    dimension = payload.get('dimension', {})
    values = payload.get('value', {})

    dim_sizes = {}
    dim_indices = {}
    dim_labels = {}
    for dim_name in dim_order:
        category = dimension.get(dim_name, {}).get('category', {})
        idx_map = category.get('index', {})
        labels = category.get('label', {})
        dim_sizes[dim_name] = len(idx_map)
        dim_indices[dim_name] = idx_map
        dim_labels[dim_name] = labels

    indic_codes = [
        code for code in sorted(dim_indices.get('indic_is', {}).keys(), key=lambda c: dim_indices['indic_is'][c])
        if str(code).startswith('E_AI_T')
    ]
    available_years = sorted(dim_indices.get('time', {}).keys(), key=lambda c: dim_indices['time'][c])
    if not available_years:
        return {
            'dataset': 'isoc_eb_ai',
            'size_emp': size_emp,
            'nace_r2': 'C10-S951_X_K',
            'unit': unit,
            'start_year': start_year,
            'end_year': end_year,
            'rows': [],
            'indicators': [],
        }

    chosen_start = str(start_year) if str(start_year) in dim_indices.get('time', {}) else available_years[0]
    chosen_end = str(end_year) if str(end_year) in dim_indices.get('time', {}) else available_years[-1]

    fixed_positions = {}
    for dim_name in dim_order:
        if dim_name in {'geo', 'indic_is', 'time'}:
            continue
        idx_map = dim_indices.get(dim_name, {})
        if idx_map:
            fixed_positions[dim_name] = next(iter(idx_map.values()))

    rows = []
    for geo_code, country in selected_countries.items():
        if geo_code not in dim_indices.get('geo', {}):
            continue

        growth_by_indicator = {}
        for indic in indic_codes:
            if indic not in dim_indices.get('indic_is', {}):
                growth_by_indicator[indic] = None
                continue

            pos_start = dict(fixed_positions)
            pos_start['geo'] = dim_indices['geo'][geo_code]
            pos_start['indic_is'] = dim_indices['indic_is'][indic]
            pos_start['time'] = dim_indices['time'][chosen_start]
            flat_start = _ai_flat_index(dim_order, dim_sizes, pos_start)
            start_value = values.get(str(flat_start))

            pos_end = dict(fixed_positions)
            pos_end['geo'] = dim_indices['geo'][geo_code]
            pos_end['indic_is'] = dim_indices['indic_is'][indic]
            pos_end['time'] = dim_indices['time'][chosen_end]
            flat_end = _ai_flat_index(dim_order, dim_sizes, pos_end)
            end_value = values.get(str(flat_end))

            if start_value is None or end_value is None:
                growth_by_indicator[indic] = None
                continue

            start_float = float(start_value)
            end_float = float(end_value)
            if start_float == 0:
                growth_by_indicator[indic] = None
                continue

            growth_by_indicator[indic] = ((end_float - start_float) / abs(start_float)) * 100.0

        rows.append({
            'geo': geo_code,
            'country': country,
            'growth_by_indicator': growth_by_indicator,
        })

    return {
        'dataset': 'isoc_eb_ai',
        'size_emp': size_emp,
        'nace_r2': 'C10-S951_X_K',
        'unit': unit,
        'start_year': chosen_start,
        'end_year': chosen_end,
        'indicators': [
            {
                'code': code,
                'label': str(dim_labels.get('indic_is', {}).get(code, code)),
            }
            for code in indic_codes
        ],
        'rows': rows,
    }


def _fetch_ai_utilization_growth_by_year_selected_countries(size_emp='GE10', indic_is='E_AI_TANY', unit='PC_ENT'):
    """Return annual growth (% change vs previous available year) for selected countries and one AI type."""
    base_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_eb_ai'
    selected_countries = {
        'EU27_2020': 'Eurozone',
        'DE': 'Germany',
        'IT': 'Italy',
        'BE': 'Belgium',
        'FR': 'France',
        'ES': 'Spain',
    }

    params = {
        'lang': 'en',
        'freq': 'A',
        'size_emp': size_emp,
        'nace_r2': 'C10-S951_X_K',
        'unit': unit,
        'indic_is': indic_is,
        'geo': list(selected_countries.keys()),
    }

    payload = None
    last_error = None
    for attempt in range(1, 4):
        try:
            response = requests.get(base_url, params=params, timeout=45)
            response.raise_for_status()
            payload = response.json()
            break
        except Exception as e:
            last_error = e
            print(f"isoc_eb_ai growth-by-year fetch failed (attempt {attempt}/3): {e}")
            if attempt < 3:
                time.sleep(1.2 * attempt)

    if payload is None:
        raise RuntimeError(f"isoc_eb_ai growth-by-year fetch failed: {last_error}")

    dim_order = payload.get('id', [])
    dimension = payload.get('dimension', {})
    values = payload.get('value', {})

    dim_sizes = {}
    dim_indices = {}
    dim_labels = {}
    for dim_name in dim_order:
        category = dimension.get(dim_name, {}).get('category', {})
        idx_map = category.get('index', {})
        labels = category.get('label', {})
        dim_sizes[dim_name] = len(idx_map)
        dim_indices[dim_name] = idx_map
        dim_labels[dim_name] = labels

    time_codes = sorted(dim_indices.get('time', {}).keys(), key=lambda c: dim_indices['time'][c])

    fixed_positions = {}
    for dim_name in dim_order:
        if dim_name in {'geo', 'time'}:
            continue
        idx_map = dim_indices.get(dim_name, {})
        if idx_map:
            fixed_positions[dim_name] = next(iter(idx_map.values()))

    raw_series = {}
    for geo_code, country in selected_countries.items():
        if geo_code not in dim_indices.get('geo', {}):
            continue
        points = []
        for year in time_codes:
            pos = dict(fixed_positions)
            pos['geo'] = dim_indices['geo'][geo_code]
            pos['time'] = dim_indices['time'][year]
            flat_idx = _ai_flat_index(dim_order, dim_sizes, pos)
            value = values.get(str(flat_idx))
            points.append({'year': str(year), 'value': (float(value) if value is not None else None)})
        raw_series[geo_code] = {
            'geo': geo_code,
            'country': country,
            'points': points,
        }

    growth_years = [str(y) for y in time_codes[1:]]
    growth_series = []
    for geo_code in selected_countries.keys():
        series = raw_series.get(geo_code)
        if not series:
            continue

        points = series['points']
        growth_points = []
        for i in range(1, len(points)):
            prev_point = points[i - 1]
            curr_point = points[i]
            prev_val = prev_point.get('value')
            curr_val = curr_point.get('value')

            growth_value = None
            if prev_val is not None and curr_val is not None and prev_val != 0:
                growth_value = ((curr_val - prev_val) / abs(prev_val)) * 100.0

            growth_points.append({
                'year': curr_point.get('year'),
                'from_year': prev_point.get('year'),
                'value': growth_value,
            })

        growth_series.append({
            'geo': geo_code,
            'country': series['country'],
            'points': growth_points,
        })

    indic_label = str(dim_labels.get('indic_is', {}).get(indic_is, indic_is))

    return {
        'dataset': 'isoc_eb_ai',
        'size_emp': size_emp,
        'nace_r2': 'C10-S951_X_K',
        'unit': unit,
        'indic_is': indic_is,
        'indic_label': indic_label,
        'years': growth_years,
        'series': growth_series,
    }


@app.route('/api/ai-utilization-growth-selected-countries', methods=['GET'])
def get_ai_utilization_growth_selected_countries():
    """Return AI utilization growth by type for selected countries."""
    try:
        start_year = (request.args.get('start_year') or '2021').strip()
        end_year = (request.args.get('end_year') or '2025').strip()
        size_emp = (request.args.get('size_emp') or 'GE10').strip()
        unit = (request.args.get('unit') or 'PC_ENT').strip().upper()
        payload = _fetch_ai_utilization_growth_selected_countries(
            start_year=start_year,
            end_year=end_year,
            size_emp=size_emp,
            unit=unit,
        )
        return jsonify(payload)
    except Exception as e:
        print(f"Error in ai-utilization-growth-selected-countries endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/ai-utilization-growth-by-year-selected-countries', methods=['GET'])
def get_ai_utilization_growth_by_year_selected_countries():
    """Return annual growth by country for a selected AI type."""
    try:
        size_emp = (request.args.get('size_emp') or 'GE10').strip()
        indic_is = (request.args.get('indic_is') or 'E_AI_TANY').strip()
        unit = (request.args.get('unit') or 'PC_ENT').strip().upper()
        payload = _fetch_ai_utilization_growth_by_year_selected_countries(
            size_emp=size_emp,
            indic_is=indic_is,
            unit=unit,
        )
        return jsonify(payload)
    except Exception as e:
        print(f"Error in ai-utilization-growth-by-year-selected-countries endpoint: {e}")
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

    included_country_codes = EUROZONE_PLUS_POLAND_CODES

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
            if geo_code not in included_country_codes:
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

    included_country_codes = EUROZONE_PLUS_POLAND_CODES

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
            if geo_code not in included_country_codes:
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
    total_10_49 = 0.0
    total_50_249 = 0.0
    total_250_plus = 0.0
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

        if row['geo'] in EUROZONE_MEMBER_CODES:
            total_10_49 += count_10_49
            total_50_249 += count_50_249
            total_250_plus += count_250_plus

    aggregate_total = total_10_49 + total_50_249 + total_250_plus
    if aggregate_total > 0:
        rows.append({
            'geo': EUROZONE_AGG_GEO,
            'country': EUROZONE_AGG_LABEL,
            'count_10_49': total_10_49,
            'count_50_249': total_50_249,
            'count_250_plus': total_250_plus,
            'share_10_49': (total_10_49 / aggregate_total) * 100,
            'share_50_249': (total_50_249 / aggregate_total) * 100,
            'share_250_plus': (total_250_plus / aggregate_total) * 100,
            'total_count': aggregate_total,
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
        'EU27_2020': 'Eurozone',
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
        series_10_249 = []
        series_ge10 = []

        for year in year_values:
            c10 = per_year[year].get('10_19')
            c20 = per_year[year].get('20_49')
            c50 = per_year[year].get('50_249')
            c250 = per_year[year].get('250_plus')

            count_10_49 = (c10 if c10 is not None else 0.0) + (c20 if c20 is not None else 0.0)
            count_10_249 = count_10_49 + (c50 if c50 is not None else 0.0)
            count_ge10 = count_10_249 + (c250 if c250 is not None else 0.0)
            series_10_49.append({'year': year, 'count': (count_10_49 if (c10 is not None or c20 is not None) else None)})
            series_50_249.append({'year': year, 'count': c50})
            series_250_plus.append({'year': year, 'count': c250})
            series_10_249.append({'year': year, 'count': (count_10_249 if (c10 is not None or c20 is not None or c50 is not None) else None)})
            series_ge10.append({'year': year, 'count': (count_ge10 if (c10 is not None or c20 is not None or c50 is not None or c250 is not None) else None)})

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
        growth_10_249, from_10_249, to_10_249 = growth_pct(series_10_249)
        growth_ge10, from_ge10, to_ge10 = growth_pct(series_ge10)

        rows.append({
            'geo': geo_code,
            'country': country_name,
            'growth_10_49': growth_10_49,
            'growth_50_249': growth_50_249,
            'growth_250_plus': growth_250_plus,
            'growth_10_249': growth_10_249,
            'growth_ge10': growth_ge10,
            'period_10_49': {'from_year': from_10_49, 'to_year': to_10_49},
            'period_50_249': {'from_year': from_50_249, 'to_year': to_50_249},
            'period_250_plus': {'from_year': from_250_plus, 'to_year': to_250_plus},
            'period_10_249': {'from_year': from_10_249, 'to_year': to_10_249},
            'period_ge10': {'from_year': from_ge10, 'to_year': to_ge10},
        })

    return {
        'dataset': 'SBS_SC_OVW',
        'indicator': 'Enterprises - number (growth by size class)',
        'nace_scope': 'B-S_X_O_S94',
        'start_year': int(start_year),
        'end_year': int(end_year),
        'rows': rows,
    }


def fetch_company_growth_vs_digital_intensity_scatter_eurozone(start_year='2021', end_year='2023', size_emp='10-249', indic_is='E_DI3_VHI'):
    """Return all-eurozone scatter rows: % change in company counts vs % change in digital intensity."""
    start_year_i = int(start_year)
    end_year_i = int(end_year)
    if end_year_i <= start_year_i:
        raise ValueError("end_year must be greater than start_year")

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

    geo_list = sorted(EUROZONE_MEMBER_CODES)
    country_labels = {geo: geo for geo in geo_list}

    dii_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_e_dii'
    sbs_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw'

    size_components = {
        '10-49': ['10-19', '20-49'],
        '50-249': ['50-249'],
        '10-249': ['10-19', '20-49', '50-249'],
        'GE10': ['10-19', '20-49', '50-249', 'GE250'],
        'GE250': ['GE250'],
    }[size_emp]

    def _fetch_with_retries(url, params, label):
        payload = None
        last_error = None
        for attempt in range(1, 4):
            try:
                response = requests.get(url, params=params, timeout=45)
                response.raise_for_status()
                payload = response.json()
                break
            except Exception as e:
                last_error = e
                print(f"{label} fetch failed (attempt {attempt}/3): {e}")
                if attempt < 3:
                    time.sleep(1.2 * attempt)

        if payload is None:
            raise RuntimeError(f"{label} fetch failed: {last_error}")
        return payload

    def _read_simple_geo_values(payload):
        dimension = payload.get('dimension', {})
        geo_category = dimension.get('geo', {}).get('category', {})
        geo_index = geo_category.get('index', {})
        geo_labels = geo_category.get('label', {})
        values = payload.get('value', {})

        out = {}
        for geo_code in geo_list:
            pos = geo_index.get(geo_code)
            if pos is None:
                continue
            value = values.get(str(pos))
            out[geo_code] = (float(value) if value is not None else None)
            if geo_code in geo_labels:
                country_labels[geo_code] = str(geo_labels[geo_code])
        return out

    dii_start_payload = _fetch_with_retries(
        dii_url,
        {
            'lang': 'en',
            'freq': 'A',
            'size_emp': size_emp,
            'nace_r2': 'C10-S951_X_K',
            'unit': 'PC_ENT',
            'time': str(start_year_i),
            'indic_is': indic_is,
            'geo': geo_list,
        },
        f"isoc_e_dii ({start_year_i}, {size_emp}, {indic_is})"
    )
    dii_end_payload = _fetch_with_retries(
        dii_url,
        {
            'lang': 'en',
            'freq': 'A',
            'size_emp': size_emp,
            'nace_r2': 'C10-S951_X_K',
            'unit': 'PC_ENT',
            'time': str(end_year_i),
            'indic_is': indic_is,
            'geo': geo_list,
        },
        f"isoc_e_dii ({end_year_i}, {size_emp}, {indic_is})"
    )

    dii_start = _read_simple_geo_values(dii_start_payload)
    dii_end = _read_simple_geo_values(dii_end_payload)

    def _fetch_company_counts_for_year(year_value):
        totals = {geo: {'count': 0.0, 'has_value': False} for geo in geo_list}

        for component_size in size_components:
            payload = _fetch_with_retries(
                sbs_url,
                {
                    'lang': 'en',
                    'freq': 'A',
                    'indic_sbs': 'ENT_NR',
                    'nace_r2': 'B-S_X_O_S94',
                    'size_emp': component_size,
                    'time': str(year_value),
                    'geo': geo_list,
                },
                f"sbs_sc_ovw ({year_value}, {component_size})"
            )

            dimension = payload.get('dimension', {})
            geo_category = dimension.get('geo', {}).get('category', {})
            geo_index = geo_category.get('index', {})
            geo_labels = geo_category.get('label', {})
            values = payload.get('value', {})

            for geo_code in geo_list:
                pos = geo_index.get(geo_code)
                if pos is None:
                    continue
                value = values.get(str(pos))
                if value is None:
                    continue
                totals[geo_code]['count'] += float(value)
                totals[geo_code]['has_value'] = True
                if geo_code in geo_labels:
                    country_labels[geo_code] = str(geo_labels[geo_code])

        return {
            geo_code: (entry['count'] if entry['has_value'] else None)
            for geo_code, entry in totals.items()
        }

    company_start = _fetch_company_counts_for_year(start_year_i)
    company_end = _fetch_company_counts_for_year(end_year_i)

    rows = []
    for geo_code in geo_list:
        c_start = company_start.get(geo_code)
        c_end = company_end.get(geo_code)
        d_start = dii_start.get(geo_code)
        d_end = dii_end.get(geo_code)

        if c_start is None or c_end is None or d_start is None or d_end is None:
            continue
        if c_start == 0 or d_start == 0:
            continue

        company_growth_pct = ((float(c_end) - float(c_start)) / abs(float(c_start))) * 100.0
        digital_intensity_change_pct = ((float(d_end) - float(d_start)) / abs(float(d_start))) * 100.0

        rows.append({
            'geo': geo_code,
            'country': country_labels.get(geo_code, geo_code),
            'company_growth_pct': company_growth_pct,
            'digital_intensity_change_pct': digital_intensity_change_pct,
            'company_count_start': float(c_start),
            'company_count_end': float(c_end),
            'digital_intensity_start_pct': float(d_start),
            'digital_intensity_end_pct': float(d_end),
        })

    rows.sort(key=lambda item: item['country'])
    regression_points = [(row['company_growth_pct'], row['digital_intensity_change_pct']) for row in rows]
    regression = _linear_regression_stats(regression_points)

    return {
        'x_metric': 'Growth in number of companies (%)',
        'x_dataset': 'sbs_sc_ovw',
        'x_nace_r2': 'B-S_X_O_S94',
        'x_size_emp': size_emp,
        'x_size_label': allowed_sizes[size_emp],
        'y_metric': f"{allowed_indicators[indic_is]} change (%)",
        'y_dataset': 'isoc_e_dii',
        'y_indicator': indic_is,
        'y_indicator_label': allowed_indicators[indic_is],
        'y_nace_r2': 'C10-S951_X_K',
        'start_year': start_year_i,
        'end_year': end_year_i,
        'country_scope': 'Eurozone member countries',
        'eligible_country_count': len(rows),
        'regression': regression,
        'rows': rows,
    }


def fetch_share_250_plus_vs_productivity_2024(start_year='2021', end_year='2024', quarter='Q4'):
    """Return scatter-ready rows of % change in company counts vs % change in productivity."""
    sbs_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_sc_ovw'
    namq_url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/namq_10_lp_ulc'

    component_sizes = ['10-19', '20-49', '50-249', 'GE250']
    included_country_codes = EUROZONE_PLUS_POLAND_CODES
    geo_list = sorted(included_country_codes)

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
        if geo_code not in included_country_codes:
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
            country_name = 'Eurozone'

        rows.append({
            'geo': geo_code,
            'country': country_name,
            'company_change_10_49_pct': change_10_49,
            'company_change_50_249_pct': change_50_249,
            'company_change_250_plus_pct': change_250_plus,
            'productivity_change_pct': productivity_change,
        })

    rows.sort(key=lambda item: item['country'])
    regression_rows = [dict(row) for row in rows]

    append_unweighted_aggregate_row(rows, [
        'company_change_10_49_pct',
        'company_change_50_249_pct',
        'company_change_250_plus_pct',
        'productivity_change_pct',
    ])

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

    points_10_49 = [(row['company_change_10_49_pct'], row['productivity_change_pct']) for row in regression_rows]
    points_50_249 = [(row['company_change_50_249_pct'], row['productivity_change_pct']) for row in regression_rows]
    points_250_plus = [(row['company_change_250_plus_pct'], row['productivity_change_pct']) for row in regression_rows]

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
    included_country_codes = EUROZONE_PLUS_POLAND_CODES
    geo_list = sorted(included_country_codes)

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
        if geo_code not in included_country_codes:
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
            country_name = 'Eurozone'

        rows.append({
            'geo': geo_code,
            'country': country_name,
            'share_10_49': (count_10_49 / total) * 100.0,
            'share_50_249': (count_50_249 / total) * 100.0,
            'share_250_plus': (count_250_plus / total) * 100.0,
            'real_labour_productivity_per_hour': productivity,
        })

    rows.sort(key=lambda item: item['country'])
    regression_rows = [dict(row) for row in rows]

    append_unweighted_aggregate_row(rows, [
        'share_10_49',
        'share_50_249',
        'share_250_plus',
        'real_labour_productivity_per_hour',
    ])

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

    points_10_49 = [(row['share_10_49'], row['real_labour_productivity_per_hour']) for row in regression_rows]
    points_50_249 = [(row['share_50_249'], row['real_labour_productivity_per_hour']) for row in regression_rows]
    points_250_plus = [(row['share_250_plus'], row['real_labour_productivity_per_hour']) for row in regression_rows]

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


@app.route('/api/company-growth-vs-digital-intensity-scatter-eurozone', methods=['GET'])
def get_company_growth_vs_digital_intensity_scatter_eurozone():
    """Return all-eurozone scatter payload for company growth vs digital intensity change."""
    try:
        start_year = (request.args.get('start_year') or '2021').strip()
        end_year = (request.args.get('end_year') or '2023').strip()
        size_emp = (request.args.get('size_emp') or '10-249').strip()
        indic_is = (request.args.get('indic_is') or 'E_DI3_VHI').strip()
        payload = fetch_company_growth_vs_digital_intensity_scatter_eurozone(
            start_year=start_year,
            end_year=end_year,
            size_emp=size_emp,
            indic_is=indic_is,
        )
        return jsonify(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in company-growth-vs-digital-intensity-scatter-eurozone endpoint: {e}")
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

    included_country_codes = EUROZONE_PLUS_POLAND_CODES
    geo_list = sorted(included_country_codes)

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
            country_name = 'Eurozone'

        rows.append({
            'geo': geo_code,
            'country': country_name,
            'dii_very_high_share': dii_share,
            'real_labour_productivity_per_hour': productivity,
        })

    rows.sort(key=lambda item: item['country'])
    regression_rows = [dict(row) for row in rows]

    append_unweighted_aggregate_row(rows, [
        'dii_very_high_share',
        'real_labour_productivity_per_hour',
    ])

    n = len(regression_rows)
    regression = {'slope': None, 'intercept': None, 'r2': None, 'n': n}
    if n >= 2:
        x_vals = [float(item['dii_very_high_share']) for item in regression_rows]
        y_vals = [float(item['real_labour_productivity_per_hour']) for item in regression_rows]
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
