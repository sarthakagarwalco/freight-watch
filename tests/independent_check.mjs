import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function getMonday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

function readSimpleCSV(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const c = l.split(',');
    return Object.fromEntries(head.map((h, i) => [h, c[i]]));
  });
}

const recs = readSimpleCSV(join(ROOT, 'data', 'shipment_records.csv'));
const routeOf = (r) => `${r.origin}-${r.destination}`;
const typeOf = {};
const cells = new Map();

for (const r of recs) {
  const route = routeOf(r);
  typeOf[route] = r.route_type;
  const w = getMonday(r.shipment_date);
  const k = `${route}|${w}`;
  if (!cells.has(k)) cells.set(k, { cost: 0, tk: 0 });
  const g = cells.get(k);
  g.cost += Number(r.freight_cost_inr);
  g.tk += Number(r.quantity_tonnes) * Number(r.distance_km);
}

const cptk = (route, w) => {
  const g = cells.get(`${route}|${w}`);
  return g ? g.cost / g.tk : null;
};

const weeksOf = (route) =>
  [...cells.keys()]
    .filter((k) => k.startsWith(route + '|'))
    .map((k) => k.split('|')[1])
    .sort();

function ownAvg(route, w) {
  const prior = weeksOf(route).filter((x) => x < w).slice(-8);
  if (!prior.length) return null;
  return prior.reduce((a, x) => a + cptk(route, x), 0) / prior.length;
}

function peerAvg(route, w) {
  const others = [...new Set(Object.keys(typeOf))].filter(
    (o) => o !== route && typeOf[o] === typeOf[route] && cptk(o, w) != null
  );
  if (!others.length) return null;
  return others.reduce((a, o) => a + cptk(o, w), 0) / others.length;
}

const fmt = (v) => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(1) + '%';
const outLines = readFileSync(join(ROOT, 'output', 'freight_flags.csv'), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean);

const outRows = outLines.slice(1).map((l) => {
  const f = [];
  let cur = '', q = false;
  for (const ch of l) {
    if (q) {
      if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      f.push(cur);
      cur = '';
    } else cur += ch;
  }
  f.push(cur);
  return f;
});

let fails = 0;
function assertRow(i, cond, msg) {
  if (!cond) {
    fails++;
    console.log(`  FAIL row ${i + 1}: ${msg}`);
  }
}

outRows.forEach((f, i) => {
  const [route, week, costS, ownS, peerS, flagged, note] = f;
  const c = cptk(route, week);
  const o = ownAvg(route, week);
  const p = peerAvg(route, week);
  const oPct = ((c - o) / o) * 100;
  const pPct = ((c - p) / p) * 100;

  assertRow(i, c != null, `no data for ${route} ${week}`);
  assertRow(i, costS === c.toFixed(2), 'cost mismatch');
  assertRow(i, ownS === `${fmt(oPct)} vs this route's past average`, 'own mismatch');
  assertRow(i, peerS === `${fmt(pPct)} vs similar-length routes this week`, 'peer mismatch');

  const cand = oPct > 0 && (oPct >= 15 || pPct >= 15);
  assertRow(i, cand, 'threshold check failed');
  assertRow(i, flagged === (note ? 'No (justified)' : 'Yes'), 'flag mismatch');
});

console.log(`Verified ${outRows.length} output rows (${fails} errors).`);
process.exit(fails ? 1 : 0);
