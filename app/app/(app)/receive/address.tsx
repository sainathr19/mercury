import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { captureRef } from 'react-native-view-shot';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, SheetNav, Text } from '../../../src/ui';
import { AddressQR } from '../../../src/components/AddressQR';
import { useSession } from '../../../src/stores/session';
import { useMercuryName } from '../../../src/stores/mercuryNameStore';
import { useNetworks } from '../../../src/stores/networkStore';
import { shortenAddress } from '../../../src/lib/format';
import { receiveNetwork, type ReceiveNetwork } from '../../../src/lib/receiveNetworks';
import { BTC_NETWORKS, SOL_NETWORKS, EVM_NETWORKS, type NetworkChoices } from '../../../src/bridge/networks';
import { getActiveEnvironment } from '../../../src/bridge/activeEnv';
import { chainName } from '../../../src/lib/chains';
import { localTokenIcon } from '../../../src/components/icon-assets';
import { fontFamily } from '../../../src/theme/fonts';
import { posthog } from '../../../src/lib/posthog';

/** Receive address + QR for a chosen network. Pushed from the Choose Network
 *  list, so swipe-back (and the top arrow / "Change Network" button) all return
 *  to the network picker. */
export default function ReceiveAddress() {
  const theme = UnistylesRuntime.getTheme();
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const addresses = useSession((s) => s.addresses);
  const environment = useNetworks((s) => s.environment);
  const choices = useNetworks((s) => s.choices);
  const [full, setFull] = useState(false);
  const qrRef = useRef<View>(null);
  // 0 = "COPY" label, 1 = ✓ tick. Drives a smooth crossfade on copy.
  const copied = useSharedValue(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const labelStyle = useAnimatedStyle(() => ({
    opacity: 1 - copied.value,
    transform: [{ scale: 0.85 + (1 - copied.value) * 0.15 }],
  }));
  const tickStyle = useAnimatedStyle(() => ({
    opacity: copied.value,
    transform: [{ scale: 0.6 + copied.value * 0.4 }],
  }));

  const network = key ? receiveNetwork(key) : undefined;
  const isUsername = network?.kind === 'username';
  // The user's Mercury name — a real ENS name, empty until one is claimed.
  const USERNAME = useMercuryName((s) => s.name) ?? '';
  const addrKey = network && network.kind === 'address' ? network.addrKey : null;
  const onchain = addrKey && addresses ? addresses[addrKey] : '';
  const uriScheme = network && network.kind === 'address' ? network.uriScheme : '';
  // Value shown / copied / encoded in the QR: the Mercury ENS name, else the
  // chain's on-chain receive address. The name is worth more in a QR than an
  // address — it resolves to every chain the user has, in any ENS-aware wallet.
  const value = isUsername ? USERNAME : onchain;
  const payload = isUsername ? USERNAME : onchain ? `${uriScheme}:${onchain}` : onchain;
  // On testnet, warn users not to deposit real funds — only shown for on-chain
  // address networks (a name isn't tied to a single chain).
  const showTestnetNotice = environment === 'testnet' && network?.kind === 'address';
  // Center mark in the QR: the Mercury glyph for the name, else the chain's
  // bundled icon (falls back to the CryptoGlyph inside AddressQR when none).
  const centerLogo = isUsername
    ? require('../../../assets/icons/MercuryIcon.svg')
    : network?.kind === 'address'
      ? localTokenIcon(network.iconKey ?? network.coingeckoId, UnistylesRuntime.themeName === 'dark')
      : undefined;

  async function copy() {
    if (!value) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(value);
    posthog.capture('receive_address_copied', {
      network: network?.name ?? null,
      is_username: isUsername,
    });
    copied.value = withTiming(1, { duration: 180 });
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      copied.value = withTiming(0, { duration: 240 });
    }, 1400);
  }

  async function shareQR() {
    try {
      const uri = await captureRef(qrRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { dialogTitle: `${network?.name} address` });
    } catch {}
  }

  return (
    <View style={styles.root}>
      <SheetNav
        title="Your address"
        subtitle="Anything sent to this address on this network lands in your wallet."
        onLeading={() => router.back()}
      />

      <View style={styles.body}>
        <View ref={qrRef} collapsable={false} style={styles.qrCard}>
          {/* A short @username makes a low-density QR with huge dots; force a
              higher version so it's dense with small modules like the address
              QRs, kept at the same 230px size. */}
          <AddressQR
            data={payload}
            size={230}
            coingeckoId={network?.kind === 'address' ? (network.iconKey ?? network.coingeckoId) : ''}
            bg={theme.colors.cardBackground}
            logo={centerLogo}
            version={isUsername ? 8 : undefined}
          />
        </View>

        <View style={styles.capsule}>
          <Pressable style={{ flex: 1 }} onPress={() => setFull((v) => !v)} disabled={isUsername}>
            <Text style={styles.addrText} numberOfLines={1}>
              {value ? (isUsername ? value : full ? value : shortenAddress(value, 8, 8)) : '—'}
            </Text>
          </Pressable>
          <PressableScale style={styles.copyPill} onPress={copy}>
            <Animated.View style={labelStyle}>
              <Text variant="subheadBold" color={theme.colors.primaryLabel}>COPY</Text>
            </Animated.View>
            <Animated.View style={[styles.copyTick, tickStyle]}>
              <Icon name="check" size={18} color={theme.colors.primaryLabel} />
            </Animated.View>
          </PressableScale>
        </View>

        {showTestnetNotice ? (
          <View style={styles.notice}>
            <Icon name="warning" size={20} color={theme.colors.text} />
            <Text variant="bodyMedium" style={{ flex: 1 }}>
              Deposit funds on {testnetLabel(network, choices)} only.
            </Text>
          </View>
        ) : (
          <Text variant="bodyMedium" color={theme.colors.muted} style={styles.subtitle}>
            {isUsername
              ? 'Use your Mercury username to receive tokens on any network from other Mercury users.'
              : `Use this address to receive tokens on the ${network?.name} network only.`}
          </Text>
        )}
      </View>

      {/* Pinned to the bottom: Change Network above Share. */}
      <View style={styles.footer}>
        {/* Change Network → back to the network picker (same as swipe-back / the
            top arrow). TODO: wire to a fuller "change network" affordance later. */}
        <PressableScale style={styles.changeBtn} onPress={() => router.back()}>
          <Text variant="bodyBold">Change Network</Text>
        </PressableScale>
        <PressableScale style={styles.shareBtn} onPress={shareQR}>
          <Icon name="send" size={16} color={theme.colors.primaryLabel} />
          <Text variant="bodyBold" color={theme.colors.primaryLabel}>Share</Text>
        </PressableScale>
      </View>
    </View>
  );
}

