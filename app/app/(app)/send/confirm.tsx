import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { HoldToConfirm, Icon, SheetNav, Text } from '../../../src/ui';
import { CryptoIcon } from '../../../src/components/CryptoIcon';
import { ChainBadge, needsChainBadge } from '../../../src/components/ChainBadge';
import { TransferRail } from '../../../src/components/TransferRail';
import { BtcSpeedSheet } from '../../../src/components/BtcSpeedSheet';
import { useSession } from '../../../src/stores/session';
import { useWalletName } from '../../../src/stores/walletNameStore';
import { usePortfolio } from '../../../src/stores/portfolioStore';
import { useActivity } from '../../../src/stores/activityStore';
import { useRecentAddresses } from '../../../src/stores/recentAddressStore';
import { useSendNotice } from '../../../src/stores/sendNoticeStore';
import { useSendDraft } from '../../../src/stores/sendDraftStore';
import { sendBtc, sendEvm, sendSol, sendErc20, sendSpl, estimateFee } from '../../../src/bridge/transfer';
import { paySend, spend, spendToMeta, spendMulti, spendMultiToMeta, spendErc20Sponsored, spendErc20SponsoredToMeta, planSolSpend, planEvmSpend, planSolSweep, planEvmSweep, planTokenSpend, planTokenSweep, evmReserveFromFeeEth, stealthTxUrl, chainForFamily, chainForChainId, chainForPayment, stealthHoldingId, stealthPaymentAsset, type StealthChain } from '../../../src/bridge/stealth';
import { useStealth } from '../../../src/stores/stealthStore';
import { usePendingBalance, usePendingStealth } from '../../../src/stores/pendingBalanceStore';
import { sendReceiveHint } from '../../../src/bridge/seamless';
import type { PortfolioAsset } from '../../../src/bridge/portfolio';
import { pendingSendItem, privateSendItem } from '../../../src/bridge/activity';
import { waitForTxMined } from '../../../src/bridge/receipts';
import { chainOf, trimNum } from '../../../src/lib/sendHelpers';

/** Map a picked asset to its stealth chain (BTC/EVM/SOL native families). */
function stealthChainFor(a: PortfolioAsset): StealthChain | undefined {
  const c = chainOf(a); // 'btc' | 'sol' | 'eth'
  // EVM: resolve by the asset's actual chain id so a private pay goes out on the
  // asset's chain (not the default). BTC/SOL: by family.
  if (c === 'eth') return chainForChainId(a.evmChainId ?? 0n);
  return chainForFamily(c === 'btc' ? 0 : 2);
}
import { requireAuth, authFailureMessage } from '../../../src/lib/biometrics';
import { mapError } from '../../../src/lib/errors';
import { formatUsd, formatCrypto, formatFee, formatTotal, relativeTime } from '../../../src/lib/format';
import { chainName } from '../../../src/lib/chains';
import { fontFamily } from '../../../src/theme/fonts';
import { posthog } from '../../../src/lib/posthog';

