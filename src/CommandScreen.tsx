import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type AppActions, explainError, getApiKey, providerOf, runCommand, setApiKey } from './agent';
import { colors, fonts, radius, ROW } from './theme';
import { Button, Icon, IconButton, T } from './ui';

const PIN = '1994';
type Line = { who: 'me' | 'ai' | 'tool' | 'err'; text: string };

const TOOL_AR: Record<string, string> = {
  get_status: 'قراءة حالة التطبيق',
  open_tab: 'فتح تبويب',
  reload_page: 'إعادة تحميل الصفحة',
  compare_with_emis: 'مقارنة الطلاب مع EMIS',
  show_compare_screen: 'فتح شاشة المقارنة',
  send_student_to_emis: 'فتح معاينة الإرسال',
  mark_reviewed_for_existing: 'تحديد «تمت المراجعة»',
  search_operations: 'البحث في سجل العمليات',
  export_operations_excel: 'تصدير السجل',
  show_operations_log: 'فتح سجل العمليات',
  check_for_updates: 'فحص التحديثات',
};

const EXAMPLES = ['كم طالباً أرسلت اليوم؟ وكم فشل؟', 'قارن الطلاب مع EMIS وأعطني غير الموجودين', 'أرسل الطالب علي جاسم محمد حبش إلى EMIS', 'لماذا فشل آخر طالب؟'];

