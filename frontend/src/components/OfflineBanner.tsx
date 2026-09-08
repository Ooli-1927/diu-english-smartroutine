import { useData } from '../context/DataContext';

export function OfflineBanner() {
  const { mode, isOffline } = useData();

  if (!isOffline) return null;

  if (mode === 'supabase') {
    return (
      <div className="offline-banner offline-banner--supabase" role="status">
        Supabase mode — live DIU API is offline. Changes depend on Supabase RLS and auth; they are
        not written to the production server.
      </div>
    );
  }

  return (
    <div className="offline-banner" role="status">
      Offline / demo mode — changes stay in this browser; not the live DIU server. Login is still
      required.
    </div>
  );
}