export default function SendConfirm() {
  const router = useRouter();
  const navigation = useNavigation();
  const theme = UnistylesRuntime.getTheme();
  const wallet = useSession((s) => s.wallet);
  const addresses = useSession((s) => s.addresses);
  const walletName = useWalletName((s) => s.name);
  const { market, refresh } = usePortfolio();
  const recents = useRecentAddresses();
  const asset = useSendDraft((s) => s.asset);
  const address = useSendDraft((s) => s.address);
  const amount = useSendDraft((s) => s.amount);
  const usdMode = useSendDraft((s) => s.usdMode);
  const fee = useSendDraft((s) => s.fee);
  const sending = useSendDraft((s) => s.sending);
  const shield = useSendDraft((s) => s.shield);
  const recipientHandle = useSendDraft((s) => s.recipientHandle);
  const privateFlow = useSendDraft((s) => s.privateFlow);
  const spendSource = useSendDraft((s) => s.spendSource);
  const spendSources = useSendDraft((s) => s.spendSources);
  const sweep = useSendDraft((s) => s.sweep);
  const btcSatPerVb = useSendDraft((s) => s.btcSatPerVb);
  const patch = useSendDraft((s) => s.patch);

  const [speedOpen, setSpeedOpen] = useState(false);
  useEffect(() => {
    recents.hydrate();
  }, [recents]);

  if (!asset) return null;

  const isBtc = chainOf(asset) === 'btc';

  const price = market[asset.coingeckoId]?.price ?? 0;
  const entered = parseFloat(amount) || 0;
  const cryptoAmount = usdMode ? (price > 0 ? entered / price : 0) : entered;
  const sendAmountStr = usdMode ? trimNum(cryptoAmount, Math.min(asset.decimals ?? 8, 8)) : amount;
  // Balance guard. The amount step enforces this too, but a scan-to-pay with an
  // embedded amount jumps STRAIGHT here (skipping that step), so without this a
  // QR requesting more than you hold would reach Review with Send enabled and
  // only fail at broadcast. `asset.amount` is the spendable amount for this
  // asset (a normal balance, or a stealth aggregate's spendable total).
  const insufficient = cryptoAmount > asset.amount;
  const feeSymbol = asset.feeSymbol ?? asset.symbol;
  const feePrice = market[asset.feeCoingeckoId ?? asset.coingeckoId]?.price ?? 0;

  function dismissSheet() {
    const parent = navigation.getParent();
    if (parent) parent.goBack();
    else router.back();
  }

  async function doSend() {
    if (!wallet || !asset) return;
    // A send moves funds → confirm with Face ID. This is the single per-transaction
    // biometric; signing itself uses the seed cached at unlock (so it doesn't
    // prompt again within the cache window). If the user cancels Face ID, abort.
    const auth = await requireAuth(`Confirm to send ${formatCrypto(cryptoAmount)} ${asset.symbol}`);
    if (!auth.ok) {
      // Fails CLOSED. A device with no passcode cannot authorise a payment, and
      // saying so beats silently sending — which is what the old permissive
      // helper did here.
      if (auth.reason === 'no-device-auth') {
        useSendNotice.getState().show('error', authFailureMessage(auth.reason));
      }
      return;
    }
    patch({ sending: true });
    try {
      // Route through the private stealth path when the destination is a stealth
      // meta-address — whether that's a self-shield (chooser "Shield" → your own
      // meta), a private pay, or a NORMAL send to someone ELSE's scanned/typed
      // stealth1. `shield` alone no longer decides this: sending to another's
      // stealth is an ordinary "Send" (not a "Shield"), it just settles privately.
      // Spend has its own block below, so exclude it here.
      const toStealth = address.trim().toLowerCase().startsWith('stealth1');
      if (shield || (toStealth && privateFlow !== 'spend')) {
        // SPL tokens aren't supported privately; EVM ERC-20 (tokenContract) is.
        if (asset.tokenMint) throw new Error('Private SPL token sends aren’t supported yet.');
        const chain = stealthChainFor(asset);
        if (!chain) throw new Error('This asset can’t be sent privately.');
        // ERC-20 → send via transfer on the token; native → value transfer.
        const token = asset.tokenContract ? { contract: asset.tokenContract, decimals: asset.decimals ?? 18 } : undefined;
        if (token && chain.family !== 1) throw new Error('Private token sends are EVM-only.');
        const receipt = await paySend(wallet, { recipientMeta: address.trim(), chain, amountHuman: sendAmountStr, token });
        posthog.capture('transaction_sent', {
          asset_symbol: asset.symbol,
          chain: chainOf(asset),
          shield: true,
          is_token: !!token,
        });
        // A SELF-shield (funding your own stealth balance) is represented by the
        // incoming "Private receive" the scan surfaces — so DON'T also record an
        // outgoing "Private send", or the same $ shows up twice. Only record the
        // send row when paying SOMEONE ELSE's stealth address.
        const ownMeta = useStealth.getState().metaAddress;
        const isSelfShield = !!ownMeta && address.trim() === ownMeta;
        if (isSelfShield) {
          // Self-shield: the funding tx (main account → your stealth address) is
          // surfaced by the NORMAL scan as a plain "Sent" — mark it "Shielded" so
          // the public feed reads correctly. The matching incoming "Received" shows
          // in the private feed via the stealth scan. (Non-private → normal feed.)
          useActivity.getState().prepend(
            pendingSendItem({
              chain: chainOf(asset),
              id: receipt.canonicalTxid,
              amount: cryptoAmount,
              usd: cryptoAmount * price,
              explorerUrl: stealthTxUrl(chain, receipt.canonicalTxid),
              network: asset.networkName,
              shielded: true,
              asset: { symbol: asset.symbol, coingeckoId: asset.coingeckoId, colorHex: asset.colorHex },
            }),
          );
          // Optimistically CREDIT the private balance so the shield shows in the
          // stealth home instantly (before the funding tx confirms + the scan reads
          // the balance). Baseline-anchored to the current confirmed private holding
          // so it can't double-count; reconciled/reversed by pendingStealth.
          {
            const fam = chainOf(asset) === 'btc' ? 0 : chainOf(asset) === 'sol' ? 2 : 1;
            const kind = fam === 0 ? 'btc' : fam === 2 ? 'sol' : 'evm';
            const assetId = stealthHoldingId(fam, asset.tokenContract);
            const baseline = useStealth
              .getState()
              .payments.filter((p) => stealthHoldingId(p.chainFamily, p.tokenContract) === assetId)
              .reduce((s, p) => s + stealthPaymentAsset(p).amount, 0);
            usePendingStealth.getState().addReceive({
              key: receipt.canonicalTxid,
              txHash: receipt.canonicalTxid,
              assetId,
              chainKind: kind,
              chainId: asset.evmChainId?.toString(),
              baseline,
              amount: cryptoAmount,
              meta: {
                symbol: asset.symbol,
                decimals: asset.decimals,
                coingeckoId: asset.coingeckoId,
                colorHex: asset.colorHex,
                chain: asset.chain,
                name: asset.name,
                imageUrl: asset.imageUrl,
                evmChainId: asset.evmChainId?.toString(),
                tokenContract: asset.tokenContract,
                tokenMint: asset.tokenMint,
                networkName: asset.networkName,
              },
            });
          }
        }
        if (!isSelfShield) {
          // Paying someone privately: tag it private. The funding tx is from the
          // main account so the on-chain scan reconciles it (start pending).
          useActivity.getState().prepend(
            privateSendItem({
              chain: chainOf(asset),
              id: receipt.canonicalTxid,
              amount: cryptoAmount,
              usd: cryptoAmount * price,
              explorerUrl: stealthTxUrl(chain, receipt.canonicalTxid),
              status: 'pending',
              label: recipientHandle ? `To ${recipientHandle}` : undefined,
              shielded: true, // funds moved into privacy → row reads "Shielded"
              // ERC-20 pay → show the token (e.g. USDC), not the native symbol.
              asset: { symbol: asset.symbol, coingeckoId: asset.coingeckoId, colorHex: asset.colorHex },
            }),
          );
        }
        // Record the @handle (not the long meta-address) so it shows in recents.
        if (recipientHandle) recents.record(recipientHandle);
        refresh();
        // Re-scan so a self-shield surfaces its incoming "Private receive".
        void useStealth.getState().scanNow();
        // Poll the chain to flip this pending private send to confirmed/failed.
        void useActivity.getState().watchPrivatePending();
        dismissSheet();
        // "Shielded" only when funding your OWN stealth balance; a private send to
        // someone else's stealth reads as a normal "Sent".
        const msg = isSelfShield
          ? `Shielded ${formatCrypto(cryptoAmount)} ${asset.symbol}`
          : `Sent ${formatCrypto(cryptoAmount)} ${asset.symbol}`;
        setTimeout(() => useSendNotice.getState().show('sent', msg), 1500);
        return;
      }
      // Spend received: move funds from a received stealth payment to a normal
      // address (signed by the one-time stealth address, not the main account).
      if (privateFlow === 'spend' && (spendSources || spendSource)) {
        // Destination can be a normal address (spend) or a stealth address /
        // resolved @username (stealth → stealth, private on both ends).
        const toStealth = !!recipientHandle || address.trim().toLowerCase().startsWith('stealth1');
        const dest = address.trim();
        const sources = spendSources ?? [spendSource!];
        const family = sources[0].chainFamily;
        // Resolve by the source payment so EVM explorer links use its actual chain.
        const sc = chainForPayment(sources[0]);
        const srcChainId = sources[0].chainId;
        const isToken = !!sources[0].tokenContract;

        if (isToken) {
          // ERC-20: gas-sponsored (EIP-7702). One sponsored spend per source. To a
          // normal address via spendErc20Sponsored; to a stealth meta-address via
          // spendErc20SponsoredToMeta (private on both ends — derives the
          // recipient's one-time address + announces to their mailbox).
          const legs = sweep ? planTokenSweep(sources) : planTokenSpend(sources, sendAmountStr);
          if (!legs || legs.length === 0) throw new Error('Not enough token balance.');
          for (const [i, leg] of legs.entries()) {
            const r = toStealth
              ? await spendErc20SponsoredToMeta(wallet, leg.payment, dest, leg.human)
              : await spendErc20Sponsored(wallet, leg.payment, dest, leg.human);
            const legAmt = parseFloat(leg.human) || 0;
            useActivity.getState().prepend(
              privateSendItem({
                chain: chainOf(asset),
                id: r.txid,
                amount: legAmt,
                usd: legAmt * price,
                explorerUrl: sc ? stealthTxUrl(sc, r.txid) : '',
                status: 'pending',
                label: toStealth ? (recipientHandle ? `To ${recipientHandle}` : 'Private send') : 'Private spend',
                chainId: Number(leg.payment.chainId),
                asset: { symbol: asset.symbol, coingeckoId: asset.coingeckoId, colorHex: asset.colorHex },
              }),
            );
            // Each source is a distinct EIP-7702 delegated account, and the node
            // allows only ONE in-flight tx per such account — so wait for this
            // leg to mine before broadcasting the next.
            if (i < legs.length - 1) await waitForTxMined(1, r.txid, leg.payment.chainId);
          }
        } else if (spendSources && family === 0) {
          // BTC aggregate → ONE multi-input transaction. To a normal address via
          // spendMulti; to a stealth meta-address via spendMultiToMeta (private
          // on both ends — one tx, one fee, announced to the recipient).
          const r = toStealth
            ? await spendMultiToMeta(wallet, spendSources, dest, sendAmountStr, sweep)
            : await spendMulti(wallet, spendSources, dest, sendAmountStr, sweep);
          useActivity.getState().prepend(
            privateSendItem({
              chain: chainOf(asset),
              id: r.txid,
              amount: cryptoAmount,
              usd: cryptoAmount * price,
              explorerUrl: sc ? stealthTxUrl(sc, r.txid) : '',
              status: 'pending',
              label: toStealth ? (recipientHandle ? `To ${recipientHandle}` : 'Private send') : 'Private spend',
              asset: { symbol: asset.symbol, coingeckoId: asset.coingeckoId, colorHex: asset.colorHex },
            }),
          );
        } else {
          // Account chains (SOL/EVM): auto-select sources, one tx per source.
          // EVM uses a LIVE gas estimate per source (fresh at send time).
          let evmReserve: bigint | undefined;
          if (spendSources && family === 1) {
            evmReserve = evmReserveFromFeeEth(await estimateFee(wallet, 'eth', srcChainId, false));
          }
          // Sweep (MAX) drains every source in exact atomic units; otherwise
          // coin-select across sources to cover the entered amount.
          const legs = spendSources
            ? family === 1
              ? sweep
                ? planEvmSweep(spendSources, evmReserve)
                : planEvmSpend(spendSources, sendAmountStr, evmReserve)
              : sweep
                ? planSolSweep(spendSources)
                : planSolSpend(spendSources, sendAmountStr)
            : [{ payment: spendSource!, human: sendAmountStr }];
          if (!legs || legs.length === 0) throw new Error('Not enough spendable balance after fees.');
          for (const leg of legs) {
            const r = toStealth
              ? await spendToMeta(wallet, leg.payment, dest, leg.human)
              : await spend(wallet, leg.payment, dest, leg.human);
            const legAmt = parseFloat(leg.human) || 0;
            useActivity.getState().prepend(
              privateSendItem({
                chain: chainOf(asset),
                id: r.txid,
                amount: legAmt,
                usd: legAmt * price,
                explorerUrl: sc ? stealthTxUrl(sc, r.txid) : '',
                status: 'pending',
                label: toStealth ? (recipientHandle ? `To ${recipientHandle}` : 'Private send') : 'Private spend',
                chainId: family === 1 ? Number(leg.payment.chainId) : undefined,
                asset: { symbol: asset.symbol, coingeckoId: asset.coingeckoId, colorHex: asset.colorHex },
              }),
            );
          }
        }
        posthog.capture('transaction_sent', { asset_symbol: asset.symbol, chain: chainOf(asset), shield: true });
        // Re-scan so the spent balances refresh.
        void useStealth.getState().scanNow();
        refresh();
        // Poll the chain to flip these pending spends to confirmed/failed.
        void useActivity.getState().watchPrivatePending();
        dismissSheet();
        const msg = `Sent ${formatCrypto(cryptoAmount)} ${asset.symbol} privately`;
        setTimeout(() => useSendNotice.getState().show('sent', msg), 1500);
        return;
      }
      const res = asset.tokenContract
        ? await sendErc20(wallet, asset.tokenContract, asset.decimals, address.trim(), sendAmountStr, asset.evmChainId)
        : asset.tokenMint
          ? await sendSpl(wallet, asset.tokenMint, asset.decimals, address.trim(), sendAmountStr)
          : chainOf(asset) === 'btc'
            ? await sendBtc(wallet, address.trim(), sendAmountStr, btcSatPerVb != null ? BigInt(btcSatPerVb) : undefined)
            : chainOf(asset) === 'sol'
              ? await sendSol(wallet, address.trim(), sendAmountStr)
              : await sendEvm(wallet, address.trim(), sendAmountStr, asset.evmChainId);
      const isToken = !!asset.tokenContract || !!asset.tokenMint;
      posthog.capture('transaction_sent', {
        asset_symbol: asset.symbol,
        chain: chainOf(asset),
        shield: false,
        is_token: isToken,
        network: asset.networkName ?? null,
      });
      useActivity.getState().prepend(
        pendingSendItem({
          chain: chainOf(asset),
          id: res.id,
          to: address.trim(), // the RECIPIENT — the row shows "To 0x…", not the tx hash
          // Resolved from a name? Keep it. A later chain scan only sees the
          // address and cannot recover what the user actually typed.
          peerName: recipientHandle ?? undefined,
          amount: cryptoAmount,
          usd: cryptoAmount * price,
          explorerUrl: res.explorerUrl,
          asset: { symbol: asset.symbol, coingeckoId: asset.coingeckoId, colorHex: asset.colorHex },
          network: asset.networkName,
        }),
      );
      recents.record(address.trim());
      // Self-send (destination is one of OUR OWN addresses): the funds come right
      // back, so the confirmed balance only drops by the fee — NOT by `amount`.
      // Applying the optimistic debit here would show the balance as `−amount`
      // (too low) until the delta's TTL expires, because the real balance never
      // falls by `amount` for the debit to settle against. So skip the debit (and
      // the receive-hint, which is pointless to yourself) when sending to self.
      const ownAddrs = useSession.getState().addresses;
      const dest = address.trim();
      const isSelfSend =
        !!ownAddrs &&
        (dest === ownAddrs.btc || dest === ownAddrs.sol || dest.toLowerCase() === ownAddrs.eth?.toLowerCase());
      // Optimistic debit: subtract the sent amount from the DISPLAYED balance the
      // instant we broadcast, so it feels updated before the RPC catches up. This
      // never touches the confirmed balance — pendingBalanceStore folds it in for
      // display only and reverses/absorbs it against the real on-chain balance, so
      // it can't double-count or go stale. (Skip tokenMint SPL: id still applies.)
      if (!isSelfSend) {
        const kind = chainOf(asset) === 'btc' ? 'btc' : chainOf(asset) === 'sol' ? 'sol' : 'evm';
        usePendingBalance.getState().addSend({
          key: res.id,
          txHash: res.id,
          assetId: asset.id,
          chainKind: kind,
          chainId: asset.evmChainId?.toString(),
          // Confirmed balance BEFORE this send posts — the anchor the optimistic
          // debit shrinks against as the real balance catches up.
          baseline: usePortfolio.getState().confirmedAssets.find((a) => a.id === asset.id)?.amount ?? 0,
          amount: cryptoAmount,
          meta: {
            symbol: asset.symbol,
            decimals: asset.decimals,
            coingeckoId: asset.coingeckoId,
            colorHex: asset.colorHex,
            chain: asset.chain,
            name: asset.name,
            imageUrl: asset.imageUrl,
            evmChainId: asset.evmChainId?.toString(),
            tokenContract: asset.tokenContract,
            tokenMint: asset.tokenMint,
            networkName: asset.networkName,
          },
        });
      }
      // Encrypted receive-hint to the recipient so THEIR wallet credits instantly
      // (only fires for @handle recipients who've published an enc key; otherwise
      // a no-op and their normal RPC scan surfaces it). Pointless for a self-send.
      if (!isSelfSend) {
        void sendReceiveHint({ asset, amount: cryptoAmount, toAddress: address.trim(), handle: recipientHandle, txHash: res.id });
      }
      refresh();
      dismissSheet();
      // Show the pill ~1.5s LATER — after the sheet is fully gone and the home
      // screen has settled. show() fires the haptic itself at that clean, idle
      // moment (firing during/right after the dismiss gets it dropped by iOS).
      const msg = `Sent ${formatCrypto(cryptoAmount)} ${asset.symbol}`;
      setTimeout(() => useSendNotice.getState().show('sent', msg), 1500);
    } catch (e) {
      console.warn('[send] failed:', e);
      posthog.capture('transaction_failed', {
        asset_symbol: asset?.symbol ?? null,
        chain: asset ? chainOf(asset) : null,
        shield,
        error: mapError(e).title,
      });
      dismissSheet();
      const errMsg = mapError(e).title;
      setTimeout(() => useSendNotice.getState().show('error', errMsg), 1000);
    } finally {
      patch({ sending: false });
    }
  }

  // ── what the review actually has to show ─────────────────────────────────
  const family = chainOf(asset);
  const fromAddress = addresses
    ? family === 'btc'
      ? addresses.btc
      : family === 'sol'
        ? addresses.sol
        : addresses.eth
    : undefined;
  // The asset carries its own network name; `chainName` covers the chains the
  // registry has no label for (Arc included).
  const network =
    asset.networkName ??
    (asset.evmChainId !== undefined ? chainName(asset.evmChainId) : undefined) ??
    (family === 'btc' ? 'Bitcoin' : family === 'sol' ? 'Solana' : undefined);
  const isPrivate = shield || privateFlow === 'spend';
  // Only meaningful when the fee comes out of the SAME balance as the transfer —
  // a token's gas is paid in the chain's native coin, so there is no single
  // figure to total. Private paths take their fee inside the stealth path.
  const feeInSameAsset = !isPrivate && !asset.tokenContract && !asset.tokenMint;
  const total = feeInSameAsset && fee != null ? cryptoAmount + fee : null;
  // Matched on the handle as well as the address: a send to `@alice` is recorded
  // under the handle, so comparing addresses alone would call a familiar
  // recipient new the moment they were paid by name.
  const dest = address.trim().toLowerCase();
  const seenBefore = recents.list.find(
    (r) => r.address.toLowerCase() === dest || (!!recipientHandle && r.address.toLowerCase() === recipientHandle.toLowerCase()),
  );

  return (
    <View style={styles.body}>
      <Stack.Screen options={{ headerShown: false }} />

      <SheetNav
        title="Review"
        subtitle="Nothing moves until you hold Send."
        onLeading={() => router.back()}
      />

      {/* Scrolls, so a long recipient or an extra fact row cannot push the
          action off a small screen. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollBody}
        showsVerticalScrollIndicator={false}
      >
        {/* The figure, centred under its own mark. Left-aligned with the icon
            floating off to the right, the two read as unrelated objects. */}
        <View style={styles.hero}>
          <View style={styles.heroArt}>
            <CryptoIcon
              coingeckoId={asset.coingeckoId}
              symbol={asset.symbol}
              colorHex={asset.colorHex}
              imageUrl={asset.imageUrl}
              size={44}
            />
            {needsChainBadge(asset) && (
              <View style={styles.heroBadge}>
                <ChainBadge
                  chainId={asset.evmChainId !== undefined ? Number(asset.evmChainId) : undefined}
                  network={asset.chain === 'solana' ? 'Solana' : undefined}
                  size={17}
                  ringColor={theme.colors.appBackground}
                />
              </View>
            )}
          </View>
          <Text style={styles.heroAmount} numberOfLines={1} adjustsFontSizeToFit>
            {formatCrypto(cryptoAmount)} {asset.symbol}
          </Text>
          <Text style={styles.heroUsd}>{formatUsd(cryptoAmount * price)}</Text>
        </View>

        <TransferRail
          fromName={walletName}
          fromAddress={fromAddress}
          toName={recipientHandle}
          toAddress={address}
          network={network}
          chainId={asset.evmChainId !== undefined ? Number(asset.evmChainId) : undefined}
          via={isPrivate ? 'Private' : undefined}
        />

        {/* Have they been paid before? The one thing a review screen can tell
            you that the amount and the fee cannot: whether this destination is
            new. A mistyped address is always new, and someone you pay weekly
            never is — which makes this the cheapest catch on the screen. */}
        <View style={[styles.history, seenBefore ? styles.historyKnown : styles.historyNew]}>
          <Icon
            name={seenBefore ? 'checkCircle' : 'info'}
            size={14}
            color={seenBefore ? theme.colors.success : theme.colors.warning}
          />
          <Text style={styles.historyText}>
            {seenBefore
              ? `You sent here ${relativeTime(seenBefore.ts)}`
              : 'First time sending to this address'}
          </Text>
        </View>

        {/* Shield + spend settle via the private path — the network fee is
            handled inside the stealth path, so there is nothing to show. */}
        {!isPrivate && (
          <View style={styles.card}>
            <Pressable
              style={styles.row}
              disabled={!isBtc}
              onPress={
                isBtc
                  ? () => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSpeedOpen(true);
                    }
                  : undefined
              }
            >
              <Text style={styles.rowLabel}>Network fee</Text>
              <View style={styles.rowRight}>
                <Text style={styles.rowValue} numberOfLines={1}>
                  {fee != null ? `${formatFee(fee)} ${feeSymbol}` : 'Estimating…'}
                </Text>
                {fee != null && feePrice > 0 && (
                  <Text style={styles.rowSub}>{formatUsd(fee * feePrice)}</Text>
                )}
                {/* BTC is the one chain whose fee is a choice the payer makes. */}
                {isBtc && <Icon name="chevronRight" size={16} color={theme.colors.faint} />}
              </View>
            </Pressable>

            {total != null && (
              <>
                <View style={styles.hair} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Leaves your wallet</Text>
                  <Text style={styles.rowValue} numberOfLines={1}>
                    {formatTotal(total, cryptoAmount)} {asset.symbol}
                  </Text>
                </View>
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* The warning belongs BESIDE the action, not in a subtitle three hundred
          points above it where it is read once and forgotten. */}
      <View style={styles.notice}>
        <Icon name="info" size={13} color={theme.colors.muted} />
        <Text style={styles.noticeText}>Sent funds cannot be recalled. Check the address above.</Text>
      </View>

      <HoldToConfirm
        label="Hold to send"
        holdingLabel="Keep holding"
        icon="faceid"
        busy={sending}
        busyLabel="Sending"
        disabled={insufficient}
        disabledLabel="Not enough balance"
        onConfirm={doSend}
      />

      {isBtc && <BtcSpeedSheet visible={speedOpen} onClose={() => setSpeedOpen(false)} />}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // No top padding: `SheetNav` owns the clearance above the grabber, and
  // stacking both left the nav row floating in the middle of nowhere.
  body: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingBottom: 30 },
  scroll: { flex: 1, marginHorizontal: -theme.spacing.screen },
  scrollBody: { paddingHorizontal: theme.spacing.screen, paddingTop: 18, paddingBottom: 14, gap: 14 },

  hero: { alignItems: 'center', gap: 10, paddingBottom: 4 },
  heroArt: { width: 44, height: 44 },
  heroBadge: { position: 'absolute', right: -4, bottom: -3 },
  heroAmount: { fontSize: 40, fontFamily: fontFamily.semibold, letterSpacing: -1.2, color: theme.colors.text },
  heroUsd: { fontSize: 16, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.muted, marginTop: -4 },

  card: {
    backgroundColor: theme.colors.cardBackground,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  hair: { height: 1, marginHorizontal: 14, backgroundColor: theme.colors.separator },
  // The label steps back so the VALUE is what you read down the card — on a
  // review screen the values are the content and the labels are the index.
  rowLabel: { fontSize: 13.5, fontFamily: fontFamily.medium, letterSpacing: -0.2, color: theme.colors.muted },
  rowRight: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowValue: { flexShrink: 1, fontSize: 14, fontFamily: fontFamily.semibold, letterSpacing: -0.2, color: theme.colors.text },
  rowSub: { fontSize: 13, fontFamily: fontFamily.medium, letterSpacing: -0.18, color: theme.colors.muted },

  history: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: theme.radius.lg,
  },
  // Tinted, not carded: it is a remark about the rail above it, not another fact.
  historyNew: { backgroundColor: 'rgba(255,149,0,0.12)' },
  historyKnown: { backgroundColor: theme.colors.tile },
  historyText: { flex: 1, fontSize: 12.5, fontFamily: fontFamily.medium, letterSpacing: -0.18, color: theme.colors.text },

  notice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingBottom: 12 },
  noticeText: { fontSize: 12, fontFamily: fontFamily.medium, letterSpacing: -0.16, color: theme.colors.muted },
}));
