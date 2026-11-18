import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useFonts } from 'expo-font';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, Pressable, Share, StyleSheet, ToastAndroid, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { CommandScreen } from './src/CommandScreen';
import type { AppActions } from './src/agent';
import { PreviewModal, type Preview, type PreviewRow } from './src/PreviewModal';
import { buildInjection, desktopViewportJs, diagnoseListJs, hostOf, parseBridgeMessage, remoteSetJs, syncAndBootJs } from './src/bridge';
import { type CmpItem, type CmpReport, type CompareState, CompareScreen } from './src/CompareScreen';
import { parseGeneric, toXlsxBase64 } from './src/excel';
import { type ExcelData, ExcelScreen } from './src/ExcelScreen';
import { Onboarding } from './src/Onboarding';
import { type Op, OpsScreen, opsToRows } from './src/OpsScreen';
import { DEFAULT_SETTINGS, normalizedSchools, normUrl, type Settings } from './src/settings';
import { type LogLine, SettingsScreen } from './src/SettingsScreen';
import { colors, ROW } from './src/theme';
import { Icon, IconButton, type IconName, T } from './src/ui';
import { UpdateModal } from './src/UpdateModal';
import { fetchManifest, installedBuild, installedVersion, loadScript, type Manifest, updateScript } from './src/updater';

type Pane = 'site' | 'emis';
type Tab = Pane | 'excel';
type StudentData = Record<string, unknown> & {
  name?: string;
  father?: string;
  grandfather?: string;
  greatGrandfather?: string;
  school?: string;
  grade?: string;
  section?: string;
  reviewed?: boolean;
  __id?: number;
};

const APP_VERSION = installedVersion() || '8.6.0';
// تخزين التطبيق
const K_SETTINGS = 'app_settings_v1';
const K_STORE = 'gm_store_v1';
const K_DONE_APP = 'app_done_keys_v1'; // الطلاب الذين سُجّلوا في EMIS (للتنبيه من التكرار)
const K_EXCEL_APP = 'app_excel_v1';
const K_OPS_APP = 'app_ops_v1'; // سجل العمليات
// مفاتيح السكربت
const K_DATA = 'emis_student_v2';
const K_CMD = 'emis_cmd_v2';
const K_STATUS = 'emis_status_v2';
const K_EXIST = 'emis_existing_v1';
const K_GSTAT = 'emis_generic_status_v1';
const K_CMP = 'emis_compare_v1';
const K_MARKMANY = 'emis_markmany_v1';
const K_MARK = 'emis_mark_v1';
const K_SEND = 'emis_send_req_v1';
const K_UPD = 'emis_upd_req_v1';
const K_BACKUP = 'emis_backup_before_edit_v1';
// مفاتيح للتطبيق فقط: لا تُمرَّر بين الصفحتين
const SITE_ONLY = new Set([K_DATA, K_CMD, 'emis_queue_v1', 'emis_sync_v1']);
const DESKTOP_WIDTH = 1280;
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

