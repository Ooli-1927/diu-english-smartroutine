import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useData } from '../../context/DataContext';
import type { Room } from '../../lib/types';
import { sortRows, type SortDir } from '../../lib/sort';
import { PageHero } from '../../components/PageHero';
import { SearchBox } from '../../components/SearchBox';
import { SortControls, SortableHeaders, type SortColumn } from '../../components/TableSort';

type SortKey = 'id' | 'name' | 'classes';
type RoomKind = 'all' | 'lab' | 'theory';

const columns: SortColumn<SortKey>[] = [
  { key: 'id', label: 'Room' },
  { key: 'name', label: 'Name' },
  { key: 'classes', label: 'Scheduled classes' },
];

const isLab = (room: Room) => /lab/i.test(room.name);

export function AdminRoomsPage() {
  const { store, upsertRoom, deleteRoom } = useData();
  const [form, setForm] = useState({ id: '', name: '' });
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<RoomKind>('all');
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of store?.timetable || []) {
      if (!e.room_id) continue;
      counts.set(e.room_id, (counts.get(e.room_id) || 0) + 1);
    }
    return counts;
  }, [store]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (store?.rooms || []).filter((r) => {
      if (kind === 'lab' && !isLab(r)) return false;
      if (kind === 'theory' && isLab(r)) return false;
      return q ? [r.id, r.name].some((f) => f.toLowerCase().includes(q)) : true;
    });
    const value = (r: Room) =>
      sortKey === 'name' ? r.name : sortKey === 'classes' ? String(usage.get(r.id) || 0) : r.id;
    return sortRows(filtered, value, sortDir);
  }, [store, usage, query, kind, sortKey, sortDir]);

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function startEdit(room: Room) {
    setEditing(room.id);
    setForm({ id: room.id, name: room.name });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const room: Room = {
      id: editing || form.id.trim() || form.name.trim(),
      name: form.name.trim(),
    };
    try {
      await upsertRoom(room, !editing);
      setForm({ id: '', name: '' });
      setEditing(null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save room');
    }
  }

  return (
    <div className="admin-page">
      <PageHero
        variant="admin"
        kicker="Campus · Spaces"
        title="Rooms"
        subtitle="Classrooms and labs available for scheduling across the department."
      />
      <form className="card pad row-3" onSubmit={onSubmit}>
        <input
          className="input"
          placeholder="Room number e.g. 2701"
          value={form.id}
          onChange={(e) => setForm({ ...form, id: e.target.value })}
          disabled={Boolean(editing)}
        />
        <input
          className="input"
          placeholder="Display name e.g. 2701 (LAB)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <button className="btn-primary">
          {editing ? <Pencil size={16} /> : <Plus size={16} />}
          {editing ? 'Update' : 'Add Room'}
        </button>
      </form>
      {error && <div className="error-banner">{error}</div>}

      <div className="filter-bar">
        <SearchBox value={query} onChange={setQuery} placeholder="Search room number or name" />
        <select
          className="input"
          value={kind}
          onChange={(e) => setKind(e.target.value as RoomKind)}
        >
          <option value="all">All rooms</option>
          <option value="theory">Classrooms only</option>
          <option value="lab">Labs only</option>
        </select>
        <SortControls
          columns={columns}
          sortKey={sortKey}
          sortDir={sortDir}
          onKey={setSortKey}
          onDir={setSortDir}
        />
      </div>

      <div className="row-between result-line">
        <span className="muted">
          Showing {list.length} of {store?.rooms.length || 0} rooms
        </span>
      </div>

      <div className="table-wrap card">
        <table>
          <thead>
            <tr>
              <SortableHeaders
                columns={columns}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={sortBy}
              />
              <th />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={4} className="muted center-cell">
                  No room matches this search.
                </td>
              </tr>
            )}
            {list.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.name}</td>
                <td className="muted">{usage.get(r.id) || 0}</td>
                <td className="row-gap">
                  <button className="icon-btn" onClick={() => startEdit(r)}>
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() => {
                      if (window.confirm('Delete this room?')) void deleteRoom(r.id);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
