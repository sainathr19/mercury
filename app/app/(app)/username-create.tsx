import { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, SheetScaffold, Text, useToast } from '../../src/ui';
import { useMercuryName } from '../../src/stores/mercuryNameStore';
import { NAME_PARENT, fullName } from '../../src/bridge/mercuryName';
import { fontFamily } from '../../src/theme/fonts';

/** Enough room for the placeholder before anything is typed. */
const MIN_INPUT_W = 96;

/** Create / edit the Mercury name — a real ENS subname, free, resolvable by any
 *  wallet or explorer. Live availability as you type; Claim signs with the wallet
 *  key and publishes the EVM, Solana and Bitcoin addresses together. */
export default function CreateUsername() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const st = useMercuryName();
  const inputRef = useRef<TextInput>(null);
  // The suffix has to sit immediately after what you type, not at the far edge —
  // "alice        .mercurywallet.eth" does not read as one name. TextInput has
  // no intrinsic width, so it is measured from its content and the field grows
  // with it.
  const [inputW, setInputW] = useState(0);
  const currentLabel = st.name ? st.name.replace(`.${NAME_PARENT}`, '') : null;
  const editing = mode === 'edit';

  useEffect(() => {
    st.begin();
    if (editing && currentLabel) st.setInput(currentLabel);
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

  // One line under the field, and only ever one: the format rule, the taken
  // reason, a failed check, or the confirmation. "Taken" and "could not check"
  // are kept apart on purpose — telling someone a name is taken because a
  // request timed out sends them off to pick a worse one.
  const status = st.formatError
    ? { tone: theme.colors.danger, text: st.formatError }
    : st.status === 'taken'
      ? { tone: theme.colors.danger, text: st.statusReason ?? 'That name is already taken.' }
      : st.status === 'unknown'
        ? { tone: theme.colors.muted, text: 'Could not check that name right now.' }
        : st.status === 'available'
          ? { tone: theme.colors.success, text: `${fullName(st.input)} is available.` }
          : { tone: theme.colors.muted, text: 'Letters, numbers and hyphens. 3–20 characters.' };

  return (
    <SheetScaffold
      title={editing ? 'Change your name' : 'Choose a name'}
      subtitle={`Your name lives under ${NAME_PARENT} and works in any wallet that reads ENS.`}
      onClose={() => router.back()}
      scroll={false}
      cta={{
        label: st.saving ? 'Claiming…' : editing ? 'Save name' : 'Claim name',
        onPress: onSave,
        disabled: !canSave,
        busy: st.saving,
      }}
    >
      {/* The suffix sits inside the field, so what you are typing reads as part
          of the finished name rather than as a bare word. */}
      <View style={styles.field}>
        <TextInput
          ref={inputRef}
          value={st.input}
          onChangeText={st.setInput}
          placeholder="yourname"
          placeholderTextColor={theme.colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          maxLength={30}
          returnKeyType="done"
          onSubmitEditing={onSave}
          onContentSizeChange={(e) => setInputW(e.nativeEvent.contentSize.width)}
          style={[styles.input, { width: Math.max(MIN_INPUT_W, Math.ceil(inputW) + 2) }]}
        />
        <Text style={styles.suffix} numberOfLines={1}>
          .{NAME_PARENT}
        </Text>
        <View style={styles.grow} />
        {st.checking && <View style={styles.dotChecking} />}
        {st.status === 'available' && <Icon name="check" size={17} color={theme.colors.success} />}
        {st.status === 'taken' && <Icon name="warning" size={17} color={theme.colors.danger} />}
      </View>

      <Text style={[styles.status, { color: status.tone }]}>{status.text}</Text>

      <View style={styles.note}>
        <Icon name="info" size={14} color={theme.colors.muted} />
        <Text style={styles.noteText}>
          Claiming writes the name on-chain and cannot be undone. The name is yours, not Mercury's.
        </Text>
      </View>
    </SheetScaffold>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Clears the sheet's grabber, and gives the close control a row of its own so
  // it can never sit on top of the subtitle.
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10 },
  grabSpace: { width: 1, height: 1 },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  heading: { gap: 6 },
  title: { fontFamily: fontFamily.semibold, fontSize: 26, letterSpacing: -0.9, color: theme.colors.text },
  subtitle: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.24,
    color: theme.colors.muted,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    // No gap: the label and its suffix are one string, visually.
    gap: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  // Monospaced: a name is an identifier, and it lines up with how the claimed
  // name is shown on the Username screen's card.
  input: {
    padding: 0,
    fontFamily: fontFamily.monoRegular,
    fontSize: 16,
    color: theme.colors.text,
  },
  suffix: { flexShrink: 1, fontFamily: fontFamily.monoRegular, fontSize: 16, color: theme.colors.faint },
  grow: { flex: 1, minWidth: 8 },
  dotChecking: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.faint },

  status: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.18,
    paddingHorizontal: 4,
  },

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 13,
    borderRadius: theme.radius.lg,
    backgroundColor: 'rgba(11,13,16,0.04)',
  },
  noteText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },
}));
