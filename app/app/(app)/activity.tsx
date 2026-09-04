import { useCallback, useEffect } from 'react';
import { Text, ScrollView, RefreshControl, View } from 'react-native';
import { useWallet } from '../../src/stores/wallet';
import { Screen, Card, Empty } from '../../src/ui/kit';
import { ActivityRow } from '../../src/ui/ActivityRow';
import { c, t, sp } from '../../src/ui/theme';

export default function ActivityScreen() {
  const { activity, loading, refresh } = useWallet();
  useEffect(() => { void refresh(); }, [refresh]);
  const onRefresh = useCallback(() => { void refresh(); }, [refresh]);

  return (
    <Screen>
      <Text style={[t.h1, { paddingVertical: sp(2) }]}>Activity</Text>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={c.fg3} />}
      >
        {activity.length === 0 ? (
          <Card>
            <Empty title="Nothing yet" body="Payments you send and receive will show up here." />
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {activity.map((a, i) => (
              <ActivityRow key={a.hash} item={a} last={i === activity.length - 1} />
            ))}
          </Card>
        )}
        <View style={{ height: sp(4) }} />
      </ScrollView>
    </Screen>
  );
}
