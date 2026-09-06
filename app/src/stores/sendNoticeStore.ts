import { create } from 'zustand';
import * as Haptics from 'expo-haptics';

// 'sent'/'received' → green + check, 'error' → red + alert, 'online' → blue, no
// icon (used for the "back online" connectivity toast).
export type SendNoticeKind = 'sent' | 'received' | 'error' | 'online';

export interface SendNoticeData {
  kind: SendNoticeKind;
  message: string;
  /** Bumped every show() so the pill re-mounts and its entrance animation replays. */
  id: number;
}

interface SendNoticeState {
  notice: SendNoticeData | null;
  /** Number of mounted "scoped" pills (rendered inside a native modal screen so
   *  the toast shows on top of it). While > 0 the root pill yields, so only one
   *  pill is ever visible. */
  scopeCount: number;
  /** Show a floating send-result pill. Auto-clears after a few seconds unless
   *  `sticky` is set, in which case it stays until cleared or replaced (used for
   *  the swap quote error, which should linger until the amount changes). */
  show: (kind: SendNoticeKind, message?: string, sticky?: boolean) => void;
  clear: () => void;
  enterScope: () => void;
  exitScope: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

const impact = (style: Haptics.ImpactFeedbackStyle) => Haptics.impactAsync(style);

/** Build the result feel out of impactAsync (which fires reliably in this app,
 *  unlike notificationAsync which the OS drops around the sheet dismissal):
 *  sent  → soft rising double-tap (Light → Medium) = positive confirm.
 *  error → firm heavy double-tap (Heavy → Heavy)    = negative buzz.
 *  Call this at the exact moment the send resolves (see confirm.tsx) — NOT from a
 *  deferred timer, which the OS drops around Face ID + the sheet dismissal. */
export function sendResultHaptic(kind: SendNoticeKind) {
  if (kind === 'sent' || kind === 'received') {
    impact(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => impact(Haptics.ImpactFeedbackStyle.Medium), 110);
  } else if (kind === 'online') {
    // Blue info / back-online pill: a single gentle tap.
    impact(Haptics.ImpactFeedbackStyle.Light);
  } else {
    impact(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => impact(Haptics.ImpactFeedbackStyle.Heavy), 120);
  }
}

export const useSendNotice = create<SendNoticeState>((set) => ({
  notice: null,
  scopeCount: 0,
  enterScope: () => set((s) => ({ scopeCount: s.scopeCount + 1 })),
  exitScope: () => set((s) => ({ scopeCount: Math.max(0, s.scopeCount - 1) })),
  show: (kind, message, sticky) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    seq += 1;
    const fallback =
      kind === 'sent' ? 'Sent' : kind === 'received' ? 'Received' : kind === 'online' ? 'Back online' : 'Something went wrong';
    set({ notice: { kind, message: message ?? fallback, id: seq } });
    // Every notice gets a tone-appropriate haptic, fired here so all callers
    // (toasts, connectivity, send results) are covered in one place.
    sendResultHaptic(kind);
    // Sticky notices persist until explicitly cleared or replaced by another.
    if (!sticky) timer = setTimeout(() => set({ notice: null }), kind === 'error' ? 3400 : 2600);
  },
  clear: () => {
    if (timer) clearTimeout(timer);
    set({ notice: null });
  },
}));
