"""Minimal regression tests for the anomaly detection pipeline.

Run without any external dependencies:
    python tests/test_pipeline.py

Or with pytest:
    pytest tests/
"""

from __future__ import annotations

import sys
import os
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import generate_data
import detect
import diagnose


def _write_tmp_csv(rows) -> Path:
    """Write rows to a temp file so tests never touch data/marketplace_metrics.csv."""
    tmp = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
    tmp.close()
    return generate_data.write_csv(rows, Path(tmp.name))


# ── Test 1: data generation ──────────────────────────────────────────────────

def test_data_shape_and_anomaly():
    """Dataset should have 90×5 rows; London's nightly rate should jump ~15%
    after March 3 while all other cities remain stable."""
    rows = generate_data.generate()

    assert len(rows) == generate_data.DAYS * len(generate_data.CITIES), (
        f"Expected {generate_data.DAYS * len(generate_data.CITIES)} rows, "
        f"got {len(rows)}"
    )

    anomaly_date = (
        generate_data.START_DATE
        + __import__("datetime").timedelta(days=generate_data.ANOMALY_START_DAY)
    ).isoformat()

    london_pre  = [r for r in rows if r.city == generate_data.ANOMALY_CITY and r.date < anomaly_date]
    london_post = [r for r in rows if r.city == generate_data.ANOMALY_CITY and r.date >= anomaly_date]

    assert london_pre,  "No pre-anomaly London rows found"
    assert london_post, "No post-anomaly London rows found"

    pre_rate  = sum(r.nightly_rate for r in london_pre)  / len(london_pre)
    post_rate = sum(r.nightly_rate for r in london_post) / len(london_post)

    assert post_rate > pre_rate * 1.10, (
        f"Expected London nightly rate to rise >10% post-deploy; "
        f"pre={pre_rate:.2f}, post={post_rate:.2f}"
    )

    # Other cities must not be affected.
    for city in generate_data.CITIES:
        if city == generate_data.ANOMALY_CITY:
            continue
        other_post = [r for r in rows if r.city == city and r.date >= anomaly_date]
        other_pre  = [r for r in rows if r.city == city and r.date < anomaly_date]
        other_pre_rate  = sum(r.nightly_rate for r in other_pre)  / len(other_pre)
        other_post_rate = sum(r.nightly_rate for r in other_post) / len(other_post)
        pct = (other_post_rate - other_pre_rate) / other_pre_rate
        assert abs(pct) < 0.05, (
            f"{city} nightly rate changed {pct:+.1%} post-deploy; expected <5% noise"
        )


# ── Test 2: detection finds the right city and metric ────────────────────────

def test_detection_top_alert_is_london_gbv():
    """After applying business-weight severity, the top alert should be
    London's gross_booking_value, not a lower-level leaf metric."""
    rows = generate_data.generate()
    csv_path = _write_tmp_csv(rows)
    records = detect.load(csv_path)
    alerts = detect.scan(records)

    assert alerts, "No alerts fired — detection is broken"

    # The top-severity alert (business-weighted) must be London GBV.
    top = detect.rank_top(alerts, k=1)[0]
    assert top.city   == generate_data.ANOMALY_CITY, (
        f"Expected top alert city={generate_data.ANOMALY_CITY}, got {top.city}"
    )
    assert top.metric == "gross_booking_value", (
        f"Expected top alert metric=gross_booking_value, got {top.metric}"
    )
    assert top.pct_deviation < -0.15, (
        f"Expected GBV to be down >15%; got {top.pct_deviation:+.1%}"
    )


# ── Test 3: diagnosis traces back to the pricing-algo deploy ─────────────────

def test_diagnosis_root_cause_is_pricing_algo():
    """The diagnostic walk-down should identify PRICE_ALGO_V12 as the cause
    and London as the affected city, with click-to-book as the break stage."""
    rows = generate_data.generate()
    csv_path = _write_tmp_csv(rows)
    records = detect.load(csv_path)
    alerts = detect.scan(records)

    gbv_alerts = [a for a in alerts if a.metric == "gross_booking_value"]
    assert gbv_alerts, "No GBV alert found"

    lead = detect.rank_top(gbv_alerts, k=1)[0]
    dx = diagnose.run(records, city=lead.city, break_date=lead.date)

    assert dx.city == generate_data.ANOMALY_CITY, (
        f"Diagnosis should be for {generate_data.ANOMALY_CITY}, got {dx.city}"
    )
    assert "V12" in dx.root_cause, (
        f"Root cause should mention PRICE_ALGO_V12; got: {dx.root_cause}"
    )
    assert dx.top_deviation_pct < -0.20, (
        f"Expected GBV deviation > 20%; got {dx.top_deviation_pct:+.1%}"
    )

    # The funnel step should identify click-to-book as the break stage.
    funnel_step = next((s for s in dx.steps if s.node == "Funnel"), None)
    assert funnel_step is not None, "Missing Funnel step in diagnosis"
    click_book_delta = funnel_step.evidence.get("click_book_delta", 0)
    assert click_book_delta < -0.20, (
        f"Click-to-book should be down >20%; got {click_book_delta:+.1%}"
    )


# ── Runner ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    tests = [
        test_data_shape_and_anomaly,
        test_detection_top_alert_is_london_gbv,
        test_diagnosis_root_cause_is_pricing_algo,
    ]
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
        except AssertionError as e:
            print(f"  FAIL  {t.__name__}: {e}")
            sys.exit(1)
    print(f"\nAll {len(tests)} tests passed.")
