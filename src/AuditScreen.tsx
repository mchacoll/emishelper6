import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, radius, ROW, themed } from './theme';
import { Button, Icon, IconButton, T } from './ui';

/** طالب في الكشف: هاتف أقل من 11 رقماً و/أو بطاقة موحدة أقل من 12 رقماً (من EMIS) */
export type AuditRow = {
  id: number;
  name: string;
  stage: string;
  room: string;
  phone: string;
  phoneLen: number;
  badPhone: boolean;
  idNumber: string;
  idLen: number;
  badCard: boolean;
};
export type AuditState = {
  visible: boolean;
  running: boolean;
  source: 'site' | 'emis';
  done: number;
  total: number;
  rows?: AuditRow[];
  failed?: number;
  stopped?: boolean;
  error?: string;
};

type Filter = 'all' | 'phone' | 'card';

export const auditToRows = (rows: AuditRow[]) => ({
  headers: ['الاسم', 'الصف', 'الشعبة', 'رقم الهاتف', 'أرقام الهاتف', 'رقم البطاقة الموحدة', 'أرقام البطاقة', 'المشكلة'],
  rows: rows.map(r => [
    r.name,
    r.stage,
    r.room,
    r.phone,
    String(r.phoneLen),
    r.idNumber,
    r.badCard || r.idNumber ? String(r.idLen) : '',
    [r.badPhone ? (r.phoneLen ? 'الهاتف أقل من 11 رقماً' : 'لا يوجد هاتف') : '', r.badCard ? (r.idLen ? 'البطاقة أقل من 12 رقماً' : 'البطاقة فارغة') : '']
      .filter(Boolean)
      .join('، '),
  ]),
});

const digits = (v: string) => v.replace(/[\u0660-\u0669]/g, x => String(x.charCodeAt(0) - 0x660)).replace(/[\u06F0-\u06F9]/g, x => String(x.charCodeAt(0) - 0x6f0)).replace(/\D/g, '');

