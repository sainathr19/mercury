import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Card, Field, Icon, Text, useToast } from '../../src/ui';
import { BottomSheet } from '../../src/components/BottomSheet';
import { PinPad } from '../../src/components/PinPad';
import { CardFeeSelector } from '../../src/components/CardFeeSelector';
import { useHardwareCard } from '../../src/stores/hardwareCardStore';
import { CardError } from '../../src/bridge/walletCard';
import {
  setPendingPin,
  loadLastBtcPayment,
  bumpCardBtcPayment,
  type PairedCard,
  type LastCardBtcPayment,
} from '../../src/bridge/hardwareWallet';
import { cardSend } from '../../src/bridge/cardTransfer';
import { type FeeTier, type FeeKey } from '../../src/bridge/liveFees';
import { cardChainMeta, CARD_CHAINS, type CardChain } from '../../src/lib/cardChains';
import { nfcAvailable } from '../../src/bridge/nfc';
import { shortenAddress } from '../../src/lib/format';

export default function Cards() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const { card, hydrated, hydrate, forget } = useHardwareCard();
  const [available, setAvailable] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [boostOpen, setBoostOpen] = useState(false);
  const [lastBtc, setLastBtc] = useState<LastCardBtcPayment | null>(null);

  const refreshLast = () => loadLastBtcPayment().then(setLastBtc).catch(() => {});

  useEffect(() => {
    hydrate();
    refreshLast();
    nfcAvailable().then(setAvailable).catch(() => setAvailable(false));
  }, [hydrate]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Icon name="chevronLeft" size={24} color={theme.colors.text} />
        </Pressable>
        <Text variant="headline">Cards</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {!available && (
          <Card>
            <Text variant="bodyMedium" color={theme.colors.danger}>
              NFC is unavailable on this device. Card features require a physical device with NFC.
            </Text>
          </Card>
        )}

        {/* Accept-a-payment is available to anyone — no card of your own needed.
            Always shown so the option is discoverable; disabled with a hint when
            NFC is unavailable (e.g. a simulator), since the tap-to-pay read needs it. */}
        <Pressable onPress={() => router.push('/(app)/card-receive/amount')} disabled={!available}>
          <Card style={!available ? styles.disabledCard : undefined}>
            <View style={styles.acceptRow}>
              <View style={styles.acceptGlyph}>
                <Icon name="receive" size={20} color={theme.colors.primaryLabel} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="subheadBold">Request a payment</Text>
                <Text variant="micro" color={theme.colors.muted}>
                  {available ? 'Have someone tap their card to pay you' : 'Requires a device with NFC'}
                </Text>
              </View>
              <Icon name="chevronRight" size={16} color={theme.colors.muted} />
            </View>
          </Card>
        </Pressable>

        {/* Boost (RBF) the most recent card BTC payment if it's still unconfirmed. */}
        {lastBtc && (
          <Pressable onPress={() => setBoostOpen(true)}>
            <Card>
              <View style={styles.acceptRow}>
                <View style={[styles.acceptGlyph, { backgroundColor: theme.colors.warning }]}>
                  <Icon name="trendUp" size={18} color={theme.colors.primaryLabel} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="subheadBold">Boost fee (RBF)</Text>
                  <Text variant="micro" color={theme.colors.muted} numberOfLines={1}>
                    Recent BTC payment {lastBtc.txid.slice(0, 10)}… · {lastBtc.feeRateSatVb} sat/vB
                  </Text>
                </View>
                <Icon name="chevronRight" size={16} color={theme.colors.muted} />
              </View>
            </Card>
          </Pressable>
        )}

        {!hydrated ? (
          <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 40 }} />
        ) : card ? (
          <PairedCardView card={card} onSend={() => setSendOpen(true)} onRemove={forget} />
        ) : (
          <EmptyState onPair={() => setSetupOpen(true)} />
        )}
      </ScrollView>

      {setupOpen && <CardSetupWizard onClose={() => setSetupOpen(false)} />}
      {card && sendOpen && (
        <CardSendSheet
          card={card}
          onClose={() => {
            setSendOpen(false);
            refreshLast();
          }}
        />
      )}
      {boostOpen && lastBtc && (
        <CardBoostSheet
          payment={lastBtc}
          onClose={() => {
            setBoostOpen(false);
            refreshLast();
          }}
        />
      )}
    </SafeAreaView>
  );
}

