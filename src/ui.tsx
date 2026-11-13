import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  type TextProps,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

import { colors, fonts, radius, ROW, TEXT_START } from './theme';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function T({ style, bold, ...rest }: TextProps & { bold?: boolean }) {
  return (
    <Text
      {...rest}
      style={[{ fontFamily: bold ? fonts.bold : fonts.regular, color: colors.text, textAlign: TEXT_START }, style]}
    />
  );
}

export function Icon({ name, size = 20, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}

type BtnKind = 'primary' | 'gold' | 'danger' | 'purple' | 'ghost' | 'soft';
const BTN: Record<BtnKind, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.navy, fg: '#fff' },
  gold: { bg: colors.gold, fg: colors.navyDark },
  danger: { bg: colors.red, fg: '#fff' },
  purple: { bg: colors.purple, fg: '#fff' },
  ghost: { bg: 'transparent', fg: colors.navy, border: colors.border },
  soft: { bg: colors.blueSoft, fg: colors.navy },
};

export function Button({
  label,
  icon,
  kind = 'primary',
  onPress,
  onLongPress,
  disabled,
  busy,
  style,
  compact,
}: {
  label?: string;
  icon?: IconName;
  kind?: BtnKind;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const k = BTN[kind];
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled || busy}
      android_ripple={{ color: 'rgba(255,255,255,0.25)' }}
      style={({ pressed }) => [
        styles.btn,
        compact && styles.btnCompact,
        { backgroundColor: k.bg, borderColor: k.border ?? k.bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={k.fg} size="small" />
      ) : (
        <>
          {icon ? <Icon name={icon} size={compact ? 18 : 20} color={k.fg} /> : null}
          {label ? (
            <T bold style={[styles.btnText, compact && { fontSize: 13 }, { color: k.fg }]} numberOfLines={1}>
              {label}
            </T>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  onLongPress,
  color = '#fff',
  bg = 'rgba(255,255,255,0.12)',
  size = 40,
  accessibilityLabel,
}: {
  icon: IconName;
  onPress: () => void;
  onLongPress?: () => void;
  color?: string;
  bg?: string;
  size?: number;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={6}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2.8, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Icon name={icon} size={size * 0.52} color={color} />
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <T bold style={styles.section}>
      {children}
    </T>
  );
}

export function SettingRow({
  icon,
  title,
  subtitle,
  value,
  onChange,
  last,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <Pressable onPress={() => onChange(!value)} style={[styles.setRow, !last && styles.setRowBorder]}>
      <View style={styles.setIcon}>
        <Icon name={icon} size={20} color={colors.navy} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T bold style={{ fontSize: 14 }}>
          {title}
        </T>
        {subtitle ? <T style={{ fontSize: 12, color: colors.muted, lineHeight: 18 }}>{subtitle}</T> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.navySoft, false: '#CBD5DC' }}
        thumbColor={value ? colors.gold : '#fff'}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: ROW,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  btnCompact: { minHeight: 40, paddingHorizontal: 10, gap: 6 },
  btnText: { fontSize: 15, textAlign: 'center' },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  section: { fontSize: 13, color: colors.muted, marginTop: 8, marginBottom: 2, paddingHorizontal: 4 },
  setRow: { flexDirection: ROW, alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  setRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  setIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
