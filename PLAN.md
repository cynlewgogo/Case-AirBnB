# Plan — Tilt Founders Associate Take-Home

## The task in one sentence
Design and prototype an AI system that would catch a London booking-conversion collapse a month before a human does — and explain *why* in plain English.

## How I'm splitting the 4 hours

| Block | Time | Output |
|---|---|---|
| Structure the problem (Part 1) | 60 min | Metric tree diagram + short rationale |
| Diagnostic walkthrough (Part 2) | 60 min | One-page trace of how the system finds the pricing bug |
| Build the pipeline (Part 3) | 120 min | Python repo: synthetic data → detect → diagnose → summarize |
| Wrap + AI usage notes | interleaved | `DELIVERABLE.md`, `README.md`, `AI_USAGE.md` |

## Architecture at a glance (what Part 3 will literally do)

```
 generate_data.py  ──►  data/marketplace_metrics.csv
                              │
                              ▼
 detect.py  ── flags anomalies per (city, metric, day) using rolling baseline
                              │
                              ▼
 diagnose.py  ── walks the metric tree top-down, narrowing from GBV ► bookings
                ► conversion ► click-to-book ► pricing-vs-competitor
                              │
                              ▼
 summarize.py  ── (mocked LLM) emits a plain-English incident summary
                              │
                              ▼
 main.py   ── prints the final report
```

## The non-tech analogy I'll lean on
A hospital triage nurse. Vitals (heart rate, BP, oxygen) are the marketplace's top-line metrics. When one vital drifts, the nurse doesn't shout "patient is sick" — they drill into the subsystem (cardiac, respiratory) and then to the specific cause (low potassium, a medication interaction). Our system is an always-awake triage nurse for Airbnb: it watches every vital, drills on the abnormal one, and hands the doctor (the exec) a one-line diagnosis instead of a pile of dashboards.

## Trade-offs I'll accept up front
- **Rolling-window z-score** over a fancy time-series model (Prophet, STL) — faster to ship, easier to explain, good enough for a 1-month regime shift.
- **Rule-based drill-down** in `diagnose.py` over a true LLM planner — deterministic, auditable, and the "AI step" is genuinely the summarization layer where natural language earns its keep.
- **Synthetic data, 5 cities × 90 days** — enough to demonstrate segmentation without burying the reader.
- **Mocked LLM summarizer** — the brief says mock the AI step; what matters is the pipeline shape.

## Done criteria
- `python src/main.py` runs cold, generates data, and prints an incident report that names London, names pricing as the cause, and names the approximate date.
- Deliverable doc reads cleanly for a non-technical reader and is specific enough for a technical one.
