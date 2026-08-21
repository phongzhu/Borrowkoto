import { useEffect, useId, useMemo, useRef, useState } from 'react';
import './SearchableSelect.css';

export default function SearchableSelect({
  ariaLabel,
  disabled = false,
  emptyMessage = 'No matches found',
  onChange,
  options,
  placeholder = 'Select an option',
  searchPlaceholder = 'Search',
  value = '',
}) {
  const id = useId();
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedOption = options.find((option) => String(option.value) === String(value));
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }

    function handleEscape(event) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
    else setQuery('');
  }, [open]);

  function selectOption(nextValue) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div className={`searchable-select${open ? ' open' : ''}${disabled ? ' disabled' : ''}`} ref={rootRef}>
      <button
        aria-controls={`${id}-listbox`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="searchable-select-trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={selectedOption ? '' : 'placeholder'}>{selectedOption?.label || placeholder}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5 7.5 5 5 5-5" /></svg>
      </button>

      {open ? (
        <div className="searchable-select-menu">
          <div className="searchable-select-search">
            <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              aria-label={searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              ref={searchRef}
              type="search"
              value={query}
            />
          </div>
          <div className="searchable-select-options" id={`${id}-listbox`} role="listbox">
            {filteredOptions.length ? filteredOptions.map((option) => (
              <button
                aria-selected={String(option.value) === String(value)}
                className={String(option.value) === String(value) ? 'selected' : ''}
                key={option.value}
                onClick={() => selectOption(option.value)}
                role="option"
                type="button"
              >
                <span>{option.label}</span>
                {String(option.value) === String(value) ? <b aria-hidden="true">✓</b> : null}
              </button>
            )) : <p>{emptyMessage}</p>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
