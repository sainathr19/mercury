// The three primary destinations, behind a floating pill tab bar.
//
// These used to be one 910-line `home.tsx` driving a PagerView, which meant the
// three pages shared a file, could not be linked to individually, and all
// mounted together. They are routes now; the tab bar is ours rather than the
// system one (see `ui/TabBar`).
import { Tabs } from 'expo-router/js-tabs';
import { useUnistyles } from 'react-native-unistyles';
import { TabBar, type TabBarItem } from '../../../src/ui';

const ITEMS: TabBarItem[] = [
  { key: 'wallet', label: 'Wallet', icon: 'wallet' },
  { key: 'explore', label: 'Explore', icon: 'globe' },
  { key: 'settings', label: 'More', icon: 'settings' },
];

export default function TabsLayout() {
  // Private mode swaps the theme at runtime; subscribing here repaints the scene
  // background with it instead of a frame late.
  const { theme } = useUnistyles();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // No scene animation. A cross-fade has to render BOTH scenes for its
        // duration, and the wallet tab is the app's heaviest screen (portfolio,
        // activity, Gateway) — so fading it in and out is what made switching
        // tabs feel rough. Switching is instant now; the feedback lives in the
        // tab bar's own lozenge, which animates on the UI thread and costs
        // nothing.
        animation: 'none',
        sceneStyle: { backgroundColor: theme.colors.appBackground },
      }}
      tabBar={({ state, navigation }) => (
        <TabBar
          items={ITEMS}
          activeKey={state.routes[state.index]?.name ?? 'wallet'}
          onSelect={(key) => navigation.navigate(key)}
        />
      )}
    >
      <Tabs.Screen name="wallet" />
      <Tabs.Screen name="explore" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
