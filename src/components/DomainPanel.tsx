import { useEffect, useState } from 'react';
import { Markdown, plain } from './Markdown';
import { Icon } from './Icon';
import type { VaultIndex } from '../vault';
import type { Domain, DomainInput, Note } from '../types';
import { INKS, inkColor, type Theme } from '../palette';
import { formatDate } from './NotePanel';

interface Props {
  domain: Domain;
  index: VaultIndex;
  theme: Theme;
  onClose: () => void;
  onOpenNote: (id: string) => void;
  onOpenDomain: (slug: string) => void;
  onNewNote: (slug: string) => void;
  onSave: (input: DomainInput) => Promise<void>;
}

/** Every slug below `slug` in the domain tree. */
function descendants(index: VaultIndex, slug: string): Set<string> {
  const out = new Set<string>();
  const stack = [slug];
  while (stack.length) {
    for (const c of index.childDomains.get(stack.pop()!) ?? []) {
      if (out.has(c.slug) || c.slug === slug) continue;
      out.add(c.slug);
      stack.push(c.slug);
    }
  }
  return out;
}

export function DomainPanel({ domain, index, theme, onClose, onOpenNote, onOpenDomain, onNewNote, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<DomainInput>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setError(null);
  }, [domain.slug]);

  const notes = index.notesByDomain.get(domain.slug) ?? [];
  const due = notes.filter(index.isDue).length;
  const children = index.childDomains.get(domain.slug) ?? [];
  const parent = domain.parent ? index.domainBySlug.get(domain.parent) : undefined;
  const ink = inkColor(domain.color, theme);
  const below = descendants(index, domain.slug);

  const startEdit = () => {
    setForm({ name: domain.name, color: domain.color ?? 'slate', parent: domain.parent ?? '', description: domain.description });
    setEditing(true);
  };

  const save = async () => {
    try {
      await onSave(form);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const summaryLine = () => {
    if (!notes.length) return 'No notes yet.';
    const parts = [`${notes.length} note${notes.length === 1 ? '' : 's'}`];
    if (due) parts.push(`${due} due for review`);
    return `${parts.join(', ')}. Last captured ${formatDate(notes[0].created)}.`;
  };

  return (
    <aside className="panel card domain-card" aria-label={`Domain: ${domain.name}`}>
      <div className="card-toolbar">
        <div className="chips">
          {parent && (
            <button type="button" className="chip" style={{ ['--chip' as string]: inkColor(parent.color, theme) }} onClick={() => onOpenDomain(parent.slug)}>
              Part of {parent.name}
            </button>
          )}
        </div>
        <div className="toolbar-actions">
          {!editing && (
            <button type="button" className="icon-btn" onClick={startEdit} title="Edit domain">
              <Icon name="edit" title="Edit domain" />
            </button>
          )}
          <button type="button" className="icon-btn" onClick={onClose} title="Close (Esc)">
            <Icon name="close" title="Close" />
          </button>
        </div>
      </div>

      <div className="card-scroll">
        <header className="card-head domain-head">
          <span className="seal" style={{ background: ink }} aria-hidden />
          <h1 className="card-title">{domain.name}</h1>
        </header>

        {editing ? (
          <div className="card-body domain-form">
            <label className="field">
              <span className="field-label">Name</span>
              <input className="input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <fieldset className="field">
              <legend className="field-label">Ink</legend>
              <div className="swatches">
                {Object.entries(INKS).map(([key, v]) => (
                  <label key={key} className="swatch" title={v.label}>
                    <input type="radio" name="ink" value={key} checked={form.color === key} onChange={() => setForm({ ...form, color: key })} />
                    <span style={{ background: v[theme] }} />
                    <span className="sr-only">{v.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span className="field-label">Part of</span>
              <select className="input" value={form.parent ?? ''} onChange={(e) => setForm({ ...form, parent: e.target.value })}>
                <option value="">Nothing, it's a top-level domain</option>
                {index.domains
                  .filter((d) => d.slug !== domain.slug && !below.has(d.slug))
                  .map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">What this domain covers</span>
              <textarea className="input" rows={4} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={save}>
                Save domain
              </button>
            </div>
          </div>
        ) : (
          <div className="card-body">
            {domain.description && <Markdown source={domain.description} resolve={index.resolve} />}
            <p className="muted">{summaryLine()}</p>

            {children.length > 0 && (
              <section className="subdomains">
                <h2>Inside {domain.name}</h2>
                <div className="chips">
                  {children.map((c) => (
                    <button key={c.slug} type="button" className="chip" style={{ ['--chip' as string]: inkColor(c.color, theme) }} onClick={() => onOpenDomain(c.slug)}>
                      {c.name}
                      <span className="chip-count">{index.notesByDomain.get(c.slug)?.length ?? 0}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <button type="button" className="btn btn-primary block" onClick={() => onNewNote(domain.slug)}>
              <Icon name="plus" size={16} /> New note in {domain.name}
            </button>

            {notes.length > 0 && (
              <ul className="note-list">
                {notes.map((n: Note) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => onOpenNote(n.id)}>
                      <span className="note-list-title">
                        {index.isDue(n) && <span className="due-mark" title="Due for review" />}
                        {n.title}
                      </span>
                      {n.summary && <span className="note-list-summary">{plain(n.summary)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
