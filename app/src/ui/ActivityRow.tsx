import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatMinor } from '@shared/chains';
import { explorerTx } from '../bridge/arc';
import type { Activity } from '../bridge/activity';
import { c, t, sp } from './theme';

const when = (ts: number) => {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
};

export function ActivityRow({ item, last }: { item: Activity; last?: boolean }) {
  const inbound = item.direction === 'in';
  return (
    <Pressable
      onPress={() => Linking.openURL(explorerTx(item.hash))}
      style={[s.row, !last && s.divider]}
    >
      <View style={[s.icon, { backgroundColor: inbound ? '#16352A' : c.surfaceHi }]}>
        <Ionicons
          name={inbound ? 'arrow-down' : 'arrow-up'}
          size={17}
          color={inbound ? c.good : c.fg2}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={t.body}>{inbound ? 'Received' : 'Sent'}</Text>
        <Text style={t.cap} numberOfLines={1}>
          {item.counterparty.slice(0, 10)}…{item.counterparty.slice(-4)} · {when(item.timestamp)}
        </Text>
      </View>
      <Text style={[t.body, { fontWeight: '600', color: inbound ? c.good : c.fg }]}>
        {inbound ? '+' : '−'}${formatMinor(item.amountMinor)}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: sp(1.75) },
  divider: { borderBottomWidth: 1, borderBottomColor: c.line },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
