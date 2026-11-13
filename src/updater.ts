import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

import { USERSCRIPT_SOURCE } from './userscript.generated';

/**
 * التحديث من داخل التطبيق:
 *  - كل بناء ينشر «إصداراً» عاماً على GitHub فيه: emishelper.apk + version.json + emis-helper.user.js
 *  - التطبيق يقرأ version.json: إن كان هناك APK أحدث يعرض «تحديث جديد» ويثبّته بضغطة
 *  - وإن كان السكربت أحدث فقط، يُنزَّل ويُستخدم فوراً بدون إعادة تثبيت التطبيق
 */
const REPO = 'mchacoll/emishelper6';
const BASE = `https://github.com/${REPO}/releases/latest/download/`;
const K_OTA = 'ota_script_v1';

export type Manifest = {
  version: string; // إصدار التطبيق (للعرض)
  versionCode: number; // رقم البناء
  scriptVersion: string;
  scriptMinBuild: number; // أقل رقم بناء للتطبيق يعمل معه هذا السكربت
  notes: string[];
};

export const installedBuild = (): number => {
  const c = Constants.expoConfig as { android?: { versionCode?: number } } | null;
  return Number(c?.android?.versionCode || 0);
};
export const installedVersion = (): string => String(Constants.expoConfig?.version || '');

const versionOf = (src: string) => (src.match(/@version\s+([\d.]+)/) || [])[1] || '0';
export const EMBEDDED_SCRIPT_VERSION = versionOf(USERSCRIPT_SOURCE);

/** مقارنة أرقام الإصدار 7.7.1 > 7.7.0 */
export function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function fetchManifest(): Promise<Manifest | null> {
  try {
    const r = await fetch(BASE + 'version.json?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) return null;
    const m = await r.json();
    if (!m || typeof m.versionCode !== 'number') return null;
    return { notes: [], scriptMinBuild: 0, ...m };
  } catch {
    return null;
  }
}

/** السكربت المستخدم: آخر سكربت نُزّل (إن كان أحدث من المدمج في التطبيق) */
export async function loadScript(): Promise<{ source: string; version: string }> {
  try {
    const raw = await AsyncStorage.getItem(K_OTA);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o.source === 'string' && newer(o.version, EMBEDDED_SCRIPT_VERSION) && installedBuild() >= (o.minBuild || 0)) {
        return { source: o.source, version: o.version };
      }
    }
  } catch {
    /* ignore */
  }
  return { source: USERSCRIPT_SOURCE, version: EMBEDDED_SCRIPT_VERSION };
}

/** تنزيل سكربت أحدث إن وُجد. يعيد الإصدار الجديد أو null */
export async function updateScript(m: Manifest, currentVersion: string): Promise<{ source: string; version: string } | null> {
  if (!newer(m.scriptVersion, currentVersion) || installedBuild() < (m.scriptMinBuild || 0)) return null;
  try {
    const r = await fetch(BASE + 'emis-helper.user.js?t=' + Date.now());
    if (!r.ok) return null;
    const source = await r.text();
    // تحقق بسيط أنه سكربت المساعد فعلاً وكاملاً
    if (!source.includes('// ==UserScript==') || !source.includes('startEmis') || versionOf(source) !== m.scriptVersion) return null;
    await AsyncStorage.setItem(K_OTA, JSON.stringify({ source, version: m.scriptVersion, minBuild: m.scriptMinBuild || 0 }));
    return { source, version: m.scriptVersion };
  } catch {
    return null;
  }
}

/** تنزيل APK الجديد ثم فتح شاشة التثبيت */
export async function downloadAndInstall(onProgress: (p: number) => void): Promise<void> {
  const dest = (FileSystem.cacheDirectory || '') + 'emishelper-update.apk';
  try {
    await FileSystem.deleteAsync(dest, { idempotent: true });
  } catch {
    /* ignore */
  }
  const task = FileSystem.createDownloadResumable(BASE + 'emishelper.apk', dest, {}, d => {
    if (d.totalBytesExpectedToWrite > 0) onProgress(d.totalBytesWritten / d.totalBytesExpectedToWrite);
  });
  const res = await task.downloadAsync();
  if (!res || res.status !== 200) throw new Error('فشل التنزيل (' + (res ? res.status : '?') + ')');
  const uri = await FileSystem.getContentUriAsync(res.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: uri,
    type: 'application/vnd.android.package-archive',
    flags: 0x00000001 | 0x10000000, // GRANT_READ_URI_PERMISSION | NEW_TASK
  });
}
