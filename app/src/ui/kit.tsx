import { ReactNode } from 'react';
import {
  Pressable, Text, View, ActivityIndicator, StyleSheet, ViewStyle, SafeAreaView,
} from 'react-native';
import { c, t, sp, r } from './theme';

export function Screen({ children, pad = true }: { children: ReactNode; pad?: boolean }) {
  return (
    <SafeAreaView style={s.screen}>
      <View style={[{ flex: 1 }, pad && { paddingHorizontal: sp(2.5) }]}>{children}</View>
    </SafeAreaView>
  );
}

export function Button({
  title, onPress, kind = 'primary', disabled, loading, style,
}: {
  title: string; onPress: () => void;
  kind?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean; loading?: boolean; style?: ViewStyle;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        s.btn, s[kind], off && s.off, pressed && !off && { opacity: 0.85 }, style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={kind === 'primary' ? '#fff' : c.accent} />
        : <Text style={[s.btnText, kind !== 'primary' && { color: c.accent }]}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

/** Empty states get a guided action, never a dead end. */
export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <View style={s.empty}>
      <Text style={[t.h2, { textAlign: 'center' }]}>{title}</Text>
      <Text style={[t.sub, { textAlign: 'center', marginTop: sp(1) }]}>{body}</Text>
      {action ? <View style={{ marginTop: sp(2), alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  btn: {
    paddingVertical: 17, borderRadius: r.md, alignItems: 'center',
    justifyContent: 'center', marginVertical: 5,
  },
  primary: { backgroundColor: c.accent },
  secondary: { backgroundColor: c.surfaceHi },
  ghost: { backgroundColor: 'transparent' },
  off: { opacity: 0.35 },
  btnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  card: { backgroundColor: c.surface, borderRadius: r.lg, padding: sp(2), borderWidth: 1, borderColor: c.line },
  empty: { alignItems: 'center', paddingVertical: sp(5), paddingHorizontal: sp(2) },
});
