import { Redirect, useLocalSearchParams } from 'expo-router';
import { useScan } from '../../src/stores/scanStore';

/**
 * `mercury://pay/<url-encoded payment URI>` — a payment link opened from
 * anywhere on the device.
 *
 * The payment rides in a PATH SEGMENT, not a query param. An EIP-681 URI
 * contains its own `?` and `&`, and the router splits the query on those before
 * the value is decoded — which silently dropped everything after the first `&`,
 * so a request arrived with its recipient and token intact and its AMOUNT gone.
 *
 * It hands the payment to the same channel the camera scanner uses, so the send
 * flow resolves the token, pins the chain and pre-fills the amount through the
 * one code path that is already tested.
 */
export default function Pay() {
  const { data } = useLocalSearchParams<{ data?: string }>();
  const payment = typeof data === 'string' && data ? data : null;
  if (payment) useScan.getState().setResult(payment);

  // `step: 'pick'` is what the scanner passes — it skips the Shield/Send chooser
  // and lands on the step that auto-resolves a scanned payment. Replace, not
  // push: this route is a redirect and must not sit in the back stack.
  return payment
    ? <Redirect href={{ pathname: '/(app)/send', params: { step: 'pick' } }} />
    : <Redirect href="/(app)/(tabs)/wallet" />;
}
