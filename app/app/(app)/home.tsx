import { useCallback, useEffect } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../../src/stores/session';
import { useWallet } from '../../src/stores/wallet';
import { formatMinor } from '@shared/chains';
import { Screen, Card, Row, Empty, Button } from '../../src/ui/kit';
import { c, t, sp, r } from '../../src/ui/theme';
import { ActivityRow } from '../../src/ui/ActivityRow';

export default function Home() {
  const router = useRouter();
  const { address, hasName } = useSession();
  const { balanceMinor, activity, loading, error, refresh } = useWallet();

  useEffect(() => { void refresh(); }, [refresh]);
  const onRefresh = useCallback(() => { void refresh(); }, [refresh]);

  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—';
  const recent = activity.slice(0, 4);

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={c.fg3} />}
      >
        {!hasName && (
          <Pressable style={s.banner}>
            <Ionicons name="at" size={18} color={c.accent} />
            <Text style={s.bannerText}>
              Claim your name so people can pay you without an address.
            </Text>
          </Pressable>
        )}

        <View style={s.balanceBlock}>
          <Text style={t.cap}>Balance</Text>
          <Row style={{ alignItems: 'flex-end' }}>
            <Text style={t.display}>${formatMinor(balanceMinor)}</Text>
            <Text style={[t.h2, { color: c.fg3, marginBottom: 10, marginLeft: 8 }]}>USDC</Text>
          </Row>
          <Text style={t.mono}>{short}</Text>
        </View>

        {error && <Text style={[t.sub, { color: c.bad, marginBottom: sp(1) }]}>{error}</Text>}

        <Row style={{ gap: sp(1.5), marginBottom: sp(3) }}>
          <Button title="Send" onPress={() => router.push('/(app)/send' as never)} style={{ flex: 1 }} />
          <Button title="Receive" kind="secondary" onPress={() => router.push('/(app)/receive' as never)} style={{ flex: 1 }} />
        </Row>

        {balanceMinor === 0n && activity.length === 0 ? (
          <Card>
            <Empty
              title="No USDC yet"
              body="On Arc, USDC is also the gas token — so the moment you receive some, you can spend it. No second asset to buy first."
              action={
                <Button
                  title="Get testnet USDC"
                  kind="secondary"
                  onPress={() => Linking.openURL('https://faucet.circle.com')}
                />
              }
            />
          </Card>
        ) : (
          <>
            <Row style={{ justifyContent: 'space-between', marginBottom: sp(1) }}>
              <Text style={t.h2}>Recent</Text>
              <Pressable onPress={() => router.push('/(app)/activity' as never)}>
                <Text style={{ color: c.accent, fontSize: 15 }}>See all</Text>
              </Pressable>
            </Row>
            <Card style={{ padding: 0 }}>
              {recent.map((a, i) => (
                <ActivityRow key={a.hash} item={a} last={i === recent.length - 1} />
              ))}
            </Card>
          </>
        )}
        <View style={{ height: sp(4) }} />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.accentDim, borderRadius: r.md,
    padding: sp(1.75), marginTop: sp(1), marginBottom: sp(2),
  },
  bannerText: { color: c.fg, fontSize: 14, flex: 1, lineHeight: 19 },
  balanceBlock: { paddingTop: sp(2), paddingBottom: sp(3), gap: 6 },
});
