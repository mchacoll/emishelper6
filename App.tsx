import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useFonts } from 'expo-font';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, Share, StyleSheet, ToastAndroid, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import {
  buildInjection,
  clickBarJs,
  desktopViewportJs,
  diagnoseListJs,
  hostOf,
  parseBridgeMessage,
  remoteSetJs,
  syncAndBootJs,
} from './src/bridge';
import { ControlPanel, type Phase, type QItem } from './src/ControlPanel';
import { type ExcelResult, parseGeneric, parseWorkbook } from './src/excel';
import { type ExcelData, ExcelScreen } from './src/ExcelScreen';
import { Onboarding } from './src/Onboarding';
import { type SyncState, SyncScreen } from './src/SyncScreen';
import { UpdateModal } from './src/UpdateModal';
import { fetchManifest, installedBuild, installedVersion, loadScript, type Manifest, updateScript } from './src/updater';
import { DEFAULT_SETTINGS, normUrl, type Settings } from './src/settings';
import { type LogLine, SettingsScreen } from './src/SettingsScreen';
import { colors, ROW } from './src/theme';
import { Icon, IconButton, type IconName, T } from './src/ui';

type Pane = 'site' | 'emis';
type Tab = Pane | 'excel';

const APP_VERSION = installedVersion() || '7.7.1';
const K_SETTINGS = 'app_settings_v1';
const K_STORE = 'gm_store_v1';
const K_QUEUE_APP = 'app_queue_v1'; // قائمة التسجيل في التطبيق
const K_DONE_APP = 'app_done_keys_v1'; // الطلاب الذين سُجّلوا في EMIS (لمنع التكرار)
// مفاتيح السكربت
const K_DATA = 'emis_student_v2';
const K_CMD = 'emis_cmd_v2';
const K_STATUS = 'emis_status_v2';
const K_QUEUE = 'emis_queue_v1';
const K_SYNC = 'emis_sync_v1';
const K_MARK = 'emis_mark_v1';
const K_EXIST = 'emis_existing_v1';
const K_GSTAT = 'emis_generic_status_v1';
const K_EXCEL_APP = 'app_excel_v1';
const DESKTOP_WIDTH = 1280;
// متصفح كمبيوتر: EMIS يفتح القوائم المنسدلة تحت الحقل بدل نافذة ملء الشاشة الخاصة بالهاتف
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

