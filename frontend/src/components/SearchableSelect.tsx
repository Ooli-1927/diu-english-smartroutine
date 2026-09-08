import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export type SearchableOption = {
  value: string;
  label: string;
  /** Extra text matched when filtering (defaults to label). */
  searchText?: string;
};

type Props = {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
  emptyLabel?: string;
};

function matchesQuery(query: string, option: SearchableOption) {
  const hay = (option.searchText || option.label).toLowerCase();
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((token) => hay.includes(token));
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  required = false,
  className = '',
  emptyLabel = 'No matches',
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) || null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => options.filter((o) => matchesQuery(query, o)),
    [options, query],
  );

  useEffect(() => {
    if (!open) setQuery('');
  }, [open, value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setQuery('');
  }

  const display = open ? query : selected?.label || '';

  return (
    <div
      ref={rootRef}
      className={`searchable-select${open ? ' open' : ''} ${className}`.trim()}
    >
      <input type="hidden" value={value} required={required} readOnly />
      <div className="searchable-select__control input">
        <Search size={15} className="searchable-select__ico" aria-hidden />
        <input
          className="searchable-select__input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder}
          value={display}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange('');
          }}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
            }
            if (e.key === 'Enter' && open && filtered[0]) {
              e.preventDefault();
              pick(filtered[0].value);
            }
          }}
        />
        <button
          type="button"
          className="searchable-select__chev"
          tabIndex={-1}
          aria-label="Toggle list"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown size={16} />
        </button>
      </div>
      {open && (
        <ul id={listId} className="searchable-select__list" role="listbox">
          {filtered.length === 0 ? (
            <li className="searchable-select__empty muted">{emptyLabel}</li>
          ) : (
            filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={o.value === value ? 'active' : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o.value)}
                >
                  {o.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
