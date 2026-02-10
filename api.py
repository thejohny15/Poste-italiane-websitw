from fredapi import Fred

fred = Fred(api_key='e1260575e1dbea9b426f27505c956e8b')

# Get CPI data (Consumer Price Index)
cpi = fred.get_series('CPIAUCSL')

# Or get PCE (Personal Consumption Expenditures - Fed's preferred measure)
pce = fred.get_series('PCEPI')

# Get year-over-year inflation rate
inflation = fred.get_series('FPCPITOTLZGUSA')