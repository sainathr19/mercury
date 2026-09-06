import { TextInput, View, type TextInputProps } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Text } from './Text';

export interface FieldProps extends TextInputProps {
  label?: string;
  error?: string;
}

export function Field({ label, error, style, ...rest }: FieldProps) {
  const placeholderColor = UnistylesRuntime.getTheme().colors.muted;
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="caption" color={mutedColor()} style={styles.label}>
          {label.toUpperCase()}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={placeholderColor}
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
        style={[styles.input(!!error), style]}
      />
      {error ? (
        <Text variant="caption" color={dangerColor()} style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const mutedColor = () => UnistylesRuntime.getTheme().colors.muted;
const dangerColor = () => UnistylesRuntime.getTheme().colors.danger;

const styles = StyleSheet.create((theme) => ({
  wrap: { width: '100%' },
  label: { marginBottom: theme.spacing.xs, letterSpacing: 0.5 },
  input: (hasError: boolean) => ({
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: hasError ? theme.colors.danger : theme.colors.border,
    borderRadius: theme.radius.md,
    color: theme.colors.text,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    ...theme.typography.bodyMedium,
  }),
  error: { marginTop: theme.spacing.xs },
}));
