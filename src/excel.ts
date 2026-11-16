import * as XLSX from 'xlsx';

/** قراءة ملف Excel/CSV (كل الأعمدة كما هي) + تصدير جدول إلى ملف xlsx */

const pad = (n: number) => String(n).padStart(2, '0');
function cellText(v: unknown, isDate: boolean): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    const d = new Date(v.getTime() + 12 * 3600 * 1000); // بدون فرق التوقيت
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (typeof v === 'number') {
    if (isDate && v > 1000 && v < 80000) {
      const p = XLSX.SSF.parse_date_code(v); // رقم تاريخ Excel
      if (p) return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
    }
    return Number.isInteger(v) ? v.toFixed(0) : String(v);
  }
  return String(v).replace(/\s+/g, ' ').trim();
}

export type GenericSheet = { sheet: string; headers: string[]; rows: string[][] };

/** صف العناوين = أول صف فيه خليتان على الأقل */
export function parseGeneric(src: { base64?: string; text?: string }): GenericSheet {
  const wb =
    src.text !== undefined
      ? XLSX.read(src.text.replace(/^﻿/, ''), { type: 'string', cellDates: true, raw: true })
      : XLSX.read(src.base64 || '', { type: 'base64', cellDates: true });
  let best: GenericSheet | null = null;
  for (const sheetName of wb.SheetNames) {
    const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' });
    let hi = -1;
    for (let i = 0; i < Math.min(15, raw.length); i++) {
      if ((raw[i] || []).filter(c => String(c ?? '').trim()).length >= 2) {
        hi = i;
        break;
      }
    }
    if (hi < 0) continue;
    const headers = (raw[hi] || []).map(h => String(h ?? '').replace(/\s+/g, ' ').trim());
    const rows: string[][] = [];
    for (let r = hi + 1; r < raw.length; r++) {
      const row = raw[r] || [];
      if (!row.some(c => String(c ?? '').trim())) continue;
      rows.push(headers.map((h, i) => cellText(row[i], /تاريخ|date/i.test(h))));
    }
    if (!best || rows.length > best.rows.length) best = { sheet: sheetName, headers, rows };
  }
  if (!best || !best.rows.length) throw new Error('الملف فارغ أو لا يحتوي صف عناوين');
  return best;
}

/** جدول ← ملف xlsx (base64) */
export function toXlsxBase64(headers: string[], rows: (string | number)[][], sheetName = 'Sheet1'): string {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h, i) => ({ wch: Math.min(60, Math.max(h.length, ...rows.slice(0, 200).map(r => String(r[i] ?? '').length)) + 2) }));
  const wb = XLSX.utils.book_new();
  if (!wb.Workbook) wb.Workbook = {};
  wb.Workbook.Views = [{ RTL: true }];
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}
