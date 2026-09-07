// The native wallet core. Tests exercise the pure TypeScript around it — the
// modules under test import it for types and for a few enum constants, never to
// call into Rust — so the enums are stubbed and nothing else is needed.
module.exports = {
  BtcNetwork: { Mainnet: 'Mainnet', Testnet: 'Testnet', Testnet4: 'Testnet4', Signet: 'Signet', Regtest: 'Regtest' },
};
