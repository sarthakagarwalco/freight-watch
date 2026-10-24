import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCSVObjects, toCSV } from './csv.mjs';
import { weeklyAggregates, assess, DEFAULTS } from './pipeline.mjs';
import { structureNotes, findJustification, nearestApplicableNote } from './notes.mjs';
import { justifiedReason, unexplainedWithNearNote, unexplainedNoNote, maybeRephrase } from './explain.mjs';
import { callLLM, llmEnabled, estimateCostUsd } from './llm.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const DATA_DIR = arg('data', join(ROOT, 'data'));
const OUT_DIR = arg('out', join(ROOT, 'output'));
const ART_DIR = join(ROOT, 'artifacts');
const CFG = {
  ownWindow: Number(arg('own-window', DEFAULTS.ownWindow)),
  ownThresholdPct: Number(arg('own-threshold', DEFAULTS.ownThresholdPct)),
  peerThresholdPct: Number(arg('peer-threshold', DEFAULTS.peerThresholdPct)),
};

const OUTPUT_COLUMNS = [
  'route', 'week_of', 'cost_per_tonne_km', 'vs_own_history',
  'vs_similar_routes', 'flagged', 'matched_note_id', 'reason',
];

const fmtPct = (v) => (v == null ? null : `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}%`);
const ownField = (v) => (v == null ? "n/a vs this route's past average" : `${fmtPct(v)} vs this route's past average`);
const peerField = (v) => (v == null ? 'n/a vs similar-length routes this week' : `${fmtPct(v)} vs similar-length routes this week`);

async function main() {
  const records = readCSVObjects(readFileSync(join(DATA_DIR, 'shipment_records.csv'), 'utf8'));
  const noteRows = readCSVObjects(readFileSync(join(DATA_DIR, 'context_notes.csv'), 'utf8'));
  const notes = structureNotes(noteRows);

  const byRoute = weeklyAggregates(records);
  const all = assess(byRoute, CFG);
  const candidates = all.filter((r) => r.is_candidate);

  const decided = candidates.map((r) => {
    const note = findJustification(notes, r.route, r.week_of);
    if (note) {
      return {
        ...r,
        verdict: 'justified',
        matched_note_id: note.note_id,
        reason: justifiedReason(note),
        matched_note: note,
      };
    }
    const near = nearestApplicableNote(notes, r.route, r.week_of, 28);
    return {
      ...r,
      verdict: 'unexplained',
      matched_note_id: '',
      reason: near ? unexplainedWithNearNote(near) : unexplainedNoNote(),
      matched_note: null,
      near_note: near ?? null,
    };
  });

  const useLLM = arg('llm') === true && llmEnabled();
  const usage = { calls: 0, input_tokens: 0, output_tokens: 0 };
  if (useLLM) {
    for (const d of decided) {
      const facts = {
        route: d.route,
        week_of: d.week_of,
        verdict: d.verdict,
        matched_note_id: d.matched_note_id,
        deterministic_reason: d.reason,
      };
      const r = await maybeRephrase({ enabled: true, deterministic: d.reason, facts, callLLM });
      d.reason = r.text;
      if (r.usedLLM) {
        usage.calls += 1;
        usage.input_tokens += r.usage?.input_tokens ?? 0;
        usage.output_tokens += r.usage?.output_tokens ?? 0;
      }
    }
  }

  decided.sort((a, b) => (a.week_of < b.week_of ? -1 : a.week_of > b.week_of ? 1 : a.route.localeCompare(b.route)));
  all.sort((a, b) => (a.week_of < b.week_of ? -1 : a.week_of > b.week_of ? 1 : a.route.localeCompare(b.route)));

  const submission = decided.map((r) => ({
    route: r.route,
    week_of: r.week_of,
    cost_per_tonne_km: r.cost_per_tonne_km.toFixed(2),
    vs_own_history: ownField(r.own_pct),
    vs_similar_routes: peerField(r.peer_pct),
    flagged: r.verdict === 'justified' ? 'No (justified)' : 'Yes',
    matched_note_id: r.matched_note_id,
    reason: r.reason,
  }));

  const fullMatrix = all.map((r) => ({
    route: r.route,
    week_of: r.week_of,
    cost_per_tonne_km: r.cost_per_tonne_km.toFixed(2),
    vs_own_history: ownField(r.own_pct),
    vs_similar_routes: peerField(r.peer_pct),
    flagged: r.is_candidate ? (r.verdict ?? 'candidate') : 'No',
    matched_note_id: '',
    reason: '',
  }));

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(ART_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'freight_flags.csv'), toCSV(submission, OUTPUT_COLUMNS));
  writeFileSync(join(OUT_DIR, 'all_route_weeks.csv'), toCSV(fullMatrix, OUTPUT_COLUMNS));
  writeFileSync(join(ART_DIR, 'notes_structured.json'), JSON.stringify(notes, null, 2));
  writeFileSync(join(ART_DIR, 'results.json'), JSON.stringify({ config: CFG, notes, candidates: decided, all }, null, 2));

  const justified = decided.filter((d) => d.verdict === 'justified').length;
  const summary = {
    input_records: records.length,
    routes: byRoute.size,
    route_weeks: all.length,
    candidates: decided.length,
    justified,
    unexplained: decided.length - justified,
    config: CFG,
    llm_calls: usage.calls,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    estimated_cost_usd: Number(
      estimateCostUsd(process.env.LLM_MODEL || 'gpt-4o-mini', usage.input_tokens, usage.output_tokens).toFixed(6)
    ),
    mode: useLLM ? 'llm-rephrase' : 'deterministic-offline',
  };
  writeFileSync(join(ART_DIR, 'run_summary.json'), JSON.stringify(summary, null, 2));

  console.log('Wrote', join(OUT_DIR, 'freight_flags.csv'));
  console.log('Wrote', join(OUT_DIR, 'all_route_weeks.csv'));
}

main();
