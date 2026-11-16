import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { normalizedSchools, normUrl, type SchoolRule, type Settings } from './settings';
import { colors, fonts, radius, ROW } from './theme';
import { Button, Card, Icon, IconButton, SectionTitle, SettingRow, T } from './ui';

export type LogLine = { t: number; pane: 'site' | 'emis'; level: string; msg: string };

export function SettingsScreen(props: {
  visible: boolean;
  settings: Settings;
  errors: LogLine[];
  onClose: () => void;
  onSave: (s: Settings) => void;
  onClearData: () => void;
  onClearErrors: () => void;
  onCopyLogs: () => void;
  onShareLogs: () => void;
  onShowGuide: () => void;
  onDiagnose: () => void;
  onCompare: () => void;
  onShowOps: () => void;
  opsCount: number;
  onCheckUpdate: () => void;
  versionText: string;
}) {
  const [d, setD] = useState(props.settings);
  useEffect(() => {
    if (props.visible) setD(props.settings);
  }, [props.visible, props.settings]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setD(prev => ({ ...prev, [k]: v }));

  const save = () => props.onSave({ ...d, siteUrl: normUrl(d.siteUrl), emisUrl: normUrl(d.emisUrl), schools: normalizedSchools(d.schools) });
  const schools = normalizedSchools(d.schools);
  const [editing, setEditing] = useState<{ index: number; rule: SchoolRule } | null>(null);
  const putRule = (index: number, rule: SchoolRule | null) => {
    const next = schools.slice();
    if (rule === null) next.splice(index, 1);
    else if (index < 0) next.unshift(rule);
    else next[index] = rule;
    set('schools', normalizedSchools(next));
    setEditing(null);
  };

  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.navy }} edges={['top']}>
        <View style={styles.head}>
          <IconButton icon="close" onPress={props.onClose} accessibilityLabel="إغلاق" />
          <T bold style={{ color: '#fff', fontSize: 18, flex: 1 }}>
            الإعدادات
          </T>
        </View>
        <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
          <SectionTitle>طريقة العمل</SectionTitle>
          <Card>
            <SettingRow
              icon="swap-horizontal"
              title="التنقل التلقائي بين الشاشتين"
              subtitle="عرض EMIS تلقائياً أثناء التعبئة من Excel."
              value={d.autoSwitch}
              onChange={v => set('autoSwitch', v)}
              last
            />
          </Card>

          <SectionTitle>العرض</SectionTitle>
          <Card>
            <SettingRow
              icon="form-dropdown"
              title="قوائم EMIS كالكمبيوتر (موصى به)"
              subtitle="يعرّف التطبيقُ نفسه لـ EMIS كمتصفح كمبيوتر، فتفتح القوائم المنسدلة تحت الحقل بدل نافذة تغطي الشاشة، فيستطيع المساعد الضغط على الخيار."
              value={d.desktopUA}
              onChange={v => set('desktopUA', v)}
            />
            <SettingRow
              icon="monitor"
              title="EMIS بوضع الكمبيوتر"
              subtitle="يعرض صفحة EMIS بعرض شاشة الحاسوب (صغيرة، كبّرها بإصبعين)."
              value={d.desktopEmis}
              onChange={v => set('desktopEmis', v)}
            />
            <SettingRow
              icon="view-split-horizontal"
              title="عرض الشاشتين معاً"
              subtitle="موقع الطلاب في الأعلى و EMIS في الأسفل."
              value={d.split}
              onChange={v => set('split', v)}
            />
            <SettingRow
              icon="dock-window"
              title="إظهار الشريط الأزرق داخل الصفحات"
              subtitle="شريط السكربت القديم داخل صفحة الموقع و EMIS."
              value={d.showPageBar}
              onChange={v => set('showPageBar', v)}
              last
            />
          </Card>

          <SectionTitle>الروابط</SectionTitle>
          <Card style={{ padding: 14, gap: 12 }}>
            <UrlField icon="school-outline" label="موقع الطلاب" value={d.siteUrl} onChange={v => set('siteUrl', v)} />
            <UrlField icon="bank-outline" label="EMIS" value={d.emisUrl} onChange={v => set('emisUrl', v)} />
          </Card>

          <Button kind="gold" icon="content-save" label="حفظ الإعدادات" onPress={save} style={{ marginTop: 8 }} />

          <SectionTitle>أدوات</SectionTitle>
          <Card style={{ padding: 14, gap: 10 }}>
            <Button kind="soft" icon="scale-balance" label="مقارنة موقع الطلاب مع EMIS" onPress={props.onCompare} compact />
            <Button kind="soft" icon="history" label={`سجل العمليات (${props.opsCount})`} onPress={props.onShowOps} compact />
          </Card>

          <SectionTitle>المدارس</SectionTitle>
          <Card>
            {schools.map((r, i) => {
              const isDef = !r.key;
              return (
                <Pressable key={i} onPress={() => setEditing({ index: i, rule: r })} style={[styles.schoolRow, i < schools.length - 1 && styles.schoolBorder]}>
                  <Icon name={isDef ? 'home-group' : 'school-outline'} size={20} color={colors.navy} />
                  <View style={{ flex: 1 }}>
                    <T bold style={{ fontSize: 14 }}>
                      {isDef ? 'باقي المدارس' : r.key}
                    </T>
                    <T style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
                      {r.mode === 'form' ? 'كل الحقول حسب استمارة الطالب' : [r.gov, r.place, r.city].filter(Boolean).join(' / ') || 'ثابت'}
                    </T>
                  </View>
                  <Icon name="pencil-outline" size={18} color={colors.muted} />
                </Pressable>
              );
            })}
          </Card>
          <Button kind="ghost" icon="plus" label="إضافة مدرسة" onPress={() => setEditing({ index: -1, rule: { key: '', mode: 'form' } })} compact />
          <T style={{ fontSize: 11, color: colors.muted, lineHeight: 17 }}>
            تُعرف المدرسة بكلمة من اسمها. «ثابت»: المكان والمدينة ولغة الدراسة من هنا. «حسب الاستمارة»: من استمارة كل طالب. احفظ الإعدادات بعد التعديل.
          </T>

          <SectionTitle>الدعم</SectionTitle>
          <Card style={{ padding: 14, gap: 10 }}>
            <View style={{ flexDirection: ROW, gap: 8 }}>
              <Button kind="soft" icon="content-copy" label="نسخ السجل" onPress={props.onCopyLogs} style={{ flex: 1 }} compact />
              <Button kind="soft" icon="share-variant" label="مشاركة السجل" onPress={props.onShareLogs} style={{ flex: 1 }} compact />
            </View>
            <View style={{ flexDirection: ROW, alignItems: 'center', gap: 6 }}>
              <Icon name="bug-outline" size={18} color={colors.muted} />
              <T bold style={{ flex: 1, fontSize: 13, color: colors.muted }}>
                أخطاء المساعد ({props.errors.length})
              </T>
              {props.errors.length ? (
                <T bold style={{ color: colors.blue, fontSize: 13 }} onPress={props.onClearErrors}>
                  مسح
                </T>
              ) : null}
            </View>
            {props.errors.length ? (
              <View style={styles.errBox}>
                {props.errors
                  .slice(-30)
                  .reverse()
                  .map((l, i) => (
                    <T selectable key={i} style={{ fontSize: 11, color: l.level === 'error' ? colors.red : colors.text, textAlign: 'left' }}>
                      {new Date(l.t).toLocaleTimeString()} [{l.pane === 'site' ? 'الموقع' : 'EMIS'}] {l.msg}
                    </T>
                  ))}
              </View>
            ) : null}
            <Button kind="ghost" icon="stethoscope" label="تشخيص قائمة «الجنس» في EMIS" onPress={props.onDiagnose} compact />
            <Button kind="ghost" icon="help-circle-outline" label="طريقة الاستخدام" onPress={props.onShowGuide} compact />
          </Card>

          <SectionTitle>التحديث</SectionTitle>
          <Card style={{ padding: 14, gap: 10 }}>
            <T style={{ fontSize: 12, color: colors.muted }}>{props.versionText}</T>
            <Button kind="soft" icon="cloud-download-outline" label="التحقق من التحديث" onPress={props.onCheckUpdate} compact />
          </Card>

          <SectionTitle>البيانات</SectionTitle>
          <Button
            kind="ghost"
            icon="delete-outline"
            label="مسح بيانات المساعد"
            onPress={() =>
              Alert.alert('مسح بيانات المساعد', 'سيُمسح الطالب المحفوظ وإعدادات الشريط. لن يُمسح تسجيل الدخول.', [
                { text: 'إلغاء', style: 'cancel' },
                { text: 'مسح', style: 'destructive', onPress: props.onClearData },
              ])
            }
          />

          <T style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 12 }}>
            مساعد EMIS
          </T>
        </ScrollView>
        <SchoolEditor value={editing} onSave={putRule} onClose={() => setEditing(null)} />
      </SafeAreaView>
    </Modal>
  );
}