/** Human name for the active testnet of an on-chain receive network, e.g.
 *  "Bitcoin Testnet4" / "Ethereum Sepolia" / "Solana Devnet". */
/**
 * The network to name in the deposit warning.
 *
 * For EVM brands the registry is the authority where it knows the chain, because
 * the fallback appends ETHEREUM's network label to every brand — which reads
 * "Arc Sepolia" for a chain that is actually Arc Testnet. Naming a network that
 * does not exist on a deposit warning is how people lose money.
 */
function testnetLabel(network: ReceiveNetwork, choices: NetworkChoices): string {
  if (network.kind !== 'address') return network.name;
  switch (network.addrKey) {
    case 'btc':
      return `Bitcoin ${BTC_NETWORKS[choices.btc].label}`;
    case 'sol':
      return `Solana ${SOL_NETWORKS[choices.sol].label}`;
    case 'eth': {
      const id = network.chainIds?.[getActiveEnvironment()];
      if (id !== undefined) return chainName(id);
      return `${network.name} ${EVM_NETWORKS[choices.evm].label}`;
    }
  }
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.xl },
  body: { marginTop: theme.spacing.md },
  // The QR gets a white card with the same hairline as everything else, so the
  // code reads as an object on the page rather than as a floating bitmap.
  qrCard: {
    alignSelf: 'center',
    padding: 18,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.pill,
    paddingLeft: 15,
    paddingRight: 5,
    paddingVertical: 5,
  },
  // Monospaced: an address is an identifier you compare character by character,
  // and it matches how addresses read everywhere else in the app.
  addrText: { flex: 1, fontFamily: fontFamily.monoRegular, fontSize: 13.5, color: theme.colors.text },
  copyPill: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    justifyContent: 'center',
  },
  // Tick overlays the "COPY" label so the pill keeps its width during the swap.
  copyTick: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  subtitle: { paddingHorizontal: theme.spacing.xs, paddingTop: theme.spacing.md },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: theme.spacing.md,
    padding: 13,
    borderRadius: theme.radius.lg,
    backgroundColor: 'rgba(255,59,48,0.10)',
  },
  // Footer buttons pinned to the bottom (spacer above pushes them down).
  footer: { marginTop: 'auto', gap: 12 },
  changeBtn: {
    height: 52,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
  },
}));
