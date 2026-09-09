import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, SheetScaffold, Text, useToast, ScreenScaffold } from '../../src/ui';
import { RemoteTokenIcon } from '../../src/components/RemoteTokenIcon';
import { useSession } from '../../src/stores/session';
import { useNetworks } from '../../src/stores/networkStore';
import { useRegistry } from '../../src/stores/registryStore';
import { STEALTH_RELAY_URL } from '../../src/bridge/hubConfig';
import { BTC_NETWORKS, SOL_NETWORKS, EVM_NETWORKS } from '../../src/bridge/networks';
import { chainInEnvironment, environmentLabel, type Environment } from '../../src/lib/environment';
import { chainCircleDomain, chainUsdc } from '../../src/lib/chains';
import { colorForSymbol } from '../../src/lib/asset-color';
import { fontFamily } from '../../src/theme/fonts';
import {
  listChains,
  saveChain,
  resetChain,
  rpcDisplay,
  probeChainId,
  fetchChainList,
  addChainFromList,
  type EvmChainConfig,
  type ChainListEntry,
} from '../../src/bridge/evmAdmin';

/**
 * Networks.
 *
 * This screen decides where every balance read and every broadcast goes, so it
 * is written to make the *current* state legible before it offers to change it:
 * which environment is live, which chain is talking to which endpoint, and
 * whether an endpoint is Mercury's default or something the user typed. The
 * previous version showed a masked URL under each chain name and nothing else,
 * which is exactly the information that does not tell you whether anything is
 * wrong.
 */
