import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  I18nManager,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import {
  buildInjection,
  desktopViewportJs,
  hostOf,
  parseBridgeMessage,
  remoteSetJs,
  syncAndBootJs,
} from './src/bridge';

/* ===================== الإعدادات ===================== */
type Pane = 'site' | 'emis';
type Settings = {
  siteUrl: string;
  emisUrl: string;
  split: boolean;       // عرض النافذتين معاً (أعلى/أسفل)
  autoSwitch: boolean;  // الانتقال تلقائياً إلى EMIS عند «ابدأ» ثم العودة بعد الحفظ
  desktopEmis: boolean; // عرض EMIS بعرض شاشة الكمبيوتر
};

const DEFAULT_SETTINGS: Settings = {
  siteUrl: 'https://studentgate-kbbtktoc.manus.space',
  emisUrl: 'https://emis.moedu.gov.iq',
  split: false,
  autoSwitch: true,
  desktopEmis: false,
};
const DESKTOP_WIDTH = 1280;

const K_SETTINGS = 'app_settings_v1';
const K_STORE = 'gm_store_v1';
const K_CMD = 'emis_cmd_v2';
const K_STATUS = 'emis_status_v2';

const C = {
  navy: '#0f3b57',
  gold: '#e8a93a',
  blue: '#3d7ea6',
  bg: '#eef3f6',
  text: '#10212b',
  muted: '#5b6b75',
  red: '#c0392b',
};

const normUrl = (u: string) => {
  const t = u.trim();
  if (!t) return t;
  return /^https?:\/\//i.test(t) ? t : 'https://' + t;
};

