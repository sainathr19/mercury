//! Detects when the device is in a state where heavy JS-thread transition
//! choreography (screenshot dissolve + ramped haptics + a big theme/content
//! re-render) janks: iOS Low Power Mode (the OS throttles timers + renders) or
//! Reduce Motion (the user explicitly wants less animation). In either case the
//! caller should swap instantly instead of running the elaborate transition.
//
// `expo-battery` is loaded defensively: if it isn't installed / isn't in the
// native binary yet, the Low-Power signal simply stays false and we fall back to
// the Reduce-Motion signal (which needs no native module). So this never crashes
// the bundle and degrades gracefully until the next native rebuild.

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

type BatteryModule = {
  isLowPowerModeEnabledAsync: () => Promise<boolean>;
  addLowPowerModeListener: (cb: (e: { lowPowerMode: boolean }) => void) => { remove: () => void };
};

let Battery: BatteryModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Battery = require('expo-battery') as BatteryModule;
} catch {
  Battery = null;
}

/** True when Low Power Mode OR Reduce Motion is active → prefer an instant swap
 *  over the animated transition. Live-updates when either setting changes. */
export function useReducedTransitions(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      let lowPower = false;
      let motion = false;
      try {
        lowPower = Battery ? await Battery.isLowPowerModeEnabledAsync() : false;
      } catch {
        lowPower = false; // native module not in this build yet
      }
      try {
        motion = await AccessibilityInfo.isReduceMotionEnabled();
      } catch {
        motion = false;
      }
      if (mounted) setReduced(lowPower || motion);
    };

    refresh();

    const subs: Array<{ remove: () => void }> = [];
    try {
      if (Battery?.addLowPowerModeListener) subs.push(Battery.addLowPowerModeListener(refresh));
    } catch {
      /* no-op */
    }
    subs.push(AccessibilityInfo.addEventListener('reduceMotionChanged', refresh));

    return () => {
      mounted = false;
      subs.forEach((s) => s.remove());
    };
  }, []);

  return reduced;
}