// ---- Empty state -----------------------------------------------------------

function EmptyState({ onPair }: { onPair: () => void }) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <View style={styles.empty}>
      <View style={styles.cardArt}>
        <Icon name="wallet" size={40} color={theme.colors.primaryLabel} />
      </View>
      <Text variant="headlineSmall">Set up your card</Text>
      <Text variant="bodyMedium" color={theme.colors.muted} style={styles.center}>
        Pair a Standard hardware card to tap-to-pay and sign transactions. Your wallet keys are written onto the card behind a PIN.
      </Text>
      <View style={{ height: 8 }} />
      <Button title="Pair a card" icon={<Icon name="plus" size={18} color={theme.colors.primaryLabel} />} onPress={onPair} />
    </View>
  );
}

// ---- Paired card view ------------------------------------------------------

function PairedCardView({ card, onSend, onRemove }: { card: PairedCard; onSend: () => void; onRemove: () => Promise<void> }) {
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    show(`${label} address copied`, 'success');
  };

  return (
    <View style={{ gap: 16 }}>
      {/* Card visual */}
      <View style={styles.cardVisual}>
        <View style={styles.cardVisualTop}>
          <Text variant="bodyBold" color="#fff">
            {card.label}
          </Text>
          <Icon name="wallet" size={24} color="#fff" />
        </View>
        <Text variant="caption" color="rgba(255,255,255,0.7)">
          STANDARD CARD
        </Text>
        <Text variant="subheadBold" color="#fff">
          {shortenAddress(card.ethAddress, 6, 4)}
        </Text>
      </View>

      <Button title="Send from card" icon={<Icon name="send" size={16} color={theme.colors.primaryLabel} />} onPress={onSend} />

      <Card flush>
        <AddressRow label="Ethereum" value={card.ethAddress} onCopy={() => copy('Ethereum', card.ethAddress)} />
        <AddressRow label="Bitcoin" value={card.btcAddress} divider onCopy={() => copy('Bitcoin', card.btcAddress)} />
        <AddressRow label="Solana" value={card.solAddress} divider onCopy={() => copy('Solana', card.solAddress)} />
      </Card>

      <Button title="Remove card" variant="danger" onPress={() => setConfirmRemove(true)} />

      <BottomSheet visible={confirmRemove} onClose={() => setConfirmRemove(false)}>
        <Text variant="headline" style={{ marginBottom: 8 }}>
          Remove this card?
        </Text>
        <Text variant="bodyMedium" color={theme.colors.muted} style={{ marginBottom: 20 }}>
          This only forgets the card on this phone. The wallet stays on the card — pair again anytime, or reset the card to wipe it.
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" variant="secondary" onPress={() => setConfirmRemove(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Remove"
              variant="danger"
              onPress={async () => {
                await onRemove();
                setConfirmRemove(false);
                show('Card removed', 'success');
              }}
            />
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}

function AddressRow({ label, value, divider, onCopy }: { label: string; value: string; divider?: boolean; onCopy: () => void }) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <Pressable style={[styles.addrRow, divider && styles.divider]} onPress={onCopy}>
      <View style={{ flex: 1 }}>
        <Text variant="subheadBold">{label}</Text>
        <Text variant="micro" color={theme.colors.muted} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Icon name="copy" size={16} color={theme.colors.muted} />
    </Pressable>
  );
}

// ---- Setup wizard (ported from CardSetupView) ------------------------------

