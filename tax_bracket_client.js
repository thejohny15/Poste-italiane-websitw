(function () {
  const API_BASE = 'http://localhost:5001';

  async function loadTradingEconomicsTopTaxRate(options) {
    const {
      countrySlug,
      statusId,
      imageId,
      textId,
      linkId,
      metricsId
    } = options || {};

    const statusEl = document.getElementById(statusId);
    const imageEl = document.getElementById(imageId);
    const textEl = document.getElementById(textId);
    const linkEl = document.getElementById(linkId);
    const metricsEl = document.getElementById(metricsId);

    if (!countrySlug) return;

    if (statusEl) {
      statusEl.textContent = 'Loading top tax bracket data...';
      statusEl.style.background = '#E5E7EB';
      statusEl.style.color = '#111827';
    }

    try {
      const url = `${API_BASE}/api/tradingeconomics-top-tax-rate?country=${encodeURIComponent(countrySlug)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();

      if (imageEl) {
        if (data.chart_url) {
          imageEl.src = data.chart_url;
          imageEl.style.display = 'block';
        } else {
          imageEl.style.display = 'none';
        }
      }

      if (textEl) {
        textEl.textContent = data.description || 'No top tax bracket summary returned.';
      }

      if (metricsEl) {
        const current = Number.isFinite(data.current_rate_percent) ? `${data.current_rate_percent.toFixed(1)}%` : 'N/A';
        const high = Number.isFinite(data.historical_high_percent) ? `${data.historical_high_percent.toFixed(1)}%` : 'N/A';
        const low = Number.isFinite(data.historical_low_percent) ? `${data.historical_low_percent.toFixed(1)}%` : 'N/A';
        metricsEl.textContent = `Top bracket (current): ${current} · Historical high: ${high} · Historical low: ${low}`;
      }

      if (linkEl) {
        if (data.source_url) {
          linkEl.href = data.source_url;
          linkEl.style.display = 'inline';
        } else {
          linkEl.style.display = 'none';
        }
      }

      if (statusEl) {
        statusEl.textContent = '✅ Top tax bracket loaded';
        statusEl.style.background = '#DCFCE7';
        statusEl.style.color = '#166534';
      }
    } catch (error) {
      if (statusEl) {
        statusEl.textContent = `❌ Top tax bracket load failed: ${error.message || error}`;
        statusEl.style.background = '#FEE2E2';
        statusEl.style.color = '#991B1B';
      }
      if (textEl) {
        textEl.textContent = 'Could not load top personal income tax rate information.';
      }
      if (metricsEl) {
        metricsEl.textContent = 'Top bracket (current): N/A · Historical high: N/A · Historical low: N/A';
      }
      if (imageEl) {
        imageEl.style.display = 'none';
      }
      if (linkEl) {
        linkEl.style.display = 'none';
      }
    }
  }

  window.loadTradingEconomicsTopTaxRate = loadTradingEconomicsTopTaxRate;
})();
