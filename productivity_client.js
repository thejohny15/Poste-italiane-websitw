(function () {
  const API_BASE = 'http://localhost:5001';

  async function loadTradingEconomicsProductivity(options) {
    const {
      countrySlug,
      statusId,
      imageId,
      textId,
      linkId
    } = options || {};

    const statusEl = document.getElementById(statusId);
    const imageEl = document.getElementById(imageId);
    const textEl = document.getElementById(textId);
    const linkEl = document.getElementById(linkId);

    if (!countrySlug) return;

    if (statusEl) {
      statusEl.textContent = 'Loading TradingEconomics productivity data...';
      statusEl.style.background = '#E5E7EB';
      statusEl.style.color = '#111827';
    }

    try {
      const url = `${API_BASE}/api/tradingeconomics-productivity?country=${encodeURIComponent(countrySlug)}`;
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
        textEl.textContent = data.description || 'No productivity summary returned.';
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
        statusEl.textContent = '✅ TradingEconomics productivity loaded';
        statusEl.style.background = '#DCFCE7';
        statusEl.style.color = '#166534';
      }
    } catch (error) {
      if (statusEl) {
        statusEl.textContent = `❌ Productivity load failed: ${error.message || error}`;
        statusEl.style.background = '#FEE2E2';
        statusEl.style.color = '#991B1B';
      }
      if (textEl) {
        textEl.textContent = 'Could not load TradingEconomics productivity information.';
      }
      if (imageEl) {
        imageEl.style.display = 'none';
      }
      if (linkEl) {
        linkEl.style.display = 'none';
      }
    }
  }

  window.loadTradingEconomicsProductivity = loadTradingEconomicsProductivity;
})();
