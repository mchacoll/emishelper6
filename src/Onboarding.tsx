import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, ROW } from './theme';
import { Button, Icon, type IconName, T } from './ui';

const STEPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'login-variant',
    title: 'سجّل الدخول مرة واحدة',
    body: 'سجّل الدخول في «موقع الطلاب» وفي «EMIS» من الأزرار في الأعلى. يبقى الدخول محفوظاً في التطبيق حتى بعد التحديث.',
  },
  {
    icon: 'sync',
    title: 'مزامنة',
    body: 'افتح قائمة الطلاب في موقعك واضغط «مزامنة». يقرأ التطبيق كل الطلاب، ويترك من عليه «تمت المراجعة»، ويضع الباقين في قائمة التسجيل.',
  },
  {
    icon: 'play-circle-outline',
    title: 'تسجيل الكل',
    body: 'اضغط «تسجيل الكل»: يُسجَّل كل طالب في EMIS ويُحفظ، ويُحدَّد «تمت المراجعة» في موقعك تلقائياً، دون أن تعود لموقع الطلاب. إن نقص حقل أكمله واحفظه ثم اضغط «حفظته ⏭». زر 🤖 يكرر ذلك تلقائياً للاستمارات الجديدة.',
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
            مساعد EMIS
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

const styles = StyleSheet.create({
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
  card: { backgroundColor: '#fff', borderRadius: radius.xl, padding: 22, gap: 12 },
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
});
