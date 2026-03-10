# US Treasury Debt Analysis Website

Real-time analysis of US Treasury debt issuance, economic indicators, and foreign holdings.

## Quick Start

### Option 1: Simple Double-Click (Recommended)
```bash
./start_server.sh
```
Then open `index.html` in your browser.

### Option 2: Manual Start
```bash
python3 -m pip install -r requirements.txt
python3 api_server.py
```
Then open `index.html` in your browser.

## Why Do I Need the Server?

**The website has 3 charts:**

1. **✅ Treasury Debt Chart** - Works WITHOUT server (fetches directly from Treasury API)
2. **⚠️ Economic Indicators** - NEEDS server (FRED & Yahoo Finance block browser requests)
3. **⚠️ Foreign Holders** - NEEDS server (Treasury TIC data blocks browser requests)

**CORS Issue**: Modern browsers block direct API calls to external services for security. The Flask server acts as a proxy to fetch this data.

## No Mock Data

All charts now use **real data only**. If the server isn't running, charts 2 and 3 will show clear error messages with instructions.

## Features

- **Real-time Treasury debt tracking** from 2006-2026
- **Economic indicators**: Core CPI, Headline CPI, Oil prices
- **Major foreign holders** of US Treasury securities (Top 5 countries)
- **Poste Italiane themed** design (Blue/Yellow color scheme)

## Technical Stack

- **Frontend**: Pure HTML/CSS/JavaScript with Chart.js
- **Backend**: Python Flask (for CORS proxy)
- **Data Sources**: 
  - US Treasury Fiscal Data API
  - FRED (Federal Reserve Economic Data)
  - Yahoo Finance
  - Treasury TIC Database

## Getting a FRED API Key (Optional but Recommended)

The demo key has rate limits. Get a free key:

1. Go to https://fred.stlouisfed.org/docs/api/api_key.html
2. Sign up (free)
3. Copy your API key
4. Open `api_server.py` and replace `fred_api_key = "demo"` with your key

## Files

- `index.html` - Main webpage
- `script.js` - All chart logic and data fetching
- `styles.css` - Poste Italiane themed styling
- `api_server.py` - Flask proxy server for CORS
- `start_server.sh` - Quick start script

## Server Status

The website shows a status indicator at the top:
- **Green** ✅ = Server running, all charts will load
- **Red** ⚠️ = Server offline, only Treasury chart will work