/** نافذة «مساعد الأوامر» (محمية برقم سري) */
export function CommandScreen(props: { visible: boolean; onClose: () => void; actions: AppActions }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [editKey, setEditKey] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useRef<unknown[]>([]);
  const list = useRef<FlatList<Line>>(null);

  useEffect(() => {
    if (!props.visible) {
      setUnlocked(false);
      setPin('');
      return;
    }
    getApiKey().then(k => setKey(k));
  }, [props.visible]);

  const add = (l: Line) => setLines(x => [...x, l]);

  const send = async (text?: string) => {
    const cmd = (text ?? input).trim();
    if (!cmd || busy || !key) return;
    setInput('');
    add({ who: 'me', text: cmd });
    setBusy(true);
    try {
      const r = await runCommand(key, history.current, cmd, props.actions, name => add({ who: 'tool', text: TOOL_AR[name] || name }));
      history.current = r.history;
      add({ who: 'ai', text: r.reply });
    } catch (e) {
      add({ who: 'err', text: explainError(e) });
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    const k = keyDraft.trim();
    if (!k) return;
    await setApiKey(k);
    if (!key || providerOf(key) !== providerOf(k)) {
      history.current = [];
      setLines([]);
    }
    setKey(k);
    setKeyDraft('');
    setEditKey(false);
  };

  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.navy }} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <IconButton icon="close" onPress={props.onClose} accessibilityLabel="إغلاق" />
          <T bold style={{ color: '#fff', fontSize: 17, flex: 1 }}>
            مساعد الأوامر{unlocked && key ? (providerOf(key) === 'gemini' ? ' · Gemini' : ' · Claude') : ''}
          </T>
          {unlocked && key ? (
            <>
              <IconButton icon="key-variant" onPress={() => setEditKey(v => !v)} accessibilityLabel="مفتاح API" />
              <IconButton
                icon="broom"
                onPress={() => {
                  history.current = [];
                  setLines([]);
                }}
                accessibilityLabel="محادثة جديدة"
              />
            </>
          ) : null}
        </View>

        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior="padding">
          {!unlocked ? (
            <View style={styles.center}>
              <Icon name="lock-outline" size={42} color={colors.navy} />
              <T bold style={{ fontSize: 16 }}>أدخل الرقم السري</T>
              <TextInput
                style={[styles.input, { width: 180, textAlign: 'center', fontSize: 22, letterSpacing: 8 }]}
                value={pin}
                onChangeText={v => {
                  const d = v.replace(/\D/g, '').slice(0, 4);
                  setPin(d);
                  if (d === PIN) setUnlocked(true);
                }}
                keyboardType="number-pad"
                secureTextEntry
                autoFocus
                maxLength={4}
              />
              {pin.length === 4 && pin !== PIN ? <T style={{ color: colors.red }}>رقم خاطئ</T> : null}
            </View>
          ) : !key || editKey ? (
            <View style={styles.center}>
              <Icon name="key-variant" size={40} color={colors.navy} />
              <T bold style={{ fontSize: 16, textAlign: 'center' }}>مفتاح الذكاء الاصطناعي</T>
              <T style={{ fontSize: 12, color: colors.muted, textAlign: 'center', lineHeight: 20 }}>
                مجاني: Google Gemini — من aistudio.google.com ← Get API key (يبدأ بـ AIza).{'\n'}
                مدفوع: Claude — من console.anthropic.com ← API Keys (يبدأ بـ sk-ant-).{'\n'}
                يعرف التطبيق النوع من المفتاح نفسه، ويحفظه مشفّراً في هذا الهاتف فقط.
              </T>
              <TextInput
                style={[styles.input, { alignSelf: 'stretch' }]}
                value={keyDraft}
                onChangeText={setKeyDraft}
                placeholder="AIza... أو sk-ant-..."
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <Button kind="primary" icon="content-save" label="حفظ المفتاح" onPress={saveKey} style={{ alignSelf: 'stretch' }} />
              {key ? (
                <Button
                  kind="ghost"
                  icon="delete-outline"
                  label="حذف المفتاح من الهاتف"
                  onPress={async () => {
                    await setApiKey('');
                    setKey(null);
                    setEditKey(false);
                  }}
                />
              ) : null}
            </View>
          ) : (
            <>
              <FlatList
                ref={list}
                data={lines}
                keyExtractor={(_, i) => String(i)}
                contentContainerStyle={{ padding: 12, gap: 8 }}
                onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
                ListEmptyComponent={
                  <View style={{ gap: 8, paddingTop: 12 }}>
                    <T style={{ color: colors.muted, fontSize: 13, lineHeight: 21 }}>
                      اكتب ما تريد بكلامك، وسأنفّذه بأدوات التطبيق: المقارنة، فتح معاينة إرسال طالب، البحث في السجل، التصدير، التحديث... لا أستطيع تغيير شكل التطبيق أو إضافة ميزات.
                    </T>
                    {EXAMPLES.map(e => (
                      <Pressable key={e} onPress={() => send(e)} style={styles.example}>
                        <T style={{ fontSize: 13, color: colors.navy }}>{e}</T>
                      </Pressable>
                    ))}
                  </View>
                }
                renderItem={({ item }) =>
                  item.who === 'tool' ? (
                    <View style={[styles.row, { gap: 6, alignSelf: 'flex-start' }]}>
                      <Icon name="cog-play-outline" size={14} color={colors.muted} />
                      <T style={{ fontSize: 11, color: colors.muted }}>{item.text}</T>
                    </View>
                  ) : (
                    <View style={[styles.bubble, item.who === 'me' ? styles.me : item.who === 'err' ? styles.err : styles.ai]}>
                      <T selectable style={{ fontSize: 14, lineHeight: 22, color: item.who === 'me' ? '#fff' : item.who === 'err' ? colors.red : colors.text }}>
                        {item.text}
                      </T>
                    </View>
                  )
                }
              />
              <View style={styles.bar}>
                <TextInput
                  style={[styles.input, { flex: 1, maxHeight: 110 }]}
                  value={input}
                  onChangeText={setInput}
                  placeholder="اكتب أمراً..."
                  placeholderTextColor={colors.muted}
                  multiline
                  editable={!busy}
                />
                <Pressable onPress={() => send()} disabled={busy || !input.trim()} style={[styles.sendBtn, (busy || !input.trim()) && { opacity: 0.5 }]}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Icon name="send" size={20} color="#fff" />}
                </Pressable>
              </View>
            </>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: ROW, alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  row: { flexDirection: ROW, alignItems: 'center' },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: colors.text,
    textAlign: 'right',
    fontFamily: fonts.regular,
  },
  example: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 10 },
  bubble: { maxWidth: '88%', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  me: { alignSelf: 'flex-end', backgroundColor: colors.navy },
  ai: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  err: { alignSelf: 'flex-start', backgroundColor: colors.redSoft },
  bar: { flexDirection: ROW, alignItems: 'flex-end', gap: 8, padding: 10, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
});
