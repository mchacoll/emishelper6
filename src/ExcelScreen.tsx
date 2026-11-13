import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, ROW } from './theme';
import { Button, Icon, T } from './ui';

export type RowStatus = { ok: number; miss: string[]; fail: string[]; t: number };
export type ExcelData = {
  fileName: string;
  sheet: string;
  headers: string[];
  rows: string[][];
  status: Record<number, RowStatus>;
  selected: number;
  studentRows: number; // صفوف فُهمت كطلاب (للإضافة إلى قائمة التسجيل)
};

/** شاشة Excel: رفع ملف، اختيار صف، وتعبئة النموذج المفتوح في EMIS */
export function ExcelScreen(props: {
  data: ExcelData | null;
  busy: boolean;
  onPick: () => void;
  onSelect: (i: number) => void;
  onFill: (i: number) => void;
  onAddStudents: () => void;
  onClear: () => void;
}) {
  const d = props.data;

  if (!d) {
    return (
      <View style={[styles.fill, styles.empty]}>
        <View style={styles.bigIcon}>
          <Icon name="file-excel" size={46} color={colors.green} />
        </View>
        <T bold style={{ fontSize: 20, textAlign: 'center' }}>
          تعبئة EMIS من ملف Excel
        </T>
        <T style={{ fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 22 }}>
          اجعل عنوان كل عمود باسم الحقل كما يظهر في EMIS (مثل «الاسم»، «اسم الأب»، «تاريخ التولد»، «الجنس»...).{'\n'}
          كل صف = نموذج واحد. يعمل مع أي نموذج في EMIS: طلاب، موظفون، معلمون...
        </T>
        <Button kind="gold" icon="upload" label="رفع ملف Excel" onPress={props.onPick} style={{ alignSelf: 'stretch' }} />
        <T style={{ fontSize: 11, color: colors.muted, textAlign: 'center' }}>xlsx · xls · csv</T>
      </View>
    );
  }

  const sel = d.selected;
  const row = d.rows[sel] || [];
  const st = d.status[sel];
  const filledCols = d.headers.map((h, i) => ({ h, v: row[i] || '' })).filter(x => x.h && x.v);
  const done = Object.keys(d.status).length;
  // عمود العرض في القائمة: أول عمودين فيهما قيم
  const preview = (r: string[]) =>
    d.headers
      .map((h, i) => r[i])
      .filter(Boolean)
      .slice(0, 3)
      .join(' · ');

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      {/* الملف */}
      <View style={styles.fileBar}>
        <Icon name="file-excel" size={22} color={colors.green} />
        <View style={{ flex: 1 }}>
          <T bold style={{ fontSize: 14 }} numberOfLines={1}>
            {d.fileName}
          </T>
          <T style={{ fontSize: 11, color: colors.muted }}>
            {d.rows.length} صف · {d.headers.filter(Boolean).length} عمود · عُبّئ {done}
          </T>
        </View>
        <Button kind="ghost" icon="swap-horizontal" label="ملف آخر" onPress={props.onPick} compact />
        <Pressable onPress={props.onClear} hitSlop={8}>
          <Icon name="close" size={22} color={colors.muted} />
        </Pressable>
      </View>

      {/* الصفوف */}
      <FlatList
        data={d.rows}
        keyExtractor={(_, i) => String(i)}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 300 }}
        initialScrollIndex={sel > 3 ? sel - 2 : undefined}
        getItemLayout={(_, i) => ({ length: 54, offset: 54 * i, index: i })}
        renderItem={({ item, index }) => {
          const s = d.status[index];
          const on = index === sel;
          return (
            <Pressable onPress={() => props.onSelect(index)} style={[styles.row, on && styles.rowOn]}>
              <T bold style={{ width: 30, color: on ? colors.navy : colors.muted, fontSize: 12 }}>
                {index + 1}
              </T>
              <T style={{ flex: 1, fontSize: 13 }} numberOfLines={1}>
                {preview(item)}
              </T>
              {s ? (
                <Icon name={s.fail.length ? 'alert-circle' : 'check-circle'} size={18} color={s.fail.length ? colors.orange : colors.green} />
              ) : null}
            </Pressable>
          );
        }}
      />

      {/* الصف المختار */}
      <View style={styles.sheet}>
        <View style={[styles.flexRow, { justifyContent: 'space-between' }]}>
          <T bold style={{ fontSize: 15 }}>
            الصف {sel + 1} من {d.rows.length}
          </T>
          {d.studentRows ? (
            <Button kind="ghost" icon="account-multiple-plus" label={`إضافة كطلاب (${d.studentRows})`} onPress={props.onAddStudents} compact />
          ) : null}
        </View>
        <View style={styles.chips}>
          {filledCols.slice(0, 12).map(x => (
            <View key={x.h} style={styles.chip}>
              <T style={{ fontSize: 11, color: colors.muted }}>{x.h}</T>
              <T bold style={{ fontSize: 12 }} numberOfLines={1}>
                {x.v}
              </T>
            </View>
          ))}
          {filledCols.length > 12 ? <T style={{ fontSize: 11, color: colors.muted }}>+{filledCols.length - 12}</T> : null}
        </View>
        {st ? (
          <T style={{ fontSize: 11, color: st.fail.length ? colors.orange : colors.green, lineHeight: 17 }} numberOfLines={3}>
            ✔ عُبّئ {st.ok}
            {st.fail.length ? ` · ✖ لم يُختر: ${st.fail.join('، ')}` : ''}
            {st.miss.length ? ` · ليس في الصفحة: ${st.miss.join('، ')}` : ''}
          </T>
        ) : null}
        <View style={styles.flexRow}>
          <Button kind="soft" icon="chevron-right" onPress={() => props.onSelect(Math.max(0, sel - 1))} compact style={{ flex: 0.6 }} disabled={sel <= 0} />
          <Button
            kind="gold"
            icon="form-select"
            label="تعبئة في EMIS"
            onPress={() => props.onFill(sel)}
            compact
            busy={props.busy}
            style={{ flex: 2 }}
          />
          <Button
            kind="soft"
            icon="chevron-left"
            onPress={() => props.onSelect(Math.min(d.rows.length - 1, sel + 1))}
            compact
            style={{ flex: 0.6 }}
            disabled={sel >= d.rows.length - 1}
          />
        </View>
        <T style={{ fontSize: 11, color: colors.muted, textAlign: 'center' }}>
          افتح النموذج في EMIS أولاً، ثم «تعبئة». لا يُحفظ شيء تلقائياً — راجع واحفظ بنفسك.
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14, backgroundColor: colors.bg },
  bigIcon: { width: 86, height: 86, borderRadius: 43, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  fileBar: {
    flexDirection: ROW,
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  row: {
    flexDirection: ROW,
    alignItems: 'center',
    gap: 8,
    height: 54,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  rowOn: { backgroundColor: colors.goldSoft },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderColor: colors.border,
    elevation: 8,
  },
  flexRow: { flexDirection: ROW, alignItems: 'center', gap: 6 },
  chips: { flexDirection: ROW, flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: colors.bg, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4, maxWidth: '48%' },
});
