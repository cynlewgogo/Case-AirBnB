"""Anomaly detection over the marketplace metric tree.

Approach: for every (city, metric) series, compute a rolling baseline over
the trailing BASELINE_WINDOW days, then flag any day where:
  1. The deviation exceeds THRESHOLD_Z standard deviations, AND
  2. The same condition held on the previous day (MIN_STREAK = 2).

The streak requirement eliminates single-day noise spikes that would
otherwise flood the alert queue. It means London GBV fires on March 4
(Day +1 after the March 3 deploy) rather than firing immediately on the
first noisy observation.

Severity combines statistical strength, business magnitude, and a per-metric
business-impact weight so GBV always ranks above a leaf metric like clicks.
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
MIN_STREAK = 2          # consecutive anomalous days required before firing

# Weight by business impact so the top alert is always a business metric,
# not a technical leaf. GBV is 10× more important than raw click counts.
METRIC_BUSINESS_WEIGHT: dict[str, float] = {
    "gross_booking_value": 10.0,
    "bookings":             3.0,
    "avg_booking_value":    2.0,
    "nightly_rate":         1.5,
    "sessions":             1.0,
    "listing_views":        1.0,
    "clicks":               1.0,
}

# Metrics we monitor at each tree level. Names match CSV columns.
MONITORED_METRICS = list(METRIC_BUSINESS_WEIGHT.keys())


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
        weight = METRIC_BUSINESS_WEIGHT.get(self.metric, 1.0)
        return abs(self.z) * abs(self.pct_deviation) * weight


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
    """Scan every (city, metric) series and return alerts.

    An alert fires on the *second* consecutive day the z-score exceeds the
    threshold (MIN_STREAK = 2). This keeps false positives low while still
    catching a genuine regime shift within 24 hours of confirmation.
    """
    alerts: list[Alert] = []
    for (city, metric), series in _by_city_metric(rows).items():
        streak = 0
        for i, (d, v) in enumerate(series):
            if i < MIN_HISTORY:
                streak = 0
                continue
            window = [val for _, val in series[max(0, i - BASELINE_WINDOW): i]]
            mean = statistics.fmean(window)
            std = statistics.pstdev(window) or 1e-9
            z = (v - mean) / std
            pct = (v - mean) / mean if mean else 0.0

            if abs(z) >= THRESHOLD_Z:
                streak += 1
            else:
                streak = 0

            if streak >= MIN_STREAK:
                # Use the *first* day of the streak as the alert date so the
                # diagnoser's break_date aligns with when the change occurred,
                # not when the streak confirmation fired.
                start_idx = i - (streak - 1)
                alert_date = series[start_idx][0]
                alerts.append(Alert(
                    city=city, metric=metric, date=alert_date,
                    actual=v, baseline_mean=mean, baseline_std=std,
                    z=z, pct_deviation=pct,
                ))
    return alerts


def rank_top(alerts: Iterable[Alert], k: int = 5) -> list[Alert]:
    """Rank by severity (|z| × |pct| × business_weight), descending."""
    return sorted(alerts, key=lambda a: -a.severity)[:k]
