import { useEffect, useRef } from 'react';
import { TextInput, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { PressableScale, Text, useToast } from '../../src/ui';
import { useAuth } from '../../src/stores/authStore';
import { useUsername } from '../../src/stores/usernameStore';
import { isTwitterConfigured } from '../../src/bridge/twitterAuth';
import { fontFamily } from '../../src/theme/fonts';

/** Create / edit the Standard username. Live availability check as you type
 *  (hub-backed); Save persists via the hub. The "log into X" hint runs the real
 *  X claim so a verified owner can reclaim a taken handle. */
export default function CreateUsername() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const current = useAuth((s) => s.user?.handle ?? null);
  const st = useUsername();
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    st.begin(current);
    if (mode === 'edit' && current) st.setInput(current);
    const t = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSave = st.status === 'available' && !st.saving && !st.formatError && !!st.input;

  async function onSave() {
    const ok = await st.save();
    if (ok) {
      show('Username saved.', 'success');
      router.back();
    } else {
      const err = useUsername.getState().error;
      if (err) show(err, 'error');
    }
  }

  async function onClaimX() {
    if (!isTwitterConfigured()) {
      show('Connecting your X account is coming soon.', 'info');
      return;
    }
    const ok = await st.claimViaX();
    if (ok) {
      show('Username claimed from X.', 'success');
      router.back();
    } else {
      const err = useUsername.getState().error;
      if (err) show(err, 'error');
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>{mode === 'edit' ? 'Edit Username' : 'Create Username'}</Text>
      </View>

      <View style={styles.field}>
        <Text style={[styles.prefix, { color: st.input ? theme.colors.text : theme.colors.muted }]}>@</Text>
        <TextInput
          ref={inputRef}
          value={st.input}
          onChangeText={st.setInput}
          placeholder="username"
          placeholderTextColor={theme.colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          maxLength={20}
          returnKeyType="done"
          onSubmitEditing={onSave}
          style={styles.input}
        />
        {st.status === 'available' && (
          <ExpoImage source={require('../../assets/icons/CheckIcon.svg')} style={styles.badge} tintColor={theme.colors.success} contentFit="contain" />
        )}
        {(st.status === 'taken' || st.status === 'reserved') && (
          <ExpoImage source={require('../../assets/icons/AlertIcon.svg')} style={styles.badge} tintColor={theme.colors.danger} contentFit="contain" />
        )}
      </View>

      {st.formatError ? (
        <Text style={styles.helperError} color={theme.colors.danger}>
          {st.formatError}
        </Text>
      ) : st.status === 'reserved' ? (
        // Free in Standard, but matches a notable X account — only its verified
        // owner may claim it, via the X login below.
        <>
          <Text style={styles.helperError} color={theme.colors.danger}>
            Username is not available.
          </Text>
          <Text style={styles.helperHint} color={theme.colors.muted}>
            If this is your X username,{' '}
            <Text style={styles.helperHintBold} color={theme.colors.text} onPress={onClaimX}>
              log into X
            </Text>{' '}
            to claim your username.
          </Text>
        </>
      ) : st.status === 'taken' ? (
        <Text style={styles.helperError} color={theme.colors.danger}>
          Username is not available.
        </Text>
      ) : st.status === 'available' ? (
        <Text style={styles.helperOk} color={theme.colors.success}>
          Username is available.
        </Text>
      ) : null}

      <View style={styles.spacer} />
      <PressableScale style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]} disabled={!canSave} onPress={onSave}>
        <Text style={styles.saveLabel} color={theme.colors.primaryLabel}>
          Save
        </Text>
      </PressableScale>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground, paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.md },
  header: { paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.md },
  title: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text },
  // Handle field — grey box, standard 12y/18x padding.
  field: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: theme.colors.cardBackground, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18 },
  prefix: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
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
