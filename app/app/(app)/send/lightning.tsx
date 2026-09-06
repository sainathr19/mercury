// Lightning pay INSIDE the Send flow. Re-exports the shared Lightning pay screen
// so, when reached via Send → Bitcoin·Lightning, it pushes as a card WITHIN the
// send sheet (slide-from-right) exactly like the on-chain address/amount steps —
// instead of opening as a separate full-screen route. The same component also
// backs the top-level `/(app)/ln-pay` route used by the QR scanner.
export { default } from '../ln-pay';
