import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, Text, type IconName } from '../../src/ui';
import { useMercuryName } from '../../src/stores/mercuryNameStore';
import { fontFamily } from '../../src/theme/fonts';

const PARENT = 'mercurywallet.eth';

/** What the name buys you. Rewritten to say what it DOES rather than what it is
 *  — "a real ENS name" means nothing to someone who has not met ENS. */
const BENEFITS: { icon: IconName; title: string; sub: string }[] = [
  {
    icon: 'name',
    title: 'People pay the name, not the address',
    sub: 'No 42 characters to read out, and nothing to mistype.',
  },
  {
    icon: 'globe',
    title: 'Works outside Mercury',
    sub: 'Any wallet or explorer that speaks ENS can find you by it.',
  },
  {
    icon: 'key',
    title: 'Only your key can claim it',
    sub: 'No account, no email, no sign-in. Your wallet signs for itself.',
  },
];

/**
 * The Mercury name.
 *
 * The name is presented as a card rather than a text field, because it is the
 * thing you hand to someone — the same object whether it is claimed or not. When
 * unclaimed the card is shown greyed with a placeholder, so the reward is
 * visible before the work.
 */
export default function Username() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const handle = useMercuryName((s) => s.name);
  const claimed = !!handle;

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <View style={styles.body}>
        <View style={styles.heading}>
          <Text style={styles.title}>{claimed ? 'Your name' : 'Claim your name'}</Text>
          <Text style={styles.subtitle}>
            {claimed
              ? 'This is what people type to pay you. It resolves to every address this wallet holds.'
              : 'Pick a name once. It becomes the address people use to pay you, everywhere.'}
          </Text>
        </View>

        {/* The card. Dark and monospaced, so the name reads as an identifier you
            would write down rather than as a form value. */}
        <View style={[styles.card, !claimed && styles.cardEmpty]}>
          <View style={styles.cardTop}>
            <Icon name="mercury" size={18} color={claimed ? '#ECEEE9' : theme.colors.faint} />
            <View style={[styles.tag, !claimed && styles.tagEmpty]}>
              <Text style={[styles.tagText, !claimed && styles.tagTextEmpty]}>
                {claimed ? 'Active' : 'Not claimed'}
              </Text>
            </View>
          </View>

          <Text style={[styles.name, !claimed && styles.nameEmpty]} numberOfLines={2}>
            {claimed ? handle : 'yourname'}
            <Text style={[styles.nameParent, !claimed && styles.nameEmpty]}>.{PARENT}</Text>
          </Text>

          <View style={styles.cardMeta}>
            <Text style={[styles.metaText, !claimed && styles.metaEmpty]}>ENS · SEPOLIA</Text>
            <Text style={[styles.metaText, !claimed && styles.metaEmpty]}>YOURS TO KEEP</Text>
          </View>
        </View>

        {!claimed && (
          <View style={styles.benefits}>
            {BENEFITS.map((b) => (
              <View key={b.title} style={styles.benefit}>
                <View style={styles.tile}>
                  <Icon name={b.icon} size={15} color={theme.colors.text} />
                </View>
                <View style={styles.benefitMid}>
                  <Text style={styles.benefitTitle}>{b.title}</Text>
                  <Text style={styles.benefitSub}>{b.sub}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      <PressableScale
        style={styles.cta}
        onPress={() =>
          router.push(
            claimed
              ? { pathname: '/(app)/username-create', params: { mode: 'edit' } }
              : '/(app)/username-create',
          )
        }
      >
        <Text style={styles.ctaLabel}>{claimed ? 'Change name' : 'Choose a name'}</Text>
      </PressableScale>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground, paddingHorizontal: theme.spacing.screen },

  body: { flex: 1, gap: 20, paddingTop: 4 },
  heading: { gap: 6 },
  title: { fontFamily: fontFamily.semibold, fontSize: 26, letterSpacing: -0.9, color: theme.colors.text },
  subtitle: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.24,
    color: theme.colors.muted,
  },

  card: {
    backgroundColor: '#0B0D10',
    borderRadius: 22,
    padding: 18,
    gap: 16,
  },
  // Unclaimed: the same object, drained of colour. It is a preview, not a
  // disabled control.
  cardEmpty: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.08)',
    borderStyle: 'dashed',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tag: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(236,238,233,0.14)',
  },
  tagEmpty: { backgroundColor: '#ECEEE9' },
  tagText: {
    fontFamily: fontFamily.semibold,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: '#ECEEE9',
  },
  tagTextEmpty: { color: theme.colors.muted },

  // Monospaced, and the parent domain steps back — the label the user chose is
  // the part that matters, the suffix is fixed.
  name: { fontFamily: fontFamily.monoRegular, fontSize: 20, lineHeight: 26, color: '#ECEEE9' },
  nameParent: { color: 'rgba(236,238,233,0.45)' },
  nameEmpty: { color: theme.colors.faint },

  cardMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  metaText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: 9.5,
    letterSpacing: 0.6,
    color: 'rgba(236,238,233,0.45)',
  },
  metaEmpty: { color: theme.colors.faint },

  benefits: { gap: 4 },
  benefit: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  tile: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitMid: { flex: 1, gap: 2 },
  benefitTitle: { fontFamily: fontFamily.semibold, fontSize: 14, letterSpacing: -0.24, color: theme.colors.text },
  benefitSub: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },

  cta: {
    height: 54,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  ctaLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 16,
    letterSpacing: -0.32,
    color: theme.colors.primaryLabel,
  },
}));
