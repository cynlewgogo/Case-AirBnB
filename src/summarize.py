"""Plain-English summary of a diagnosis.

The brief says: mock the AI analysis step. This is the mock. In production
this is where you'd swap in an actual LLM call (Claude, GPT-4) with the
diagnosis object serialized as structured JSON in the prompt. The value of
keeping it deterministic here is that the *pipeline* is the point — the LLM
is a rendering layer, not a reasoning layer. Reasoning lives in diagnose.py
where it's auditable.
"""

from __future__ import annotations

from diagnose import Diagnosis


def _pct(x: float) -> str:
    return f"{x:+.1%}"


def summarize(d: Diagnosis) -> str:
    ev = {s.node: s.evidence for s in d.steps}
    gbv = ev["GBV"]
    bk = ev["Bookings"]
    fn = ev["Funnel"]
    leaf = ev["Click-to-Book leaf"]
    iso = ev["Isolation check"]

    lines = [
        f"INCIDENT SUMMARY — {d.city} · {d.date}",
        "=" * 62,
        "",
        f"Headline: {d.city} Gross Booking Value is {_pct(d.top_deviation_pct)} "
        f"versus the prior 14-day baseline.",
        "",
        "What the system found, in order:",
        f"  1. GBV decomposes into Bookings ({_pct(gbv['bookings_delta'])}) "
        f"and Avg Booking Value ({_pct(gbv['abv_delta'])}). Bookings is doing the damage.",
        f"  2. Bookings split: Sessions {_pct(bk['sessions_delta'])} (essentially flat) "
        f"but Conversion {_pct(bk['conversion_delta'])}. Demand is fine; something is "
        f"stopping people from completing a booking.",
        f"  3. Funnel stages: Search-to-View {_pct(fn['search_view_delta'])}, "
        f"View-to-Click {_pct(fn['view_click_delta'])}, Click-to-Book {_pct(fn['click_book_delta'])}. "
        f"The break is specifically at click-to-book — users see the listing and walk away.",
        f"  4. Leaf check: price-vs-hotel gap widened {_pct(leaf['price_gap_delta'])} "
        f"(our rate {_pct(leaf['rate_delta'])}, hotel index {_pct(leaf['hotel_delta'])}). "
        f"New pricing-algo version(s) detected: {leaf['new_pricing_algo_versions'] or 'none'}.",
        f"  5. Isolation: other cities with stable bookings over the same window: "
        f"{', '.join(iso['stable_cities']) or 'none'}. The problem is local to {d.city}.",
        "",
        "Root cause:",
        f"  {d.root_cause}",
        "",
        "Suggested next step:",
        f"  {d.suggested_action}",
        "",
        "Confidence: high — localized to one city, aligns with a dated change-log event, "
        "external signal (hotel index) rules out a macro cause.",
    ]
    return "\n".join(lines)
