const UP_PHRASE = {
  weather_flood: 'flooding disrupted truck movement and forced longer, costlier detours',
  festival_surcharge: 'a regional festival week drove a temporary surcharge on this corridor',
  fuel_price: 'diesel prices rose nationwide, pushing up transportation costs',
  other: 'an operational disruption affected costs on this corridor',
};

const NO_IMPACT_PHRASE = {
  recovery: 'that the route had already returned to normal conditions',
  road_improved: 'improved road conditions, which does not explain a cost rise',
  toll_change: 'a toll change on routes outside this dataset',
  road_works: 'minor highway maintenance delays without a significant cost impact',
  regulation: 'a tracking mandate',
  industry_report: 'stable demand with no major disruptions',
  other: 'conditions that do not explain a cost rise',
};

export function justifiedReason(note) {
  const phrase = UP_PHRASE[note.kind] ?? UP_PHRASE.other;
  return (
    `Matches note ${note.note_id} dated ${note.date}: ${phrase} ` +
    `(applies to ${note.applies_to}, effective ${note.window_start} to ${note.window_end}). ` +
    `The cost rise has a clear explanation.`
  );
}

export function unexplainedWithNearNote(note) {
  const phrase = NO_IMPACT_PHRASE[note.kind] ?? NO_IMPACT_PHRASE.other;
  return (
    `The closest note (${note.note_id}, ${note.date}) mentions ${phrase} -- it does not ` +
    `describe a reason for a cost rise on this route. No genuine justification found; ` +
    `flagged for review.`
  );
}

export function unexplainedNoNote() {
  return (
    'No matching note found for this route or date range. Cost rise looks unexplained ' +
    'and worth a human review.'
  );
}

export async function maybeRephrase({ enabled, deterministic, facts, callLLM }) {
  if (!enabled || !callLLM) return { text: deterministic, usedLLM: false, usage: null };
  try {
    const out = await callLLM(facts);
    if (!out || typeof out.text !== 'string' || !out.text.trim()) {
      return { text: deterministic, usedLLM: false, usage: null };
    }
    return { text: out.text.trim(), usedLLM: true, usage: out.usage ?? null };
  } catch {
    return { text: deterministic, usedLLM: false, usage: null };
  }
}