type LogLine = { t: number; pane: Pane; level: string; msg: string };

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [active, setActive] = useState<Pane>('site');
  const [showSettings, setShowSettings] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const barLogs = useRef<Record<Pane, string>>({ site: '', emis: '' });
  const [reloadKey, setReloadKey] = useState({ site: 0, emis: 0 });

  // مخزن GM_* المشترك بين النافذتين
  const store = useRef<Record<string, unknown>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const views = { site: useRef<WebView>(null), emis: useRef<WebView>(null) };
  const canBack = useRef<Record<Pane, boolean>>({ site: false, emis: false });
  const activeRef = useRef<Pane>('site');
  activeRef.current = active;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* ---------- تحميل الإعدادات والقيم المحفوظة ---------- */
  useEffect(() => {
    (async () => {
      try {
        const [s, st] = await Promise.all([AsyncStorage.getItem(K_SETTINGS), AsyncStorage.getItem(K_STORE)]);
        if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) });
        if (st) store.current = JSON.parse(st) || {};
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
    return buildInjection(siteHost ? [siteHost] : [], emisHost ? [emisHost] : []);
  }, [settings.siteUrl, settings.emisUrl]);

  const addLog = useCallback((pane: Pane, level: string, msg: string) => {
    setLogs(prev => [...prev.slice(-199), { t: Date.now(), pane, level, msg }]);
  }, []);

  /* ---------- الرسائل القادمة من الصفحات ---------- */
  const onMessage = useCallback(
    (pane: Pane) => (e: WebViewMessageEvent) => {
      const m = parseBridgeMessage(e.nativeEvent.data);
      if (!m) return;
      const self = views[pane].current;
      const other = views[pane === 'site' ? 'emis' : 'site'].current;

      if (m.__gm === 'hello') {
        self?.injectJavaScript(syncAndBootJs(store.current));
        return;
      }
      if (m.__gm === 'bar') {
        barLogs.current[pane] = m.text;
        return;
      }
      if (m.__gm === 'log') {
        addLog(pane, m.level, m.msg);
        return;
      }
      if (m.__gm === 'set') {
        store.current[m.k] = m.v;
        persistStore();
        other?.injectJavaScript(remoteSetJs(m.k, m.v));

        // التبديل التلقائي بين النافذتين (في وضع التبويبات فقط)
        const s = settingsRef.current;
        if (!s.autoSwitch || s.split) return;
        if (m.k === K_CMD && pane === 'site' && m.v) {
          setActive('emis');
        } else if (m.k === K_STATUS && pane === 'emis' && typeof m.v === 'string' && m.v) {
          try {
            const st = JSON.parse(m.v);
            if (st && st.saved) setTimeout(() => setActive('site'), 900);
          } catch {
            /* ignore */
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addLog, persistStore],
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
      if (canBack.current[p]) {
        views[p].current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shareLogs = () => {
    const s = settingsRef.current;
    const text = [
      'سجل مساعد EMIS (التطبيق v7.6.1)',
      `وضع الكمبيوتر لـ EMIS: ${s.desktopEmis ? 'مفعّل' : 'غير مفعّل'} — عرض النافذتين معاً: ${s.split ? 'نعم' : 'لا'}`,
      '',
      '===== شريط EMIS =====',
      barLogs.current.emis || '(فارغ)',
      '',
      '===== شريط موقع الطلاب =====',
      barLogs.current.site || '(فارغ)',
      '',
      '===== الأخطاء =====',
      ...logs.map(l => `${new Date(l.t).toLocaleTimeString()} [${l.pane}] ${l.level}: ${l.msg}`),
    ].join('\n');
    Share.share({ message: text.slice(-60000) }).catch(() => {});
  };

  const reload = (p: Pane) => setReloadKey(k => ({ ...k, [p]: k[p] + 1 }));

  const clearHelperData = () => {
    store.current = {};
    AsyncStorage.removeItem(K_STORE).catch(() => {});
    reload('site');
    reload('emis');
  };

  if (!ready) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: C.navy }]}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  const split = settings.split;
  const paneStyle = (p: Pane) => {
    if (split) return styles.splitPane;
    // في وضع التبويبات تبقى النافذتان بحجمهما الكامل (حتى يعمل السكربت في الخلفية)
    // والنافذة غير النشطة تختفي خلف النشطة فقط
    const on = active === p;
    return [styles.stacked, { zIndex: on ? 2 : 1, elevation: on ? 2 : 1 }];
  };

  const renderPane = (p: Pane) => {
    const url = normUrl(p === 'site' ? settings.siteUrl : settings.emisUrl);
    return (
      <View
        key={p}
        style={paneStyle(p)}
        pointerEvents={split || active === p ? 'auto' : 'none'}
      >
        <WebView
          key={`${p}-${reloadKey[p]}-${url}-${p === 'emis' && settings.desktopEmis ? 'd' : 'm'}`}
          ref={views[p]}
          source={{ uri: url }}
          style={styles.fill}
          injectedJavaScript={injection}
          injectedJavaScriptBeforeContentLoaded={
            p === 'emis' && settings.desktopEmis ? desktopViewportJs(DESKTOP_WIDTH) : undefined
          }
          scalesPageToFit
          setBuiltInZoomControls
          setDisplayZoomControls={false}
          injectedJavaScriptForMainFrameOnly
          onMessage={onMessage(p)}
          onNavigationStateChange={onNav(p)}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          cacheEnabled
          setSupportMultipleWindows={false}
          originWhitelist={['*']}
          mixedContentMode="compatibility"
          allowsBackForwardNavigationGestures
          webviewDebuggingEnabled
          startInLoadingState
          renderLoading={() => (
            <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: '#fff' }]}>
              <ActivityIndicator color={C.navy} size="large" />
            </View>
          )}
          onError={e => addLog(p, 'error', `تعذّر فتح الصفحة: ${e.nativeEvent.description}`)}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: C.navy }]} edges={['top', 'bottom']}>
      <StatusBar style="light" />

      {/* الشريط العلوي */}
      <View style={styles.topBar}>
        <Text style={styles.title}>مساعد EMIS</Text>
        <View style={styles.row}>
          {!split && (
            <>
              <Tab label="موقع الطلاب" on={active === 'site'} onPress={() => setActive('site')} />
              <Tab label="EMIS" on={active === 'emis'} onPress={() => setActive('emis')} />
            </>
          )}
          <IconBtn label={split ? '▭' : '◫'} onPress={() => saveSettings({ ...settings, split: !split })} />
          <IconBtn label="↻" onPress={() => reload(split ? 'emis' : active)} onLongPress={() => { reload('site'); reload('emis'); }} />
          <IconBtn label="⚙" onPress={() => setShowSettings(true)} />
        </View>
      </View>

      <View style={[styles.fill, split ? styles.splitWrap : null]}>
        {renderPane('site')}
        {split && <View style={styles.divider} />}
        {renderPane('emis')}
      </View>

      <SettingsModal
        visible={showSettings}
        settings={settings}
        logs={logs}
        onClose={() => setShowSettings(false)}
        onSave={s => {
          saveSettings({ ...s, siteUrl: normUrl(s.siteUrl), emisUrl: normUrl(s.emisUrl) });
          setShowSettings(false);
        }}
        onClearData={clearHelperData}
        onClearLogs={() => setLogs([])}
        onShareLogs={shareLogs}
      />
    </SafeAreaView>
  );
}

/* ===================== عناصر صغيرة ===================== */
function Tab({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, on && styles.tabOn]}>
      <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
    </Pressable>
  );
}

function IconBtn({ label, onPress, onLongPress }: { label: string; onPress: () => void; onLongPress?: () => void }) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={styles.iconBtn} hitSlop={6}>
      <Text style={styles.iconText}>{label}</Text>
    </Pressable>
  );
}

