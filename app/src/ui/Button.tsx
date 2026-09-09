import { ActivityIndicator, View } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** 'pill' (default) or 'rounded' for a soft-cornered rectangle. Capsules are
   *  the default because every CTA the scaffolds draw is one — a rounded button
   *  next to a pill CTA is the thing that reads as unfinished. */
  shape?: 'rounded' | 'pill';
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  shape = 'pill',
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
  btn: (v: ButtonVariant, off?: boolean, shape: 'rounded' | 'pill' = 'pill') => ({
    height: 52,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: shape === 'pill' ? theme.radius.pill : theme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    // Disabled reads as "not now", not as "broken": the shape stays, the ink
    // drops out.
    opacity: off ? 0.35 : 1,
    backgroundColor:
      v === 'primary'
        ? theme.colors.primary
        : v === 'danger'
          ? theme.colors.danger
          : v === 'secondary'
            ? // A white capsule, so a secondary action is still a surface you
              // can see rather than an outline on the ground.
              theme.colors.cardBackground
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
