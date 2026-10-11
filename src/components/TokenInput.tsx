import { useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface TokenOption {
  value: string;
  label: string;
  color?: string;
  /** Muted text after the label, e.g. the parent domain. */
  hint?: string;
  /** Shown right-aligned, e.g. how many notes use it. */
  count?: number;
}

type Row = { kind: 'option'; option: TokenOption } | { kind: 'create'; name: string };

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  options: TokenOption[];
  placeholder?: string;
  /** Turn free text into a stored value, e.g. a slug. */
  normalize?: (text: string) => string;
  renderToken?: (value: string) => ReactNode;
  label: string;
  id?: string;
  /** What a new entry is called, e.g. "domain". */
  noun: string;
}

/**
 * Multi-select dropdown: click to see every option (chosen ones are ticked),
 * type to filter, and add a new entry from the last row.
 */
export function TokenInput({ value, onChange, options, placeholder, normalize = (t) => t.trim(), renderToken, label, id, noun }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [naming, setNaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const q = text.trim().toLowerCase();
  const exact = useMemo(() => options.find((o) => o.label.toLowerCase() === q || (q && o.value === normalize(text))), [options, q, text, normalize]);

  const rows: Row[] = useMemo(() => {
    const matches: Row[] = options
      .filter((o) => !q || o.label.toLowerCase().includes(q) || o.value.includes(q))
      .sort((a, b) => (q ? Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)) : 0))
      .map((option) => ({ kind: 'option', option }));
    if (exact) return matches;
    const create: Row = { kind: 'create', name: text.trim() };
    // While naming a new entry, offer it first; otherwise it sits at the end.
    return naming && q ? [create, ...matches] : [...matches, create];
  }, [options, q, text, exact, naming]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (open) listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const toggle = (v: string) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    setText('');
    setNaming(false);
  };

  const create = (name: string) => {
    if (!name) {
      // "Add new…" with nothing typed yet: ask for a name.
      setNaming(true);
      inputRef.current?.focus();
      return;
    }
    const v = normalize(name);
    if (v && !value.includes(v)) onChange([...value, v]);
    setText('');
    setNaming(false);
  };

  const choose = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === 'option') toggle(row.option.value);
    else create(row.name);
  };

  return (
    <div
      className={`tokens ${open ? 'open' : ''}`}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.token-x, .token-menu, .tokens-toggle')) return;
        if (target !== inputRef.current) {
          e.preventDefault();
          inputRef.current?.focus();
        }
        setOpen(true);
      }}
    >
      {value.map((v) => (
        <span className="token" key={v}>
          {renderToken ? renderToken(v) : v}
          <button type="button" className="token-x" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
        value={text}
        placeholder={naming ? `Name the new ${noun}` : value.length ? '' : placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setNaming(false);
          // Keep what was typed, but only commit it if it names an existing entry.
          if (exact && !value.includes(exact.value)) {
            onChange([...value, exact.value]);
            setText('');
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) return setOpen(true);
            setActive((i) => (e.key === 'ArrowDown' ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0)));
          } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && (open || q)) {
            e.preventDefault();
            choose(open ? rows[active] : exact ? { kind: 'option', option: exact } : { kind: 'create', name: text.trim() });
          } else if (e.key === ',' && q) {
            e.preventDefault();
            if (exact) toggle(exact.value);
            else create(text.trim());
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1));
          } else if (e.key === 'Escape' && (open || naming)) {
            // Close the menu without cancelling the whole form.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setNaming(false);
          } else if (e.key === 'Tab') {
            setOpen(false);
          }
        }}
      />
      <button
        type="button"
        className="tokens-toggle"
        tabIndex={-1}
        aria-label={open ? `Close ${label} list` : `Show all ${label.toLowerCase()}`}
        onMouseDown={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
          setOpen((o) => !o);
        }}
      >
        <Icon name="chevron" size={16} />
      </button>

      {open && (
        <ul className="token-menu" id={listId} role="listbox" aria-multiselectable aria-label={label} ref={listRef}>
          {options.length === 0 && !q && <li className="token-empty">No {noun}s yet.</li>}
          {rows.map((row, i) => {
            const common = {
              id: `${listId}-${i}`,
              className: i === active ? 'active' : '',
              onMouseEnter: () => setActive(i),
              onMouseDown: (e: MouseEvent) => {
                e.preventDefault();
                choose(row);
              },
            };
            if (row.kind === 'create') {
              return (
                <li key="create" role="option" aria-selected={false} {...common} className={`${common.className} token-create`}>
                  <Icon name="plus" size={15} />
                  {row.name ? (
                    <span>
                      Add {noun} <strong>{row.name}</strong>
                    </span>
                  ) : (
                    <span>Add a new {noun}…</span>
                  )}
                </li>
              );
            }
            const o = row.option;
            const chosen = value.includes(o.value);
            return (
              <li key={o.value} role="option" aria-selected={chosen} {...common}>
                <span className="token-check" aria-hidden>
                  {chosen && <Icon name="check" size={15} />}
                </span>
                {o.color && <span className="dot" style={{ background: o.color }} />}
                <span className="token-option-label">
                  {o.label}
                  {o.hint && <span className="token-hint">{o.hint}</span>}
                </span>
                {o.count !== undefined && <span className="token-count">{o.count}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
