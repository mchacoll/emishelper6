import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, ROW } from './theme';
import { Button, Icon, IconButton, type IconName, T } from './ui';

export type CmpItem = {
  id: number;
  k: string;
  name: string;
  grade: string;
  section: string;
  reviewed: boolean;
  inEmis: boolean;
  maybe: boolean;
  noGgf: boolean;
  d: Record<string, unknown> | null;
};
export type CmpReport = { school: string; total: number; emisRows: number; items: CmpItem[] };
export type MarkState = { running: boolean; done: number; total: number; ok: number; already: number; failed: number; error?: string };
export type CompareState = {
  visible: boolean;
  step: 'emis' | 'site' | 'done' | 'error';
  text: string;
  percent: number;
  report?: CmpReport;
  mark?: MarkState;
};

type TabKey = 'missing' | 'toMark' | 'ok';

export function CompareScreen(props: {
  state: CompareState;
  onClose: () => void;
  onRefresh: () => void;
  onMarkAll: (ids: number[]) => void;
  onAddMissing: (items: CmpItem[]) => void;
  onCopy: (text: string) => void;
}) {
  const { state } = props;
  const [tab, setTab] = useState<TabKey>('missing');
  const r = state.report;
  const busy = state.step === 'emis' || state.step === 'site';
  const marking = !!state.mark?.running;

  const groups = useMemo(() => {
    const items = r?.items || [];
    return {
      missing: items.filter(i => !i.inEmis),
      toMark: items.filter(i => i.inEmis && !i.reviewed),
      ok: items.filter(i => i.inEmis && i.reviewed),
    };
  }, [r]);
  const missingToAdd = groups.missing.filter(i => !i.reviewed && i.d);
  const reviewedButMissing = groups.missing.filter(i => i.reviewed).length;

  const reportText = () => {
    if (!r) return '';
    const line = (i: CmpItem) => `- ${i.name} (${[i.grade, i.section].filter(Boolean).join(' / ')})${i.reviewed ? ' [تمت المراجعة]' : ''}${i.maybe ? ' [تطابق ثلاثي]' : ''}${i.noGgf ? ' [بدون جد الأب]' : ''}`;
    return [
      `مقارنة موقع الطلاب مع EMIS — ${r.school}`,
      `في موقع الطلاب: ${r.total} · في EMIS: ${r.emisRows}`,
      '',
      `غير موجود في EMIS (${groups.missing.length}):`,
      ...groups.missing.map(line),
      '',
      `موجود في EMIS بدون «تمت المراجعة» (${groups.toMark.length}):`,
      ...groups.toMark.map(line),
    ].join('\n');
  };

  const list = tab === 'missing' ? groups.missing : tab === 'toMark' ? groups.toMark : groups.ok;

  return (
    <Modal visible={state.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.navy }} edges={['top']}>
        <View style={styles.head}>
          <IconButton icon="close" onPress={props.onClose} accessibilityLabel="إغلاق" />
          <View style={{ flex: 1 }}>
            <T bold style={{ color: '#fff', fontSize: 17 }}>
              مقارنة الطلاب مع EMIS
            </T>
            {r ? <T style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>{r.school}</T> : null}
          </View>
          {r && !busy ? <IconButton icon="refresh" onPress={props.onRefresh} accessibilityLabel="تحديث" /> : null}
          {r ? <IconButton icon="content-copy" onPress={() => props.onCopy(reportText())} accessibilityLabel="نسخ التقرير" /> : null}
        </View>

        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {busy || state.step === 'error' ? (
            <View style={styles.center}>
              {busy ? <ActivityIndicator size="large" color={colors.navy} /> : <Icon name="alert-circle" size={42} color={colors.red} />}
              <T bold style={{ fontSize: 15, textAlign: 'center', color: state.step === 'error' ? colors.red : colors.text }}>
                {state.text}
              </T>
              {busy ? (
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${Math.round(state.percent)}%` }]} />
                </View>
              ) : (
                <Button kind="primary" icon="refresh" label="إعادة المحاولة" onPress={props.onRefresh} />
              )}
              <T style={{ fontSize: 12, color: colors.muted, textAlign: 'center', lineHeight: 19 }}>
                يجب أن تكون «إدارة الطلاب» مفتوحة في EMIS، وصفحة المنسق مفتوحة في موقع الطلاب.
              </T>
            </View>
          ) : r ? (
            <>
              {/* الملخص */}
              <View style={styles.cards}>
                <Stat icon="school" color={colors.blue} value={r.total} label="في موقع الطلاب" />
                <Stat icon="database-check" color={colors.green} value={groups.toMark.length + groups.ok.length} label="موجود في EMIS" />
                <Stat icon="database-remove" color={colors.red} value={groups.missing.length} label="غير موجود في EMIS" />
              </View>

              {/* تحديد «تمت المراجعة» */}
              <View style={styles.markCard}>
                {state.mark ? (
                  <View style={{ gap: 6 }}>
                    <T bold style={{ fontSize: 13 }}>
                      {state.mark.running
                        ? `جارٍ التحديد... ${state.mark.done} من ${state.mark.total}`
                        : state.mark.error
                          ? `توقف: ${state.mark.error}`
                          : `تم: حُدّد ${state.mark.ok}${state.mark.already ? ` · كان محدداً ${state.mark.already}` : ''}${state.mark.failed ? ` · فشل ${state.mark.failed}` : ''}`}
                    </T>
                    {state.mark.running ? (
                      <View style={styles.bar}>
                        <View style={[styles.barFill, { width: `${(100 * state.mark.done) / Math.max(1, state.mark.total)}%`, backgroundColor: colors.purple }]} />
                      </View>
                    ) : null}
                  </View>
                ) : null}
                <Button
                  kind="purple"
                  icon="check-all"
                  label={groups.toMark.length ? `تحديد «تمت المراجعة» لـ ${groups.toMark.length} موجود في EMIS` : 'كل الموجودين في EMIS محددون ✔'}
                  onPress={() => props.onMarkAll(groups.toMark.map(i => i.id))}
                  disabled={!groups.toMark.length || marking}
                  busy={marking}
                />
                {reviewedButMissing ? (
                  <T style={{ fontSize: 11, color: colors.red, lineHeight: 17 }}>
                    ⚠ {reviewedButMissing} طالب عليه «تمت المراجعة» في موقعك لكنه غير موجود في EMIS — راجعهم في القائمة الأولى.
                  </T>
                ) : null}
              </View>

              {/* التبويبات */}
              <View style={styles.tabs}>
                <TabBtn on={tab === 'missing'} label={`غير موجود (${groups.missing.length})`} color={colors.red} onPress={() => setTab('missing')} />
                <TabBtn on={tab === 'toMark'} label={`بدون مراجعة (${groups.toMark.length})`} color={colors.purple} onPress={() => setTab('toMark')} />
                <TabBtn on={tab === 'ok'} label={`مراجَع (${groups.ok.length})`} color={colors.green} onPress={() => setTab('ok')} />
              </View>

              <FlatList
                data={list}
                keyExtractor={i => String(i.id)}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: tab === 'missing' && missingToAdd.length ? 90 : 20 }}
                ListEmptyComponent={<T style={{ textAlign: 'center', color: colors.muted, padding: 24 }}>لا يوجد</T>}
                renderItem={({ item, index }) => (
                  <View style={styles.row}>
                    <T bold style={{ width: 28, color: colors.muted, fontSize: 12 }}>
                      {index + 1}
                    </T>
                    <View style={{ flex: 1, gap: 2 }}>
                      <T bold style={{ fontSize: 13 }} numberOfLines={1}>
                        {item.name}
                      </T>
                      <View style={[styles.flexRow, { flexWrap: 'wrap' }]}>
                        <T style={{ fontSize: 11, color: colors.muted }}>{[item.grade, item.section].filter(Boolean).join(' · ')}</T>
                        {item.reviewed ? <Badge text="تمت المراجعة" color={colors.green} /> : null}
                        {item.maybe ? <Badge text="تطابق ثلاثي فقط — تحقق" color={colors.orange} /> : null}
                        {item.noGgf ? <Badge text="بدون جد الأب" color={colors.muted} /> : null}
                      </View>
                    </View>
                  </View>
                )}
              />

              {tab === 'missing' && missingToAdd.length ? (
                <View style={styles.footer}>
                  <Button
                    kind="gold"
                    icon="playlist-plus"
                    label={`إضافة ${missingToAdd.length} غير مراجَع إلى قائمة التسجيل`}
                    onPress={() => props.onAddMissing(missingToAdd)}
                  />
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Stat({ icon, color, value, label }: { icon: IconName; color: string; value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Icon name={icon} size={20} color={color} />
      <T bold style={{ fontSize: 20, color, textAlign: 'center' }}>
        {value}
      </T>
      <T style={{ fontSize: 11, color: colors.muted, textAlign: 'center' }}>{label}</T>
    </View>
  );
}

function TabBtn({ on, label, color, onPress }: { on: boolean; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, on && { backgroundColor: color, borderColor: color }]}>
      <T bold style={{ fontSize: 12, color: on ? '#fff' : colors.text, textAlign: 'center' }} numberOfLines={1}>
        {label}
      </T>
    </Pressable>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <T style={{ fontSize: 10, color }}>{text}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: ROW, alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  bar: { alignSelf: 'stretch', height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5, backgroundColor: colors.gold },
  cards: { flexDirection: ROW, gap: 8, padding: 12 },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
  },
  markCard: {
    marginHorizontal: 12,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 8,
  },
  tabs: { flexDirection: ROW, gap: 6, padding: 12, paddingBottom: 6 },
  tab: { flex: 1, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  row: {
    flexDirection: ROW,
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  flexRow: { flexDirection: ROW, alignItems: 'center', gap: 6 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: colors.bg },
});