const toast = (t: string) => {
  try {
    ToastAndroid.show(t, ToastAndroid.SHORT);
  } catch {
    /* ignore */
  }
};
const hhmm = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const nameOf = (i?: QItem | null) => (i ? [i.d.name, i.d.father, i.d.grandfather].filter(Boolean).join(' ') : '');

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const [fontsLoaded] = useFonts({
    Cairo: require('./assets/fonts/Cairo-Regular.ttf'),
    'Cairo-Bold': require('./assets/fonts/Cairo-Bold.ttf'),
  });
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [active, setActive] = useState<Tab>('site');
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [errors, setErrors] = useState<LogLine[]>([]);
  const [reloadKey, setReloadKey] = useState({ site: 0, emis: 0 });
  const [loading, setLoading] = useState<Record<Pane, boolean>>({ site: true, emis: true });
  const [barLog, setBarLog] = useState<Record<Pane, string>>({ site: '', emis: '' });

  const [phase, setPhase] = useState<Phase>('idle');
  const [detail, setDetail] = useState('');
  const [syncText, setSyncText] = useState('');
  const [apNote, setApNote] = useState('');
  const [script, setScript] = useState<{ source: string; version: string } | null>(null);
  const [update, setUpdate] = useState<Manifest | null>(null);

  // قائمة التسجيل
  const [queue, setQueueState] = useState<QItem[]>([]);
  const queueRef = useRef<QItem[]>([]);
  const doneKeys = useRef(new Set<string>());
  const [running, setRunningState] = useState(false);
  const runningRef = useRef(false);
  const currentKey = useRef<string | null>(null);
  const syncingRef = useRef(false);
  const syncAfterReload = useRef(false);
  const syncReload = useRef(false);
  const syncStep = useRef<'none' | 'emis' | 'site'>('none');
  const existingRef = useRef<{ keys: string[]; ids: string[]; rows: number } | null>(null);
  const syncWarn = useRef('');
  const pendingImport = useRef<(ExcelResult & { fileName: string }) | null>(null);
  const [excel, setExcelState] = useState<ExcelData | null>(null);
  const excelRef = useRef<ExcelData | null>(null);
  const excelStudents = useRef<ExcelResult | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);
  const setExcel = (fn: (e: ExcelData | null) => ExcelData | null) => {
    const next = fn(excelRef.current);
    excelRef.current = next;
    setExcelState(next);
    if (next) AsyncStorage.setItem(K_EXCEL_APP, JSON.stringify(next)).catch(() => {});
    else AsyncStorage.removeItem(K_EXCEL_APP).catch(() => {});
  };
  const [syncUI, setSyncUI] = useState<SyncState>({ visible: false, step: 'done', text: '', percent: 0 });
  const runAfterSync = useRef(false);
  const lastActivity = useRef(0);

  // مخزن GM_* المشترك بين النافذتين
  const store = useRef<Record<string, unknown>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const siteRef = useRef<WebView>(null);
  const emisRef = useRef<WebView>(null);
  const views: Record<Pane, RefObject<WebView | null>> = { site: siteRef, emis: emisRef };
  const canBack = useRef<Record<Pane, boolean>>({ site: false, emis: false });
  const activeRef = useRef<Tab>('site');
  activeRef.current = active;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* ---------- الحفظ ---------- */
  const setQueue = (fn: (q: QItem[]) => QItem[]) => {
    const next = fn(queueRef.current);
    queueRef.current = next;
    setQueueState(next);
    AsyncStorage.setItem(K_QUEUE_APP, JSON.stringify(next)).catch(() => {});
  };
  const updateItem = (k: string, patch: Partial<QItem>) =>
    setQueue(q => q.map(i => (i.k === k ? { ...i, ...patch, t: Date.now() } : i)));
  const addDone = (k: string) => {
    doneKeys.current.add(k);
    AsyncStorage.setItem(K_DONE_APP, JSON.stringify([...doneKeys.current].slice(-5000))).catch(() => {});
  };
  const setRunning = (v: boolean) => {
    runningRef.current = v;
    setRunningState(v);
  };

  useEffect(() => {
    (async () => {
      try {
        const [s, st, q, dk] = await Promise.all([
          AsyncStorage.getItem(K_SETTINGS),
          AsyncStorage.getItem(K_STORE),
          AsyncStorage.getItem(K_QUEUE_APP),
          AsyncStorage.getItem(K_DONE_APP),
        ]);
        const loaded: Settings = s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS;
        setSettings(loaded);
        if (!loaded.onboarded) setShowGuide(true);
        if (st) store.current = JSON.parse(st) || {};
        if (q) {
          // ما كان «يُسجَّل» عند إغلاق التطبيق يعود لـ«بانتظار التسجيل»
          const items: QItem[] = (JSON.parse(q) || []).map((i: QItem) => (i.status === 'working' ? { ...i, status: 'pending' } : i));
          queueRef.current = items;
          setQueueState(items);
        }
        if (dk) doneKeys.current = new Set(JSON.parse(dk) || []);
      } catch {
        /* ignore */
      }
      try {
        const xr = await AsyncStorage.getItem(K_EXCEL_APP);
        if (xr) {
          const xd = JSON.parse(xr);
          excelRef.current = xd;
          setExcelState(xd);
        }
      } catch {
        /* ignore */
      }
      setScript(await loadScript());
      setReady(true);
    })();
  }, []);

  const persistStore = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(K_STORE, JSON.stringify(store.current)).catch(() => {});
    }, 400);
  }, []);

  const saveSettings = useCallback((next: Settings) => {
    setSettings(next);
    AsyncStorage.setItem(K_SETTINGS, JSON.stringify(next)).catch(() => {});
  }, []);

  /* ---------- السكربت المحقون ---------- */
  const injection = useMemo(() => {
    const siteHost = hostOf(normUrl(settings.siteUrl));
    const emisHost = hostOf(normUrl(settings.emisUrl));
    return buildInjection(siteHost ? [siteHost] : [], emisHost ? [emisHost] : [], !settings.showPageBar, script?.source);
  }, [settings.siteUrl, settings.emisUrl, settings.showPageBar, script]);

  /* ---------- التحديث ---------- */
  const scriptRef = useRef(script);
  scriptRef.current = script;
  const checkUpdates = async (manual: boolean) => {
    const m = await fetchManifest();
    if (!m) {
      if (manual) toast('تعذّر التحقق من التحديث (تحقق من الإنترنت)');
      return;
    }
    if (m.versionCode > installedBuild()) {
      setUpdate(m);
      return;
    }
    const cur = scriptRef.current?.version || '0';
    const ns = await updateScript(m, cur);
    if (ns) {
      setScript(ns);
      Alert.alert('تم تحديث السكربت', `السكربت الآن v${ns.version}. إعادة تحميل الصفحتين لتطبيقه؟`, [
        { text: 'لاحقاً', style: 'cancel' },
        {
          text: 'إعادة التحميل',
          onPress: () => setReloadKey(k => ({ site: k.site + 1, emis: k.emis + 1 })),
        },
      ]);
      return;
    }
    if (manual) toast('لديك آخر إصدار');
  };
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => checkUpdates(false), 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const addError = useCallback((pane: Pane, level: string, msg: string) => {
    setErrors(prev => [...prev.slice(-199), { t: Date.now(), pane, level, msg }]);
  }, []);

  /** كتابة قيمة في مخزن السكربت وإيصالها لإحدى الشاشتين */
  const gmSet = (k: string, v: unknown, to: Pane) => {
    store.current[k] = v;
    persistStore();
    views[to].current?.injectJavaScript(remoteSetJs(k, v));
  };

  /* ===================== المزامنة ===================== */
  // ١) قراءة طلاب EMIS الحقيقي  ٢) قراءة موقع الطلاب وتخطي الموجودين في EMIS
  const startSync = (reloadFirst: boolean, forImport = false) => {
    if (syncingRef.current) return;
    if (!forImport) pendingImport.current = null;
    syncingRef.current = true;
    syncReload.current = reloadFirst;
    existingRef.current = null;
    syncWarn.current = '';
    setPhase('syncing');
    setDetail('');
    setSyncText('قراءة طلاب EMIS...');
    lastActivity.current = Date.now();
    setSyncUI(u => ({
      visible: !reloadFirst,
      step: 'emis',
      title: forImport ? u.title : 'مزامنة الطلاب',
      text: 'قراءة طلاب EMIS الحقيقي...',
      percent: forImport ? 10 : 3,
    }));
    emisRef.current?.injectJavaScript(
      '(function(){var ok=!!window.__emisList;if(ok)window.__emisList();' +
        'try{window.ReactNativeWebView.postMessage(JSON.stringify({__gm:"act",action:"list:emis",ok:ok}))}catch(e){}})();true;',
    );
    const myStart = lastActivity.current;
    setTimeout(() => {
      if (syncingRef.current && syncStep.current === 'emis' && lastActivity.current === myStart) {
        syncWarn.current = 'انتهت مهلة قراءة EMIS — زامنت بدون فحص EMIS';
        goSite();
      }
    }, 100000);
    syncStep.current = 'emis';
  };
  const goSite = () => {
    if (pendingImport.current) {
      mergeImport();
      return;
    }
    syncStep.current = 'site';
    setSyncText('قراءة الطلاب من موقعك...');
    setSyncUI(u => ({ ...u, step: 'site', text: 'قراءة الطلاب من موقعك...', percent: 35 }));
    if (syncReload.current) {
      // تحديث موقع الطلاب أولاً لجلب الاستمارات الجديدة، ثم المزامنة عند جاهزيته
      syncAfterReload.current = true;
      setReloadKey(k => ({ ...k, site: k.site + 1 }));
      setTimeout(() => {
        if (syncAfterReload.current) {
          syncAfterReload.current = false;
          syncFailed('لم يجهز موقع الطلاب بعد التحديث');
        }
      }, 45000);
    } else {
      injectSync();
    }
  };
  const onEmisList = (raw: string) => {
    if (!syncingRef.current || syncStep.current !== 'emis') return;
    let p: { done?: boolean; error?: string; rows?: number; total?: number; keys?: string[]; ids?: string[] };
    try {
      p = JSON.parse(raw);
    } catch {
      return;
    }
    lastActivity.current = Date.now();
    if (!p.done) {
      const pct = p.total ? 5 + (30 * (p.rows || 0)) / p.total : Math.min(30, 5 + (p.rows || 0) / 3);
      setSyncUI(u => ({ ...u, text: `قراءة طلاب EMIS... ${p.rows || 0}${p.total ? ' من ' + p.total : ''}`, percent: pct }));
      return;
    }
    if (p.error) {
      syncWarn.current = p.error + ' — زامنت بدون فحص EMIS';
    } else {
      existingRef.current = { keys: p.keys || [], ids: p.ids || [], rows: p.rows || 0 };
    }
    goSite();
  };
  const injectSync = () => {
    // الطلاب المعروفون للتطبيق لا يُفتحون مرة أخرى، والموجودون في EMIS لا يُزامَنون (مزامنة سريعة)
    const known = queueRef.current.filter(i => i.status !== 'skipped').map(i => i.k).concat([...doneKeys.current]);
    const ex = existingRef.current ? { keys: existingRef.current.keys, ids: existingRef.current.ids } : null;
    siteRef.current?.injectJavaScript(
      '(function(){var ok=!!window.__emisSync;if(ok)window.__emisSync(' + JSON.stringify(known) + ',' + JSON.stringify(ex) + ');' +
        'try{window.ReactNativeWebView.postMessage(JSON.stringify({__gm:"act",action:"sync:site",ok:ok}))}catch(e){}})();true;',
    );
  };
  const syncFailed = (why: string) => {
    syncingRef.current = false;
    syncStep.current = 'none';
    runAfterSync.current = false;
    setPhase('idle');
    setSyncText('');
    setDetail(why);
    setSyncUI(u => ({ ...u, step: 'error', text: why, percent: 0, summary: undefined }));
    lastActivity.current = Date.now();
  };

  /* ===================== استيراد ملف Excel ===================== */
  const pickExcel = async () => {
    let res: DocumentPicker.DocumentPickerResult;
    try {
      res = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
          'text/comma-separated-values',
          'application/octet-stream',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch {
      toast('تعذّر فتح الملفات');
      return;
    }
    if (res.canceled || !res.assets?.[0]) return;
    const f = res.assets[0];
    try {
      const isCsv = /\.csv$/i.test(f.name || '') || /csv/i.test(f.mimeType || '');
      const src = isCsv
        ? { text: await FileSystem.readAsStringAsync(f.uri) }
        : { base64: await FileSystem.readAsStringAsync(f.uri, { encoding: FileSystem.EncodingType.Base64 }) };
      const g = parseGeneric(src);
      let students: ExcelResult | null = null;
      try {
        students = parseWorkbook(src);
      } catch {
        students = null;
      }
      excelStudents.current = students;
      setExcel(() => ({
        fileName: f.name || 'ملف',
        sheet: g.sheet,
        headers: g.headers,
        rows: g.rows.slice(0, 5000),
        status: {},
        selected: 0,
        studentRows: students ? students.items.length : 0,
      }));
      toast(`قُرئ ${g.rows.length} صف من «${f.name}»`);
    } catch (e) {
      Alert.alert('تعذّرت قراءة الملف', (e as Error)?.message || '');
    }
  };

  /** تعبئة النموذج المفتوح في EMIS من صف في الملف */
  const fillExcelRow = (i: number) => {
    const d = excelRef.current;
    if (!d || !d.rows[i]) return;
    const pairs = d.headers.map((h, j) => [h, d.rows[i][j] || '']).filter(([h, v]) => h && v);
    setExcelBusy(true);
    setActive('emis');
    emisRef.current?.injectJavaScript(
      '(function(){var ok=!!window.__emisFillGeneric;if(ok)window.__emisFillGeneric(' + JSON.stringify(pairs) + ',' + i + ');' +
        'try{window.ReactNativeWebView.postMessage(JSON.stringify({__gm:"act",action:"generic:emis",ok:ok}))}catch(e){}})();true;',
    );
    setTimeout(() => setExcelBusy(false), 120000);
  };
  const onGenericStatus = (raw: string) => {
    let r: { ok: number; miss: string[]; fail: string[]; row: number };
    try {
      r = JSON.parse(raw);
    } catch {
      return;
    }
    setExcelBusy(false);
    setExcel(d =>
      d ? { ...d, status: { ...d.status, [r.row]: { ok: r.ok, miss: r.miss || [], fail: r.fail || [], t: Date.now() } }, selected: r.fail?.length ? r.row : Math.min(d.rows.length - 1, r.row + 1) } : d,
    );
    toast(`Excel صف ${r.row + 1}: عُبّئ ${r.ok}` + (r.fail?.length ? ` · ✖ ${r.fail.length}` : '') + ' — راجع واحفظ في EMIS');
  };
  const addExcelStudents = () => {
    const st = excelStudents.current;
    const d = excelRef.current;
    if (!st || !d) {
      toast('ارفع الملف مرة أخرى لإضافة الطلاب');
      return;
    }
    if (syncingRef.current || runningRef.current) return;
    pendingImport.current = { ...st, fileName: d.fileName };
    setSyncUI({ visible: true, step: 'emis', title: 'إضافة طلاب من Excel', text: 'قراءة طلاب EMIS الحقيقي...', percent: 5 });
    startSync(false, true);
  };

  const mergeImport = () => {
    const imp = pendingImport.current;
    pendingImport.current = null;
    if (!imp) return;
    const exKeys = new Set(existingRef.current?.keys || []);
    let added = 0;
    let existing = 0;
    setQueue(q => {
      const next = [...q];
      const byKey = new Map(next.map(i => [i.k, i]));
      for (const it of imp.items) {
        if (it.d.greatGrandfather && exKeys.has(it.k)) {
          existing++;
          continue;
        }
        if (doneKeys.current.has(it.k)) continue;
        const ex = byKey.get(it.k);
        if (ex) {
          if (ex.status !== 'done') {
            ex.d = it.d as QItem['d'];
            if (ex.status === 'skipped') ex.status = 'pending';
          }
        } else {
          next.push({ k: it.k, d: it.d as QItem['d'], status: 'pending', note: 'من Excel', t: Date.now() });
          added++;
        }
      }
      return next;
    });
    const pending = queueRef.current.filter(i => i.status === 'pending').length;
    syncingRef.current = false;
    syncStep.current = 'none';
    setSyncText('');
    setPhase('idle');
    setDetail('');
    lastActivity.current = Date.now();
    setSyncUI(u => ({
      ...u,
      step: 'done',
      text: added ? `أُضيف ${added} طالب من الملف — اضغط «ابدأ» للتسجيل` : 'لا يوجد طلاب جدد في الملف',
      percent: 100,
      summary: {
        toRegister: pending,
        added,
        existing,
        reviewed: 0,
        emisRows: existingRef.current?.rows || 0,
        warn: syncWarn.current || undefined,
        file: { name: imp.fileName, rows: imp.rows, noName: imp.noName, duplicates: imp.duplicates, columns: imp.columns, unknown: imp.unknown },
      },
    }));
    toast(`Excel: ${added} للتسجيل · ${existing} موجود في EMIS`);
  };

  /** «تمت المراجعة» في موقع الطلاب (مباشرة على الخادم إن عُرف رقم الاستمارة) */
  const markOnSite = (k: string, id?: unknown) => {
    siteRef.current?.injectJavaScript(
      `window.__emisMark&&window.__emisMark(${JSON.stringify(k)},${JSON.stringify(typeof id === 'number' ? id : null)});true;`,
    );
  };

  /** دمج نتيجة المزامنة مع قائمة التسجيل */
  const mergeSync = (raw: string) => {
    let res: { items: { k: string; d: QItem['d'] }[]; reviewed: number; existing?: number; total: number };
    try {
      res = JSON.parse(raw);
    } catch {
      return;
    }
    const fresh = res.items || [];
    const keys = new Set(fresh.map(i => i.k));
    let added = 0;
    setQueue(q => {
      // نُبقي المنتهين للعرض، ونحذف «بانتظار التسجيل» الذين لم يعودوا غير مراجَعين في موقعك أو صاروا في EMIS
      const exKeys = new Set(existingRef.current?.keys || []);
      const kept = q.filter(
        i => i.status === 'done' || i.status === 'skipped' || i.d.__src === 'excel' || (keys.has(i.k) && !exKeys.has(i.k)),
      );
      const byKey = new Map(kept.map(i => [i.k, i]));
      for (const f of fresh) {
        const ex = byKey.get(f.k);
        // طالب معروف (لم يُفتح في المزامنة السريعة): نُبقي بياناته المحفوظة
        if (!f.d) {
          if (doneKeys.current.has(f.k)) markOnSite(f.k, ex?.d.__id);
          if (ex && ex.status === 'skipped') ex.status = 'pending';
          continue;
        }
        if (doneKeys.current.has(f.k)) {
          // سُجّل سابقاً في EMIS لكن لم يُحدَّد «تمت المراجعة» في موقعك: نحدده الآن ولا نسجّله مرة أخرى
          markOnSite(f.k, f.d.__id);
          if (!ex) kept.push({ k: f.k, d: f.d, status: 'done', note: 'سُجّل سابقاً', t: Date.now() });
          continue;
        }
        if (ex) {
          ex.d = f.d;
          if (ex.status === 'skipped') ex.status = 'pending';
        } else {
          kept.push({ k: f.k, d: f.d, status: 'pending', t: Date.now() });
          added++;
        }
      }
      return [...kept];
    });
    const pending = queueRef.current.filter(i => i.status === 'pending').length;
    syncingRef.current = false;
    syncStep.current = 'none';
    setSyncText('');
    setPhase('idle');
    setDetail('');
    lastActivity.current = Date.now();
    setSyncUI(u => ({
      ...u,
      step: 'done',
      text: pending ? 'اكتملت المزامنة — اضغط «ابدأ» للتسجيل' : 'اكتملت المزامنة — لا يوجد طلاب جدد',
      percent: 100,
      summary: {
        toRegister: pending,
        added,
        existing: res.existing || 0,
        reviewed: res.reviewed || 0,
        emisRows: existingRef.current?.rows || 0,
        warn: syncWarn.current || undefined,
      },
    }));
    const msg = `المزامنة: ${pending} للتسجيل${added ? ` (${added} جديد)` : ''} · ${res.existing || 0} موجود في EMIS · ${res.reviewed || 0} عليها «تمت المراجعة» · ${hhmm()}`;
    setApNote(msg);
    toast(msg);
    if ((runAfterSync.current || settingsRef.current.autoPilot) && pending) {
      runAfterSync.current = false;
      startQueue();
    }
    runAfterSync.current = false;
  };

  /* ===================== التسجيل ===================== */
  const startQueue = () => {
    if (runningRef.current) return;
    setRunning(true);
    activateKeepAwakeAsync('queue').catch(() => {});
    nextStudent();
  };

  const stopQueue = (why?: string) => {
    setRunning(false);
    deactivateKeepAwake('queue').catch(() => {});
    if (why) setDetail(why);
    lastActivity.current = Date.now();
  };

  const nextStudent = () => {
    if (!runningRef.current) return;
    const item = queueRef.current.find(i => i.status === 'pending');
    if (!item) {
      currentKey.current = null;
      const done = queueRef.current.filter(i => i.status === 'done').length;
      stopQueue();
      setPhase('finished');
      setDetail(`انتهى التسجيل · ${done} طالب سُجّل في EMIS`);
      if (settingsRef.current.autoSwitch && !settingsRef.current.split) setActive('emis');
      return;
    }
    currentKey.current = item.k;
    updateItem(item.k, { status: 'working', note: '' });
    // بيانات الطالب للسكربت في EMIS ثم أمر «جديد + تعبئة + حفظ»
    gmSet(K_DATA, JSON.stringify({ ...item.d, reviewed: false }), 'emis');
    gmSet(K_STATUS, '', 'emis');
    // «ابدأ»: تعبئة الاستمارة الجديدة التي فتحتها أنت. 🤖: يفتح «جديد» بنفسه
    const mode = settingsRef.current.directApi ? 'api' : settingsRef.current.autoPilot ? 'new' : 'fillNew';
    gmSet(K_CMD, JSON.stringify({ mode, t: Date.now() }), 'emis');
    setPhase('filling');
    setDetail('');
    lastActivity.current = Date.now();
    if (settingsRef.current.autoSwitch && !settingsRef.current.split) setActive('emis');
  };

  /** الطالب الحالي سُجّل في EMIS: نحدده «تمت المراجعة» في موقعك (في الخلفية) ثم التالي */
  const finishCurrent = (note: string) => {
    const k = currentKey.current;
    if (!k) return;
    addDone(k);
    updateItem(k, { status: 'done', note });
    const it = queueRef.current.find(i => i.k === k);
    if (it?.d.__src !== 'excel') markOnSite(k, it?.d.__id);
    currentKey.current = null;
    setPhase('saved');
    setDetail('');
    if (settingsRef.current.autoPilot && runningRef.current) {
      // 🤖 الإضافة التلقائية: نكمل مباشرة
      setTimeout(nextStudent, 700);
      return;
    }
    // بعد حفظ كل طالب نتوقف تماماً: أنت تضغط «جديد» في EMIS ثم «ابدأ»
    stopQueue();
    const next = queueRef.current.find(i => i.status === 'pending');
    setDetail(next ? `حُفظ ✔ — اضغط «ابدأ» للطالب التالي: ${nameOf(next)}` : 'حُفظ ✔ — انتهت القائمة');
  };

  const onEmisStatus = (raw: string) => {
    let st: { info?: string; stopped?: boolean; saved?: boolean; ok?: number; miss?: string[] };
    try {
      st = JSON.parse(raw);
    } catch {
      return;
    }
    if (st.info) {
      // نتيجة فتح «جديد» بعد الحفظ
      if (!currentKey.current) {
        const next = queueRef.current.find(i => i.status === 'pending');
        setDetail(st.info.replace(/ — اضغط «ابدأ» لتعبئة الطالب/, '') + (next ? ` · اضغط «ابدأ» للطالب التالي: ${nameOf(next)}` : ' · انتهت القائمة'));
      }
      return;
    }
    if (!currentKey.current) return;
    lastActivity.current = Date.now();
    if ((st as { needNew?: boolean }).needNew) {
      // لم تُفتح استمارة جديدة بعد: الطالب يبقى بانتظار التسجيل
      updateItem(currentKey.current, { status: 'pending', note: '' });
      currentKey.current = null;
      stopQueue();
      setPhase('idle');
      setDetail('اضغط «جديد» في EMIS أولاً، ثم «ابدأ»');
      toast('اضغط «جديد» في EMIS أولاً');
      return;
    }
    if (st.saved && !(st.miss && st.miss.length)) {
      finishCurrent(`${st.ok || 0} حقل · ${hhmm()}`);
      return;
    }
    const why = st.stopped ? (st.miss && st.miss[0]) || 'تم الإيقاف' : 'ناقص: ' + (st.miss || []).join('، ');
    updateItem(currentKey.current, { status: 'failed', note: why });
    setPhase(st.stopped ? 'stopped' : 'incomplete');
    setDetail(why + ' — أكمله في EMIS واحفظه ثم اضغط «حفظته ⏭»، أو «تخطي»');
    stopQueue();
    toast('توقف التسجيل: ' + why);
  };

  /* ---------- أزرار اللوحة ---------- */
  const onStop = () => {
    runAfterSync.current = false;
    if (syncingRef.current) {
      siteRef.current?.injectJavaScript(clickBarJs('stop:site', 'إيقاف'));
      emisRef.current?.injectJavaScript(clickBarJs('stop:emis', 'إيقاف'));
      syncFailed('أوقفت المزامنة');
      return;
    }
    views.emis.current?.injectJavaScript(clickBarJs('stop:emis', 'إيقاف'));
    stopQueue('أوقفته يدوياً');
  };
  const onDoneManual = () => {
    // أكملتَ الطالب وحفظته بنفسك في EMIS
    if (!currentKey.current) return;
    setRunning(true);
    activateKeepAwakeAsync('queue').catch(() => {});
    finishCurrent('أُكمل يدوياً');
  };
  const onSkip = () => {
    const k = currentKey.current;
    if (k) {
      updateItem(k, { status: 'skipped', note: 'تخطيته' });
      currentKey.current = null;
    }
    if (runningRef.current) {
      views.emis.current?.injectJavaScript(clickBarJs('stop:emis', 'إيقاف'));
      setTimeout(nextStudent, 1200);
    } else {
      setPhase('idle');
      setDetail('');
    }
  };
  const onRetry = () => {
    const k = currentKey.current;
    if (k) updateItem(k, { status: 'pending', note: '' });
    currentKey.current = null;
    startQueue();
  };

  /* ---------- الإضافة التلقائية (🤖): مزامنة دورية ثم تسجيل الجديد ---------- */
  useEffect(() => {
    if (!settings.autoPilot) return;
    activateKeepAwakeAsync('autopilot').catch(() => {});
    lastActivity.current = 0;
    const iv = setInterval(() => {
      if (runningRef.current || syncingRef.current) return;
      if (queueRef.current.some(i => i.status === 'failed' && i.k === currentKey.current)) return; // ينتظر تدخلك
      if (Date.now() - lastActivity.current >= settingsRef.current.autoPilotMinutes * 60000) startSync(true);
    }, 5000);
    return () => {
      clearInterval(iv);
      deactivateKeepAwake('autopilot').catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoPilot]);

  const onAutoPilotPress = () => {
    const s = settingsRef.current;
    if (s.autoPilot) {
      Alert.alert('الإضافة التلقائية', 'تعمل الآن: مزامنة كل ' + s.autoPilotMinutes + ' دقيقة ثم تسجيل الجديد.', [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'إيقاف', style: 'destructive', onPress: () => saveSettings({ ...settingsRef.current, autoPilot: false }) },
      ]);
      return;
    }
    Alert.alert(
      'الإضافة التلقائية',
      `كل ${s.autoPilotMinutes === 1 ? 'دقيقة' : s.autoPilotMinutes + ' دقائق'} يحدّث التطبيق موقع الطلاب ويجلب الاستمارات الجديدة (بدون «تمت المراجعة») ويسجّلها في EMIS ويحفظها.\n\nيعمل والتطبيق مفتوح وأنت مسجّل الدخول في الموقعين، ويتوقف عند أي حقل ناقص.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'تشغيل',
          onPress: () => {
            setApNote('سيبدأ الفحص الآن');
            saveSettings({ ...settingsRef.current, autoPilot: true });
          },
        },
      ],
    );
  };

  /* ---------- الرسائل القادمة من الصفحات ---------- */
  const onMessage = useCallback(
    (pane: Pane) => (e: WebViewMessageEvent) => {
      const m = parseBridgeMessage(e.nativeEvent.data);
      if (!m) return;
      const self = views[pane].current;
      const other = views[pane === 'site' ? 'emis' : 'site'].current;

      switch (m.__gm) {
        case 'hello':
          self?.injectJavaScript(syncAndBootJs(store.current));
          return;
        case 'log':
          addError(pane, m.level, m.msg);
          return;
        case 'bar':
          setBarLog(prev => (prev[pane] === m.log ? prev : { ...prev, [pane]: m.log }));
          // بعد تحديث موقع الطلاب: السكربت جاهز ← نبدأ المزامنة (بعد مهلة لتحميل القائمة)
          if (pane === 'site' && syncAfterReload.current) {
            syncAfterReload.current = false;
            setTimeout(injectSync, 3000);
          }
          return;
        case 'act': {
          if (m.ok) return;
          if (m.action === 'generic:emis') {
            setExcelBusy(false);
            toast('افتح EMIS وسجّل الدخول وافتح النموذج، ثم «تعبئة»');
            return;
          }
          if (m.action === 'list:emis') {
            syncWarn.current = 'المساعد غير جاهز في EMIS (افتح «إدارة الطلاب») — زامنت بدون فحص EMIS';
            if (syncingRef.current && syncStep.current === 'emis') goSite();
            return;
          }
          if (m.action === 'sync:site') {
            syncFailed('افتح صفحة قائمة الطلاب في «موقع الطلاب» ثم اضغط «مزامنة»');
            if (!settingsRef.current.split) setActive('site');
          }
          return;
        }
        case 'set': {
          const v = m.v;
          store.current[m.k] = v;
          persistStore();

          // نتائج المزامنة والتحديد من موقع الطلاب (للتطبيق فقط)
          if (pane === 'site' && m.k === K_SYNC && typeof v === 'string') {
            try {
              const p = JSON.parse(v);
              if (p.error) syncFailed(p.error);
              else if (p.running) {
                setSyncText(`مزامنة: ${p.done}/${p.total} · وجدت ${p.found} للتسجيل`);
                setSyncUI(u => ({
                  ...u,
                  text: `قراءة الطلاب من موقعك... ${p.done} من ${p.total}`,
                  percent: 35 + (65 * (p.done || 0)) / Math.max(1, p.total || 1),
                }));
              }
            } catch {
              /* ignore */
            }
            return;
          }
          if (pane === 'site' && m.k === K_QUEUE && typeof v === 'string') {
            mergeSync(v);
            return;
          }
          if (pane === 'site' && m.k === K_MARK && typeof v === 'string') {
            try {
              const r = JSON.parse(v);
              if (r.res !== 'ok' && r.res !== 'already') {
                addError('site', 'warn', `[EMIS app] لم أستطع تحديد «تمت المراجعة» في موقعك (${r.res}) — حدده يدوياً: ${r.k}`);
              }
            } catch {
              /* ignore */
            }
            return;
          }
          if (pane === 'emis' && m.k === K_GSTAT) {
            if (typeof v === 'string' && v) onGenericStatus(v);
            return;
          }
          if (pane === 'emis' && m.k === K_EXIST) {
            if (typeof v === 'string') onEmisList(v);
            return;
          }
          // نتيجة EMIS لا تُرسل لموقع الطلاب (حتى لا يحدد «تمت المراجعة» لطالب آخر مفتوح هناك)
          if (pane === 'emis' && m.k === K_STATUS) {
            if (typeof v === 'string' && v) onEmisStatus(v);
            return;
          }
          // أوامر السكربت القديمة من موقع الطلاب لا تُرسل لـ EMIS (التسجيل يتم من قائمة التطبيق)
          if (pane === 'site' && (m.k === K_CMD || m.k === K_DATA)) return;

          other?.injectJavaScript(remoteSetJs(m.k, v));
          return;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addError, persistStore],
  );

  const onNav = useCallback(
    (pane: Pane) => (n: WebViewNavigation) => {
      canBack.current[pane] = n.canGoBack;
    },
    [],
  );

  /* ---------- زر الرجوع في أندرويد ---------- */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const p = activeRef.current;
      if (p === 'excel') {
        setActive('site');
        return true;
      }
      if (canBack.current[p]) {
        views[p].current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- السجل ---------- */
  const buildLogText = () => {
    const s = settingsRef.current;
    return [
      `سجل مساعد EMIS (التطبيق v${APP_VERSION})`,
      `وضع الكمبيوتر: ${s.desktopEmis ? 'مفعّل' : 'غير مفعّل'} — قوائم كالكمبيوتر: ${s.desktopUA ? 'نعم' : 'لا'} — إضافة تلقائية: ${s.autoPilot ? 'نعم' : 'لا'}`,
      `الحالة: ${phase} ${detail}`,
      `القائمة: ${queueRef.current.map(i => `${nameOf(i)}=${i.status}${i.note ? '(' + i.note + ')' : ''}`).join(' | ')}`,
      '',
      '===== EMIS =====',
      barLog.emis || '(فارغ)',
      '',
      '===== موقع الطلاب =====',
      barLog.site || '(فارغ)',
      '',
      '===== الأخطاء =====',
      ...errors.map(l => `${new Date(l.t).toLocaleTimeString()} [${l.pane}] ${l.level}: ${l.msg}`),
    ]
      .join('\n')
      .slice(-60000);
  };

  const reload = (p: Pane) => setReloadKey(k => ({ ...k, [p]: k[p] + 1 }));

  const clearHelperData = () => {
    store.current = {};
    AsyncStorage.removeItem(K_STORE).catch(() => {});
    setQueue(() => []);
    setPhase('idle');
    setDetail('');
    reload('site');
    reload('emis');
    toast('تم مسح بيانات المساعد (تسجيل الدخول باقٍ)');
  };

  if (!ready || !fontsLoaded) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: colors.navy }]}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  const split = settings.split;
  const current = queue.find(i => i.k === currentKey.current) || null;

  const renderPane = (p: Pane) => {
    const url = normUrl(p === 'site' ? settings.siteUrl : settings.emisUrl);
    const desktop = p === 'emis' && settings.desktopEmis;
    const on = split || active === p;
    return (
      <View
        key={p}
        // في وضع التبويبات تبقى النافذتان بحجمهما الكامل (حتى يعمل السكربت في الخلفية)
        // والنافذة غير النشطة تختفي خلف النشطة فقط
        style={split ? styles.splitPane : [styles.stacked, { zIndex: on ? 2 : 1, elevation: on ? 2 : 1 }]}
        pointerEvents={on ? 'auto' : 'none'}
      >
        <WebView
          key={`${p}-${reloadKey[p]}-${url}-${desktop ? 'd' : 'm'}-${settings.showPageBar ? 'b' : 'n'}-${p === 'emis' && settings.desktopUA ? 'u' : ''}`}
          ref={views[p]}
          source={{ uri: url }}
          style={styles.fill}
          injectedJavaScript={injection}
          injectedJavaScriptBeforeContentLoaded={desktop ? desktopViewportJs(DESKTOP_WIDTH) : undefined}
          userAgent={p === 'emis' && settings.desktopUA ? DESKTOP_UA : undefined}
          injectedJavaScriptForMainFrameOnly
          onMessage={onMessage(p)}
          onNavigationStateChange={onNav(p)}
          onLoadStart={() => setLoading(l => ({ ...l, [p]: true }))}
          onLoadEnd={() => setLoading(l => ({ ...l, [p]: false }))}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          cacheEnabled
          incognito={false}
          setSupportMultipleWindows={false}
          originWhitelist={['*']}
          mixedContentMode="compatibility"
          scalesPageToFit
          setBuiltInZoomControls
          setDisplayZoomControls={false}
          webviewDebuggingEnabled
          onError={e => addError(p, 'error', `تعذّر فتح الصفحة: ${e.nativeEvent.description}`)}
        />
        {loading[p] ? <View style={styles.progress} /> : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.navy }]} edges={['top']}>
      <StatusBar style="light" />

      {/* الشريط العلوي */}
      <View style={styles.header}>
        <View style={styles.segment}>
          <Seg icon="school-outline" label="الطلاب" on={active === 'site' || (split && active !== 'excel')} onPress={() => setActive('site')} />
          <Seg icon="file-excel" label="Excel" on={active === 'excel'} onPress={() => setActive('excel')} />
          <Seg icon="bank-outline" label="EMIS" on={active === 'emis' && !split} onPress={() => setActive('emis')} />
        </View>
        <IconButton
          icon={split ? 'view-agenda-outline' : 'view-split-horizontal'}
          onPress={() => saveSettings({ ...settings, split: !split })}
          accessibilityLabel="عرض الشاشتين"
        />
        <IconButton
          icon="refresh"
          onPress={() => reload(split || active === 'excel' ? 'emis' : active)}
          onLongPress={() => {
            reload('site');
            reload('emis');
            toast('إعادة تحميل الشاشتين');
          }}
          accessibilityLabel="إعادة تحميل"
        />
        <IconButton icon="cog-outline" onPress={() => setShowSettings(true)} accessibilityLabel="الإعدادات" />
      </View>

      <View style={[styles.fill, { backgroundColor: colors.bg }]}>
        <View style={[styles.fill, split ? { flexDirection: 'column' } : null]}>
          {renderPane('site')}
          {split && <View style={styles.divider} />}
          {renderPane('emis')}
        </View>

        {active === 'excel' ? (
          <SafeAreaView edges={['bottom']} style={[styles.stacked, { zIndex: 20, elevation: 20, backgroundColor: colors.bg }]}>
            <ExcelScreen
              data={excel}
              busy={excelBusy}
              onPick={pickExcel}
              onSelect={i => setExcel(d => (d ? { ...d, selected: i } : d))}
              onFill={fillExcelRow}
              onAddStudents={addExcelStudents}
              onClear={() =>
                Alert.alert('إزالة الملف', 'إزالة ملف Excel من التطبيق؟', [
                  { text: 'إلغاء', style: 'cancel' },
                  { text: 'إزالة', style: 'destructive', onPress: () => setExcel(() => null) },
                ])
              }
            />
          </SafeAreaView>
        ) : null}

        {/* لوحة التحكم فوق الصفحة (لا تغيّر حجم الصفحة حتى لا تتحرك القوائم أثناء التعبئة) */}
        <SafeAreaView edges={['bottom']} style={[styles.panelWrap, active === 'excel' && { display: 'none' }]} pointerEvents="box-none">
          <ControlPanel
            current={current}
            phase={phase}
            detail={detail}
            items={queue}
            syncText={syncText}
            running={running}
            emisLog={barLog.emis}
            siteLog={barLog.site}
            onSync={() => startSync(false)}
            onRun={startQueue}
            onStop={onStop}
            onDoneManual={onDoneManual}
            onSkip={onSkip}
            onRetry={onRetry}
            onClearFinished={() => setQueue(q => q.filter(i => i.status !== 'done' && i.status !== 'skipped'))}
            autoPilot={{ enabled: settings.autoPilot, note: apNote }}
            onAutoPilotPress={onAutoPilotPress}
          />
        </SafeAreaView>
      </View>

      <SettingsScreen
        visible={showSettings}
        settings={settings}
        errors={errors}
        onClose={() => setShowSettings(false)}
        onSave={s => {
          saveSettings(s);
          setShowSettings(false);
          toast('تم حفظ الإعدادات');
        }}
        onClearData={clearHelperData}
        onClearErrors={() => setErrors([])}
        onCopyLogs={() =>
          Clipboard.setStringAsync(buildLogText())
            .then(() => toast('تم نسخ السجل'))
            .catch(() => toast('تعذّر النسخ'))
        }
        onShareLogs={() => Share.share({ message: buildLogText() }).catch(() => {})}
        onDiagnose={() => {
          setShowSettings(false);
          if (!settingsRef.current.split) setActive('emis');
          emisRef.current?.injectJavaScript(diagnoseListJs('الجنس', ['ذكر', 'أنثى']));
          toast('افتح استمارة «جديد» في EMIS أولاً. سيظهر التشخيص في السجل بعد ثانيتين، ثم انسخه وأرسله');
        }}
        onShowGuide={() => {
          setShowSettings(false);
          setShowGuide(true);
        }}
        onCheckUpdate={() => checkUpdates(true)}
        versionText={`التطبيق v${installedVersion()} (بناء ${installedBuild()}) · السكربت v${script?.version || '?'}`}
      />

      <UpdateModal manifest={update} onClose={() => setUpdate(null)} />
      <SyncScreen state={syncUI} onClose={() => setSyncUI(u => ({ ...u, visible: false }))} onStop={onStop} />

      <Onboarding
        visible={showGuide}
        onDone={() => {
          setShowGuide(false);
          if (!settingsRef.current.onboarded) saveSettings({ ...settingsRef.current, onboarded: true });
        }}
      />
    </SafeAreaView>
  );
}

function Seg({ icon, label, on, onPress }: { icon: IconName; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.seg, on && styles.segOn]}>
      <Icon name={icon} size={16} color={on ? colors.navyDark : 'rgba(255,255,255,0.85)'} />
      <T bold style={{ fontSize: 13, color: on ? colors.navyDark : '#fff' }} numberOfLines={1}>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: ROW,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.navy,
  },
  logo: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segment: {
    flex: 1,
    flexDirection: ROW,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 3,
    gap: 3,
  },
  seg: {
    flex: 1,
    flexDirection: ROW,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    borderRadius: 9,
  },
  segOn: { backgroundColor: colors.gold },
  stacked: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff' },
  splitPane: { flex: 1, backgroundColor: '#fff' },
  divider: { height: 3, backgroundColor: colors.gold },
  progress: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: colors.gold },
  panelWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 10, elevation: 10 },
});
