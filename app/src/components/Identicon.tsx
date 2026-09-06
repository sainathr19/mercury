import { View } from 'react-native';

export interface IdenticonProps {
  seed: string;
  size?: number;
}

/** Deterministic color chip derived from `seed`. Phase 0 placeholder; a richer
 *  generative identicon can replace the internals without touching call sites. */
export function Identicon({ seed, size = 32 }: IdenticonProps) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: `hsl(${hue}, 65%, 55%)`,
      }}
    />
  );
}
