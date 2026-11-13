import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { colors, radius, ROW } from './theme';
import { Button, Icon, T } from './ui';
import { downloadAndInstall, type Manifest } from './updater';

export function UpdateModal({ manifest, onClose }: { manifest: Manifest | null; onClose: () => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');

  const start = async () => {
    setError('');
    setProgress(0);
    try {
      await downloadAndInstall(setProgress);
      setProgress(null);
    } catch (e) {
      setProgress(null);
      setError((e as Error)?.message || 'تعذّر التحديث');
    }
  };

  return (
    <Modal visible={!!manifest} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.icon}>
            <Icon name="rocket-launch-outline" size={34} color={colors.navy} />
          </View>
          <T bold style={{ fontSize: 20, textAlign: 'center' }}>
            تحديث جديد {manifest?.version ? `v${manifest.version}` : ''}
          </T>
          {manifest?.notes?.length ? (
            <View style={{ gap: 6 }}>
              {manifest.notes.map((n, i) => (
                <View key={i} style={{ flexDirection: ROW, gap: 8, alignItems: 'flex-start' }}>
                  <Icon name="check-circle" size={16} color={colors.green} />
                  <T style={{ flex: 1, fontSize: 13, lineHeight: 21 }}>{n}</T>
                </View>
              ))}
            </View>
          ) : null}

          {progress !== null ? (
            <View style={{ gap: 6 }}>
              <View style={styles.bar}>
                <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
              <T style={{ fontSize: 12, color: colors.muted, textAlign: 'center' }}>
                جارٍ التنزيل {Math.round(progress * 100)}%
              </T>
            </View>
          ) : null}
          {error ? <T style={{ color: colors.red, fontSize: 12, textAlign: 'center' }}>{error}</T> : null}

          <T style={{ fontSize: 12, color: colors.muted, textAlign: 'center', lineHeight: 19 }}>
            يُثبَّت فوق التطبيق الحالي، ويبقى تسجيل دخولك وقائمة الطلاب كما هي. قد يطلب الهاتف السماح بتثبيت التطبيقات من «مساعد EMIS» أول مرة.
          </T>
          <View style={{ flexDirection: ROW, gap: 8 }}>
            <Button
              kind="gold"
              icon="download"
              label={progress !== null ? 'جارٍ التنزيل...' : 'تحديث الآن'}
              onPress={start}
              busy={progress !== null}
              style={{ flex: 2 }}
            />
            <Button kind="ghost" label="لاحقاً" onPress={onClose} style={{ flex: 1 }} disabled={progress !== null} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,44,66,0.55)', justifyContent: 'center', padding: 22 },
  card: { backgroundColor: '#fff', borderRadius: radius.xl, padding: 22, gap: 14 },
  icon: {
    alignSelf: 'center',
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.bg, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.gold },
});
