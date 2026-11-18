import { I18nManager } from 'react-native';

/* (v8.24) وضع النهار والليل: ألوان كل الشاشات تُقرأ من اللوحة الحالية،
   فيتغيّر المظهر فوراً بدون إعادة تحميل صفحات الموقع و EMIS */

export type ThemeName = 'light' | 'dark';

const LIGHT = {
  header: '#0C2C44', // شريط العنوان
  headerLine: '#C9A24A', // الخط الذهبي تحت الشريط
  navy: '#0F3B57', // اللون الأساسي (أزرار، روابط، أيقونات)
  navyDark: '#0A2335', // نص فوق الذهبي
  navySoft: '#1B4D6E',
  gold: '#D4A445',
  goldSoft: '#FBF3E2',
  bg: '#F3F5F9',
  card: '#FFFFFF',
  border: '#E2E7EE',
  text: '#13212C',
  muted: '#6A7886',
  green: '#1E8E5A',
  greenSoft: '#E3F4EB',
  red: '#C0392B',
  redSoft: '#FBE7E5',
  purple: '#7B4FC0',
  purpleSoft: '#EFE8FA',
  blue: '#2F75A6',
  blueSoft: '#E6EFF7',
  orange: '#D9822B',
  orangeSoft: '#FCEFE1',
  track: '#CBD5DC',
  shadow: '#0A2C42',
};

const DARK: typeof LIGHT = {
  header: '#0A111D',
  headerLine: '#C9A24A',
  navy: '#5A9BD5',
  navyDark: '#0A1626',
  navySoft: '#3D79B0',
  gold: '#D9AB52',
  goldSoft: '#2E2615',
  bg: '#0E1522',
  card: '#162133',
  border: '#24324A',
  text: '#E8EDF4',
  muted: '#8D9AB0',
  green: '#43C08A',
  greenSoft: '#11291F',
  red: '#F0715F',
  redSoft: '#33191A',
  purple: '#AC8BEA',
  purpleSoft: '#241D36',
  blue: '#64A9DE',
  blueSoft: '#1A2A40',
  orange: '#F0A35A',
  orangeSoft: '#33240F',
  track: '#33435C',
  shadow: '#000000',
};

let current: ThemeName = 'light';
export const setThemeName = (t: ThemeName) => {
  current = t;
};
export const themeName = () => current;

/** الألوان الحالية (تتبع وضع النهار/الليل) */
export const colors: typeof LIGHT = new Proxy({} as typeof LIGHT, {
  get: (_t, k) => (current === 'dark' ? DARK : LIGHT)[k as keyof typeof LIGHT],
});

/** أنماط تُبنى لكل وضع مرة واحدة: themed(() => StyleSheet.create({...})) */
export function themed<T extends object>(factory: () => T): T {
  const cache: Partial<Record<ThemeName, T>> = {};
  return new Proxy({} as T, {
    get: (_t, k) => {
      const c = cache[current] ?? (cache[current] = factory());
      return c[k as keyof T];
    },
  });
}

export const fonts = {
  regular: 'Cairo',
  bold: 'Cairo-Bold',
};

/** صف من اليمين إلى اليسار سواء كان النظام RTL أم لا */
export const ROW = I18nManager.isRTL ? 'row' : 'row-reverse';
export const TEXT_START = I18nManager.isRTL ? 'left' : 'right';

export const radius = { sm: 10, md: 14, lg: 20, xl: 26 };

export const shadow = {
  shadowColor: '#0A2C42',
  shadowOpacity: 0.12,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 6,
};