function SchoolEditor(props: { value: { index: number; rule: SchoolRule } | null; onSave: (index: number, rule: SchoolRule | null) => void; onClose: () => void }) {
  const [r, setR] = useState<SchoolRule>({ key: '', mode: 'form' });
  const isNew = !!props.value && props.value.index < 0;
  const isDef = !!props.value && !isNew && !props.value.rule.key;
  useEffect(() => {
    if (props.value) setR(props.value.rule);
  }, [props.value]);
  const field = (label: string, k: 'key' | 'gov' | 'place' | 'city' | 'lang', ph: string) => (
    <View style={{ gap: 4 }}>
      <T bold style={{ fontSize: 12 }}>
        {label}
      </T>
      <TextInput
        style={[styles.input, { textAlign: 'right' }]}
        value={r[k] || ''}
        onChangeText={v => setR(prev => ({ ...prev, [k]: v }))}
        placeholder={ph}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
  return (
    <Modal visible={!!props.value} transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <T bold style={{ fontSize: 17 }}>
            {isDef ? 'باقي المدارس' : isNew ? 'مدرسة جديدة' : r.key}
          </T>
          {isDef ? null : field('كلمة من اسم المدرسة', 'key', 'مثال: ابن بطوطة')}
          <View style={{ flexDirection: ROW, gap: 8 }}>
            {(['form', 'fixed'] as const).map(m => (
              <Pressable key={m} onPress={() => setR(prev => ({ ...prev, mode: m }))} style={[styles.modeChip, r.mode === m && styles.modeChipOn]}>
                <T bold style={{ fontSize: 13, textAlign: 'center', color: r.mode === m ? '#fff' : colors.navy }}>
                  {m === 'form' ? 'حسب الاستمارة' : 'ثابت'}
                </T>
              </Pressable>
            ))}
          </View>
          {r.mode === 'fixed' ? (
            <>
              {field('المحافظة', 'gov', 'مثال: ديالى')}
              {field('المكان (كما في EMIS)', 'place', 'مثال: مركز قضاء خانقين')}
              {field('المدينة', 'city', 'مثال: خانقين')}
              {field('لغة الدراسة', 'lang', 'العربية')}
            </>
          ) : (
            <T style={{ fontSize: 12, color: colors.muted, lineHeight: 19 }}>
              المحافظة والمكان والمدينة ولغة الدراسة والديانة تؤخذ من استمارة كل طالب.
            </T>
          )}
          <View style={{ flexDirection: ROW, gap: 8 }}>
            <Button
              kind="gold"
              label="تم"
              style={{ flex: 2 }}
              compact
              onPress={() => {
                const key = isDef ? '' : (r.key || '').trim();
                if (!isDef && !key) return Alert.alert('اسم المدرسة', 'اكتب كلمة من اسم المدرسة');
                if (r.mode === 'fixed' && !(r.place || '').trim()) return Alert.alert('المكان', 'اكتب المكان كما يظهر في EMIS');
                props.onSave(props.value!.index, { ...r, key });
              }}
            />
            {!isDef && !isNew ? <Button kind="danger" icon="delete-outline" compact style={{ flex: 1 }} onPress={() => props.onSave(props.value!.index, null)} /> : null}
            <Button kind="ghost" label="إلغاء" compact style={{ flex: 1 }} onPress={props.onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function UrlField(props: { icon: 'school-outline' | 'bank-outline'; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: ROW, alignItems: 'center', gap: 6 }}>
        <Icon name={props.icon} size={18} color={colors.navy} />
        <T bold style={{ fontSize: 13 }}>
          {props.label}
        </T>
      </View>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChange}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  schoolRow: { flexDirection: ROW, alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  schoolBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  backdrop: { flex: 1, backgroundColor: 'rgba(10,44,66,0.55)', justifyContent: 'center', padding: 20 },
  dialog: { backgroundColor: '#fff', borderRadius: radius.xl, padding: 18, gap: 12 },
  modeChip: { flex: 1, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  modeChipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  head: { flexDirection: ROW, alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  input: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    textAlign: 'left',
    fontFamily: fonts.regular,
  },
  chip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  errBox: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 10, gap: 4 },
});
