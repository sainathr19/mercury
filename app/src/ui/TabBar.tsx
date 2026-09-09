// Floating pill tab bar.
//
// The active item expands to reveal its label; the others stay icon-only. The
// label width is MEASURED (from an invisible copy) rather than estimated,
// because the font's advance widths vary enough that a guess leaves the lozenge
// either clipping the word or padded with dead space.
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  type DerivedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { useReducedTransitions } from '../lib/lowPower';

const ITEM_SPRING = { duration: 260, dampingRatio: 1 } as const;

export interface TabBarItem {
  key: string;
  label: string;
  icon: IconName;
}

export interface TabBarProps {
  items: TabBarItem[];
  activeKey: string;
  onSelect: (key: string) => void;
}

export function TabBar({ items, activeKey, onSelect }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedTransitions();

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
      <View style={styles.bar}>
        {items.map((item) => (
          <TabItem
            key={item.key}
            item={item}
            active={item.key === activeKey}
            reduced={reduced}
            onPress={() => {
              if (item.key !== activeKey) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onSelect(item.key);
            }}
          />
        ))}
      </View>
    </View>
  );
}

function TabItem({
  item,
  active,
  reduced,
  onPress,
}: {
  item: TabBarItem;
  active: boolean;
  reduced: boolean;
  onPress: () => void;
}) {
  const theme = UnistylesRuntime.getTheme();
  // Natural label width, measured once from an invisible copy laid out off-flow.
  const [labelW, setLabelW] = useState(0);

  const a: DerivedValue<number> = useDerivedValue(() =>
    reduced ? ((active ? 1 : 0) as number) : withSpring(active ? 1 : 0, ITEM_SPRING),
  );

  const lozengeStyle = useAnimatedStyle(() => ({ opacity: a.value }));

  // Width, not just opacity: the word has to actually occupy space, or the icons
  // never move apart and the lozenge overlaps its neighbour.
  const labelStyle = useAnimatedStyle(() => ({
    width: interpolate(a.value, [0, 1], [0, labelW]),
    opacity: interpolate(a.value, [0, 1], [0, 1]),
  }));

  // Inactive items sit back rather than changing hue.
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(a.value, [0, 1], [0.42, 1]),
  }));

  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.item}>
      <Animated.View style={[styles.lozenge, lozengeStyle]} pointerEvents="none" />
      <Animated.View style={[styles.itemContent, contentStyle]}>
        <Icon name={item.icon} size={20} color={theme.colors.text} />
        <Animated.View style={[styles.labelClip, labelStyle]}>
          <Text variant="captionSemibold" style={styles.label} numberOfLines={1}>
            {item.label}
          </Text>
        </Animated.View>
      </Animated.View>
      {/* Invisible measuring copy: same type styles, never shown, no hit area.
          `onTextLayout` reports the laid-out LINE width, which is the glyphs'
          natural width. `onLayout` would report the view's width instead, and an
          absolutely-positioned view is measured against its parent — an
          icon-only pill at that moment — so the word came back pre-truncated. */}
      {labelW === 0 && (
        <View style={styles.measure} pointerEvents="none">
          <Text
            variant="captionSemibold"
            onTextLayout={(e) => {
              const w = e.nativeEvent.lines[0]?.width ?? 0;
              // +8 matches the icon->word gap applied by `label`'s paddingLeft,
              // and rounding up avoids a sub-pixel width clipping the last glyph.
              if (w > 0) setLabelW(Math.ceil(w) + 8);
            }}
          >
            {item.label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    padding: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    // Lifted off the content so the bar reads as floating rather than docked.
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  item: { alignItems: 'center', justifyContent: 'center', height: 44, paddingHorizontal: 14 },
  itemContent: { flexDirection: 'row', alignItems: 'center' },
  lozenge: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(11,13,16,0.07)',
  },
  labelClip: { overflow: 'hidden', alignItems: 'flex-start' },
  label: { paddingLeft: 8 },
  measure: { position: 'absolute', opacity: 0, left: -9999, width: 400, alignItems: 'flex-start' },
}));
