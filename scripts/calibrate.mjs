import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCSVObjects } from '../src/csv.mjs';
import { weeklyAggregates, ownHistory, peerAverage, routeKey } from '../src/pipeline.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const records = readCSVObjects(readFileSync(join(ROOT, 'data', 'shipment_records.csv'), 'utf8'));
const byRoute = weeklyAggregates(records);

const keyOf = (route) => {
  const [origin, destination] = route.split('-');
  return routeKey({ origin, destination });
};

const checks = [
  ['Delhi-Jaipur', '2024-11-11', 4.17, 35.5, 21.0],
  ['Ahmedabad-Mumbai', '2025-01-20', 3.29, 29.5, 22.5],
  ['Mumbai-Pune', '2025-09-15', 3.98, 9.2, 23.6],
];

let ok = true;
for (const [route, week, expC, expOwn, expPeer] of checks) {
  const k = keyOf(route);
  const c = byRoute.get(k).weeks.get(week).costPerTonneKm;
  const own = ownHistory(byRoute, k, week);
  const peer = peerAverage(byRoute, k, week);
  const ownPct = ((c - own.avg) / own.avg) * 100;
  const peerPct = ((c - peer.avg) / peer.avg) * 100;
  const pass =
    c.toFixed(2) === expC.toFixed(2) &&
    ownPct.toFixed(1) === expOwn.toFixed(1) &&
    peerPct.toFixed(1) === expPeer.toFixed(1);
  ok &&= pass;
  console.log(`${route} (${week}): cost=${c.toFixed(2)}, own=${ownPct.toFixed(1)}%, peer=${peerPct.toFixed(1)}% -> ${pass ? 'OK' : 'MISMATCH'}`);
}
process.exit(ok ? 0 : 1);
