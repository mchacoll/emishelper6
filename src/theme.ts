import { I18nManager } from 'react-native';

export const colors = {
  navy: '#0F3B57',
  navyDark: '#0A2C42',
  navySoft: '#1B4D6E',
  gold: '#E8A93A',
  goldSoft: '#FBF1DD',
  bg: '#F3F6F9',
  card: '#FFFFFF',
  border: '#E1E8EE',
  text: '#13232E',
  muted: '#6B7C88',
  green: '#1E8E5A',
  greenSoft: '#E3F4EB',
  red: '#C0392B',
  redSoft: '#FBE7E5',
  purple: '#7B4FC0',
  purpleSoft: '#EFE8FA',
  blue: '#2F75A6',
  blueSoft: '#E4F0F8',
  orange: '#D9822B',
  orangeSoft: '#FCEFE1',
};

export const fonts = {
  regular: 'Cairo',
  bold: 'Cairo-Bold',
};

/** صف من اليمين إلى اليسار سواء كان النظام RTL أم لا */
export const ROW = I18nManager.isRTL ? 'row' : 'row-reverse';
export const TEXT_START = I18nManager.isRTL ? 'left' : 'right';

export const radius = { sm: 8, md: 12, lg: 18, xl: 24 };

export const shadow = {
  shadowColor: '#0A2C42',
  shadowOpacity: 0.12,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 6,
};
