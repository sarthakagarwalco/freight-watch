"""Note retrieval: a tiny deterministic vector store over the context notes.

Design notes (see README for the full trade-off discussion):
  * Documents are embedded as TF-IDF vectors over a shared vocabulary and
    ranked by cosine similarity -- a classical, fully deterministic retrieval
    model. No downloads, no API calls, no sampling: the same input always
    produces the same ranking.
  * Retrieval only *proposes* candidates. The verdict (see verdict.py) is
    decided by the deterministic acceptance test in notes.note_justifies --
    right route, right time window, and the note must describe a cost rise.
    Retrieval can never invent a justification.

Swap-in point: replace `_embed` with neural embeddings (e.g. a local
sentence-transformer) and everything downstream keeps working unchanged.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .notes import Note

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


@dataclass
class RetrievalHit:
    note: Note
    score: float
    rank: int


class NoteVectorStore:
    """TF-IDF vector store over notes. Deterministic by construction."""

    def __init__(self, notes: list[Note]):
        self.notes = notes
        docs = [self._doc_text(n) for n in notes]
        tokenized = [_tokenize(d) for d in docs]

        # Fixed vocabulary, sorted for determinism.
        self.vocab = sorted({t for toks in tokenized for t in toks})
        self._index = {t: i for i, t in enumerate(self.vocab)}

        n_docs = len(docs)
        df_counts = np.zeros(len(self.vocab))
        for toks in tokenized:
            for t in set(toks):
                df_counts[self._index[t]] += 1
        # Smoothed IDF.
        self.idf = np.log((1 + n_docs) / (1 + df_counts)) + 1.0

        self.doc_matrix = np.vstack([self._embed(toks) for toks in tokenized])

    @staticmethod
    def _doc_text(note: Note) -> str:
        # Index the note's own words plus the route it applies to. Kept free of
        # boilerplate ("applies to ...", "note date ...") so shared scaffolding
        # words cannot drown out the discriminative terms at ranking time.
        # Routing (exact route) and timing (date window) are enforced by the
        # deterministic acceptance test in notes.note_justifies, not by ranking.
        return f"{note.text} {note.applies_to}"

    def _embed(self, tokens: list[str]) -> np.ndarray:
        vec = np.zeros(len(self.vocab))
        for t in tokens:
            if t in self._index:
                vec[self._index[t]] += 1.0
        nonzero = vec > 0
        if nonzero.any():
            # Sublinear TF scaling, IDF weighting, L2 normalization.
            # Explicit mask (no np.log(..., where=...)): that form leaves
            # unselected entries uninitialized, which is nondeterministic.
            vec[nonzero] = (1.0 + np.log(vec[nonzero])) * self.idf[nonzero]
            vec = vec / np.linalg.norm(vec)
        return vec

    def query(self, text: str, top_k: int = 3) -> list[RetrievalHit]:
        q = self._embed(_tokenize(text))
        scores = self.doc_matrix @ q  # cosine similarity (all vectors unit norm)
        # Deterministic ordering: score desc, then note_id asc as tiebreak.
        order = sorted(range(len(self.notes)), key=lambda i: (-scores[i], self.notes[i].note_id))
        return [
            RetrievalHit(note=self.notes[i], score=float(scores[i]), rank=r + 1)
            for r, i in enumerate(order[:top_k])
        ]

    @staticmethod
    def retrieval_query(route: str, week_of: pd.Timestamp) -> str:
        week_end = week_of + pd.Timedelta(days=6)
        return (
            f"cost increase freight surcharge on {route} during week "
            f"{week_of.date()} to {week_end.date()}"
        )
