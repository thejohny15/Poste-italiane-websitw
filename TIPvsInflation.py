import yfinance as yf
import matplotlib.pyplot as plt
import pandas as pd
from api import cpi, inflation
from datetime import datetime
import time
# Download TIPS ETF data from Yahoo Finance (TIP is the iShares TIPS Bond ETF)
# retry a few times in case of transient network issues and validate the result
for attempt in range(3):
    tip = yf.download('TIP', start='2003-12-01', end=datetime.now().strftime('%Y-%m-%d'))
    if tip is not None and not tip.empty:
        break
    time.sleep(1)
else:
    raise RuntimeError("Failed to download TIP data from yfinance after 3 attempts")

# Ensure index is datetime and flatten multi-index columns if needed
tip.index = pd.to_datetime(tip.index)

# yfinance sometimes returns multi-index columns, flatten them
if isinstance(tip.columns, pd.MultiIndex):
    tip.columns = tip.columns.get_level_values(0)

# Use 'Close' if 'Adj Close' doesn't exist
price_column = 'Adj Close' if 'Adj Close' in tip.columns else 'Close'

# Calculate monthly percentage change for TIP
tip_monthly = tip[price_column].resample('MS').last()
tip_pct_change = tip_monthly.pct_change() * 100  # Convert to percentage

# Calculate monthly percentage change for CPI (inflation)
cpi_monthly = cpi.resample('MS').last()
cpi_pct_change = cpi_monthly.pct_change() * 100  # Convert to percentage

# Align the data by date
df = pd.DataFrame({
    'TIP_Change': tip_pct_change,
    'CPI_Change': cpi_pct_change
}).dropna()

# Create the plot
plt.figure(figsize=(14, 7))
plt.plot(df.index, df['TIP_Change'], label='TIP Bond % Change (Monthly)', linewidth=2)
plt.plot(df.index, df['CPI_Change'], label='CPI Inflation % Change (Monthly)', linewidth=2)
plt.axhline(y=0, color='gray', linestyle='--', alpha=0.5)
plt.xlabel('Date', fontsize=12)
plt.ylabel('Percentage Change (%)', fontsize=12)
plt.title('TIP Bond vs CPI Inflation - Monthly Percentage Changes', fontsize=14, fontweight='bold')
plt.legend(fontsize=10)
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.show()

print(f"\nData Summary:")
print(f"Date Range: {df.index[0].strftime('%Y-%m-%d')} to {df.index[-1].strftime('%Y-%m-%d')}")
print(f"\nTIP Average Monthly Change: {df['TIP_Change'].mean():.3f}%")
print(f"CPI Average Monthly Change: {df['CPI_Change'].mean():.3f}%")
print(f"\nCorrelation: {df['TIP_Change'].corr(df['CPI_Change']):.3f}")
