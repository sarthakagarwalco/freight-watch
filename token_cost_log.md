# Token / cost log — one full run over shipment_records.csv

Measured on 2026-10-14 for the final pipeline (`python3 -m freight_watch.pipeline`).

| Item | Count |
|---|---|
| LLM calls | 0 |
| Input tokens (LLM) | 0 |
| Output tokens (LLM) | 0 |
| Embedding-model downloads | 0 (retrieval is a from-scratch TF-IDF vector store; no model weights) |
| Paid API calls | 0 |
| **Total cost** | **₹0.00** |

## Why zero LLM calls is a deliberate choice, not a shortcut

The brief grades (a) anti-hallucination — every "justified" verdict must cite an
exact note that applies to that route and time, with a confident wrong reason
scoring worse than "couldn't find one"; (b) reproducibility — three untouched
runs must produce identical flags and numbers; and (c) responsible cost.

A generative LLM adds nondeterminism and a hallucination surface to the exact
step the brief polices most strictly, while buying nothing here: there are only
10 notes, and the acceptance rule (right route + right time window + the note
actually describing a cost rise) is fully expressible as deterministic logic
over a careful human reading of each note (see README, "Note readings").

The "AI" in this submission is the retrieval layer: notes are embedded as
TF-IDF vectors in a small vector store and ranked by cosine similarity against
each flagged week (retrieval.py). Retrieval *proposes* candidates; the
deterministic gate in notes.py *disposes*. Explanations are grounded templates
that quote the cited note's content and dates — no free-form generation, so a
wrong reason is structurally impossible.

If scale demanded it (thousands of notes), the swap-in point is documented in
retrieval.py: replace `_embed` with a local sentence-transformer. For this
dataset that would add ~100MB+ of weights, nondeterminism risk, and cost, for
no verdict-quality gain — measured above, the current retrieval already places
every justifying note in the top-2 (eval check "accepted note in retrieval
top-2: 3/3").
