// Adds the NFC Tag-reading capability the hardware-card features need:
//  - iOS: NFCReaderUsageDescription, the Near Field Communication Tag Reading
//    entitlement, and the ISO-7816 applet AIDs the app is allowed to SELECT.
//    NOTE: the entitlement requires a paid Apple Developer account (personal
//    teams can't enable NFC Tag Reading), same as the standard-ios app.
//  - Android: the NFC uses-permission + (optional) hardware feature.
const {
  withInfoPlist,
  withEntitlementsPlist,
  withAndroidManifest,
  AndroidConfig,
} = require('@expo/config-plugins');

// Standard Wallet applet AID + NXP JCOP ISD fallback (see standard-ios).
const SELECT_IDENTIFIERS = ['A00000080953544401', 'A0000001510000'];

module.exports = function withNfc(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NFCReaderUsageDescription =
      cfg.modResults.NFCReaderUsageDescription ||
      'Standard uses NFC to communicate with your hardware wallet card.';
    cfg.modResults['com.apple.developer.nfc.readersession.iso7816.select-identifiers'] =
      SELECT_IDENTIFIERS;
    return cfg;
  });

  // The NFC Tag Reading entitlement requires a PAID Apple Developer Program
  // account — personal/free teams can't provision it, which fails signing.
  // Gate it behind an env var so personal-team dev builds still install (card
  // scanning stays inert until signed with a paid team). Enable with:
  //   STANDARD_NFC_ENTITLEMENT=1 npx expo prebuild
  if (process.env.STANDARD_NFC_ENTITLEMENT === '1') {
    config = withEntitlementsPlist(config, (cfg) => {
      cfg.modResults['com.apple.developer.nfc.readersession.formats'] = ['TAG'];
      return cfg;
    });
  }

  config = withAndroidManifest(config, (cfg) => {
    AndroidConfig.Manifest.ensurePermission(cfg.modResults, 'android.permission.NFC');
    const manifest = cfg.modResults.manifest;
    manifest['uses-feature'] = manifest['uses-feature'] || [];
    const hasNfc = manifest['uses-feature'].some(
      (f) => f && f.$ && f.$['android:name'] === 'android.hardware.nfc'
    );
    if (!hasNfc) {
      manifest['uses-feature'].push({
        $: { 'android:name': 'android.hardware.nfc', 'android:required': 'false' },
      });
    }
    return cfg;
  });

  return config;
};
