import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
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
import { type AutoPilotInfo, ControlPanel, type Phase, type Student } from './src/ControlPanel';
import { Onboarding } from './src/Onboarding';
import { DEFAULT_SETTINGS, normUrl, type Settings } from './src/settings';
import { type LogLine, SettingsScreen } from './src/SettingsScreen';
import { colors, ROW } from './src/theme';
import { Icon, IconButton, type IconName, T } from './src/ui';

type Pane = 'site' | 'emis';

const K_SETTINGS = 'app_settings_v1';
const K_STORE = 'gm_store_v1';
// مفاتيح السكربت
const K_DATA = 'emis_student_v2';
const K_CMD = 'emis_cmd_v2';
const K_STATUS = 'emis_status_v2';
const K_AUTO_REVIEW = 'emis_auto_review';
const K_CHAIN = 'emis_chain_new_v3';
const DESKTOP_WIDTH = 1280;
// متصفح كمبيوتر: EMIS يفتح القوائم المنسدلة تحت الحقل بدل نافذة ملء الشاشة الخاصة بالهاتف
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

// نصوص أزرار شريط السكربت (نضغطها من لوحة التطبيق)
const BAR = { fill: 'ابدأ', page2: 'ص2', stop: 'إيقاف', done: 'تمت المراجعة', skip: 'التالي' } as const;
type Action = keyof typeof BAR;

const toast = (t: string) => {
  try {
    ToastAndroid.show(t, ToastAndroid.SHORT);
  } catch {
    /* ignore */
  }
};

const keyOf = (d: Student | null) => (d ? [d.name, d.father, d.grandfather].map(x => (x || '').replace(/\s+/g, '')).join('|') : '');
const hhmm = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/* الإضافة التلقائية: مراحل الدورة الواحدة */
type Stage = 'none' | 'reloading' | 'opening' | 'running';

