import { useEffect, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { normUrl, type Settings } from './settings';
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
}) {
  const [d, setD] = useState(props.settings);
  useEffect(() => {
    if (props.visible) setD(props.settings);
  }, [props.visible, props.settings]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setD(prev => ({ ...prev, [k]: v }));

  const save = () => props.onSave({ ...d, siteUrl: normUrl(d.siteUrl), emisUrl: normUrl(d.emisUrl) });

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
              icon="file-document-multiple-outline"
              title="تعبئة الطالب التالي تلقائياً"
              subtitle="بعد «تمت المراجعة» يُفتح «جديد» في EMIS ويُعبّأ الطالب التالي دون ضغط. يتوقف عند أي حقل ناقص."
              value={d.autoFillNext}
              onChange={v => set('autoFillNext', v)}
            />
            <SettingRow
              icon="swap-horizontal"
              title="التنقل التلقائي بين الشاشتين"
              subtitle="عرض EMIS أثناء التعبئة ثم العودة لموقع الطلاب بعد الحفظ."
              value={d.autoSwitch}
              onChange={v => set('autoSwitch', v)}
              last
            />
          </Card>

          <SectionTitle>العرض</SectionTitle>
          <Card>
            <SettingRow
              icon="monitor"
              title="EMIS بوضع الكمبيوتر"
              subtitle="يعرض EMIS بعرض شاشة الحاسوب. جرّبه إن فشل اختيار بعض القوائم."
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
              subtitle="الشريط القديم للسكربت. لوحة التحكم في الأسفل تغني عنه."
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
            <Button kind="ghost" icon="help-circle-outline" label="طريقة الاستخدام" onPress={props.onShowGuide} compact />
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
            مساعد EMIS · الإصدار 7.6.1
          </T>
        </ScrollView>
      </SafeAreaView>
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
  errBox: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 10, gap: 4 },
});
