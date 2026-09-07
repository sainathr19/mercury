import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale, Text } from '../../../src/ui';
import { useScan, parseScanned } from '../../../src/stores/scanStore';
import { useRecentAddresses } from '../../../src/stores/recentAddressStore';
import { useSendDraft } from '../../../src/stores/sendDraftStore';
import { authClient } from '../../../src/bridge/auth';
import { isEnsName, resolveEns } from '../../../src/bridge/ens';
import { validateHandle } from '../../../src/bridge/username';
import { validateAddr, chainOf, detectAddressChain, CHAIN_LABEL } from '../../../src/lib/sendHelpers';
import { shortenAddress, relativeTime } from '../../../src/lib/format';
import { fontFamily } from '../../../src/theme/fonts';

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

export default function SendAddress() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const asset = useSendDraft((s) => s.asset);
  const address = useSendDraft((s) => s.address);
  const shield = useSendDraft((s) => s.shield);
  const privateFlow = useSendDraft((s) => s.privateFlow);
  const patch = useSendDraft((s) => s.patch);
  const recents = useRecentAddresses();

  const trimmed = address.trim();
  // A stealth meta-address is bech32m with the `stealth1…` prefix (distinct from
  // an EVM 0x… address, which also passes a naive length check).
  const isStealthMeta = trimmed.toLowerCase().startsWith('stealth1');
  const addrValid =
    privateFlow === 'pay'
      ? isStealthMeta
      : privateFlow === 'spend'
        ? // Spend received can go to a normal address OR a stealth address
          // (stealth → stealth); @username uses the Continue button.
          isStealthMeta || (!!asset && validateAddr(asset, trimmed))
        : shield
          ? isStealthMeta
          : // Normal send: a chain address OR a pasted/scanned stealth meta-address
            // (the latter turns this into a shield — see the advance effect below).
            isStealthMeta || (!!asset && validateAddr(asset, trimmed));
  // @username is accepted for pay, spend, and normal sends (resolves to a
  // stealth meta-address). A self-shield never reaches here (own addr pre-filled).
  const isUsername = trimmed.startsWith('@');
  const handle = isUsername ? trimmed.slice(1).toLowerCase() : '';

  // Header verb + input placeholder per flow.
  const flowLabel = privateFlow === 'pay' ? 'Pay' : privateFlow === 'spend' ? 'Send' : shield ? 'Shield' : 'Send';
  const inputPlaceholder =
    privateFlow === 'pay'
      ? 'Stealth address or @username'
      : privateFlow === 'spend'
        ? 'Address, stealth address, or @username'
        : shield
          ? 'Enter private address'
          : 'Enter address or username';

  // An @username resolves to the recipient's stealth meta-address, so a
  // username send is a private (shield) send. Resolve it (debounced) at the hub.
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<
    { meta_address: string; chain_mask: number; btc?: string | null; evm?: string | null; sol?: string | null } | null
  >(null);
  const [resolveErr, setResolveErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isUsername) {
      setResolving(false);
      setResolved(null);
      setResolveErr(null);
      return;
    }
    const fmt = validateHandle(handle);
    if (fmt) {
      setResolved(null);
      setResolveErr(fmt);
      setResolving(false);
      return;
    }
    setResolving(true);
    setResolved(null);
    setResolveErr(null);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await authClient.resolveHandle(handle);
        if (cancelled) return;
        if (r) {
          setResolved(r);
          setResolveErr(null);
        } else {
          setResolveErr(`No Mercury user @${handle}`);
        }
      } catch {
        if (!cancelled) setResolveErr('Could not check that username.');
      } finally {
        if (!cancelled) setResolving(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isUsername, handle]);

  useEffect(() => {
    recents.hydrate();
  }, [recents]);

  // Record the scanned value; the auto-advance effect below moves forward. Fire a
  // notification haptic reflecting whether the QR is a valid address for THIS
  // asset — success if it matches the chain, error if it's the wrong chain.
  const scanResult = useScan((s) => s.result);
  useEffect(() => {
    if (!scanResult) return;
    const scanned = parseScanned(scanResult);
    patch({ address: scanned });
    useScan.getState().consume();
    const s = scanned.trim();
    const ok = s.toLowerCase().startsWith('stealth1')
      ? s.length >= 40 // a stealth meta-address scanned into any send is valid (→ shield)
      : shield
        ? s.length >= 40
        : !!asset && validateAddr(asset, s);
    Haptics.notificationAsync(
      ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
    );
  }, [scanResult, patch, asset, shield]);

  // ── ENS ────────────────────────────────────────────────────────────────
  // A `.eth` name is resolved on Ethereum (Sepolia on testnet) and REPLACES the
  // typed text with the address it points at. Showing the resolved address
  // rather than keeping the pretty name is deliberate: ENS proves who owns the
  // NAME, never that the address inside is really theirs, so the payer sees
  // exactly where the money is going before it moves.
  //
  // coinType 60 is an EVM address, valid on every EVM chain at once. Bitcoin and
  // Solana are different keys under different coin types and need their own
  // decoders, so a name is not offered for those assets yet.
  const isEns = !isUsername && isEnsName(trimmed);
  const ensChainOk = !!asset && chainOf(asset) === 'eth';
  const [ensResolving, setEnsResolving] = useState(false);
  const [ensErr, setEnsErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isEns) { setEnsResolving(false); setEnsErr(null); return; }
    if (!ensChainOk) { setEnsResolving(false); setEnsErr(`ENS names resolve to an EVM address — pick an EVM asset to pay ${trimmed}.`); return; }
    let cancelled = false;
    setEnsResolving(true);
    setEnsErr(null);
    const t = setTimeout(async () => {
      const r = await resolveEns(trimmed);
      if (cancelled) return;
      setEnsResolving(false);
      if (r.status === 'ok' && r.records.evm) {
        patch({ address: r.records.evm, recipientHandle: trimmed.toLowerCase() });
      } else if (r.status === 'unavailable') {
        // Say we could not check, not that the name is bad — the difference
        // matters when someone is staring at their own name.
        setEnsErr(`Couldn't look up ${trimmed} just now. Check your connection.`);
      } else {
        setEnsErr(`${trimmed} has no address we can pay.`);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [isEns, ensChainOk, trimmed, patch]);

  // A valid ADDRESS (typed / pasted / scanned / picked) advances automatically —
  // no Continue tap. Guarded so it fires once per valid entry and doesn't bounce
  // when returning here from the amount step.
  const advanced = useRef(false);
  useEffect(() => {
    if (addrValid && !advanced.current) {
      advanced.current = true;
      // A stealth meta-address scanned/typed into a NORMAL send stays a "Send"
      // (NOT a shield): confirm.tsx routes it privately based on the destination
      // being a stealth1, so we do NOT flip the `shield` flag here. Flipping it
      // used to mislabel it "Shield BTC" and make re-selecting the asset skip
      // straight to the amount via the self-shield path.
      router.push('/(app)/send/amount');
    } else if (!addrValid) {
      advanced.current = false;
    }
  }, [addrValid, router, isStealthMeta, shield, privateFlow, patch]);

  if (!asset) return null;

  // Precise invalid-address message: name the chain the entered address actually
  // belongs to when it doesn't match the selected asset (e.g. a SOL address while
  // sending ETH). Only relevant for a plain chain address (not @username/stealth).
  const detectedChain = detectAddressChain(trimmed);
  const expectedChain = chainOf(asset);
  const addrError =
    privateFlow === 'pay'
      ? 'Enter a stealth address or @username.'
      : detectedChain && detectedChain !== expectedChain
        ? `That looks like a ${CHAIN_LABEL[detectedChain]} address, but you're sending ${asset.symbol} on ${CHAIN_LABEL[expectedChain]}.`
        : `Not a valid ${asset.symbol} address.`;

  // Which chain families the recipient can receive on (chain_mask bits: BTC=1,
  // EVM=2, SOL=4) and whether the picked asset qualifies for a private send.
  const FAMILY_BIT: Record<string, number> = { btc: 1, eth: 2, sol: 4 };
  const assetIsToken = !!asset.tokenContract || !!asset.tokenMint;
  const recipientChain = chainOf(asset);
  const chainSupported = !!resolved && (resolved.chain_mask & FAMILY_BIT[recipientChain]) !== 0;
  // Private (shield/pay/spend) sends go to the recipient's stealth META-address
  // (chain_mask = which chains that supports). A NORMAL send goes to their PUBLIC
  // on-chain address for the asset's chain — which must actually be PUBLISHED, not
  // merely implied by chain_mask (those can diverge for older claims). Gate on the
  // real address so we never enable a send the recipient can't receive.
  const isPrivateSend = privateFlow === 'pay' || privateFlow === 'spend' || shield;
  const publicAddr = recipientChain === 'btc' ? resolved?.btc : recipientChain === 'sol' ? resolved?.sol : resolved?.evm;
  const canReceive = isPrivateSend ? chainSupported : !!publicAddr;
  const usernameValid = !!resolved && canReceive && (!assetIsToken || !isPrivateSend);

  // Recently-used are normal chain addresses — not applicable to a shield send.
  const validRecents = shield ? [] : recents.list.filter((r) => r.address.startsWith('@') || validateAddr(asset, r.address));

  // Right-side input status: a small spinner while a username resolves, a green
  // check when the entry is valid, a red ✗ when it's a non-empty invalid entry.
  const showSpinner = (isUsername && resolving) || ensResolving;
  const showCheck = addrValid || (isUsername && usernameValid);
  // Single error string shown in a FIXED-HEIGHT row below the input, so the
  // layout never shifts whether or not there's an error.
  let statusError = '';
  if (isUsername) {
    if (!resolving && resolveErr) statusError = resolveErr;
    else if (!resolving && resolved && assetIsToken && isPrivateSend) statusError = 'Private sends support native BTC, ETH and SOL only.';
    else if (!resolving && resolved && !isPrivateSend && !publicAddr) statusError = `@${handle} hasn’t published a ${CHAIN_LABEL[recipientChain]} address.`;
    else if (!resolving && resolved && !usernameValid && !chainSupported) statusError = `@${handle} can’t receive ${asset.symbol}.`;
  } else if (isEns) {
    statusError = ensResolving ? '' : (ensErr ?? '');
  } else if (trimmed.length > 0 && !addrValid) {
    statusError = addrError;
  }

  return (
    <View style={styles.body}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Custom header: back on top, then "Send <token>" with the QR scanner on
          its right, 24px below the back icon. */}
      <View style={styles.header}>
        <Pressable onPress={() => { tap(); router.back(); }} hitSlop={10}>
          <ExpoImage
            source={require('../../../assets/icons/arrowLeft.svg')}
            style={styles.backIcon}
            tintColor={theme.colors.text}
            contentFit="contain"
          />
        </Pressable>
        <View style={styles.titleRow}>
          <Text style={styles.pageTitle}>{flowLabel} {asset.symbol}</Text>
          <Pressable onPress={() => { tap(); router.push('/(app)/scan'); }} hitSlop={10}>
            <Icon name="scan" size={24} color={theme.colors.text} />
          </Pressable>
        </View>
      </View>

      {/* Address input — grey box (fixed height so the check doesn't shift it). */}
      <View style={styles.inputWrap}>
        <TextInput
          value={address}
          onChangeText={(v) => patch({ address: v })}
          placeholder={inputPlaceholder}
          placeholderTextColor={theme.colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        {showSpinner ? (
          <ActivityIndicator size="small" color={theme.colors.muted} />
        ) : showCheck ? (
          <View style={styles.checkBadge}>
            <Icon name="check" size={14} color="#FFFFFF" />
          </View>
        ) : null}
      </View>

      {/* Fixed-height status row — reserves space so an error never shifts the
          layout (it just appears/disappears in place). */}
      <View style={styles.statusRow}>
        {statusError ? (
          <Text variant="caption" color={theme.colors.danger} numberOfLines={1}>
            {statusError}
          </Text>
        ) : null}
      </View>

      {validRecents.length > 0 && (
        <View style={styles.recentCard}>
          <Text style={styles.recentTitle}>Recently Used</Text>
          {validRecents.slice(0, 5).map((r) => (
            <Pressable key={r.address} style={styles.recentRow} onPress={() => { tap(); patch({ address: r.address }); }}>
              <Text style={styles.recentAddr} numberOfLines={1}>
                {r.address.startsWith('@') ? r.address : shortenAddress(r.address, 6, 6)}
              </Text>
              <Text style={styles.recentTime}>{relativeTime(r.ts)}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Continue is ONLY for usernames (addresses auto-advance). Disabled until
          the backend validates the handle. */}
      {isUsername && (
        <>
          <View style={styles.spacer} />
          <PressableScale
            style={[styles.primaryBtn, !usernameValid && styles.primaryBtnDisabled]}
            disabled={!usernameValid}
            onPress={
              usernameValid && resolved
                ? () => {
                    // Pre-set `advanced` so the auto-advance effect doesn't double-fire.
                    advanced.current = true;
                    // Route the @username by flow:
                    //  • spend → stealth → stealth (their meta-address).
                    //  • pay / shield → private send to their stealth meta-address.
                    //  • normal (public) send → their REAL on-chain address for the
                    //    selected asset's chain. The hub stores every user's public
                    //    btc/evm/sol receive address, so a username in the normal
                    //    flow is an ordinary public send — NOT a shield.
                    if (privateFlow === 'spend') {
                      patch({ address: resolved.meta_address, recipientHandle: `@${handle}` });
                    } else if (privateFlow === 'pay' || shield) {
                      patch({ shield: true, address: resolved.meta_address, recipientHandle: `@${handle}` });
                    } else if (asset) {
                      const c = chainOf(asset);
                      const addr = c === 'btc' ? resolved.btc : c === 'sol' ? resolved.sol : resolved.evm;
                      if (!addr) {
                        setResolveErr(`@${handle} hasn’t published a ${CHAIN_LABEL[c] ?? c} address.`);
                        return;
                      }
                      patch({ shield: false, address: addr, recipientHandle: `@${handle}` });
                    } else {
                      return;
                    }
                    router.push('/(app)/send/amount');
                  }
                : undefined
            }
          >
            <Text variant="body" color="#FFFFFF">
              Continue
            </Text>
          </PressableScale>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingTop: 40, paddingBottom: theme.spacing.md },
  header: {},
  backIcon: { width: 30, height: 30 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 },
  pageTitle: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text },
  // Grey box, 12px radius, 12/18 padding. The check is sized to the text line
  // (19px) so it doesn't grow the row / shift the layout when it appears.
  inputWrap: {
    marginTop: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  input: { flex: 1, color: theme.colors.text, fontFamily: fontFamily.medium, fontSize: 15, letterSpacing: -0.3, padding: 0 },
  checkBadge: { width: 19, height: 19, borderRadius: 9.5, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center' },
  // Fixed (compact) height so an error/hint never shifts the layout — it appears in place.
  statusRow: { minHeight: 16, marginTop: 4, paddingHorizontal: 18, justifyContent: 'center' },
  recentCard: {
    marginTop: theme.spacing.xs,
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  recentTitle: { fontSize: 15, fontFamily: fontFamily.bold, letterSpacing: -0.3, color: theme.colors.text, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4 },
  recentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md, paddingHorizontal: 18, paddingVertical: 12 },
  recentAddr: { flex: 1, fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.text },
  recentTime: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.muted },
  spacer: { flex: 1 },
  primaryBtn: { height: 48, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.sm },
  primaryBtnDisabled: { backgroundColor: theme.colors.muted },
}));