const parseStudent = (raw: unknown): Student | null => {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const d = JSON.parse(raw);
    return d && d.name ? d : null;
  } catch {
    return null;
  }
};

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
  const [active, setActive] = useState<Pane>('site');
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [errors, setErrors] = useState<LogLine[]>([]);
  const [reloadKey, setReloadKey] = useState({ site: 0, emis: 0 });
  const [loading, setLoading] = useState<Record<Pane, boolean>>({ site: true, emis: true });

  const [student, setStudent] = useState<Student | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [detail, setDetail] = useState('');
  const [barLog, setBarLog] = useState<Record<Pane, string>>({ site: '', emis: '' });

  // مخزن GM_* المشترك بين النافذتين
  const store = useRef<Record<string, unknown>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const siteRef = useRef<WebView>(null);
  const emisRef = useRef<WebView>(null);
  const views: Record<Pane, RefObject<WebView | null>> = { site: siteRef, emis: emisRef };
  const canBack = useRef<Record<Pane, boolean>>({ site: false, emis: false });
  const activeRef = useRef<Pane>('site');
  activeRef.current = active;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* ---------- الإضافة التلقائية ---------- */
  const [apPaused, setApPaused] = useState(false);
  const [apNote, setApNote] = useState('');
  const [apCount, setApCount] = useState(0);
  const apPausedRef = useRef(false);
  apPausedRef.current = apPaused;
  const cycle = useRef<{ stage: Stage; t: number }>({ stage: 'none', t: 0 });
  const processed = useRef(new Set<string>());
  const lastActivity = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  const apRunning = () => settingsRef.current.autoPilot && !apPausedRef.current;

  const pauseAutoPilot = (reason: string) => {
    cycle.current = { stage: 'none', t: 0 };
    setApPaused(true);
    apPausedRef.current = true;
    setApNote(reason);
    toast('توقفت الإضافة التلقائية: ' + reason);
  };

  /* ---------- تحميل الإعدادات والقيم المحفوظة ---------- */
  useEffect(() => {
    (async () => {
      try {
        const [s, st] = await Promise.all([AsyncStorage.getItem(K_SETTINGS), AsyncStorage.getItem(K_STORE)]);
        const loaded: Settings = s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS;
        setSettings(loaded);
        if (!loaded.onboarded) setShowGuide(true);
        if (st) store.current = JSON.parse(st) || {};
        setStudent(parseStudent(store.current[K_DATA]));
      } catch {
        /* ignore */
      }
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
    return buildInjection(siteHost ? [siteHost] : [], emisHost ? [emisHost] : [], !settings.showPageBar);
  }, [settings.siteUrl, settings.emisUrl, settings.showPageBar]);

  const addError = useCallback((pane: Pane, level: string, msg: string) => {
    setErrors(prev => [...prev.slice(-199), { t: Date.now(), pane, level, msg }]);
  }, []);

  /** إرسال أمر للسكربت في EMIS (نفس ما يرسله موقع الطلاب) */
  const sendCmd = (mode: 'new' | 'both') => {
    const v = JSON.stringify({ mode, t: Date.now() });
    store.current[K_STATUS] = '';
    store.current[K_CMD] = v;
    persistStore();
    emisRef.current?.injectJavaScript(remoteSetJs(K_STATUS, ''));
    emisRef.current?.injectJavaScript(remoteSetJs(K_CMD, v));
    setPhase('filling');
    setDetail('');
    if (settingsRef.current.autoSwitch && !settingsRef.current.split) setActive('emis');
  };

  /** بداية دورة: تحديث موقع الطلاب ثم فتح أول طالب غير مراجَع */
  const startCycle = () => {
    cycle.current = { stage: 'reloading', t: Date.now() };
    lastActivity.current = Date.now();
    setPhase('checking');
    setDetail('فحص موقع الطلاب بحثاً عن استمارات جديدة...');
    if (settingsRef.current.autoSwitch && !settingsRef.current.split) setActive('site');
    setReloadKey(k => ({ ...k, site: k.site + 1 }));
  };

  const endCycleIdle = (note: string) => {
    cycle.current = { stage: 'none', t: 0 };
    lastActivity.current = Date.now();
    setApNote(note);
    setPhase('idle');
    setDetail('');
  };

  // نتيجة «التالي» في موقع الطلاب أثناء الدورة
  const onSiteBarDuringCycle = (log: string) => {
    const c = cycle.current;
    if (c.stage === 'reloading') {
      const wait = 1500 - (Date.now() - c.t);
      if (wait > 0) {
        setTimeout(() => onSiteBarDuringCycle(log), wait);
        return;
      }
      cycle.current = { stage: 'opening', t: Date.now() };
      runAction('skip', 'site');
      return;
    }
    if (c.stage !== 'opening') return;
    const t = log.trim();
    if (t.startsWith('⚠️') || t.startsWith('❌')) {
      endCycleIdle(`لا توجد استمارات جديدة · آخر فحص ${hhmm()}`);
      return;
    }
    if (!t.startsWith('✔')) return;
    const d = parseStudent(store.current[K_DATA]);
    if (!d || d.reviewed) {
      endCycleIdle(`لا توجد استمارات جديدة · آخر فحص ${hhmm()}`);
      return;
    }
    if (processed.current.has(keyOf(d))) {
      pauseAutoPilot(`الطالب ${d.name} ${d.father || ''} أُضيف سابقاً ولم يُحدَّد «تمت المراجعة» — تحقق منه`);
      return;
    }
    cycle.current = { stage: 'running', t: Date.now() };
    setApNote(`جارٍ إضافة: ${d.name} ${d.father || ''}`);
    sendCmd('new');
  };

  /* ---------- ضغط أزرار السكربت من اللوحة ---------- */
  const runAction = useCallback((action: Action, pane: Pane) => {
    views[pane].current?.injectJavaScript(clickBarJs(`${action}:${pane}`, BAR[action]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAction = (action: Action) => {
    if (action === 'stop') {
      runAction('stop', 'emis');
      if (settingsRef.current.autoPilot && !apPausedRef.current) pauseAutoPilot('أوقفتها بزر الإيقاف');
    }
    else runAction(action, 'site');
    if (action === 'done') toast('تحديد «تمت المراجعة» والانتقال للطالب التالي...');
    if (action === 'skip') toast('الانتقال للطالب التالي غير المراجَع...');
  };

  // حالة العمل من رسائل السكربت
  const applyStatus = useCallback((k: string, v: unknown, pane: Pane) => {
    if (k === K_DATA && pane === 'site') setStudent(parseStudent(v));
    if (k === K_CMD && pane === 'site' && typeof v === 'string' && v) {
      try {
        const cmd = JSON.parse(v);
        setPhase(cmd.mode === 'newOnly' ? 'opening' : 'filling');
        setDetail('');
      } catch {
        /* ignore */
      }
    }
    if (k === K_STATUS && pane === 'emis' && typeof v === 'string' && v) {
      try {
        const st = JSON.parse(v);
        if (st.info) {
          setPhase('info');
          setDetail(st.info);
        } else if (st.stopped) {
          setPhase('stopped');
          setDetail((st.miss && st.miss[0]) || '');
        } else if (st.saved && !(st.miss && st.miss.length)) {
          setPhase('saved');
          setDetail(`عُبّئ ${st.ok} حقل وحُفظ الطالب`);
        } else {
          setPhase('incomplete');
          setDetail(st.miss && st.miss.length ? 'ناقص: ' + st.miss.join('، ') : 'لم يُعبّأ شيء');
        }
      } catch {
        /* ignore */
      }
    }
  }, []);

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
          if (pane === 'site' && apRunning()) onSiteBarDuringCycle(m.log);
          return;
        case 'act': {
          if (m.ok) return;
          const [action, from] = m.action.split(':') as [Action, Pane];
          if (action === 'skip' && cycle.current.stage === 'opening') {
            endCycleIdle(`تعذّر فتح قائمة الطلاب في موقعك · آخر فحص ${hhmm()}`);
            return;
          }
          // لا توجد صفحة طالب مفتوحة في موقعك: «تعبئة» و«ص2» تعملان من EMIS بآخر طالب محفوظ
          if ((action === 'fill' || action === 'page2') && from === 'site') {
            runAction(action, 'emis');
            setPhase('filling');
            setDetail('');
            if (settingsRef.current.autoSwitch && !settingsRef.current.split) setActive('emis');
            return;
          }
          if (action === 'stop' && from === 'emis') {
            runAction('stop', 'site');
            return;
          }
          toast(
            action === 'done' || action === 'skip'
              ? 'افتح صفحة الطلاب في «موقع الطلاب» أولاً'
              : 'المساعد غير جاهز في هذه الصفحة بعد',
          );
          return;
        }
        case 'set': {
          let v = m.v;
          // بعد «تمت المراجعة» يطلب الموقع فتح «جديد» فقط (newOnly).
          // إن فُعّل «تعبئة الطالب التالي تلقائياً» نحوّله إلى «جديد + تعبئة» (new) الموجود في السكربت.
          if (m.k === K_CMD && pane === 'site' && (settingsRef.current.autoFillNext || apRunning()) && typeof v === 'string') {
            try {
              const cmd = JSON.parse(v);
              if (cmd && cmd.mode === 'newOnly') {
                const d = parseStudent(store.current[K_DATA]);
                if (apRunning() && d && processed.current.has(keyOf(d))) {
                  // حماية من التكرار: لا نُدخل نفس الطالب مرتين
                  store.current[m.k] = v;
                  pauseAutoPilot(`الطالب ${d.name} ${d.father || ''} أُضيف سابقاً — تحقق منه`);
                  return;
                }
                v = JSON.stringify({ ...cmd, mode: 'new' });
                if (apRunning()) {
                  cycle.current = { stage: 'running', t: Date.now() };
                  if (d) setApNote(`جارٍ إضافة: ${d.name} ${d.father || ''}`);
                }
              }
            } catch {
              /* ignore */
            }
          }
          store.current[m.k] = v;
          persistStore();
          other?.injectJavaScript(remoteSetJs(m.k, v));
          applyStatus(m.k, v, pane);
          if (m.k === K_STATUS && pane === 'emis' && typeof v === 'string' && v) {
            lastActivity.current = Date.now();
            if (apRunning() && cycle.current.stage === 'running') {
              try {
                const st = JSON.parse(v);
                if (st.saved && !(st.miss && st.miss.length)) {
                  const d = parseStudent(store.current[K_DATA]);
                  if (d) processed.current.add(keyOf(d));
                  setApCount(c => c + 1);
                  setApNote(`آخر إضافة: ${d ? `${d.name} ${d.father || ''}` : ''} · ${hhmm()}`);
                  cycle.current = { stage: 'none', t: 0 };
                } else if (!st.info) {
                  pauseAutoPilot(st.stopped ? (st.miss && st.miss[0]) || 'تم الإيقاف' : 'حقول ناقصة: ' + (st.miss || []).join('، '));
                }
              } catch {
                /* ignore */
              }
            }
          }

          // التبديل التلقائي بين النافذتين (في وضع التبويبات فقط)
          const s = settingsRef.current;
          if (!s.autoSwitch || s.split) return;
          if (m.k === K_CMD && pane === 'site' && v) {
            setActive('emis');
          } else if (m.k === K_STATUS && pane === 'emis' && typeof v === 'string' && v) {
            try {
              if (JSON.parse(v).saved) setTimeout(() => setActive('site'), 900);
            } catch {
              /* ignore */
            }
          }
          return;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addError, persistStore, applyStatus, runAction],
  );

  const onNav = useCallback(
    (pane: Pane) => (n: WebViewNavigation) => {
      canBack.current[pane] = n.canGoBack;
    },
    [],
  );

  /* ---------- مؤقت الإضافة التلقائية ---------- */
  useEffect(() => {
    if (!settings.autoPilot) {
      cycle.current = { stage: 'none', t: 0 };
      return;
    }
    // السكربت: تحديد «تمت المراجعة» تلقائياً بعد الحفظ + فتح «جديد» للطالب التالي
    for (const [k, v] of [[K_AUTO_REVIEW, true], [K_CHAIN, true]] as const) {
      store.current[k] = v;
      siteRef.current?.injectJavaScript(remoteSetJs(k, v));
    }
    persistStore();
    activateKeepAwakeAsync('autopilot').catch(() => {});
    const iv = setInterval(() => {
      if (apPausedRef.current) return;
      const c = cycle.current;
      const now = Date.now();
      if (c.stage === 'none') {
        const busy = phaseRef.current === 'filling' || phaseRef.current === 'opening';
        if (!busy && now - lastActivity.current >= settingsRef.current.autoPilotMinutes * 60000) startCycle();
      } else if ((c.stage === 'reloading' || c.stage === 'opening') && now - c.t > 45000) {
        endCycleIdle(`تعذّر فتح موقع الطلاب · آخر محاولة ${hhmm()}`);
      } else if (c.stage === 'running' && now - c.t > 8 * 60000) {
        pauseAutoPilot('انتهت المهلة دون حفظ الطالب');
      }
    }, 4000);
    return () => {
      clearInterval(iv);
      deactivateKeepAwake('autopilot').catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoPilot]);

  const enableAutoPilot = () => {
    setApPaused(false);
    apPausedRef.current = false;
    lastActivity.current = 0;
    setApNote('سيبدأ الفحص الآن');
    saveSettings({ ...settingsRef.current, autoPilot: true });
  };

  // زر 🤖 في اللوحة
  const onAutoPilotPress = () => {
    const s = settingsRef.current;
    if (!s.autoPilot) {
      Alert.alert(
        'الإضافة التلقائية',
        `كل ${s.autoPilotMinutes === 1 ? 'دقيقة' : s.autoPilotMinutes + ' دقائق'} يفحص التطبيق موقع الطلاب، ويُدخل كل استمارة جديدة (ليس عليها «تمت المراجعة») في EMIS ويحفظها ثم يحددها «تمت المراجعة».\n\nيعمل والتطبيق مفتوح وأنت مسجّل الدخول في EMIS، ويتوقف عند أي حقل ناقص. جرّب «تعبئة» يدوياً على طالب واحد أولاً.`,
        [
          { text: 'إلغاء', style: 'cancel' },
          { text: 'تشغيل', onPress: enableAutoPilot },
        ],
      );
      return;
    }
    Alert.alert('الإضافة التلقائية', apPausedRef.current ? 'متوقفة مؤقتاً' : 'تعمل الآن', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'إيقاف نهائي', style: 'destructive', onPress: () => saveSettings({ ...settingsRef.current, autoPilot: false }) },
      { text: apPausedRef.current ? 'استئناف' : 'إيقاف مؤقت', onPress: toggleAutoPilot },
    ]);
  };

  const toggleAutoPilot = () => {
    if (apPausedRef.current) {
      setApPaused(false);
      apPausedRef.current = false;
      setApNote('استؤنفت · سيبدأ الفحص الآن');
      lastActivity.current = 0;
      cycle.current = { stage: 'none', t: 0 };
    } else {
      pauseAutoPilot('أوقفتها يدوياً');
    }
  };
  const autoPilotInfo: AutoPilotInfo = { enabled: settings.autoPilot, paused: apPaused, note: apNote, count: apCount };

  /* ---------- زر الرجوع في أندرويد ---------- */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const p = activeRef.current;
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
      'سجل مساعد EMIS (التطبيق v7.6.3)',
      `وضع الكمبيوتر: ${s.desktopEmis ? 'مفعّل' : 'غير مفعّل'} — الشاشتان معاً: ${s.split ? 'نعم' : 'لا'} — تعبئة التالي تلقائياً: ${s.autoFillNext ? 'نعم' : 'لا'}`,
      `الحالة: ${phase} ${detail}`,
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
    setStudent(null);
    setPhase('idle');
    setDetail('');
    reload('site');
    reload('emis');
    toast('تم مسح بيانات المساعد');
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
        {split ? (
          <View style={{ flex: 1, flexDirection: ROW, alignItems: 'center', gap: 8 }}>
            <View style={styles.logo}>
              <Icon name="lightning-bolt" size={18} color={colors.navy} />
            </View>
            <T bold style={{ color: '#fff', fontSize: 17 }}>
              مساعد EMIS
            </T>
          </View>
        ) : (
          <View style={styles.segment}>
            <Seg icon="school-outline" label="موقع الطلاب" on={active === 'site'} onPress={() => setActive('site')} />
            <Seg icon="bank-outline" label="EMIS" on={active === 'emis'} onPress={() => setActive('emis')} />
          </View>
        )}
        <IconButton
          icon={split ? 'view-agenda-outline' : 'view-split-horizontal'}
          onPress={() => saveSettings({ ...settings, split: !split })}
          accessibilityLabel="عرض الشاشتين"
        />
        <IconButton
          icon="refresh"
          onPress={() => reload(split ? 'emis' : active)}
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

        {/* لوحة التحكم فوق الصفحة (لا تغيّر حجم الصفحة حتى لا تتحرك القوائم أثناء التعبئة) */}
        <SafeAreaView edges={['bottom']} style={styles.panelWrap} pointerEvents="box-none">
          <ControlPanel
            student={student}
            phase={phase}
            detail={detail}
            emisLog={barLog.emis}
            siteLog={barLog.site}
            onFill={() => onAction('fill')}
            onPage2={() => onAction('page2')}
            onStop={() => onAction('stop')}
            onDone={() => onAction('done')}
            onSkip={() => onAction('skip')}
            autoPilot={autoPilotInfo}
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
          if (s.autoPilot && !settingsRef.current.autoPilot) {
            setApPaused(false);
            apPausedRef.current = false;
            lastActivity.current = 0;
            setApNote('سيبدأ الفحص الآن');
          }
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
