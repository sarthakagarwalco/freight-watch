# FreightTiger Case Study - Route Cost Monitoring

Tracks weekly shipping cost per tonne-km across routes, compares each route-week against its own trailing history and similar-length peers, flags unusual cost spikes, and checks context notes to separate explained disruptions from unexplained anomalies.

## Quick Start

```bash
# Run the main pipeline (writes output/freight_flags.csv and output/all_route_weeks.csv)
npm run run

# Run validation and sanity checks
npm run verify

# Query the results via CLI
node src/ask.mjs "why did Chennai-Bangalore get pricier in March 2025?"
node src/ask.mjs "which routes were flagged in 2025?"
```

Requires Node.js >= 18 (uses built-in Node modules only).

## Project Layout

* `output/freight_flags.csv` - Main output file matching `sample_output_format_v2.csv`.
* `output/all_route_weeks.csv` - Full 728-row route-week dataset with computed baselines.
* `artifacts/` - Structured JSON outputs (`notes_structured.json`, `results.json`, `run_summary.json`, `reproducibility.json`, `cost_log.json`).
* `src/pipeline.mjs` - Weekly aggregation and baseline calculations.
* `src/notes.mjs` - Date-window extraction, polarity filtering, and note matching.
* `src/explain.mjs` - Template-based reason builder and optional LLM rephrasing hook.
* `src/eval.mjs` - Automated checks for schema, sample row accuracy, and note attribution.

## Core Methodology

1. **Weekly Aggregation:** Shipments are bucketed into Mon-Sun weeks (UTC Monday date as `week_of`). Weekly cost per tonne-km is computed as `sum(freight_cost_inr) / sum(quantity_tonnes * distance_km)` so heavier shipments are weighted proportionally.
2. **Baselines:**
   * **Own History:** Mean weekly cost/tonne-km over the route's trailing up to 8 weeks strictly before the current week (no look-ahead).
   * **Peer Routes:** Mean weekly cost/tonne-km in the same week across all other routes with the same `route_type`.
3. **Flagging Thresholds:** A route-week is flagged as a candidate when cost is rising (`own_pct > 0`) and exceeds either its own trailing average by `>= 15%` or its peer average by `>= 15%`. This yields 26 candidate route-weeks out of 728 (3 justified, 23 unexplained).

## Note Matching & Hallucination Prevention

Rather than passing raw notes to an LLM to guess verdicts, `src/notes.mjs` parses the 10 context notes into structured records first:
* **Polarity check:** Notes stating that costs remained stable, returned to normal, or were unaffected (N004-N010) are marked `can_justify: false` upfront. Only N001, N002, and N003 represent upward cost pressure.
* **Matching rule:** A candidate week is marked `No (justified)` only if a note has `can_justify: true`, matches the route (exact route or `All Routes`), and its effective date window overlaps that Mon-Sun week.
* **Unexplained fallback:** If no qualifying note matches, `matched_note_id` is left empty and `flagged` is set to `Yes`. If a non-qualifying note exists within 28 days for that route, the reason explicitly notes why it does not explain the spike (matching the format in the sample output).

An optional `--llm` flag (`src/llm.mjs`) is supported to rephrase the generated reason text via an OpenAI-compatible API, while keeping all numbers, verdicts, and note IDs locked to the deterministic pipeline.

## Key Observations & Limitations

* **Short-route peer skew:** The `Short` category only has two routes: Mumbai-Pune (~150 km) and Delhi-Jaipur (~280 km). Because shorter trips have higher fixed costs per km, Mumbai-Pune consistently sits 15-39% above Delhi-Jaipur and triggers several peer-only flags. In production, grouping peers by finer distance brackets or requiring both own-history and peer thresholds to breach would reduce these false positives.
* **Open-ended fuel note (N003):** N003 notes a 5-7% nationwide diesel hike starting 2025-05-05. We bound open-ended notes to a 28-day window, though in practice a 5-7% increase stays below the 15% anomaly threshold.
