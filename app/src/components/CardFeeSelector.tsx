import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Card, Text } from '../ui';
import { useSession } from '../stores/session';
import { loadCardFees, type FeeKey, type FeeTier } from '../bridge/liveFees';
import type { CardChain } from '../lib/cardChains';

/** Live network-fee row with a Fast/Normal/Slow selector (mirrors iOS). Shared
 *  by the send-from-card sheet, the RBF boost sheet, and the card-receive flow. */
export function CardFeeSelector({
  chain,
  value,
  onChange,
  onTiers,
}: {
  chain: CardChain;
  value: FeeKey;
  onChange: (k: FeeKey) => void;
  onTiers: (t: FeeTier[]) => void;
}) {
  const theme = UnistylesRuntime.getTheme();
  const wallet = useSession((s) => s.wallet);
  const [tiers, setTiers] = useState<FeeTier[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    if (!wallet) return;
    loadCardFees(chain, wallet).then((t) => {
      if (!live) return;
      setTiers(t);
      onTiers(t);
      setLoading(false);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, wallet]);

  const selected = tiers.find((t) => t.key === value) ?? tiers[0];
  const multi = tiers.length > 1;

  return (
    <Card flush>
      <View style={styles.feeTop}>
        <Text variant="subheadBold">Network fee</Text>
        <Text variant="subhead" color={theme.colors.muted}>
          {loading ? 'estimating…' : selected ? `${selected.rateLabel}${selected.costLabel ? ` · ${selected.costLabel}` : ''}` : '—'}
        </Text>
      </View>
      {multi && (
        <View style={styles.feeTiers}>
          {tiers.map((t) => (
            <Pressable key={t.key} style={[styles.feeTier, value === t.key && styles.feeTierActive]} onPress={() => onChange(t.key)}>
              <Text variant="captionSemibold" color={value === t.key ? theme.colors.primaryLabel : theme.colors.text}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  feeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: theme.spacing.md },
  feeTiers: { flexDirection: 'row', gap: 6, paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md },
  feeTier: { flex: 1, alignItems: 'center', paddingVertical: theme.spacing.sm, borderRadius: theme.radius.sm, backgroundColor: theme.colors.appBackground },
  feeTierActive: { backgroundColor: theme.colors.primary },
}));
