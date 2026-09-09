// The action buttons that sit between the balance card and the transactions card.
//
// The band owns its own dark fill, and bleeds upward and downward by the card
// radius so the two light cards' rounded corners still reveal dark behind them.
//
// It used to rely on the PAGE being dark, with the band just a transparent gap.
// That looked identical at rest but meant the scroll view's own background was
// near-black, so bouncing at either end of the list flashed black instead of the
// card colour. The dark belongs to this strip, not to the page.
//
// Two shapes, matching the reference: labelled pills for the actions a user
// reads, and one circular accent button for the one they reach for by colour.
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

const PILL_BG = '#FFFFFF';
const PILL_FG = '#0B0D10';

/**
 * Tones for the circular buttons. Each is a pale ground with a deep glyph drawn
 * from the same hue, so they read as a set rather than as three unrelated
 * colours. Named here so the palette pass has one place to change them.
 */
const TONES = {
  mint: { bg: '#C7F0D2', fg: '#0B2A14' },
  lilac: { bg: '#D9DCFB', fg: '#1B1F4A' },
} as const;

export type AccentTone = keyof typeof TONES;

export interface Action {
  key: string;
  /** Always required. When `accent` hides it, it still labels the button for
   *  screen readers — a colour-only control is otherwise unnamed. */
  label: string;
  icon: IconName;
  onPress: () => void;
  /** Renders as a circular, icon-only button in this tone instead of a pill. */
  accent?: AccentTone;
}

export function ActionStrip({ actions }: { actions: Action[] }) {
  return (
    <View style={styles.band}>
      {/* A plain row, NOT a horizontal ScrollView. The pills have to end up the
          same width regardless of whether their labels do, and `flex: 1` only
          distributes space inside a container that has a width — which a
          horizontal scroll view does not. Each pill took its label's width. */}
      <View style={styles.row}>
        {actions.map((a) =>
          a.accent ? (
            <PressableScale
              key={a.key}
              onPress={a.onPress}
              style={[styles.circle, { backgroundColor: TONES[a.accent].bg }]}
              accessibilityLabel={a.label}
            >
              <Icon name={a.icon} size={20} color={TONES[a.accent].fg} />
            </PressableScale>
          ) : (
            <PressableScale key={a.key} onPress={a.onPress} style={styles.pill}>
              <Icon name={a.icon} size={17} color={PILL_FG} />
              <Text variant="bodyBold" style={styles.label}>
                {a.label}
              </Text>
            </PressableScale>
          ),
        )}
      </View>
    </View>
  );
}

const SIZE = 48;

/** Must match the wallet cards' corner radius, so the bleed covers exactly the
 *  area their rounded corners cut away and no more. */
const CARD_RADIUS = 30;

const styles = StyleSheet.create((theme) => ({
  band: {
    backgroundColor: '#141414',
    paddingVertical: 16,
    // Slide under both neighbours by their corner radius. The cards paint on
    // top (they carry a zIndex), so only their corner notches show this.
    marginTop: -CARD_RADIUS,
    paddingTop: 16 + CARD_RADIUS,
    marginBottom: -CARD_RADIUS,
    paddingBottom: 16 + CARD_RADIUS,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: theme.spacing.screen },
  // flex: 1 with a shared basis, so Send and Receive are always the same width
  // and the pair absorbs whatever the two circles leave over.
  pill: {
    flex: 1,
    flexBasis: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 12,
    height: SIZE,
    borderRadius: theme.radius.pill,
    backgroundColor: PILL_BG,
  },
  label: { color: PILL_FG },
  // A circle, not a pill: same height so the row shares one baseline, equal
  // width so it never reads as a pill whose label failed to load. The ground
  // colour comes from the action's tone.
  circle: {
    flexGrow: 0,
    flexShrink: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
