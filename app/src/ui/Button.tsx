import { ActivityIndicator, View } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** 'rounded' (default) or 'pill' for a fully-rounded capsule. */
  shape?: 'rounded' | 'pill';
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  shape = 'rounded',
  loading,
  disabled,
  icon,
}: ButtonProps) {
  const off = disabled || loading;
  const labelColor = labelColorFor(variant);
  return (
    <PressableScale onPress={off ? undefined : onPress} style={styles.btn(variant, off, shape)}>
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text variant="body" color={labelColor}>
            {title}
          </Text>
        </View>
      )}
    </PressableScale>
  );
}

function labelColorFor(v: ButtonVariant): string {
  const c = UnistylesRuntime.getTheme().colors;
  if (v === 'primary') return c.primaryLabel;
  if (v === 'danger') return '#FFFFFF';
  return c.text;
}

const styles = StyleSheet.create((theme) => ({
  btn: (v: ButtonVariant, off?: boolean, shape: 'rounded' | 'pill' = 'rounded') => ({
    paddingVertical: 15,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: shape === 'pill' ? theme.radius.pill : theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: off ? 0.45 : 1,
    backgroundColor:
      v === 'primary'
        ? theme.colors.primary
        : v === 'danger'
          ? theme.colors.danger
          : 'transparent',
    borderWidth: v === 'secondary' || v === 'ghost' ? 1 : 0,
    borderColor: theme.colors.border,
  }),
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
}));
