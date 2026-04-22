# Tilt — Founders Associate Take-Home
**Candidate deliverable · April 2026**

Repo contents:
- `PLAN.md` — how I budgeted the 4 hours
- `DELIVERABLE.md` — this document (Parts 1 & 2, gap analysis, AI notes)
- `README.md` — how to run Part 3
- `src/` — the working pipeline
- `dashboard/` — the live React analytics dashboard
- `AI_USAGE.md` — which tools I reached for and where I overrode them

Live dashboard: **[cynlewgogo.github.io/Case-AirBnB](https://cynlewgogo.github.io/Case-AirBnB/)**

---

## Part 1 — Structure the problem

### The metric tree

```
                        ┌──────────────────────────────┐
                        │   Daily Gross Booking Value  │  ← TOP-LEVEL VITAL
                        │          (GBV)               │
                        └──────────────┬───────────────┘
                                       │  =
                  ┌────────────────────┴─────────────────────┐
                  ▼                                          ▼
         ┌────────────────┐                         ┌────────────────────┐
         │   Bookings     │        ×                │ Avg Booking Value  │
         └────────┬───────┘                         └──────────┬─────────┘
                  │  =                                         │  =
         ┌────────┴────────┐                          ┌────────┴────────┐
         ▼                 ▼                          ▼                 ▼
   ┌──────────┐   ┌───────────────────┐        ┌──────────┐   ┌───────────────┐
   │ Sessions │ × │Booking Conversion │        │Nightly   │ × │Nights per     │
   │          │   │(search ► book)    │        │Rate      │   │Booking        │
   └────┬─────┘   └─────────┬─────────┘        └────┬─────┘   └───────────────┘
        │                   │                       │
   ┌────┴─────┐    ┌────────┴────────────┐    ┌─────┴──────────┐
   │ Channel  │    │ Funnel stages:      │    │ Host pricing   │
   │ mix      │    │  Search → View      │    │ Smart-pricing  │
   │ Marketing│    │  View  → Click      │    │ algorithm      │
   │ spend    │    │  Click → Book   ◄── CRITICAL STAGE        │
   │ Seasonal │    └─────────┬───────────┘    └─────┬──────────┘
   └──────────┘              │                      │
                      ┌──────┴───────┬──────────────┤
                      ▼              ▼              ▼
               ┌────────────┐ ┌──────────┐ ┌────────────────────┐
               │Price vs.   │ │Review /  │ │Availability /      │
               │competitors │ │rating    │ │cancellation policy │
               │(hotels,OTA)│ │drift     │ │                    │
               └────────────┘ └──────────┘ └────────────────────┘
                    ▲
                    │ external signal feed
         ┌──────────┴──────────┐
         │ Hotel rate index,   │
         │ OTA scrape, internal│
         │ pricing-algo deploys│
         └─────────────────────┘
```

**Every node is segmented by: city, device, user cohort (new/returning), listing type.** Segmentation is where the system earns its money — a 40% drop in one city is invisible in the global average.

### Why this shape

Three design principles:

1. **Identity decomposition, not correlation.** Every parent must equal (or cleanly compose from) its children — `GBV = Bookings × ABV`, `Bookings = Sessions × Conversion`. This means when a parent moves, the children *must* add up to explain it. No ambiguity, no "maybe it's this." The tree is an accounting identity, and accounting identities don't lie.

2. **Drill paths end at *actionable* leaves.** The leaves of the tree aren't metrics — they're *causes a human can act on*: a pricing-algorithm deploy, a hotel-rate shift, a review sentiment drift. The system isn't done when it finds the metric that broke; it's done when it finds the *lever* that broke it.

3. **External signals hang off leaves.** The London bug was invisible inside Airbnb's own funnel — conversion just "dropped." The cause was *outside*: competitor pricing didn't follow Airbnb up. The tree must ingest external signals (hotel rate indices, OTA scrapes) and internal change logs (pricing algo deploys, feature flags) at the leaf level, or the system will forever stop at "click-to-book conversion dropped" without knowing *why*.

The system "knows something is wrong" when any node deviates from its rolling forecast beyond threshold, weighted by business impact (a 5% drop in GBV-London matters more than a 5% drop in Sessions-Berlin). It "knows where to look next" by walking *down* the tree: at each level, whichever child explains the most of the parent's deviation is the next drill target. Repeat until a leaf with an external-signal correlation is found. That's the suspect.

---

## Part 2 — Diagnostic walkthrough: the London pricing bug

**Scenario: March 3, 2026. A pricing-algorithm change ships. By April 1, London GBV is 8% below forecast and no one knows why.** Here is exactly what the system does.

**Step 1 — Detection, March 5 (Day +2).** Overnight job computes actual-vs-forecast for every (metric, city, day). GBV-London's 2-day rolling deviation crosses the alert threshold at −6%. Alert fires. At this point a human dashboard shows *nothing notable* — global GBV is within normal noise because the drop is one city.

**Step 2 — Decompose the top node.** `GBV = Bookings × ABV`. System computes each child's contribution to the parent deviation. Bookings-London: −11%. ABV-London: +3% (nightly rate is *up* — a clue, not a cause yet). Bookings is the culprit child; drill.

**Step 3 — Decompose Bookings.** `Bookings = Sessions × Conversion`. Sessions-London: −1% (within noise). Conversion-London: **−10% and widening daily**. Sessions being flat is load-bearing evidence — this is not a demand problem, it's a conversion problem.

**Step 4 — Decompose Conversion (the funnel).** The system breaks the end-to-end rate into stages:
- Search → View: flat
- View → Click: flat
- **Click → Book: −38%**, and it started exactly on March 3.

The break is at the bottom of the funnel. People are clicking listings and *not* booking them. They see something they don't like *on the listing page*.

**Step 5 — Generate hypotheses at the leaf level.** Click-to-book drops have three usual suspects: price, trust (reviews/rating), and friction (availability, cancellation). The system checks each:
- **Reviews**: London rating distribution unchanged. Eliminated.
- **Availability / cancellation policy**: no host-side changes correlated with March 3. Eliminated.
- **Price competitiveness**: Airbnb London median nightly rate rose 14.7% starting March 3; the external hotel-rate index rose 0.4%. **Price-vs-competitor gap widened by ~14% on exactly the break date.** Strong match.

**Step 6 — Confirm with change-log correlation.** The system cross-references its internal deploy log (every pricing-algorithm change is tagged with date + city scope). On March 3, a pricing-algo update is tagged `scope=EU-metro, cities=[LON, PAR, AMS]`. But Paris and Amsterdam conversion are flat. Why? Because in those cities the change didn't push Airbnb above local hotel rates — the hotel baseline in London was uniquely low. The system flags this nuance.

**Step 7 — Confidence check via isolation.** The system confirms the anomaly is London-specific: same funnel in NYC, Tokyo, Berlin is normal. This rules out global causes (a platform bug, a macro demand shift). Localization + date match + external-signal correlation = high confidence.

**Step 8 — Output.** A plain-English summary hits the CEO's inbox on March 5, not April 1:

> **London GBV is tracking 6% below forecast (widening). Root cause: pricing-algorithm change deployed March 3 (`PRICE_ALGO_V12`, scope EU-metro) pushed London median nightly rate +14.7% while the local hotel-rate index moved +0.4%. Click-to-book conversion has dropped 38% and is the sole driver; sessions, reviews, and availability are unchanged. Paris and Amsterdam received the same deploy but are unaffected because their hotel baselines absorbed the rate lift. Suggested next step: roll back or re-scope `PRICE_ALGO_V12` for London only.**

**Why it beat the humans.** The humans were looking at the wrong altitude. Global dashboards didn't show it; daily standups talked about aggregate KPIs. The city/funnel/external-signal cut that identified the bug requires *someone* to slice the cube that specific way — and until you have a hypothesis, you don't know which slice to look at. The system doesn't need a hypothesis; it tries every slice, every night.

---

## Why daily dashboards missed it — and how this system closes each gap

The London pricing bug went undetected for nearly a month despite daily standups and standard dashboards. That delay is not a staffing problem or an effort problem — it is an architecture problem. Ten structural blind spots let it hide, and each one has a direct countermeasure in this design.

### 1. The top-line metric was too aggregated

**Why it failed:** Daily Gross Booking Value is a global rollup. London is one market within a large portfolio; a 31% drop in one city dilutes to roughly 8% globally, which sits within normal weekly noise. The alert condition — "the number looks soft this week" — was never met at the level humans were watching.

**How this system closes it:** Every `(city, metric)` pair is monitored independently with its own rolling baseline. The system doesn't wait for the global rollup to move; it fires the moment London's own series crosses 2.5σ below its own baseline. The drill-down starts at the city level, not the global level.

### 2. Humans tend to investigate the obvious buckets first

**Why it failed:** The natural investigation order is: traffic, supply, outages, marketing spend, app bugs, seasonality, then macro demand. Pricing competitiveness versus hotels is an indirect, external signal that sits several rungs below the obvious candidates. A team working from intuition will exhaustion-search the wrong buckets for weeks before reaching it.

**How this system closes it:** The metric tree has pricing competitiveness (nightly rate ÷ hotel index) as an explicitly wired leaf node. When click-to-book conversion is the break point, the system doesn't guess — it checks all three leaf hypotheses (price, trust, availability) in parallel, in every run. The external hotel-rate index is ingested as a first-class signal, not an afterthought.

### 3. Conversion is a lagging outcome, not the root signal

**Why it failed:** Booking conversion is the end result of a decision already made upstream. By the time conversion visibly drops, Airbnb's price had already been uncompetitive for days. The teams monitoring conversion were watching the wound, not the cause. The earlier signal — the price gap opening on April 2 — was not monitored at all.

**How this system closes it:** The price competitiveness ratio (Airbnb rate ÷ hotel index) is monitored as its own time series, upstream of conversion. A deterioration in competitiveness triggers its own alert before conversion has time to decay. The system catches the cause before the lagging outcome confirms it.

### 4. Dashboards are descriptive, not diagnostic

**Why it failed:** A standard dashboard answers: "sessions down? conversion down? GBV down?" It does not answer: "which change on which date caused the most plausible path to this outcome?" That requires a causal model, not a scoreboard. Without causal drill-down logic, each question produces a new set of charts and a new manual investigation.

**How this system closes it:** The diagnostic layer is deterministic. At each node in the metric tree the system attributes the parent's deviation to its children and drills into the dominant child. It stops when it reaches a leaf with an external-signal match (price gap) or a change-log match (PRICE_ALGO_V12). The output is not a chart; it is a plain-English causal chain with confidence evidence at every step.

### 5. No metric tree or dependency map

**Why it failed:** Without a structured decomposition like `GBV = Bookings × ABV`, `Bookings = Sessions × Conversion`, `Conversion = Competitiveness × Trust × Friction`, teams chase symptoms instead of narrowing to the correct branch. "GBV is down" triggers parallel investigations into marketing, supply, product, and ops — all running independently, none knowing which branch to prioritise.

**How this system closes it:** The metric tree is the core architecture of Part 1. Every relationship is an accounting identity (a parent always equals the product or sum of its children), which means the tree is both correct and exhaustive. Deviation attribution is arithmetic, not opinion — the dominant child is always the right next step.

### 6. No automatic anomaly segmentation

**Why it failed:** The issue was market-specific: London only. But standard monitoring runs on default rollups. Teams examining global or regional aggregates never see the London-specific pattern. Without automated slicing by city, device, check-in window, user segment, and listing category, a market-specific signal stays invisible until it is large enough to move the global number.

**How this system closes it:** The scan runs on every `(city, metric)` pair independently, every night. There is no aggregation step that could obscure a localised signal. The isolation step explicitly confirms that other cities with the same deploy are unaffected — turning a suggestive correlation into a high-confidence localisation.

### 7. Algorithm changes were not linked to business metrics

**Why it failed:** Pricing model releases live in engineering's deployment pipeline; business metrics live in the analytics stack. These two systems rarely talk to each other. Nobody asks "what changed in London just before the drop?" because the change log and the metric chart are not in the same tool, and nobody owns the join between them.

**How this system closes it:** The change-log correlation is a first-class step in the diagnosis. The diagnose module ingests `pricing_algo_version` as a column alongside every metric row. When a new version appears in the post-break window and not the pre-break window, the system surfaces it as a deployment candidate with the exact deployment date. In production this extends to experiment activations, feature flags, and host-policy changes.

### 8. Internal price was monitored, not external competitiveness

**Why it failed:** The pricing team monitors Airbnb ADR, take rate, and booking value. These are internal metrics. The real issue was not that Airbnb's price changed — it was that Airbnb became *less competitive relative to hotels*. If the hotel-rate index is not in the monitoring system, the insight "competitor prices didn't follow Airbnb up" is structurally invisible.

**How this system closes it:** The `competitor_hotel_index` is a required column in the data schema. The diagnostic step explicitly computes `price_gap = airbnb_rate / hotel_index` both pre and post the break date. A widening gap is flagged regardless of whether Airbnb's absolute rate changed — the competitiveness ratio is what matters, and that ratio is tracked directly.

### 9. Signal-to-noise problem

**Why it failed:** Marketplace metrics are noisy every day — weekends, holidays, events, weather, seasonality, marketing shifts. A slow-burn deterioration can look like normal variance for weeks. Without a proper statistical baseline that accounts for this noise structure, human reviewers will misattribute a genuine regime shift to "the usual week-to-week jitter" and move on.

**How this system closes it:** The rolling z-score detector uses a 21-day trailing window to form a local baseline, capturing recent seasonality and noise level. The threshold (2.5σ) is calibrated to distinguish regime shifts from normal variance. The severity score (`|z| × |pct_deviation|`) weights both statistical strength and business magnitude, so a strong signal on a small metric does not crowd out a moderate signal on a critical metric.

### 10. Ownership fragmentation

**Why it failed:** Growth sees conversion; Pricing sees listing economics; Market Ops sees city performance; Finance sees GBV miss. Each team sees a different part of the same elephant. None of them owns the cross-functional diagnostic question: "what single change in which system caused the cross-cutting symptom we're all seeing?" In the absence of a shared diagnostic tool, each team's analysis reinforces their own domain's frame and the root cause is never assembled.

**How this system closes it:** The diagnostic pipeline is a shared, automated layer that sits above all team boundaries. It outputs a structured `Diagnosis` object — city, deployment, funnel break stage, confidence — that any team can act on. It is not a Growth tool or a Pricing tool; it is a single source of truth for "what broke and why," independent of organisational boundaries. The output is designed for the exec who needs the summary, not the analyst who built the tool.

---

**The core reason in one line.** Standard dashboards describe *what* happened; this system determines *why* it happened, *where* in the tree it started, and *which dated event* caused it — automatically, every night, across every market.

---

## Part 3 — The working prototype

See [README.md](README.md) for run instructions. The script:

1. Generates 90 days × 5 cities of synthetic marketplace data with a planted anomaly in London (pricing-algo deploy on day 60 → conversion collapse).
2. Runs anomaly detection (rolling-window deviation) across the metric tree.
3. Walks the tree top-down to localize the cause.
4. Emits a plain-English incident report via a mocked LLM step.

Single command: `python src/main.py`.

---

## AI usage notes

See [AI_USAGE.md](AI_USAGE.md) for the blow-by-blow of which tools I used, where they were wrong, and where I overrode the output.
