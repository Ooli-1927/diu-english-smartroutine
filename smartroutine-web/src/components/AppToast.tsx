import { useEffect, useState } from 'react';
import { TOAST_EVENT, type ToastDetail, type ToastKind } from '../lib/toast';

export function AppToast() {
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<ToastKind>('info');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let hideTimer = 0;
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      if (!detail?.message) return;
      setMessage(detail.message);
      setKind(detail.kind || 'info');
      setVisible(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(
        () => setVisible(false),
        detail.durationMs ?? 6000,
      );
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (!visible || !message) return null;

  return (
    <div className={`app-toast app-toast--${kind}`} role="status">
      {message}
    </div>
  );
}
