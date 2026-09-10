// Where the money is going, drawn as a journey rather than as a row.
//
// The review screen used to say `To  0x7848…AcDD5b` on one line and left it at
// that: no sender, no network in the same glance, and a recipient reduced to
// ten characters of hex with nothing to recognise. That is the one thing a
// review screen exists to get right — the amount is already large and the fee
// is a detail, but a wrong address is unrecoverable.
//
// So: two endpoints with faces, and the network on the segment between them,
// because the network is a property of the JOURNEY (the same address on the
// wrong chain is a different, losing destination) and not of either end.
import { View } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon } from '../ui/Icon';
import { Text } from '../ui/Text';
import { ChainBadge } from './ChainBadge';
import { WalletIdenticon } from './WalletIdenticon';
import { shortenAddress } from '../lib/format';
import { fontFamily } from '../theme/fonts';

export interface TransferRailProps {
  /** Sender's display name — the wallet's own name, not an address. */
  fromName: string;
  fromAddress?: string;
  /** Resolved identity for the recipient (@handle, ENS name), when there is one. */
  toName?: string | null;
  toAddress: string;
  /** Network the transfer rides. Shown on the connector, with its mark. */
  network?: string;
  chainId?: number;
  /** Right-hand text on the connector — the fee, a speed, whatever the flow costs. */
  via?: string;
}

export function TransferRail({ fromName, fromAddress, toName, toAddress, network, chainId, via }: TransferRailProps) {
  const theme = UnistylesRuntime.getTheme();
  // A stealth meta-address is far too long to shorten to something meaningful,
  // and its whole point is that it is not a place — so name it instead.
  const stealth = toAddress.trim().toLowerCase().startsWith('stealth1');

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.tile}>
          <Icon name="wallet" size={16} color={theme.colors.text} />
        </View>
        <View style={styles.body}>
          <Text style={styles.kicker}>From</Text>
          <Text style={styles.name} numberOfLines={1}>
            {fromName}
          </Text>
          {!!fromAddress && (
            <Text style={styles.addr} numberOfLines={1}>
              {shortenAddress(fromAddress, 6, 6)}
            </Text>
          )}
        </View>
      </View>

      {/* The connector. Four dots rather than a dashed border: RN's dashed
          borders render inconsistently at 2px and this is exact. */}
      <View style={styles.link}>
        <View style={styles.dots}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.dot} />
          ))}
        </View>
        {(!!network || !!via) && (
          <View style={styles.linkMeta}>
            {!!network && (
              <View style={styles.netChip}>
                <ChainBadge chainId={chainId} network={network} size={13} />
                <Text style={styles.netText} numberOfLines={1}>
                  {network}
                </Text>
              </View>
            )}
            {!!via && (
              <Text style={styles.viaText} numberOfLines={1}>
                {via}
              </Text>
            )}
          </View>
        )}
      </View>

      <View style={styles.row}>
        {/* The recipient gets a face. It is deterministic on the address, so the
            person you paid last week looks the same today — the cheapest
            wrong-address check there is. */}
        <View style={styles.tile}>
          {stealth ? (
            <Icon name="shield" size={16} color={theme.colors.text} />
          ) : (
            <WalletIdenticon seed={toAddress} size={32} />
          )}
        </View>
        <View style={styles.body}>
          <Text style={styles.kicker}>To</Text>
          <Text style={styles.name} numberOfLines={1}>
            {toName ?? (stealth ? 'Private address' : shortenAddress(toAddress, 8, 8))}
          </Text>
          {/* A name is a claim, not a guarantee: anyone may publish a record
              pointing anywhere, and ENS proves who owns the NAME, never that the
              address inside is theirs. So the address is always shown too. */}
          {!!toName && !stealth && (
            <Text style={styles.addr} numberOfLines={1}>
              {shortenAddress(toAddress, 8, 8)}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tile: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: theme.colors.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 1 },
  kicker: {
    fontFamily: fontFamily.semibold,
    fontSize: 10.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: theme.colors.faint,
  },
  name: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.28, color: theme.colors.text },
  addr: { fontFamily: fontFamily.monoRegular, fontSize: 11.5, color: theme.colors.muted },

  // The dots sit in the same 32pt column as the avatars so the line is centred
  // on them; the meta chip rides beside it in the text column.
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
  dots: { width: 32, alignItems: 'center', gap: 3.5 },
  dot: { width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: theme.colors.faint },
  linkMeta: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  netChip: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 26,
    paddingLeft: 5,
    paddingRight: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.tile,
  },
  netText: { flexShrink: 1, fontFamily: fontFamily.semibold, fontSize: 12, letterSpacing: -0.16, color: theme.colors.text },
  viaText: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.16, color: theme.colors.muted },
}));
