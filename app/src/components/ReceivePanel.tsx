// The receive details for one network: QR, address, copy, share.
//
// Lives inline under the network row that opened it rather than on a pushed
// screen. Picking a network and reading its address are one task, and splitting
// them across two screens meant the answer arrived somewhere you then had to
// navigate back out of — which is why that screen needed a "Change Network"
// button at all. Expanding in place makes the whole list the network switcher.
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon } from '../ui/Icon';
import { Text } from '../ui/Text';
import { AddressQR } from './AddressQR';
import { localTokenIcon } from './icon-assets';
import { useSession } from '../stores/session';
import { useMercuryName } from '../stores/mercuryNameStore';
import { useNetworks } from '../stores/networkStore';
import { shortenAddress } from '../lib/format';
import type { ReceiveNetwork } from '../lib/receiveNetworks';
import { chainName } from '../lib/chains';
import { BTC_NETWORKS, SOL_NETWORKS, EVM_NETWORKS, type NetworkChoices } from '../bridge/networks';
import { fontFamily } from '../theme/fonts';
import { posthog } from '../lib/posthog';

/** Small enough to sit inside a list row's expansion and still scan reliably. */
const QR_SIZE = 196;

export function ReceivePanel({ network }: { network: ReceiveNetwork }) {
  const theme = UnistylesRuntime.getTheme();
  const addresses = useSession((s) => s.addresses);
  const environment = useNetworks((s) => s.environment);
  const choices = useNetworks((s) => s.choices);
  const claimedName = useMercuryName((s) => s.name) ?? '';
  const [full, setFull] = useState(false);
  const qrRef = useRef<View>(null);
  // 0 = "Copy", 1 = ✓. Crossfaded so the button never changes width.
  const copied = useSharedValue(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const labelStyle = useAnimatedStyle(() => ({ opacity: 1 - copied.value }));
  const tickStyle = useAnimatedStyle(() => ({
    opacity: copied.value,
    transform: [{ scale: 0.7 + copied.value * 0.3 }],
  }));

  const isUsername = network.kind === 'username';
  const onchain = network.kind === 'address' && addresses ? addresses[network.addrKey] : '';
  const uriScheme = network.kind === 'address' ? network.uriScheme : '';
  // What is shown, copied and encoded: the Mercury name when there is one, else
  // the chain's own address. A name is worth more in a QR than an address — it
  // resolves to every chain the user has, in any wallet that reads ENS.
  const value = isUsername ? claimedName : onchain;
  const payload = isUsername ? claimedName : onchain ? `${uriScheme}:${onchain}` : onchain;
  const iconKey = network.kind === 'address' ? (network.iconKey ?? network.coingeckoId) : '';
  const centerLogo = isUsername
    ? require('../../assets/icons/MercuryIcon.svg')
    : localTokenIcon(iconKey, UnistylesRuntime.themeName === 'dark');
  const showTestnetNotice = environment === 'testnet' && network.kind === 'address';

  async function copy() {
    if (!value) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(value);
    posthog.capture('receive_address_copied', { network: network.name, is_username: isUsername });
    copied.value = withTiming(1, { duration: 180 });
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      copied.value = withTiming(0, { duration: 240 });
    }, 1400);
  }

  async function shareQR() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const uri = await captureRef(qrRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { dialogTitle: `${network.name} address` });
      }
    } catch {}
  }

  // A name has no chain and no short form, so there is nothing to expand.
  const canExpand = !isUsername && !!value;

  return (
    <View style={styles.panel}>
      {/* The QR sits on white with its own edge — it is the thing being handed
          over, so it reads as an object rather than as a texture on the row. */}
      <View ref={qrRef} collapsable={false} style={styles.qrCard}>
        <AddressQR
          data={payload}
          size={QR_SIZE}
          coingeckoId={iconKey}
          bg="#FFFFFF"
          logo={centerLogo}
          // A short name makes a sparse QR with huge modules; forcing a higher
          // version keeps it visually the same weight as an address QR.
          version={isUsername ? 8 : undefined}
        />
      </View>

      {/* The address, monospaced and tappable to see all of it. */}
      <Pressable
        style={styles.addrBlock}
        disabled={!canExpand}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          setFull((v) => !v);
        }}
      >
        <Text style={styles.addrText} numberOfLines={full ? 3 : 1}>
          {value ? (isUsername || full ? value : shortenAddress(value, 10, 10)) : '—'}
        </Text>
        {canExpand && (
          <Text style={styles.addrHint}>{full ? 'Tap to shorten' : 'Tap to see all of it'}</Text>
        )}
      </Pressable>

      {/* Two equal actions. Copy was a dark pill buried inside the address
          capsule and Share was a separate full-width button at the bottom of a
          different screen; they are the same kind of thing and now look it. */}
      <View style={styles.actions}>
        <Pressable style={styles.action} onPress={copy}>
          <Animated.View style={[styles.actionInner, labelStyle]}>
            <Icon name="copy" size={15} color={theme.colors.text} />
            <Text style={styles.actionLabel}>Copy</Text>
          </Animated.View>
          <Animated.View style={[styles.actionTick, tickStyle]}>
            <Icon name="check" size={16} color={theme.colors.success} />
            <Text style={[styles.actionLabel, { color: theme.colors.success }]}>Copied</Text>
          </Animated.View>
        </Pressable>
        <Pressable style={styles.action} onPress={shareQR}>
          <View style={styles.actionInner}>
            <Icon name="arrowUpRight" size={15} color={theme.colors.text} />
            <Text style={styles.actionLabel}>Share</Text>
          </View>
        </Pressable>
      </View>

      {showTestnetNotice ? (
        <View style={styles.notice}>
          <Icon name="warning" size={14} color={theme.colors.danger} />
          <Text style={styles.noticeText}>
            Test network. Only send {testnetLabel(network, choices)} funds here — real assets sent to
            this address are lost.
          </Text>
        </View>
      ) : (
        <Text style={styles.note}>
          {isUsername
            ? 'Your Mercury name receives on every network you hold, from any wallet that reads ENS.'
            : `Only send assets on ${network.name}. Anything sent on another network will not arrive.`}
        </Text>
      )}
    </View>
  );
}

