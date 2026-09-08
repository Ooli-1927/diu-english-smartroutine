export type ToastKind = 'info' | 'warn' | 'error';

export const TOAST_EVENT = 'diu-toast';

export interface ToastDetail {
  message: string;
  kind?: ToastKind;
  durationMs?: number;
}

export function showToast(
  message: string,
  kind: ToastKind = 'info',
  durationMs = 6000,
) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ToastDetail>(TOAST_EVENT, {
      detail: { message, kind, durationMs },
    }),
  );
}
