// No-op analytics shim. Mercury ships no telemetry; this exists so components
// copied from the reference app compile without edits at their call sites.
type Props = Record<string, unknown>;
export const posthog = {
  capture: (_event: string, _props?: Props): void => {},
  identify: (_id: string, _props?: Props): void => {},
  screen: (_name: string, _props?: Props): void => {},
  captureException: (_e: unknown, _props?: Props): void => {},
};
export default posthog;
