import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, SheetScaffold, Text, type IconName } from '../../src/ui';
import { useSettings, AUTO_LOCK_OPTIONS, CURRENCY_OPTIONS } from '../../src/stores/settingsStore';
import { fontFamily } from '../../src/theme/fonts';

type Kind = 'autolock' | 'currency' | 'appearance';

interface Option {
  key: string;
  label: string;
  /** Second line, when the option needs explaining rather than just naming. */
  hint?: string;
  /** Set in the leading tile: either a typographic glyph (a currency symbol) or
   *  an icon. Exactly one of the two. */
  glyph?: string;
  icon?: IconName;
}

/**
 * Single-select picker, presented as a native form sheet (Auto-lock, Display
 * currency, Appearance). Reads and writes the settings store directly, so no
 * callback has to cross the route boundary.
 *
 * Every option gets a leading tile and, where the label alone is not enough, a
 * line saying what choosing it actually does — a bare list of durations does not
 * tell you what auto-lock is for.
 */
export default function SettingsPicker() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const { kind } = useLocalSearchParams<{ kind: Kind }>();
  const s = useSettings();

  const cfg: { title: string; subtitle: string; options: Option[]; selected: string; set: (k: string) => void } =
    kind === 'autolock'
      ? {
          title: 'Auto-lock',
          subtitle: 'How long Mercury waits before asking for Face ID again.',
          // An icon, not a glyph: there is no character that means "5 minutes",
          // and an SF Symbol codepoint would not render in the app's typeface.
          options: AUTO_LOCK_OPTIONS.map((o) => ({ key: o.key, label: o.label, icon: 'clock' as IconName })),
          selected: s.autoLock as string,
          set: (k) => s.setAutoLock(k as typeof s.autoLock),
        }
      : kind === 'appearance'
        ? {
            title: 'Appearance',
            subtitle: 'Mercury is designed light. Dark is available if you prefer it.',
            options: [
              { key: 'light', label: 'Light', hint: 'The default, and what the app was designed against', icon: 'eye' },
              { key: 'dark', label: 'Dark', hint: 'Inverted surfaces throughout', icon: 'moon' },
            ],
            selected: s.appearance as string,
            set: (k) => s.setAppearance(k as typeof s.appearance),
          }
        : {
            title: 'Display currency',
            subtitle: 'Balances and history are converted for display only. Your money never changes.',
            options: CURRENCY_OPTIONS.map((o) => {
              // "USD – US Dollar" arrives as one string; split it so the code
              // and the name can sit on their own lines.
              const [code, ...rest] = o.label.split('–');
              return {
                key: o.key,
                label: code.trim(),
                hint: rest.join('–').trim(),
                glyph: o.symbol,
              };
            }),
            selected: s.currency as string,
            set: (k) => s.setCurrency(k as typeof s.currency),
          };

  return (
    <SheetScaffold title={cfg.title} subtitle={cfg.subtitle} onClose={() => router.back()} scroll={false}>
      <View style={styles.card}>
        {cfg.options.map((o, i) => {
          const on = cfg.selected === o.key;
          return (
            <Pressable
              key={o.key}
              style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && styles.pressed]}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                cfg.set(o.key);
                router.back();
              }}
            >
              <View style={[styles.tile, on && styles.tileOn]}>
                {o.icon ? (
                  <Icon name={o.icon} size={15} color={on ? '#ECEEE9' : theme.colors.text} />
                ) : (
                  <Text style={[styles.glyph, on && styles.glyphOn]}>{o.glyph}</Text>
                )}
              </View>
              <View style={styles.mid}>
                <Text style={styles.label}>{o.label}</Text>
                {!!o.hint && <Text style={styles.hint}>{o.hint}</Text>}
              </View>
              {on && <Icon name="check" size={16} color={theme.colors.text} />}
            </Pressable>
          );
        })}
      </View>
    </SheetScaffold>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 14, paddingVertical: 14 },
  divider: { borderTopWidth: 1, borderTopColor: 'rgba(11,13,16,0.06)' },
  pressed: { backgroundColor: 'rgba(11,13,16,0.03)' },
  // The selected option's tile inverts, so the choice is legible from the tile
  // alone and not only from the check at the far edge.
  tile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#ECEEE9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileOn: { backgroundColor: '#0B0D10' },
  glyph: { fontFamily: fontFamily.semibold, fontSize: 15, color: theme.colors.text },
  glyphOn: { color: '#ECEEE9' },
  mid: { flex: 1, gap: 3 },
  label: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.28, color: theme.colors.text },
  hint: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },
}));
