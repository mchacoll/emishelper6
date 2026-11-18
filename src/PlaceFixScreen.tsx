import { ActivityIndicator, FlatList, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, ROW, themed } from './theme';
import { Button, Icon, IconButton, T } from './ui';

export type PlaceChange = {
  emisId: number;
  name: string;
  fromPlace: string;
  fromCity: string;
  toPlace: string;
  toCity: string;
  placeId: number;
  city: string;
};
export type PlaceFixState = {
  visible: boolean;
  step: 'site' | 'scan' | 'review' | 'apply' | 'done' | 'error';
  school?: string;
  done?: number;
  total?: number;
  changes?: PlaceChange[];
  same?: number;
  emisTotal?: number;
  matched?: number;
  unresolved?: string[];
  ok?: number;
  failed?: { name: string; error: string }[];
  stopped?: boolean;
  error?: string;
};

/** تصحيح المكان والمدينة في EMIS حسب الاستمارة: معاينة ← تأكيد واحد ← تعديل طالباً طالباً */
export function PlaceFixScreen(props: { state: PlaceFixState; onClose: () => void; onApply: () => void; onStop: () => void; onRestart: () => void }) {
  const s = props.state;
  const busy = s.step === 'site' || s.step === 'scan' || s.step === 'apply';
  const changes = s.changes || [];
  const pct = s.total ? Math.round((100 * (s.done || 0)) / s.total) : 3;

  return (
    <Modal visible={s.visible} animationType="slide" onRequestClose={busy ? props.onStop : props.onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.header }} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <IconButton icon="close" onPress={props.onClose} accessibilityLabel="إغلاق" />
          <View style={{ flex: 1 }}>
            <T bold style={{ color: '#fff', fontSize: 17 }}>
              تصحيح المكان والمدينة في EMIS
            </T>
            <T style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>{s.school ? `${s.school} · حسب الاستمارة` : 'حسب الاستمارة'}</T>
          </View>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {busy || s.step === 'error' ? (
            <View style={styles.center}>
              {busy ? <ActivityIndicator size="large" color={colors.navy} /> : <Icon name="alert-circle" size={42} color={colors.red} />}
              <T bold style={{ textAlign: 'center', fontSize: 15, color: s.step === 'error' ? colors.red : colors.text }}>
                {s.step === 'error'
                  ? s.error
                  : s.step === 'site'
                    ? 'قراءة استمارات موقع الطلاب...'
                    : s.step === 'scan'
                      ? s.total
                        ? `مقارنة سجلات EMIS بالاستمارات... ${s.done} من ${s.total}`
                        : 'قراءة طلاب EMIS...'
                      : `جارٍ التصحيح... ${s.done} من ${s.total} (نجح ${s.ok || 0})`}
              </T>
              {busy && s.step !== 'site' ? (
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${pct}%` }]} />
                </View>
              ) : null}
              {busy && s.step !== 'site' ? <Button kind="danger" icon="stop" label="إيقاف" onPress={props.onStop} compact /> : null}
              {s.step === 'error' ? <Button kind="primary" icon="refresh" label="إعادة المحاولة" onPress={props.onRestart} /> : null}
              <T style={{ fontSize: 12, color: colors.muted, textAlign: 'center', lineHeight: 19 }}>
                افتح «إدارة الطلاب» للمدرسة في EMIS، وصفحة المنسق في موقع الطلاب.
              </T>
            </View>
          ) : s.step === 'review' ? (
            <>
              <View style={styles.summary}>
                <T style={{ fontSize: 12, color: colors.muted, lineHeight: 19 }}>
                  طلاب EMIS: {s.emisTotal} · طابقوا استماراتهم (الاسم الرباعي): {s.matched} · صحيح أصلاً: {s.same}
                  {s.stopped ? ' · أُوقف الفحص قبل النهاية' : ''}
                </T>
                {s.unresolved?.length ? (
                  <T style={{ fontSize: 12, color: colors.red }}>لم أجد هذه الأماكن في EMIS (لن تُعدَّل): {s.unresolved.join('، ')}</T>
                ) : null}
                <T bold style={{ fontSize: 15 }}>سيُعدَّل المكان/المدينة لـ {changes.length} طالب:</T>
              </View>
              <FlatList
                data={changes}
                keyExtractor={c => String(c.emisId)}
                contentContainerStyle={{ paddingBottom: 100 }}
                ListEmptyComponent={
                  <View style={[styles.center, { paddingTop: 30 }]}>
                    <Icon name="check-circle" size={40} color={colors.green} />
                    <T bold style={{ textAlign: 'center' }}>كل الطلاب المطابقين مكانهم ومدينتهم صحيحان حسب الاستمارة</T>
                  </View>
                }
                renderItem={({ item, index }) => (
                  <View style={styles.item}>
                    <T bold style={{ width: 26, fontSize: 12, color: colors.muted }}>
                      {index + 1}
                    </T>
                    <View style={{ flex: 1, gap: 2 }}>
                      <T bold style={{ fontSize: 13 }} numberOfLines={1}>
                        {item.name}
                      </T>
                      <T style={{ fontSize: 12, color: colors.red }}>
                        الآن: {item.fromPlace} · {item.fromCity}
                      </T>
                      <T style={{ fontSize: 12, color: colors.green }}>
                        يصبح: {item.toPlace} · {item.toCity}
                      </T>
                    </View>
                  </View>
                )}
              />
              {changes.length ? (
                <View style={styles.footer}>
                  <Button kind="gold" icon="map-marker-check" label={`تصحيح ${changes.length} طالب في EMIS`} onPress={props.onApply} />
                </View>
              ) : null}
            </>
          ) : s.step === 'done' ? (
            <View style={styles.center}>
              <Icon name={s.failed?.length ? 'alert-circle' : 'check-circle'} size={46} color={s.failed?.length ? colors.orange : colors.green} />
              <T bold style={{ fontSize: 16, textAlign: 'center' }}>
                صُحّح {s.ok} من {s.total}
                {s.stopped ? ' (أُوقف)' : ''}
              </T>
              {s.failed?.length ? (
                <View style={{ alignSelf: 'stretch', gap: 4 }}>
                  <T bold style={{ color: colors.red }}>لم يُصحَّح ({s.failed.length}):</T>
                  {s.failed.slice(0, 15).map((f, i) => (
                    <T key={i} style={{ fontSize: 12, color: colors.red }}>
                      • {f.name}: {f.error}
                    </T>
                  ))}
                </View>
              ) : null}
              <T style={{ fontSize: 12, color: colors.muted, textAlign: 'center' }}>حُفظ العنوان القديم لكل طالب في الهاتف (نسخة احتياطية)، وسُجّلت العملية في سجل العمليات.</T>
              <Button kind="primary" label="إغلاق" onPress={props.onClose} />
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    head: { flexDirection: ROW, alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26, gap: 14 },
    bar: { alignSelf: 'stretch', height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' },
    barFill: { height: 10, borderRadius: 5, backgroundColor: colors.gold },
    summary: { padding: 12, gap: 6 },
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
    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border, borderRadius: radius.sm },
  }),
);
