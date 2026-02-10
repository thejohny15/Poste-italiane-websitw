import matplotlib.pyplot as plt
import pandas as pd
from fredapi import Fred
from pytrends.request import TrendReq
from datetime import datetime, timedelta

# Set up FRED API
fred = Fred(api_key='e1260575e1dbea9b426f27505c956e8b')

# Set up date range for last 10 years
end_date = datetime.now()
start_date = end_date - timedelta(days=365*10)

# Get both CPI metrics from FRED
cpi_all = fred.get_series('CPIAUCSL')  # All items
cpi_core = fred.get_series('CPILFESL')  # All items less food and energy (Core CPI)

# Filter to last 10 years
cpi_all_data = cpi_all[cpi_all.index >= start_date]
cpi_core_data = cpi_core[cpi_core.index >= start_date]

# Resample to monthly and calculate year-over-year inflation for both
cpi_all_monthly = cpi_all_data.resample('MS').last()
cpi_core_monthly = cpi_core_data.resample('MS').last()

yoy_inflation_all = cpi_all_monthly.pct_change(periods=12) * 100  # 12-month % change
yoy_inflation_core = cpi_core_monthly.pct_change(periods=12) * 100  # 12-month % change

# Set up Google Trends with error handling and retry
pytrends = TrendReq(hl='en-US', tz=360, timeout=(10, 25), retries=2, backoff_factor=1)

# Get Google Trends data for "inflation" keyword - request monthly data
# Use 'today 5-y' for more reliable results, then extend if needed
try:
    pytrends.build_payload(['inflation'], cat=0, timeframe='today 5-y', geo='US', gprop='')
    google_trends = pytrends.interest_over_time()
    
    # If that worked, try to get the full 10 years
    if google_trends.empty:
        raise ValueError("No data returned from Google Trends")
    
    # Try again with 10 years
    pytrends.build_payload(['inflation'], cat=0, timeframe='today 10-y', geo='US', gprop='')
    google_trends_10y = pytrends.interest_over_time()
    
    if not google_trends_10y.empty:
        google_trends = google_trends_10y
        
except Exception as e:
    print(f"Error fetching Google Trends data: {e}")
    print("Trying alternative approach...")
    # Fallback: use date range format
    pytrends.build_payload(['inflation'], cat=0, timeframe=f'{start_date.strftime("%Y-%m-%d")} {end_date.strftime("%Y-%m-%d")}', geo='US', gprop='')
    google_trends = pytrends.interest_over_time()

print(f"Google Trends data shape: {google_trends.shape}")
print(f"Google Trends columns: {google_trends.columns.tolist()}")
# Rename the column for clarity
google_trends = google_trends.rename(columns={'inflation': 'Google_Searches'})

# Resample Google Trends to monthly if needed
google_monthly = google_trends.resample('MS').mean()

# Combine all data
df = pd.DataFrame({
    'CPI_All_Items': yoy_inflation_all,
    'CPI_Core': yoy_inflation_core,
    'Google_Searches': google_monthly['Google_Searches']
}).dropna()

print(f"\nCombined data shape: {df.shape}")
print(f"Combined data:\n{df.head(10)}")
print(f"Google Searches stats: min={df['Google_Searches'].min()}, max={df['Google_Searches'].max()}, mean={df['Google_Searches'].mean()}")

# 'df' already contains 'CPI_All_Items', 'CPI_Core', and 'Google_Searches' from above; no need to overwrite it.
# Continue to plotting and statistics below.

# Create the plot with dual y-axes
fig, ax1 = plt.subplots(figsize=(14, 7))

# Plot both inflation metrics on left y-axis
color1 = 'tab:red'
color1b = 'tab:orange'
ax1.set_xlabel('Date', fontsize=12)
ax1.set_ylabel('Year-over-Year Inflation Rate (%)', fontsize=12)
ax1.plot(df.index, df['CPI_All_Items'], color=color1, linewidth=2, label='CPI All Items')
ax1.plot(df.index, df['CPI_Core'], color=color1b, linewidth=2, label='CPI Core (ex. Food & Energy)', linestyle='--')
ax1.tick_params(axis='y')
ax1.grid(True, alpha=0.3)

# Create second y-axis for Google searches
ax2 = ax1.twinx()
color2 = 'tab:blue'
ax2.set_ylabel('Google Search Interest (0-100)', color=color2, fontsize=12)
ax2.plot(df.index, df['Google_Searches'], color=color2, linewidth=2.5, label='Google Searches for "Inflation"', alpha=0.8)
ax2.tick_params(axis='y', labelcolor=color2)
ax2.set_ylim(0, 110)  # Set y-axis limits to make the line more visible

# Title and layout
plt.title('US Inflation Metrics vs Google Search Interest for "Inflation" (Last 10 Years)', 
          fontsize=14, fontweight='bold', pad=20)

# Add legends
lines1, labels1 = ax1.get_legend_handles_labels()
lines2, labels2 = ax2.get_legend_handles_labels()
ax1.legend(lines1 + lines2, labels1 + labels2, loc='upper left', fontsize=10)

plt.tight_layout()
plt.show()

# Print statistics
print(f"\nData Summary:")
start_str = pd.to_datetime(df.index[0]).strftime('%Y-%m-%d')
end_str = pd.to_datetime(df.index[-1]).strftime('%Y-%m-%d')
print(f"Date Range: {start_str} to {end_str}")

print(f"\nCPI All Items Statistics:")
print(f"  Average: {df['CPI_All_Items'].mean():.2f}%")
infl_all_max = df['CPI_All_Items'].max()
infl_all_max_date = pd.to_datetime(df['CPI_All_Items'].idxmax()).strftime('%Y-%m-%d')
print(f"  Max: {infl_all_max:.2f}% on {infl_all_max_date}")
infl_all_min = df['CPI_All_Items'].min()
infl_all_min_date = pd.to_datetime(df['CPI_All_Items'].idxmin()).strftime('%Y-%m-%d')
print(f"  Min: {infl_all_min:.2f}% on {infl_all_min_date}")

print(f"\nCPI Core (ex. Food & Energy) Statistics:")
print(f"  Average: {df['CPI_Core'].mean():.2f}%")
infl_core_max = df['CPI_Core'].max()
infl_core_max_date = pd.to_datetime(df['CPI_Core'].idxmax()).strftime('%Y-%m-%d')
print(f"  Max: {infl_core_max:.2f}% on {infl_core_max_date}")
infl_core_min = df['CPI_Core'].min()
infl_core_min_date = pd.to_datetime(df['CPI_Core'].idxmin()).strftime('%Y-%m-%d')
print(f"  Min: {infl_core_min:.2f}% on {infl_core_min_date}")

print(f"\nGoogle Search Interest Statistics:")
print(f"  Average: {df['Google_Searches'].mean():.1f}")
gs_peak = df['Google_Searches'].max()
gs_peak_date = pd.to_datetime(df['Google_Searches'].idxmax()).strftime('%Y-%m-%d')
print(f"  Peak: {gs_peak:.0f} on {gs_peak_date}")

corr_all = df['CPI_All_Items'].corr(df['Google_Searches'])
corr_core = df['CPI_Core'].corr(df['Google_Searches'])
print(f"\nCorrelations with Google Searches:")
print(f"  CPI All Items: {corr_all:.3f}")
print(f"  CPI Core: {corr_core:.3f}")

