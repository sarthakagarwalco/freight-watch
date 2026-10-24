"""Context notes: loading, curated metadata, and applicability rules.

A note can only justify a flagged week when ALL of these hold:
  1. Route applies: note.applies_to == route, or "All Routes".
  2. Time applies:  the note's date window overlaps the flagged week (Mon-Sun).
  3. Content applies: the note actually describes a reason for costs RISING on
     that route. Notes that say costs were unaffected / normal / improved do
     NOT count -- this is the anti-hallucination gate.

The `causes_cost_increase` flag and date windows below were curated by a careful
human reading of each note (evidence quotes included). See README for the
reading of every note.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

ALL_ROUTES = "All Routes"


@dataclass(frozen=True)
class Note:
    note_id: str
    date: str            # single-date notes: the week containing this date applies
    applies_to: str      # route name like "Chennai-Bangalore", or "All Routes"
    text: str
    causes_cost_increase: bool
    window_start: str    # inclusive, YYYY-MM-DD
    window_end: str      # inclusive, YYYY-MM-DD
    short_summary: str   # grounded summary used verbatim in explanations
    evidence_quote: str  # exact phrase from the note supporting the verdict


# Curated metadata. Window for single-date notes = the week containing the date;
# N001 states an explicit range ("from Feb 24 to Mar 8"), used as-is.
NOTE_METADATA = {
    "N001": dict(
        causes_cost_increase=True,
        window_start="2025-02-24", window_end="2025-03-08",
        short_summary=("heavy flooding on the Chennai-Bangalore highway from Feb 24 "
                       "to Mar 8 forced longer detours and higher trip costs"),
        evidence_quote="forcing longer detours and higher trip costs",
    ),
    "N002": dict(
        causes_cost_increase=True,
        window_start="2025-01-20", window_end="2025-01-26",
        short_summary=("a regional festival week drove a temporary surcharge on the "
                       "Ahmedabad-Mumbai corridor due to high demand and limited truck availability"),
        evidence_quote="a temporary surcharge applied by transporters",
    ),
    "N003": dict(
        causes_cost_increase=True,
        window_start="2025-05-05", window_end="2025-05-11",
        short_summary=("diesel prices rose nationwide, pushing up transportation costs "
                       "across all routes by roughly 5-7%"),
        evidence_quote="pushing up transportation costs across all routes by roughly 5-7%",
    ),
    "N004": dict(
        causes_cost_increase=False,
        window_start="2024-03-11", window_end="2024-03-17",
        short_summary="a new toll plaza was commissioned, but the affected routes are not part of this dataset",
        evidence_quote="the affected routes are not part of this dataset",
    ),
    "N005": dict(
        causes_cost_increase=False,
        window_start="2024-07-29", window_end="2024-08-04",
        short_summary="scheduled highway maintenance caused minor delays; costs were not significantly affected",
        evidence_quote="costs were not significantly affected",
    ),
    "N006": dict(
        causes_cost_increase=False,
        window_start="2025-09-22", window_end="2025-09-28",
        short_summary="a logistics industry report noted stable demand with no major disruptions",
        evidence_quote="no major disruptions reported",
    ),
    "N007": dict(
        causes_cost_increase=False,
        window_start="2024-05-20", window_end="2024-05-26",
        short_summary="improved road conditions on the Delhi-Jaipur stretch after resurfacing (not a cost-rise reason)",
        evidence_quote="improved road conditions",
    ),
    "N008": dict(
        causes_cost_increase=False,
        window_start="2025-06-09", window_end="2025-06-15",
        short_summary="no significant disruptions on the Kolkata-Bhubaneswar corridor; freight movement remained normal",
        evidence_quote="No significant disruptions were reported",
    ),
    "N009": dict(
        causes_cost_increase=False,
        window_start="2025-03-17", window_end="2025-03-23",
        short_summary="the Chennai-Bangalore route returned to normal conditions after flood-related repairs",
        evidence_quote="returned to normal conditions",
    ),
    "N010": dict(
        causes_cost_increase=False,
        window_start="2025-10-27", window_end="2025-11-02",
        short_summary="a new vehicle tracking mandate was introduced; compliance costs were absorbed by transporters without a rate change",
        evidence_quote="absorbed by transporters without a rate change",
    ),
}


def load_notes(path: str) -> list[Note]:
    df = pd.read_csv(path, dtype=str).fillna("")
    notes = []
    for _, r in df.iterrows():
        meta = NOTE_METADATA[r["note_id"]]
        notes.append(Note(
            note_id=r["note_id"],
            date=r["date"],
            applies_to=r["applies_to"],
            text=r["note"],
            causes_cost_increase=meta["causes_cost_increase"],
            window_start=meta["window_start"],
            window_end=meta["window_end"],
            short_summary=meta["short_summary"],
            evidence_quote=meta["evidence_quote"],
        ))
    return notes


def note_applies_to_route(note: Note, route: str) -> bool:
    return note.applies_to == ALL_ROUTES or note.applies_to == route


def note_overlaps_week(note: Note, week_of: pd.Timestamp) -> bool:
    """week_of is the week's Monday; the week covers Mon-Sun."""
    week_start = week_of.normalize()
    week_end = week_start + pd.Timedelta(days=6)
    return not (
        pd.Timestamp(note.window_end) < week_start
        or pd.Timestamp(note.window_start) > week_end
    )


def note_justifies(note: Note, route: str, week_of: pd.Timestamp) -> bool:
    """Full acceptance test: right route, right time, and a cost-rise reason."""
    return (
        note_applies_to_route(note, route)
        and note_overlaps_week(note, week_of)
        and note.causes_cost_increase
    )
