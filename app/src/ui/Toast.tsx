import { create } from 'zustand';
import { useSendNotice } from '../stores/sendNoticeStore';

export type ToastTone = 'info' | 'error' | 'success';

interface ToastState {
  /** `sticky` keeps the toast up until it's replaced or `hide()`d (default auto-dismisses). */
  show: (msg: string, tone?: ToastTone, opts?: { sticky?: boolean }) => void;
  hide: () => void;
}

/**
 * Toasts render through the single top notice card (see SendNotice) — the old
 * bottom toast was removed.
 *
 * Every tone shares the same white pill; the tone only changes a small leading
 * dot: `success` → green, `error` → red, `info` → neutral. Pass
 * `{ sticky: true }` for a notice that stays until replaced or hidden.
 */
export const useToast = create<ToastState>(() => ({
  show: (msg, tone = 'info', opts) =>
    useSendNotice.getState().show(tone === 'error' ? 'error' : tone === 'success' ? 'sent' : 'online', msg, opts?.sticky),
  hide: () => useSendNotice.getState().clear(),
}));

/** @deprecated The bottom toast was removed; toasts now surface via the top
 *  SendNotice pill. Kept as a no-op so existing mounts don't need touching. */
export function ToastHost() {
  return null;
}
