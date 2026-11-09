import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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

export type Phase = 'idle' | 'filling' | 'opening' | 'saved' | 'incomplete' | 'stopped' | 'info' | 'checking';

export type AutoPilotInfo = {
  enabled: boolean;
  paused: boolean;
  note: string; // آخر فحص / سبب التوقف
  count: number; // عدد الطلاب الذين أُضيفوا في هذه الجلسة
};

const PHASE: Record<Phase, { label: string; icon: IconName; fg: string; bg: string }> = {
  idle: { label: 'جاهز', icon: 'circle-outline', fg: colors.blue, bg: colors.blueSoft },
  filling: { label: 'يعبّئ', icon: 'progress-pencil', fg: colors.orange, bg: colors.orangeSoft },
  opening: { label: 'فتح جديد', icon: 'file-plus-outline', fg: colors.orange, bg: colors.orangeSoft },
  saved: { label: 'حُفظ', icon: 'check-circle', fg: colors.green, bg: colors.greenSoft },
  incomplete: { label: 'ناقص', icon: 'alert-circle', fg: colors.red, bg: colors.redSoft },
  stopped: { label: 'متوقف', icon: 'stop-circle', fg: colors.red, bg: colors.redSoft },
  info: { label: 'جاهز', icon: 'information', fg: colors.blue, bg: colors.blueSoft },
  checking: { label: 'يفحص', icon: 'radar', fg: colors.orange, bg: colors.orangeSoft },
};

export function ControlPanel(props: {
  student: Student | null;
  phase: Phase;
  detail: string;
  emisLog: string;
  siteLog: string;
  onFill: () => void;
  onPage2: () => void;
  onStop: () => void;
  onDone: () => void;
  onSkip: () => void;
  autoPilot: AutoPilotInfo;
  onAutoPilotPress: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [logTab, setLogTab] = useState<'emis' | 'site'>('emis');
  const busy = props.phase === 'filling' || props.phase === 'opening' || props.phase === 'checking';
  const ph = PHASE[props.phase];
  const s = props.student;
  const ap = props.autoPilot;
  const fullName = s ? [s.name, s.father, s.grandfather].filter(Boolean).join(' ') : '';
  const meta = s ? [s.grade, s.section && `شعبة ${s.section}`].filter(Boolean).join(' · ') : '';

  // نبض لشارة الحالة أثناء العمل
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

  const apColor = !ap.enabled ? colors.muted : ap.paused ? colors.red : colors.green;
  const apBg = !ap.enabled ? colors.bg : ap.paused ? colors.redSoft : colors.greenSoft;

  // سطر واحد للملاحظات: سبب النقص / حالة الإضافة التلقائية
  const note = props.detail || (ap.enabled ? ap.note : '') || (s?.reviewed ? 'هذا الطالب عليه «تمت المراجعة»' : '');
  const noteColor = props.detail ? ph.fg : ap.enabled ? apColor : colors.purple;

  const logModal = (
    <Modal visible={showLog} animationType="slide" transparent onRequestClose={() => setShowLog(false)}>
      <Pressable style={styles.backdrop} onPress={() => setShowLog(false)} />
      <SafeAreaView edges={['bottom']} style={styles.logSheet}>
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
          <T bold style={{ fontSize: 13, maxWidth: 150 }} numberOfLines={1}>
            {s?.name ? `${s.name} ${s.father || ''}` : ph.label}
          </T>
          {ap.enabled ? <Icon name="robot-outline" size={16} color={apColor} /> : null}
          <Icon name="chevron-up" size={20} color={colors.muted} />
        </Pressable>
        {busy ? (
          <Pressable onPress={props.onStop} style={[styles.pillBtn, { backgroundColor: colors.red }, shadow]}>
            <Icon name="stop" size={22} color="#fff" />
          </Pressable>
        ) : (
          <Pressable onPress={props.onFill} style={[styles.pillBtn, { backgroundColor: colors.gold }, shadow]}>
            <Icon name="play" size={22} color={colors.navyDark} />
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.sheet}>
      {logModal}
      {/* السطر الأول: الطالب + الحالة + أدوات */}
      <View style={styles.row}>
        <Animated.View style={[styles.badge, { backgroundColor: ph.bg, opacity: pulse }]}>
          <Icon name={ph.icon} size={13} color={ph.fg} />
          <T bold style={{ fontSize: 11, color: ph.fg }}>
            {ph.label}
          </T>
        </Animated.View>
        <View style={{ flex: 1 }}>
          <T bold style={{ fontSize: 14 }} numberOfLines={1}>
            {fullName || 'افتح صفحة طالب في «موقع الطلاب»'}
          </T>
          {meta ? (
            <T style={{ fontSize: 11, color: colors.muted, marginTop: -2 }} numberOfLines={1}>
              {meta}
            </T>
          ) : null}
        </View>
        <Pressable onPress={props.onAutoPilotPress} style={[styles.apBtn, { backgroundColor: apBg }]} hitSlop={4}>
          <Icon name={ap.enabled && !ap.paused ? 'robot' : 'robot-outline'} size={18} color={apColor} />
          {ap.enabled && ap.count ? (
            <T bold style={{ fontSize: 11, color: apColor }}>
              {ap.count}
            </T>
          ) : null}
        </Pressable>
        <IconButton icon="text-box-outline" onPress={() => setShowLog(true)} color={colors.muted} bg={colors.bg} size={32} />
        <IconButton icon="chevron-down" onPress={() => setCollapsed(true)} color={colors.muted} bg={colors.bg} size={32} />
      </View>

      {note ? (
        <T style={{ fontSize: 11, color: noteColor, lineHeight: 16 }} numberOfLines={2}>
          {note}
        </T>
      ) : null}

      {/* السطر الثاني: الأزرار */}
      <View style={styles.row}>
        {busy ? (
          <Button kind="danger" icon="stop" label="إيقاف" onPress={props.onStop} compact style={{ flex: 1.5 }} />
        ) : (
          <Button kind="gold" icon="play" label="تعبئة" onPress={props.onFill} compact style={{ flex: 1.5 }} disabled={!s} />
        )}
        <Button kind="soft" label="ص2" onPress={props.onPage2} compact style={{ flex: 0.8 }} disabled={busy || !s} />
        <Button kind="purple" icon="check-all" label="تم ⏭" onPress={props.onDone} compact style={{ flex: 1.3 }} disabled={busy} />
        <Button kind="ghost" icon="skip-next" onPress={props.onSkip} compact style={{ flex: 0.6 }} disabled={busy} />
      </View>
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
  badge: {
    flexDirection: ROW,
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  apBtn: {
    flexDirection: ROW,
    alignItems: 'center',
    gap: 2,
    height: 32,
    minWidth: 32,
    paddingHorizontal: 7,
    borderRadius: 11,
    justifyContent: 'center',
  },
  pillWrap: { flexDirection: ROW, alignItems: 'center', gap: 8, padding: 10, justifyContent: 'flex-start' },
  pill: {
    flexDirection: ROW,
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: 12,
    height: 40,
  },
  pillBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(10,44,66,0.35)' },
  logSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: 14,
    gap: 10,
    maxHeight: '75%',
  },
  tab: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.bg },
  tabOn: { backgroundColor: colors.navy },
  logBox: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 10, minHeight: 160 },
});
