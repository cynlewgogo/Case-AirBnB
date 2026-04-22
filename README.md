# Part 3 — Marketplace Anomaly Detection Pipeline

Working prototype for the Tilt Founders Associate take-home. A single
command generates a synthetic marketplace dataset, catches a planted
anomaly, walks the metric tree to localize the cause, and prints a
plain-English incident report.

## Run it

```bash
cd tilt-founders-associate
python src/main.py
```

No third-party dependencies — standard library only (`csv`, `statistics`,
`dataclasses`). Python 3.10+.

Expected output: a list of top anomalies (London's `gross_booking_value`,
`bookings`, and `nightly_rate` dominate), a drill-down trace, and a final
summary naming London, the pricing-algo deploy, and the date.

## Files

| File | Role |
|---|---|
| `src/generate_data.py` | Creates `data/marketplace_metrics.csv` — 90 days × 5 cities, with a pricing-algo anomaly planted in London on day 60 |
| `src/detect.py` | Rolling-window z-score anomaly detection across every `(city, metric)` series |
| `src/diagnose.py` | Deterministic root-cause walk down the metric tree: GBV → Bookings → Conversion → Funnel stage → Leaf hypothesis |
| `src/summarize.py` | Mocked LLM rendering layer — turns the structured diagnosis into an exec-readable incident summary |
| `src/main.py` | Orchestrates all four stages end-to-end |

## The planted anomaly

On day 60 (April 2, 2026 in-simulation), London's nightly rate jumps
~15% while its competitor hotel index stays flat. Click-to-book conversion
collapses ~40%. Other cities are untouched. The pipeline should detect
this in the first scan after day 60 + baseline-warmup.

## Trade-offs I made on purpose

- **Rolling z-score, not Prophet / STL.** A rolling window captures a
  regime shift well, is easy to explain to a non-technical reader, and
  has no training step. For a 2-hour prototype on a 1-month anomaly, the
  added complexity of a proper forecasting model wouldn't change the
  answer.
- **Deterministic drill-down, not an LLM planner.** The diagnostic logic
  follows a fixed metric tree. In production I'd still keep it this way
  and reserve LLMs for the *summary* layer — the tree is an accounting
  identity, and you don't want a probabilistic model re-deriving arithmetic.
  That also makes the diagnosis testable.
- **Mocked LLM summarizer.** The brief asks for this. The summarizer takes
  a structured `Diagnosis` dataclass; swapping to a real Claude call is a
  two-line change (serialize the dataclass to JSON, pass in a fixed prompt).
- **Single-process, CSV in/out.** A real deployment would read from a
  warehouse (Snowflake/BigQuery) and emit to a queue. Keeping it to CSV
  makes the reviewer's setup zero-config.
- **5 cities, 90 days.** Enough to demonstrate segmentation and isolation
  logic; small enough that the CSV is readable by eye if you want to sanity-check.
- **No unit tests committed.** In a real engagement I'd add tests for
  `diagnose.run` with fixture rows; omitted here to stay inside the
  time budget. The pipeline is deterministic given the seed, so
  verification is: run it, inspect the summary.

## What I would build next (if this were week 2, not hour 4)

1. **Pluggable detector.** Swap z-score for STL + residual control chart
   for slow drift, keep the rolling window for step changes. Ensemble on
   agreement.
2. **Learned tree.** Today the metric tree is hand-coded. For a real
   marketplace you'd learn the graph from metric co-movement + schema
   (every ratio metric's numerator/denominator is a known child).
3. **Change-log as first-class input.** Pipe deploys, experiment
   activations, pricing-algo changes, and host-side policy changes into
   a shared event stream the diagnoser can correlate against. This is
   the single highest-leverage addition — it's what gets you from "the
   metric broke" to "this specific commit broke the metric."
4. **Real LLM at the summary layer** with the structured `Diagnosis`
   object as the sole input (no raw data) — keeps hallucination
   surface small.
5. **Alert budgeting.** A tree this dense fires too many alerts. Score
   by business impact × statistical strength × novelty, and only
   escalate the top-N per day.
