"""End-to-end driver: generate → detect → diagnose → summarize."""

from __future__ import annotations

from pathlib import Path

import detect
import diagnose
import generate_data
import summarize


def main() -> None:
    # 1. Generate synthetic data (idempotent).
    rows = generate_data.generate()
    csv_path = generate_data.write_csv(rows)
    print(f"[1/4] Synthetic data written: {csv_path} ({len(rows)} rows)\n")

    # 2. Run anomaly detection across the full metric tree.
    records = detect.load(csv_path)
    alerts = detect.scan(records)
    top = detect.rank_top(alerts, k=5)
    print(f"[2/4] Anomaly scan complete: {len(alerts)} total alerts across all (city, metric) pairs.")
    print("      Top 5 by severity:")
    for a in top:
        print(f"        - {a.date}  {a.city:<9}  {a.metric:<22}  "
              f"z={a.z:+.2f}  pct={a.pct_deviation:+.1%}")
    print()

    if not top:
        print("No anomalies found. Exiting.")
        return

    # 3. Diagnose the highest-severity alert.
    lead = top[0]
    print(f"[3/4] Drilling into top alert: {lead.metric} in {lead.city} at {lead.date}")
    dx = diagnose.run(records, city=lead.city, break_date=lead.date)
    for i, step in enumerate(dx.steps, 1):
        print(f"        {i}. [{step.node}] {step.finding}")
    print()

    # 4. Plain-English incident summary (mocked LLM).
    print("[4/4] Generating incident summary (mocked LLM):\n")
    print(summarize.summarize(dx))


if __name__ == "__main__":
    main()
