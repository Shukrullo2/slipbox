import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { plain } from './Markdown';
import { textProps } from '../script';
import type { VaultIndex } from '../vault';
import { inkColor, posColor, type Theme } from '../palette';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  run: () => void;
}

type Row =
  | { kind: 'note'; id: string; title: string; detail?: string; color: string }
  | { kind: 'domain'; slug: string; title: string; detail: string; color: string }
  | { kind: 'word'; id: string; title: string; detail: string; color: string }
  | { kind: 'command'; cmd: Command }
  | { kind: 'create'; title: string };

interface Props {
  index: VaultIndex;
  theme: Theme;
  commands: Command[];
  onClose: () => void;
  onOpenNote: (id: string) => void;
  onOpenDomain: (slug: string) => void;
  onOpenWord: (id: string) => void;
  onCreate: (title: string) => void;
}

function snippet(body: string, terms: string[]): string | undefined {
  const text = body.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`[\]]/g, '').replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at === undefined) return undefined;
  const start = Math.max(0, at - 40);
  return (start > 0 ? '…' : '') + text.slice(start, at + 90).trim() + '…';
}

export function CommandPalette({ index, theme, commands, onClose, onOpenNote, onOpenDomain, onOpenWord, onCreate }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const rows: Row[] = useMemo(() => {
    const q = query.trim();
    const noteRow = (id: string, terms: string[] = []): Row | null => {
      const n = index.noteById.get(id);
      if (!n) return null;
      const d = index.domainBySlug.get(n.domains[0]);
      return { kind: 'note', id, title: n.title, detail: n.summary ? plain(n.summary) : snippet(n.body, terms), color: inkColor(d?.color, theme) };
    };

    if (!q) {
      const recent = [...index.notes].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 6);
      return [...commands.map((cmd) => ({ kind: 'command', cmd }) as Row), ...recent.map((n) => noteRow(n.id)!).filter(Boolean)];
    }

    const lower = q.toLowerCase();
    const cmdRows = commands.filter((c) => c.label.toLowerCase().includes(lower)).map((cmd) => ({ kind: 'command', cmd }) as Row);
    const domainRows = index.domains
      .filter((d) => d.name.toLowerCase().includes(lower) || d.slug.includes(lower))
      .map(
        (d): Row => ({
          kind: 'domain',
          slug: d.slug,
          title: d.name,
          detail: `${index.notesByDomain.get(d.slug)?.length ?? 0} notes`,
          color: inkColor(d.color, theme),
        }),
      );
    const hits = index.search.search(q).slice(0, 30);
    const noteRows = hits.map((h) => noteRow(h.id as string, h.terms)).filter(Boolean) as Row[];
    const wordRows = index.wordSearch
      .search(q)
      .slice(0, 8)
      .map((h) => index.wordById.get(h.id as string))
      .filter(Boolean)
      .map((w): Row => ({ kind: 'word', id: w!.id, title: w!.word, detail: `${w!.pos}: ${w!.definition}`, color: posColor(w!.pos, theme) }));
    const exact = index.notes.some((n) => n.title.toLowerCase() === lower);
    return [...noteRows, ...wordRows, ...domainRows, ...cmdRows, ...(exact ? [] : [{ kind: 'create', title: q } as Row])];
  }, [query, index, commands, theme]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (row: Row | undefined) => {
    if (!row) return;
    onClose();
    if (row.kind === 'note') onOpenNote(row.id);
    else if (row.kind === 'domain') onOpenDomain(row.slug);
    else if (row.kind === 'word') onOpenWord(row.id);
    else if (row.kind === 'command') row.cmd.run();
    else onCreate(row.title);
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            placeholder="Search notes, domains, or commands"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, rows.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(rows[active]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
        </div>
        <ul className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {rows.map((row, i) => {
            const key = row.kind === 'note' ? `n${row.id}` : row.kind === 'word' ? `w${row.id}` : row.kind === 'domain' ? `d${row.slug}` : row.kind === 'command' ? `c${row.cmd.id}` : 'create';
            return (
              <li
                key={key}
                role="option"
                aria-selected={i === active}
                className={`palette-row ${i === active ? 'active' : ''}`}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(row)}
              >
                {row.kind === 'note' && (
                  <>
                    <span className="dot" style={{ background: row.color }} />
                    <span className="palette-text">
                      <span className="palette-title">{row.title}</span>
                      {row.detail && <span className="palette-detail">{row.detail}</span>}
                    </span>
                  </>
                )}
                {row.kind === 'word' && (
                  <>
                    <Icon name="book" size={16} />
                    <span className="palette-text">
                      <span className="palette-title">
                        <span className="dot" style={{ background: row.color, display: 'inline-block', marginRight: 6 }} />
                        <span {...textProps(row.title)}>{row.title}</span>
                      </span>
                      <span className="palette-detail">{row.detail}</span>
                    </span>
                  </>
                )}
                {row.kind === 'domain' && (
                  <>
                    <span className="seal small" style={{ background: row.color }} />
                    <span className="palette-text">
                      <span className="palette-title">{row.title}</span>
                      <span className="palette-detail">Domain with {row.detail}</span>
                    </span>
                  </>
                )}
                {row.kind === 'command' && (
                  <>
                    <Icon name={row.cmd.icon} size={16} />
                    <span className="palette-text">
                      <span className="palette-title">{row.cmd.label}</span>
                    </span>
                    {row.cmd.hint && <kbd>{row.cmd.hint}</kbd>}
                  </>
                )}
                {row.kind === 'create' && (
                  <>
                    <Icon name="plus" size={16} />
                    <span className="palette-text">
                      <span className="palette-title">Create note “{row.title}”</span>
                    </span>
                  </>
                )}
              </li>
            );
          })}
          {rows.length === 0 && <li className="palette-empty">Type to search your notes.</li>}
        </ul>
      </div>
    </div>
  );
}
