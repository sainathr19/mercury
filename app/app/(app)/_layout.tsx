import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { c } from '../../src/ui/theme';

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.fg3,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line },
      }}
    >
      <Tabs.Screen name="home" options={{
        title: 'Wallet',
        tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" size={size} color={color} />,
      }} />
      <Tabs.Screen name="activity" options={{
        title: 'Activity',
        tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} />,
      }} />
      <Tabs.Screen name="settings" options={{
        title: 'Settings',
        tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
      }} />
      <Tabs.Screen name="send" options={{ href: null }} />
      <Tabs.Screen name="receive" options={{ href: null }} />
    </Tabs>
  );
}
