export type SortDir = 'asc' | 'desc';

/** Numeric-aware so 2102010 sorts after 2102009, not between 2102001 and 2102002. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortRows<T>(rows: T[], value: (row: T) => string, dir: SortDir): T[] {
  return [...rows].sort((a, b) => collator.compare(value(a), value(b)) * (dir === 'asc' ? 1 : -1));
}
