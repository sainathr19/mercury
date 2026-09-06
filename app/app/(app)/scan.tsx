import { useRef } from 'react';
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { Button, Icon, Text } from '../../src/ui';
import { useScan } from '../../src/stores/scanStore';

export default function Scan() {
  const router = useRouter();
  const setResult = useScan((s) => s.setResult);
  const [permission, requestPermission] = useCameraPermissions();
  // The camera fires onBarcodeScanned continuously; a ref guard blocks re-entry
  // SYNCHRONOUSLY so we only ever call router.back() once (a state guard updates
  // too late — extra frames slip through and fire a second, unhandled GO_BACK).
  const done = useRef(false);

  function onScanned(value: string) {
    if (done.current) return;
    done.current = true;
    // Light "captured" tap here; the consumer (send address screen) fires the
    // success/error notification once it knows if the QR matches the chain.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setResult(value);
    router.back();
  }

  return (
    <View style={styles.root}>
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFillObject}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => onScanned(data)}
        />
      ) : null}

      {/* Overlay */}
      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeBtn}>
            <Icon name="close" size={24} color="#FFFFFF" />
          </Pressable>
          <Text variant="headline" color="#FFFFFF">
            Scan QR
          </Text>
          <View style={{ width: 24 }} />
        </View>

        {!permission?.granted && (
          <View style={styles.permission}>
            <Icon name="qrcode" size={48} color="#FFFFFF" />
            <Text variant="bodyMedium" color="#FFFFFF" style={styles.center}>
              {permission ? 'Camera access is needed to scan QR codes.' : 'Requesting camera…'}
            </Text>
            <Button title="Allow camera" onPress={requestPermission} />
          </View>
        )}

        {permission?.granted && (
          <View style={styles.reticleWrap}>
            <View style={styles.reticle} />
            <Text variant="bodyMedium" color="#FFFFFF" style={styles.center}>
              Point at a wallet QR code
            </Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: '#000000' },
  overlay: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.screen,
    paddingVertical: theme.spacing.md,
  },
  closeBtn: { padding: 4 },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.xl },
  // Fill the space below the top bar and center the reticle.
  reticleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md },
  reticle: {
    width: 240,
    height: 240,
    borderRadius: theme.radius.lg,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  center: { textAlign: 'center' },
}));
