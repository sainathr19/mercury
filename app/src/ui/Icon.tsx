// Icon registry, backed by lucide.
//
// This used to be ~60 hand-inlined SVG paths: some copied out of the forked
// iOS app's Assets.xcassets as solid brand glyphs, the rest hand-drawn 24x24
// strokes. That mix is why a filled `send` arrow sat next to a hairline
// `chevron` and the two never looked like one family.
//
// Everything is a lucide icon now, so the whole set shares one grid, one stroke
// weight and one set of terminals. The public API is unchanged — `name`, `size`,
// `color` — so call sites did not move.
//
// NOTE: the package is `lucide-react-native`, not `lucide-react`. The latter
// emits DOM <svg> and renders nothing under React Native; this one draws through
// react-native-svg, which the app already depends on.
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { SymbolView } from 'expo-symbols';
import Svg, { Path } from 'react-native-svg';
import { MERCURY_MARK_PATH, MERCURY_MARK_VIEWBOX } from './mercury-mark';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  AtSign,
  Banknote,
  Bell,
  Bitcoin,
  BookOpen,
  ChartBar,
  ChartCandlestick,
  ChartLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleQuestionMark,
  Clock,
  Copy,
  Delete,
  DollarSign,
  Droplet,
  Ellipsis,
  Eye,
  EyeOff,
  FileText,
  Globe,
  Hand,
  Info,
  Key,
  LayoutGrid,
  Link,
  LogOut,
  Lock,
  Mail,
  Minus,
  Moon,
  Network,
  Plus,
  QrCode,
  RotateCw,
  ScanFace,
  ScanLine,
  ScanQrCode,
  Search,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  TrendingUp,
  TriangleAlert,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';

/**
 * Navigation chrome drawn from SF Symbols, so back and close are the EXACT
 * glyphs iOS uses rather than lookalikes. Apple's back affordance is a chevron,
 * not an arrow — the arrow we shipped before read as "undo".
 *
 * SF Symbols are iOS-only, so each falls back to its nearest lucide glyph on
 * Android; `SymbolView` renders nothing there, which would leave an invisible
 * button.
 */
const NATIVE_SYMBOLS = {
  back: { sf: 'chevron.backward', fallback: ChevronLeft },
  forward: { sf: 'chevron.forward', fallback: ChevronRight },
  close: { sf: 'xmark', fallback: X },
} as const;

type NativeName = keyof typeof NATIVE_SYMBOLS;

function NativeGlyph({ name, size, color }: { name: NativeName; size: number; color: string }): ReactNode {
  const def = NATIVE_SYMBOLS[name];
  if (Platform.OS !== 'ios') {
    const Fallback = def.fallback;
    return <Fallback size={size} color={color} strokeWidth={2.4} />;
  }
  return (
    <SymbolView
      name={def.sf}
      size={size}
      tintColor={color}
      // Semibold matches the weight iOS uses for navigation-bar chrome; the
      // default regular reads thin next to our type.
      weight="semibold"
      resizeMode="scaleAspectFit"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Mercury's mark, from the original artwork.
 *
 * See `mercury-mark.ts` for why this is a traced even-odd path rather than two
 * stroked ellipses: the interlacing at the crossings is the mark, and geometry
 * built from two ellipses cannot express an over/under.
 *
 * `fill` takes the icon tint like every other glyph in the set.
 */
function MercuryMark({ size, color }: { size: number; color: string }): ReactNode {
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${MERCURY_MARK_VIEWBOX} ${MERCURY_MARK_VIEWBOX}`}
    >
      <Path d={MERCURY_MARK_PATH} fill={color} fillRule="evenodd" />
    </Svg>
  );
}

/**
 * Name -> lucide component. The keys are the app's own vocabulary (`receive`,
 * `swapVert`, `faceid`) rather than lucide's, so screens keep reading in terms
 * of what an icon MEANS and the underlying glyph can be swapped without a
 * find-and-replace across the app.
 */
const ICONS = {
  // ── Money movement ────────────────────────────────────────────────────────
  send: Send,
  receive: ArrowDown,
  swap: ArrowLeftRight,
  swapVert: ArrowUpDown,
  cash: Banknote,
  investments: ChartCandlestick,
  dollarSign: DollarSign,
  bitcoinSign: Bitcoin,
  trendUp: TrendingUp,

  // ── Navigation / arrows ───────────────────────────────────────────────────
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  arrowUpRight: ArrowUpRight,
  arrowDownLeft: ArrowDownLeft,
  chevronUp: ChevronUp,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,

  // ── Actions ───────────────────────────────────────────────────────────────
  plus: Plus,
  minus: Minus,
  check: Check,
  checkCircle: CircleCheck,
  copy: Copy,
  reload: RotateCw,
  search: Search,
  ellipsis: Ellipsis,
  backspace: Delete,

  // ── Identity / security ───────────────────────────────────────────────────
  eye: Eye,
  eyeOff: EyeOff,
  faceid: ScanFace,
  lock: Lock,
  key: Key,
  shield: Shield,
  shieldCheck: ShieldCheck,
  name: AtSign,
  handRaised: Hand,

  // ── Objects / places ──────────────────────────────────────────────────────
  wallet: Wallet,
  globe: Globe,
  network: Network,
  clock: Clock,
  bell: Bell,
  mail: Mail,
  link: Link,
  logout: LogOut,
  moon: Moon,
  bolt: Zap,
  drop: Droplet,
  grid: LayoutGrid,
  settings: Settings,
  book: BookOpen,
  docText: FileText,
  chartLine: ChartLine,
  chartBar: ChartBar,

  // ── Scanning ──────────────────────────────────────────────────────────────
  scan: ScanLine,
  qrcode: QrCode,
  qrViewfinder: ScanQrCode,

  // ── Status ────────────────────────────────────────────────────────────────
  info: Info,
  warning: TriangleAlert,
  help: CircleQuestionMark,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS | keyof typeof NATIVE_SYMBOLS | 'mercury';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /**
   * Lucide's stroke weight. Its own default is 2, which reads heavy below ~16px
   * and thin above ~32, so callers at the extremes can tune it.
   */
  strokeWidth?: number;
}

export function Icon({ name, size = 24, color = '#000', strokeWidth = 2 }: IconProps) {
  if (name === 'mercury') return <MercuryMark size={size} color={color} />;
  if (name in NATIVE_SYMBOLS) return <NativeGlyph name={name as NativeName} size={size} color={color} />;
  const Glyph = ICONS[name as keyof typeof ICONS];
  return <Glyph size={size} color={color} strokeWidth={strokeWidth} />;
}
