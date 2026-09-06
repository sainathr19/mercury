import { useMemo } from 'react';
import { View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Canvas, Path, RoundedRect, Skia } from '@shopify/react-native-skia';
import QRCode from 'qrcode';
import { UnistylesRuntime } from 'react-native-unistyles';
import { CryptoGlyph, CRYPTO_GLYPH_IDS } from './CryptoGlyph';

const LOGO_MODULES = 7;

export interface AddressQRProps {
  data: string;
  size: number;
  coingeckoId: string;
  /** Surface color the QR sits on (used for the finder-pattern inner ring). */
  bg?: string;
  /** Optional custom center logo (a require()'d image) — overrides the coingecko
   *  glyph. Used for the Standard-username QR (StaIcon). */
  logo?: number;
  /** Force a minimum QR symbol version (1–40). A short payload (e.g. a
   *  @username) otherwise makes a low-density QR with huge modules; forcing a
   *  higher version pads it so the dots stay small — matching the address QRs. */
  version?: number;
  /** Error-correction level (default 'H'). A LONG payload (e.g. a bolt11 Lightning
   *  invoice) at 'H' packs in so many modules the dots get tiny — pass 'M' (or 'L')
   *  for fewer, bigger dots. Short payloads (addresses) stay at 'H'. */
  ecl?: 'L' | 'M' | 'Q' | 'H';
}

/** Custom dot-matrix QR with rounded finder patterns + a centered chain logo —
 *  ports the iOS QRCodeView styling. */
export function AddressQR({ data, size, coingeckoId, bg, logo, version, ecl = 'H' }: AddressQRProps) {
  const theme = UnistylesRuntime.getTheme();
  const surface = bg ?? theme.colors.cardBackground;

  const built = useMemo(() => {
    if (!data) return null;
    try {
      // `version` isn't in the local qrcode typings but is honored at runtime;
      // build via a variable so the extra key isn't excess-property-checked.
      const opts: { errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H'; version?: number } = { errorCorrectionLevel: ecl };
      if (version) opts.version = version;
      const qr = QRCode.create(data, opts);
      const count = qr.modules.size;
      const bits = qr.modules.data; // 1 = dark
      const m = size / count;
      const r = m * 0.38;
      const center = Math.floor(count / 2);
      const half = Math.floor(LOGO_MODULES / 2);
      const inFinder = (row: number, col: number) =>
        (row < 7 && col < 7) || (row < 7 && col >= count - 7) || (row >= count - 7 && col < 7);
      const inLogo = (row: number, col: number) =>
        row >= center - half && row <= center + half && col >= center - half && col <= center + half;

      const dots = Skia.Path.Make();
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (inFinder(row, col) || inLogo(row, col)) continue;
          if (!bits[row * count + col]) continue;
          dots.addCircle(col * m + m / 2, row * m + m / 2, r);
        }
      }
      return { dots, count, m };
    } catch {
      return null;
    }
  }, [data, size, version, ecl]);

  if (!built) {
    return <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: surface }} />;
  }

  const { dots, count, m } = built;
  const finders: [number, number][] = [
    [0, 0],
    [count - 7, 0],
    [0, count - 7],
  ];
  const logoSize = LOGO_MODULES * m * 0.9;

  return (
    <View style={{ width: size, height: size }}>
      <Canvas style={{ flex: 1 }}>
        <Path path={dots} color={theme.colors.text} />
        {finders.map(([oc, or], i) => {
          const x = oc * m;
          const y = or * m;
          return (
            <FinderPattern key={i} x={x} y={y} m={m} fg={theme.colors.text} bg={surface} />
          );
        })}
      </Canvas>
      {logo != null ? (
        <View style={{ position: 'absolute', left: size / 2 - logoSize / 2, top: size / 2 - logoSize / 2 }}>
          <ExpoImage
            source={logo}
            style={{ width: logoSize, height: logoSize, borderRadius: logoSize * 0.22 }}
            contentFit="contain"
          />
        </View>
      ) : CRYPTO_GLYPH_IDS.has(coingeckoId) ? (
        <View style={{ position: 'absolute', left: size / 2 - logoSize / 2, top: size / 2 - logoSize / 2 }}>
          <CryptoGlyph coingeckoId={coingeckoId} size={logoSize} mono={theme.colors.text} />
        </View>
      ) : null}
    </View>
  );
}

function FinderPattern({ x, y, m, fg, bg }: { x: number; y: number; m: number; fg: string; bg: string }) {
  const outer = m * 1.8;
  return (
    <>
      <RoundedRect x={x} y={y} width={m * 7} height={m * 7} r={outer} color={fg} />
      <RoundedRect x={x + m} y={y + m} width={m * 5} height={m * 5} r={outer * 0.65} color={bg} />
      <RoundedRect x={x + m * 2} y={y + m * 2} width={m * 3} height={m * 3} r={outer * 0.4} color={fg} />
    </>
  );
}
