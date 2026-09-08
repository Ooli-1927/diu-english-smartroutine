import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useData } from '../context/DataContext';
import type { Appointment, AppointmentStatus } from '../lib/types';

export const APPOINTMENTS_CHANGED = 'diu-english:appointments-changed';

function emitAppointmentsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(APPOINTMENTS_CHANGED));
  }
}

export function useAppointments() {
  const { mode } = useData();
  const supported = mode === 'api';
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(supported);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported) {
      setLoading(false);
      return;
    }
    try {
      setItems(await api.appointments());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load appointments');
    } finally {
      setLoading(false);
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!supported) return undefined;
    const onChange = () => {
      void refresh();
    };
    window.addEventListener(APPOINTMENTS_CHANGED, onChange);
    const timer = window.setInterval(onChange, 15000);
    return () => {
      window.removeEventListener(APPOINTMENTS_CHANGED, onChange);
      window.clearInterval(timer);
    };
  }, [supported, refresh]);

  const request = useCallback(
    async (body: {
      teacher_initial: string;
      date: string;
      time: string;
      purpose?: string;
      slot_id?: string;
    }) => {
      const created = await api.requestAppointment(body);
      setItems((prev) => [created, ...prev]);
      emitAppointmentsChanged();
      return created;
    },
    [],
  );

  const respond = useCallback(
    async (id: string, status: AppointmentStatus, remarks?: string) => {
      const updated = await api.respondToAppointment(id, {
        status,
        teacher_remarks: remarks,
      });
      setItems((prev) => prev.map((a) => (a.id === id ? updated : a)));
      emitAppointmentsChanged();
      return updated;
    },
    [],
  );

  const pendingCount = items.filter((a) => a.status === 'pending').length;

  return { items, pendingCount, loading, error, supported, refresh, request, respond };
}
