import { ActivityIndicator, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, ROW } from './theme';
import { Button, Icon, IconButton, T } from './ui';

/** مجموعة: صف + شعبة، ذكور/إناث/غير محدد */
export type StatGroup = { key: string; grade: string; room: string; m: number; f: number; u: number };
export type StatSide = { running: boolean; done?: number; total?: number; groups?: StatGroup[]; error?: string; stopped?: boolean };
export type StatsState = { visible: boolean; site: StatSide; emis: StatSide; school?: string };

export type StatRow = { key: string; grade: string; room: string; site?: StatGroup; emis?: StatGroup };

const ord = (k: string) => {
  const m = k.match(/^(\d+)(\D*)\|/);
  return m ? (m[2] ? 100 : 0) + Number(m[1]) : 999;
};

/** دمج الجانبين حسب الصف والشعبة */
export function mergeStats(s: StatsState): StatRow[] {
  const map = new Map<string, StatRow>();
  for (const [side, list] of [['site', s.site.groups], ['emis', s.emis.groups]] as const) {
    for (const g of list || []) {
      const r = map.get(g.key) || { key: g.key, grade: g.grade, room: g.room };
      if (side === 'site') {
        r.site = g;
        r.grade = g.grade || r.grade;
        r.room = g.room || r.room;
      } else {
        r.emis = g;
        if (!r.site) {
          r.grade = g.grade;
          r.room = g.room;
        }
      }
      map.set(g.key, r);
    }
  }
  return [...map.values()].sort((a, b) => ord(a.key) - ord(b.key) || a.room.localeCompare(b.room, 'ar'));
}
const tot = (g?: StatGroup) => (g ? g.m + g.f + g.u : 0);

