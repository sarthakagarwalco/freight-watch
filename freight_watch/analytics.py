"""Core analytics: weekly cost-per-tonne-km, comparison baselines, flag rule.

All definitions follow the case-study brief exactly:
  * route      = origin + "-" + destination, grouped with the given route_type
  * week_of    = Monday of the shipment's week (weeks run Monday-Sunday)
  * cost_per_tonne_km = total weekly freight cost / total weekly tonne-km
  * vs_own_history    = trailing 8-week rolling average of strictly prior weeks
                        (fewer than 8 prior weeks -> use all available, no padding)
  * vs_similar_routes = same-week average across other routes of the same
                        route_type, excluding the route itself
  * flag rule  = cost is RISING and out of the ordinary:
                 vs_own_history >= 20% OR vs_similar_routes >= 20%
"""

from __future__ import annotations

import pandas as pd

HISTORY_WINDOW_WEEKS = 8
FLAG_THRESHOLD = 0.20  # 20% rise on either baseline


def load_shipments(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["shipment_date"])
    df["route"] = df["origin"] + "-" + df["destination"]
    # Monday of the shipment's week
    df["week_of"] = (
        df["shipment_date"] - pd.to_timedelta(df["shipment_date"].dt.weekday, unit="D")
    ).dt.normalize()
    df["tonne_km"] = df["quantity_tonnes"] * df["distance_km"]
    return df


def weekly_costs(df: pd.DataFrame) -> pd.DataFrame:
    """One row per (route, route_type, week) with cost per tonne-km."""
    w = (
        df.groupby(["route", "route_type", "week_of"], as_index=False)
        .agg(cost=("freight_cost_inr", "sum"), tkm=("tonne_km", "sum"))
    )
    w["cost_per_tonne_km"] = w["cost"] / w["tkm"]
    return w.sort_values(["route", "week_of"]).reset_index(drop=True)


def add_baselines(w: pd.DataFrame) -> pd.DataFrame:
    """Attach the two graded comparison baselines (fractional, e.g. 0.355 = +35.5%)."""
    w = w.copy()

    # vs own history: trailing 8-week mean of strictly prior weeks (shift(1)).
    # min_periods=1 -> early weeks use whatever history exists; never padded.
    w["own_history_avg"] = w.groupby("route")["cost_per_tonne_km"].transform(
        lambda s: s.shift(1).rolling(HISTORY_WINDOW_WEEKS, min_periods=1).mean()
    )

    # vs similar routes: same-week mean over *other* routes of the same route_type.
    grp = w.groupby(["route_type", "week_of"])["cost_per_tonne_km"].agg(["sum", "count"])
    w = w.merge(grp, left_on=["route_type", "week_of"], right_index=True)
    w["peer_avg"] = (w["sum"] - w["cost_per_tonne_km"]) / (w["count"] - 1)
    w = w.drop(columns=["sum", "count"])

    w["vs_own_history"] = w["cost_per_tonne_km"] / w["own_history_avg"] - 1
    w["vs_similar_routes"] = w["cost_per_tonne_km"] / w["peer_avg"] - 1
    return w


def flag_rising_costs(w: pd.DataFrame, threshold: float = FLAG_THRESHOLD) -> pd.DataFrame:
    """Route-weeks where cost is rising and out of the ordinary on either baseline."""
    flagged = w[
        (w["vs_own_history"] >= threshold) | (w["vs_similar_routes"] >= threshold)
    ].copy()
    return flagged.sort_values(["week_of", "route"]).reset_index(drop=True)
