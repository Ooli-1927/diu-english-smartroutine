import { Search, X } from 'lucide-react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

export function SearchBox({ value, onChange, placeholder }: Props) {
  return (
    <div className="search-box">
      <Search size={18} />
      <input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button className="icon-btn" onClick={() => onChange('')} title="Clear search">
          <X size={16} />
        </button>
      )}
    </div>
  );
}
