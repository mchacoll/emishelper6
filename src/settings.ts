/** قاعدة مدرسة: كيف تُملأ قيم المكان والمدينة ولغة الدراسة لطلابها */
export type SchoolRule = {
  key: string; // كلمة من اسم المدرسة ('' = باقي المدارس)
  mode: 'fixed' | 'form'; // ثابت من هنا / حسب استمارة الطالب
  gov?: string; // المحافظة
  place?: string; // المكان
  city?: string; // المدينة
  lang?: string; // لغة الدراسة
};

export type Settings = {
  siteUrl: string;
  emisUrl: string;
  split: boolean; // عرض النافذتين معاً (أعلى/أسفل)
  autoSwitch: boolean; // عرض EMIS تلقائياً أثناء التعبئة من Excel
  desktopEmis: boolean; // عرض EMIS بعرض شاشة الكمبيوتر
  desktopUA: boolean; // تعريف EMIS بأننا متصفح كمبيوتر
  showPageBar: boolean; // إظهار الشريط الأزرق داخل الصفحات (القديم)
  schools: SchoolRule[];
  onboarded: boolean;
  phoneV1: boolean; // (v8.5) انتقلنا لعرض EMIS بشكل الهاتف مرة واحدة
  schoolsV3?: boolean; // (v8.27) أُضيفت مدرسة الوجدان
  schoolsV2?: boolean; // (v8.25) أُضيفت مدرسة التوحيد (حسب الاستمارة) مرة واحدة
  theme: 'auto' | 'light' | 'dark'; // (v8.24) المظهر: حسب الهاتف / نهاري / ليلي
  owner: boolean; // (v8.21) وضع المالك: نوافذ التحديث وزر «التحقق من التحديث» تظهر في هذا الهاتف فقط
};

export const DEFAULT_SCHOOLS: SchoolRule[] = [
  { key: 'ابن بطوطة', mode: 'form' },
  { key: 'ميثم التمار', mode: 'form' },
  { key: 'التوحيد', mode: 'form' },
  { key: 'الوجدان', mode: 'form' },
  { key: '', mode: 'fixed', gov: 'ديالى', place: 'مركز قضاء خانقين', city: 'خانقين', lang: 'العربية' },
];

export const DEFAULT_SETTINGS: Settings = {
  siteUrl: 'https://studentgate-kbbtktoc.manus.space',
  emisUrl: 'https://emis.moedu.gov.iq',
  split: false,
  autoSwitch: true,
  desktopEmis: false,
  desktopUA: false,
  showPageBar: false,
  schools: DEFAULT_SCHOOLS,
  onboarded: false,
  phoneV1: true,
  owner: false,
  theme: 'auto',
};

/** القواعد كما تُرسل للسكربت: المدارس المسماة أولاً، ثم قاعدة «باقي المدارس» */
export function normalizedSchools(list: SchoolRule[] | undefined): SchoolRule[] {
  const src = Array.isArray(list) && list.length ? list : DEFAULT_SCHOOLS;
  const named = src.filter(r => r && r.key && r.key.trim());
  const def = src.find(r => r && !(r.key || '').trim()) || DEFAULT_SCHOOLS[DEFAULT_SCHOOLS.length - 1];
  return [...named, { ...def, key: '' }];
}

export const normUrl = (u: string) => {
  const t = u.trim();
  if (!t) return t;
  return /^https?:\/\//i.test(t) ? t : 'https://' + t;
};
