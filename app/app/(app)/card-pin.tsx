import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, Text, useToast } from '../../src/ui';
import { fontFamily } from '../../src/theme/fonts';

const PIN_LENGTH = 6;
const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
] as const;

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

/** Card PIN setup — enter a 6-digit PIN, then confirm it. */
export default function CardPin() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);

  const [step, setStep] = useState<'set' | 'confirm'>('set');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');

  const value = step === 'set' ? pin : confirm;
  const setValue = step === 'set' ? setPin : setConfirm;

  function onKey(k: string) {
    if (k === '') return;
    if (k === 'del') {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (value.length >= PIN_LENGTH) return;
    tap();
    setValue((v) => v + k);
  }

  function onBack() {
    tap();
    if (step === 'confirm') {
      setStep('set');
      setConfirm('');
    } else {
      router.back();
    }
  }

  function onContinue() {
    if (value.length !== PIN_LENGTH) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step === 'set') {
      setStep('confirm');
      return;
    }
    if (confirm !== pin) {
      show('PINs don’t match. Try again.', 'error');
      setConfirm('');
      return;
    }
    // TODO: persist / write the PIN to the card. For now, confirm + leave.
    show('PIN set.', 'success');
    router.back();
  }

  const complete = value.length === PIN_LENGTH;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
        <ExpoImage source={require('../../assets/icons/arrowLeft.svg')} style={styles.backIcon} tintColor={theme.colors.text} contentFit="contain" />
      </Pressable>
      <Text style={styles.title}>{step === 'set' ? 'Set Pin' : 'Confirm Pin'}</Text>

      {/* PIN boxes */}
      <View style={styles.boxes}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => {
          const filled = i < value.length;
          const active = i === value.length;
          return (
            <View key={i} style={[styles.box, active && styles.boxActive]}>
              {filled ? <View style={styles.dot} /> : null}
            </View>
          );
        })}
      </View>

      <View style={styles.spacer} />

      {/* Keypad */}
      <View style={styles.pad}>
        {KEYS.map((row, ri) => (
          <View key={ri} style={styles.padRow}>
            {row.map((k, ci) => (
              <Pressable key={ci} style={styles.key} onPress={() => onKey(k)} disabled={k === ''}>
                {k === 'del' ? (
                  <Icon name="backspace" size={24} color={theme.colors.text} />
                ) : (
                  <Text style={styles.keyText}>{k}</Text>
                )}
              </Pressable>
            ))}
          </View>
        ))}
      </View>

      <PressableScale style={[styles.cta, complete && styles.ctaActive]} disabled={!complete} onPress={onContinue}>
        <Text style={styles.ctaLabel} color={theme.colors.primaryLabel}>Continue</Text>
      </PressableScale>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground, paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.md },
  back: { marginTop: theme.spacing.md, width: 30, height: 30 },
  backIcon: { width: 30, height: 30 },
  title: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text, marginTop: 24 },
  // Six PIN boxes; the next-to-fill box is outlined.
  boxes: { flexDirection: 'row', gap: 10, marginTop: 24 },
  box: { flex: 1, height: 64, borderRadius: 14, backgroundColor: theme.colors.cardBackground, alignItems: 'center', justifyContent: 'center' },
  boxActive: { borderWidth: 1.5, borderColor: '#9AA0A6', backgroundColor: theme.colors.appBackground },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.text },
  spacer: { flex: 1 },
  // Keypad — 1-9, blank, 0, delete.
  pad: { paddingVertical: theme.spacing.md },
  padRow: { flexDirection: 'row' },
  key: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 24, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.text },
  cta: { height: 52, borderRadius: theme.radius.pill, backgroundColor: 'rgba(6, 6, 6, 0.5)', alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.sm },
  ctaActive: { backgroundColor: '#060606' },
  ctaLabel: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3 },
}));
