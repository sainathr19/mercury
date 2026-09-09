// Price history as a smooth area — a filled curve under a stroked line, with a
// dashed line at the period's opening price and a draggable readout.
//
// Replaces the dotted matrix chart. That drawing quantised every sample into a
// 46x26 grid of dots, which looks deliberate at a glance but throws away the
// shape of the move: a spike and a slow climb of the same magnitude drew the
// same column of dots. A curve keeps the shape, and the fill under it makes the
// direction readable without reading the axis.
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  LinearGradient,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import type { ChartSample } from '../bridge/chart';

const HEIGHT = 168;
/** Room for the stroke's cap and the readout dot at the extremes. */
const PAD_Y = 14;

export interface AreaChartProps {
  samples: ChartSample[];
  /** Line + fill colour; the caller decides up/down. */
  activeColor: string;
  width: number;
  onTouched?: (s: ChartSample | null) => void;
}

interface Geometry {
  /** Sample index -> pixel position. */
  points: { x: number; y: number }[];
  line: string;
  area: string;
  /** y of the first sample, for the opening-price guide. */
  openY: number;
}

/**
 * Catmull-Rom through the samples, emitted as cubic beziers.
 *
 * A polyline reads as jagged at this size and a plain quadratic smooth
 * overshoots at reversals; Catmull-Rom passes through every sample, so the
 * curve cannot claim a high the data does not have.
 */
function build(samples: ChartSample[], width: number): Geometry | null {
  if (samples.length < 2 || width <= 0) return null;
  const values = samples.map((s) => s.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const h = HEIGHT - PAD_Y * 2;

  const points = samples.map((s, i) => ({
    x: (i / (samples.length - 1)) * width,
    // A flat series sits on the middle line rather than pinned to the top.
    y: PAD_Y + (span === 0 ? h / 2 : (1 - (s.value - min) / span) * h),
  }));

  let line = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    line += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }

  // The fill is the same curve, closed down the sides to the baseline.
  const area = `${line} L ${width} ${HEIGHT} L 0 ${HEIGHT} Z`;
  return { points, line, area, openY: points[0].y };
}

export function AreaChart({ samples, activeColor, width, onTouched }: AreaChartProps) {
  const theme = UnistylesRuntime.getTheme();
  const geo = useMemo(() => build(samples, width), [samples, width]);

  // -1 = not touching. Shared so the guide follows the finger on the UI thread.
  const touchX = useSharedValue(-1);
  const fade = useSharedValue(0);

  // Report the touched sample up, so the screen's headline figure can track it.
  useEffect(() => {
    if (!onTouched) return;
    onTouched(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples]);

  const nearest = (x: number): number => {
    'worklet';
    if (!geo) return -1;
    const i = Math.round((x / width) * (samples.length - 1));
    return Math.min(samples.length - 1, Math.max(0, i));
  };

  const report = (i: number) => {
    onTouched?.(i < 0 ? null : (samples[i] ?? null));
  };

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(0)
        .onBegin((e) => {
          touchX.value = e.x;
          fade.value = withTiming(1, { duration: 120 });
          runOnJS(report)(nearest(e.x));
        })
        .onUpdate((e) => {
          touchX.value = e.x;
          runOnJS(report)(nearest(e.x));
        })
        .onFinalize(() => {
          touchX.value = -1;
          fade.value = withTiming(0, { duration: 160 });
          runOnJS(report)(-1);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [samples, width, geo],
  );

  // Guide + dot positions, derived on the UI thread from the finger.
  const guideX = useDerivedValue(() => (touchX.value < 0 ? 0 : touchX.value));
  const dotY = useDerivedValue(() => {
    if (!geo || touchX.value < 0) return 0;
    const t = (touchX.value / width) * (geo.points.length - 1);
    const i = Math.min(geo.points.length - 1, Math.max(0, Math.floor(t)));
    const j = Math.min(geo.points.length - 1, i + 1);
    const f = t - i;
    return geo.points[i].y + (geo.points[j].y - geo.points[i].y) * f;
  });
  const guideOpacity = useDerivedValue(() => fade.value);
  // The guide is drawn once at x=0 and MOVED, rather than rebuilt per frame.
  const guideShift = useDerivedValue(() => [{ translateX: touchX.value < 0 ? 0 : touchX.value }]);

  if (!geo) {
    // No data yet: a flat rule where the curve will be, so the block does not
    // collapse and then push everything below it down when samples arrive.
    return (
      <View style={[styles.wrap, { width }]}>
        <View style={styles.placeholder} />
      </View>
    );
  }

  const linePath = Skia.Path.MakeFromSVGString(geo.line)!;
  const areaPath = Skia.Path.MakeFromSVGString(geo.area)!;

  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.wrap, { width }]}>
        <Canvas style={{ width, height: HEIGHT }}>
          {/* Fill first, then the stroke over it. */}
          <Path path={areaPath}>
            <LinearGradient
              start={vec(0, PAD_Y)}
              end={vec(0, HEIGHT)}
              colors={[`${activeColor}45`, `${activeColor}00`]}
            />
          </Path>
          <Path path={linePath} style="stroke" strokeWidth={2.5} strokeCap="round" strokeJoin="round" color={activeColor} />

          {/* Where the period opened. Everything above this line is a gain. */}
          <Group opacity={0.5}>
            <Path
              path={Skia.Path.MakeFromSVGString(`M 0 ${geo.openY} L ${width} ${geo.openY}`)!}
              style="stroke"
              strokeWidth={1}
              color={theme.colors.faint}
            >
              <DashPathEffect intervals={[3, 5]} />
            </Path>
          </Group>

          {/* Readout: a vertical guide and a dot riding the curve. */}
          <Group opacity={guideOpacity}>
            <Path
              path={Skia.Path.MakeFromSVGString(`M 0 0 L 0 ${HEIGHT}`)!}
              style="stroke"
              strokeWidth={1}
              color={theme.colors.faint}
              transform={guideShift}
            />
            <Circle cx={guideX} cy={dotY} r={5.5} color={activeColor} />
            <Circle cx={guideX} cy={dotY} r={2.5} color="#FFFFFF" />
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { height: HEIGHT, justifyContent: 'center' },
  placeholder: {
    height: 1,
    marginVertical: HEIGHT / 2,
    backgroundColor: theme.colors.separator,
  },
}));
