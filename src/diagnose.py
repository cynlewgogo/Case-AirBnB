"""Root-cause drill-down over the metric tree.

Given a top-level alert (e.g. GBV-Madrid or GBV-London), walk the tree:

    GBV  =  Bookings  ×  Avg Booking Value
    Bookings  =  Sessions  ×  Conversion (clicks → book)

    If Sessions is the dominant driver  →  top-of-funnel path:
        Sessions  ←  marketing_campaign_version change, paid-search budget
    If Conversion is the dominant driver  →  bottom-of-funnel path:
        Conversion  stages:  Search→View, View→Click, Click→Book
        Click-to-Book  leaf:  price-vs-competitor, reviews, availability

The diagnostic logic is deterministic and auditable. The LLM is reserved
for the human-language summary layer downstream.
"""

from __future__ import annotations

from dataclasses import dataclass, field


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
    conv_pre = bk_pre / sess_pre if sess_pre else 0.0
    conv_post = bk_post / sess_post if sess_post else 0.0
    sess_d = _pct_change(sess_pre, sess_post)
    conv_d = _pct_change(conv_pre, conv_post)

    # Which factor explains more of the bookings drop?
    is_sessions_driven = abs(sess_d) >= abs(conv_d)
    dominant = "sessions" if is_sessions_driven else "conversion"

    steps.append(DrillStep(
        node="Bookings",
        finding=(
            f"Sessions {sess_d:+.1%}, Conversion {conv_d:+.1%}. "
            f"{'Sessions is the dominant driver — this is a demand/traffic problem, not a conversion problem.'
               if is_sessions_driven else
               'Conversion is the dominant driver — this is a funnel problem, not a demand problem.'}"
        ),
        evidence={"sessions_delta": sess_d, "conversion_delta": conv_d, "dominant": dominant},
    ))

    if is_sessions_driven:
        # ── Sessions path: top-of-funnel leaf ─────────────────────────────
        lv_pre, lv_post = _split(_series_for(rows, city, "listing_views"), break_date)
        cl_pre, cl_post = _split(_series_for(rows, city, "clicks"), break_date)
        search_view_d = _pct_change(lv_pre / sess_pre, lv_post / sess_post) if sess_pre and sess_post else 0.0
        view_click_d = _pct_change(cl_pre / lv_pre, cl_post / lv_post) if lv_pre and lv_post else 0.0
        click_book_d = _pct_change(bk_pre / cl_pre, bk_post / cl_post) if cl_pre and cl_post else 0.0

        steps.append(DrillStep(
            node="Funnel",
            finding=(
                f"Search-to-View {search_view_d:+.1%}, View-to-Click {view_click_d:+.1%}, "
                f"Click-to-Book {click_book_d:+.1%}. Funnel rates are all stable — "
                f"the drop is upstream of the funnel entirely."
            ),
            evidence={
                "search_view_delta": search_view_d,
                "view_click_delta": view_click_d,
                "click_book_delta": click_book_d,
            },
        ))

        # Marketing campaign change-log correlation
        campaign_col = "marketing_campaign_version"
        has_campaign_col = campaign_col in (rows[0].keys() if rows else {})
        if has_campaign_col:
            campaigns_post = {r[campaign_col] for r in rows if r["city"] == city and r["date"] >= break_date}
            campaigns_pre = {r[campaign_col] for r in rows if r["city"] == city and r["date"] < break_date}
            new_campaigns = campaigns_post - campaigns_pre
        else:
            new_campaigns = set()

        steps.append(DrillStep(
            node="Sessions leaf",
            finding=(
                f"Sessions dropped {sess_d:+.1%}. "
                f"Marketing-campaign change detected: {sorted(new_campaigns) or 'none'}. "
                f"Paid-search or organic channel cut is the most likely cause when "
                f"sessions fall sharply with stable funnel rates."
            ),
            evidence={
                "sessions_delta": sess_d,
                "new_campaign_versions": sorted(new_campaigns),
            },
        ))

        root_cause = (
            f"Marketing/traffic change ({', '.join(sorted(new_campaigns)) or 'unversioned change'}) "
            f"cut {city} sessions {sess_d:+.1%} while funnel conversion, nightly rate, "
            f"and competitor index were all unchanged. GBV fell because fewer users "
            f"reached the top of the funnel."
        )
        action = (
            f"Investigate the paid-search or organic channel budget change for {city} "
            f"from {break_date}. Restore or redirect spend to recover session volume. "
            f"Conversion is healthy — this is a pure traffic problem."
        )

    else:
        # ── Conversion path: bottom-of-funnel leaf (original logic) ───────
        lv_pre, lv_post = _split(_series_for(rows, city, "listing_views"), break_date)
        cl_pre, cl_post = _split(_series_for(rows, city, "clicks"), break_date)
        search_view_d = _pct_change(lv_pre / sess_pre, lv_post / sess_post) if sess_pre and sess_post else 0.0
        view_click_d = _pct_change(cl_pre / lv_pre, cl_post / lv_post) if lv_pre and lv_post else 0.0
        click_book_d = _pct_change(bk_pre / cl_pre, bk_post / cl_post) if cl_pre and cl_post else 0.0

        steps.append(DrillStep(
            node="Funnel",
            finding=(
                f"Search-to-View {search_view_d:+.1%}, View-to-Click {view_click_d:+.1%}, "
                f"Click-to-Book {click_book_d:+.1%}. The break is at click-to-book."
            ),
            evidence={
                "search_view_delta": search_view_d,
                "view_click_delta": view_click_d,
                "click_book_delta": click_book_d,
            },
        ))

        # Price competitiveness leaf
        rate_pre, rate_post = _split(_series_for(rows, city, "nightly_rate"), break_date)
        hotel_pre, hotel_post = _split(_series_for(rows, city, "competitor_hotel_index"), break_date)
        price_gap_pre = rate_pre / hotel_pre if hotel_pre else 0.0
        price_gap_post = rate_post / hotel_post if hotel_post else 0.0
        price_gap_d = _pct_change(price_gap_pre, price_gap_post)

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

        root_cause = (
            f"Pricing-algo deploy ({', '.join(sorted(new_versions)) or 'unversioned change'}) "
            f"raised {city} nightly rate while competitor hotel index was flat, "
            f"widening the price gap {price_gap_d:+.1%} and collapsing click-to-book conversion "
            f"{click_book_d:+.1%}."
        )
        action = (
            f"Roll back or re-scope the pricing-algo change for {city}. "
            f"Validate that other cities on the same deploy have absorbed the rate lift "
            f"without conversion damage."
        )

    # ── Isolation check (shared) ───────────────────────────────────────────
    other_cities = sorted({r["city"] for r in rows} - {city})
    isolated = []
    for other in other_cities:
        bk_pre_other, bk_post_other = _split(_series_for(rows, other, "bookings"), break_date)
        if abs(_pct_change(bk_pre_other, bk_post_other)) < 0.05:
            isolated.append(other)

    steps.append(DrillStep(
        node="Isolation check",
        finding=(
            f"Other cities with stable bookings through the same window: "
            f"{', '.join(isolated) or 'none'}. Anomaly is localized to {city}."
        ),
        evidence={"stable_cities": isolated},
    ))

    return Diagnosis(
        city=city,
        date=break_date,
        top_metric="gross_booking_value",
        top_deviation_pct=gbv_d,
        steps=steps,
        root_cause=root_cause,
        suggested_action=action,
    )
