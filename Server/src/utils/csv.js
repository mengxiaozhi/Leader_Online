// Quote every field so commas, quotes and line breaks remain inside their cell.
// Treat spreadsheet formulas and leading-zero identifiers as text when opened in Excel.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text) || /^0\d+$/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(rows) {
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { buildCsv };
