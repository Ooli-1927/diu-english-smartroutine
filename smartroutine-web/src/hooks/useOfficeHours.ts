import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useData } from '../context/DataContext';
import type { AppointmentSlot, AppointmentWindow, DayCode } from '../lib/types';

export function useOfficeHours(teacherInitial?: string) {
  const { mode } = useData();
  const supported = mode === 'api';
  const [slots, setSlots] = useState<AppointmentSlot[]>([]);
  const [windows, setWindows] = useState<AppointmentWindow[]>([]);
  const [loading, setLoading] = useState(supported);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported) {
      setLoading(false);
      return;
    }
    try {
      const data = await api.appointmentSlots(teacherInitial);
      setSlots(data.slots || []);
      setWindows(data.windows || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load appointment schedule');
    } finally {
      setLoading(false);
    }
  }, [supported, teacherInitial]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const publish = useCallback(
    async (body: {
      day: DayCode;
      start_time: string;
      end_time: string;
      location?: string;
      note?: string;
    }) => {
      const merge = (created: AppointmentSlot) => {
        setSlots((prev) => {
          const i = prev.findIndex((s) => s.id === created.id);
          if (i >= 0) {
            const next = [...prev];
            next[i] = created;
            return next;
          }
          return [...prev, created];
        });
      };

      try {
        const created = await api.createAppointmentSlot(body);
        merge(created);
        try {
          await refresh();
        } catch {
          /* slot is already saved; list refresh can wait */
        }
        return created;
      } catch (e) {
        try {
          const data = await api.appointmentSlots();
          setSlots(data.slots || []);
          setWindows(data.windows || []);
          const match = (data.slots || []).find(
            (s) =>
              s.day === body.day &&
              s.start_time.slice(0, 5) === body.start_time.slice(0, 5) &&
              s.end_time.slice(0, 5) === body.end_time.slice(0, 5),
          );
          if (match) {
            setError(null);
            return match;
          }
        } catch {
          /* keep original error */
        }
        throw e;
      }
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, body: Partial<AppointmentSlot>) => {
      const updated = await api.updateAppointmentSlot(id, body);
      setSlots((prev) => prev.map((s) => (s.id === id ? updated : s)));
      await refresh();
      return updated;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.deleteAppointmentSlot(id);
      setSlots((prev) => prev.filter((s) => s.id !== id));
      setWindows((prev) => prev.filter((w) => w.slot_id !== id));
    },
    [],
  );

  return { slots, windows, loading, error, supported, refresh, publish, update, remove };
}
