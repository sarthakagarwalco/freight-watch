import { addDays } from './weeks.mjs';

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const RANGE_RE = /\bfrom\s+([A-Za-z]{3,9}\.?\s+\d{1,2})(?:\s*,?\s*(?:\d{4}))?\s+to\s+([A-Za-z]{3,9}\.?\s+\d{1,2})/i;

// Phrases indicating no upward cost impact
const NO_IMPACT_RE = new RegExp(
  [
    'not significantly affected',
    'no major disruptions',
    'no significant disruptions',
    'returned to normal',
    'without a rate change',
    'not part of this dataset',
    'remain(?:ed|s)? (?:stable|normal)',
    'improved road',
    'demand .* remained stable',
  ].join('|'),
  'i'
);

const UP_RE = new RegExp(
  [
    'higher trip costs',
    'surcharge',
    'pushing up',
    'rose nationwide',
    'transportation costs .* (?:rose|up|increased)',
    'costs? (?:went|rise|rose|increased|climbed)',
    'increase[d]? (?:by|in) cost',
  ].join('|'),
  'i'
);

function toISO(monthName, day, year) {
  const m = MONTHS[monthName.slice(0, 3).toLowerCase()];
  if (!m) return null;
  return `${year}-${m}-${String(Number(day)).padStart(2, '0')}`;
}

function deriveWindow(noteDate, text) {
  const year = noteDate.slice(0, 4);

  const r = RANGE_RE.exec(text);
  if (r) {
    const a = toISO(r[1].trim(), r[1].trim().split(/\s+/)[1], year);
    const b = toISO(r[2].trim(), r[2].trim().split(/\s+/)[1], year);
    if (a && b) return { start: a, end: b, basis: 'explicit_range' };
  }

  const dur = /for about (a|an|\d+) (week|weeks|month|months)/i.exec(text);
  if (dur) {
    const n = dur[1].toLowerCase() === 'a' || dur[1].toLowerCase() === 'an' ? 1 : Number(dur[1]);
    const mult = /month/.test(dur[2]) ? 30 : 7;
    return { start: noteDate, end: addDays(noteDate, n * mult - 1), basis: 'duration_phrase' };
  }

  if (/starting (?:this week|from|the week)/i.test(text)) {
    return { start: noteDate, end: addDays(noteDate, 27), basis: 'open_28d' };
  }

  return { start: noteDate, end: noteDate, basis: 'single_week' };
}

function classifyKind(text) {
  if (/returned to normal|back to normal/i.test(text)) return 'recovery';
  if (/improved road|resurfac/i.test(text)) return 'road_improved';
  if (/flood/i.test(text)) return 'weather_flood';
  if (/festival/i.test(text)) return 'festival_surcharge';
  if (/diesel|fuel/i.test(text)) return 'fuel_price';
  if (/toll/i.test(text)) return 'toll_change';
  if (/maintenance|resurfac/i.test(text)) return 'road_works';
  if (/tracking mandate|mandate/i.test(text)) return 'regulation';
  if (/report/i.test(text)) return 'industry_report';
  return 'other';
}

export function structureNote(row) {
  const text = row.note;
  const appliesAll = /^all routes$/i.test(row.applies_to.trim());
  const routes = appliesAll ? ['*'] : [row.applies_to.trim()];
  const win = deriveWindow(row.date, text);
  const noImpact = NO_IMPACT_RE.test(text);
  const up = !noImpact && UP_RE.test(text);
  const costEffect = up ? 'up' : 'none';

  return {
    note_id: row.note_id,
    date: row.date,
    applies_to: row.applies_to.trim(),
    routes,
    kind: classifyKind(text),
    window_start: win.start,
    window_end: win.end,
    window_basis: win.basis,
    cost_effect: costEffect,
    can_justify: costEffect === 'up',
    text,
  };
}

export function structureNotes(noteRows) {
  return noteRows.map(structureNote);
}

export function routeMatches(note, route) {
  return note.routes.includes('*') || note.routes.includes(route);
}

export function windowCoversWeek(note, weekMonday) {
  const weekEnd = addDays(weekMonday, 6);
  return note.window_start <= weekEnd && note.window_end >= weekMonday;
}

export function findJustification(notes, route, weekMonday) {
  const hits = notes.filter(
    (n) => n.can_justify && routeMatches(n, route) && windowCoversWeek(n, weekMonday)
  );
  if (!hits.length) return null;

  // Prefer route-specific notes over 'All Routes', then closest start date
  hits.sort((a, b) => {
    const specA = a.routes.includes('*') ? 1 : 0;
    const specB = b.routes.includes('*') ? 1 : 0;
    if (specA !== specB) return specA - specB;
    const da = Math.abs(daysBetween(a.window_start, weekMonday));
    const db = Math.abs(daysBetween(b.window_start, weekMonday));
    if (da !== db) return da - db;
    return a.note_id.localeCompare(b.note_id);
  });
  return hits[0];
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

export function nearestApplicableNote(notes, route, weekMonday, maxDistDays = 28) {
  let best = null;
  for (const n of notes) {
    if (!routeMatches(n, route)) continue;
    const d = Math.abs(daysBetween(n.date, weekMonday));
    if (d > maxDistDays) continue;
    if (!best || d < best.dist || (d === best.dist && n.note_id < best.note.note_id)) {
      best = { note: n, dist: d };
    }
  }
  return best ? best.note : null;
}
