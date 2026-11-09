import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, StyleSheet, View } from 'react-native';

import { colors, radius, ROW } from './theme';
import { Button, Icon, type IconName, T } from './ui';

export type SyncState = {
  visible: boolean;
  step: 'emis' | 'site' | 'done' | 'error';
  text: string;
  percent: number; // 0..100
  title?: string;
  summary?: {
    toRegister: number;
    added: number;
    existing: number;
    reviewed: number;
    emisRows: number;
    warn?: string;
    file?: { name: string; rows: number; noName: number; duplicates: number; columns: string[]; unknown: string[] };
  };
};

/** شاشة المزامنة: رسم + بطاقة تقدم */
export function SyncScreen({ state, onClose, onStop }: { state: SyncState; onClose: () => void; onStop: () => void }) {
  const spin = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const busy = state.step === 'emis' || state.step === 'site';

  useEffect(() => {
    if (!state.visible) return;
    const a = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }));
    const b = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [state.visible, spin, bob]);

  const rot = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const rotBack = spin.interpolate({ inputRange: [0, 1], outputRange: ['360deg', '0deg'] });
  const lift = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  const pct = Math.max(0, Math.min(100, Math.round(state.percent)));
  const sm = state.summary;

  return (
    <Modal visible={state.visible} animationType="fade" onRequestClose={busy ? onStop : onClose} statusBarTranslucent>
      <LinearGradient colors={['#1B2A7A', '#2A3A9C', '#3C8DE0', '#7CC38E']} locations={[0, 0.4, 0.72, 1]} style={styles.fill}>
        <View style={styles.center}>
          {/* الرسم */}
          <View style={styles.scene}>
            <Animated.View style={[styles.gear, { top: 0, left: 108, transform: [{ rotate: rot }] }]}>
              <Icon name="cog" size={30} color="#E5533D" />
            </Animated.View>
            <Animated.View style={[styles.gear, { top: 34, left: 78, transform: [{ rotate: rotBack }] }]}>
              <Icon name="cog-outline" size={34} color="#8FA2E8" />
            </Animated.View>
            <Animated.View style={[styles.gear, { top: 26, left: 128, transform: [{ rotate: rot }] }]}>
              <Icon name="cog" size={50} color="#9FB0F0" />
            </Animated.View>

            <View style={[styles.desk, { flexDirection: ROW }]}>
              <Actor icon="account-tie" color="#C94FC4" lift={lift} label="موقع الطلاب" />
              <Icon name="swap-horizontal-bold" size={30} color="rgba(255,255,255,0.85)" />
              <Actor icon="robot-happy" color="#FFFFFF" lift={lift} label="EMIS" robot />
            </View>
            <View style={styles.table} />
          </View>

          <T bold style={styles.title}>
            مساعد EMIS الذكي
          </T>
          <T style={styles.sub}>{state.title || 'مزامنة الطلاب'}</T>

          {/* بطاقة التقدم */}
          <View style={styles.card}>
            <View style={[styles.row, { gap: 10 }]}>
              {busy ? (
                <Animated.View style={{ transform: [{ rotate: rot }] }}>
                  <Icon name="sync" size={24} color="#fff" />
                </Animated.View>
              ) : (
                <Icon name={state.step === 'error' ? 'alert-circle' : 'check-circle'} size={24} color={state.step === 'error' ? '#FFD3CC' : '#C8F7D6'} />
              )}
              <T bold style={{ color: '#fff', fontSize: 15, flex: 1 }} numberOfLines={2}>
                {state.text}
              </T>
            </View>
            {busy ? (
              <>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${pct}%` }]} />
                </View>
                <T bold style={styles.pct}>
                  {pct}%
                </T>
              </>
            ) : null}

            {sm ? (
              <View style={{ gap: 8 }}>
                {sm.file ? (
                  <View style={styles.fileBox}>
                    <View style={[styles.row, { gap: 6 }]}>
                      <Icon name="file-excel" size={18} color="#C8F7D6" />
                      <T bold style={{ color: '#fff', fontSize: 13, flex: 1 }} numberOfLines={1}>
                        {sm.file.name}
                      </T>
                    </View>
                    <T style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, lineHeight: 18 }}>
                      {sm.file.rows} صف{sm.file.noName ? ` · ${sm.file.noName} بدون اسم` : ''}
                      {sm.file.duplicates ? ` · ${sm.file.duplicates} مكرر` : ''}
                    </T>
                    <T style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, lineHeight: 17 }} numberOfLines={3}>
                      الأعمدة المقروءة: {sm.file.columns.join('، ')}
                      {sm.file.unknown.length ? `\nلم تُقرأ: ${sm.file.unknown.join('، ')}` : ''}
                    </T>
                  </View>
                ) : null}
                <Stat icon="account-plus" label="للتسجيل في EMIS" value={sm.toRegister} extra={sm.added ? `(${sm.added} جديد)` : ''} strong />
                <Stat icon="database-check" label="موجود في EMIS (لم يُزامَن)" value={sm.existing} />
                {sm.file ? null : <Stat icon="check-decagram" label="عليه «تمت المراجعة»" value={sm.reviewed} />}
                <Stat icon="table-account" label="طلاب قرأتهم من EMIS" value={sm.emisRows} />
                {sm.warn ? (
                  <View style={styles.warn}>
                    <Icon name="alert" size={16} color="#7A4B00" />
                    <T style={{ flex: 1, fontSize: 12, color: '#7A4B00', lineHeight: 18 }}>{sm.warn}</T>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          <View style={{ width: '100%', maxWidth: 420, marginTop: 18 }}>
            {busy ? (
              <Button kind="ghost" icon="stop" label="إيقاف" onPress={onStop} style={styles.ghostBtn} />
            ) : (
              <Button kind="gold" icon="check" label="تم" onPress={onClose} />
            )}
          </View>
        </View>
      </LinearGradient>
    </Modal>
  );
}

function Actor({ icon, color, lift, label, robot }: { icon: IconName; color: string; lift: Animated.AnimatedInterpolation<number>; label: string; robot?: boolean }) {
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Animated.View style={{ transform: [{ translateY: robot ? lift : 0 }] }}>
        <Icon name={icon} size={64} color={color} />
      </Animated.View>
      <View style={styles.laptop}>
        <Icon name="laptop" size={40} color="#1E2E66" />
      </View>
      <T style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11 }}>{label}</T>
    </View>
  );
}

function Stat({ icon, label, value, extra, strong }: { icon: IconName; label: string; value: number; extra?: string; strong?: boolean }) {
  return (
    <View style={[styles.row, { gap: 8 }]}>
      <Icon name={icon} size={18} color="rgba(255,255,255,0.9)" />
      <T style={{ color: '#fff', fontSize: 13, flex: 1 }}>{label}</T>
      {extra ? <T style={{ color: '#C8F7D6', fontSize: 12 }}>{extra}</T> : null}
      <T bold style={{ color: strong ? '#FFD84D' : '#fff', fontSize: strong ? 18 : 15 }}>{value}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  row: { flexDirection: ROW, alignItems: 'center' },
  scene: { width: 300, height: 190, alignItems: 'center', justifyContent: 'flex-end', marginBottom: 18 },
  gear: { position: 'absolute' },
  desk: { alignItems: 'flex-end', justifyContent: 'space-between', width: 280, gap: 12 },
  table: { width: 290, height: 6, borderRadius: 3, backgroundColor: 'rgba(30,46,102,0.55)', marginTop: 2 },
  laptop: { marginTop: -18 },
  title: { color: '#fff', fontSize: 30, textAlign: 'center' },
  sub: { color: 'rgba(255,255,255,0.75)', fontSize: 16, textAlign: 'center', marginTop: 4, marginBottom: 22 },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: 20,
    gap: 14,
  },
  bar: { height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  barFill: { height: 12, borderRadius: 6, backgroundColor: '#FFD84D' },
  pct: { color: 'rgba(255,255,255,0.9)', fontSize: 16, textAlign: 'center' },
  fileBox: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.md, padding: 10, gap: 4 },
  warn: { flexDirection: ROW, gap: 6, backgroundColor: '#FFE8B3', borderRadius: radius.md, padding: 8, alignItems: 'flex-start' },
  ghostBtn: { borderColor: 'rgba(255,255,255,0.6)', backgroundColor: 'rgba(255,255,255,0.12)' },
});
// يُستخدم لون السمة لتجنب تحذير الاستيراد غير المستخدم
void colors;
