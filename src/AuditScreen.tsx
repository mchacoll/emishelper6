import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, ROW } from './theme';
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

export function AuditScreen(props: { state: AuditState; onClose: () => void; onStop: () => void; onRestart: () => void; onExport: (rows: AuditRow[]) => void }) {
  const s = props.state;
  const site = s.source === 'site';
  const [filter, setFilter] = useState<Filter>('all');
  const all = s.rows || [];
  const phoneN = all.filter(r => r.badPhone).length;
  const cardN = all.filter(r => r.badCard).length;
  const list = useMemo(() => (filter === 'phone' ? all.filter(r => r.badPhone) : filter === 'card' ? all.filter(r => r.badCard) : all), [all, filter]);

  return (
    <Modal visible={s.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.navy }} edges={['top', 'bottom']}>
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
                  <View style={styles.item}>
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
});
