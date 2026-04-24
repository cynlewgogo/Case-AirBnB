"""Scenario 2: Madrid sessions collapse (paid-search budget cut, March 3 2026).

Run:
    python src/main_v2.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import generate_data_v2 as gen
import detect
import diagnose
import summarize


def main() -> None:
    # 1. Generate (or load) the dataset
    csv_path = gen.DATA_PATH
    if not csv_path.exists():
        rows_obj = gen.generate()
        gen.write_csv(rows_obj, csv_path)
        print(f"Generated {len(rows_obj)} rows → {csv_path}")
    else:
        print(f"Using existing dataset: {csv_path}")

    rows = detect.load(csv_path)

    # 2. Detect anomalies across all (city, metric) pairs
    alerts = detect.scan(rows)
    top5 = detect.rank_top(alerts, k=5)

    print("\n── Top 5 alerts (business-weighted severity) ──")
    for a in top5:
        print(f"  {a.city:12s} {a.metric:25s}  {a.pct_deviation:+.1%}  (z={a.z:.1f}, date={a.date})")

    # 3. Anchor on the GBV alert for Madrid (the headline business metric)
    gbv_alerts = [a for a in alerts if a.metric == "gross_booking_value"]
    top_gbv = detect.rank_top(gbv_alerts, k=1)

    if not top_gbv:
        print("\nNo GBV alert found — no significant anomaly detected.")
        return

    lead = top_gbv[0]
    print(f"\n── Lead alert: {lead.city} gross_booking_value {lead.pct_deviation:+.1%} (break date {lead.date}) ──")

    # 4. Diagnose root cause
    dx = diagnose.run(rows, city=lead.city, break_date=lead.date)

    print("\n── Diagnostic trace ──")
    for step in dx.steps:
        print(f"\n  [{step.node}]")
        print(f"  {step.finding}")

    # 5. Plain-English summary
    print("\n── Incident summary ──")
    print(summarize.summarize(dx))


if __name__ == "__main__":
    main()
