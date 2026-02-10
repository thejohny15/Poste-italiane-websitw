"""
US Treasuries: Issued vs Expired (Matured) — using the US Treasury Fiscal Data API

What this script does:
1) Issuance: pulls Treasury auction data from debt_to_the_penny (inferred from changes).
2) Expiries: Approximated using the same dataset by tracking decreases in outstanding debt.
3) Aggregates to daily or monthly frequency.
4) Plots:
   - Bars: Issued vs Expired
   - Line: Net issuance (Issued - Expired)

Note: The Treasury Fiscal Data API does not have direct auction endpoints.
We use the Debt to the Penny dataset as a proxy for net issuance.

Requirements:
  pip install pandas requests matplotlib python-dateutil
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import requests
import pandas as pd
import matplotlib.pyplot as plt


BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service"

# Using Debt to the Penny API which exists and has debt data
DEBT_TO_PENNY_ENDPOINT = f"{BASE}/v2/accounting/od/debt_to_penny"


# -----------------------------
# Helpers: API paging + parsing
# -----------------------------
def fetch_fiscaldata_all(
    endpoint: str,
    params: Dict[str, str],
    session: Optional[requests.Session] = None,
    max_pages: int = 10_000,
) -> pd.DataFrame:
    """
    Fetch all pages from a Treasury Fiscal Data API endpoint.
    The API returns JSON with `data` and `meta` (including pagination info).
    """
    s = session or requests.Session()
    all_rows: List[dict] = []
    page = 1

    while page <= max_pages:
        p = dict(params)
        p["page[number]"] = str(page)

        r = s.get(endpoint, params=p, timeout=60)
        r.raise_for_status()
        payload = r.json()

        data = payload.get("data", [])
        all_rows.extend(data)

        meta = payload.get("meta", {})
        # v2 API uses hyphenated keys
        total_pages = meta.get("total-pages")

        if total_pages is None:
            # Fallback: stop if we got no data
            if not data:
                break
            page += 1
            continue

        if page >= int(total_pages):
            break

        page += 1

    return pd.DataFrame(all_rows)


def to_numeric_series(s: pd.Series) -> pd.Series:
    """Convert string amounts like '1,234' or '1234.56' to float, safely."""
    return pd.to_numeric(s.astype(str).str.replace(",", ""), errors="coerce")


# -----------------------------
# Core: Debt data to calculate issuance
# -----------------------------
def get_debt_data(
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """
    Fetch total debt from Debt to the Penny API.
    We'll use changes in total debt to infer net issuance.
    """
    filt = f"record_date:gte:{start_date},record_date:lte:{end_date}"

    params = {
        "filter": filt,
        "fields": "record_date,tot_pub_debt_out_amt",
        "page[size]": "10000",
        "sort": "record_date",
    }

    df = fetch_fiscaldata_all(DEBT_TO_PENNY_ENDPOINT, params)
    if df.empty:
        return df

    df["record_date"] = pd.to_datetime(df["record_date"])
    df["tot_pub_debt_out_amt"] = to_numeric_series(df["tot_pub_debt_out_amt"])
    
    df = df.sort_values("record_date")
    df = df.rename(columns={"record_date": "date", "tot_pub_debt_out_amt": "debt"})
    
    return df


def calculate_issuance_expiry_from_debt(df: pd.DataFrame) -> pd.DataFrame:
    """
    Calculate net issuance from day-to-day changes in total public debt.
    Positive changes = net issuance, negative changes = net repayment/expiry
    """
    if df.empty:
        return pd.DataFrame(columns=["date", "issued_usd", "expired_usd", "net_usd"])
    
    df = df.set_index("date")
    
    # Calculate daily change in debt
    df["debt_change"] = df["debt"].diff()
    
    # Positive changes are net issuance (issued > expired)
    # Negative changes are net expiry/repayment (expired > issued)
    df["issued_usd"] = df["debt_change"].apply(lambda x: max(0, x) if pd.notna(x) else 0)
    df["expired_usd"] = df["debt_change"].apply(lambda x: max(0, -x) if pd.notna(x) else 0)
    df["net_usd"] = df["debt_change"].fillna(0)
    
    # Drop the first row (no prior data for diff)
    df = df.iloc[1:]
    
    return df[["issued_usd", "expired_usd", "net_usd"]]


# -----------------------------
# Combine + aggregate + plot
# -----------------------------
def build_issued_vs_expired(
    start_date: str,
    end_date: str,
    freq: str = "ME",  # "D" for daily, "W" weekly, "ME" monthly (month-end)
    security_types: Optional[Tuple[str, ...]] = None,  # Not used with debt_to_penny, kept for compatibility
) -> pd.DataFrame:
    """
    Returns a DataFrame indexed by period end (for ME/W) or date (for D) with:
      issued_usd, expired_usd, net_usd
      
    Note: This uses changes in total public debt as a proxy for issuance/expiry.
    """
    with requests.Session() as s:
        debt_df = get_debt_data(start_date, end_date)

    if debt_df.empty:
        raise RuntimeError("No data returned. Check dates or API availability.")

    # Calculate issuance and expiry from debt changes
    df = calculate_issuance_expiry_from_debt(debt_df)
    
    # Aggregate to chosen frequency
    if freq.upper() == "D":
        agg = df
    else:
        agg = df.resample(freq).sum()

    return agg


def plot_issued_expired_net(df: pd.DataFrame, title: str = "US Treasuries: Issued vs Expired"):
    """
    Plot bars for issued/expired and a line for net.
    """
    if df.empty:
        raise ValueError("Empty dataframe; nothing to plot.")

    # Convert to billions for readability
    b = 1e9
    plot_df = df.copy()
    plot_df["issued_bn"] = plot_df["issued_usd"] / b
    plot_df["expired_bn"] = plot_df["expired_usd"] / b
    plot_df["net_bn"] = plot_df["net_usd"] / b

    x = plot_df.index

    # Bars
    plt.figure()
    plt.bar(x, plot_df["issued_bn"].to_numpy(dtype=float), width=20 if len(x) < 50 else 10, label="Issued (bn USD)")
    plt.bar(x, -plot_df["expired_bn"].to_numpy(dtype=float), width=20 if len(x) < 50 else 10, label="Expired/Matured (bn USD)")

    # Net line
    plt.plot(x, plot_df["net_bn"].to_numpy(dtype=float), color='green', label="Net (Issued - Expired) (bn USD)")

    plt.axhline(0, linewidth=1)
    plt.title(title)
    plt.ylabel("USD (billions)")
    plt.legend()
    plt.xticks(rotation=45, ha="right")
    plt.tight_layout()
    plt.show()


if __name__ == "__main__":
    # Choose your window here
    start = "2006-01-01"
    end = "2026-01-31"  # Note: API might not have data up to current date

    # Frequency options:
    #  "D" daily (can be spiky)
    #  "W" weekly (Sunday anchor)
    #  "ME" monthly (month-end, recommended for readability)
    freq = "ME"

    try:
        print(f"Fetching Treasury debt data from {start} to {end}...")
        print("Note: Using Debt to the Penny data to calculate net issuance from daily debt changes.")
        print("      If the date range extends beyond available data, the API will return what's available.")
        df = build_issued_vs_expired(start, end, freq=freq)
        print(f"\nData fetched successfully! Shape: {df.shape}")
        print(f"Date range in data: {df.index.min()} to {df.index.max()}")
        print("\nLast 10 periods:")
        print(df.tail(10))
        
        print("\nGenerating plot...")
        plot_issued_expired_net(df, title=f"US Treasuries: Net Issuance from Debt Changes ({freq})")
        print("Done!")
        
    except Exception as e:
        print(f"Error occurred: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
