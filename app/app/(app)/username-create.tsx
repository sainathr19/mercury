import { useEffect, useRef } from 'react';
import { TextInput, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { PressableScale, Text, useToast } from '../../src/ui';
import { useMercuryName } from '../../src/stores/mercuryNameStore';
import { NAME_PARENT, fullName } from '../../src/bridge/mercuryName';
import { fontFamily } from '../../src/theme/fonts';

/** Create / edit the Mercury name — a real ENS subname, free, resolvable by any
 *  wallet or explorer. Live availability as you type; Save signs a claim with
 *  the wallet key and publishes the EVM, Solana and Bitcoin addresses together. */
export default function CreateUsername() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const st = useMercuryName();
  const inputRef = useRef<TextInput>(null);
  const currentLabel = st.name ? st.name.replace(`.${NAME_PARENT}`, '') : null;

  useEffect(() => {
    st.begin();
    if (mode === 'edit' && currentLabel) st.setInput(currentLabel);
    const t = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSave = st.status === 'available' && !st.saving && !st.formatError && !!st.input;

  async function onSave() {
    const ok = await st.save();
    if (ok) {
      show('Name claimed.', 'success');
      router.back();
    } else {
      const err = useMercuryName.getState().error;
      if (err) show(err, 'error');
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>{mode === 'edit' ? 'Edit Name' : 'Claim Your Name'}</Text>
        <Text style={styles.subtitle} color={theme.colors.muted}>
          A free ENS name under {NAME_PARENT}. Anyone can pay it — on Arc, Base, Solana or Bitcoin.
        </Text>
      </View>

      <View style={styles.field}>
        <TextInput
          ref={inputRef}
          value={st.input}
          onChangeText={st.setInput}
          placeholder="username"
          placeholderTextColor={theme.colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          maxLength={30}
          returnKeyType="done"
          onSubmitEditing={onSave}
          style={styles.input}
        />
        <Text style={styles.suffix} color={theme.colors.muted}>
          .{NAME_PARENT}
        </Text>
        {st.status === 'available' && (
          <ExpoImage source={require('../../assets/icons/CheckIcon.svg')} style={styles.badge} tintColor={theme.colors.success} contentFit="contain" />
        )}
        {st.status === 'taken' && (
          <ExpoImage source={require('../../assets/icons/AlertIcon.svg')} style={styles.badge} tintColor={theme.colors.danger} contentFit="contain" />
        )}
      </View>

      {st.formatError ? (
        <Text style={styles.helperError} color={theme.colors.danger}>
          {st.formatError}
        </Text>
      ) : st.status === 'taken' ? (
        <Text style={styles.helperError} color={theme.colors.danger}>
          {st.statusReason ?? 'That name is taken.'}
        </Text>
      ) : st.status === 'unknown' ? (
        // Not the same as taken, and saying so would send them off to pick a
        // worse name because a request timed out.
        <Text style={styles.helperHint} color={theme.colors.muted}>
          Could not check that name right now.
        </Text>
      ) : st.status === 'available' ? (
        <Text style={styles.helperOk} color={theme.colors.success}>
          {fullName(st.input)} is yours.
        </Text>
      ) : null}

      <View style={styles.spacer} />
      <PressableScale style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]} disabled={!canSave} onPress={onSave}>
        <Text style={styles.saveLabel} color={theme.colors.primaryLabel}>
          {st.saving ? 'Claiming…' : 'Claim'}
        </Text>
      </PressableScale>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground, paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.md },
  header: { paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.md },
  title: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text },
  subtitle: { fontSize: 13, fontFamily: fontFamily.medium, letterSpacing: -0.26, marginTop: 6, lineHeight: 18 },
  // Name field — grey box, standard 12y/18x padding.
  field: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: theme.colors.cardBackground, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18 },
  suffix: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
  input: { flex: 1, color: theme.colors.text, fontFamily: fontFamily.medium, fontSize: 15, letterSpacing: -0.3, padding: 0 },
  badge: { width: 20, height: 20 },
  helperError: { fontSize: 13, fontFamily: fontFamily.medium, letterSpacing: -0.26, marginTop: 8, paddingHorizontal: 4 },
  helperHint: { fontSize: 13, fontFamily: fontFamily.medium, letterSpacing: -0.26, marginTop: 8, paddingHorizontal: 4 },
  helperHintBold: { fontSize: 13, fontFamily: fontFamily.bold, letterSpacing: -0.26 },
  helperOk: { fontSize: 13, fontFamily: fontFamily.medium, letterSpacing: -0.26, marginTop: 8, paddingHorizontal: 4 },
  spacer: { flex: 1 },
  saveBtn: { height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveBtnDisabled: { backgroundColor: theme.colors.muted },
  saveLabel: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3 },
}));
