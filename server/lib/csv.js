// Eksport CSV zgodny z Excelem (BOM + średnik jako separator, jak w polskich ustawieniach)
export function toCsv(rows, columns) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => cell(c.label)).join(';');
  const body = rows.map((r) => columns.map((c) => cell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(';'));
  return '﻿' + [head, ...body].join('\r\n');
}
