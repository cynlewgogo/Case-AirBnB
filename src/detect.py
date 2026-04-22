"""Anomaly detection over the marketplace metric tree.

Approach: for every (city, metric) series, compute a rolling baseline over
the trailing BASELINE_WINDOW days, then flag any day whose deviation from
that baseline exceeds THRESHOLD_Z standard deviations. Simple, transparent,
and sufficient for a month-long regime shift. Alerts are returned in a
structured form so diagnose.py can walk them.
"""

from __future__ import annotations

import csv
import statistics
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

BASELINE_WINDOW = 21    # days of history to form the baseline
MIN_HISTORY = 14        # won't score anomalies before this many days exist
THRESHOLD_Z = 2.5       # robust to noise, sensitive to regime shifts

# Metrics we monitor at each tree level. The names match columns in the CSV
# emitted by generate_data.py.
MONITORED_METRICS = [
    "gross_booking_value",
    "bookings",
    "sessions",
    "listing_views",
    "clicks",
    "nightly_rate",
    "avg_booking_value",
]


@dataclass
class Alert:
    city: str
    metric: str
    date: str
    actual: float
    baseline_mean: float
    baseline_std: float
    z: float
    pct_deviation: float  # (actual - mean) / mean

    @property
    def severity(self) -> float:
        # Score combines statistical strength and business-relevant size.
        return abs(self.z) * abs(self.pct_deviation)


def load(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _by_city_metric(rows: list[dict]) -> dict[tuple[str, str], list[tuple[str, float]]]:
    """Return {(city, metric): [(date, value), ...]} sorted by date."""
    series: dict[tuple[str, str], list[tuple[str, float]]] = defaultdict(list)
    for r in rows:
        for m in MONITORED_METRICS:
            series[(r["city"], m)].append((r["date"], float(r[m])))
    for key in series:
        series[key].sort(key=lambda t: t[0])
    return series


def scan(rows: list[dict]) -> list[Alert]:
    alerts: list[Alert] = []
    for (city, metric), series in _by_city_metric(rows).items():
        for i, (d, v) in enumerate(series):
            if i < MIN_HISTORY:
                continue
            window = [val for _, val in series[max(0, i - BASELINE_WINDOW): i]]
            mean = statistics.fmean(window)
            std = statistics.pstdev(window) or 1e-9
            z = (v - mean) / std
            pct = (v - mean) / mean if mean else 0.0
            if abs(z) >= THRESHOLD_Z:
                alerts.append(Alert(
                    city=city, metric=metric, date=d,
                    actual=v, baseline_mean=mean, baseline_std=std,
                    z=z, pct_deviation=pct,
                ))
    return alerts


def rank_top(alerts: Iterable[Alert], k: int = 5) -> list[Alert]:
    return sorted(alerts, key=lambda a: -a.severity)[:k]
