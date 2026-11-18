import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, radius, ROW, themed } from './theme';
import { Button, Icon, T } from './ui';

export type PreviewRow = [label: string, form: string, emis: string];
/** age: حقل «سبب استثناء العمر» — required عندما رفض EMIS بسبب العمر */
export type Preview = { name: string; rows: PreviewRow[]; warn: string[]; age?: { required: boolean; note?: string; value?: string } };
const AGE_REASONS = ['رسوب', 'تأخر في التسجيل', 'عائد من خارج العراق', 'انتقال من مدرسة أخرى', 'ظرف صحي'];

// مقارنة مرنة: الهمزات والتاء المربوطة و«ال» والمسافات لا تُعد اختلافاً
const n = (s: string) =>
  String(s || '')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/(^|\s)ال/g, '$1')
    .replace(/[\s\-/،,.]+/g, '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .toLowerCase();
const same = (a: string, b: string) => {
  const x = n(a);
  const y = n(b);
  return x === y || (!!x && !!y && (x.includes(y) || y.includes(x)));
};

/** معاينة قبل الإرسال: ما في الاستمارة بجانب ما سيُكتب في EMIS */
export function PreviewModal(props: { preview: Preview | null; onCancel: () => void; onSend: (ageReason: string) => void }) {
  const p = props.preview;
  const [reason, setReason] = useState('');
  useEffect(() => setReason(p?.age?.value || ''), [p]);
  const needReason = !!p?.age?.required && !reason.trim();
  const changed = p ? p.rows.filter(r => r[1] && !same(r[1], r[2])).length : 0;
  return (
    <Modal visible={!!p} animationType="slide" transparent onRequestClose={props.onCancel}>
      <View style={styles.backdrop}>
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          {p ? (
            <>
              <View style={styles.head}>
                <Icon name="file-eye-outline" size={22} color={colors.navy} />
                <View style={{ flex: 1 }}>
                  <T bold style={{ fontSize: 16 }}>
                    معاينة قبل الإرسال
                  </T>
                  <T style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
                    {p.name}
                  </T>
                </View>
              </View>

              <View style={[styles.tr, styles.th]}>
                <T bold style={[styles.c0, styles.thT]}>الحقل</T>
                <T bold style={[styles.c1, styles.thT]}>في الاستمارة</T>
                <T bold style={[styles.c2, styles.thT]}>سيُكتب في EMIS</T>
              </View>
              <ScrollView style={{ flexGrow: 0, maxHeight: 420 }}>
                {p.rows.map(([label, form, emis]) => {
                  const diff = !!form && !same(form, emis);
                  const auto = !form && !!emis;
                  return (
                    <View key={label} style={[styles.tr, diff && { backgroundColor: colors.orangeSoft }]}>
                      <T style={[styles.c0, { color: colors.muted }]}>{label}</T>
                      <T style={styles.c1}>{form || '—'}</T>
                      <T bold style={[styles.c2, { color: diff ? colors.orange : auto ? colors.blue : emis ? colors.text : colors.muted }]}>
                        {emis || '— فارغ'}
                      </T>
                    </View>
                  );
                })}
              </ScrollView>

              <View style={{ gap: 4, paddingTop: 8 }}>
                {changed ? (
                  <T style={{ fontSize: 11, color: colors.orange }}>● البرتقالي: القيمة في EMIS تختلف عمّا في الاستمارة ({changed}) — تأكد منها</T>
                ) : null}
                <T style={{ fontSize: 11, color: colors.blue }}>● الأزرق: ليس في الاستمارة، من إعدادات المدرسة أو الافتراضي</T>
                {p.warn.map(w => (
                  <T key={w} style={{ fontSize: 12, color: colors.red }}>
                    ⚠ {w}
                  </T>
                ))}
              </View>

              {p.age ? (
                <View style={styles.ageBox}>
                  <T bold style={{ fontSize: 13, color: p.age.required ? colors.red : colors.text }}>
                    سبب استثناء العمر{p.age.required ? ' (يطلبه EMIS)' : ' (اختياري)'}
                  </T>
                  {p.age.note ? <T style={{ fontSize: 11, color: colors.red }}>{p.age.note}</T> : null}
                  <TextInput
                    style={styles.input}
                    value={reason}
                    onChangeText={setReason}
                    placeholder="اكتب السبب كما سيظهر في EMIS"
                    placeholderTextColor={colors.muted}
                    maxLength={200}
                  />
                  <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>
                    {AGE_REASONS.map(r => (
                      <Pressable key={r} onPress={() => setReason(r)} style={styles.chip}>
                        <T style={{ fontSize: 11, color: colors.navy }}>{r}</T>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={[styles.row, { paddingTop: 10 }]}>
                <Button kind="soft" label="إلغاء" onPress={props.onCancel} style={{ flex: 1 }} />
                <Button kind="primary" icon="send" label="إرسال إلى EMIS" onPress={() => props.onSend(reason.trim())} style={{ flex: 2 }} disabled={needReason} />
              </View>
            </>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = themed(() =>
  StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 14 },
  head: { flexDirection: ROW, alignItems: 'center', gap: 10, paddingBottom: 10 },
  row: { flexDirection: ROW, alignItems: 'center', gap: 8 },
  tr: { flexDirection: ROW, gap: 6, paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  th: { backgroundColor: colors.bg, borderRadius: radius.sm },
  thT: { fontSize: 11, color: colors.muted },
  ageBox: { gap: 6, marginTop: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
    color: colors.text,
    textAlign: 'right',
    fontFamily: fonts.regular,
  },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  c0: { flex: 1.1, fontSize: 12 },
  c1: { flex: 1.4, fontSize: 12 },
  c2: { flex: 1.4, fontSize: 12 },
  }),
);
