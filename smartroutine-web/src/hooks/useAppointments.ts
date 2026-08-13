import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useData } from '../context/DataContext';
import type { Appointment, AppointmentStatus } from '../lib/types';

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

  const request = useCallback(
    async (body: { teacher_initial: string; date: string; time: string; purpose?: string }) => {
      const created = await api.requestAppointment(body);
      setItems((prev) => [created, ...prev]);
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
      return updated;
    },
    [],
  );

  return { items, loading, error, supported, refresh, request, respond };
}
