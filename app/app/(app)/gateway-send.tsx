import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { dismiss } from '../../src/lib/nav';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { HoldToConfirm, Icon, PressableScale, Text, useToast } from '../../src/ui';
import { ChainBadge } from '../../src/components/ChainBadge';
import { useScan, parseScanned } from '../../src/stores/scanStore';
import { formatUsd } from '../../src/lib/format';
import { fontFamily } from '../../src/theme/fonts';
import { useSession } from '../../src/stores/session';
import { useGateway } from '../../src/stores/gatewayStore';
import { gatewaySend, type SendResult } from '../../src/bridge/gateway';
import { getActiveEnvironment } from '../../src/bridge/activeEnv';
import { getActiveAccount } from '../../src/bridge/account';
import { circleChainsForEnvironment, type ChainDef } from '../../src/lib/chains';

/**
 * Send from the Circle Gateway unified balance.
 *
 * The user picks an amount, a recipient and a destination network — never a
 * SOURCE network, because there isn't one to pick: the balance is already
 * unified. Delivery is two steps (Circle attests, our relayer submits the mint)
 * but that is plumbing, so the screen reports one outcome and one duration.
 */
/** Light selection haptic for the plain Pressables. */
const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

export default function GatewaySend() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const addresses = useSession((s) => s.addresses);
  const wallet = useSession((s) => s.wallet);
  // `spendable` — NOT the wallet's total USDC. Only money already settled into
  // Gateway can be sent cross-chain; the rest has to be deposited first.
  const { spendable, perDomain, refresh, noteSent, noteEvent } = useGateway();

  const env = getActiveEnvironment();
  const destinations = circleChainsForEnvironment(env);

  const [amount, setAmount] = useState('');
  const [to, setTo] = useState('');
  const [dest, setDest] = useState<ChainDef | null>(destinations[0] ?? null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const amountRef = useRef<TextInput>(null);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0 && value <= spendable;
  const validAddress = /^0x[0-9a-fA-F]{40}$/.test(to.trim());
  const ready = valid && !!dest && !!wallet && validAddress;
  // Said only once there is something to be wrong ABOUT — an empty field is not
  // an error.
  const tooMuch = Number.isFinite(value) && value > spendable;
  const badAddress = to.trim().length > 0 && !validAddress;

  /** A scan lands back here through the shared scan store, the same way the
   *  ordinary send flow picks one up. */
  const scanResult = useScan((s) => s.result);
  useEffect(() => {
    if (!scanResult) return;
    setTo(parseScanned(scanResult));
    useScan.getState().consume();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [scanResult]);

  async function pasteAddress() {
    tap();
    const t = (await Clipboard.getStringAsync()).trim();
    if (!t) {
      show('Nothing on the clipboard', 'error');
      return;
    }
    setTo(parseScanned(t));
  }

  async function submit() {
    // `ready` gates the button, but it does not cover `addresses` — bail loudly
    // rather than silently, because a Send tap that does nothing is worse than
    // one that reports why.
    if (!dest || !wallet || !addresses) {
      setFault('Wallet not ready yet — reopen this screen.');
      return;
    }
    if (!ready) return;
    setBusy(true); setResult(null); setFault(null);
    try {
      const r = await gatewaySend({
        wallet,
        account: getActiveAccount(),
        address: addresses.eth,
        toChainId: dest.chainId,
        amount: value,
        recipient: to.trim(),
        env,
        // The user picks a destination, never a source. Hand over the balances
        // already on screen so the burn is drawn from domains that hold money.
        sources: perDomain,
      });
      setResult(r);
      if (r.ok) {
        show(`Sent $${value.toFixed(2)} in ${((r.attestMs + r.relayMs) / 1000).toFixed(1)}s`, 'success');
        // The contract keeps reporting this money for a few minutes; tell the
        // store so the balance drops now rather than after settlement.
        noteSent(value);
        noteEvent({ kind: 'delivered', amount: value, chainId: dest.chainId, ms: r.attestMs + r.relayMs });
        void refresh(addresses.eth);
      } else if (r.unclaimed) {
        // "Funds are safe" used to be said while the app discarded the only
        // thing that could deliver them. It is now saved as a pending claim, so
        // the message can point at the retry that actually exists.
        show('Sent, but not delivered yet — retry it from Gateway.', 'info');
      } else {
        setFault(r.error ?? 'Send failed');
        show(r.error ?? 'Send failed', 'error');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFault(msg);
      show(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.pageTitle}>Send instantly</Text>
          <Text style={styles.pageSub}>
            Settled USDC, delivered to any supported network in seconds.
          </Text>
        </View>
        <PressableScale haptic={false} onPress={() => dismiss(router)} style={styles.closeTile}>
          <Icon name="close" size={15} color={theme.colors.muted} />
        </PressableScale>
      </View>

      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Amount ─────────────────────────────────────────────────────── */}
        {/* The figure IS the input: a big centred number with a `$` in front of
            it, rather than a headline figure mirroring a small field below it.
            Two places showing the same number is what made the old screen read
            as a form with a decorative total on top. */}
        <View style={styles.amountCard}>
          <Text style={styles.cardLabel}>You send</Text>
          <Pressable style={styles.amountRow} onPress={() => amountRef.current?.focus()}>
            <Text style={[styles.amountGlyph, !amount && styles.amountEmpty]}>$</Text>
            <TextInput
              ref={amountRef}
              value={amount}
              onChangeText={(v) => {
                if (/^\d*\.?\d{0,6}$/.test(v)) setAmount(v);
              }}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={theme.colors.faint}
              style={styles.amountInput}
            />
          </Pressable>
          <View style={styles.amountFoot}>
            <Text style={styles.available} numberOfLines={1}>
              {formatUsd(spendable)} available
            </Text>
            <Pressable
              style={[styles.maxBtn, spendable <= 0 && styles.maxBtnOff]}
              disabled={spendable <= 0}
              onPress={() => {
                tap();
                // Floor to cents: the contract works in 6dp but a fiat figure
                // that cannot be typed back in is not a usable "Max".
                setAmount((Math.floor(spendable * 100) / 100).toFixed(2));
              }}
            >
              <Text style={styles.maxLabel}>Max</Text>
            </Pressable>
          </View>
          {tooMuch && (
            <Text style={styles.fieldError}>
              That is more than your settled balance. Only USDC already in Gateway can go instantly.
            </Text>
          )}
        </View>

        {/* ── Recipient ──────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardLabel}>To</Text>
            <View style={styles.cardActions}>
              <Pressable style={styles.miniBtn} onPress={pasteAddress}>
                <Icon name="copy" size={12} color={theme.colors.text} />
                <Text style={styles.miniLabel}>Paste</Text>
              </Pressable>
              <Pressable
                style={styles.miniBtn}
                onPress={() => {
                  tap();
                  router.push('/(app)/scan');
                }}
              >
                <Icon name="scan" size={12} color={theme.colors.text} />
                <Text style={styles.miniLabel}>Scan</Text>
              </Pressable>
            </View>
          </View>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="0x…"
            placeholderTextColor={theme.colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            multiline
            style={styles.addrInput}
          />
          {badAddress ? (
            <Text style={styles.fieldError}>That is not a valid EVM address.</Text>
          ) : (
            <Text style={styles.fieldHint}>
              The recipient receives spendable USDC — no bridge claim, no gas token needed.
            </Text>
          )}
        </View>

        {/* ── Destination ────────────────────────────────────────────────── */}
        {/* A dropdown, not a wrapping chip grid: six chips took two rows and
            still hid which one was chosen behind whichever was tinted. */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Deliver on</Text>
          <Pressable style={styles.select} onPress={() => { tap(); setPicking(true); }}>
            {dest ? (
              <>
                <ChainBadge chainId={Number(dest.chainId)} size={22} />
                <View style={styles.selectMid}>
                  <Text style={styles.selectValue}>{dest.name}</Text>
                  <Text style={styles.selectSub}>Chain {dest.chainId.toString()}</Text>
                </View>
              </>
            ) : (
              <Text style={styles.selectPlaceholder}>Choose a network</Text>
            )}
            <Icon name="chevronDown" size={15} color={theme.colors.muted} />
          </Pressable>
        </View>

        {/* ── Outcome ────────────────────────────────────────────────────── */}
        {result?.ok && (
          <View style={[styles.outcome, styles.outcomeOk]}>
            <Icon name="checkCircle" size={15} color={theme.colors.success} />
            <View style={styles.outcomeMid}>
              <Text style={[styles.outcomeTitle, { color: theme.colors.success }]}>Delivered</Text>
              <Text style={styles.outcomeBody}>
                {`Attested in ${result.attestMs}ms, minted in ${result.relayMs}ms.`}
              </Text>
            </View>
          </View>
        )}
        {result && !result.ok && result.unclaimed && (
          <View style={[styles.outcome, styles.outcomeWarn]}>
            <Icon name="clock" size={15} color={theme.colors.warning} />
            <View style={styles.outcomeMid}>
              <Text style={[styles.outcomeTitle, { color: theme.colors.warning }]}>Delivery pending</Text>
              <Text style={styles.outcomeBody}>
                The transfer was signed and the funds left your balance. They are held in a valid
                claim and will arrive once delivery retries.
              </Text>
            </View>
          </View>
        )}
        {!!fault && (
          <View style={[styles.outcome, styles.outcomeBad]}>
            <Icon name="warning" size={15} color={theme.colors.danger} />
            <View style={styles.outcomeMid}>
              <Text style={[styles.outcomeTitle, { color: theme.colors.danger }]}>Could not send</Text>
              <Text style={styles.outcomeBody}>{fault}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Held, not tapped. This rail has no review step — the tap that used to
          sit here was the only thing between a typed address and a transfer
          that cannot be undone, and it was the same gesture as every harmless
          button above it. Matches the wallet send's final action. */}
      <View style={styles.footer}>
        <HoldToConfirm
          label={valid ? `Hold to send ${formatUsd(value)}` : 'Hold to send'}
          busy={busy}
          disabled={!ready}
          onConfirm={submit}
        />
      </View>

      {/* The sheet the "Deliver on" row opens.
          This was missing outright: `Modal` was imported and `picking` was set
          to true by the row, but nothing rendered on that state and nothing
          reset it — so tapping the network row did nothing at all, and the
          destination was stuck on whatever `destinations[0]` happened to be. */}
      <Modal
        visible={picking}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPicking(false)}
      >
        <SafeAreaView style={styles.safe} edges={['bottom']}>
          <View style={styles.pickGrabber} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.pageTitle}>Deliver on</Text>
              <Text style={styles.pageSub}>
                The recipient needs no gas on the network you choose.
              </Text>
            </View>
            <PressableScale haptic={false} onPress={() => setPicking(false)} style={styles.closeTile}>
              <Icon name="close" size={15} color={theme.colors.muted} />
            </PressableScale>
          </View>
          <ScrollView contentContainerStyle={styles.pickBody} showsVerticalScrollIndicator={false}>
            {destinations.map((c, i) => {
              const on = dest?.chainId === c.chainId;
              return (
                <Pressable
                  key={c.chainId.toString()}
                  style={({ pressed }) => [
                    styles.pickRow,
                    i > 0 && styles.divider,
                    pressed && styles.pickPressed,
                  ]}
                  onPress={() => {
                    tap();
                    setDest(c);
                    setPicking(false);
                  }}
                >
                  <ChainBadge chainId={Number(c.chainId)} size={26} />
                  <View style={styles.selectMid}>
                    <Text style={styles.selectValue}>{c.name}</Text>
                    <Text style={styles.selectSub}>Chain {c.chainId.toString()}</Text>
                  </View>
                  {on && <Icon name="check" size={16} color={theme.colors.text} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground },
  fill: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.screen,
    // The modal's own top edge is right under the status bar, so the title
    // needs real room above it rather than sitting against the corner radius.
    paddingTop: 22,
    paddingBottom: 18,
  },
  headerText: { flexShrink: 1, gap: 5 },
  pageTitle: { fontFamily: fontFamily.semibold, fontSize: 26, letterSpacing: -0.9, color: theme.colors.text },
  pageSub: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: -0.2,
    color: theme.colors.muted,
  },
  closeTile: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  content: { paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.lg, gap: 12 },

  card: {
    padding: 14,
    gap: 10,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  // Same surface as `card`, but flush: its children are full-bleed rows.
  listCard: {
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardActions: { flexDirection: 'row', gap: 7 },
  cardLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 12,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    color: theme.colors.muted,
  },
  miniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 11,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.tile,
  },
  miniLabel: { fontFamily: fontFamily.semibold, fontSize: 12, letterSpacing: -0.1, color: theme.colors.text },

  // ── Amount ────────────────────────────────────────────────────────────────
  amountCard: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 8,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center' },
  amountGlyph: {
    fontFamily: fontFamily.semibold,
    fontSize: 40,
    lineHeight: 54,
    letterSpacing: -1.4,
    color: theme.colors.text,
  },
  amountEmpty: { color: theme.colors.faint },
  // An explicit height: a 40pt TextInput with `padding: 0` in a centred row
  // gets an intrinsic box shorter than its own glyphs and clips their tops,
  // which is what cut the "0" in half.
  amountInput: {
    flex: 1,
    height: 54,
    padding: 0,
    fontFamily: fontFamily.semibold,
    fontSize: 40,
    letterSpacing: -1.4,
    color: theme.colors.text,
  },
  amountFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  available: { flexShrink: 1, fontFamily: fontFamily.medium, fontSize: 13, letterSpacing: -0.18, color: theme.colors.muted },
  maxBtn: {
    height: 30,
    paddingHorizontal: 14,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  maxBtnOff: { opacity: 0.3 },
  maxLabel: { fontFamily: fontFamily.semibold, fontSize: 12.5, letterSpacing: -0.1, color: theme.colors.primaryLabel },

  // ── Recipient ─────────────────────────────────────────────────────────────
  addrInput: {
    minHeight: 38,
    padding: 0,
    fontFamily: fontFamily.monoRegular,
    fontSize: 13.5,
    lineHeight: 20,
    color: theme.colors.text,
  },
  fieldHint: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 16,
    letterSpacing: -0.1,
    color: theme.colors.muted,
  },
  fieldError: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 16,
    letterSpacing: -0.1,
    color: theme.colors.danger,
  },

  // ── Destination ───────────────────────────────────────────────────────────
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    height: 52,
    paddingHorizontal: 13,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.tile,
  },
  selectMid: { flex: 1, gap: 1 },
  selectValue: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.28, color: theme.colors.text },
  selectSub: { fontFamily: fontFamily.medium, fontSize: 11.5, letterSpacing: -0.1, color: theme.colors.muted },
  selectPlaceholder: { flex: 1, fontFamily: fontFamily.medium, fontSize: 15, color: theme.colors.faint },


  // ── Outcome ───────────────────────────────────────────────────────────────
  outcome: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 13, borderRadius: theme.radius.lg },
  outcomeOk: { backgroundColor: 'rgba(52,199,89,0.10)' },
  outcomeWarn: { backgroundColor: 'rgba(255,149,0,0.12)' },
  outcomeBad: { backgroundColor: 'rgba(255,59,48,0.10)' },
  outcomeMid: { flex: 1, gap: 2 },
  outcomeTitle: { fontFamily: fontFamily.semibold, fontSize: 14, letterSpacing: -0.2 },
  outcomeBody: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: { paddingHorizontal: theme.spacing.screen, paddingTop: 8, paddingBottom: 30 },
  // ── Destination picker sheet ──────────────────────────────────────────────
  // A page sheet gets no system grabber, so it draws its own.
  pickGrabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(11,13,16,0.18)',
    alignSelf: 'center',
    marginTop: 8,
  },
  pickBody: { paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.lg },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  pickPressed: { backgroundColor: 'rgba(11,13,16,0.03)' },
  divider: { borderTopWidth: 1, borderTopColor: theme.colors.separator },
}));
