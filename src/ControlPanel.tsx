import { useEffect, useRef, useState } from 'react';
import { Animated, FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, ROW, shadow } from './theme';
import { Button, Icon, IconButton, type IconName, T } from './ui';

export type Student = {
  name?: string;
  father?: string;
  grandfather?: string;
  surname?: string;
  school?: string;
  grade?: string;
  section?: string;
  reviewed?: boolean;
};

export type QStatus = 'pending' | 'working' | 'done' | 'failed' | 'skipped';
export type QItem = { k: string; d: Student & Record<string, unknown>; status: QStatus; note?: string; t?: number };

export type Phase = 'idle' | 'syncing' | 'filling' | 'saved' | 'incomplete' | 'stopped' | 'finished';

export type AutoPilotInfo = {
  enabled: boolean;
  note: string;
};

const PHASE: Record<Phase, { label: string; icon: IconName; fg: string; bg: string }> = {
  idle: { label: 'جاهز', icon: 'circle-outline', fg: colors.blue, bg: colors.blueSoft },
  syncing: { label: 'مزامنة', icon: 'sync', fg: colors.orange, bg: colors.orangeSoft },
  filling: { label: 'يسجّل', icon: 'progress-pencil', fg: colors.orange, bg: colors.orangeSoft },
  saved: { label: 'حُفظ', icon: 'check-circle', fg: colors.green, bg: colors.greenSoft },
  incomplete: { label: 'ناقص', icon: 'alert-circle', fg: colors.red, bg: colors.redSoft },
  stopped: { label: 'متوقف', icon: 'stop-circle', fg: colors.red, bg: colors.redSoft },
  finished: { label: 'انتهى', icon: 'check-all', fg: colors.green, bg: colors.greenSoft },
};

const STATUS: Record<QStatus, { label: string; icon: IconName; fg: string }> = {
  pending: { label: 'بانتظار التسجيل', icon: 'clock-outline', fg: colors.blue },
  working: { label: 'يُسجَّل الآن', icon: 'progress-pencil', fg: colors.orange },
  done: { label: 'سُجّل في EMIS', icon: 'check-circle', fg: colors.green },
  failed: { label: 'يحتاج إكمال', icon: 'alert-circle', fg: colors.red },
  skipped: { label: 'تُخطّي', icon: 'skip-next-circle-outline', fg: colors.muted },
};

const nameOf = (d?: Student | null) => (d ? [d.name, d.father, d.grandfather].filter(Boolean).join(' ') : '');