/**
 * The network to name in the deposit warning.
 *
 * The registry wins where it knows the chain: the generic fallback appends
 * ETHEREUM's network label to every EVM brand, which reads "Arc Sepolia" for a
 * chain that is actually Arc Testnet. Naming a network that does not exist on a
 * deposit warning is how people lose money.
 */
function testnetLabel(network: ReceiveNetwork, choices: NetworkChoices): string {
  if (network.kind !== 'address') return '';
  if (network.addrKey === 'btc') return BTC_NETWORKS[choices.btc].label;
  if (network.addrKey === 'sol') return SOL_NETWORKS[choices.sol].label;
  const id = network.chainIds?.testnet;
  if (id) {
    const known = chainName(id);
    if (known) return known;
  }
  return `${network.name} ${EVM_NETWORKS[choices.evm].label}`;
}

const styles = StyleSheet.create((theme) => ({
  panel: { alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 16 },

  qrCard: {
    padding: 14,
    borderRadius: theme.radius.xl,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  addrBlock: { alignItems: 'center', gap: 3, paddingHorizontal: 8 },
  addrText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center',
    color: theme.colors.text,
  },
  addrHint: { fontFamily: fontFamily.medium, fontSize: 11.5, color: theme.colors.faint },

  actions: { flexDirection: 'row', alignSelf: 'stretch', gap: 10 },
  action: {
    flex: 1,
    height: 46,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionInner: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  // Overlays the label so the button keeps its width through the swap.
  actionTick: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  actionLabel: { fontFamily: fontFamily.semibold, fontSize: 14.5, letterSpacing: -0.24, color: theme.colors.text },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    alignSelf: 'stretch',
    padding: 12,
    borderRadius: theme.radius.lg,
    backgroundColor: 'rgba(255,59,48,0.10)',
  },
  noticeText: { flex: 1, fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16.5, color: theme.colors.danger },

  note: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16.5,
    letterSpacing: -0.14,
    textAlign: 'center',
    color: theme.colors.muted,
    paddingHorizontal: 6,
  },
}));
