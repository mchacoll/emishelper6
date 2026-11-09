import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { colors, radius, ROW, shadow } from './theme';
import { Button, Icon, type IconName, T } from './ui';

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

export type Phase = 'idle' | 'filling' | 'opening' | 'saved' | 'incomplete' | 'stopped' | 'info';

const PHASE: Record<Phase, { label: string; icon: IconName; fg: string; bg: string }> = {
  idle: { label: 'جاهز', icon: 'circle-outline', fg: colors.blue, bg: colors.blueSoft },
  filling: { label: 'جارٍ التعبئة', icon: 'progress-pencil', fg: colors.orange, bg: colors.orangeSoft },
  opening: { label: 'فتح «جديد»', icon: 'file-plus-outline', fg: colors.orange, bg: colors.orangeSoft },
  saved: { label: 'تم الحفظ', icon: 'check-circle', fg: colors.green, bg: colors.greenSoft },
  incomplete: { label: 'يحتاج إكمال', icon: 'alert-circle', fg: colors.red, bg: colors.redSoft },
  stopped: { label: 'متوقف', icon: 'stop-circle', fg: colors.red, bg: colors.redSoft },
  info: { label: 'جاهز للتعبئة', icon: 'information', fg: colors.blue, bg: colors.blueSoft },
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
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [logTab, setLogTab] = useState<'emis' | 'site'>('emis');
  const busy = props.phase === 'filling' || props.phase === 'opening';
  const ph = PHASE[props.phase];
  const s = props.student;
  const fullName = s ? [s.name, s.father, s.grandfather].filter(Boolean).join(' ') : '';
  const meta = s ? [s.school, s.grade, s.section && `شعبة ${s.section}`].filter(Boolean).join(' · ') : '';

  // نبض بسيط لشارة الحالة أثناء العمل
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!busy) {
      pulse.setValue(1);
      return;
    }
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [busy, pulse]);

  const logText = (logTab === 'emis' ? props.emisLog : props.siteLog).trim();
  const lastLines = props.emisLog.trim().split('\n').filter(Boolean).slice(-2).join('\n');

  const badge = (
    <Animated.View style={[styles.badge, { backgroundColor: ph.bg, opacity: pulse }]}>
      <Icon name={ph.icon} size={14} color={ph.fg} />
      <T bold style={{ fontSize: 12, color: ph.fg }}>
        {ph.label}
      </T>
    </Animated.View>
  );

  if (collapsed) {
    return (
      <View style={[styles.sheet, styles.sheetCollapsed]}>
        <Pressable style={styles.collapsedRow} onPress={() => setCollapsed(false)}>
          {badge}
          <T bold style={{ flex: 1, fontSize: 14 }} numberOfLines={1}>
            {fullName || 'لا يوجد طالب محدد'}
          </T>
          <Icon name="chevron-up" size={24} color={colors.muted} />
        </Pressable>
        <View style={{ flexDirection: ROW, gap: 8 }}>
          {busy ? (
            <Button kind="danger" icon="stop" label="إيقاف" onPress={props.onStop} compact style={{ flex: 1 }} />
          ) : (
            <Button kind="gold" icon="play" label="تعبئة" onPress={props.onFill} compact style={{ flex: 1 }} />
          )}
          <Button kind="purple" icon="check-all" label="تم ⏭" onPress={props.onDone} compact style={{ flex: 1 }} disabled={busy} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.sheet}>
      <Pressable onPress={() => setCollapsed(true)} hitSlop={8} style={styles.handleWrap}>
        <View style={styles.handle} />
      </Pressable>

      {/* بطاقة الطالب */}
      <View style={styles.studentRow}>
        <View style={styles.avatar}>
          <Icon name="account-school" size={26} color={colors.navy} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <T bold style={{ fontSize: 16 }} numberOfLines={1}>
            {fullName || 'لا يوجد طالب محدد'}
          </T>
          <T style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
            {meta || (s ? '—' : 'افتح صفحة الطالب في «موقع الطلاب»')}
          </T>
        </View>
        {badge}
      </View>

      {props.detail ? (
        <View style={[styles.detail, { backgroundColor: ph.bg }]}>
          <T style={{ fontSize: 12, color: ph.fg, lineHeight: 18 }} numberOfLines={3}>
            {props.detail}
          </T>
        </View>
      ) : null}
      {s?.reviewed ? (
        <View style={[styles.detail, { backgroundColor: colors.purpleSoft }]}>
          <T style={{ fontSize: 12, color: colors.purple }}>هذا الطالب عليه «تمت المراجعة» — اضغط «تم ⏭» للانتقال</T>
        </View>
      ) : null}

      {/* الأزرار */}
      <View style={styles.actions}>
        {busy ? (
          <Button kind="danger" icon="stop" label="إيقاف" onPress={props.onStop} style={{ flex: 2 }} />
        ) : (
          <Button kind="gold" icon="play" label="تعبئة في EMIS" onPress={props.onFill} style={{ flex: 2 }} disabled={!s} />
        )}
        <Button kind="soft" icon="numeric-2-box-outline" label="ص2" onPress={props.onPage2} style={{ flex: 1 }} disabled={busy || !s} />
      </View>
      <View style={styles.actions}>
        <Button kind="purple" icon="check-all" label="تمت المراجعة ⏭" onPress={props.onDone} style={{ flex: 2 }} disabled={busy} />
        <Button kind="ghost" icon="skip-next" label="تخطي" onPress={props.onSkip} style={{ flex: 1 }} disabled={busy} />
      </View>

      {/* السجل */}
      <Pressable onPress={() => setShowLog(v => !v)} style={styles.logHead}>
        <Icon name="text-box-outline" size={18} color={colors.muted} />
        <T style={{ flex: 1, fontSize: 12, color: colors.muted }} numberOfLines={showLog ? 1 : 2}>
          {showLog ? 'السجل' : lastLines || 'السجل فارغ'}
        </T>
        <Icon name={showLog ? 'chevron-down' : 'chevron-left'} size={20} color={colors.muted} />
      </Pressable>
      {showLog ? (
        <View style={styles.logBox}>
          <View style={styles.logTabs}>
            {(['emis', 'site'] as const).map(k => (
              <Pressable key={k} onPress={() => setLogTab(k)} style={[styles.logTab, logTab === k && styles.logTabOn]}>
                <T bold style={{ fontSize: 12, color: logTab === k ? '#fff' : colors.muted }}>
                  {k === 'emis' ? 'EMIS' : 'موقع الطلاب'}
                </T>
              </Pressable>
            ))}
          </View>
          <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
            <T selectable style={{ fontSize: 12, lineHeight: 19 }}>
              {logText || '—'}
            </T>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 10,
    ...shadow,
  },
  sheetCollapsed: { paddingTop: 10 },
  handleWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 2 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border },
  collapsedRow: { flexDirection: ROW, alignItems: 'center', gap: 10 },
  studentRow: { flexDirection: ROW, alignItems: 'center', gap: 12 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    flexDirection: ROW,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  detail: { borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  actions: { flexDirection: ROW, gap: 8 },
  logHead: {
    flexDirection: ROW,
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  logBox: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 10, gap: 8 },
  logTabs: { flexDirection: ROW, gap: 6 },
  logTab: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.card },
  logTabOn: { backgroundColor: colors.navy },
});
