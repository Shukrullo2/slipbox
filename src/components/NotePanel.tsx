import { useEffect, useMemo, useState } from 'react';
import { Inline, Markdown } from './Markdown';
import { Icon } from './Icon';
import { textProps } from '../script';
import { NoteForm, draftToInput, type Draft } from './NoteForm';
import type { VaultIndex } from '../vault';
import type { Note, NoteInput, Reviewable } from '../types';
import { inkColor, posColor, type Theme } from '../palette';
import { daysBetween, formatInterval } from '../../shared/srs.js';

interface Props {
  note: Note;
  index: VaultIndex;
  theme: Theme;
  editing: boolean;
  expanded: boolean;
  onEdit: (on: boolean) => void;
  onToggleExpand: () => void;
  onSave: (input: NoteInput) => Promise<void>;
  onTrash: () => void;
  onClose: () => void;
  onOpenNote: (id: string) => void;
  onOpenDomain: (slug: string) => void;
  onCreateFromLink: (title: string) => void;
}

const noteToDraft = (n: Note): Draft => ({
  title: n.title,
  domains: n.domains,
  tags: n.tags,
  summary: n.summary ?? '',
  question: n.question ?? '',
  source: n.source ?? '',
  body: n.body,
});

export const formatDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function reviewStatus(note: Reviewable, index: VaultIndex): string {
  if (note.review === false) return 'Not in review';
  if (!note.review.due) return note.created < index.today ? 'New, ready for its first review' : 'New, first review tomorrow';
  const days = daysBetween(index.today, note.review.due);
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? '' : 's'}`;
  if (days === 0) return 'Due today';
  return `Next ${formatInterval(days)}`;
}

const STOPWORDS = new Set(
  'a an and are as at be by can do does for from how in into is it its not of on or so than that the their then there these this to use using vs was what when where which while who why will with without you your instead'.split(' '),
);

/** Notes that share tags, a domain, or distinctive words, and aren't linked yet. */
function relatedNotes(note: Note, index: VaultIndex, linked: Note[]): Note[] {
  const skip = new Set([note.id, ...linked.map((n) => n.id)]);
  const words = note.title
    .toLowerCase()
    .split(/[^a-z0-9_.+#-]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const text = new Map<string, number>();
  const query = [...words, ...note.tags].join(' ');
  if (query) {
    const hits = index.search.search(query, { combineWith: 'OR', fields: ['title', 'tags', 'summary', 'question'], fuzzy: false, prefix: false });
    const top = hits[0]?.score || 1;
    for (const h of hits) text.set(h.id as string, h.score / top);
  }
  return index.notes
    .filter((n) => !skip.has(n.id))
    .map((n) => {
      const sharedTags = n.tags.filter((t) => note.tags.includes(t)).length;
      const sameDomain = n.domains.some((d) => note.domains.includes(d)) ? 1 : 0;
      return { n, score: sharedTags * 3 + sameDomain + (text.get(n.id) ?? 0) * 2 };
    })
    .filter((r) => r.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((r) => r.n);
}

export function NotePanel(props: Props) {
  const { note, index, theme, editing, expanded, onEdit, onToggleExpand, onSave, onTrash, onClose, onOpenNote, onOpenDomain, onCreateFromLink } = props;
  const [draft, setDraft] = useState<Draft>(() => noteToDraft(note));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(noteToDraft(note));
  }, [note, editing]);

  const backlinks = (index.backLinks.get(note.id) ?? []).map((id) => index.noteById.get(id)).filter(Boolean) as Note[];
  const outlinks = (index.outLinks.get(note.id) ?? []).map((id) => index.noteById.get(id)).filter(Boolean) as Note[];
  const missing = index.unresolved.get(note.id) ?? [];
  const linkedWords = index.wordsLinkedFrom.get(note.id) ?? [];

  const related = useMemo(() => relatedNotes(note, index, [...backlinks, ...outlinks]), [note, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!draft.title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(draftToInput(draft));
      onEdit(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    const dirty = JSON.stringify(draft) !== JSON.stringify(noteToDraft(note));
    if (dirty && !confirm('Discard your changes to this note?')) return;
    setDraft(noteToDraft(note));
    setError(null);
    onEdit(false);
  };

  const noteLink = (n: Note) => {
    const d = index.domainBySlug.get(n.domains[0]);
    return (
      <li key={n.id}>
        <button type="button" className="note-link" onClick={() => onOpenNote(n.id)}>
          <span className="dot" style={{ background: inkColor(d?.color, theme) }} />
          <span>{n.title}</span>
        </button>
      </li>
    );
  };

  return (
    <aside className={`panel card ${expanded ? 'expanded' : ''}`} aria-label={`Note: ${note.title}`}>
      <div className="card-toolbar">
        <div className="chips">
          {note.domains.map((s) => {
            const d = index.domainBySlug.get(s);
            return (
              <button key={s} type="button" className="chip" style={{ ['--chip' as string]: inkColor(d?.color, theme) }} onClick={() => onOpenDomain(s)}>
                {d?.name ?? s}
              </button>
            );
          })}
        </div>
        <div className="toolbar-actions">
          <button type="button" className="icon-btn" onClick={onToggleExpand} title={expanded ? 'Narrow' : 'Widen'}>
            <Icon name={expanded ? 'collapse' : 'expand'} title={expanded ? 'Narrow' : 'Widen'} />
          </button>
          {!editing && (
            <button type="button" className="icon-btn" onClick={() => onEdit(true)} title="Edit (E)">
              <Icon name="edit" title="Edit" />
            </button>
          )}
          <button type="button" className="icon-btn" onClick={onTrash} title="Move to trash">
            <Icon name="trash" title="Move to trash" />
          </button>
          <button type="button" className="icon-btn" onClick={onClose} title="Close (Esc)">
            <Icon name="close" title="Close" />
          </button>
        </div>
      </div>

      {editing ? (
        <div className="card-scroll">
          <NoteForm
            draft={draft}
            onChange={setDraft}
            onSubmit={save}
            onCancel={cancel}
            index={index}
            theme={theme}
            submitLabel="Save note"
            busy={busy}
            error={error}
            autoFocus="body"
          />
        </div>
      ) : (
        <div className="card-scroll">
          <header className="card-head">
            <h1 className="card-title">{note.title}</h1>
          </header>
          <div className="card-body">
            {note.summary && <Inline as="p" className="card-summary" text={note.summary} />}
            {note.error && (
              <p className="form-error" role="alert">
                {note.error}. Fix the frontmatter in {note.path}.
              </p>
            )}
            <Markdown source={note.body} resolve={index.resolveLink} onCreateLink={onCreateFromLink} />

            {note.question && (
              <section className="recall">
                <h2>Recall question</h2>
                <Inline as="p" text={note.question} />
              </section>
            )}

            {(backlinks.length > 0 || outlinks.length > 0 || missing.length > 0 || related.length > 0 || linkedWords.length > 0) && (
              <div className="connections">
                {backlinks.length > 0 && (
                  <section>
                    <h2>Linked from</h2>
                    <ul>{backlinks.map(noteLink)}</ul>
                  </section>
                )}
                {outlinks.length > 0 && (
                  <section>
                    <h2>Links to</h2>
                    <ul>{outlinks.map(noteLink)}</ul>
                  </section>
                )}
                {linkedWords.length > 0 && (
                  <section>
                    <h2>Dictionary</h2>
                    <div className="chips">
                      {linkedWords.map((w) => (
                        <a key={w.id} className="chip" href={`#/dictionary?word=${encodeURIComponent(w.id)}`} title={w.definition} style={{ ['--chip' as string]: posColor(w.pos, theme) }}>
                          <span {...textProps(w.word, w.language)}>{w.word}</span>
                        </a>
                      ))}
                    </div>
                  </section>
                )}
                {missing.length > 0 && (
                  <section>
                    <h2>Not written yet</h2>
                    <ul>
                      {missing.map((m) => (
                        <li key={m}>
                          <button type="button" className="note-link missing" onClick={() => onCreateFromLink(m)}>
                            <Icon name="plus" size={14} />
                            <span>{m}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {related.length > 0 && (
                  <section>
                    <h2>Might be related</h2>
                    <ul>{related.map(noteLink)}</ul>
                  </section>
                )}
              </div>
            )}

            <dl className="card-meta">
              <div>
                <dt>Captured</dt>
                <dd>{formatDate(note.created)}</dd>
              </div>
              <div>
                <dt>Review</dt>
                <dd>{reviewStatus(note, index)}</dd>
              </div>
              {note.source && (
                <div>
                  <dt>Source</dt>
                  <dd>{note.source}</dd>
                </div>
              )}
              {note.tags.length > 0 && (
                <div>
                  <dt>Tags</dt>
                  <dd className="tags">
                    {note.tags.map((t) => (
                      <span key={t} className="tag">
                        #{t}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
              <div>
                <dt>File</dt>
                <dd>
                  <button
                    type="button"
                    className="path-button"
                    title="Copy full path"
                    onClick={() => {
                      navigator.clipboard?.writeText(`${index.root}/${note.path}`);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1400);
                    }}
                  >
                    {copied ? 'Path copied' : note.path}
                  </button>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </aside>
  );
}