type Step = 'scanning' | 'pin' | 'writing' | 'cardExists' | 'done';

function CardSetupWizard({ onClose }: { onClose: () => void }) {
  const theme = UnistylesRuntime.getTheme();
  const { detect, pair } = useHardwareCard();
  const [step, setStep] = useState<Step>('scanning');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  async function startDetect() {
    setDetectError(null);
    try {
      await detect();
      setStep('pin');
    } catch (e) {
      setDetectError(msg(e));
    }
  }

  useEffect(() => {
    startDetect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPinComplete(value: string) {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    if (value !== pin) {
      setPinError("PINs don't match. Try again.");
      setConfirm('');
      return;
    }
    setStep('writing');
    write();
  }

  async function write() {
    setWriteError(null);
    try {
      await pair(pin);
      setStep('done');
    } catch (e) {
      if (e instanceof CardError && e.kind === 'alreadyInitialized') setStep('cardExists');
      else setWriteError(msg(e));
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={{ width: 24 }} />
          <Text variant="headline">Pair a card</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Icon name="close" size={22} color={theme.colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.wizardContent}>
          {step === 'scanning' && (
            <View style={styles.wizardCenter}>
              <NfcWave active={!detectError} />
              <Text variant="headlineSmall" style={styles.center}>
                Hold your card near the top of your phone
              </Text>
              <Text variant="caption" color={theme.colors.muted} style={styles.center}>
                The NFC reader starts automatically.
              </Text>
              {detectError && (
                <>
                  <Text variant="caption" color={theme.colors.danger} style={styles.center}>
                    {detectError}
                  </Text>
                  <Button title="Try again" onPress={startDetect} />
                </>
              )}
            </View>
          )}

          {step === 'pin' && (
            <View style={styles.wizardCenter}>
              <Icon name="checkCircle" size={36} color={theme.colors.success} />
              <Text variant="headlineSmall">Card detected!</Text>
              <Text variant="caption" color={theme.colors.muted} style={styles.center}>
                {confirming ? 'Confirm your PIN' : 'Set a 6-digit PIN for your card'}
              </Text>
              {pinError && (
                <Text variant="caption" color={theme.colors.danger}>
                  {pinError}
                </Text>
              )}
              <View style={{ height: 8 }} />
              <PinPad
                value={confirming ? confirm : pin}
                onChange={(v) => {
                  setPinError(null);
                  confirming ? setConfirm(v) : setPin(v);
                }}
                onComplete={onPinComplete}
              />
            </View>
          )}

          {step === 'writing' && (
            <View style={styles.wizardCenter}>
              <NfcWave active={!writeError} />
              <Text variant="headlineSmall" style={styles.center}>
                Hold your card again
              </Text>
              <Text variant="caption" color={theme.colors.muted} style={styles.center}>
                Writing your wallet to the card…
              </Text>
              {writeError && (
                <>
                  <Text variant="caption" color={theme.colors.danger} style={styles.center}>
                    {writeError}
                  </Text>
                  <Button title="Retry" onPress={write} />
                </>
              )}
            </View>
          )}

          {step === 'cardExists' && (
            <View style={styles.wizardCenter}>
              <Icon name="warning" size={44} color={theme.colors.warning} />
              <Text variant="headlineSmall">Card already paired</Text>
              <Text variant="caption" color={theme.colors.muted} style={styles.center}>
                This card already has a wallet. To pair it with a new wallet, reset it first using the reset script on your Mac, then try again.
              </Text>
              <Button
                title="Card reset — pair now"
                variant="secondary"
                onPress={() => {
                  setStep('scanning');
                  startDetect();
                }}
              />
              <Button title="Cancel" variant="ghost" onPress={onClose} />
            </View>
          )}

          {step === 'done' && (
            <View style={styles.wizardCenter}>
              <Icon name="checkCircle" size={64} color={theme.colors.success} />
              <Text variant="headline">Wallet on card!</Text>
              <Text variant="caption" color={theme.colors.muted} style={styles.center}>
                Your card is ready. Hold it near any Standard device to pay.
              </Text>
              <Button title="Done" onPress={onClose} />
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ---- Send-from-card sheet (BTC / SOL) --------------------------------------

function CardSendSheet({ card, onClose }: { card: PairedCard; onClose: () => void }) {
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const [chain, setChain] = useState<CardChain>('btc');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [needPin, setNeedPin] = useState(false);
  const [feeKey, setFeeKey] = useState<FeeKey>('normal');
  const [feeTiers, setFeeTiers] = useState<FeeTier[]>([]);
  const selectedFee = feeTiers.find((t) => t.key === feeKey) ?? feeTiers[0];

  async function submit() {
    setBusy(true);
    setPendingPin(pin);
    try {
      const id = await cardSend(chain, to.trim(), amount, selectedFee, card.btcPubkeyHex, 'Hold your card to sign');
      show(`Sent ✓ ${id.slice(0, 12)}…`, 'success');
      onClose();
    } catch (e) {
      show(msg(e), 'error');
    } finally {
      setBusy(false);
      setPendingPin(null);
    }
  }

  return (
    <BottomSheet visible onClose={() => !busy && onClose()}>
      {needPin ? (
        <>
          <Text variant="headline" style={styles.center}>
            Enter card PIN
          </Text>
          <Text variant="caption" color={theme.colors.muted} style={[styles.center, { marginBottom: 16 }]}>
            Then hold the card to sign.
          </Text>
          <PinPad
            value={pin}
            onChange={setPin}
            onComplete={() => submit()}
          />
          {busy && <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 16 }} />}
        </>
      ) : (
        <>
          <Text variant="headline" style={{ marginBottom: 12 }}>
            Send from card
          </Text>
          <View style={styles.segment}>
            {CARD_CHAINS.map((c) => (
              <Pressable key={c.chain} style={[styles.segmentItem, chain === c.chain && styles.segmentActive]} onPress={() => setChain(c.chain)}>
                <Text variant="subheadBold" color={chain === c.chain ? theme.colors.text : theme.colors.muted}>
                  {c.symbol}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={{ height: 12 }} />
          <Field label="Recipient address" value={to} onChangeText={setTo} placeholder={chain === 'btc' ? 'bc1q…' : 'Solana address'} />
          <View style={{ height: 12 }} />
          <Field label={`Amount (${cardChainMeta(chain).symbol})`} value={amount} onChangeText={setAmount} placeholder="0.0" keyboardType="decimal-pad" />
          <View style={{ height: 12 }} />
          <CardFeeSelector chain={chain} value={feeKey} onChange={setFeeKey} onTiers={setFeeTiers} />
          <View style={{ height: 16 }} />
          <Button title="Continue" onPress={() => setNeedPin(true)} disabled={!to.trim() || !amount.trim()} />
        </>
      )}
    </BottomSheet>
  );
}

// ---- RBF boost sheet (re-sign a card BTC payment at a higher fee) ----------

function CardBoostSheet({ payment, onClose }: { payment: LastCardBtcPayment; onClose: () => void }) {
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);
  const [feeKey, setFeeKey] = useState<FeeKey>('fast');
  const [feeTiers, setFeeTiers] = useState<FeeTier[]>([]);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'pick' | 'pin' | 'done'>('pick');
  const [newTxid, setNewTxid] = useState<string | null>(null);

  const selected = feeTiers.find((t) => t.key === feeKey) ?? feeTiers[0];
  const current = BigInt(payment.feeRateSatVb);
  const tooLow = !!selected?.btcSatPerVb && selected.btcSatPerVb <= current;

  async function boost() {
    if (!selected?.btcSatPerVb) return;
    setBusy(true);
    setPendingPin(pin);
    try {
      const id = await bumpCardBtcPayment(payment, selected.btcSatPerVb);
      setNewTxid(id);
      setStep('done');
    } catch (e) {
      show(msg(e), 'error');
      setStep('pin');
    } finally {
      setBusy(false);
      setPendingPin(null);
    }
  }

  return (
    <BottomSheet visible onClose={() => !busy && onClose()}>
      {step === 'done' ? (
        <View style={{ alignItems: 'center', gap: 12 }}>
          <Icon name="checkCircle" size={56} color={theme.colors.success} />
          <Text variant="headline">Fee boosted</Text>
          <Text variant="caption" color={theme.colors.muted} style={styles.center}>
            Replacement broadcast at {selected?.rateLabel}.
          </Text>
          {newTxid && (
            <Text variant="micro" color={theme.colors.muted} numberOfLines={1}>
              {newTxid.slice(0, 20)}…
            </Text>
          )}
          <Button title="Done" onPress={onClose} />
        </View>
      ) : step === 'pin' ? (
        <>
          <Text variant="headline" style={styles.center}>
            Enter card PIN & tap
          </Text>
          <Text variant="caption" color={theme.colors.muted} style={[styles.center, { marginBottom: 8 }]}>
            Re-signing the payment at {selected?.rateLabel}.
          </Text>
          <PinPad value={pin} onChange={setPin} onComplete={() => boost()} />
          {busy && <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 16 }} />}
        </>
      ) : (
        <>
          <Text variant="headline" style={{ marginBottom: 4 }}>
            Boost fee (RBF)
          </Text>
          <Text variant="caption" color={theme.colors.muted} style={{ marginBottom: 12 }}>
            Currently {payment.feeRateSatVb} sat/vB. Pick a higher rate to speed it up.
          </Text>
          <CardFeeSelector chain="btc" value={feeKey} onChange={setFeeKey} onTiers={setFeeTiers} />
          {tooLow && (
            <Text variant="caption" color={theme.colors.danger} style={{ marginTop: 8 }}>
              Pick a rate higher than the current {payment.feeRateSatVb} sat/vB.
            </Text>
          )}
          <View style={{ height: 16 }} />
          <Button title="Enter PIN & Tap Card" icon={<Icon name="bolt" size={16} color={theme.colors.primaryLabel} />} onPress={() => setStep('pin')} disabled={!selected?.btcSatPerVb || tooLow} />
        </>
      )}
    </BottomSheet>
  );
}

// ---- bits ------------------------------------------------------------------

function NfcWave({ active }: { active: boolean }) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <View style={[styles.nfcWave, { backgroundColor: active ? theme.colors.primary + '14' : theme.colors.danger + '14' }]}>
      <Icon name="bolt" size={40} color={active ? theme.colors.primary : theme.colors.danger} />
    </View>
  );
}

function msg(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.slice(0, 160);
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.screen,
    paddingVertical: theme.spacing.md,
  },
  content: { padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: 80 },
  center: { textAlign: 'center' },
  empty: { alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.xxl },
  cardArt: {
    width: 88,
    height: 88,
    borderRadius: 20,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  cardVisual: {
    height: 180,
    borderRadius: 20,
    backgroundColor: theme.colors.primary,
    padding: theme.spacing.lg,
    justifyContent: 'space-between',
  },
  cardVisualTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.md },
  acceptRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  acceptGlyph: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { borderTopWidth: 1, borderTopColor: theme.colors.separator },
  disabledCard: { opacity: 0.5 },
  wizardContent: { flexGrow: 1, justifyContent: 'center', padding: theme.spacing.lg },
  wizardCenter: { alignItems: 'center', gap: theme.spacing.md },
  nfcWave: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  segment: {
    flexDirection: 'row',
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.md,
    padding: 3,
    gap: 3,
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: theme.spacing.sm, borderRadius: theme.radius.sm },
  segmentActive: { backgroundColor: theme.colors.appBackground },
}));
