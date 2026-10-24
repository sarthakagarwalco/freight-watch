import { mondayOf } from './weeks.mjs';

export const DEFAULTS = {
  ownWindow: 8,
  ownThresholdPct: 15,
  peerThresholdPct: 15,
};

export function routeKey(r) {
  return `${r.origin}-${r.destination}`;
}

export function weeklyAggregates(records) {
  const byRoute = new Map();
  for (const r of records) {
    const route = routeKey(r);
    const week = mondayOf(r.shipment_date);
    if (!byRoute.has(route)) {
      byRoute.set(route, { route_type: r.route_type, weeks: new Map() });
    }
    const entry = byRoute.get(route);
    entry.route_type = r.route_type;
    const wk = entry.weeks;
    if (!wk.has(week)) wk.set(week, { cost: 0, tonneKm: 0, shipments: 0 });
    const g = wk.get(week);
    g.cost += Number(r.freight_cost_inr);
    g.tonneKm += Number(r.quantity_tonnes) * Number(r.distance_km);
    g.shipments += 1;
  }
  for (const entry of byRoute.values()) {
    for (const g of entry.weeks.values()) {
      g.costPerTonneKm = g.cost / g.tonneKm;
    }
  }
  return byRoute;
}

export function ownHistory(byRoute, route, week, ownWindow = DEFAULTS.ownWindow) {
  const weeks = [...byRoute.get(route).weeks.keys()].filter((w) => w < week).sort();
  const used = weeks.slice(-ownWindow);
  if (!used.length) return { avg: null, weeksUsed: 0, truncated: false };
  const sum = used.reduce((acc, w) => acc + byRoute.get(route).weeks.get(w).costPerTonneKm, 0);
  return {
    avg: sum / used.length,
    weeksUsed: used.length,
    truncated: used.length < ownWindow,
  };
}

export function peerAverage(byRoute, route, week) {
  const type = byRoute.get(route).route_type;
  const vals = [];
  for (const [other, entry] of byRoute) {
    if (other === route || entry.route_type !== type) continue;
    const g = entry.weeks.get(week);
    if (g) vals.push(g.costPerTonneKm);
  }
  if (!vals.length) return { avg: null, peersUsed: 0 };
  return {
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    peersUsed: vals.length,
  };
}

const pct = (v, base) => (base ? ((v - base) / base) * 100 : null);

export function assess(byRoute, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const rows = [];
  for (const [route, entry] of byRoute) {
    const weeks = [...entry.weeks.keys()].sort();
    for (const week of weeks) {
      const c = entry.weeks.get(week).costPerTonneKm;
      const oh = ownHistory(byRoute, route, week, cfg.ownWindow);
      const pa = peerAverage(byRoute, route, week);
      const ownPct = oh.avg == null ? null : pct(c, oh.avg);
      const peerPct = pa.avg == null ? null : pct(c, pa.avg);
      const isCandidate =
        ownPct != null &&
        ownPct > 0 &&
        (ownPct >= cfg.ownThresholdPct || (peerPct != null && peerPct >= cfg.peerThresholdPct));

      rows.push({
        route,
        route_type: entry.route_type,
        week_of: week,
        cost_per_tonne_km: c,
        own_avg: oh.avg,
        own_weeks_used: oh.weeksUsed,
        own_truncated: oh.truncated,
        own_pct: ownPct,
        peer_avg: pa.avg,
        peers_used: pa.peersUsed,
        peer_pct: peerPct,
        shipments: entry.weeks.get(week).shipments,
        is_candidate: isCandidate,
      });
    }
  }
  return rows;
}
