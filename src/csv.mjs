export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  return rows
    .filter((r) => r.length >= header.length)
    .map((r) => {
      // sample_output_format_v2.csv has an unquoted comma in row 3's reason column;
      // merge any trailing elements back into the last column so it parses cleanly.
      const cells = r.length > header.length
        ? [...r.slice(0, header.length - 1), r.slice(header.length - 1).join(',')]
        : r;
      return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
    });
}

export function readCSVObjects(text) {
  return parseCSV(text);
}

function escapeField(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV(rows, columns) {
  const cols = columns ?? Object.keys(rows[0] ?? {});
  const lines = [cols.join(',')];
  for (const r of rows) {
    lines.push(cols.map((c) => escapeField(r[c])).join(','));
  }
  return lines.join('\n') + '\n';
}
