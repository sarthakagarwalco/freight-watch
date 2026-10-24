"""Verdict engine: turn a flagged route-week into a cited, grounded verdict.

Pipeline per flagged (route, week):
  1. Retrieve the top-k candidate notes with the vector store.
  2. Walk the ranked list; the first note passing notes.note_justifies
     (right route + right time window + describes a cost rise) justifies
     the flag -> "No (justified)" with matched_note_id set.
  3. If none passes, the flag stands -> "Yes". The reason names the closest
     retrieved note and the exact reason it does not count, so a human can
     audit the decision. No supporting note -> never guess.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from .notes import Note, note_applies_to_route, note_overlaps_week, note_justifies
from .retrieval import NoteVectorStore, RetrievalHit


@dataclass
class Verdict:
    flagged: str            # "Yes" or "No (justified)"
    matched_note_id: str    # note id, or "" when unexplained
    reason: str
    retrieval: list[RetrievalHit]  # ranked candidates, for audit/eval


def _rejection_detail(note: Note, route: str, week_of: pd.Timestamp) -> str:
    """Explain precisely why a note cannot justify this flag.

    A note that does not describe a cost rise is disqualified on substance
    (no time window could make it count); a genuine cost-rise note is
    disqualified only by route or time.
    """
    if not note_applies_to_route(note, route):
        return (
            f"applies to {note.applies_to}, not to {route} -- "
            "wrong route, so it cannot explain this rise"
        )
    if not note.causes_cost_increase:
        return (
            f'says "{note.evidence_quote}" -- it does not describe a reason for '
            "a cost rise on this route"
        )
    week_start = week_of.normalize()
    week_end = week_start + pd.Timedelta(days=6)
    if pd.Timestamp(note.window_end) < week_start:
        return (
            f"covers {note.window_start} to {note.window_end}, which ended before "
            f"the flagged week of {week_of.date()} -- wrong time window"
        )
    return (
        f"covers {note.window_start} to {note.window_end}, which starts after "
        f"the flagged week of {week_of.date()} -- wrong time window"
    )


# A route-matching note is only worth naming if it is temporally near the
# flagged week; otherwise the honest message is that nothing relevant exists.
CLOSE_NOTE_DAYS = 90


def _closest_route_note(
    notes: list[Note], route: str, week_of: pd.Timestamp
) -> tuple[Note | None, int]:
    """Closest route-matching note by date proximity; returns (note, days_away)."""
    best: Note | None = None
    best_days = None
    for note in notes:
        if not note_applies_to_route(note, route):
            continue
        days = abs((pd.Timestamp(note.date).normalize() - week_of.normalize()).days)
        if best is None or days < best_days or (days == best_days and note.note_id < best.note_id):
            best, best_days = note, days
    return best, best_days if best_days is not None else -1


def adjudicate(
    route: str,
    week_of: pd.Timestamp,
    store: NoteVectorStore,
    notes: list[Note],
    top_k: int | None = None,
) -> Verdict:
    week_of = pd.Timestamp(week_of).normalize()
    # Rank every note; walk the full ranked list for acceptance so an applicable
    # note can never be missed because it fell outside an arbitrary top-k.
    hits = store.query(
        NoteVectorStore.retrieval_query(route, week_of),
        top_k=top_k or len(notes),
    )

    for hit in hits:
        note = hit.note
        if note_justifies(note, route, week_of):
            reason = (
                f"Matches note {note.note_id} dated {note.date}: {note.short_summary}. "
                "The cost rise has a clear explanation."
            )
            return Verdict(
                flagged="No (justified)",
                matched_note_id=note.note_id,
                reason=reason,
                retrieval=hits,
            )

    # No note justifies the rise. Name the closest route-matching note and the
    # exact reason it does not count, so the decision is auditable. If nothing
    # is even temporally near, say so plainly instead of reaching.
    closest, days_away = _closest_route_note(notes, route, week_of)
    if closest is None or days_away > CLOSE_NOTE_DAYS:
        reason = ("No matching note found for this route or date range. "
                  "Cost rise looks unexplained and worth a human review.")
    else:
        detail = _rejection_detail(closest, route, week_of)
        reason = (
            f"The closest note ({closest.note_id}, {closest.date}) {detail}. "
            "No genuine justification found; flagged for review."
        )
    return Verdict(flagged="Yes", matched_note_id="", reason=reason, retrieval=hits)
