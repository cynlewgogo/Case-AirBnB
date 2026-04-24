# Marketplace Anomaly Detection Pipeline

Working prototype for a  single
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

## The anomaly

On day 61 (March 3, 2026), London's nightly rate jumps ~15% while the
competitor hotel index stays flat. Click-to-book conversion collapses ~40%.
Other cities are untouched. The pipeline detects this on March 4 (Day +1)
once the anomaly has persisted.

## Thought process and tradeoffs

1. Simple anomaly detection over complex forecasting
I used a rolling z-score / baseline variance approach instead of Prophet or heavier forecasting models. For a sharp step-change like a 40% drop in conversion, a simpler method is fast to build, easy to explain, and good enough to identify the issue. In this case, speed and clarity mattered more than model sophistication.

2. Prioritised business impact, not raw statistical movement
I weighted metrics based on commercial importance, so Gross Booking Value ranks above bookings, conversion, or clicks. This means the system surfaces the incident the business actually cares about first, rather than leading with a smaller downstream metric that happened to move more sharply in percentage terms.

3. Rule-based drilldown instead of AI-led diagnosis
I used a deterministic metric tree to trace the root cause. For example, GBV declines because bookings fall, bookings fall because conversion drops, conversion drops in London, and London points toward a pricing competitiveness issue. This approach is transparent, reliable, and easier to trust for operational workflows. AI is better used to summarise findings than to reason through metric arithmetic. Using an LLM to choose the next drill target adds nondeterminism and hallucination surface with no upside when the relationships are exact equations. LLM stays at the summary layer only — turning the structured Diagnosis object into a plain-English executive brief.


## What I would build next with more time

1. Add seasonality-aware detection
I would adjust for weekday versus weekend patterns, holidays, and major local events so the system can distinguish true issues from normal demand fluctuations.

2. Integrate deploy and experiment logs
I would connect pricing releases, experiments, app changes, and regional configuration updates into the monitoring layer so the system can automatically test whether a recent change likely caused the anomaly.

3. Deeper automatic segmentation
I would auto-scan across city, device, user type, listing type, and trip length to isolate problems faster and reduce manual investigation time.

4. Smart alert ranking
I would rank alerts based on business impact, confidence, and novelty so only the most important incidents get escalated, reducing alert fatigue.
