// The native wallet core lives OUTSIDE node_modules, linked in at
// `vendor/wallet-core` (see README). Metro finds it through
// `resolver.extraNodeModules`, but iOS/Android autolinking walks node_modules
// instead — so without this the pod is never added and the app builds fine,
// bundles fine, and then dies the first time it needs to sign. A missing
// signer that fails at build time is a bad afternoon; one that fails at
// runtime is a bug report from a user holding money.
//
// Declaring it here points autolinking at the podspec inside the linked
// checkout, so `pod install` picks it up exactly as if it were a dependency.
const fs = require('fs');
const path = require('path');

const walletCore = path.resolve(__dirname, 'vendor/wallet-core');

// The link is machine-local and gitignored. When it is absent, contribute no
// override rather than pointing CocoaPods at a path that does not exist — that
// keeps the failure "the module is missing", which the README explains, instead
// of an opaque podspec error.
module.exports = fs.existsSync(walletCore)
  ? {
      dependencies: {
        'mercury-wallet-core': {
          root: walletCore,
          platforms: {
            ios: { podspecPath: path.join(walletCore, 'StandardWallet.podspec') },
            android: { sourceDir: path.join(walletCore, 'android') },
          },
        },
      },
    }
  : {};
