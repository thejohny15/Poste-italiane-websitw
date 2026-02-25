import argparse
import csv
import re
from dataclasses import dataclass
from datetime import date, datetime

import matplotlib.pyplot as plt
import numpy as np
import requests


EU_COUNTRIES = [
    ("austria", "Austria", "AT"),
    ("belgium", "Belgium", "BE"),
    ("bulgaria", "Bulgaria", "BG"),
    ("croatia", "Croatia", "HR"),
    ("cyprus", "Cyprus", "CY"),
    ("czech-republic", "Czech Republic", "CZ"),
    ("denmark", "Denmark", "DK"),
    ("estonia", "Estonia", "EE"),
    ("finland", "Finland", "FI"),
    ("france", "France", "FR"),
    ("germany", "Germany", "DE"),
    ("greece", "Greece", "GR"),
    ("hungary", "Hungary", "HU"),
    ("ireland", "Ireland", "IE"),
    ("italy", "Italy", "IT"),
    ("latvia", "Latvia", "LV"),
    ("lithuania", "Lithuania", "LT"),
    ("luxembourg", "Luxembourg", "LU"),
    ("malta", "Malta", "MT"),
    ("netherlands", "Netherlands", "NL"),
    ("poland", "Poland", "PL"),
    ("portugal", "Portugal", "PT"),
    ("romania", "Romania", "RO"),
    ("slovakia", "Slovakia", "SK"),
    ("slovenia", "Slovenia", "SI"),
    ("spain", "Spain", "ES"),
    ("sweden", "Sweden", "SE"),
]


HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "Accept-Language": "en-US,en;q=0.9",
}


@dataclass
class Observation:
    country_slug: str
    country_name: str
    country_code: str
    productivity: float
    productivity_date: date | None
    labor_tax_rate: float
    labor_tax_date: date | None


def get_meta_description(html: str) -> str | None:
    m = re.search(r'<meta[^>]+name="description"[^>]+content="([^"]+)"', html, flags=re.I)
    if not m:
        return None
    return re.sub(r"\s+", " ", m.group(1)).strip()


def parse_reference_date(text: str) -> date | None:
    quarter_match = re.search(r"(first|second|third|fourth)\s+quarter\s+of\s+(\d{4})", text, flags=re.I)
    if quarter_match:
        quarter = quarter_match.group(1).lower()
        year = int(quarter_match.group(2))
        quarter_end = {
            "first": (3, 31),
            "second": (6, 30),
            "third": (9, 30),
            "fourth": (12, 31),
        }
        month, day = quarter_end[quarter]
        return date(year, month, day)

    month_match = re.search(
        r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b",
        text,
        flags=re.I,
    )
    if month_match:
        dt = datetime.strptime(f"{month_match.group(1)} {month_match.group(2)}", "%b %Y")
        return date(dt.year, dt.month, 1)

    year_match = re.search(r"\bin\s+(\d{4})\b", text, flags=re.I)
    if year_match:
        return date(int(year_match.group(1)), 12, 31)

    return None


def parse_productivity_current(description: str) -> float | None:
    m = re.search(r"\bto\s+(-?\d+(?:\.\d+)?)\s+\w+\s+in\s+the\b", description, flags=re.I)
    if m:
        return float(m.group(1))
    m2 = re.search(r"\bstands\s+at\s+(-?\d+(?:\.\d+)?)\s+\w+", description, flags=re.I)
    if m2:
        return float(m2.group(1))
    return None


def parse_tax_current(description: str) -> float | None:
    m = re.search(r"\bstands\s+at\s+(-?\d+(?:\.\d+)?)\s+percent", description, flags=re.I)
    if m:
        return float(m.group(1))
    m2 = re.search(r"\bto\s+(-?\d+(?:\.\d+)?)\s+percent\b", description, flags=re.I)
    if m2:
        return float(m2.group(1))
    return None


def fetch_page_description(country_slug: str, indicator_slug: str) -> str:
    url = f"https://tradingeconomics.com/{country_slug}/{indicator_slug}"
    response = requests.get(url, headers=HEADERS, timeout=45)
    response.raise_for_status()
    desc = get_meta_description(response.text)
    if not desc:
        raise RuntimeError(f"No meta description found: {url}")
    return desc