function SettingsModal(props: {
  visible: boolean;
  settings: Settings;
  logs: LogLine[];
  onClose: () => void;
  onSave: (s: Settings) => void;
  onClearData: () => void;
  onClearLogs: () => void;
  onShareLogs: () => void;
}) {
  const [draft, setDraft] = useState(props.settings);
  useEffect(() => {
    if (props.visible) setDraft(props.settings);
  }, [props.visible, props.settings]);

  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={[styles.fill, { backgroundColor: C.bg }]}>
        <View style={styles.modalHead}>
          <Text style={styles.modalTitle}>الإعدادات</Text>
          <Pressable onPress={props.onClose} hitSlop={10}>
            <Text style={styles.modalClose}>✕</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <Field label="رابط موقع الطلاب">
            <TextInput
              style={styles.input}
              value={draft.siteUrl}
              onChangeText={siteUrl => setDraft({ ...draft, siteUrl })}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </Field>
          <Field label="رابط EMIS">
            <TextInput
              style={styles.input}
              value={draft.emisUrl}
              onChangeText={emisUrl => setDraft({ ...draft, emisUrl })}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </Field>
          <ToggleRow
            label="عرض النافذتين معاً (أعلى وأسفل)"
            value={draft.split}
            onChange={split => setDraft({ ...draft, split })}
          />
          <ToggleRow
            label="عرض EMIS بوضع الكمبيوتر (جرّبه إن فشل اختيار القوائم مثل الديانة واللغة الأم)"
            value={draft.desktopEmis}
            onChange={desktopEmis => setDraft({ ...draft, desktopEmis })}
          />
          <ToggleRow
            label="الانتقال تلقائياً إلى EMIS عند «ابدأ» والعودة بعد الحفظ"
            value={draft.autoSwitch}
            onChange={autoSwitch => setDraft({ ...draft, autoSwitch })}
          />

          <Pressable style={[styles.btn, { backgroundColor: C.gold }]} onPress={() => props.onSave(draft)}>
            <Text style={[styles.btnText, { color: C.navy }]}>حفظ</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, { backgroundColor: C.red }]}
            onPress={() => {
              props.onClearData();
              props.onClose();
            }}
          >
            <Text style={styles.btnText}>مسح بيانات المساعد (الطالب المحفوظ ومكان الشريط)</Text>
          </Pressable>

          <Pressable style={[styles.btn, { backgroundColor: C.blue }]} onPress={props.onShareLogs}>
            <Text style={styles.btnText}>📤 مشاركة السجل الكامل (لإرساله للدعم)</Text>
          </Pressable>

          <View style={styles.logHead}>
            <Text style={styles.label}>أخطاء المساعد ({props.logs.length})</Text>
            <Pressable onPress={props.onClearLogs}>
              <Text style={{ color: C.blue }}>مسح</Text>
            </Pressable>
          </View>
          <View style={styles.logBox}>
            {props.logs.length === 0 ? (
              <Text style={{ color: C.muted }}>لا شيء</Text>
            ) : (
              props.logs
                .slice()
                .reverse()
                .map((l, i) => (
                  <Text key={i} style={[styles.logLine, l.level === 'error' && { color: C.red }]}>
                    {new Date(l.t).toLocaleTimeString()} [{l.pane === 'site' ? 'الموقع' : 'EMIS'}] {l.msg}
                  </Text>
                ))
            )}
          </View>
          <Text style={{ color: C.muted, fontSize: 12, textAlign: 'right' }}>
            يعمل التطبيق بنفس سكربت «مساعد EMIS» v7.6.1: افتح الطالب في موقعك، ثم اضغط «▶ ابدأ» في
            الشريط الأزرق لتعبئة استمارة EMIS.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={[styles.label, { flex: 1 }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

/* ===================== الأنماط ===================== */
const rtlRow = I18nManager.isRTL ? 'row' : 'row-reverse';

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: rtlRow, alignItems: 'center', gap: 6 },
  topBar: {
    flexDirection: rtlRow,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: C.navy,
  },
  title: { color: '#fff', fontWeight: '700', fontSize: 16 },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.12)' },
  tabOn: { backgroundColor: C.gold },
  tabText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: C.navy },
  iconBtn: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  iconText: { color: '#fff', fontSize: 18 },
  stacked: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff' },
  splitWrap: { flexDirection: 'column' },
  splitPane: { flex: 1, backgroundColor: '#fff' },
  divider: { height: 4, backgroundColor: C.gold },
  modalHead: {
    flexDirection: rtlRow,
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: C.navy,
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  modalClose: { color: '#fff', fontSize: 20 },
  label: { color: C.text, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cfdbe2',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: C.text,
    textAlign: 'left',
  },
  toggleRow: { flexDirection: rtlRow, alignItems: 'center', gap: 10 },
  btn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14, textAlign: 'center' },
  logHead: { flexDirection: rtlRow, justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  logBox: { backgroundColor: '#fff', borderRadius: 10, padding: 10, gap: 4, minHeight: 60 },
  logLine: { fontSize: 11, color: C.text, textAlign: 'left' },
});
