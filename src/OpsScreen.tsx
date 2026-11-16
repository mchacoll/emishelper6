import { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, radius, ROW } from './theme';
import { Button, Icon, IconButton, T } from './ui';

/** عملية إرسال واحدة إلى EMIS */
export type Op = {
  t: number;
  id?: number;
  k: string;
  name: string;
  school: string;
  grade: string;
  section: string;
  result: 'ok' | 'fail';
  reason: string;
};

const fmt = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const opsToRows = (ops: Op[]) => ({
  headers: ['الوقت', 'الاسم', 'المدرسة', 'الصف', 'الشعبة', 'النتيجة', 'السبب'],
  rows: ops.map(o => [fmt(o.t), o.name, o.school, o.grade, o.section, o.result === 'ok' ? 'سُجّل' : 'لم يُسجَّل', o.reason]),
});

type Filter = 'all' | 'ok' | 'fail';

export function OpsScreen(props: { visible: boolean; ops: Op[]; onClose: () => void; onExport: (ops: Op[]) => void; onClear: () => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const okN = props.ops.filter(o => o.result === 'ok').length;
  const list = useMemo(() => {
    const qq = q.trim();
    return props.ops
      .filter(o => (filter === 'all' ? true : o.result === filter))
      .filter(o => !qq || o.name.includes(qq) || o.school.includes(qq))
      .slice()
      .reverse();
  }, [props.ops, filter, q]);

  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.navy }} edges={['top']}>
        <View style={styles.head}>
          <IconButton icon="close" onPress={props.onClose} accessibilityLabel="إغلاق" />
          <T bold style={{ color: '#fff', fontSize: 17, flex: 1 }}>
            سجل العمليات
          </T>
          {props.ops.length ? (
            <>
              <IconButton icon="microsoft-excel" onPress={() => props.onExport(list.slice().reverse())} accessibilityLabel="تصدير" />
              <IconButton
                icon="delete-outline"
                onPress={() =>
                  Alert.alert('مسح السجل', 'مسح كل سجل العمليات من التطبيق؟', [
                    { text: 'إلغاء', style: 'cancel' },
                    { text: 'مسح', style: 'destructive', onPress: props.onClear },
                  ])
                }
                accessibilityLabel="مسح"
              />
            </>
          ) : null}
        </View>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={styles.bar}>
            <TextInput
              style={styles.search}
              value={q}
              onChangeText={setQ}
              placeholder="بحث بالاسم أو المدرسة"
              placeholderTextColor={colors.muted}
            />
            <View style={[styles.row, { gap: 6 }]}>
              <Chip on={filter === 'all'} label={`الكل (${props.ops.length})`} color={colors.navy} onPress={() => setFilter('all')} />
              <Chip on={filter === 'ok'} label={`سُجّل (${okN})`} color={colors.green} onPress={() => setFilter('ok')} />
              <Chip on={filter === 'fail'} label={`لم يُسجَّل (${props.ops.length - okN})`} color={colors.red} onPress={() => setFilter('fail')} />
            </View>
          </View>
          <FlatList
            data={list}
            keyExtractor={(o, i) => `${o.t}-${i}`}
            contentContainerStyle={{ paddingBottom: 24 }}
            ListEmptyComponent={
              <T style={{ textAlign: 'center', color: colors.muted, padding: 28 }}>
                {props.ops.length ? 'لا نتائج' : 'لا توجد عمليات بعد. كل «إرسال إلى EMIS» يُسجَّل هنا.'}
              </T>
            }
            renderItem={({ item }) => (
              <View style={styles.item}>
                <Icon name={item.result === 'ok' ? 'check-circle' : 'close-circle'} size={22} color={item.result === 'ok' ? colors.green : colors.red} />
                <View style={{ flex: 1, gap: 1 }}>
                  <T bold style={{ fontSize: 13 }} numberOfLines={1}>
                    {item.name}
                  </T>
                  <T style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>
                    {[item.school, item.grade, item.section].filter(Boolean).join(' · ')}
                  </T>
                  {item.reason ? (
                    <T selectable style={{ fontSize: 11, color: item.result === 'ok' ? colors.muted : colors.red, lineHeight: 17 }}>
                      {item.reason}
                    </T>
                  ) : null}
                </View>
                <T style={{ fontSize: 10, color: colors.muted, textAlign: 'left' }}>{fmt(item.t).replace(' ', '\n')}</T>
              </View>
            )}
          />
          {props.ops.length ? (
            <View style={{ padding: 12 }}>
              <Button kind="soft" icon="microsoft-excel" label="تصدير إلى Excel" onPress={() => props.onExport(list.slice().reverse())} compact />
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Chip({ on, label, color, onPress }: { on: boolean; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && { backgroundColor: color, borderColor: color }]}>
      <T bold style={{ fontSize: 12, color: on ? '#fff' : colors.text, textAlign: 'center' }} numberOfLines={1}>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: ROW, alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10 },
  row: { flexDirection: ROW, alignItems: 'center' },
  bar: { padding: 12, gap: 8 },
  search: {
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
  chip: { flex: 1, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  item: {
    flexDirection: ROW,
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
});
