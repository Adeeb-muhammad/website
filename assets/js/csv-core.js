// One CSV reader and writer for both Utility Desk converters: the Text & code
// panel and the File converter. Browser-independent so Node can test it.
//
// Rules, applied identically everywhere:
// - a quote only starts a quoted cell at the beginning of that cell; a stray
//   quote elsewhere is kept as literal text;
// - `""` inside a quoted cell is one quote; an unclosed quote is an error;
// - CRLF, LF and lone CR all end a record, and a newline inside quotes is data;
// - a completely blank line is skipped, but a row made of delimiters (`,`, `,,`)
//   is a real row of empty cells and is kept;
// - headers are trimmed, must be non-empty and must be unique;
// - a row with more cells than there are headers is an error, never a silent drop.

export function parseCSV(text) {
  let source = String(text ?? '');
  // A UTF-8 BOM from Excel or a text editor is not part of the first header.
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    cell = '';
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  endRow();
  return rows;
}

// Turns CSV text into objects keyed by the trimmed header row. Empty input and a
// header with no data rows both return [], so every caller agrees on the result.
export function csvToObjects(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const headers = rows[0].map(header => header.trim());
  if (headers.some(header => !header)) {
    throw new Error('CSV headers must be non-empty.');
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error('CSV headers must be unique. Rename or remove the duplicate column.');
  }
  return rows.slice(1).map((row, index) => {
    if (row.length > headers.length) {
      throw new Error(`CSV row ${index + 2} has ${row.length} cells but there are ${headers.length} headers.`);
    }
    const record = {};
    headers.forEach((header, column) => { record[header] = row[column] ?? ''; });
    return record;
  });
}

export function csvCell(value) {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

// Objects to CSV, used by the JSON → CSV mode of both converters.
export function jsonToCSV(data) {
  if (!Array.isArray(data) || !data.length || data.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('JSON → CSV needs a non-empty array of objects.');
  }
  const headers = [...new Set(data.flatMap(Object.keys))];
  return [headers, ...data.map(row => headers.map(key => row[key]))]
    .map(row => row.map(csvCell).join(','))
    .join('\r\n');
}
