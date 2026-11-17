import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, ROW } from './theme';
import { Button, Icon, T } from './ui';

export type PreviewRow = [label: string, form: string, emis: string];
export type Preview = { name: string; rows: PreviewRow[]; warn: string[] };

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
export function PreviewModal(props: { preview: Preview | null; onCancel: () => void; onSend: () => void }) {
  const p = props.preview;
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

              <View style={[styles.row, { paddingTop: 10 }]}>
                <Button kind="soft" label="إلغاء" onPress={props.onCancel} style={{ flex: 1 }} />
                <Button kind="primary" icon="send" label="إرسال إلى EMIS" onPress={props.onSend} style={{ flex: 2 }} />
              </View>
            </>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 14 },
  head: { flexDirection: ROW, alignItems: 'center', gap: 10, paddingBottom: 10 },
  row: { flexDirection: ROW, alignItems: 'center', gap: 8 },
  tr: { flexDirection: ROW, gap: 6, paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  th: { backgroundColor: colors.bg, borderRadius: radius.sm },
  thT: { fontSize: 11, color: colors.muted },
  c0: { flex: 1.1, fontSize: 12 },
  c1: { flex: 1.4, fontSize: 12 },
  c2: { flex: 1.4, fontSize: 12 },
});