const toast = (t: string) => {
  try {
    ToastAndroid.show(t, ToastAndroid.SHORT);
  } catch {
    /* ignore */
  }
};
const fullName = (d: StudentData) => [d.name, d.father, d.grandfather, d.greatGrandfather].filter(Boolean).join(' ');

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
  const [showOps, setShowOps] = useState(false);
  const [showCmd, setShowCmd] = useState(false);
  const cmpWait = useRef<((r: string) => void) | null>(null);
  const lastReport = useRef<CmpReport | null>(null);
  const [errors, setErrors] = useState<LogLine[]>([]);
  const [reloadKey, setReloadKey] = useState({ site: 0, emis: 0 });
  const [loading, setLoading] = useState<Record<Pane, boolean>>({ site: true, emis: true });
  const [barLog, setBarLog] = useState<Record<Pane, string>>({ site: '', emis: '' });
  const [script, setScript] = useState<{ source: string; version: string } | null>(null);
  const [update, setUpdate] = useState<Manifest | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<Manifest | null>(null); // يبقى زر التحديث ظاهراً بعد «لاحقاً»
  const [busyText, setBusyText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const lastPreview = useRef<Preview | null>(null);

  const [ops, setOpsState] = useState<Op[]>([]);
  const opsRef = useRef<Op[]>([]);
  const doneKeys = useRef(new Set<string>());
  // إرسال طالب واحد من زر «إرسال إلى EMIS»: فحص ثم تأكيد ثم إرسال
  const send = useRef<{ stage: 'check' | 'send'; id: number; k: string; d: StudentData; issues: string[] } | null>(null);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const upd = useRef<{ id: number; k: string; d: StudentData; od?: StudentData; stage: 'check' | 'save' } | null>(null);
  const updTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const existingRef = useRef<{ keys: string[]; names: string[]; rows: number } | null>(null);
  const compareStep = useRef<'none' | 'emis' | 'site'>('none');
  const [cmp, setCmp] = useState<CompareState>({ visible: false, step: 'done', text: '', percent: 0 });

  const [excel, setExcelState] = useState<ExcelData | null>(null);
  const excelRef = useRef<ExcelData | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);
  const setExcel = (fn: (e: ExcelData | null) => ExcelData | null) => {
    const next = fn(excelRef.current);
    excelRef.current = next;
    setExcelState(next);
    if (next) AsyncStorage.setItem(K_EXCEL_APP, JSON.stringify(next)).catch(() => {});
    else AsyncStorage.removeItem(K_EXCEL_APP).catch(() => {});
  };

  // مخزن GM_* المشترك بين النافذتين
  const store = useRef<Record<string, unknown>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const siteRef = useRef<WebView>(null);
  const emisRef = useRef<WebView>(null);
  const views: Record<Pane, RefObject<WebView | null>> = { site: siteRef, emis: emisRef };
  const canBack = useRef<Record<Pane, boolean>>({ site: false, emis: false });
  const activeRef = useRef<Tab>('site');
  const emisStale = useRef(false); // أُضيف طالب: حدّث صفحة EMIS عند فتحها ليظهر العدد الجديد
  activeRef.current = active;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* ---------- التحميل والحفظ ---------- */
  useEffect(() => {
    (async () => {
      try {
        const [s, st, dk, xr, op] = await Promise.all([
          AsyncStorage.getItem(K_SETTINGS),
          AsyncStorage.getItem(K_STORE),
          AsyncStorage.getItem(K_DONE_APP),
          AsyncStorage.getItem(K_EXCEL_APP),
          AsyncStorage.getItem(K_OPS_APP),
        ]);
        const saved = s ? JSON.parse(s) : null;
        const loaded: Settings = saved ? { ...DEFAULT_SETTINGS, ...saved } : DEFAULT_SETTINGS;
        loaded.schools = normalizedSchools(saved?.schools);
        // مرة واحدة: EMIS يظهر بشكل الهاتف (وليس الحاسوب)
        if (saved && !saved.phoneV1) {
          loaded.desktopUA = false;
          loaded.desktopEmis = false;
          loaded.phoneV1 = true;
          AsyncStorage.setItem(K_SETTINGS, JSON.stringify(loaded)).catch(() => {});
        }
        setSettings(loaded);
        if (!loaded.onboarded) setShowGuide(true);
        if (st) store.current = JSON.parse(st) || {};
        if (dk) doneKeys.current = new Set(JSON.parse(dk) || []);
        if (xr) {
          const xd = JSON.parse(xr);
          excelRef.current = xd;
          setExcelState(xd);
        }
        if (op) {
          opsRef.current = JSON.parse(op) || [];
          setOpsState(opsRef.current);
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

  const addOp = (o: Op) => {
    opsRef.current = [...opsRef.current, o].slice(-3000);
    setOpsState(opsRef.current);
    AsyncStorage.setItem(K_OPS_APP, JSON.stringify(opsRef.current)).catch(() => {});
  };

  /* ---------- السكربت المحقون ---------- */
  const rulesJson = JSON.stringify(normalizedSchools(settings.schools));
  const injection = useMemo(() => {
    const siteHost = hostOf(normUrl(settings.siteUrl));
    const emisHost = hostOf(normUrl(settings.emisUrl));
    return buildInjection(siteHost ? [siteHost] : [], emisHost ? [emisHost] : [], true, script?.source, JSON.parse(rulesJson));
  }, [settings.siteUrl, settings.emisUrl, script, rulesJson]);

  /* ---------- التحديث ---------- */
  const scriptRef = useRef(script);
  scriptRef.current = script;
  const lastCheck = useRef(0);
  const checkUpdates = async (manual: boolean): Promise<boolean> => {
    const m = await fetchManifest();
    if (!m) {
      if (manual) toast('تعذّر التحقق من التحديث (تحقق من الإنترنت)');
      return false;
    }
    lastCheck.current = Date.now();
    if (m.versionCode > installedBuild()) {
      setUpdate(m);
      setPendingUpdate(m);
      return true;
    }
    const ns = await updateScript(m, scriptRef.current?.version || '0');
    if (ns) {
      setScript(ns);
      Alert.alert('تم تحديث السكربت', `السكربت الآن v${ns.version}. إعادة تحميل الصفحتين لتطبيقه؟`, [
        { text: 'لاحقاً', style: 'cancel' },
        { text: 'إعادة التحميل', onPress: () => setReloadKey(k => ({ site: k.site + 1, emis: k.emis + 1 })) },
      ]);
      return true;
    }
    if (manual) toast('لديك آخر إصدار');
    return true;
  };
  // فحص التحديث تلقائياً: عند التشغيل (مع إعادة المحاولة إن لم يكن الإنترنت جاهزاً)،
  // وكلما عاد التطبيق للواجهة من الخلفية (مرة كل 10 دقائق على الأكثر)
  const checkUpdatesRef = useRef(checkUpdates);
  checkUpdatesRef.current = checkUpdates;
  useEffect(() => {
    if (!ready) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const attempt = (i: number) => {
      checkUpdatesRef.current(false).then(ok => {
        if (!ok && i < 3) timers.push(setTimeout(() => attempt(i + 1), [15000, 45000, 120000][i]));
      });
    };
    timers.push(setTimeout(() => attempt(0), 3000));
    const sub = AppState.addEventListener('change', st => {
      if (st === 'active' && Date.now() - lastCheck.current > 2 * 60 * 1000) checkUpdatesRef.current(false);
    });
    return () => {
      timers.forEach(clearTimeout);
      sub.remove();
    };
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
  /** تشغيل دالة للسكربت في إحدى الشاشتين، مع إشعار إن لم يكن السكربت جاهزاً */
  const injectAct = (pane: Pane, call: string, action: string) => {
    views[pane].current?.injectJavaScript(
      '(function(){var ok=false;try{ok=' + call + ';}catch(e){}' +
        'try{window.ReactNativeWebView.postMessage(JSON.stringify({__gm:"act",action:' + JSON.stringify(action) + ',ok:!!ok}))}catch(e){}})();true;',
    );
  };

  /* ===================== زر «إرسال إلى EMIS»: فحص ← تأكيد ← إرسال ===================== */
  const endSend = () => {
    send.current = null;
    setBusyText('');
    if (sendTimer.current) clearTimeout(sendTimer.current);
  };
  const logOp = (d: StudentData, id: number, k: string, ok: boolean, reason: string) =>
    addOp({ t: Date.now(), id, k, name: fullName(d), school: String(d.school || ''), grade: String(d.grade || ''), section: String(d.section || ''), result: ok ? 'ok' : 'fail', reason });

  const emisCmd = (mode: 'apiCheck' | 'api', d: StudentData) => {
    gmSet(K_DATA, JSON.stringify({ ...d, reviewed: false }), 'emis');
    gmSet(K_STATUS, '', 'emis');
    gmSet(K_CMD, JSON.stringify({ mode, t: Date.now() }), 'emis');
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => {
      if (!send.current) return;
      const wasSend = send.current.stage === 'send';
      const cur = send.current;
      endSend();
      if (wasSend) logOp(cur.d, cur.id, cur.k, false, 'لم يصل رد من EMIS — تحقق في EMIS هل أُضيف');
      Alert.alert('EMIS لا يرد', wasSend ? 'لم يصل رد من EMIS. تحقق في قائمة EMIS هل أُضيف الطالب قبل إعادة الإرسال.' : 'سجّل الدخول في EMIS وافتح «إدارة الطلاب» ثم حاول مرة أخرى.');
    }, 45000);
  };

  const onSendRequest = (raw: string) => {
    let p: { id: number; k?: string; d?: StudentData; issues?: string[]; error?: string };
    try {
      p = JSON.parse(raw);
    } catch {
      return;
    }
    if (p.error || !p.d || !p.k) {
      Alert.alert('إرسال إلى EMIS', p.error || 'تعذّرت قراءة الطالب');
      return;
    }
    if (send.current || upd.current) {
      toast('انتظر حتى ينتهي الإرسال الحالي');
      return;
    }
    send.current = { stage: 'check', id: p.id, k: p.k, d: p.d, issues: p.issues || [] };
    setBusyText(`فحص ${fullName(p.d)} في EMIS...`);
    emisCmd('apiCheck', p.d);
  };

  /* ===================== «حفظ التعديل» في موقع الطلاب ← تعديل في EMIS ===================== */
  const endUpd = () => {
    upd.current = null;
    if (updTimer.current) clearTimeout(updTimer.current);
  };
  const onUpdRequest = (raw: string) => {
    let p: { id: number; k: string; oldK?: string; d?: StudentData; od?: StudentData };
    try {
      p = JSON.parse(raw);
    } catch {
      return;
    }
    if (!p.d) return;
    if (send.current || upd.current) {
      toast('EMIS مشغول — عدّل هذا الطالب في EMIS لاحقاً');
      return;
    }
    upd.current = { id: p.id, k: p.k, d: p.d, od: p.od, stage: 'check' };
    toast(`البحث عن ${fullName(p.d)} في EMIS...`);
    updCmd({ dry: true });
  };
  const updCmd = (o: { dry?: boolean; emisId?: number }) => {
    const cur = upd.current;
    if (!cur) return;
    gmSet(K_DATA, JSON.stringify({ ...cur.d, reviewed: false }), 'emis');
    gmSet(K_STATUS, '', 'emis');
    gmSet(K_CMD, JSON.stringify({ mode: 'update', od: cur.od || null, ...o, t: Date.now() }), 'emis');
    if (updTimer.current) clearTimeout(updTimer.current);
    updTimer.current = setTimeout(() => {
      if (!upd.current) return;
      endUpd();
      toast('لم يصل رد من EMIS — افتح «إدارة الطلاب» في EMIS وتحقق من التعديل');
    }, 45000);
  };
  const onUpdStatus = (raw: string) => {
    const cur = upd.current;
    if (!cur) return;
    let st: {
      info?: string;
      saved?: boolean;
      skip?: boolean;
      why?: string;
      dry?: boolean;
      miss?: string[];
      match?: { id: number; name: string; idNumber?: string };
      changes?: string[];
      backup?: unknown;
    };
    try {
      st = JSON.parse(raw);
    } catch {
      return;
    }
    if (st.info) return;
    const nm = fullName(cur.d);
    if (st.dry && st.match) {
      if (updTimer.current) clearTimeout(updTimer.current);
      const m = st.match;
      Alert.alert(
        'تعديل الطالب في EMIS؟',
        `في موقع الطلاب: ${nm}\nفي EMIS: ${m.name}${m.idNumber ? '\nرقم الهوية في EMIS: ' + m.idNumber : ''}\n\n` +
          (st.changes?.length ? 'التغييرات:\n• ' + st.changes.join('\n• ') : 'لا تغييرات في الحقول الرئيسية'),
        [
          { text: 'لا تعدّل', style: 'cancel', onPress: endUpd },
          {
            text: 'تعديل في EMIS',
            onPress: () => {
              if (!upd.current) return;
              upd.current.stage = 'save';
              toast(`جارٍ تعديل ${nm} في EMIS...`);
              updCmd({ emisId: m.id });
            },
          },
        ],
        { cancelable: false },
      );
      return;
    }
    endUpd();
    if (st.skip) toast(st.why || `${nm} غير موجود في EMIS — عُدّل في موقع الطلاب فقط`);
    else if (st.saved) {
      // نسخة احتياطية من سجل EMIS قبل التعديل (للاسترجاع عند الخطأ)
      if (st.backup) {
        AsyncStorage.getItem(K_BACKUP)
          .then(v => {
            const arr = v ? JSON.parse(v) : [];
            arr.push({ t: Date.now(), site: nm, emisId: st.match?.id, before: st.backup });
            return AsyncStorage.setItem(K_BACKUP, JSON.stringify(arr.slice(-200)));
          })
          .catch(() => {});
      }
      logOp(cur.d, cur.id, cur.k, true, 'تعديل');
      emisStale.current = true;
      toast(`✅ عُدّل ${nm} في EMIS أيضاً`);
    } else {
      const why = (st.miss || []).join('\n') || 'سبب غير معروف';
      logOp(cur.d, cur.id, cur.k, false, 'تعديل: ' + why);
      Alert.alert('لم يُعدَّل في EMIS', `${nm}\n\n${why}`);
    }
  };

  const onEmisStatus = (raw: string) => {
    if (upd.current && !send.current) return onUpdStatus(raw);
    const cur = send.current;
    if (!cur) return;
    let st: { info?: string; saved?: boolean; ok?: number; miss?: string[]; dry?: boolean; rows?: PreviewRow[]; summary?: { stage: string; room: string; place: string; city: string; gender: string; idNumber: string } };
    try {
      st = JSON.parse(raw);
    } catch {
      return;
    }
    if (st.info) return;
    const nm = fullName(cur.d);
    const miss = st.miss || [];

    if (cur.stage === 'check') {
      if (sendTimer.current) clearTimeout(sendTimer.current);
      setBusyText('');
      if (miss.length) {
        endSend();
        logOp(cur.d, cur.id, cur.k, false, 'الفحص: ' + miss.join('، '));
        Alert.alert('لا يمكن إرسال الطالب', `${nm}\n\n✖ ${miss.join('\n✖ ')}${cur.issues.length ? '\n\nملاحظات على الاستمارة:\n⚠ ' + cur.issues.join('\n⚠ ') : ''}`);
        return;
      }
      const sm = st.summary;
      const warn = [
        doneKeys.current.has(cur.k) ? 'سُجّل سابقاً من التطبيق' : '',
        cur.d.reviewed ? 'عليه «تمت المراجعة» في موقعك' : '',
        ...cur.issues,
      ].filter(Boolean);
      const rows: PreviewRow[] =
        st.rows ||
        (sm
          ? [
              ['الصف', String(cur.d.grade || ''), sm.stage],
              ['الشعبة', String(cur.d.section || ''), sm.room || 'بدون شعبة'],
              ['المكان', '', sm.place],
              ['المدينة', '', sm.city],
              ['الجنس', String(cur.d.gender || ''), sm.gender],
              ['رقم الهوية', '', sm.idNumber],
            ]
          : []);
      const ageWarn = cur.issues.some(x => x.startsWith('العمر'));
      lastPreview.current = { name: nm, rows, warn };
      setPreview({ ...lastPreview.current, age: ageWarn || cur.d.ageExceptionReason ? { required: false, value: String(cur.d.ageExceptionReason || '') } : undefined });
      return;
    }

    // نتيجة الإرسال
    // (v8.17) رفض EMIS بسبب العمر ولم يُكتب سبب: نعيد المعاينة مع حقل «سبب استثناء العمر» إلزامي
    if (!st.saved && !cur.d.ageExceptionReason && lastPreview.current && /عمر|العمر|استثناء|age/i.test(miss.join(' '))) {
      if (sendTimer.current) clearTimeout(sendTimer.current);
      setBusyText('');
      cur.stage = 'check';
      setPreview({ ...lastPreview.current, age: { required: true, note: 'رفض EMIS: ' + miss.join('، ') } });
      return;
    }
    endSend();
    if (st.saved && !miss.length) {
      doneKeys.current.add(cur.k);
      AsyncStorage.setItem(K_DONE_APP, JSON.stringify([...doneKeys.current].slice(-5000))).catch(() => {});
      siteRef.current?.injectJavaScript(`window.__emisMark&&window.__emisMark(${JSON.stringify(cur.k)},${JSON.stringify(cur.id)});true;`);
      logOp(cur.d, cur.id, cur.k, true, '');
      emisStale.current = true;
      toast(`✅ سُجّل ${nm} في EMIS`);
    } else {
      const why = miss.join('، ') || 'لم يُحفظ';
      logOp(cur.d, cur.id, cur.k, false, why);
      Alert.alert('لم يُسجَّل في EMIS', `${nm}\n\n${why}`);
    }
  };

  const previewCancel = () => {
    setPreview(null);
    endSend();
  };
  const previewSend = (ageReason: string) => {
    setPreview(null);
    const cur = send.current;
    if (!cur) return;
    if (ageReason) cur.d = { ...cur.d, ageExceptionReason: ageReason };
    cur.stage = 'send';
    setBusyText(`إرسال ${fullName(cur.d)} إلى EMIS...`);
    emisCmd('api', cur.d);
  };

  /* ===================== المقارنة مع EMIS ===================== */
  const startCompare = (show = true) => {
    if (compareStep.current !== 'none') return;
    compareStep.current = 'emis';
    setCmp(c => ({ ...c, visible: show, step: 'emis', text: 'قراءة طلاب EMIS...', percent: 5, mark: undefined }));
    injectAct('emis', '!!window.__emisList&&(window.__emisList(),true)', 'cmp-list:emis');
    setTimeout(() => {
      if (compareStep.current === 'emis') compareFail('انتهت مهلة قراءة EMIS');
    }, 100000);
  };
  const compareFail = (why: string) => {
    compareStep.current = 'none';
    cmpWait.current?.('تعذّرت المقارنة: ' + why);
    cmpWait.current = null;
    setCmp(c => ({ ...c, step: 'error', text: why, percent: 0 }));
  };
  const onEmisList = (raw: string) => {
    if (compareStep.current !== 'emis') return;
    let p: { done?: boolean; error?: string; rows?: number; total?: number; keys?: string[]; names?: string[] };
    try {
      p = JSON.parse(raw);
    } catch {
      return;
    }
    if (!p.done) {
      setCmp(c => ({ ...c, text: `قراءة طلاب EMIS... ${p.rows || 0}${p.total ? ' من ' + p.total : ''}`, percent: 5 + (40 * (p.rows || 0)) / Math.max(1, p.total || 1) }));
      return;
    }
    if (p.error) {
      compareFail(p.error);
      return;
    }
    existingRef.current = { keys: p.keys || [], names: p.names || [], rows: p.rows || 0 };
    compareSite();
  };
  const compareSite = () => {
    compareStep.current = 'site';
    setCmp(c => ({ ...c, step: 'site', text: 'قراءة موقع الطلاب والمقارنة...', percent: 60 }));
    const ex = existingRef.current;
    const arg = JSON.stringify({ keys: ex?.keys || [], names: ex?.names || [] });
    injectAct('site', '!!window.__emisCompare&&(window.__emisCompare(' + arg + '),true)', 'cmp-site:site');
  };
  const onCompareResult = (raw: string) => {
    if (compareStep.current !== 'site') return;
    compareStep.current = 'none';
    let r: { ok: boolean; error?: string; school: string; total: number; items: CmpItem[] };
    try {
      r = JSON.parse(raw);
    } catch {
      return;
    }
    if (!r.ok) {
      compareFail(r.error || 'تعذّرت قراءة موقع الطلاب');
      return;
    }
    const report = { school: r.school, total: r.total, emisRows: existingRef.current?.rows || 0, items: r.items || [] };
    lastReport.current = report;
    setCmp(c => ({ ...c, step: 'done', text: '', percent: 100, report }));
    if (cmpWait.current) {
      cmpWait.current(compareSummary(report));
      cmpWait.current = null;
    }
  };
  const compareSummary = (r: CmpReport) => {
    const missing = r.items.filter(i => !i.inEmis);
    const toMark = r.items.filter(i => i.inEmis && !i.reviewed);
    const line = (i: CmpItem) =>
      `id=${i.id} | ${i.name} | ${[i.grade, i.section].filter(Boolean).join(' ')}${i.reviewed ? ' | عليه تمت المراجعة' : ''}${i.maybe ? ' | تطابق ثلاثي فقط' : ''}${i.noGgf ? ' | بدون جد الأب' : ''}`;
    return [
      `المدرسة: ${r.school}. في موقع الطلاب: ${r.total}. في EMIS: ${r.emisRows}.`,
      `موجود في EMIS: ${r.total - missing.length} (منهم بدون «تمت المراجعة»: ${toMark.length}).`,
      `غير موجود في EMIS: ${missing.length}${missing.length > 80 ? ' (أول 80)' : ''}:`,
      ...missing.slice(0, 80).map(line),
    ].join('\n');
  };

  /* ===================== مساعد الأوامر: أفعال التطبيق ===================== */
  const fmtT = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const appActions: AppActions = {
    status: async () => {
      const day = new Date().toDateString();
      const today = opsRef.current.filter(o => new Date(o.t).toDateString() === day);
      const r = lastReport.current;
      return [
        `التبويب المفتوح: ${activeRef.current}${settingsRef.current.split ? ' (عرض الشاشتين)' : ''}`,
        `عمليات اليوم: ${today.length} (نجحت ${today.filter(o => o.result === 'ok').length}، فشلت ${today.filter(o => o.result === 'fail').length}). كل السجل: ${opsRef.current.length}.`,
        r ? `آخر مقارنة: ${r.school} — في الموقع ${r.total}، غير موجود في EMIS ${r.items.filter(i => !i.inEmis).length}.` : 'لم تُشغَّل مقارنة بعد.',
        send.current || upd.current ? 'يوجد إرسال أو تعديل جارٍ الآن.' : '',
        `النسخة: ${installedVersion()}`,
      ]
        .filter(Boolean)
        .join('\n');
    },
    openTab: async tab => {
      setActive(tab);
      return 'فُتح التبويب ' + tab;
    },
    reload: async pane => {
      reload(pane);
      return 'أُعيد تحميل ' + pane;
    },
    compare: () =>
      new Promise<string>(resolve => {
        if (compareStep.current !== 'none') return resolve('توجد مقارنة جارية الآن، انتظر.');
        cmpWait.current = resolve;
        startCompare(false);
      }),
    showCompare: async () => {
      if (!lastReport.current) return 'لا توجد مقارنة بعد — شغّل compare_with_emis أولاً.';
      setShowCmd(false);
      setCmp(c => ({ ...c, visible: true }));
      return 'فُتحت شاشة المقارنة.';
    },
    sendStudent: async id => {
      if (send.current || upd.current) return 'يوجد إرسال جارٍ الآن، انتظر.';
      const it = lastReport.current?.items.find(i => i.id === id);
      if (it?.inEmis) return `${it.name} موجود في EMIS مسبقاً — لم أرسله.`;
      setShowCmd(false);
      if (!settingsRef.current.split) setActive('site');
      siteRef.current?.injectJavaScript(`window.__emisSendId&&window.__emisSendId(${Number(id)});true;`);
      return `فُتح فحص ومعاينة إرسال ${it ? it.name : 'الطالب ' + id}. المستخدم يراجع ويضغط «إرسال» بنفسه.`;
    },
    markReviewed: async () => {
      const r = lastReport.current;
      if (!r) return 'لا توجد مقارنة بعد — شغّل compare_with_emis أولاً.';
      const ids = r.items.filter(i => i.inEmis && !i.reviewed).map(i => i.id);
      if (!ids.length) return 'كل الموجودين في EMIS عليهم «تمت المراجعة».';
      markAllReviewed(ids);
      return `طُلب تأكيد المستخدم لتحديد ${ids.length} طالب.`;
    },
    searchOps: async (q, result) => {
      const qq = q.trim();
      const hits = opsRef.current
        .filter(o => (result === 'all' ? true : o.result === result))
        .filter(o => !qq || o.name.includes(qq) || o.school.includes(qq))
        .slice(-30)
        .reverse();
      if (!hits.length) return 'لا نتائج.';
      return hits.map(o => `${fmtT(o.t)} | ${o.name} | ${o.grade} ${o.section} | ${o.result === 'ok' ? 'نجح' : 'فشل'}${o.reason ? ' | ' + o.reason : ''}`).join('\n');
    },
    exportOps: async () => {
      if (!opsRef.current.length) return 'السجل فارغ.';
      await exportOps(opsRef.current);
      return 'فُتحت نافذة مشاركة ملف Excel.';
    },
    showOps: async () => {
      setShowCmd(false);
      setShowOps(true);
      return 'فُتح سجل العمليات.';
    },
    checkUpdates: async () => {
      await checkUpdates(true);
      return 'تم الفحص؛ إن وُجد تحديث ظهرت نافذته.';
    },
  };

  const markAllReviewed = (ids: number[]) => {
    if (!ids.length) return;
    Alert.alert('تحديد «تمت المراجعة»', `سيُحدَّد «تمت المراجعة» في موقع الطلاب لـ ${ids.length} طالب موجودين في EMIS (بالاسم الرباعي). متابعة؟`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'تحديد',
        onPress: () => {
          setCmp(c => ({ ...c, mark: { running: true, done: 0, total: ids.length, ok: 0, already: 0, failed: 0 } }));
          injectAct('site', '!!window.__emisMarkMany&&(window.__emisMarkMany(' + JSON.stringify(ids) + '),true)', 'cmp-mark:site');
        },
      },
    ]);
  };
  const onMarkManyProgress = (raw: string) => {
    let m: { running: boolean; done: number; total: number; ok: number; already: number; failed: number; error?: string };
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    setCmp(c => ({ ...c, mark: m }));
    if (!m.running) {
      toast(`حُدّد «تمت المراجعة» لـ ${m.ok} طالب` + (m.failed ? ` · فشل ${m.failed}` : ''));
      if (existingRef.current) setTimeout(compareSite, 600);
    }
  };

  /* ===================== Excel: تعبئة أي نموذج في EMIS ===================== */
  const pickExcel = async () => {
    let res: DocumentPicker.DocumentPickerResult;
    try {
      res = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv', 'text/comma-separated-values', 'application/octet-stream'],
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
      const g = parseGeneric(
        isCsv ? { text: await FileSystem.readAsStringAsync(f.uri) } : { base64: await FileSystem.readAsStringAsync(f.uri, { encoding: FileSystem.EncodingType.Base64 }) },
      );
      setExcel(() => ({ fileName: f.name || 'ملف', sheet: g.sheet, headers: g.headers, rows: g.rows.slice(0, 5000), status: {}, selected: 0 }));
      toast(`قُرئ ${g.rows.length} صف من «${f.name}»`);
    } catch (e) {
      Alert.alert('تعذّرت قراءة الملف', (e as Error)?.message || '');
    }
  };
  const fillExcelRow = (i: number) => {
    const d = excelRef.current;
    if (!d || !d.rows[i]) return;
    const pairs = d.headers.map((h, j) => [h, d.rows[i][j] || '']).filter(([h, v]) => h && v);
    setExcelBusy(true);
    if (settingsRef.current.autoSwitch) setActive('emis');
    injectAct('emis', '!!window.__emisFillGeneric&&(window.__emisFillGeneric(' + JSON.stringify(pairs) + ',' + i + '),true)', 'generic:emis');
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
          return;
        case 'act': {
          if (m.ok) return;
          if (m.action === 'cmp-list:emis') compareFail('المساعد غير جاهز في EMIS — سجّل الدخول وافتح «إدارة الطلاب»');
          else if (m.action === 'cmp-site:site') compareFail('المساعد غير جاهز في موقع الطلاب — افتح صفحة المنسق');
          else if (m.action === 'cmp-mark:site') {
            setCmp(c => ({ ...c, mark: undefined }));
            toast('افتح صفحة المنسق في موقع الطلاب');
          } else if (m.action === 'generic:emis') {
            setExcelBusy(false);
            toast('افتح EMIS وسجّل الدخول وافتح النموذج، ثم «تعبئة»');
          }
          return;
        }
        case 'set': {
          const v = m.v;
          store.current[m.k] = v;
          persistStore();
          const str = typeof v === 'string' && v ? v : '';
          if (pane === 'site') {
            // طلب زر «إرسال إلى EMIS»: يتولاه التطبيق فقط (لا يُمرَّر لـ EMIS حتى لا يُسجَّل مرتين)
            if (m.k === K_SEND) return void (str && onSendRequest(str));
            if (m.k === K_UPD) return void (str && onUpdRequest(str));
            if (m.k === K_CMP) return void (str && onCompareResult(str));
            if (m.k === K_MARKMANY) return void (str && onMarkManyProgress(str));
            if (m.k === K_MARK) {
              try {
                const r = JSON.parse(str);
                if (r.res !== 'ok' && r.res !== 'already') addError('site', 'warn', `[EMIS app] لم أستطع تحديد «تمت المراجعة» في موقعك (${r.res}) — حدده يدوياً: ${r.k}`);
              } catch {
                /* ignore */
              }
              return;
            }
            // أوامر السكربت القديمة من موقع الطلاب لا تُرسل لـ EMIS (الإرسال يتم من التطبيق)
            if (SITE_ONLY.has(m.k)) return;
          } else {
            if (m.k === K_GSTAT) return void (str && onGenericStatus(str));
            if (m.k === K_EXIST) return void (str && onEmisList(str));
            // نتيجة EMIS لا تُرسل لموقع الطلاب (حتى لا يحدد «تمت المراجعة» لطالب آخر مفتوح هناك)
            if (m.k === K_STATUS) return void (str && onEmisStatus(str));
          }
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

  /* ---------- السجل والتصدير ---------- */
  const buildLogText = () => {
    const s = settingsRef.current;
    return [
      `سجل بوابة EMIS (التطبيق v${APP_VERSION} · السكربت v${scriptRef.current?.version || '?'})`,
      `وضع الكمبيوتر: ${s.desktopEmis ? 'مفعّل' : 'غير مفعّل'} — قوائم كالكمبيوتر: ${s.desktopUA ? 'نعم' : 'لا'}`,
      `المدارس: ${normalizedSchools(s.schools).map(r => `${r.key || 'الباقي'}=${r.mode === 'form' ? 'استمارة' : [r.gov, r.place, r.city].filter(Boolean).join('/')}`).join(' | ')}`,
      '',
      '===== آخر العمليات =====',
      ...opsRef.current.slice(-15).map(o => `${new Date(o.t).toLocaleString()} ${o.result === 'ok' ? '✔' : '✖'} ${o.name} ${o.reason}`),
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
  const exportOps = async (list: Op[]) => {
    try {
      const { headers, rows } = opsToRows(list);
      const uri = (FileSystem.cacheDirectory || '') + 'emis-log.xlsx';
      await FileSystem.writeAsStringAsync(uri, toXlsxBase64(headers, rows, 'السجل'), { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'سجل العمليات' });
    } catch (e) {
      Alert.alert('تعذّر التصدير', (e as Error)?.message || '');
    }
  };

  const reload = (p: Pane) => setReloadKey(k => ({ ...k, [p]: k[p] + 1 }));

  const clearHelperData = () => {
    store.current = {};
    AsyncStorage.removeItem(K_STORE).catch(() => {});
    reload('site');
    reload('emis');
    toast('تم مسح بيانات المساعد (تسجيل الدخول وسجل العمليات باقيان)');
  };

  if (!ready || !fontsLoaded) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: colors.navy }]}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  const split = settings.split;

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
          key={`${p}-${reloadKey[p]}-${url}-${desktop ? 'd' : 'm'}-${p === 'emis' && settings.desktopUA ? 'u' : ''}-${rulesJson.length}`}
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
          <Seg icon="bank-outline" label="EMIS" on={active === 'emis' && !split} onPress={() => {
            if (emisStale.current) {
              emisStale.current = false;
              emisRef.current?.injectJavaScript('location.reload();true;');
            }
            setActive('emis');
          }} />
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
        <IconButton icon="robot-outline" onPress={() => setShowCmd(true)} accessibilityLabel="مساعد الأوامر" />
        {pendingUpdate ? (
          <IconButton icon="download" bg={colors.gold} color={colors.navy} onPress={() => setUpdate(pendingUpdate)} accessibilityLabel="تحديث جديد" />
        ) : null}
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
              onClear={() =>
                Alert.alert('إزالة الملف', 'إزالة ملف Excel من التطبيق؟', [
                  { text: 'إلغاء', style: 'cancel' },
                  { text: 'إزالة', style: 'destructive', onPress: () => setExcel(() => null) },
                ])
              }
            />
          </SafeAreaView>
        ) : null}

        {/* شريط صغير أثناء الفحص/الإرسال */}
        {busyText ? (
          <SafeAreaView edges={['bottom']} style={styles.busyWrap} pointerEvents="none">
            <View style={styles.busy}>
              <ActivityIndicator color="#fff" size="small" />
              <T bold style={{ color: '#fff', fontSize: 13, flex: 1 }} numberOfLines={1}>
                {busyText}
              </T>
            </View>
          </SafeAreaView>
        ) : null}
      </View>

      <PreviewModal preview={preview} onCancel={previewCancel} onSend={previewSend} />

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
        onCompare={() => {
          setShowSettings(false);
          startCompare();
        }}
        onShowOps={() => {
          setShowSettings(false);
          setShowOps(true);
        }}
        opsCount={ops.length}
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

      <OpsScreen
        visible={showOps}
        ops={ops}
        onClose={() => setShowOps(false)}
        onExport={exportOps}
        onClear={() => {
          opsRef.current = [];
          setOpsState([]);
          AsyncStorage.removeItem(K_OPS_APP).catch(() => {});
        }}
      />
      <CommandScreen visible={showCmd} onClose={() => setShowCmd(false)} actions={appActions} />
      <UpdateModal manifest={update} onClose={() => setUpdate(null)} />
      <CompareScreen
        state={cmp}
        onClose={() => {
          compareStep.current = 'none';
          setCmp(c => ({ ...c, visible: false }));
        }}
        onRefresh={() => {
          compareStep.current = 'none';
          startCompare();
        }}
        onMarkAll={markAllReviewed}
        onCopy={t =>
          Clipboard.setStringAsync(t)
            .then(() => toast('نُسخ التقرير'))
            .catch(() => {})
        }
      />

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
  header: { flexDirection: ROW, alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.navy },
  segment: { flex: 1, flexDirection: ROW, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 3, gap: 3 },
  seg: { flex: 1, flexDirection: ROW, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 7, borderRadius: 9 },
  segOn: { backgroundColor: colors.gold },
  stacked: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff' },
  splitPane: { flex: 1, backgroundColor: '#fff' },
  divider: { height: 3, backgroundColor: colors.gold },
  progress: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: colors.gold },
  busyWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 30, elevation: 30, padding: 10 },
  busy: { flexDirection: ROW, alignItems: 'center', gap: 10, backgroundColor: colors.navy, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
});
