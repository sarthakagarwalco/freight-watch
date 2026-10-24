# Freight Watch — a smart assistant that watches shipping costs

Built for the FreightTiger Software Engineering Intern (AI) case study.
It groups 2,940 shipment records into route-weeks, tracks cost per tonne-km,
flags weeks where cost is rising out of the ordinary, and — before flagging —
checks a set of context notes (fuel, tolls, weather, festivals) to see whether
the rise has a genuine explanation. Every verdict cites its evidence; nothing
is guessed.

**Headline result:** 20 route-weeks flagged (≥20% rise vs own history or vs
similar routes) → 3 justified by notes (N001 ×2, N002 ×1), 17 unexplained and
worth a human review. Eval harness: 13/13 checks pass. Three runs:
byte-identical. LLM cost: ₹0.

## Quickstart

```bash
pip install -r requirements.txt          # pandas, numpy only
python3 -m freight_watch.pipeline        # -> output/cost_watch_output.csv
python3 eval/run_eval.py                  # 13-check eval harness
python3 -m freight_watch.ask "why did Mumbai-Pune get pricier in December 2025?"
```

## How it works

```
shipment_records.csv ──► analytics.py ──► weekly cost/tonne-km + baselines ──► flag rule ──► 20 candidates
context_notes.csv    ──► notes.py     ──► curated note metadata (route, window, cost-rise?)
                                        ──► retrieval.py (vector store: rank candidates)
                                        ──► verdict.py (deterministic gate + cited reasons)
                                                                              ──► output CSV
```

**`analytics.py`** — core numbers, exactly per the brief:
- Route = `origin-destination`, grouped with the given `route_type` (Short/Medium/Long).
- `week_of` = Monday of the shipment's week (Mon–Sun).
- `cost_per_tonne_km` = Σ freight_cost / Σ (quantity_tonnes × distance_km), per week.
- `vs_own_history` = trailing 8-week rolling mean of *strictly prior* weeks
  (`shift(1)`; `min_periods=1`, so early weeks use whatever history exists —
  never padded, never extrapolated).
- `vs_similar_routes` = same-week mean across *other* routes of the same
  `route_type` (the route itself is excluded).
- **Flag rule:** cost is *rising* and out of the ordinary —
  `vs_own_history ≥ 20%` **OR** `vs_similar_routes ≥ 20%`.

Why 20%? The three rows in `sample_output_format_v2.csv` are real computed
values (I reproduced them to the digit: 3.29/+29.5%/+22.5%, 3.98/+9.2%/+23.6%,
4.17/+35.5%/+21.0%). All three pass a 20%-on-either-baseline filter — including
the +9.2%/+23.6% row, which only clears the bar via the peer comparison. A
higher bar would drop a row the sample says should be flagged; a much lower bar
would flood the output. 20% on either baseline is the threshold consistent with
the sample.

**`retrieval.py`** — the AI layer. Notes are embedded as TF-IDF vectors in a
tiny vector store (pure NumPy, written from scratch: fixed sorted vocabulary,
smoothed IDF, cosine similarity, note_id tiebreak) and ranked against each
flagged week. Retrieval *proposes* candidates; it never decides.

**`notes.py` + `verdict.py`** — the trust layer. A note justifies a flag only if
all three hold: (1) it applies to the route (exact match or "All Routes"),
(2) its date window overlaps the flagged week, (3) it actually describes a
reason for costs *rising*. The third check is a curated per-note flag from a
careful reading (table below), each backed by an exact quote. Verdicts:
- `"No (justified)"` + `matched_note_id` — cites the note, its date, and a
  grounded summary of its content.
- `"Yes"` + blank `matched_note_id` — names the closest note and the exact
  reason it doesn't count (wrong route / wrong window / doesn't describe a
  cost rise), or says plainly that nothing relevant exists. Never guesses.

**`ask.py`** — stretch goal: plain-English Q&A over the assistant's own
results (deterministic templates, cited; says "I don't know" when the data
has no answer).

## Why no generative LLM (deliberate trade-off)

