"""Generate synthetic marketplace metrics with a planted anomaly.

The anomaly: on day 60, a pricing-algo deploy raises London's nightly rate
by ~15% while the local hotel rate index is flat. Click-to-book conversion
collapses by ~40% as a consequence. Other cities are untouched.
"""

from __future__ import annotations

import csv
import math
import random
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "marketplace_metrics.csv"

CITIES = ["London", "Paris", "New York", "Tokyo", "Berlin"]
DAYS = 90
ANOMALY_START_DAY = 60
ANOMALY_CITY = "London"

# Per-city baseline sessions/day and nightly rate (USD-equivalent).
CITY_BASELINE = {
    "London":   {"sessions": 52_000, "nightly_rate": 185, "hotel_index": 210},
    "Paris":    {"sessions": 48_000, "nightly_rate": 175, "hotel_index": 195},
    "New York": {"sessions": 61_000, "nightly_rate": 230, "hotel_index": 260},
    "Tokyo":    {"sessions": 34_000, "nightly_rate": 140, "hotel_index": 165},
    "Berlin":   {"sessions": 22_000, "nightly_rate": 120, "hotel_index": 140},
}

# Baseline funnel rates (stable across cities; small per-city noise added).
BASE_VIEW_RATE = 0.62       # search -> listing view
BASE_CLICK_RATE = 0.28      # view -> click
BASE_BOOK_RATE = 0.11       # click -> book  ← the stage the anomaly hits
BASE_NIGHTS = 3.4           # nights per booking


@dataclass
class DayRow:
    date: str
    city: str
    sessions: int
    listing_views: int
    clicks: int
    bookings: int
    nightly_rate: float
    nights_per_booking: float
    avg_booking_value: float
    gross_booking_value: float
    competitor_hotel_index: float
    pricing_algo_version: str


def _noise(scale: float = 0.03) -> float:
    """Small multiplicative noise centered on 1.0."""
    return 1.0 + random.uniform(-scale, scale)


def _weekday_effect(d: date) -> float:
    # Mild weekly seasonality: weekends slightly hotter.
    return 1.0 + 0.05 * math.sin(2 * math.pi * d.weekday() / 7)


def generate(seed: int = 7) -> list[DayRow]:
    random.seed(seed)
    start = date(2026, 2, 1)
    rows: list[DayRow] = []

    for day_idx in range(DAYS):
        d = start + timedelta(days=day_idx)
        for city in CITIES:
            base = CITY_BASELINE[city]
            sessions = int(base["sessions"] * _weekday_effect(d) * _noise(0.04))

            view_rate = BASE_VIEW_RATE * _noise(0.02)
            click_rate = BASE_CLICK_RATE * _noise(0.02)
            book_rate = BASE_BOOK_RATE * _noise(0.03)
            nightly_rate = base["nightly_rate"] * _noise(0.015)
            hotel_index = base["hotel_index"] * _noise(0.01)
            algo_version = "PRICE_ALGO_V11"

            # ── planted anomaly ────────────────────────────────────────────
            # From ANOMALY_START_DAY onward in London only:
            #   * nightly rate rises ~15% (pricing algo deploy)
            #   * hotel index is unchanged (hotels didn't follow)
            #   * click→book conversion collapses by ~40%
            if city == ANOMALY_CITY and day_idx >= ANOMALY_START_DAY:
                nightly_rate *= 1.15
                book_rate *= 0.60
                algo_version = "PRICE_ALGO_V12"
            # ───────────────────────────────────────────────────────────────

            listing_views = int(sessions * view_rate)
            clicks = int(listing_views * click_rate)
            bookings = int(clicks * book_rate)
            nights = BASE_NIGHTS * _noise(0.02)
            abv = nightly_rate * nights
            gbv = bookings * abv

            rows.append(DayRow(
                date=d.isoformat(),
                city=city,
                sessions=sessions,
                listing_views=listing_views,
                clicks=clicks,
                bookings=bookings,
                nightly_rate=round(nightly_rate, 2),
                nights_per_booking=round(nights, 2),
                avg_booking_value=round(abv, 2),
                gross_booking_value=round(gbv, 2),
                competitor_hotel_index=round(hotel_index, 2),
                pricing_algo_version=algo_version,
            ))
    return rows


def write_csv(rows: list[DayRow], path: Path = DATA_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = list(rows[0].__dict__.keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow(r.__dict__)
    return path


if __name__ == "__main__":
    rows = generate()
    path = write_csv(rows)
    print(f"Wrote {len(rows)} rows to {path}")
