import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(ROOT, 'artifacts', 'results.json'), 'utf8'));
const { candidates } = data;
const routes = [...new Set(candidates.map((c) => c.route))];

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const pct = (v) => (v == null ? 'n/a' : `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}%`);

function findRoute(q) {
  const lower = q.toLowerCase();
  for (const r of routes) {
    const [a, b] = r.toLowerCase().split('-');
    if (lower.includes(a) && lower.includes(b)) return r;
  }
  for (const r of routes) {
    if (lower.includes(r.toLowerCase())) return r;
  }
  return null;
}

function findMonths(q) {
  const lower = q.toLowerCase();
  return MONTHS.filter((m) => lower.includes(m)).map((m) => String(MONTHS.indexOf(m) + 1).padStart(2, '0'));
}

function findYears(q) {
  return [...q.matchAll(/\b(20\d{2})\b/g)].map((m) => m[1]);
}

function answer(q) {
  const route = findRoute(q);
  const months = findMonths(q);
  const years = findYears(q);

  let hits = candidates;
  if (route) hits = hits.filter((c) => c.route === route);
  if (months.length) hits = hits.filter((c) => months.includes(c.week_of.slice(5, 7)));
  if (years.length) hits = hits.filter((c) => years.includes(c.week_of.slice(0, 4)));

  const scope = [
    route ? `route ${route}` : 'all routes',
    months.length ? `month(s) ${months.join(', ')}` : null,
    years.length ? `year(s) ${years.join(', ')}` : null,
  ].filter(Boolean).join(', ');

  if (!hits.length) {
    return `No flagged weeks found for ${scope}.`;
  }

  const lines = [`Flagged ${hits.length} week(s) for ${scope}:`];
  for (const h of hits.slice(0, 12)) {
    const status = h.verdict === 'justified'
      ? `JUSTIFIED (${h.matched_note_id})`
      : 'UNEXPLAINED';
    lines.push(
      `  - ${h.week_of}: ${Number(h.cost_per_tonne_km).toFixed(2)} INR/tonne-km ` +
      `(${pct(h.own_pct)} vs own history, ${pct(h.peer_pct)} vs peers) -> ${status}`
    );
    lines.push(`    ${h.reason}`);
  }
  if (hits.length > 12) lines.push(`  ... and ${hits.length - 12} more.`);
  const just = hits.filter((h) => h.verdict === 'justified').length;
  lines.push(`Total: ${just} justified, ${hits.length - just} unexplained.`);
  return lines.join('\n');
}

function main() {
  const q = process.argv.slice(2).join(' ').trim();
  if (q) {
    console.log(answer(q));
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log('Enter a question about flagged routes (Ctrl+C to exit):');
  rl.on('line', (line) => {
    if (line.trim()) console.log('\n' + answer(line.trim()) + '\n');
  });
}

main();