export default function Networks() {
  const theme = UnistylesRuntime.getTheme();
  const wallet = useSession((s) => s.wallet);
  const { environment, choices, relayUrl, setEnvironment, setRelay } = useNetworks();
  const registry = useRegistry((s) => s.registry);
  const show = useToast((s) => s.show);

  const [chains, setChains] = useState<EvmChainConfig[]>([]);
  const [editing, setEditing] = useState<EvmChainConfig | null>(null);
  const [showRelay, setShowRelay] = useState(false);
  const [showChainList, setShowChainList] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (wallet) listChains(wallet).then(setChains).catch(() => {});
  }, [wallet]);

  // The built-in RPC for each chain, so a row can say whether its endpoint is
  // still Mercury's or one the user typed. "Custom" is the single most useful
  // thing to know on this screen — it is the only state that can be *wrong*.
  const defaultRpc = useMemo(() => {
    const m = new Map<string, string>();
    try {
      for (const c of wallet?.evmDefaultChains() ?? []) m.set(c.chainId.toString(), c.rpcUrl);
    } catch {}
    return m;
  }, [wallet]);

  // Only the active environment's chains are shown (the other env is disabled).
  const envChains = useMemo(
    () => chains.filter((c) => chainInEnvironment(c.chainId, environment)),
    [chains, environment],
  );
  const enabledCount = envChains.filter((c) => c.enabled).length;
  // The relay actually in force: the user's, else the build's baked-in one,
  // which may be absent entirely. Read only by the hidden relay row below —
  // kept so uncommenting that block needs no other change.
  const effectiveRelay = relayUrl || STEALTH_RELAY_URL || '';

  async function onEnvironment(next: Environment) {
    if (switching || next === environment) return;
    setSwitching(true);
    try {
      await setEnvironment(next);
      if (wallet) setChains(await listChains(wallet));
      show(`Now on ${environmentLabel(next)}`, 'success');
    } catch {
      show('Could not switch networks', 'error');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <ScreenScaffold
      title="Networks"
      subtitle="Where Mercury reads your balances and broadcasts your transactions."
      navAccessory={
        <Pressable style={styles.addBtn} onPress={() => setShowChainList(true)} hitSlop={8}>
          <Icon name="plus" size={14} color={theme.colors.primaryLabel} />
          <Text style={styles.addLabel}>Add network</Text>
        </Pressable>
      }
    >
      {/* ── Environment ───────────────────────────────────────────────────── */}
      <View style={styles.group}>
        <Text style={styles.groupLabel}>Environment</Text>
        <View style={styles.card}>
          <View style={styles.segment}>
            {(['mainnet', 'testnet'] as Environment[]).map((env) => {
              const on = environment === env;
              return (
                <Pressable
                  key={env}
                  style={[styles.segmentItem, on && styles.segmentItemOn]}
                  disabled={switching}
                  onPress={() => onEnvironment(env)}
                >
                  <Text style={[styles.segmentLabel, on && styles.segmentLabelOn]}>
                    {environmentLabel(env)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.segmentNote}>
            {environment === 'mainnet'
              ? 'Production chains. Everything you send here moves real money.'
              : 'Test chains and free faucet coins. Mercury returns to Mainnet the next time it launches.'}
          </Text>
          {switching && (
            <View style={styles.switchingRow}>
              <ActivityIndicator size="small" color={theme.colors.muted} />
              <Text style={styles.switchingText}>Re-deriving addresses and rescanning balances…</Text>
            </View>
          )}
        </View>

        {/* The three families, each with the network it is actually pointed at.
            This was one truncated line of dot-separated labels. */}
        <View style={styles.stats}>
          <StatTile label="Bitcoin" value={BTC_NETWORKS[choices.btc].label} />
          <StatTile label="Ethereum" value={EVM_NETWORKS[choices.evm].label} />
          <StatTile label="Solana" value={SOL_NETWORKS[choices.sol].label} />
        </View>
      </View>

      {/* ── EVM chains ────────────────────────────────────────────────────── */}
      <View style={styles.group}>
        <View style={styles.groupHead}>
          <Text style={styles.groupLabel}>EVM chains</Text>
          <Text style={styles.groupCount}>
            {enabledCount} of {envChains.length} on
          </Text>
        </View>
        <View style={styles.card}>
          {envChains.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>No chains configured for this environment.</Text>
            </View>
          ) : (
            envChains.map((c, i) => {
              const net = registry.networks[c.chainId.toString()];
              // Only claim "Custom" when there is a built-in value to differ
              // FROM. A chain we have no default for (an overlay chain, or one
              // added from ChainList) is unknown, not user-edited.
              const custom = defaultRpc.has(c.chainId.toString())
                ? defaultRpc.get(c.chainId.toString()) !== c.rpcUrl
                : false;
              return (
                <Pressable
                  key={c.chainId.toString()}
                  style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && styles.rowPressed]}
                  onPress={() => setEditing(c)}
                >
                  <View style={!c.enabled && styles.dim}>
                    <NetworkAvatar uri={net?.imageUrl} label={c.name} symbol={c.nativeSymbol} />
                  </View>
                  <View style={styles.rowMid}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.rowTitle, !c.enabled && styles.rowTitleOff]} numberOfLines={1}>
                        {c.name}
                      </Text>
                      {!c.enabled ? (
                        <View style={styles.chip}>
                          <Text style={styles.chipText}>Off</Text>
                        </View>
                      ) : custom ? (
                        <View style={[styles.chip, styles.chipCustom]}>
                          <Text style={[styles.chipText, styles.chipTextCustom]}>Custom RPC</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {rpcDisplay(c.rpcUrl)}
                    </Text>
                  </View>
                  <Icon name="chevronRight" size={15} color={theme.colors.muted} />
                </Pressable>
              );
            })
          )}
        </View>
        <Text style={styles.note}>
          Turning a chain off hides its assets and stops Mercury polling it. Nothing is moved or sold.
        </Text>
      </View>

      {/* HIDDEN: the Private relay row. The feature is untouched — `RelayEditor`
          below, `useNetworks().setRelay`, the persisted `relayUrl` and the
          `stealthSetRelayUrl` call in the network store all still work, and a
          relay set previously stays in force. Only the entry point is gone.
          Uncomment this block (and the `showRelay` render below) to restore it. */}
      {/*
      <View style={styles.group}>
        <Text style={styles.groupLabel}>Private relay</Text>
        <View style={styles.card}>
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => setShowRelay(true)}
          >
            <View style={[styles.tile, !effectiveRelay && styles.tileWarn]}>
              <Icon name="shield" size={15} color={effectiveRelay ? theme.colors.text : theme.colors.danger} />
            </View>
            <View style={styles.rowMid}>
              <View style={styles.nameRow}>
                <Text style={styles.rowTitle}>Relay endpoint</Text>
                <View style={[styles.chip, relayUrl && styles.chipCustom, !effectiveRelay && styles.chipWarn]}>
                  <Text
                    style={[
                      styles.chipText,
                      relayUrl && styles.chipTextCustom,
                      !effectiveRelay && styles.chipTextWarn,
                    ]}
                  >
                    {relayUrl ? 'Custom' : effectiveRelay ? 'Default' : 'Not set'}
                  </Text>
                </View>
              </View>
              <Text style={styles.rowSub} numberOfLines={1}>
                {effectiveRelay ? rpcDisplay(effectiveRelay) : 'Tap to enter one'}
              </Text>
            </View>
            <Icon name="chevronRight" size={15} color={theme.colors.faint} />
          </Pressable>
        </View>
        <Text style={styles.note}>
          {effectiveRelay
            ? 'Private sends and receives are announced through this relay. It never sees your keys.'
            : 'Private sends and receives need a relay to announce through. Ordinary transfers work without one.'}
        </Text>
      </View>
      */}

      <View style={styles.footNote}>
        <Icon name="info" size={13} color={theme.colors.muted} />
        <Text style={styles.footNoteText}>
          Changes apply straight away. Endpoints you enter stay on this device — they are never
          uploaded or shared.
        </Text>
      </View>

      {editing && wallet && (
        <ChainEditor
          chain={editing}
          defaultRpcUrl={defaultRpc.get(editing.chainId.toString())}
          imageUrl={registry.networks[editing.chainId.toString()]?.imageUrl}
          onClose={() => setEditing(null)}
          onSaved={(updated, msg) => {
            setChains((cs) => cs.map((c) => (c.chainId === updated.chainId ? updated : c)));
            setEditing(null);
            show(msg, 'success');
          }}
        />
      )}
      {/* HIDDEN: paired with the relay row above. */}
      {/* {showRelay && (
        <RelayEditor
          current={relayUrl ?? ''}
          onClose={() => setShowRelay(false)}
          onSave={(url) => {
            setRelay(url);
            setShowRelay(false);
            show('Relay updated', 'success');
          }}
        />
      )} */}
      {showChainList && wallet && (
        <ChainListPicker
          existing={chains.map((c) => c.chainId)}
          onClose={() => setShowChainList(false)}
          onAdd={(cfg) => setChains((cs) => (cs.some((c) => c.chainId === cfg.chainId) ? cs : [...cs, cfg]))}
        />
      )}
    </ScreenScaffold>
  );
}

/** Chain mark from the registry, falling back to a tinted monogram. A chain
 *  without art still needs a fixed-size slot or the rows lose their rhythm. */
function NetworkAvatar({ uri, label, symbol }: { uri?: string; label: string; symbol: string }) {
  return (
    <View style={styles.avatar}>
      <RemoteTokenIcon
        uri={uri && uri.length > 0 ? uri : undefined}
        size={32}
        fallbackColor={colorForSymbol(symbol)}
        symbol={label}
      />
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** A labelled input in the screen's own field language (the shared `Field` is
 *  still on the inherited grey/uppercase style). */
function LabeledField({
  label,
  hint,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
}) {
  const theme = UnistylesRuntime.getTheme();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        keyboardType="url"
        style={styles.fieldInput}
      />
      {!!hint && <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  );
}

/**
 * Edit one chain's endpoints.
 *
 * Save probes the RPC with `eth_chainId` first. A URL that answers for a
 * *different* chain is refused outright: it is the one mistake here that breaks
 * the wallet silently — balances read as zero and a broadcast lands on the
 * wrong network. An unreachable URL is only warned about, because the phone
 * might be the thing that is offline, and the second press goes through.
 */
function ChainEditor({
  chain,
  defaultRpcUrl,
  imageUrl,
  onClose,
  onSaved,
}: {
  chain: EvmChainConfig;
  /** Mercury's built-in RPC for this chain. Undefined for a chain we do not
   *  ship, where there is nothing to restore. */
  defaultRpcUrl?: string;
  imageUrl?: string;
  onClose: () => void;
  onSaved: (c: EvmChainConfig, message: string) => void;
}) {
  const theme = UnistylesRuntime.getTheme();
  const wallet = useSession((s) => s.wallet)!;
  const usdc = chainUsdc(chain.chainId);
  const circleDomain = chainCircleDomain(chain.chainId);
  const [rpc, setRpc] = useState(chain.rpcUrl);
  const [explorer, setExplorer] = useState(chain.explorerUrl ?? '');
  const [enabled, setEnabled] = useState(chain.enabled);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Set once the probe could not reach the URL; the next press saves anyway.
  const [unreachable, setUnreachable] = useState(false);

  const changed =
    rpc.trim() !== chain.rpcUrl || explorer.trim() !== (chain.explorerUrl ?? '') || enabled !== chain.enabled;
  // Reads the DRAFT, not the saved value: the moment you edit the field you are
  // no longer on the default, and the accessory has to say so.
  const atDefault = rpc.trim() === defaultRpcUrl;

  async function save() {
    const url = rpc.trim();
    setBusy(true);
    setErr(null);
    try {
      if (url !== chain.rpcUrl && !unreachable) {
        try {
          const seen = await probeChainId(url);
          if (seen !== chain.chainId) {
            setErr(
              `That endpoint is chain ${seen.toString()}, not ${chain.chainId.toString()}. Mercury would read the wrong balances from it.`,
            );
            return;
          }
        } catch {
          setUnreachable(true);
          setErr('Could not reach that endpoint. Press again to save it anyway.');
          return;
        }
      }
      const updated = await saveChain(wallet, chain, { rpcUrl: url, explorerUrl: explorer, enabled });
      onSaved(updated, 'Network saved');
    } catch (e) {
      setErr(String(e).slice(0, 140));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setErr(null);
    try {
      const def = await resetChain(wallet, chain.chainId);
      if (def) onSaved(def, `${chain.name} restored to defaults`);
      else setErr('This network has no built-in default to restore.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <SheetScaffold
          title={chain.name}
          subtitle={`Chain ${chain.chainId.toString()} · gas paid in ${chain.nativeSymbol}`}
          onClose={onClose}
          cta={{
            label: unreachable ? 'Save anyway' : 'Save changes',
            onPress: save,
            disabled: !changed || !rpc.trim(),
            busy,
          }}
          ctaAccessory={
            <Pressable style={styles.reset} onPress={reset} disabled={busy || atDefault || !defaultRpcUrl}>
              <Text style={[styles.resetLabel, (atDefault || !defaultRpcUrl) && styles.resetLabelOff]}>
                {!defaultRpcUrl
                  ? 'Added by you — no default to restore'
                  : atDefault
                    ? 'Using Mercury’s default endpoint'
                    : 'Restore default endpoint'}
              </Text>
            </Pressable>
          }
        >
          <View style={styles.editorHead}>
            <NetworkAvatar uri={imageUrl} label={chain.name} symbol={chain.nativeSymbol} />
            <View style={styles.rowMid}>
              <Text style={styles.rowTitle}>{enabled ? 'Enabled' : 'Turned off'}</Text>
              <Text style={styles.rowSub} numberOfLines={2}>
                {enabled
                  ? 'Assets on this chain appear in your list.'
                  : 'Hidden from balances, sends and activity.'}
              </Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              trackColor={{ false: 'rgba(11,13,16,0.14)', true: '#0B0D10' }}
              thumbColor="#FFFFFF"
              ios_backgroundColor="rgba(11,13,16,0.14)"
            />
          </View>

          <LabeledField
            label="RPC endpoint"
            hint="Checked against the chain id before it is saved."
            value={rpc}
            onChangeText={(t) => {
              setRpc(t);
              setErr(null);
              setUnreachable(false);
            }}
            placeholder="https://…"
          />
          <LabeledField
            label="Block explorer"
            hint="Where “View on explorer” opens from your activity."
            value={explorer}
            onChangeText={setExplorer}
            placeholder="https://…"
          />

          {!!err && (
            <View style={styles.errBox}>
              <Icon name="warning" size={14} color={theme.colors.danger} />
              <Text style={styles.errText}>{err}</Text>
            </View>
          )}

          {/* Facts about the chain, not preferences — which is why they are
              flat text rather than controls. `eip1559Supported` is deliberately
              NOT shown: nothing in the app reads it, and the value that comes
              back from the core does not match reality for every chain, so
              printing it would only mislead. */}
          <View style={styles.detailCard}>
            <DetailRow label="Chain ID" value={chain.chainId.toString()} />
            <DetailRow label="Gas coin" value={`${chain.nativeSymbol} · ${chain.nativeDecimals} decimals`} />
            <DetailRow label="USDC" value={usdc ? `${usdc.slice(0, 6)}…${usdc.slice(-4)}` : 'Not on this chain'} />
            <DetailRow
              label="Cross-chain USDC"
              value={circleDomain === undefined ? 'Not supported' : `Circle domain ${circleDomain}`}
            />
          </View>
        </SheetScaffold>
      </View>
    </Modal>
  );
}

/** The stealth relay endpoint, with a reachability test before you commit. */
function RelayEditor({
  current,
  onClose,
  onSave,
}: {
  current: string;
  onClose: () => void;
  onSave: (url: string) => void;
}) {
  const theme = UnistylesRuntime.getTheme();
  const [draft, setDraft] = useState(current);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function test() {
    const url = draft.trim().replace(/\/+$/, '');
    if (!url) return;
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch(`${url}/health`);
      const txt = (await res.text()).toLowerCase();
      setResult(
        res.ok && txt.includes('ok')
          ? { ok: true, text: 'Relay answered and reports healthy.' }
          : { ok: false, text: `Relay answered ${res.status}, but not healthy.` },
      );
    } catch {
      setResult({ ok: false, text: 'No answer from that address.' });
    } finally {
      setTesting(false);
    }
  }

  const trimmed = draft.trim();
  const https = trimmed.startsWith('https://');

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <SheetScaffold
          title="Private relay"
          subtitle="The endpoint that carries your shielded sends and receives."
          onClose={onClose}
          cta={{
            label: 'Use this relay',
            onPress: () => trimmed && onSave(trimmed),
            disabled: !trimmed || !https,
          }}
          ctaAccessory={
            <Pressable style={styles.reset} onPress={test} disabled={testing || !trimmed}>
              <Text style={[styles.resetLabel, (!trimmed || testing) && styles.resetLabelOff]}>
                {testing ? 'Testing…' : 'Test connection'}
              </Text>
            </Pressable>
          }
        >
          <LabeledField
            label="Relay URL"
            hint={
              STEALTH_RELAY_URL
                ? 'Must be HTTPS. Leave the default unless you run your own.'
                : 'Must be HTTPS. This build ships without one, so private sends need it set.'
            }
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              setResult(null);
            }}
            placeholder={STEALTH_RELAY_URL || 'https://…'}
          />

          {!!trimmed && !https && (
            <View style={styles.errBox}>
              <Icon name="warning" size={14} color={theme.colors.danger} />
              <Text style={styles.errText}>
                Plain HTTP would expose who you are paying to anyone on the network.
              </Text>
            </View>
          )}

          {!!result && (
            <View style={[styles.errBox, result.ok && styles.okBox]}>
              <Icon
                name={result.ok ? 'checkCircle' : 'warning'}
                size={14}
                color={result.ok ? theme.colors.success : theme.colors.danger}
              />
              <Text style={[styles.errText, result.ok && styles.okText]}>{result.text}</Text>
            </View>
          )}

          <View style={styles.footNote}>
            <Icon name="info" size={13} color={theme.colors.muted} />
            <Text style={styles.footNoteText}>
              The relay only forwards announcements. It cannot spend, and it never holds your keys.
            </Text>
          </View>
        </SheetScaffold>
      </View>
    </Modal>
  );
}

/** Add a chain from the public ChainList registry (chainid.network). */
function ChainListPicker({
  existing,
  onClose,
  onAdd,
}: {
  existing: bigint[];
  onClose: () => void;
  onAdd: (c: EvmChainConfig) => void;
}) {
  const theme = UnistylesRuntime.getTheme();
  const wallet = useSession((s) => s.wallet)!;
  const show = useToast((s) => s.show);
  const [entries, setEntries] = useState<ChainListEntry[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState<bigint | null>(null);
  const [added, setAdded] = useState<string[]>(() => existing.map((id) => id.toString()));

  useEffect(() => {
    fetchChainList()
      .then(setEntries)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? entries.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.symbol.toLowerCase().includes(q) ||
            e.chainId.toString().includes(q),
        )
      : entries;
    return base.slice(0, 60);
  }, [entries, query]);

  async function add(e: ChainListEntry) {
    setAdding(e.chainId);
    try {
      const cfg = await addChainFromList(wallet, e);
      onAdd(cfg);
      setAdded((a) => [...a, e.chainId.toString()]);
      show(`Added ${e.name}`, 'success');
    } catch {
      show('Could not add that network', 'error');
    } finally {
      setAdding(null);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* Not SheetScaffold: this sheet's body is a full-height list, and the
          scaffold's content-sized variant cannot bound one. */}
      <SafeAreaView style={styles.sheetRoot} edges={['bottom']}>
        <View style={styles.pickerHead}>
          <View style={styles.rowMid}>
            <Text style={styles.pickerTitle}>Add a network</Text>
            <Text style={styles.pickerSub}>
              From the public ChainList registry. Endpoints are editable afterwards.
            </Text>
          </View>
          <Pressable hitSlop={10} onPress={onClose} style={styles.pickerClose}>
            <Icon name="close" size={15} color={theme.colors.muted} />
          </Pressable>
        </View>

        <View style={styles.searchWrap}>
          <Icon name="search" size={16} color={theme.colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Network name, symbol or chain id"
            placeholderTextColor={theme.colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.search}
          />
          {query.length > 0 && (
            <Pressable hitSlop={8} onPress={() => setQuery('')}>
              <Icon name="close" size={14} color={theme.colors.muted} />
            </Pressable>
          )}
        </View>

        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.pickerBody}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={styles.pickerState}>
              <ActivityIndicator color={theme.colors.muted} />
              <Text style={styles.emptyText}>Loading the network list…</Text>
            </View>
          ) : failed ? (
            <View style={styles.pickerState}>
              <Text style={styles.emptyText}>Could not load the network list. Check your connection.</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.pickerState}>
              <Text style={styles.emptyText}>Nothing matches “{query.trim()}”.</Text>
            </View>
          ) : (
            <View style={styles.card}>
              {filtered.map((e, i) => {
                const already = added.includes(e.chainId.toString());
                return (
                  <View key={e.chainId.toString()} style={[styles.row, i > 0 && styles.divider]}>
                    <NetworkAvatar label={e.name} symbol={e.symbol} />
                    <View style={styles.rowMid}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {e.name}
                      </Text>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        Chain {e.chainId.toString()} · {e.symbol}
                      </Text>
                    </View>
                    {already ? (
                      <Icon name="check" size={16} color={theme.colors.success} />
                    ) : (
                      <Pressable
                        style={styles.addPill}
                        hitSlop={8}
                        disabled={adding === e.chainId}
                        onPress={() => add(e)}
                      >
                        <Text style={styles.addPillLabel}>{adding === e.chainId ? '…' : 'Add'}</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 13,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
  },
  addLabel: { fontFamily: fontFamily.semibold, fontSize: 13, letterSpacing: -0.18, color: theme.colors.primaryLabel },

  group: { gap: 8 },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingRight: 4 },
  groupLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 12,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    color: theme.colors.muted,
    paddingLeft: 4,
  },
  groupCount: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.1, color: theme.colors.muted },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    overflow: 'hidden',
  },

  // Two states, both always visible — a switch hides the option you are not on,
  // and this screen's whole job is telling you which one is live.
  segment: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    margin: 10,
    marginBottom: 0,
    borderRadius: 14,
    backgroundColor: '#ECEEE9',
  },
  segmentItem: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentItemOn: { backgroundColor: '#0B0D10' },
  segmentLabel: { fontFamily: fontFamily.semibold, fontSize: 14, letterSpacing: -0.24, color: theme.colors.muted },
  segmentLabelOn: { color: '#ECEEE9' },
  segmentNote: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: -0.14,
    color: theme.colors.muted,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 14,
  },
  switchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  switchingText: { flex: 1, fontFamily: fontFamily.medium, fontSize: 12.5, color: theme.colors.muted },

  stats: { flexDirection: 'row', gap: 8 },
  stat: {
    flex: 1,
    flexBasis: 0,
    gap: 3,
    paddingHorizontal: 11,
    paddingVertical: 11,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
  },
  statLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: theme.colors.muted,
  },
  statValue: { fontFamily: fontFamily.semibold, fontSize: 13.5, letterSpacing: -0.24, color: theme.colors.text },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowPressed: { backgroundColor: 'rgba(11,13,16,0.03)' },
  divider: { borderTopWidth: 1, borderTopColor: 'rgba(11,13,16,0.06)' },
  rowMid: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  rowTitle: { flexShrink: 1, fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.28, color: theme.colors.text },
  rowTitleOff: { color: theme.colors.muted },
  rowSub: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: -0.14, color: theme.colors.muted },
  dim: { opacity: 0.4 },

  avatar: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  tile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#ECEEE9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileWarn: { backgroundColor: 'rgba(255,59,48,0.10)' },

  chip: { paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: theme.radius.pill, backgroundColor: '#ECEEE9' },
  chipCustom: { backgroundColor: 'rgba(11,13,16,0.06)' },
  chipWarn: { backgroundColor: 'rgba(255,59,48,0.10)' },
  chipText: {
    fontFamily: fontFamily.semibold,
    fontSize: 9.5,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: theme.colors.muted,
  },
  chipTextCustom: { color: theme.colors.text },
  chipTextWarn: { color: theme.colors.danger },

  emptyRow: { paddingHorizontal: 14, paddingVertical: 20, alignItems: 'center' },
  emptyText: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18, textAlign: 'center', color: theme.colors.muted },

  note: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16.5,
    letterSpacing: -0.14,
    color: theme.colors.muted,
    paddingHorizontal: 4,
  },
  footNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 13,
    borderRadius: theme.radius.lg,
    backgroundColor: 'rgba(11,13,16,0.04)',
  },
  footNoteText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16.5,
    letterSpacing: -0.14,
    color: theme.colors.muted,
  },

  // ── Sheets ────────────────────────────────────────────────────────────────
  sheetRoot: { flex: 1, backgroundColor: theme.colors.appBackground },
  editorHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    borderRadius: theme.radius.xl,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
  },

  field: { gap: 7 },
  fieldLabel: { fontFamily: fontFamily.semibold, fontSize: 12.5, letterSpacing: -0.1, color: theme.colors.text, paddingLeft: 3 },
  fieldInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontFamily: fontFamily.monoRegular,
    fontSize: 13.5,
    color: theme.colors.text,
  },
  fieldHint: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 16,
    letterSpacing: -0.1,
    color: theme.colors.muted,
    paddingLeft: 3,
  },

  errBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 12,
    borderRadius: theme.radius.lg,
    backgroundColor: 'rgba(255,59,48,0.08)',
  },
  errText: { flex: 1, fontFamily: fontFamily.medium, fontSize: 12.5, lineHeight: 17, color: theme.colors.danger },
  okBox: { backgroundColor: 'rgba(52,199,89,0.10)' },
  okText: { color: theme.colors.success },

  detailCard: {
    borderRadius: theme.radius.lg,
    backgroundColor: 'rgba(11,13,16,0.04)',
    paddingHorizontal: 13,
    paddingVertical: 4,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingVertical: 9 },
  detailLabel: { fontFamily: fontFamily.medium, fontSize: 12.5, letterSpacing: -0.14, color: theme.colors.muted },
  detailValue: { flexShrink: 1, fontFamily: fontFamily.semibold, fontSize: 12.5, letterSpacing: -0.14, color: theme.colors.text },

  reset: { alignItems: 'center', paddingVertical: 6 },
  resetLabel: { fontFamily: fontFamily.semibold, fontSize: 13.5, letterSpacing: -0.2, color: theme.colors.text },
  resetLabelOff: { color: theme.colors.faint },

  // ── Add-network sheet ─────────────────────────────────────────────────────
  pickerHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: theme.spacing.screen,
    paddingTop: 22,
    paddingBottom: 14,
  },
  pickerTitle: { fontFamily: fontFamily.semibold, fontSize: 22, letterSpacing: -0.6, color: theme.colors.text },
  pickerSub: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.18,
    color: theme.colors.muted,
  },
  pickerClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  pickerBody: { paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.lg },
  pickerState: { alignItems: 'center', gap: 12, paddingVertical: 36, paddingHorizontal: 24 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    paddingHorizontal: 15,
    height: 46,
    marginHorizontal: theme.spacing.screen,
    marginBottom: 12,
  },
  search: { flex: 1, padding: 0, fontFamily: fontFamily.medium, fontSize: 14.5, color: theme.colors.text },

  addPill: {
    paddingHorizontal: 13,
    height: 30,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B0D10',
  },
  addPillLabel: { fontFamily: fontFamily.semibold, fontSize: 12.5, letterSpacing: -0.1, color: '#ECEEE9' },
}));