export function AuditScreen(props: {
  state: AuditState;
  onClose: () => void;
  onStop: () => void;
  onRestart: () => void;
  onExport: (rows: AuditRow[]) => void;
  fixing: number | null; // رقم الطالب الجاري تصحيحه
  onFix: (row: AuditRow, phone: string, card: string) => void;
}) {
  const s = props.state;
  const [edit, setEdit] = useState<AuditRow | null>(null);
  const [ph, setPh] = useState('');
  const [cd, setCd] = useState('');
  const openFix = (r: AuditRow) => {
    setEdit(r);
    setPh('');
    setCd('');
  };
  const submitFix = () => {
    if (!edit) return;
    const p = digits(ph);
    const c = digits(cd);
    if (!p && !c) return void Alert.alert('تصحيح', 'اكتب الرقم الصحيح أولاً');
    if (p && !/^07\d{9}$/.test(p)) return void Alert.alert('رقم الهاتف', 'يجب أن يكون 11 رقماً ويبدأ بـ 07');
    if (c && c.length !== 12) return void Alert.alert('البطاقة الموحدة', 'يجب أن تكون 12 رقماً');
    const where = s.source === 'site' ? 'موقع الطلاب' : 'EMIS الحقيقي';
    Alert.alert(
      'تأكيد التصحيح',
      `${edit.name}\n\nسيُعدَّل في ${where}:` +
        (p ? `\n• الهاتف: ${edit.phone || '—'} ← ${p}` : '') +
        (c ? `\n• البطاقة الموحدة: ${edit.idNumber || '—'} ← ${c}` : ''),
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'تصحيح',
          onPress: () => {
            props.onFix(edit, p, c);
            setEdit(null);
          },
        },
      ],
    );
  };
  const site = s.source === 'site';
  const [filter, setFilter] = useState<Filter>('all');
  const all = s.rows || [];
  const phoneN = all.filter(r => r.badPhone).length;
  const cardN = all.filter(r => r.badCard).length;
  const list = useMemo(() => (filter === 'phone' ? all.filter(r => r.badPhone) : filter === 'card' ? all.filter(r => r.badCard) : all), [all, filter]);

  return (
    <Modal visible={s.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.header }} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <IconButton icon="close" onPress={props.onClose} accessibilityLabel="إغلاق" />
          <View style={{ flex: 1 }}>
            <T bold style={{ color: '#fff', fontSize: 17 }}>
              كشف الهاتف والبطاقة الموحدة
            </T>
            <T style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>{site ? 'موقع الطلاب' : 'EMIS'}</T>
          </View>
          {!s.running && s.rows ? <IconButton icon="refresh" onPress={props.onRestart} accessibilityLabel="فحص من جديد" /> : null}
        </View>

        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {s.running || s.error ? (
            <View style={styles.center}>
              {s.running ? <ActivityIndicator size="large" color={colors.navy} /> : <Icon name="alert-circle" size={42} color={colors.red} />}
              <T bold style={{ fontSize: 15, textAlign: 'center', color: s.error ? colors.red : colors.text }}>
                {s.error || (site ? 'قراءة استمارات موقع الطلاب...' : s.total ? `فحص سجلات الطلاب في EMIS... ${s.done} من ${s.total}` : 'قراءة قائمة الطلاب من EMIS...')}
              </T>
              {s.running ? (
                <>
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${s.total ? Math.round((100 * s.done) / s.total) : 3}%` }]} />
                  </View>
                  {!site ? <Button kind="danger" icon="stop" label="إيقاف" onPress={props.onStop} compact /> : null}
                </>
              ) : (
                <Button kind="primary" icon="refresh" label="إعادة المحاولة" onPress={props.onRestart} />
              )}
              <T style={{ fontSize: 12, color: colors.muted, textAlign: 'center', lineHeight: 19 }}>
                {site
                  ? 'يقرأ استمارات موقع الطلاب (قراءة فقط، لا يُعدَّل شيء). يجب أن تكون صفحة المنسق مفتوحة في موقع الطلاب.'
                  : 'يقرأ سجل كل طالب من EMIS (قراءة فقط، لا يُعدَّل شيء). يجب أن تكون «إدارة الطلاب» مفتوحة في EMIS.'}
              </T>
            </View>
          ) : s.rows ? (
            <>
              <View style={styles.summary}>
                <T style={{ fontSize: 12, color: colors.muted }}>
                  {site ? 'موقع الطلاب: ' : 'EMIS: '}فُحص {s.done} من {s.total} طالب{s.failed ? ` · تعذّرت قراءة ${s.failed}` : ''}
                  {s.stopped ? ' · أُوقف قبل النهاية' : ''}
                </T>
                <View style={[styles.row, { gap: 6 }]}>
                  <Chip on={filter === 'all'} label={`الكل (${all.length})`} color={colors.navy} onPress={() => setFilter('all')} />
                  <Chip on={filter === 'phone'} label={`الهاتف (${phoneN})`} color={colors.orange} onPress={() => setFilter('phone')} />
                  <Chip on={filter === 'card'} label={`البطاقة (${cardN})`} color={colors.red} onPress={() => setFilter('card')} />
                </View>
              </View>
              <FlatList
                data={list}
                keyExtractor={r => String(r.id)}
                contentContainerStyle={{ paddingBottom: 90 }}
                ListEmptyComponent={
                  <View style={[styles.center, { paddingTop: 40 }]}>
                    <Icon name="check-circle" size={40} color={colors.green} />
                    <T bold style={{ fontSize: 14, textAlign: 'center' }}>
                      {all.length ? 'لا يوجد في هذا القسم' : 'كل الهواتف 11 رقماً أو أكثر، وكل البطاقات الموحدة 12 رقماً أو أكثر'}
                    </T>
                  </View>
                }
                renderItem={({ item, index }) => (
                  <View style={[styles.item, { alignItems: 'center' }]}>
                    <T bold style={{ width: 26, color: colors.muted, fontSize: 12 }}>
                      {index + 1}
                    </T>
                    <View style={{ flex: 1, gap: 2 }}>
                      <T bold selectable style={{ fontSize: 13 }} numberOfLines={1}>
                        {item.name}
                      </T>
                      <T style={{ fontSize: 11, color: colors.muted }}>{[item.stage, item.room].filter(Boolean).join(' · ')}</T>
                      <T selectable style={{ fontSize: 12, color: item.badPhone ? colors.orange : colors.muted }}>
                        الهاتف: {item.phone || '— فارغ'} {item.badPhone ? `(${item.phoneLen} أرقام)` : ''}
                      </T>
                      {item.badCard || item.idNumber ? (
                        <T selectable style={{ fontSize: 12, color: item.badCard ? colors.red : colors.muted }}>
                          البطاقة الموحدة: {item.idNumber || '— فارغة'} {item.badCard ? `(${item.idLen} أرقام)` : ''}
                        </T>
                      ) : null}
                    </View>
                    {item.badPhone || item.badCard ? (
                      props.fixing === item.id ? (
                        <ActivityIndicator color={colors.navy} />
                      ) : (
                        <Pressable onPress={() => openFix(item)} style={styles.fixBtn} disabled={props.fixing !== null}>
                          <T bold style={{ fontSize: 12, color: colors.navy }}>
                            تصحيح
                          </T>
                        </Pressable>
                      )
                    ) : (
                      <Icon name="check-circle" size={22} color={colors.green} />
                    )}
                  </View>
                )}
              />
              {all.length ? (
                <View style={styles.footer}>
                  <Button kind="gold" icon="microsoft-excel" label={`تصدير إلى Excel (${list.length})`} onPress={() => props.onExport(list)} />
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </SafeAreaView>

      {/* نافذة التصحيح */}
      <Modal visible={!!edit} transparent animationType="fade" onRequestClose={() => setEdit(null)}>
        <View style={styles.backdrop}>
          {edit ? (
            <View style={styles.sheet}>
              <T bold style={{ fontSize: 16 }}>تصحيح — {s.source === 'site' ? 'موقع الطلاب' : 'EMIS'}</T>
              <T style={{ fontSize: 13 }} numberOfLines={2}>
                {edit.name}
              </T>
              {edit.badPhone ? (
                <View style={{ gap: 4 }}>
                  <T style={{ fontSize: 12, color: colors.muted }}>الهاتف الحالي: {edit.phone || '— فارغ'}</T>
                  <TextInput style={styles.input} value={ph} onChangeText={setPh} placeholder="07XXXXXXXXX" placeholderTextColor={colors.muted} keyboardType="number-pad" maxLength={14} />
                </View>
              ) : null}
              {edit.badCard ? (
                <View style={{ gap: 4 }}>
                  <T style={{ fontSize: 12, color: colors.muted }}>البطاقة الموحدة الحالية: {edit.idNumber || '— فارغة'}</T>
                  <TextInput style={styles.input} value={cd} onChangeText={setCd} placeholder="12 رقماً" placeholderTextColor={colors.muted} keyboardType="number-pad" maxLength={16} />
                </View>
              ) : null}
              <View style={[styles.row, { gap: 8 }]}>
                <Button kind="soft" label="إلغاء" onPress={() => setEdit(null)} style={{ flex: 1 }} />
                <Button kind="primary" icon="content-save" label="تصحيح" onPress={submitFix} style={{ flex: 2 }} />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
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

const styles = themed(() =>
  StyleSheet.create({
  head: { flexDirection: ROW, alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  row: { flexDirection: ROW, alignItems: 'center' },
  bar: { alignSelf: 'stretch', height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5, backgroundColor: colors.gold },
  summary: { padding: 12, gap: 8 },
  chip: { flex: 1, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  item: {
    flexDirection: ROW,
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: colors.bg },
  fixBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.navy, backgroundColor: colors.card },
  backdrop: { flex: 1, backgroundColor: 'rgba(10,44,66,0.55)', justifyContent: 'center', padding: 22 },
  sheet: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 18, gap: 12 },
  input: {
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 16,
    color: colors.text,
    textAlign: 'right',
    fontFamily: fonts.regular,
  },
  }),
);