export function ControlPanel(props: {
  current: QItem | null; // الطالب الذي يُسجَّل / توقف عنده
  phase: Phase;
  detail: string;
  items: QItem[];
  syncText: string;
  running: boolean;
  emisLog: string;
  siteLog: string;
  onSync: () => void;
  onCompare: () => void;
  onRun: () => void;
  onStop: () => void;
  onDoneManual: () => void;
  onSkip: () => void;
  onRetry: () => void;
  onClearFinished: () => void;
  autoPilot: AutoPilotInfo;
  onAutoPilotPress: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showList, setShowList] = useState(false);
  const [logTab, setLogTab] = useState<'emis' | 'site'>('emis');
  const busy = props.running || props.phase === 'syncing';
  const ph = PHASE[props.phase];
  const ap = props.autoPilot;
  const pending = props.items.filter(i => i.status === 'pending' || i.status === 'working').length;
  const done = props.items.filter(i => i.status === 'done').length;
  const failed = props.current && props.current.status === 'failed' ? props.current : null;
  const nextItem = props.items.find(i => i.status === 'pending') || null;
  const shown = props.current || nextItem;

  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!busy) {
      pulse.setValue(1);
      return;
    }
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.4, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [busy, pulse]);

  const apColor = ap.enabled ? colors.green : colors.muted;
  const note =
    props.phase === 'syncing'
      ? props.syncText
      : props.detail || (ap.enabled ? ap.note : '') || (!props.items.length ? 'اضغط «مزامنة» لجلب الطلاب غير المراجَعين من موقعك' : '');
  const noteColor = props.detail ? ph.fg : colors.muted;

  /* ---------- قائمة الطلاب ---------- */
  const listModal = (
    <Modal visible={showList} animationType="slide" transparent onRequestClose={() => setShowList(false)}>
      <Pressable style={styles.backdrop} onPress={() => setShowList(false)} />
      <SafeAreaView edges={['bottom']} style={styles.sheetModal}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <T bold style={{ fontSize: 16, flex: 1 }}>
            قائمة التسجيل ({props.items.length})
          </T>
          {props.items.some(i => i.status === 'done' || i.status === 'skipped') ? (
            <Button kind="ghost" icon="broom" label="إزالة المنتهين" onPress={props.onClearFinished} compact />
          ) : null}
          <IconButton icon="close" onPress={() => setShowList(false)} color={colors.text} bg={colors.bg} size={34} />
        </View>
        <FlatList
          data={props.items}
          keyExtractor={i => i.k}
          style={{ maxHeight: 420 }}
          ListEmptyComponent={
            <T style={{ color: colors.muted, textAlign: 'center', padding: 20 }}>لا يوجد طلاب. اضغط «مزامنة».</T>
          }
          renderItem={({ item, index }) => {
            const st = STATUS[item.status];
            return (
              <View style={styles.item}>
                <T bold style={{ width: 26, color: colors.muted, fontSize: 12 }}>
                  {index + 1}
                </T>
                <View style={{ flex: 1 }}>
                  <T bold style={{ fontSize: 14 }} numberOfLines={1}>
                    {nameOf(item.d)}
                  </T>
                  <T style={{ fontSize: 11, color: st.fg }} numberOfLines={2}>
                    {st.label}
                    {item.note ? ` · ${item.note}` : ''}
                  </T>
                </View>
                <Icon name={st.icon} size={20} color={st.fg} />
              </View>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );

  const logModal = (
    <Modal visible={showLog} animationType="slide" transparent onRequestClose={() => setShowLog(false)}>
      <Pressable style={styles.backdrop} onPress={() => setShowLog(false)} />
      <SafeAreaView edges={['bottom']} style={styles.sheetModal}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <T bold style={{ fontSize: 16 }}>
            السجل
          </T>
          <IconButton icon="close" onPress={() => setShowLog(false)} color={colors.text} bg={colors.bg} size={34} />
        </View>
        <View style={[styles.row, { gap: 6 }]}>
          {(['emis', 'site'] as const).map(k => (
            <Pressable key={k} onPress={() => setLogTab(k)} style={[styles.tab, logTab === k && styles.tabOn]}>
              <T bold style={{ fontSize: 12, color: logTab === k ? '#fff' : colors.muted }}>
                {k === 'emis' ? 'EMIS' : 'موقع الطلاب'}
              </T>
            </Pressable>
          ))}
        </View>
        <ScrollView style={styles.logBox}>
          <T selectable style={{ fontSize: 12, lineHeight: 20 }}>
            {(logTab === 'emis' ? props.emisLog : props.siteLog).trim() || '—'}
          </T>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  if (collapsed) {
    return (
      <View style={styles.pillWrap} pointerEvents="box-none">
        <Pressable onPress={() => setCollapsed(false)} style={[styles.pill, shadow]}>
          <Animated.View style={[styles.dot, { backgroundColor: ph.fg, opacity: pulse }]} />
          <T bold style={{ fontSize: 13, maxWidth: 170 }} numberOfLines={1}>
            {shown ? nameOf(shown.d) : ph.label} {pending ? `· ${pending}` : ''}
          </T>
          <Icon name="chevron-up" size={20} color={colors.muted} />
        </Pressable>
        {busy ? (
          <Pressable onPress={props.onStop} style={[styles.pillBtn, { backgroundColor: colors.red }, shadow]}>
            <Icon name="stop" size={22} color="#fff" />
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.sheet}>
      {listModal}
      {logModal}

      {/* السطر الأول */}
      <View style={styles.row}>
        <Animated.View style={[styles.badge, { backgroundColor: ph.bg, opacity: pulse }]}>
          <Icon name={ph.icon} size={13} color={ph.fg} />
          <T bold style={{ fontSize: 11, color: ph.fg }}>
            {ph.label}
          </T>
        </Animated.View>
        <T bold style={{ flex: 1, fontSize: 14 }} numberOfLines={1}>
          {shown ? nameOf(shown.d) : 'لا يوجد طلاب للتسجيل'}
        </T>
        <Pressable onPress={() => setShowList(true)} style={styles.counts} hitSlop={4}>
          <Icon name="format-list-numbered-rtl" size={16} color={colors.navy} />
          <T bold style={{ fontSize: 12, color: colors.navy }}>
            {pending}
          </T>
          <T style={{ fontSize: 11, color: colors.green }}>✔{done}</T>
        </Pressable>
        <Pressable onPress={props.onAutoPilotPress} style={[styles.apBtn, { backgroundColor: ap.enabled ? colors.greenSoft : colors.bg }]} hitSlop={4}>
          <Icon name={ap.enabled ? 'robot' : 'robot-outline'} size={18} color={apColor} />
        </Pressable>
        <IconButton icon="text-box-outline" onPress={() => setShowLog(true)} color={colors.muted} bg={colors.bg} size={32} />
        <IconButton icon="chevron-down" onPress={() => setCollapsed(true)} color={colors.muted} bg={colors.bg} size={32} />
      </View>

      {note ? (
        <T style={{ fontSize: 11, color: noteColor, lineHeight: 16 }} numberOfLines={2}>
          {note}
        </T>
      ) : null}

      {/* الأزرار */}
      {busy ? (
        <View style={styles.row}>
          <Button kind="danger" icon="stop" label="إيقاف" onPress={props.onStop} compact style={{ flex: 2 }} />
          {props.running ? <Button kind="ghost" icon="skip-next" label="تخطي" onPress={props.onSkip} compact style={{ flex: 1 }} /> : null}
        </View>
      ) : failed ? (
        <View style={styles.row}>
          <Button kind="purple" icon="check-all" label="حفظته ⏭" onPress={props.onDoneManual} compact style={{ flex: 1.4 }} />
          <Button kind="soft" icon="refresh" label="إعادة" onPress={props.onRetry} compact style={{ flex: 1 }} />
          <Button kind="ghost" icon="skip-next" label="تخطي" onPress={props.onSkip} compact style={{ flex: 1 }} />
        </View>
      ) : (
        <View style={styles.row}>
          <Button kind="soft" icon="sync" label="مزامنة" onPress={props.onSync} compact style={{ flex: 1 }} />
          <Button kind="soft" icon="scale-balance" label="مقارنة" onPress={props.onCompare} compact style={{ flex: 1 }} />
          <Button
            kind="gold"
            icon="play"
            label={pending ? `ابدأ (${pending})` : 'ابدأ'}
            onPress={props.onRun}
            compact
            style={{ flex: 1.3 }}
            disabled={!pending}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
    ...shadow,
  },
  row: { flexDirection: ROW, alignItems: 'center', gap: 6 },
  badge: { flexDirection: ROW, alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  counts: {
    flexDirection: ROW,
    alignItems: 'center',
    gap: 4,
    height: 32,
    paddingHorizontal: 8,
    borderRadius: 11,
    backgroundColor: colors.blueSoft,
  },
  apBtn: { height: 32, width: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pillWrap: { flexDirection: ROW, alignItems: 'center', gap: 8, padding: 10, justifyContent: 'flex-start' },
  pill: { flexDirection: ROW, alignItems: 'center', gap: 6, backgroundColor: colors.card, borderRadius: 999, paddingHorizontal: 12, height: 40 },
  pillBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(10,44,66,0.35)' },
  sheetModal: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: 14,
    gap: 10,
    maxHeight: '80%',
  },
  item: {
    flexDirection: ROW,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.bg },
  tabOn: { backgroundColor: colors.navy },
  logBox: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 10, minHeight: 160 },
});
