# Part 3 — Marketplace Anomaly Detection Pipeline

Working prototype for the Tilt Founders Associate take-home. A single
command runs a synthetic marketplace dataset through anomaly detection,
walks the metric tree to localise the cause, and prints a plain-English
incident report.

**Live dashboard:** [cynlewgogo.github.io/Case-AirBnB](https://cynlewgogo.github.io/Case-AirBnB/)

## Run it

```bash
git clone https://github.com/cynlewgogo/Case-AirBnB.git
cd Case-AirBnB
python src/main.py
```

No third-party dependencies — standard library only (`csv`, `statistics`,
`dataclasses`). Python 3.10+.

`data/marketplace_metrics.csv` is committed to the repo, so the pipeline
runs immediately. `src/generate_data.py` re-creates it deterministically
(seed = 7) if you delete it.

Expected output: London's `gross_booking_value` is the top business-weighted
alert; the drill-down trace identifies click-to-book conversion as the break
stage; the summary names `PRICE_ALGO_V12`, London, and March 3.

## Run the tests

```bash
python tests/test_pipeline.py
# or, with pytest installed:
pytest tests/
```

Three tests cover: data shape and anomaly injection, top alert is London GBV
(not a leaf metric), and root-cause diagnosis names `PRICE_ALGO_V12`.

## Files

| File | Role |
|---|---|
| `src/generate_data.py` | Creates `data/marketplace_metrics.csv` — 90 days × 5 cities, pricing-algo anomaly planted in London on day 61 (March 3) |
| `src/detect.py` | Rolling z-score detection across every `(city, metric)` pair; business-weight severity ensures GBV ranks above leaf metrics |
| `src/diagnose.py` | Deterministic root-cause walk: GBV → Bookings → Conversion → Funnel stage → Leaf hypothesis |
| `src/summarize.py` | Mocked LLM rendering layer — structured `Diagnosis` → exec-readable incident summary |
| `src/main.py` | Orchestrates all four stages; anchors diagnosis on the GBV alert |
| `tests/test_pipeline.py` | Three regression tests (no external deps) |
| `dashboard/` | React + Vite analytics dashboard, deployed to GitHub Pages |
| `data/marketplace_metrics.csv` | Committed dataset (90 days × 5 cities, seed = 7) |

## The planted anomaly

On day 61 (March 3, 2026), London's nightly rate jumps ~15% while the
competitor hotel index stays flat. Click-to-book conversion collapses ~40%.
Other cities are untouched. The pipeline detects this on March 4 (Day +1)
once the anomaly has persisted for two consecutive days.

## Trade-offs I made on purpose

- **Rolling z-score, not Prophet / STL.** A rolling window captures a
  regime shift well, is easy to explain to a non-technical reader, and
  has no training step. For a 2-hour prototype on a 1-month anomaly, the
  added complexity of a proper forecasting model wouldn't change the answer.
- **MIN_STREAK = 2.** Requiring two consecutive anomalous days before firing
  eliminates single-day noise spikes while still catching a genuine regime
  shift within 24 hours of confirmation. Detection fires on March 4, not
  March 3, which matches the "Day +1" detection story.
- **Business-weighted severity.** `severity = |z| × |pct| × weight`, where
  `gross_booking_value` carries weight 10 vs weight 1 for clicks. This
  ensures the pipeline always surfaces the business-level incident first and
  drills down from there, rather than leading with a leaf metric.
- **Deterministic drill-down, not an LLM planner.** The diagnostic logic
  follows a fixed metric tree. The tree is an accounting identity; the
  drill target is always arithmetic. LLMs are reserved for the summary layer.
- **Mocked LLM summarizer.** Swapping to a real Claude call is a two-line
  change (serialize the `Diagnosis` dataclass to JSON, pass in a fixed prompt).
- **Single-process, CSV in/out.** A real deployment would read from a
  warehouse (Snowflake/BigQuery) and emit to a queue. CSV keeps setup
  zero-config.

## What I would build next (if this were week 2, not hour 4)

1. **Pluggable detector.** Swap z-score for STL + residual control chart
   for slow drift, keep the rolling window for step changes. Ensemble on
   agreement.
2. **Learned tree.** Today the metric tree is hand-coded. For a real
   marketplace you'd learn the graph from metric co-movement + schema
   (every ratio metric's numerator/denominator is a known child).
3. **Change-log as first-class input.** Pipe deploys, experiment
   activations, pricing-algo changes, and host-side policy changes into
   a shared event stream the diagnoser can correlate against.
4. **Real LLM at the summary layer** with the structured `Diagnosis`
   object as the sole input — keeps hallucination surface small.
5. **Alert budgeting.** Score by business impact × statistical strength
   × novelty, and only escalate the top-N per day.
