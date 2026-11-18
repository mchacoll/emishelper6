import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, ROW, themed } from './theme';
import { Button, Icon, type IconName, T } from './ui';

const STEPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'login-variant',
    title: 'سجّل الدخول مرة واحدة',
    body: 'يفتح التطبيق على EMIS: سجّل الدخول فيه، ثم سجّل دخول المنسق في تبويب «الطلاب». يبقى الدخول محفوظاً حتى بعد التحديث.',
  },
  {
    icon: 'send',
    title: '«إرسال إلى EMIS»',
    body: 'افتح «إدارة الطلاب» في EMIS، ثم في تبويب «الطلاب» اضغط «إرسال إلى EMIS» بجانب الطالب. يُسجَّل في EMIS مباشرة ويُحدَّد له «تمت المراجعة».',
  },
  {
    icon: 'file-excel',
    title: 'Excel والمقارنة',
    body: 'تبويب «Excel» يعبّئ أي نموذج في EMIS من ملف. ومن الإعدادات ← «مقارنة» تعرف من ليس في EMIS وتحدد «تمت المراجعة» للموجودين.',
  },
];

export function Onboarding({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onDone}>
      <SafeAreaView style={styles.wrap}>
        <View style={styles.top}>
          <View style={styles.logo}>
            <Icon name="lightning-bolt" size={34} color={colors.navy} />
          </View>
          <T bold style={{ color: '#fff', fontSize: 26, textAlign: 'center' }}>
            بوابة EMIS
          </T>
          <T style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, textAlign: 'center' }}>
            تعبئة استمارات الطلاب في EMIS بضغطة واحدة
          </T>
        </View>

        <View style={styles.card}>
          <View style={styles.stepIcon}>
            <Icon name={step.icon} size={34} color={colors.navy} />
          </View>
          <T style={{ color: colors.muted, fontSize: 13, textAlign: 'center' }}>
            الخطوة {i + 1} من {STEPS.length}
          </T>
          <T bold style={{ fontSize: 20, textAlign: 'center' }}>
            {step.title}
          </T>
          <T style={{ fontSize: 14, lineHeight: 24, textAlign: 'center', color: colors.text }}>{step.body}</T>

          <View style={styles.dots}>
            {STEPS.map((_, k) => (
              <View key={k} style={[styles.dot, k === i && styles.dotOn]} />
            ))}
          </View>

          <View style={{ flexDirection: ROW, gap: 8 }}>
            <Button
              kind="gold"
              label={last ? 'ابدأ الاستخدام' : 'التالي'}
              icon={last ? 'check' : 'arrow-left'}
              onPress={() => (last ? (setI(0), onDone()) : setI(i + 1))}
              style={{ flex: 2 }}
            />
            {!last ? <Button kind="ghost" label="تخطي" onPress={() => (setI(0), onDone())} style={{ flex: 1 }} /> : null}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = themed(() =>
  StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.navy, justifyContent: 'space-between', padding: 20 },
  top: { alignItems: 'center', gap: 8, marginTop: 40 },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  card: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 22, gap: 12 },
  stepIcon: {
    alignSelf: 'center',
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { width: 22, backgroundColor: colors.gold },
  }),
);
