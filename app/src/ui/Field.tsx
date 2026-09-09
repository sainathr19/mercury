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
        // Sentence case, in the text colour. An uppercased muted label reads as
        // a section heading rather than as the name of the field under it.
        <Text variant="captionSemibold" style={styles.label}>
          {label}
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
  wrap: { width: '100%', gap: 7 },
  label: { color: theme.colors.text, paddingLeft: 3 },
  input: (hasError: boolean) => ({
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: hasError ? theme.colors.danger : theme.colors.border,
    borderRadius: theme.radius.lg,
    color: theme.colors.text,
    paddingHorizontal: 15,
    paddingVertical: 14,
    ...theme.typography.body,
  }),
  error: { paddingLeft: 3 },
}));
