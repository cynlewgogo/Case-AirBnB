"""Generate a second synthetic dataset with a different anomaly.

Scenario: on day 61 (March 3, 2026), a paid-search budget cut halves
Madrid's marketing spend. Sessions drop ~35% immediately; conversion rates,
nightly rates, and the hotel index are all unchanged. GBV collapses because
fewer people are arriving at the top of the funnel — not because of pricing.

Cities: London, Paris, New York, Tokyo, Berlin, Madrid (Madrid is the victim).
"""

from __future__ import annotations

import csv
import math
import random
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "marketplace_metrics_v2.csv"

CITIES = ["London", "Paris", "New York", "Tokyo", "Berlin", "Madrid"]
DAYS = 90
START_DATE = date(2026, 1, 1)
ANOMALY_START_DAY = 61      # Jan 1 + 61 = March 3
ANOMALY_CITY = "Madrid"

CITY_BASELINE = {
    "London":   {"sessions": 52_000, "nightly_rate": 185, "hotel_index": 210},
    "Paris":    {"sessions": 48_000, "nightly_rate": 175, "hotel_index": 195},
    "New York": {"sessions": 61_000, "nightly_rate": 230, "hotel_index": 260},
    "Tokyo":    {"sessions": 34_000, "nightly_rate": 140, "hotel_index": 165},
    "Berlin":   {"sessions": 22_000, "nightly_rate": 120, "hotel_index": 140},
    "Madrid":   {"sessions": 31_000, "nightly_rate": 130, "hotel_index": 150},
}

BASE_VIEW_RATE = 0.62
BASE_CLICK_RATE = 0.28
BASE_BOOK_RATE = 0.11
BASE_NIGHTS = 3.4


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
    marketing_campaign_version: str


def _noise(scale: float = 0.03) -> float:
    return 1.0 + random.uniform(-scale, scale)


def _weekday_effect(d: date) -> float:
    return 1.0 + 0.05 * math.sin(2 * math.pi * d.weekday() / 7)


def generate(seed: int = 42) -> list[DayRow]:
    random.seed(seed)
    rows: list[DayRow] = []

    for day_idx in range(DAYS):
        d = START_DATE + timedelta(days=day_idx)
        for city in CITIES:
            base = CITY_BASELINE[city]
            sessions = int(base["sessions"] * _weekday_effect(d) * _noise(0.04))

            view_rate = BASE_VIEW_RATE * _noise(0.02)
            click_rate = BASE_CLICK_RATE * _noise(0.02)
            book_rate = BASE_BOOK_RATE * _noise(0.03)
            nightly_rate = base["nightly_rate"] * _noise(0.015)
            hotel_index = base["hotel_index"] * _noise(0.01)
            algo_version = "PRICE_ALGO_V11"
            campaign_version = "CAMPAIGN_SPRING_2026"

            # ── planted anomaly ────────────────────────────────────────────
            # From ANOMALY_START_DAY onward in Madrid only:
            #   * paid-search budget is cut — sessions drop ~35%
            #   * conversion rates, nightly rate, hotel index: all unchanged
            #   * marketing campaign version changes to reflect the cutback
            if city == ANOMALY_CITY and day_idx >= ANOMALY_START_DAY:
                sessions = int(sessions * 0.65)
                campaign_version = "CAMPAIGN_CUTBACK_MARCH"
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
                marketing_campaign_version=campaign_version,
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
