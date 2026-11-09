export type Settings = {
  siteUrl: string;
  emisUrl: string;
  split: boolean; // عرض النافذتين معاً (أعلى/أسفل)
  autoSwitch: boolean; // الانتقال تلقائياً إلى EMIS عند «تعبئة» ثم العودة بعد الحفظ
  desktopEmis: boolean; // عرض EMIS بعرض شاشة الكمبيوتر
  autoFillNext: boolean; // بعد «تمت المراجعة»: فتح «جديد» في EMIS وتعبئته تلقائياً
  showPageBar: boolean; // إظهار الشريط الأزرق داخل الصفحات (القديم)
  autoPilot: boolean; // الإضافة التلقائية: مراقبة موقع الطلاب وإدخال كل استمارة جديدة في EMIS
  autoPilotMinutes: number; // كل كم دقيقة يُفحص موقع الطلاب
  onboarded: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  siteUrl: 'https://studentgate-kbbtktoc.manus.space',
  emisUrl: 'https://emis.moedu.gov.iq',
  split: false,
  autoSwitch: true,
  desktopEmis: false,
  autoFillNext: false,
  showPageBar: false,
  autoPilot: false,
  autoPilotMinutes: 2,
  onboarded: false,
};

export const normUrl = (u: string) => {
  const t = u.trim();
  if (!t) return t;
  return /^https?:\/\//i.test(t) ? t : 'https://' + t;
};
