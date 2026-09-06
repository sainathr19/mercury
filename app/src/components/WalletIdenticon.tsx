import { useMemo } from 'react';
import Svg, { Circle, ClipPath, Defs, G, Rect } from 'react-native-svg';

/**
 * Deterministic monochromatic identicon for a wallet address — a faithful port
 * of the iOS `WalletIdenticon`. Generates a 5×5 vertically-symmetric pixel grid
 * clipped to a circle; background + cell brightness derive from the seed so the
 * same address always renders the same avatar.
 */
function paletteFor(seed: string): number[] {
  const h = new Array<number>(16).fill(0x37);
  for (let i = 0; i < seed.length; i++) {
    const b = seed.charCodeAt(i) & 0xff;
    const j = i & 15;
    h[j] = (h[j] ^ b) & 0xff;
    // left-rotate by 3 (UInt8 wrap)
    h[j] = ((h[j] << 3) | (h[j] >> 5)) & 0xff;
    // mix neighbour (wrapping add)
    const k = (j + 1) & 15;
    h[k] = (h[k] + h[j]) & 0xff;
  }
  return h;
}

const white = (b: number): string => {
  const v = Math.round(b * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${v}${v}${v}`;
};

export function WalletIdenticon({ seed, size = 48 }: { seed: string; size?: number }) {
  const { bg, fg, rects, rad, clipId } = useMemo(() => {
    const p = paletteFor(seed || '');
    const bgC = white((p[0] / 255) * 0.12 + 0.06); // very dark: 0.06–0.18
    const fgC = white((p[1] / 255) * 0.19 + 0.78); // light: 0.78–0.97
    const gap = size * 0.038;
    const cell = size / 5;
    const r = gap * 1.4;
    const out: { x: number; y: number; s: number }[] = [];
    for (let row = 0; row < 5; row++) {
      const line: boolean[] = [];
      for (let col = 0; col < 3; col++) {
        const idx = (row * 3 + col + 2) % p.length;
        line[col] = p[idx] >= 128;
      }
      const full = [line[0], line[1], line[2], line[1], line[0]];
      for (let col = 0; col < 5; col++) {
        if (full[col]) out.push({ x: col * cell + gap, y: row * cell + gap, s: cell - gap * 2 });
      }
    }
    return { bg: bgC, fg: fgC, rects: out, rad: r, clipId: `idc-${(seed || 'x').slice(2, 10)}` };
  }, [seed, size]);

  return (
    <Svg width={size} height={size}>
      <Defs>
        <ClipPath id={clipId}>
          <Circle cx={size / 2} cy={size / 2} r={size / 2} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${clipId})`}>
        <Rect x={0} y={0} width={size} height={size} fill={bg} />
        {rects.map((re, i) => (
          <Rect key={i} x={re.x} y={re.y} width={re.s} height={re.s} rx={rad} fill={fg} />
        ))}
      </G>
    </Svg>
  );
}
