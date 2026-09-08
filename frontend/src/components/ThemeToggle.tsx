import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`}
      onClick={toggleTheme}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <span className={`theme-toggle-thumb ${dark ? 'dark' : ''}`}>
        {dark ? <Moon size={14} /> : <Sun size={14} />}
      </span>
      <span className="theme-toggle-label">{dark ? 'Dark' : 'Light'}</span>
    </button>
  );
}
