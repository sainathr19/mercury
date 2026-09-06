// React Native's own modules read __DEV__, which only the RN/Expo bundlers
// define. Four suites reach the real `expo-secure-store` / `expo-file-system`
// through their import graph, which pulls in react-native/index.js — without
// this they fail to load rather than fail an assertion, so they silently ran
// zero tests.
global.__DEV__ = true;

// Pin the network environment. Jest does not load .env.local, so APP_ENVIRONMENT
// silently fell back to its 'mainnet' default and suites ran against different
// chains than the app is built for — the stealth suite asserted Sepolia and got
// Ethereum. Tests should not depend on ambient env at all; this makes it
// explicit and matches how the app is actually built.
process.env.EXPO_PUBLIC_ENVIRONMENT = 'testnet';
