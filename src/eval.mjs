import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCSVObjects } from './csv.mjs';
import { structureNotes, routeMatches, windowCoversWeek } from './notes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUB = join(ROOT, 'output', 'freight_flags.csv');
const NOTES = join(ROOT, 'data', 'context_notes.csv');
const SAMPLE = join(ROOT, 'data', 'sample_output_format_v2.csv');

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
}

const out = readCSVObjects(readFileSync(SUB, 'utf8'));
const sample = readCSVObjects(readFileSync(SAMPLE, 'utf8'));
const notes = structureNotes(readCSVObjects(readFileSync(NOTES, 'utf8')));
const noteById = new Map(notes.map((n) => [n.note_id, n]));

// 1. Column schema check
const EXPECTED_COLS = [
  'route', 'week_of', 'cost_per_tonne_km', 'vs_own_history',
  'vs_similar_routes', 'flagged', 'matched_note_id', 'reason',
];
const headerLine = readFileSync(SUB, 'utf8').split(/\r?\n/)[0];
check('Header columns match sample format', headerLine === EXPECTED_COLS.join(','), headerLine);

// 2. Reference sample row check
let sampleMiss = 0;
for (const s of sample) {
  const mine = out.find((r) => r.route === s.route && r.week_of === s.week_of);
  if (!mine) { sampleMiss++; continue; }
  for (const f of ['cost_per_tonne_km', 'vs_own_history', 'vs_similar_routes', 'flagged', 'matched_note_id']) {
    if (String(mine[f]) !== String(s[f])) sampleMiss++;
  }
}
check('Sample output rows match exactly', sampleMiss === 0, `${sample.length} reference rows`);

// 3. Note attribution and polarity checks
let justified = 0;
const badJustified = [];
for (const r of out) {
  if (r.flagged !== 'No (justified)') continue;
  justified++;
  const note = noteById.get(r.matched_note_id);
  if (!note || note.cost_effect !== 'up' || !routeMatches(note, r.route) || !windowCoversWeek(note, r.week_of)) {
    badJustified.push(`${r.route}|${r.week_of}`);
  }
}
check('Justified rows match route, date window, and upward cost polarity', badJustified.length === 0);

const explainedIds = out.filter((r) => r.matched_note_id).map((r) => r.matched_note_id);
const NO_IMPACT = ['N004', 'N005', 'N006', 'N007', 'N008', 'N009', 'N010'];
check('Non-impact notes (N004-N010) are never cited as justification', explainedIds.every((id) => !NO_IMPACT.includes(id)));

check('Unexplained rows leave matched_note_id empty', out.filter((r) => r.flagged === 'Yes').every((r) => r.matched_note_id === ''));

check('All rows have non-empty reasons and valid flag values', out.every((r) => r.reason.trim().length > 0 && /^(Yes|No \(justified\))$/.test(r.flagged)));

// 4. Spot-check known test cases
const LABELED = [
  { route: 'Ahmedabad-Mumbai', week_of: '2025-01-20', expect: 'justified' },
  { route: 'Chennai-Bangalore', week_of: '2025-02-24', expect: 'justified' },
  { route: 'Chennai-Bangalore', week_of: '2025-03-03', expect: 'justified' },
  { route: 'Delhi-Jaipur', week_of: '2024-11-11', expect: 'unexplained' },
  { route: 'Mumbai-Pune', week_of: '2025-09-15', expect: 'unexplained' },
  { route: 'Chennai-Bangalore', week_of: '2025-03-10', expect: 'unexplained' },
  { route: 'Chennai-Bangalore', week_of: '2025-03-17', expect: 'unexplained' },
];
let hit = 0;
for (const l of LABELED) {
  const row = out.find((r) => r.route === l.route && r.week_of === l.week_of);
  const got = !row ? 'missing' : row.flagged === 'No (justified)' ? 'justified' : 'unexplained';
  if (got === l.expect) hit++;
}
check('Spot-check test cases pass', hit === LABELED.length, `${hit}/${LABELED.length}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (justified=${justified}, unexplained=${out.length - justified}).`);
process.exit(failed.length ? 1 : 0);
