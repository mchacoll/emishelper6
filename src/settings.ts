export type Settings = {
  siteUrl: string;
  emisUrl: string;
  split: boolean; // عرض النافذتين معاً (أعلى/أسفل)
  autoSwitch: boolean; // الانتقال تلقائياً إلى EMIS عند «تعبئة» ثم العودة بعد الحفظ
  desktopEmis: boolean; // عرض EMIS بعرض شاشة الكمبيوتر
  autoFillNext: boolean; // بعد «تمت المراجعة»: فتح «جديد» في EMIS وتعبئته تلقائياً
  showPageBar: boolean; // إظهار الشريط الأزرق داخل الصفحات (القديم)
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
  onboarded: false,
};

export const normUrl = (u: string) => {
  const t = u.trim();
  if (!t) return t;
  return /^https?:\/\//i.test(t) ? t : 'https://' + t;
};