export const statsToRows = (rows: StatRow[]) => {
  const sum = (f: (r: StatRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const line = (r: StatRow) => [
    r.grade,
    r.room || 'بدون شعبة',
    String(r.site?.m || 0),
    String(r.site?.f || 0),
    String(tot(r.site)),
    String(r.emis?.m || 0),
    String(r.emis?.f || 0),
    String(tot(r.emis)),
    String(tot(r.site) - tot(r.emis)),
  ];
  return {
    headers: ['الصف', 'الشعبة', 'الموقع: ذكور', 'الموقع: إناث', 'الموقع: المجموع', 'EMIS: ذكور', 'EMIS: إناث', 'EMIS: المجموع', 'الفرق (الموقع − EMIS)'],
    rows: [
      ...rows.map(line),
      [
        'المجموع',
        '',
        String(sum(r => r.site?.m || 0)),
        String(sum(r => r.site?.f || 0)),
        String(sum(r => tot(r.site))),
        String(sum(r => r.emis?.m || 0)),
        String(sum(r => r.emis?.f || 0)),
        String(sum(r => tot(r.emis))),
        String(sum(r => tot(r.site) - tot(r.emis))),
      ],
    ],
  };
};

export function StatsScreen(props: { state: StatsState; onClose: () => void; onRefresh: () => void; onExport: (rows: StatRow[]) => void }) {
  const s = props.state;
  const rows = mergeStats(s);
  const busy = s.site.running || s.emis.running;
  const sum = (f: (r: StatRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const side = (label: string, x: StatSide) =>
    x.error ? (
      <T style={{ fontSize: 12, color: colors.red }}>
        {label}: {x.error}
      </T>
    ) : x.running ? (
      <View style={[styles.row, { gap: 6 }]}>
        <ActivityIndicator size="small" color={colors.navy} />
        <T style={{ fontSize: 12, color: colors.muted }}>
          {label}: {x.total ? `${x.done} من ${x.total}` : 'جارٍ القراءة...'}
        </T>
      </View>
    ) : null;

  return (
    <Modal visible={s.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.navy }} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <IconButton icon="close" onPress={props.onClose} accessibilityLabel="إغلاق" />
          <View style={{ flex: 1 }}>
            <T bold style={{ color: '#fff', fontSize: 17 }}>
              إحصاء المدرسة
            </T>
            {s.school ? <T style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>{s.school}</T> : null}
          </View>
          {!busy ? <IconButton icon="refresh" onPress={props.onRefresh} accessibilityLabel="تحديث" /> : null}
        </View>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={{ padding: 12, gap: 6 }}>
            {side('موقع الطلاب', s.site)}
            {side('EMIS', s.emis)}
            <View style={styles.cards}>
              <Card label="موقع الطلاب" total={sum(r => tot(r.site))} m={sum(r => r.site?.m || 0)} f={sum(r => r.site?.f || 0)} color={colors.blue} />
              <Card label="EMIS" total={sum(r => tot(r.emis))} m={sum(r => r.emis?.m || 0)} f={sum(r => r.emis?.f || 0)} color={colors.green} />
            </View>
          </View>
          <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
            <View style={{ flex: 1, minWidth: '100%' }}>
              <View style={[styles.tr, styles.th]}>
                <T bold style={[styles.cG, styles.thT]}>الصف</T>
                <T bold style={[styles.cR, styles.thT]}>الشعبة</T>
                <T bold style={[styles.cN, styles.thT]}>الموقع{'\n'}ذ / إ / م</T>
                <T bold style={[styles.cN, styles.thT]}>EMIS{'\n'}ذ / إ / م</T>
                <T bold style={[styles.cD, styles.thT]}>الفرق</T>
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 90 }}>
                {rows.map(r => {
                  const d = tot(r.site) - tot(r.emis);
                  return (
                    <View key={r.key} style={[styles.tr, d !== 0 && !busy && { backgroundColor: colors.orangeSoft }]}>
                      <T style={styles.cG}>{r.grade}</T>
                      <T style={styles.cR}>{r.room || '—'}</T>
                      <T style={styles.cN}>{r.site ? `${r.site.m} / ${r.site.f} / ${tot(r.site)}` : '—'}</T>
                      <T style={styles.cN}>{r.emis ? `${r.emis.m} / ${r.emis.f} / ${tot(r.emis)}` : '—'}</T>
                      <T bold style={[styles.cD, { color: d === 0 ? colors.green : colors.orange }]}>{d === 0 ? '✓' : d > 0 ? `+${d}` : String(d)}</T>
                    </View>
                  );
                })}
                {!rows.length && !busy ? (
                  <View style={{ alignItems: 'center', padding: 30, gap: 8 }}>
                    <Icon name="table-off" size={36} color={colors.muted} />
                    <T style={{ color: colors.muted, textAlign: 'center' }}>لا بيانات — افتح صفحة المنسق و«إدارة الطلاب» في EMIS ثم «تحديث»</T>
                  </View>
                ) : null}
                <T style={{ fontSize: 11, color: colors.muted, padding: 12, lineHeight: 18 }}>
                  ذ = ذكور، إ = إناث، م = المجموع. الفرق = الموقع − EMIS: موجب يعني طلاباً في الموقع لم يُسجَّلوا في EMIS بعد، وسالب يعني طلاباً في EMIS غير موجودين في الموقع
                  (أو اختلاف في الصف/الشعبة).
                </T>
              </ScrollView>
            </View>
          </ScrollView>
          {rows.length && !busy ? (
            <View style={styles.footer}>
              <Button kind="gold" icon="microsoft-excel" label="تصدير إلى Excel" onPress={() => props.onExport(rows)} />
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Card({ label, total, m, f, color }: { label: string; total: number; m: number; f: number; color: string }) {
  return (
    <View style={styles.card}>
      <T style={{ fontSize: 12, color: colors.muted }}>{label}</T>
      <T bold style={{ fontSize: 22, color }}>{total}</T>
      <T style={{ fontSize: 11, color: colors.muted }}>
        ذكور {m} · إناث {f}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: ROW, alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10 },
  row: { flexDirection: ROW, alignItems: 'center' },
  cards: { flexDirection: ROW, gap: 8 },
  card: { flex: 1, alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 8 },
  tr: { flexDirection: ROW, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card },
  th: { backgroundColor: colors.bg },
  thT: { fontSize: 11, color: colors.muted },
  cG: { flex: 1.4, fontSize: 12 },
  cR: { flex: 0.8, fontSize: 12, textAlign: 'center' },
  cN: { flex: 1.4, fontSize: 12, textAlign: 'center' },
  cD: { flex: 0.8, fontSize: 12, textAlign: 'center' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: colors.bg },
});
