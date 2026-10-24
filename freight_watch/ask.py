"""Stretch goal: plain-English Q&A over the assistant's own findings.

Deterministic by design: every answer is built from the generated output CSV
and the context notes -- templated, cited, never invented. If the data does
not contain an answer, it says so.

Usage:
    python3 -m freight_watch.ask "why did Mumbai-Pune get pricier in late 2025?"
    python3 -m freight_watch.ask            # interactive mode
"""

from __future__ import annotations

import argparse
import re
import sys

import pandas as pd

sys.path.insert(0, ".")
from freight_watch.notes import load_notes

ROUTES = [
    "Mumbai-Pune", "Delhi-Jaipur", "Chennai-Bangalore", "Kolkata-Bhubaneswar",
    "Ahmedabad-Mumbai", "Mumbai-Delhi", "Delhi-Chennai",
]
MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"])}


def _find_route(q: str) -> str | None:
    ql = q.lower().replace(" ", "")
    for r in ROUTES:
        if r.lower().replace("-", "") in ql or r.lower() in q.lower():
            return r
    return None


def _find_month(q: str) -> tuple[int, int] | None:
    ql = q.lower()
    m = re.search(r"(20\d\d)[-/](\d{1,2})", ql)
    if m:
        return int(m.group(1)), int(m.group(2))
    for name, num in MONTHS.items():
        if name in ql or name[:3] in ql:
            y = re.search(r"20\d\d", ql)
            return (int(y.group(0)) if y else 2025), num
    return None


def _fmt_row(r: pd.Series) -> str:
    base = (f"{r['route']} (week of {r['week_of']}): cost {r['cost_per_tonne_km']} "
            f"per tonne-km, {r['vs_own_history']}, {r['vs_similar_routes']}.")
    if r["flagged"] == "No (justified)":
        return base + f" Justified by note {r['matched_note_id']}: {r['reason']}"
    return base + f" Flagged unexplained: {r['reason']}"


def answer(question: str, out: pd.DataFrame, notes: list) -> str:
    q = question.lower()
    route = _find_route(question)
    month = _find_month(question)
    by_id = {n.note_id: n for n in notes}

    m = re.search(r"\bnote\s+(n\d{3})\b", q)
    if m:
        nid = m.group(1).upper()
        n = by_id.get(nid)
        if not n:
            return f"I don't have a note {nid} in context_notes.csv."
        used = out[out["matched_note_id"] == nid]
        use = (" It justified: " + "; ".join(f"{r['route']} week of {r['week_of']}"
               for _, r in used.iterrows()) + "." if len(used) else
               " It did not justify any flagged week.")
        return (f"Note {nid} ({n.date}, applies to {n.applies_to}): {n.text}{use}")

    if "unexplained" in q or ("flagged" in q and "justified" not in q):
        rows = out[out["flagged"] == "Yes"]
        if route:
            rows = rows[rows["route"] == route]
        if month:
            y, mth = month
            rows = rows[pd.to_datetime(rows["week_of"]).dt.strftime("%Y-%m") == f"{y}-{mth:02d}"]
        if len(rows) == 0:
            return "No unexplained flags match that description in my results."
        lines = [f"{len(rows)} unexplained flag(s):"]
        return "\n".join(lines + [f"- {_fmt_row(r)}" for _, r in rows.iterrows()])

    if "justif" in q:
        rows = out[out["flagged"] == "No (justified)"]
        if route:
            rows = rows[rows["route"] == route]
        if len(rows) == 0:
            return "Nothing was justified by a note for that filter."
        return "\n".join(["Justified flags:"] +
                         [f"- {_fmt_row(r)}" for _, r in rows.iterrows()])

    if route and ("why" in q or "pricier" in q or "expensive" in q or "cost" in q):
        rows = out[out["route"] == route]
        if month:
            y, mth = month
            rows = rows[pd.to_datetime(rows["week_of"]).dt.strftime("%Y-%m") == f"{y}-{mth:02d}"]
        if len(rows) == 0:
            scope = f" in {month[0]}-{month[1]:02d}" if month else ""
            return (f"{route}{scope}: I found no flagged cost rises there -- its weekly "
                    f"costs stayed within 20% of both its own history and similar routes.")
        return "\n".join([f"Here's what I found for {route}:"] +
                         [f"- {_fmt_row(r)}" for _, r in rows.iterrows()])

    if "summar" in q or "overview" in q:
        n_flag = (out["flagged"] == "Yes").sum()
        n_just = (out["flagged"] == "No (justified)").sum()
        return (f"Across 7 routes and 104 weeks each, I flagged {len(out)} route-weeks "
                f"with a cost rise of 20%+ vs their own history or vs similar routes. "
                f"Of those, {n_just} were justified by context notes "
                f"({', '.join(sorted(out[out['flagged'] == 'No (justified)']['matched_note_id'].unique()))}) "
                f"and {n_flag} remain unexplained and worth a human review.")

    return ("I can answer from my own results: ask why a route got pricier "
            "(e.g. 'why did Mumbai-Pune get pricier in December 2025?'), which "
            "flags are unexplained, which were justified, what a note says "
            "(e.g. 'what does note N001 say?'), or for a summary.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Ask the cost-watch assistant")
    parser.add_argument("question", nargs="?", help="question in plain English")
    parser.add_argument("--out", default="output/cost_watch_output.csv")
    parser.add_argument("--notes", default="data/context_notes.csv")
    args = parser.parse_args()

    out = pd.read_csv(args.out, keep_default_na=False)
    notes = load_notes(args.notes)

    if args.question:
        print(answer(args.question, out, notes))
        return
    print("Ask me about the findings (empty line quits).")
    while True:
        try:
            q = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not q:
            break
        print(answer(q, out, notes))
        print()


if __name__ == "__main__":
    main()
