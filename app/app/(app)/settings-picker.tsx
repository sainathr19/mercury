import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, Text } from '../../src/ui';
import { useSettings, AUTO_LOCK_OPTIONS, CURRENCY_OPTIONS } from '../../src/stores/settingsStore';

type Kind = 'autolock' | 'currency';

/** Generic single-select picker as a native form sheet (Auto-Lock / Currency).
 *  Reads + writes the settings store directly so no callback needs to cross the
 *  route boundary. */
export default function SettingsPicker() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const { kind } = useLocalSearchParams<{ kind: Kind }>();
  const s = useSettings();

  const cfg =
    kind === 'autolock'
      ? {
          title: 'Auto-Lock',
          options: AUTO_LOCK_OPTIONS.map((o) => ({ key: o.key, label: o.label })),
          selected: s.autoLock as string,
          set: (k: string) => s.setAutoLock(k as typeof s.autoLock),
        }
      : {
          title: 'Currency',
          options: CURRENCY_OPTIONS.map((o) => ({ key: o.key, label: o.label })),
          selected: s.currency as string,
          set: (k: string) => s.setCurrency(k as typeof s.currency),
        };

  return (
    <View style={styles.sheet}>
      <Text variant="headline" style={styles.title}>
        {cfg.title}
      </Text>
      {cfg.options.map((o, i) => (
        <Pressable
          key={o.key}
          style={[styles.optionRow, i > 0 && styles.optionDivider]}
          onPress={() => {
            cfg.set(o.key);
            router.back();
          }}
        >
          <Text variant="subheadBold" style={{ flex: 1 }}>
            {o.label}
          </Text>
          {cfg.selected === o.key && <Icon name="check" size={18} color={theme.colors.text} />}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  sheet: { paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.xl },
  title: { paddingBottom: theme.spacing.sm },
  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.md },
  optionDivider: { borderTopWidth: 1, borderTopColor: theme.colors.separator },
}));
