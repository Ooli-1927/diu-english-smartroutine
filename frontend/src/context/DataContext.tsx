import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type {
  AuthSession,
  Batch,
  Course,
  Room,
  Student,
  Teacher,
  TimetableEntry,
} from '../lib/types';
import {
  getStoreVault,
  loadStore,
  persistStore,
  scopeStoreForSession,
  storeFromBootstrap,
  type StoreState,
} from '../lib/store';
import { ConflictError, conflictsWith } from '../lib/conflicts';
import { uid } from '../lib/constants';
import { supabase } from '../lib/supabase';
import { api, ApiError, clearToken, getToken, isApiReachable } from '../lib/api';
import { showToast } from '../lib/toast';

export type BackendMode = 'api' | 'supabase' | 'local' | 'unknown';

interface DataContextValue {
  store: StoreState | null;
  mode: BackendMode;
  /** True when not talking to the live Express API (local or supabase fallback). */
  isOffline: boolean;
  ready: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Re-scope offline store after login / logout / session restore. */
  applySessionScope: (session: AuthSession | null) => void;
  courseByCode: (code: string) => Course | undefined;
  teacherByInitial: (initial: string) => Teacher | undefined;
  batchById: (id: string) => Batch | undefined;
  roomById: (id: string | null | undefined) => Room | undefined;
  updateTimetableEntry: (
    id: string,
    patch: Partial<TimetableEntry>,
    opts?: { force?: boolean },
  ) => Promise<void>;
  addTimetableEntry: (
    entry: Omit<TimetableEntry, 'id'>,
    opts?: { force?: boolean },
  ) => Promise<void>;
  deleteTimetableEntry: (id: string) => Promise<void>;
  upsertBatch: (batch: Batch, isNew?: boolean) => Promise<void>;
  deleteBatch: (id: string) => Promise<void>;
  upsertStudent: (student: Student, isNew?: boolean) => Promise<void>;
  deleteStudent: (id: string) => Promise<void>;
  upsertTeacher: (teacher: Teacher, isNew?: boolean) => Promise<void>;
  deleteTeacher: (id: string) => Promise<void>;
  upsertRoom: (room: Room, isNew?: boolean) => Promise<void>;
  deleteRoom: (id: string) => Promise<void>;
  upsertCourse: (course: Course, isNew?: boolean) => Promise<void>;
  deleteCourse: (id: string) => Promise<void>;
  seedImportEntities: (courses: Course[], rooms: Room[]) => Promise<void>;
  importTimetable: (
    entries: Omit<TimetableEntry, 'id'>[],
    replace: boolean,
  ) => Promise<{ imported: number; rejected: number }>;
  updateOwnProfilePic: (
    who: { role: string; id: string; teacherInitial?: string | null },
    profilePic: string | null,
  ) => Promise<string | null>;
  changePassword: (
    role: 'student' | 'teacher',
    id: string,
    current: string,
    next: string,
  ) => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<StoreState | null>(null);
  const [mode, setMode] = useState<BackendMode>('unknown');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<AuthSession | null>(null);
  const warnedOffline = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const apiUp = await isApiReachable();
      if (apiUp) {
        warnedOffline.current = false;
        setMode('api');
        if (getToken()) {
          try {
            const payload = await api.bootstrap();
            setStore(storeFromBootstrap(payload));
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) {
              clearToken();
              setStore(null);
            } else {
              throw e;
            }
          }
        } else {
          setStore(null);
        }
        setError(null);
        return;
      }

      if (!warnedOffline.current) {
        warnedOffline.current = true;
        console.warn(
          '[DIU SmartRoutine] Live API unreachable — falling back to offline/demo mode. Changes stay in this browser and are not written to the live DIU server.',
        );
        showToast(
          'Offline / demo mode — live API unreachable. Login still required; changes stay in this browser.',
          'warn',
        );
      }

      const data = await loadStore();
      const nextMode = data.source === 'supabase' ? 'supabase' : 'local';
      setMode(nextMode);
      setStore(scopeStoreForSession(data, sessionRef.current));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isApi = mode === 'api';
  const isOffline = mode === 'local' || mode === 'supabase';

  const applySessionScope = useCallback(
    (session: AuthSession | null) => {
      sessionRef.current = session;
      if (mode === 'api' || mode === 'unknown') return;
      const vault = getStoreVault();
      if (!vault) return;
      setStore(scopeStoreForSession(vault, session));
    },
    [mode],
  );

  /** API mode: set React state only. Offline: mutate vault, then publish scoped+sanitized view. */
  const commitApi = useCallback((next: StoreState) => {
    setStore(next);
  }, []);

  const commitOffline = useCallback((mutator: (vault: StoreState) => StoreState) => {
    const vault = getStoreVault();
    if (!vault) return;
    const next = mutator(vault);
    persistStore(next);
    setStore(scopeStoreForSession(next, sessionRef.current));
  }, []);

  const courseByCode = useCallback(
    (code: string) => store?.courses.find((c) => c.code === code),
    [store],
  );
  const teacherByInitial = useCallback(
    (initial: string) =>
      store?.teachers.find((t) => t.initial.toLowerCase() === initial.toLowerCase()),
    [store],
  );
  const batchById = useCallback(
    (id: string) => store?.batches.find((b) => b.id === id || b.name === id),
    [store],
  );
  const roomById = useCallback(
    (id: string | null | undefined) => {
      if (!id || !store) return undefined;
      return store.rooms.find((r) => r.id === id || r.name === id);
    },
    [store],
  );

  const updateTimetableEntry = useCallback(
    async (id: string, patch: Partial<TimetableEntry>, opts?: { force?: boolean }) => {
      if (!store) return;
      if (isApi) {
        const updated = await api.patchEntry(id, { ...patch, force: opts?.force });
        commitApi({
          ...store,
          timetable: store.timetable.map((e) => (e.id === id ? updated : e)),
        });
        return;
      }
      const vault = getStoreVault();
      if (!vault) return;
      const current = vault.timetable.find((e) => e.id === id);
      if (current && !opts?.force) {
        const clashes = conflictsWith({ ...current, ...patch }, vault.timetable);
        if (clashes.length) throw new ConflictError(clashes);
      }
      commitOffline((v) => ({
        ...v,
        timetable: v.timetable.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      }));
      if (vault.source === 'supabase' && supabase) {
        const rest = { ...patch };
        delete rest.id;
        await supabase.from('timetable_entries').update(rest).eq('id', id);
      }
    },
    [store, commitApi, commitOffline, isApi],
  );

  const addTimetableEntry = useCallback(
    async (entry: Omit<TimetableEntry, 'id'>, opts?: { force?: boolean }) => {
      if (!store) return;
      if (isApi) {
        const created = await api.createEntry({ ...entry, force: opts?.force });
        commitApi({ ...store, timetable: [...store.timetable, created] });
        return;
      }
      const vault = getStoreVault();
      if (!vault) return;
      if (!opts?.force) {
        const clashes = conflictsWith(entry, vault.timetable);
        if (clashes.length) throw new ConflictError(clashes);
      }
      const full = { ...entry, id: uid('tt') };
      commitOffline((v) => ({ ...v, timetable: [...v.timetable, full] }));
      if (vault.source === 'supabase' && supabase) {
        await supabase.from('timetable_entries').insert(full);
      }
    },
    [store, commitApi, commitOffline, isApi],
  );

  const deleteTimetableEntry = useCallback(
    async (id: string) => {
      if (!store) return;
      if (isApi) {
        await api.deleteEntry(id);
        commitApi({ ...store, timetable: store.timetable.filter((e) => e.id !== id) });
        return;
      }
      const vault = getStoreVault();
      commitOffline((v) => ({
        ...v,
        timetable: v.timetable.filter((e) => e.id !== id),
      }));
      if (vault?.source === 'supabase' && supabase) {
        await supabase.from('timetable_entries').delete().eq('id', id);
      }
    },
    [store, commitApi, commitOffline, isApi],
  );

  const upsertBatch = useCallback(
    async (batch: Batch, isNew = false) => {
      if (!store) return;
      if (isApi) {
        const saved = isNew
          ? await api.createBatch({ name: batch.name, session: batch.session })
          : await api.updateBatch(batch.id, { name: batch.name, session: batch.session });
        commitApi({
          ...store,
          batches: isNew
            ? [...store.batches, saved]
            : store.batches.map((b) => (b.id === saved.id ? saved : b)),
        });
        return;
      }
      commitOffline((v) => {
        const exists = v.batches.some((b) => b.id === batch.id);
        const batches = exists
          ? v.batches.map((b) => (b.id === batch.id ? batch : b))
          : [...v.batches, batch];
        return { ...v, batches };
      });
      if (getStoreVault()?.source === 'supabase' && supabase) {
        await supabase.from('batches').upsert(batch);
      }
    },
    [store, commitApi, commitOffline, isApi],
  );

  const deleteBatch = useCallback(
    async (id: string) => {
      if (!store) return;
      if (isApi) {
        await api.deleteBatch(id);
        commitApi({
          ...store,
          batches: store.batches.filter((b) => b.id !== id),
          students: store.students.filter((s) => s.batch_id !== id),
          timetable: store.timetable.filter((t) => t.batch_id !== id),
        });
        return;
      }
      commitOffline((v) => ({
        ...v,
        batches: v.batches.filter((b) => b.id !== id),
        students: v.students.filter((s) => s.batch_id !== id),
        timetable: v.timetable.filter((t) => t.batch_id !== id),
      }));
      if (getStoreVault()?.source === 'supabase' && supabase) {
        await supabase.from('batches').delete().eq('id', id);
      }
    },
    [store, commitApi, commitOffline, isApi],
  );

  const upsertStudent = useCallback(
    async (student: Student, isNew = false) => {
      if (!store) return;
      if (isApi) {
        const payload = {
          student_id: student.student_id,
          name: student.name,
          batch_id: student.batch_id,
          email: student.email,
          phone: student.phone,
          profile_pic: student.profile_pic,
          ...(student.password ? { password: student.password } : {}),
        };
        const saved = isNew
          ? await api.createStudent(payload)
          : await api.updateStudent(student.id, payload);
        commitApi({
          ...store,
          students: isNew
            ? [...store.students, saved]
            : store.students.map((s) => (s.id === saved.id ? saved : s)),
        });
        return;
      }
      commitOffline((v) => {
        const exists = v.students.some((s) => s.id === student.id);
        const prev = v.students.find((s) => s.id === student.id);
        const merged: Student = {
          ...student,
          password: student.password || prev?.password || null,
        };
        const students = exists
          ? v.students.map((s) => (s.id === student.id ? merged : s))
          : [...v.students, merged];
        return { ...v, students };
      });
      if (getStoreVault()?.source === 'supabase' && supabase) {
        await supabase.from('students').upsert(student);
      }
    },
    [store, commitApi, commitOffline, isApi],
  );

  const deleteStudent = useCallback(
    async (id: string) => {
      if (!store) return;
      if (isApi) {
        await api.deleteStudent(id);
        commitApi({ ...store, students: store.students.filter((s) => s.id !== id) });
        return;
      }
      commitOffline((v) => ({
        ...v,
        students: v.students.filter((s) => s.id !== id),
      }));
      if (getStoreVault()?.source === 'supabase' && supabase) {
        await supabase.from('students').delete().eq('id', id);
      }
    },
    [store, commitApi, commitOffline, isApi],
  );

  const upsertTeacher = useCallback(
    async (teacher: Teacher, isNew = false) => {
      if (!store) return;
      if (isApi) {
        const payload = {
          name: teacher.name,
          initial: teacher.initial,
          designation: teacher.designation,
          email: teacher.email,
          phone: teacher.phone,
          home_department: teacher.home_department,
          profile_pic: teacher.profile_pic,
          ...(teacher.password ? { password: teacher.password } : {}),
        };
        const saved = isNew
          ? await api.createTeacher(payload)
          : await api.updateTeacher(teacher.id, payload);
        commitApi({
          ...store,
          teachers: isNew
            ? [...store.teachers, saved]
            : store.teachers.map((t) => (t.id === saved.id ? saved : t)),
        });
        return;
      }
      commitOffline((v) => {
        const exists = v.teachers.some((t) => t.id === teacher.id);
        const prev = v.teachers.find((t) => t.id === teacher.id);
        const merged: Teacher = {
          ...teacher,
          password: teacher.password || prev?.password || null,
        };
        const teachers = exists
          ? v.teachers.map((t) => (t.id === teacher.id ? merged : t))
          : [...v.teachers, merged];
        return { ...v, teachers };
      });
      if (getStoreVault()?.source === 'supabase' && supabase) {
        await supabase.from('teachers').upsert(teacher);
      }
    },
    [store, commitApi, commitOffline, isApi],
  );

  const deleteTeacher = useCallback(
    async (id: string) => {
      if (!store) return;
      if (isApi) {
        await api.deleteTeacher(id);
        const t = store.teachers.find((x) => x.id === id);
        commitApi({
          ...store,
          teachers: store.teachers.filter((x) => x.id !== id),
          timetable: t
            ? store.timetable.filter((e) => e.teacher_initial !== t.initial)
            : store.timetable,
        });
        return;
      }
      commitOffline((v) => {
        const t = v.teachers.find((x) => x.id === id);
        return {
          ...v,
          teachers: v.teachers.filter((x) => x.id !== id),
          timetable: t
            ? v.timetable.filter((e) => e.teacher_initial !== t.initial)
            : v.timetable,
        };
      });
      if (getStoreVault()?.source === 'supabase' && supabase) {
        await supabase.from('teachers').delete().eq('id', id);
      }
    },
    [store, commitApi, commitOffline, isApi],
  );

  const upsertRoom = useCallback(
    async (room: Room, isNew = false) => {
      if (!store) return;
      if (isApi) {
        const saved = isNew
          ? await api.createRoom({ id: room.id, name: room.name })
          : await api.updateRoom(room.id, { name: room.name });
        commitApi({
          ...store,
          rooms: isNew
            ? [...store.rooms, saved]
            : store.rooms.map((r) => (r.id === saved.id ? saved : r)),
        });
        return;
      }
      commitOffline((v) => {
        const exists = v.rooms.some((r) => r.id === room.id);
        const rooms = exists
          ? v.rooms.map((r) => (r.id === room.id ? room : r))
          : [...v.rooms, room];
        return { ...v, rooms };
      });
      if (getStoreVault()?.source === 'supabase' && supabase) {
        await supabase.from('rooms').upsert(room);
      }
    },
    [store, commitApi, commitOffline, isApi],
  );

  const deleteRoom = useCallback(
    async (id: string) => {
      if (!store) return;
      if (isApi) {
        await api.deleteRoom(id);
        commitApi({ ...store, rooms: store.rooms.filter((r) => r.id !== id) });
        return;
      }
      commitOffline((v) => ({ ...v, rooms: v.rooms.filter((r) => r.id !== id) }));
      if (getStoreVault()?.source === 'supabase' && supabase) {
        await supabase.from('rooms').delete().eq('id', id);
      }
    },
    [store, commitApi, commitOffline, isApi],
  );

  const upsertCourse = useCallback(
    async (course: Course, isNew = false) => {
      if (!store) return;
      if (isApi) {
        const saved = isNew
          ? await api.createCourse({ code: course.code, title: course.title })
          : await api.updateCourse(course.id, { code: course.code, title: course.title });
        commitApi({
          ...store,
          courses: isNew
            ? [...store.courses, saved]
            : store.courses.map((c) => (c.id === saved.id ? saved : c)),
        });
        return;
      }
      commitOffline((v) => {
        const exists = v.courses.some((c) => c.id === course.id);
        const courses = exists
          ? v.courses.map((c) => (c.id === course.id ? course : c))
          : [...v.courses, course];
        return { ...v, courses };
      });
      if (getStoreVault()?.source === 'supabase' && supabase) {
        await supabase.from('courses').upsert(course);
      }
    },
    [store, commitApi, commitOffline, isApi],
  );

  const deleteCourse = useCallback(
    async (id: string) => {
      if (!store) return;
      if (isApi) {
        await api.deleteCourse(id);
        commitApi({ ...store, courses: store.courses.filter((c) => c.id !== id) });
        return;
      }
      commitOffline((v) => ({ ...v, courses: v.courses.filter((c) => c.id !== id) }));
      if (getStoreVault()?.source === 'supabase' && supabase) {
        await supabase.from('courses').delete().eq('id', id);
      }
    },
    [store, commitApi, commitOffline, isApi],
  );

  const seedImportEntities = useCallback(
    async (courses: Course[], rooms: Room[]) => {
      if (!store) return;
      if (!courses.length && !rooms.length) return;
      if (isApi) {
        for (const course of courses) {
          try {
            await api.createCourse({ code: course.code, title: course.title });
          } catch {
            /* may already exist */
          }
        }
        for (const room of rooms) {
          try {
            await api.createRoom({ id: room.id, name: room.name });
          } catch {
            /* may already exist */
          }
        }
        const payload = await api.bootstrap();
        commitApi(storeFromBootstrap(payload));
        return;
      }
      commitOffline((v) => {
        const courseCodes = new Set(v.courses.map((c) => c.code));
        const roomIds = new Set(v.rooms.map((r) => r.id));
        return {
          ...v,
          courses: [...v.courses, ...courses.filter((c) => !courseCodes.has(c.code))],
          rooms: [...v.rooms, ...rooms.filter((r) => !roomIds.has(r.id))],
        };
      });
    },
    [store, commitApi, commitOffline, isApi],
  );

  const importTimetable = useCallback(
    async (entries: Omit<TimetableEntry, 'id'>[], replace: boolean) => {
      if (!store) return { imported: 0, rejected: 0 };
      if (isApi) {
        const result = await api.importEntries(entries, replace);
        const payload = await api.bootstrap();
        commitApi(storeFromBootstrap(payload));
        return { imported: result.imported, rejected: result.rejected.length };
      }
      const mapped = entries.map((e) => ({ ...e, id: uid('tt') }));
      commitOffline((v) => ({
        ...v,
        timetable: replace ? mapped : [...v.timetable, ...mapped],
      }));
      return { imported: mapped.length, rejected: 0 };
    },
    [store, commitApi, commitOffline, isApi],
  );

  const changePassword = useCallback(
    async (role: 'student' | 'teacher', id: string, current: string, next: string) => {
      if (isApi) {
        await api.changePassword(current, next);
        return;
      }
      const vault = getStoreVault();
      if (!vault) throw new Error('No data');
      if (role === 'student') {
        const s = vault.students.find((x) => x.id === id);
        if (!s || s.password !== current) throw new Error('Current password is incorrect');
        if (s.has_changed_password) {
          throw new Error('Password already changed once. Ask the Chairman to reset it.');
        }
        await upsertStudent({ ...s, password: next, has_changed_password: true });
      } else {
        const t = vault.teachers.find((x) => x.id === id);
        if (!t || !t.password || t.password !== current) {
          throw new Error('Current password is incorrect');
        }
        if (t.has_changed_password) {
          throw new Error('Password already changed once. Ask the Chairman to reset it.');
        }
        await upsertTeacher({ ...t, password: next, has_changed_password: true });
      }
    },
    [upsertStudent, upsertTeacher, isApi],
  );

  const updateOwnProfilePic = useCallback(
    async (
      who: { role: string; id: string; teacherInitial?: string | null },
      profilePic: string | null,
    ) => {
      if (isApi) {
        const { session } = await api.updateProfilePic(profilePic);
        return session.profilePic ?? null;
      }
      if (who.role === 'student') {
        commitOffline((v) => ({
          ...v,
          students: v.students.map((s) =>
            s.id === who.id ? { ...s, profile_pic: profilePic } : s,
          ),
        }));
      } else if (who.role === 'teacher' || who.role === 'teacher_admin') {
        commitOffline((v) => ({
          ...v,
          teachers: v.teachers.map((t) =>
            (who.teacherInitial && t.initial === who.teacherInitial) || t.id === who.id
              ? { ...t, profile_pic: profilePic }
              : t,
          ),
        }));
      } else if (who.role === 'super_admin') {
        commitOffline((v) => ({
          ...v,
          admins: v.admins.map((a) =>
            a.id === who.id ? { ...a, profile_pic: profilePic } : a,
          ),
        }));
      }
      return profilePic;
    },
    [commitOffline, isApi],
  );

  const value = useMemo(
    () => ({
      store,
      mode,
      isOffline,
      ready,
      error,
      refresh,
      applySessionScope,
      courseByCode,
      teacherByInitial,
      batchById,
      roomById,
      updateTimetableEntry,
      addTimetableEntry,
      deleteTimetableEntry,
      upsertBatch,
      deleteBatch,
      upsertStudent,
      deleteStudent,
      upsertTeacher,
      deleteTeacher,
      upsertRoom,
      deleteRoom,
      upsertCourse,
      deleteCourse,
      seedImportEntities,
      importTimetable,
      updateOwnProfilePic,
      changePassword,
    }),
    [
      store,
      mode,
      isOffline,
      ready,
      error,
      refresh,
      applySessionScope,
      courseByCode,
      teacherByInitial,
      batchById,
      roomById,
      updateTimetableEntry,
      addTimetableEntry,
      deleteTimetableEntry,
      upsertBatch,
      deleteBatch,
      upsertStudent,
      deleteStudent,
      upsertTeacher,
      deleteTeacher,
      upsertRoom,
      deleteRoom,
      upsertCourse,
      deleteCourse,
      seedImportEntities,
      importTimetable,
      updateOwnProfilePic,
      changePassword,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
