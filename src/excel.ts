import * as XLSX from 'xlsx';

/**
 * قراءة ملف Excel/CSV: كل صف = طالب.
 * الأعمدة تُعرف من عناوينها (عربي، أو أسماء حقول موقع الطلاب بالإنجليزي).
 * الناتج بنفس شكل بيانات المزامنة، فيُسجَّل في EMIS بنفس الطريقة.
 */

export type ExcelStudent = { k: string; d: Record<string, unknown> };
export type ExcelResult = {
  items: ExcelStudent[];
  rows: number; // صفوف بيانات في الملف
  noName: number; // صفوف بدون اسم
  duplicates: number; // مكرر داخل الملف
  sheet: string;
  columns: string[]; // الأعمدة التي فُهمت
  unknown: string[]; // أعمدة لم تُفهم
};

export const normAr = (s: unknown) =>
  String(s ?? '')
    .replace(/[ً-ٰٟـ‎‏]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[*:：]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();

// المفتاح ← العناوين المقبولة
const HEADERS: Record<string, string[]> = {
  fullName4: ['الاسم الرباعي', 'اسم الطالب الرباعي', 'الاسم الكامل', 'الاسم الثلاثي', 'الاسم الخماسي', 'الاسم واللقب'],
  name: ['الاسم', 'اسم الطالب', 'اسم الطالب الأول', 'الاسم الأول', 'اسم الطالبة', 'fullName', 'firstName'],
  father: ['اسم الأب', 'الأب', 'اسم الاب', 'fatherName'],
  grandfather: ['اسم والد الأب', 'اسم الجد', 'الجد', 'fatherFatherName'],
  greatGrandfather: ['اسم جد الأب', 'جد الأب', 'اسم والد الجد', 'fatherGrandfatherName'],
  surname: ['اللقب', 'familyName'],
  mother: ['اسم الأم', 'الأم', 'motherName'],
  motherFather: ['اسم والد الأم', 'motherFatherName'],
  motherGrandfather: ['اسم جد الأم', 'motherGrandfatherName'],
  dob: ['تاريخ التولد', 'تاريخ الولادة', 'المواليد', 'التولد', 'dateOfBirth'],
  nationalId: ['رقم البطاقة الموحدة', 'رقم البطاقة', 'البطاقة الموحدة', 'رقم البطاقة الوطنية', 'رقم البطاقة الوطنية الموحدة', 'رقم البطاقة / الجنسية', 'unifiedCardNumber'],
  idType: ['نوع الوثيقة', 'نوع الهوية', 'identityType'],
  civilRecord: ['رقم السجل', 'registryNumber'],
  civilSheet: ['رقم الصحيفة', 'pageNumber'],
  civilId: ['رقم الهوية', 'رقم هوية الأحوال المدنية', 'nationalId'],
  gender: ['الجنس', 'gender'],
  motherTongue: ['اللغة الأم', 'motherTongue'],
  blood: ['فئة الدم', 'زمرة الدم', 'bloodType'],
  religion: ['الديانة', 'الدين', 'religion'],
  phone: ['رقم الهاتف', 'الهاتف', 'الموبايل', 'رقم الموبايل', 'phone'],
  special: ['نوع الاحتياج الخاص', 'specialNeedsType'],
  living: ['المستوى المعيشي', 'livingStandard'],
  welfare: ['الرعاية الاجتماعية', 'مشمول بالرعاية الاجتماعية', 'socialCareIncluded'],
  grade: ['الصف الدراسي', 'الصف', 'المرحلة الدراسية', 'grade'],
  section: ['الشعبة', 'branch', 'section'],
  neighborhood: ['الحي / المنطقة', 'الحي', 'المنطقة', 'neighborhood'],
  mahalla: ['المحلة', 'رقم المحلة', 'district'],
  alley: ['الزقاق', 'رقم الزقاق', 'alley'],
  landmark: ['أقرب نقطة دالة', 'nearestLandmark'],
  school: ['المدرسة', 'اسم المدرسة'],
};
const LOOKUP = new Map<string, string>();
for (const [k, list] of Object.entries(HEADERS)) for (const h of list) LOOKUP.set(normAr(h), k);

const pad = (n: number) => String(n).padStart(2, '0');
function cellText(v: unknown, key: string): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    // التاريخ بدون فرق التوقيت
    const d = new Date(v.getTime() + 12 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (typeof v === 'number') {
    if (key === 'dob' && v > 1000 && v < 80000) {
      // رقم تاريخ Excel
      const p = XLSX.SSF.parse_date_code(v);
      if (p) return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
    }
    return Number.isInteger(v) ? v.toFixed(0) : String(v);
  }
  return String(v).replace(/\s+/g, ' ').trim();
}

/** ملف Excel (base64) أو CSV (نص UTF-8) */
export function parseWorkbook(src: { base64?: string; text?: string }): ExcelResult {
  const wb =
    src.text !== undefined
      ? XLSX.read(src.text.replace(/^\uFEFF/, ''), { type: 'string', cellDates: true, raw: true })
      : XLSX.read(src.base64 || '', { type: 'base64', cellDates: true });
  let best: ExcelResult | null = null;
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' });
    // صف العناوين: أول صف (من أول 15) فيه عمودان معروفان على الأقل
    let hi = -1;
    let map: (string | null)[] = [];
    for (let i = 0; i < Math.min(15, rows.length); i++) {
      const m = (rows[i] || []).map(c => LOOKUP.get(normAr(c)) || null);
      if (m.filter(Boolean).length >= 2) {
        hi = i;
        map = m;
        break;
      }
    }
    if (hi < 0) continue;
    const header = rows[hi] || [];
    const columns: string[] = [];
    const unknown: string[] = [];
    header.forEach((h, i) => {
      const t = String(h ?? '').trim();
      if (!t) return;
      if (map[i]) columns.push(t);
      else unknown.push(t);
    });
    // لا نكرر نفس المفتاح لعمودين
    const seenKey = new Set<string>();
    map = map.map(k => (k && !seenKey.has(k) ? (seenKey.add(k), k) : null));

    const items: ExcelStudent[] = [];
    const seen = new Set<string>();
    let dataRows = 0;
    let noName = 0;
    let duplicates = 0;
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (!row.some(c => String(c ?? '').trim())) continue;
      dataRows++;
      const d: Record<string, unknown> = {};
      map.forEach((k, i) => {
        if (!k) return;
        const t = cellText(row[i], k);
        if (t) d[k] = t;
      });
      // الاسم الرباعي في عمود واحد: نقسمه
      const full = String(d.fullName4 || '');
      delete d.fullName4;
      if (full) {
        const tk = full.split(/\s+/).filter(Boolean);
        if (!d.name) d.name = tk[0];
        else if (String(d.name).split(/\s+/).length > 1) d.name = String(d.name).split(/\s+/)[0];
        if (!d.father && tk[1]) d.father = tk[1];
        if (!d.grandfather && tk[2]) d.grandfather = tk[2];
        if (!d.greatGrandfather && tk[3]) d.greatGrandfather = tk[3];
        if (!d.surname && tk.length >= 5) d.surname = tk.slice(4).join(' ');
      } else if (d.name && !d.father) {
        // «الاسم» فيه الاسم كاملاً
        const tk = String(d.name).split(/\s+/).filter(Boolean);
        if (tk.length >= 3) {
          d.name = tk[0];
          d.father = tk[1];
          d.grandfather = tk[2];
          if (tk[3]) d.greatGrandfather = tk[3];
          if (tk.length >= 5 && !d.surname) d.surname = tk.slice(4).join(' ');
        }
      }
      if (!d.name) {
        noName++;
        continue;
      }
      if (d.nationalId) d.nationalId = String(d.nationalId).replace(/\D/g, '');
      d.reviewed = false;
      d.__src = 'excel';
      const k = normAr(d.name) + normAr(d.father) + normAr(d.grandfather) + normAr(d.greatGrandfather);
      if (seen.has(k)) {
        duplicates++;
        continue;
      }
      seen.add(k);
      items.push({ k, d });
    }
    const res: ExcelResult = { items, rows: dataRows, noName, duplicates, sheet: sheetName, columns, unknown };
    if (!best || res.items.length > best.items.length) best = res;
  }
  if (!best) throw new Error('لم أجد صف عناوين معروف (مثل «الاسم» و«اسم الأب») في الملف');
  return best;
}

/* ===================== قراءة عامة: أي ملف (لكل نماذج EMIS) ===================== */
export type GenericSheet = { sheet: string; headers: string[]; rows: string[][] };

/** كل الأعمدة كما هي: صف العناوين = أول صف فيه خليتان على الأقل */
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
      const filled = (raw[i] || []).filter(c => String(c ?? '').trim()).length;
      if (filled >= 2) {
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
      rows.push(headers.map((h, i) => cellText(row[i], /تاريخ|date/i.test(h) ? 'dob' : '')));
    }
    if (!best || rows.length > best.rows.length) best = { sheet: sheetName, headers, rows };
  }
  if (!best || !best.rows.length) throw new Error('الملف فارغ أو لا يحتوي صف عناوين');
  return best;
}