The brief grades anti-hallucination hardest ("a confident wrong reason scores
worse than 'couldn't find one'"), demands bit-identical repeat runs, and asks
for an honest token/cost log. A generative LLM adds nondeterminism and a
hallucination surface to exactly the step under strictest scrutiny, while buying
nothing at this scale: 10 notes, and an acceptance rule fully expressible as
deterministic logic. So the "AI" here is retrieval (a real vector-search
pattern), the verdicts are provable, the cost is ₹0, and three runs are
byte-identical. The swap-in point for neural embeddings is documented in
`retrieval.py` if scale ever demands it. See `token_cost_log.md`.

## Note readings (the curated evidence behind every verdict)

| Note | Date / window | Applies to | Cost-rise reason? | Evidence |
|---|---|---|---|---|
| N001 | 2025-02-24 → 2025-03-08 | Chennai-Bangalore | **Yes** | "forcing longer detours and higher trip costs" |
| N002 | 2025-01-20 (week) | Ahmedabad-Mumbai | **Yes** | "a temporary surcharge applied by transporters" |
| N003 | 2025-05-05 (week) | All Routes | **Yes** | "pushing up transportation costs across all routes by roughly 5-7%" |
| N004 | 2024-03-11 (week) | All Routes | No | "the affected routes are not part of this dataset" |
| N005 | 2024-07-29 (week) | Mumbai-Delhi | No | "costs were not significantly affected" |
| N006 | 2025-09-22 (week) | All Routes | No | "no major disruptions reported" |
| N007 | 2024-05-20 (week) | Delhi-Jaipur | No | "improved road conditions" (resurfacing — not a rise reason) |
| N008 | 2025-06-09 (week) | Kolkata-Bhubaneswar | No | "No significant disruptions were reported" |
| N009 | 2025-03-17 (week) | Chennai-Bangalore | No | "returned to normal conditions" |
| N010 | 2025-10-27 (week) | All Routes | No | "absorbed by transporters without a rate change" |

Deliberate trap cases the system handles correctly:
- **N010 vs Mumbai-Pune 2025-10-27**: same week, all routes — but explicitly
  says *no rate change* → stays flagged. (Content gate.)
- **N001 vs Chennai-Bangalore 2025-03-10**: real flood note, but its window
  ended Mar 8 and roads were passable by Mar 9 → stays flagged. (Window gate.)
- **N009 vs Chennai-Bangalore 2025-03-17**: same route, same week — but says
  the route *returned to normal* → stays flagged. (Content gate.)
- **N006 vs Mumbai-Pune 2025-09-15**: the temporally closest note, but it
  reports stable demand → stays flagged, mirroring the sample row's reasoning.

## How I convinced myself it was right

`python3 eval/run_eval.py` — 13/13 checks pass:
- **Verdict accuracy 20/20** against a hand-labeled set (`eval/labels.json`;
  each label records the human reasoning in its `why` field).
- **matched_note_id accuracy 20/20**; every justified row's note passes the
  strict acceptance test, and no "Yes" row has a note that would pass it
  (no hallucinations, no missed justifications).
- **Retrieval quality 3/3**: each justifying note ranks in the retrieval top-2.
- **Sample rows reproduced exactly** (3/3 numbers match `sample_output_format_v2.csv`).
- **No look-ahead**: each route's first week has no history baseline.
- **Format contract**: column names/order and value formats match the sample
  file exactly (2-decimal costs, `+x.x%` strings, Monday `week_of` dates).

`reproducibility_check.md` records three byte-identical runs (SHA-256).

## Findings summary

- **Ahmedabad-Mumbai, week of 2025-01-20** (+29.5% history, +22.5% peers) —
  justified by N002 (festival-week surcharge).
- **Chennai-Bangalore, weeks of 2025-02-24 and 2025-03-03** (+31.5%/+38.7%,
  +22.8%/+32.0%) — justified by N001 (flood detours). The following two weeks
  stayed elevated but fall outside the flood window → flagged unexplained.
- **Delhi-Jaipur, weeks of 2024-11-11 and 2025-11-18** (+35.5%, +27.6% vs
  history) — no applicable note → flagged unexplained.
- **Mumbai-Pune, 11 weeks from 2025-06-23 to 2025-12-22** — a sustained
  elevation vs similar routes (+20% to +39%) while its own history absorbed it
  (+2% to +9%): the peer baseline is what catches a slow regime shift. No
  note explains it → all flagged unexplained.

## Limitations & next steps

- The 20% threshold is calibrated to the sample, not learned; with labeled
  outcomes from reviewers I'd tune it (precision/recall curve).
- Note windows for single-date notes = the containing week; a note dated
  mid-week spilling into the next week is a judgment call worth revisiting
  with the ops team.
- With thousands of notes I'd swap the TF-IDF store for local neural
  embeddings (interface-ready in `retrieval.py`) and add reviewer feedback as
  labels to keep tuning the gate.
