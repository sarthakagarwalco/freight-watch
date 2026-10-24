"""End-to-end pipeline: shipments + notes -> output CSV in the graded format."""

from __future__ import annotations

import argparse

import pandas as pd

from .analytics import add_baselines, flag_rising_costs, load_shipments, weekly_costs
from .notes import load_notes
from .retrieval import NoteVectorStore
from .verdict import adjudicate


def _pct(value: float, suffix: str) -> str:
    return f"{value * 100:+.1f}% {suffix}"


def run(shipments_path: str, notes_path: str) -> pd.DataFrame:
    df = load_shipments(shipments_path)
    weekly = add_baselines(weekly_costs(df))
    flagged = flag_rising_costs(weekly)

    notes = load_notes(notes_path)
    store = NoteVectorStore(notes)

    rows = []
    for _, r in flagged.iterrows():
        verdict = adjudicate(r["route"], r["week_of"], store, notes)
        rows.append({
            "route": r["route"],
            "week_of": r["week_of"].strftime("%Y-%m-%d"),
            "cost_per_tonne_km": f"{r['cost_per_tonne_km']:.2f}",
            "vs_own_history": _pct(r["vs_own_history"], "vs this route's past average"),
            "vs_similar_routes": _pct(r["vs_similar_routes"], "vs similar-length routes this week"),
            "flagged": verdict.flagged,
            "matched_note_id": verdict.matched_note_id,
            "reason": verdict.reason,
        })
    return pd.DataFrame(rows, columns=[
        "route", "week_of", "cost_per_tonne_km", "vs_own_history",
        "vs_similar_routes", "flagged", "matched_note_id", "reason",
    ])


def main() -> None:
    parser = argparse.ArgumentParser(description="FreightTiger cost-watch assistant")
    parser.add_argument("--shipments", default="data/shipment_records.csv")
    parser.add_argument("--notes", default="data/context_notes.csv")
    parser.add_argument("--out", default="output/cost_watch_output.csv")
    args = parser.parse_args()

    result = run(args.shipments, args.notes)
    result.to_csv(args.out, index=False)
    justified = (result["flagged"] == "No (justified)").sum()
    print(f"Wrote {len(result)} rows to {args.out} "
          f"({justified} justified, {len(result) - justified} flagged unexplained)")


if __name__ == "__main__":
    main()
