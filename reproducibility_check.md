# Reproducibility check

Three untouched runs of the full pipeline on the same input, run back-to-back
on 2026-10-14:

```
for i in 1 2 3; do
  python3 -m freight_watch.pipeline --out /tmp/repro_run_$i.csv
done
```

| Run | SHA-256 of output CSV |
|---|---|
| 1 | 2339c62058c9162b1801552dad80d3bd182a98a75dc9f401ac96e02d333c64b3 |
| 2 | 2339c62058c9162b1801552dad80d3bd182a98a75dc9f401ac96e02d333c64b3 |
| 3 | 2339c62058c9162b1801552dad80d3bd182a98a75dc9f401ac96e02d333c64b3 |

`diff` between all pairs: no differences. Flags, numbers, cited note ids, and
verdicts are identical; only explanation *wording* is permitted to vary by the
brief, and here even the wording is identical because explanations are
deterministic templates quoting the cited notes.

## Why it is deterministic

- No LLM calls, no sampling, no temperature anywhere in the pipeline.
- The retrieval layer is a from-scratch TF-IDF vector store (pure NumPy):
  fixed vocabulary sorted alphabetically, smoothed IDF, cosine similarity,
  note_id as tiebreak. One subtle bug was caught during development —
  `np.log(vec, where=vec > 0)` leaves unselected entries uninitialized, which
  is nondeterministic across runs; it was replaced with explicit boolean-mask
  indexing. The eval harness re-runs the pipeline, so any recurrence would
  fail the byte-level checks.
- Pandas groupby/rolling operations are deterministic given row order, and the
  input CSV has a fixed row order.
- Python's hash randomization does not affect the output: no iteration over
  sets/dicts influences row order (rankings break ties by note_id; output rows
  are sorted by week then route).
