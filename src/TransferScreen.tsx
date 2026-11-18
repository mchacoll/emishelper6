import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, radius, ROW, themed } from './theme';
import { Button, Icon, IconButton, T } from './ui';

export type SiteStudent = {
  id: number;
  name: string;
  grade: string;
  section: string;
  n: { name: string; father: string; grandfather: string; greatGrandfather: string };
};
export type TransferState = { visible: boolean; loading: boolean; list: SiteStudent[]; error?: string };

const SECTIONS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
const strip = (v: string) =>
  v
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, '');

/** نقل طالب إلى صف/شعبة أخرى — يتغيّر في EMIS وفي موقع الطلاب معاً */
export function TransferScreen(props: {
  state: TransferState;
  busyId: number | null;
  onClose: () => void;
  onReload: () => void;
  onMove: (s: SiteStudent, grade: string, section: string) => void;
}) {
  const st = props.state;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<SiteStudent | null>(null);
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');

  const grades = useMemo(() => [...new Set(st.list.map(s => s.grade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar')), [st.list]);
  const sections = useMemo(() => [...new Set([...SECTIONS, ...st.list.map(s => s.section).filter(Boolean)])], [st.list]);
  const list = useMemo(() => {
    const qq = strip(q);
    return qq ? st.list.filter(s => strip(s.name).includes(qq)) : st.list;
  }, [st.list, q]);

  const pick = (s: SiteStudent) => {
    setSel(s);
    setGrade(s.grade);
    setSection(s.section);
  };
  const changed = !!sel && (grade !== sel.grade || section !== sel.section);

  return (
    <Modal visible={st.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.header }} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <IconButton icon="close" onPress={props.onClose} accessibilityLabel="إغلاق" />
          <T bold style={{ color: '#fff', fontSize: 17, flex: 1 }}>
            نقل طالب إلى صف أو شعبة
          </T>
          {!st.loading ? <IconButton icon="refresh" onPress={props.onReload} accessibilityLabel="تحديث" /> : null}
        </View>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {st.loading || st.error ? (
            <View style={styles.center}>
              {st.loading ? <ActivityIndicator size="large" color={colors.navy} /> : <Icon name="alert-circle" size={40} color={colors.red} />}
              <T bold style={{ textAlign: 'center', color: st.error ? colors.red : colors.text }}>{st.error || 'قراءة طلاب موقع الطلاب...'}</T>
              {st.error ? <Button kind="primary" icon="refresh" label="إعادة المحاولة" onPress={props.onReload} /> : null}
            </View>
          ) : (
            <>
              <View style={{ padding: 12, gap: 6 }}>
                <TextInput style={styles.input} value={q} onChangeText={setQ} placeholder="ابحث باسم الطالب" placeholderTextColor={colors.muted} />
                <T style={{ fontSize: 11, color: colors.muted }}>
                  يُنقل الطالب في EMIS وفي موقع الطلاب معاً، بعد معاينة وتأكيد. افتح «إدارة الطلاب» في EMIS وصفحة المنسق في الموقع.
                </T>
              </View>
              <FlatList
                data={list}
                keyExtractor={s => String(s.id)}
                contentContainerStyle={{ paddingBottom: sel ? 320 : 20 }}
                renderItem={({ item }) => (
                  <Pressable onPress={() => pick(item)} style={[styles.item, sel?.id === item.id && { backgroundColor: colors.goldSoft }]}>
                    <View style={{ flex: 1 }}>
                      <T bold style={{ fontSize: 13 }} numberOfLines={1}>
                        {item.name}
                      </T>
                      <T style={{ fontSize: 11, color: colors.muted }}>{[item.grade, item.section].filter(Boolean).join(' · ') || '—'}</T>
                    </View>
                    {props.busyId === item.id ? <ActivityIndicator color={colors.navy} /> : null}
                  </Pressable>
                )}
              />
              {sel ? (
                <View style={styles.sheet}>
                  <T bold style={{ fontSize: 14 }} numberOfLines={1}>
                    {sel.name}
                  </T>
                  <T style={{ fontSize: 12, color: colors.muted }}>
                    الآن: {[sel.grade, sel.section].filter(Boolean).join(' · ') || '—'}
                  </T>
                  <T bold style={{ fontSize: 12 }}>الصف الجديد</T>
                  <View style={styles.chips}>
                    {grades.map(g => (
                      <Chip key={g} on={g === grade} label={g} onPress={() => setGrade(g)} />
                    ))}
                  </View>
                  <T bold style={{ fontSize: 12 }}>الشعبة الجديدة</T>
                  <View style={styles.chips}>
                    {sections.map(x => (
                      <Chip key={x} on={x === section} label={x} onPress={() => setSection(x)} />
                    ))}
                    <Chip on={!section} label="بدون شعبة" onPress={() => setSection('')} />
                  </View>
                  <View style={[styles.row, { gap: 8 }]}>
                    <Button kind="soft" label="إلغاء" onPress={() => setSel(null)} style={{ flex: 1 }} />
                    <Button
                      kind="primary"
                      icon="swap-horizontal"
                      label="نقل"
                      onPress={() => props.onMove(sel, grade, section)}
                      disabled={!changed || props.busyId !== null}
                      busy={props.busyId === sel.id}
                      style={{ flex: 2 }}
                    />
                  </View>
                </View>
              ) : null}
            </>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && { backgroundColor: colors.navy, borderColor: colors.navy }]}>
      <T bold style={{ fontSize: 12, color: on ? '#fff' : colors.text }}>{label}</T>
    </Pressable>
  );
}

const styles = themed(() =>
  StyleSheet.create({
  head: { flexDirection: ROW, alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  row: { flexDirection: ROW, alignItems: 'center' },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.text,
    textAlign: 'right',
    fontFamily: fonts.regular,
  },
  item: {
    flexDirection: ROW,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 14,
    gap: 8,
    borderTopWidth: 1,
    borderColor: colors.border,
    elevation: 8,
  },
  chips: { flexDirection: ROW, flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  }),
);