def fetch_country_observation(country_slug: str, country_name: str, country_code: str) -> Observation | None:
    try:
        productivity_desc = fetch_page_description(country_slug, "productivity")
        tax_desc = fetch_page_description(country_slug, "personal-income-tax-rate")

        productivity_value = parse_productivity_current(productivity_desc)
        tax_value = parse_tax_current(tax_desc)
        if productivity_value is None or tax_value is None:
            return None

        return Observation(
            country_slug=country_slug,
            country_name=country_name,
            country_code=country_code,
            productivity=productivity_value,
            productivity_date=parse_reference_date(productivity_desc),
            labor_tax_rate=tax_value,
            labor_tax_date=parse_reference_date(tax_desc),
        )
    except Exception:
        return None


def passes_as_of_filter(obs: Observation, as_of: date | None) -> bool:
    if as_of is None:
        return True
    if obs.productivity_date and obs.productivity_date > as_of:
        return False
    if obs.labor_tax_date and obs.labor_tax_date > as_of:
        return False
    return True


def compute_regression_and_r2(observations: list[Observation]) -> tuple[float, float, float]:
    x = np.array([obs.productivity for obs in observations], dtype=float)
    y = np.array([obs.labor_tax_rate for obs in observations], dtype=float)
    slope, intercept = np.polyfit(x, y, 1)
    y_hat = slope * x + intercept
    ss_res = float(np.sum((y - y_hat) ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r2 = 1.0 - (ss_res / ss_tot) if ss_tot else float("nan")
    return float(slope), float(intercept), r2


def build_scatter_plot(observations: list[Observation], slope: float, intercept: float, r2: float, output_png: str, as_of: date | None):
    x = np.array([obs.productivity for obs in observations], dtype=float)
    y = np.array([obs.labor_tax_rate for obs in observations], dtype=float)

    plt.figure(figsize=(12, 7))
    plt.scatter(x, y, alpha=0.85)

    for obs in observations:
        plt.annotate(obs.country_code, (obs.productivity, obs.labor_tax_rate), xytext=(5, 4), textcoords="offset points", fontsize=8)

    x_line = np.linspace(float(np.min(x)), float(np.max(x)), 100)
    y_line = slope * x_line + intercept
    plt.plot(x_line, y_line, linestyle="--", linewidth=1.5)

    as_of_label = as_of.isoformat() if as_of else "latest"
    plt.title(f"EU: Labor Productivity vs Personal Income Tax Rate (%), as-of {as_of_label}\\nR² = {r2:.4f}")
    plt.xlabel("Labor Productivity (TradingEconomics indicator value)")
    plt.ylabel("Personal Income Tax Rate (%)")
    plt.grid(alpha=0.25)
    plt.tight_layout()
    plt.savefig(output_png, dpi=180)
    plt.close()


def write_csv(observations: list[Observation], output_csv: str):
    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "country_slug",
            "country_name",
            "country_code",
            "productivity",
            "productivity_reference_date",
            "labor_tax_rate_percent",
            "labor_tax_reference_date",
        ])
        for obs in observations:
            writer.writerow([
                obs.country_slug,
                obs.country_name,
                obs.country_code,
                obs.productivity,
                obs.productivity_date.isoformat() if obs.productivity_date else "",
                obs.labor_tax_rate,
                obs.labor_tax_date.isoformat() if obs.labor_tax_date else "",
            ])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="EU scatter: productivity vs labor tax rate, with R^2")
    parser.add_argument("--as-of", type=str, default=None, help="Optional ISO date filter (YYYY-MM-DD).")
    parser.add_argument("--png", type=str, default="eu_productivity_vs_labor_tax_scatter.png", help="Output PNG filename.")
    parser.add_argument("--csv", type=str, default="eu_productivity_vs_labor_tax_data.csv", help="Output CSV filename.")
    return parser.parse_args()


def main():
    args = parse_args()
    as_of_date = datetime.strptime(args.as_of, "%Y-%m-%d").date() if args.as_of else None

    observations: list[Observation] = []
    for slug, name, code in EU_COUNTRIES:
        obs = fetch_country_observation(slug, name, code)
        if not obs:
            continue
        if not passes_as_of_filter(obs, as_of_date):
            continue
        observations.append(obs)

    if len(observations) < 3:
        raise RuntimeError("Not enough observations to compute regression after filtering.")

    slope, intercept, r2 = compute_regression_and_r2(observations)
    build_scatter_plot(observations, slope, intercept, r2, args.png, as_of_date)
    write_csv(observations, args.csv)

    print(f"Countries used: {len(observations)}")
    print(f"R^2: {r2:.6f}")
    print(f"Slope: {slope:.6f}")
    print(f"Intercept: {intercept:.6f}")
    print(f"Saved plot: {args.png}")
    print(f"Saved data: {args.csv}")


if __name__ == "__main__":
    main()
