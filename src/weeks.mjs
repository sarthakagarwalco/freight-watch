const DAY_MS = 86400000;

export function parseDate(iso) {
  return new Date(iso + 'T00:00:00Z');
}

// Returns the ISO Monday (YYYY-MM-DD) for the Mon-Sun week containing `iso`
export function mondayOf(iso) {
  const d = parseDate(iso);
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return new Date(parseDate(iso).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

export function sundayOf(monday) {
  return addDays(monday, 6);
}
