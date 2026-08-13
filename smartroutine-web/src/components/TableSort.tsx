import { ArrowDown, ArrowUp } from 'lucide-react';
import type { SortDir } from '../lib/sort';

export interface SortColumn<K extends string> {
  key: K;
  label: string;
}

interface ControlsProps<K extends string> {
  columns: SortColumn<K>[];
  sortKey: K;
  sortDir: SortDir;
  onKey: (key: K) => void;
  onDir: (dir: SortDir) => void;
}

export function SortControls<K extends string>({
  columns,
  sortKey,
  sortDir,
  onKey,
  onDir,
}: ControlsProps<K>) {
  return (
    <>
      <select className="input" value={sortKey} onChange={(e) => onKey(e.target.value as K)}>
        {columns.map((c) => (
          <option key={c.key} value={c.key}>
            Sort by {c.label.toLowerCase()}
          </option>
        ))}
      </select>
      <button
        className="btn-outline"
        onClick={() => onDir(sortDir === 'asc' ? 'desc' : 'asc')}
        title="Switch between ascending and descending"
      >
        {sortDir === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
        {sortDir === 'asc' ? 'Ascending' : 'Descending'}
      </button>
    </>
  );
}

interface HeaderProps<K extends string> {
  columns: SortColumn<K>[];
  sortKey: K;
  sortDir: SortDir;
  onSort: (key: K) => void;
}

/** Table headers that sort on click and flip direction when clicked again. */
export function SortableHeaders<K extends string>({
  columns,
  sortKey,
  sortDir,
  onSort,
}: HeaderProps<K>) {
  return (
    <>
      {columns.map((c) => (
        <th
          key={c.key}
          className={`sortable ${sortKey === c.key ? 'sorted' : ''}`}
          onClick={() => onSort(c.key)}
          title={`Sort by ${c.label.toLowerCase()}`}
        >
          {c.label}
          {sortKey === c.key &&
            (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </th>
      ))}
    </>
  );
}
