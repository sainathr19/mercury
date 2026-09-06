import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { CryptoIcon } from './CryptoIcon';

// Shared "Your Assets" collapse/expand motion, used by BOTH the normal Home
// dashboard and the private (stealth) dashboard so the two feel identical.

// One shared spring for the drawer height + chevron. dampingRatio 1 = critically
// damped → smooth ease-out, no wiggle (matches iOS disclosure motion).
export const ASSETS_SPRING = { duration: 340, dampingRatio: 1 } as const;

const CLUSTER_RING = 24;
const CLUSTER_OVERLAP = 8;
const CLUSTER_STAGGER = 45;
const CLUSTER_SLIDE = 10;
// Gentle iOS-style spring: settles quickly with a barely-there overshoot.
const CLUSTER_SPRING = { damping: 18, stiffness: 170, mass: 0.9 } as const;

/** Collapsible drawer for the asset rows. Measures the natural content height
 *  once and animates height + opacity from that value, so opening and closing
 *  use the exact same motion. Rows stay mounted; only the clipping wrapper
 *  animates. Starts at the resting value so a fresh mount doesn't spring open. */
export function AssetDrawer({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  const [contentH, setContentH] = useState(0);
  const progress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    progress.value = withSpring(expanded ? 1 : 0, ASSETS_SPRING);
  }, [expanded, progress]);
  const style = useAnimatedStyle(() => ({
    height: contentH * progress.value,
    opacity: progress.value,
  }));
  return (
    <Animated.View style={[styles.drawer, contentH ? style : undefined]}>
      <View
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0 && h !== contentH) setContentH(h);
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

/** Overlapping coin icons in the collapsed header. Each ring fades independently
 *  with a staggered delay as the section opens/closes (pure opacity crossfade +
 *  slide), and the container width collapses to keep the chevron snug. */
export function AssetCluster({
  assets,
  expanded,
}: {
  assets: { id: string; coingeckoId: string; symbol: string; colorHex: string }[];
  expanded: boolean;
}) {
  // Collapse duplicate tokens (same icon across chains) to one ring.
  const unique = assets.filter((a, i) => assets.findIndex((b) => b.coingeckoId === a.coingeckoId) === i);
  const shown = unique.slice(0, 3);
  const fullWidth = shown.length ? CLUSTER_RING + (shown.length - 1) * (CLUSTER_RING - CLUSTER_OVERLAP) : 0;
  const totalStagger = Math.max(0, shown.length - 1) * CLUSTER_STAGGER;
  const w = useDerivedValue(() =>
    withDelay(expanded ? totalStagger : 0, withSpring(expanded ? 0 : 1, CLUSTER_SPRING)),
  );
  const style = useAnimatedStyle(() => ({ width: interpolate(w.value, [0, 1], [0, fullWidth]) }));
  if (!shown.length) return null;
  return (
    <Animated.View style={[styles.cluster, style]}>
      {shown.map((a, i) => (
        <ClusterRing key={a.id} asset={a} index={i} count={shown.length} expanded={expanded} />
      ))}
    </Animated.View>
  );
}

function ClusterRing({
  asset,
  index,
  count,
  expanded,
}: {
  asset: { coingeckoId: string; symbol: string; colorHex: string };
  index: number;
  count: number;
  expanded: boolean;
}) {
  const delay = (expanded ? index : count - 1 - index) * CLUSTER_STAGGER;
  const p = useDerivedValue(() => withDelay(delay, withSpring(expanded ? 0 : 1, CLUSTER_SPRING)));
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateX: interpolate(p.value, [0, 1], [CLUSTER_SLIDE, 0]) },
      { scale: interpolate(p.value, [0, 1], [0.9, 1]) },
    ],
  }));
  return (
    <Animated.View style={[styles.clusterRing, { marginLeft: index === 0 ? 0 : -CLUSTER_OVERLAP, zIndex: count - index }, style]}>
      <CryptoIcon coingeckoId={asset.coingeckoId} symbol={asset.symbol} colorHex={asset.colorHex} size={20} />
    </Animated.View>
  );
}

/** UpIcon (^) shown when collapsed; rotates 180° to point down when open. */
export function RotatingChevron({ open }: { open: boolean }) {
  const theme = UnistylesRuntime.getTheme();
  const rot = useDerivedValue(() => withSpring(open ? 0 : 180, ASSETS_SPRING));
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <ExpoImage source={require('../../assets/icons/UpIcon.svg')} style={styles.disclosureIcon} tintColor={theme.colors.text} contentFit="contain" />
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  drawer: { overflow: 'hidden' },
  disclosureIcon: { width: 18, height: 18 },
  cluster: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', overflow: 'visible', height: CLUSTER_RING },
  clusterRing: {
    width: CLUSTER_RING,
    height: CLUSTER_RING,
    borderRadius: CLUSTER_RING / 2,
    borderWidth: 2,
    borderColor: theme.colors.cardBackground,
    backgroundColor: theme.colors.cardBackground,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
}));
