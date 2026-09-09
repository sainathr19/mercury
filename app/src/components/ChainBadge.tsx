// The network a row happened on, as a small mark.
//
// An activity row already says WHAT moved (the token art) and HOW MUCH; the one
// thing it could not say was WHERE — and on a wallet that holds the same USDC
// on six chains, that is the difference between two otherwise identical rows.
//
// Resolution order: the registry's own network art, then a tinted monogram from
// the chain's native colour. `CryptoIcon`'s `chainKey` badge is not used here
// because it can only draw the handful of chains we ship art for locally, and
// Arc — the chain Mercury actually settles on — is not one of them.
import { View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '../ui/Text';
import { localTokenIcon } from './icon-assets';
import { RemoteTokenIcon } from './RemoteTokenIcon';
import { useRegistry } from '../stores/registryStore';
import { chainById } from '../lib/chains';
import { fontFamily } from '../theme/fonts';

/**
 * Chains whose mark we ship, keyed by chain id.
 *
 * Checked before the registry: the registry has no art for Arc — the chain
 * Mercury actually settles on — so every Arc row fell through to a monogram.
 */
const LOCAL_ART: Record<string, string> = {
  '5042002': 'arc',
};

export interface ChainBadgeProps {
  /** EVM chain id, when the row knows it. Resolves art most reliably. */
  chainId?: number | bigint;
  /** Human network name from the activity item ("Base", "Solana Devnet", …). */
  network?: string;
  size?: number;
  /** Colour of the ring that separates the badge from what it sits on. Pass the
   *  surface it overlaps; omit for no ring. */
  ringColor?: string;
}

/** Registry key for a network id or name, or undefined when neither matches. */
function resolve(
  networks: Record<string, { id: string; name: string; imageUrl?: string }>,
  chainId?: number | bigint,
  network?: string,
): { name: string; imageUrl?: string } | undefined {
  if (chainId !== undefined) {
    const hit = networks[String(chainId)];
    if (hit) return hit;
  }
  if (!network) return undefined;
  const want = network.trim().toLowerCase();
  for (const n of Object.values(networks)) {
    if (n.name.toLowerCase() === want) return n;
  }
  // "Bitcoin Testnet" / "Solana Devnet" and friends: fall back to a prefix
  // match so a testnet row still shows its family's mark.
  for (const n of Object.values(networks)) {
    const nm = n.name.toLowerCase();
    if (want.startsWith(nm) || nm.startsWith(want)) return n;
  }
  return undefined;
}

/**
 * Whether badging this holding tells the reader anything.
 *
 * An EVM asset always earns one — the same token is listed once per chain, so
 * the network is part of its identity. Bitcoin and native SOL do not: there is
 * one of each, and stamping "Bitcoin" onto bitcoin is noise.
 */
export function needsChainBadge(a: {
  chain: 'bitcoin' | 'ethereum' | 'solana';
  tokenMint?: string;
}): boolean {
  if (a.chain === 'bitcoin') return false;
  if (a.chain === 'solana') return !!a.tokenMint;
  return true;
}

export function ChainBadge({ chainId, network, size = 15, ringColor }: ChainBadgeProps) {
  const networks = useRegistry((s) => s.registry.networks);
  const hit = resolve(networks, chainId, network);
  // `chainById` knows every chain the app ships (Arc and Tempo included), so it
  // supplies the name and tint the registry has no art for.
  const def = chainId !== undefined ? chainById(BigInt(chainId)) : undefined;
  const label = hit?.name ?? def?.name ?? network;
  if (!label) return null;

  const local = chainId !== undefined ? localTokenIcon(LOCAL_ART[String(chainId)] ?? '') : undefined;

  const ring = ringColor ? { borderWidth: 1.5, borderColor: ringColor } : null;
  return (
    <View style={[styles.wrap(size), ring]}>
      {local !== undefined ? (
        <ExpoImage source={local} style={{ width: size, height: size }} contentFit="contain" />
      ) : hit?.imageUrl ? (
        <RemoteTokenIcon uri={hit.imageUrl} size={size} fallbackColor={def?.nativeColorHex ?? '#70707A'} symbol={label} />
      ) : (
        <View style={[styles.mono(size), { backgroundColor: def?.nativeColorHex ?? '#70707A' }]}>
          <Text style={styles.monoText(size)}>{label.slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  wrap: (size: number) => ({
    width: size,
    height: size,
    borderRadius: size / 2,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  }),
  mono: (size: number) => ({
    width: size,
    height: size,
    borderRadius: size / 2,
    alignItems: 'center',
    justifyContent: 'center',
  }),
  monoText: (size: number) => ({
    fontFamily: fontFamily.semibold,
    fontSize: Math.max(7, size * 0.56),
    color: '#FFFFFF',
  }),
}));
