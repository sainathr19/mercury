import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  interpolateColor,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { UnistylesRuntime } from 'react-native-unistyles';
import type { ChartSample } from '../bridge/chart';

const COLUMNS = 46;
const ROWS = 26;
const DOT_RATIO = 12 / 16;

export interface PixelChartProps {
  samples: ChartSample[];
  activeColor: string;
  onTouched?: (s: ChartSample | null) => void;
}

/** Per-column vertical range in row units; NaN top = empty column. */
function columnRanges(samples: ChartSample[]): { top: number; bot: number }[] {
  const empty = () => Array.from({ length: COLUMNS }, () => ({ top: NaN, bot: NaN }));
  if (samples.length < 2) return empty();
  const values = samples.map((s) => s.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const vRange = maxV - minV;
  const minT = samples[0].timestamp;
  const maxT = samples[samples.length - 1].timestamp;
  const tRange = Math.max(1, maxT - minT);
  const mid = (ROWS - 1) / 2;

  const byCol: number[][] = Array.from({ length: COLUMNS }, () => []);
  for (const s of samples) {
    const frac = (s.timestamp - minT) / tRange;
    const col = Math.min(COLUMNS - 1, Math.max(0, Math.floor(frac * COLUMNS)));
    byCol[col].push(s.value);
  }

  const out = empty();
  let last: { top: number; bot: number } | null = null;
  for (let col = 0; col < COLUMNS; col++) {
    const inCol = byCol[col];
    if (inCol.length) {
      const mn = Math.min(...inCol);
      const mx = Math.max(...inCol);
      const range =
        vRange > 0
          ? { top: (1 - (mx - minV) / vRange) * (ROWS - 1), bot: (1 - (mn - minV) / vRange) * (ROWS - 1) }
          : { top: mid, bot: mid };
      out[col] = range;
      last = range;
    } else if (last) {
      out[col] = { ...last };
    }
  }
  // Pass 2: bridge vertical gaps between adjacent columns so the line is continuous.
  for (let col = 1; col < COLUMNS; col++) {
    const prev = out[col - 1];
    const curr = out[col];
    if (Number.isNaN(prev.top) || Number.isNaN(curr.top)) continue;
    const top = Math.min(curr.top, prev.bot);
    const bot = Math.max(curr.bot, prev.top);
    if (top < curr.top || bot > curr.bot) out[col] = { top, bot };
  }
  return out;
}

const MID = (ROWS - 1) / 2;

/** Flat midline of dots, shown while real data is still loading so the chart is
 *  never blank — the real samples then morph (dot by dot) out of this baseline
 *  instead of popping in. */
function placeholderRanges(): { top: number; bot: number }[] {
  return Array.from({ length: COLUMNS }, () => ({ top: MID, bot: MID }));
}

function interp(a: number, b: number, t: number): number {
  const aNil = a === undefined || Number.isNaN(a);
  const bNil = b === undefined || Number.isNaN(b);
  if (aNil && bNil) return NaN;
  if (aNil) return t > 0 ? b : NaN;
  if (bNil) return t < 1 ? a : NaN;
  return a * (1 - t) + b * t;
}

/** Animated dot-matrix price chart (ports the iOS PixelChart): springs between
 *  ranges, dims dots after the touched column, and reports the scrubbed sample. */
export function PixelChart({ samples, activeColor, onTouched }: PixelChartProps) {
  const theme = UnistylesRuntime.getTheme();
  const inactiveColor = theme.colors.chartDotInactive;
  const dimColor = theme.colors.muted;

  const W = useSharedValue(0);
  const H = useSharedValue(0);
  const progress = useSharedValue(1);
  const touched = useSharedValue(-1);
  const fromTop = useSharedValue<number[]>([]);
  const fromBot = useSharedValue<number[]>([]);
  const toTop = useSharedValue<number[]>([]);
  const toBot = useSharedValue<number[]>([]);
  // Line color endpoints, crossfaded over `progress` alongside the shape morph
  // (mirrors iOS PixelChart.lerpColor on a green↔red trend flip).
  const fromColorV = useSharedValue(activeColor);
  const toColorV = useSharedValue(activeColor);

  // Real ranges when we have data, else a flat placeholder so the chart always
  // renders something and the first real dataset morphs out of the baseline.
  const targetCols = useMemo(() => {
    const real = columnRanges(samples);
    return real.some((c) => !Number.isNaN(c.top)) ? real : placeholderRanges();
  }, [samples]);

  useEffect(() => {
    const newTop = targetCols.map((c) => c.top);
    const newBot = targetCols.map((c) => c.bot);
    const t = progress.value;
    const ft = fromTop.value;
    const fb = fromBot.value;
    const tt = toTop.value;
    const tb = toBot.value;
    if (ft.length && tt.length) {
      fromTop.value = ft.map((v, i) => interp(v, tt[i], t));
      fromBot.value = fb.map((v, i) => interp(v, tb[i], t));
    } else {
      fromTop.value = newTop;
      fromBot.value = newBot;
    }
    toTop.value = newTop;
    toBot.value = newBot;
    // Snapshot the currently-displayed interpolated color as the new start, then
    // crossfade to the latest active color over the same spring.
    fromColorV.value = interpolateColor(t, [0, 1], [fromColorV.value, toColorV.value]);
    toColorV.value = activeColor;
    // Snap to 0 then spring to 1 as ONE animation — a plain `progress.value = 0`
    // followed by `= withSpring(1)` in the same tick gets coalesced (the reset is
    // dropped, so the spring runs 1→1 and the morph never plays). withSequence
    // guarantees the restart, so the dots actually travel from old → new.
    // iOS PixelChart spring(response: 0.5, dampingFraction: 0.95) → physical params:
    // stiffness = (2π/response)², damping = 4π·ζ/response.
    progress.value = withSequence(
      withTiming(0, { duration: 0 }),
      withSpring(1, { mass: 1, stiffness: 157.9, damping: 23.9 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetCols, activeColor]);

  // Active line color, interpolated from the morph start color to the current one.
  const activeColorV = useDerivedValue(() =>
    interpolateColor(progress.value, [0, 1], [fromColorV.value, toColorV.value]),
  );

  // Full inactive dot grid. Depends only on layout (W/H), so this big path is
  // built once on layout — NOT rebuilt every animation frame. Active dots are
  // drawn on top of it, covering the grid dot at active cells.
  const gridPath = useDerivedValue(() => {
    'worklet';
    const path = Skia.Path.Make();
    const w = W.value;
    const h = H.value;
    if (w === 0 || h === 0) return path;
    const cellW = w / COLUMNS;
    const cellH = h / ROWS;
    const dot = Math.min(cellW, cellH) * DOT_RATIO;
    const inactiveR = Math.max(0, dot - 2) / 2;
    for (let col = 0; col < COLUMNS; col++) {
      for (let row = 0; row < ROWS; row++) {
        path.addCircle((col + 0.5) * cellW, (row + 0.5) * cellH, inactiveR);
      }
    }
    return path;
  });

  // Active dots (≤ touched column), rebuilt every frame as the morph runs. The
  // shared-value reads (progress / fromTop / ...) are INLINE on purpose:
  // Reanimated detects a derived value's dependencies from the worklet's OWN
  // closure, so reads hidden inside a helper function are never registered and the
  // path would not recompute as `progress` animates — that is what made the chart
  // snap instantly. Inline, `progress` is a tracked input and the dots travel
  // frame by frame. Only the active rows of each column are iterated (the line
  // band), so this is cheap despite running per frame.
  const activePath = useDerivedValue(() => {
    'worklet';
    const path = Skia.Path.Make();
    const w = W.value;
    const h = H.value;
    if (w === 0 || h === 0) return path;
    const cellW = w / COLUMNS;
    const cellH = h / ROWS;
    const activeR = (Math.min(cellW, cellH) * DOT_RATIO) / 2;
    const t = progress.value;
    const ct = t < 0 ? 0 : t > 1 ? 1 : t;
    const ft = fromTop.value;
    const fb = fromBot.value;
    const tt = toTop.value;
    const tb = toBot.value;
    const touchCol = touched.value;
    for (let col = 0; col < COLUMNS; col++) {
      if (touchCol >= 0 && col > touchCol) continue;
      const f0 = ft[col];
      const t0 = tt[col];
      const fNil = f0 === undefined || Number.isNaN(f0);
      const tNil = t0 === undefined || Number.isNaN(t0);
      let top = 0;
      let bot = 0;
      let exists = false;
      if (!fNil && tNil) {
        exists = ct < 1;
        top = f0;
        bot = fb[col];
      } else if (fNil && !tNil) {
        exists = ct > 0;
        top = t0;
        bot = tb[col];
      } else if (!fNil && !tNil) {
        exists = true;
        top = f0 * (1 - t) + t0 * t;
        bot = fb[col] * (1 - t) + tb[col] * t;
      }
      if (!exists) continue;
      const cx = (col + 0.5) * cellW;
      let topR = Math.round(top);
      let botR = Math.round(bot);
      if (topR < 0) topR = 0;
      if (botR > ROWS - 1) botR = ROWS - 1;
      for (let row = topR; row <= botR; row++) {
        path.addCircle(cx, (row + 0.5) * cellH, activeR);
      }
    }
    return path;
  });

  // Dim dots (after the touched column while scrubbing). Same inline-reads rule.
  const dimPath = useDerivedValue(() => {
    'worklet';
    const path = Skia.Path.Make();
    const touchCol = touched.value;
    if (touchCol < 0) return path; // nothing dimmed unless the user is scrubbing
    const w = W.value;
    const h = H.value;
    if (w === 0 || h === 0) return path;
    const cellW = w / COLUMNS;
    const cellH = h / ROWS;
    const activeR = (Math.min(cellW, cellH) * DOT_RATIO) / 2;
    const t = progress.value;
    const ct = t < 0 ? 0 : t > 1 ? 1 : t;
    const ft = fromTop.value;
    const fb = fromBot.value;
    const tt = toTop.value;
    const tb = toBot.value;
    for (let col = touchCol + 1; col < COLUMNS; col++) {
      const f0 = ft[col];
      const t0 = tt[col];
      const fNil = f0 === undefined || Number.isNaN(f0);
      const tNil = t0 === undefined || Number.isNaN(t0);
      let top = 0;
      let bot = 0;
      let exists = false;
      if (!fNil && tNil) {
        exists = ct < 1;
        top = f0;
        bot = fb[col];
      } else if (fNil && !tNil) {
        exists = ct > 0;
        top = t0;
        bot = tb[col];
      } else if (!fNil && !tNil) {
        exists = true;
        top = f0 * (1 - t) + t0 * t;
        bot = fb[col] * (1 - t) + tb[col] * t;
      }
      if (!exists) continue;
      const cx = (col + 0.5) * cellW;
      let topR = Math.round(top);
      let botR = Math.round(bot);
      if (topR < 0) topR = 0;
      if (botR > ROWS - 1) botR = ROWS - 1;
      for (let row = topR; row <= botR; row++) {
        path.addCircle(cx, (row + 0.5) * cellH, activeR);
      }
    }
    return path;
  });

  function nearest(col: number): ChartSample | null {
    if (samples.length < 2) return samples[0] ?? null;
    const minT = samples[0].timestamp;
    const maxT = samples[samples.length - 1].timestamp;
    const target = minT + ((col + 0.5) / COLUMNS) * (maxT - minT);
    let best = samples[0];
    for (const s of samples) if (Math.abs(s.timestamp - target) < Math.abs(best.timestamp - target)) best = s;
    return best;
  }
  function report(col: number | null) {
    onTouched?.(col == null ? null : nearest(col));
  }

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      const col = Math.max(0, Math.min(COLUMNS - 1, Math.floor(e.x / (W.value / COLUMNS))));
      touched.value = col;
      runOnJS(report)(col);
    })
    .onChange((e) => {
      const col = Math.max(0, Math.min(COLUMNS - 1, Math.floor(e.x / (W.value / COLUMNS))));
      if (col !== touched.value) {
        touched.value = col;
        runOnJS(report)(col);
      }
    })
    .onFinalize(() => {
      touched.value = -1;
      runOnJS(report)(null);
    });

  return (
    <GestureDetector gesture={pan}>
      <View
        style={{ width: '100%', aspectRatio: COLUMNS / ROWS }}
        onLayout={(e) => {
          W.value = e.nativeEvent.layout.width;
          H.value = e.nativeEvent.layout.height;
        }}
      >
        <Canvas style={{ flex: 1 }}>
          <Path path={gridPath} color={inactiveColor} />
          <Path path={dimPath} color={dimColor} />
          <Path path={activePath} color={activeColorV} />
        </Canvas>
      </View>
    </GestureDetector>
  );
}
