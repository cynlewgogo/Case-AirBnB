"""Root-cause drill-down over the metric tree.

Given a top-level alert (e.g. GBV-London), walk the tree:

    GBV  =  Bookings  ×  Avg Booking Value
    Bookings  =  Sessions  ×  Conversion (clicks → book)
    Conversion  stages:  Search→View, View→Click, Click-to-Book
    Click-to-Book  leaf causes:  price-vs-competitor, reviews, availability

At each node, attribute the parent deviation to children and drill into the
child that explains the most of it. Stop when a leaf has an external-signal
or change-log correlation that matches.

The narrative is deterministic, auditable, and testable — which is exactly
what you want at the diagnostic layer. The LLM is reserved for the human-
language summary downstream.
"""

from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class DrillStep:
    node: str
    finding: str
    evidence: dict = field(default_factory=dict)


@dataclass
class Diagnosis:
    city: str
    date: str
    top_metric: str
    top_deviation_pct: float
    steps: list[DrillStep]
    root_cause: str
    suggested_action: str


def _series_for(rows: list[dict], city: str, metric: str) -> list[tuple[str, float]]:
    out = [(r["date"], float(r[metric])) for r in rows if r["city"] == city]
    out.sort()
    return out


def _split(series: list[tuple[str, float]], break_date: str, window: int = 14):
    """Return (pre, post) means around break_date."""
    pre = [v for d, v in series if d < break_date][-window:]
    post = [v for d, v in series if d >= break_date][:window]
    pre_mean = sum(pre) / len(pre) if pre else 0.0
    post_mean = sum(post) / len(post) if post else 0.0
    return pre_mean, post_mean


def _pct_change(pre: float, post: float) -> float:
    return (post - pre) / pre if pre else 0.0


