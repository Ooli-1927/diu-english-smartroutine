import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarSync, Link2, Link2Off, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { useData } from '../context/DataContext';

type Status = {
  configured: boolean;
  connected: boolean;
  allowed?: boolean;
  email: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

const empty: Status = {
  configured: false,
  connected: false,
  allowed: true,
  email: null,
  lastSyncAt: null,
  lastSyncError: null,
};

/** One-way SmartRoutine → Google Calendar controls for Profile pages. */
export function GoogleCalendarPanel() {
  const { mode } = useData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<Status>(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (mode !== 'api') {
      setStatus(empty);
      setLoading(false);
      return;
    }
    try {
      setStatus(await api.googleStatus());
    } catch {
      setStatus(empty);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const flag = searchParams.get('google');
    if (!flag) return;
    if (flag === 'connected') {
      setMsg('Google Calendar connected. Your routine will sync one-way into DIU SmartRoutine.');
      void refresh();
    } else if (flag === 'error') {
      setErr(searchParams.get('message') || 'Could not connect Google Calendar');
    }
    const next = new URLSearchParams(searchParams);
    next.delete('google');
    next.delete('message');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, refresh]);

  if (mode !== 'api') {
    return (
      <section className="profile-panel">
        <h3>
          <CalendarSync size={16} style={{ marginRight: 8 }} /> Google Calendar
        </h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Google sync needs Live API mode. You can still use Export to Calendar (.ics) on your
          schedule.
        </p>
      </section>
    );
  }

  async function connect() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const { url } = await api.googleAuthUrl();
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start Google connect');
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api.googleSync();
      if (res.status) setStatus({ ...res.status, allowed: true });
      setMsg(
        typeof res.events === 'number'
          ? `Synced ${res.events} class${res.events === 1 ? '' : 'es'} to Google Calendar.`
          : 'Synced to Google Calendar.',
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sync failed');
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Google Calendar? Synced events stay in Google until you delete them.')) {
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api.googleDisconnect();
      setStatus({ ...empty, configured: res.status?.configured ?? status.configured, allowed: true });
      setMsg('Google Calendar disconnected.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Disconnect failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="profile-panel">
      <h3>
        <CalendarSync size={16} style={{ marginRight: 8 }} /> Google Calendar
      </h3>
      <p className="muted" style={{ marginTop: 0 }}>
        One-way sync: SmartRoutine pushes your classes into a calendar named{' '}
        <strong>DIU SmartRoutine</strong>. Edits in Google do not change the official routine.
        Cancel / reschedule / room changes update Google automatically when connected.
      </p>

      {loading ? (
        <p className="muted">Checking connection…</p>
      ) : !status.configured ? (
        <p className="muted">
          Google Calendar is not configured on the server yet (set GOOGLE_CLIENT_ID / SECRET — see
          SETUP.md). Use Export to Calendar (.ics) on your schedule in the meantime.
        </p>
      ) : (
        <>
          <div className="info-row">
            <span className="muted">Status</span>
            <strong>{status.connected ? 'Connected' : 'Not connected'}</strong>
          </div>
          {status.email && (
            <div className="info-row">
              <span className="muted">Google account</span>
              <strong>{status.email}</strong>
            </div>
          )}
          {status.lastSyncAt && (
            <div className="info-row">
              <span className="muted">Last sync</span>
              <strong>{new Date(status.lastSyncAt).toLocaleString()}</strong>
            </div>
          )}
          {status.lastSyncError && (
            <p className="error small" style={{ marginTop: 8 }}>
              Last sync error: {status.lastSyncError}
            </p>
          )}

          <div className="row-gap" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            {!status.connected ? (
              <button
                type="button"
                className="btn-primary"
                style={{ width: 'auto' }}
                disabled={busy}
                onClick={() => void connect()}
              >
                <Link2 size={16} /> Connect Google Calendar
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ width: 'auto' }}
                  disabled={busy}
                  onClick={() => void syncNow()}
                >
                  <RefreshCw size={16} /> Sync now
                </button>
                <button
                  type="button"
                  className="btn-outline"
                  style={{ width: 'auto' }}
                  disabled={busy}
                  onClick={() => void disconnect()}
                >
                  <Link2Off size={16} /> Disconnect
                </button>
              </>
            )}
          </div>
        </>
      )}

      {(msg || err) && (
        <div className={err ? 'error-banner' : 'success-banner'} style={{ marginTop: 12 }}>
          {err || msg}
        </div>
      )}
    </section>
  );
}