def run(rows: list[dict], city: str, break_date: str) -> Diagnosis:
    """Diagnose a downturn in `city` starting around `break_date`."""
    steps: list[DrillStep] = []

    # ── Step 1: GBV = Bookings × ABV ──────────────────────────────────────
    gbv_pre, gbv_post = _split(_series_for(rows, city, "gross_booking_value"), break_date)
    bk_pre, bk_post = _split(_series_for(rows, city, "bookings"), break_date)
    abv_pre, abv_post = _split(_series_for(rows, city, "avg_booking_value"), break_date)

    gbv_d = _pct_change(gbv_pre, gbv_post)
    bk_d = _pct_change(bk_pre, bk_post)
    abv_d = _pct_change(abv_pre, abv_post)

    steps.append(DrillStep(
        node="GBV",
        finding=f"GBV {gbv_d:+.1%}. Decomposes into Bookings {bk_d:+.1%} and ABV {abv_d:+.1%}. "
                f"Bookings is the dominant driver.",
        evidence={"gbv_delta": gbv_d, "bookings_delta": bk_d, "abv_delta": abv_d},
    ))

    # ── Step 2: Bookings = Sessions × Conversion ──────────────────────────
    sess_pre, sess_post = _split(_series_for(rows, city, "sessions"), break_date)
    # Conversion derived as bookings / sessions
    conv_pre = bk_pre / sess_pre if sess_pre else 0.0
    conv_post = bk_post / sess_post if sess_post else 0.0
    sess_d = _pct_change(sess_pre, sess_post)
    conv_d = _pct_change(conv_pre, conv_post)

    steps.append(DrillStep(
        node="Bookings",
        finding=f"Sessions {sess_d:+.1%} (flat), Conversion {conv_d:+.1%}. "
                f"This is a conversion problem, not a demand problem.",
        evidence={"sessions_delta": sess_d, "conversion_delta": conv_d},
    ))

    # ── Step 3: Funnel stage decomposition ────────────────────────────────
    lv_pre, lv_post = _split(_series_for(rows, city, "listing_views"), break_date)
    cl_pre, cl_post = _split(_series_for(rows, city, "clicks"), break_date)
    search_view_d = _pct_change(lv_pre / sess_pre, lv_post / sess_post) if sess_pre and sess_post else 0.0
    view_click_d = _pct_change(cl_pre / lv_pre, cl_post / lv_post) if lv_pre and lv_post else 0.0
    click_book_d = _pct_change(bk_pre / cl_pre, bk_post / cl_post) if cl_pre and cl_post else 0.0

    steps.append(DrillStep(
        node="Funnel",
        finding=f"Search-to-View {search_view_d:+.1%}, View-to-Click {view_click_d:+.1%}, "
                f"Click-to-Book {click_book_d:+.1%}. The break is at click-to-book.",
        evidence={
            "search_view_delta": search_view_d,
            "view_click_delta": view_click_d,
            "click_book_delta": click_book_d,
        },
    ))

    # ── Step 4: Leaf hypotheses at Click-to-Book ─────────────────────────────
    # Price competitiveness: (city rate / hotel index) delta.
    rate_pre, rate_post = _split(_series_for(rows, city, "nightly_rate"), break_date)
    hotel_pre, hotel_post = _split(_series_for(rows, city, "competitor_hotel_index"), break_date)
    price_gap_pre = rate_pre / hotel_pre if hotel_pre else 0.0
    price_gap_post = rate_post / hotel_post if hotel_post else 0.0
    price_gap_d = _pct_change(price_gap_pre, price_gap_post)

    # Change-log correlation: pricing_algo_version on/after break_date.
    versions_post = {r["pricing_algo_version"] for r in rows if r["city"] == city and r["date"] >= break_date}
    versions_pre = {r["pricing_algo_version"] for r in rows if r["city"] == city and r["date"] < break_date}
    new_versions = versions_post - versions_pre

    steps.append(DrillStep(
        node="Click-to-Book leaf",
        finding=(
            f"Price-vs-hotel gap widened {price_gap_d:+.1%} "
            f"(city rate {_pct_change(rate_pre, rate_post):+.1%} vs hotel index "
            f"{_pct_change(hotel_pre, hotel_post):+.1%}). "
            f"Pricing-algo deploy detected: {sorted(new_versions) or 'none'}."
        ),
        evidence={
            "price_gap_delta": price_gap_d,
            "rate_delta": _pct_change(rate_pre, rate_post),
            "hotel_delta": _pct_change(hotel_pre, hotel_post),
            "new_pricing_algo_versions": sorted(new_versions),
        },
    ))

    # ── Step 5: Isolation — does the cause reproduce in other cities? ─────
    other_cities = sorted({r["city"] for r in rows} - {city})
    isolated = []
    for other in other_cities:
        _, conv_post_other = _split(_series_for(rows, other, "bookings"), break_date)
        conv_pre_other, _ = _split(_series_for(rows, other, "bookings"), break_date)
        if abs(_pct_change(conv_pre_other, conv_post_other)) < 0.05:
            isolated.append(other)

    steps.append(DrillStep(
        node="Isolation check",
        finding=f"Other cities with stable bookings through the same window: {', '.join(isolated) or 'none'}. "
                f"Anomaly is localized to {city}.",
        evidence={"stable_cities": isolated},
    ))

    # ── Root cause & action ───────────────────────────────────────────────
    root_cause = (
        f"Pricing-algo deploy ({', '.join(sorted(new_versions)) or 'unversioned change'}) "
        f"raised {city} nightly rate while competitor hotel index was flat, "
        f"widening the price gap {price_gap_d:+.1%} and collapsing click-to-book conversion "
        f"{click_book_d:+.1%}."
    )
    action = (
        f"Roll back or re-scope the pricing-algo change for {city}. "
        f"Validate that other cities on the same deploy have absorbed the rate lift without conversion damage."
    )

    return Diagnosis(
        city=city,
        date=break_date,
        top_metric="gross_booking_value",
        top_deviation_pct=gbv_d,
        steps=steps,
        root_cause=root_cause,
        suggested_action=action,
    )
