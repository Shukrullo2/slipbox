import { useEffect, useMemo, useState } from 'react';
import { Inline, Markdown } from './Markdown';
import { textProps } from '../script';
import { NEW_PER_SESSION, wordSide, type VaultIndex } from '../vault';
import type { Grade, Note, Reviewable, Word } from '../types';
import { inkColor, posColor, type Theme } from '../palette';
import { GRADES, daysBetween, formatInterval, schedule } from '../../shared/srs.js';

interface Props {
  index: VaultIndex;
  theme: Theme;
  onGrade: (id: string, grade: Grade) => Promise<void>;
  onOpenNote: (id: string) => void;
  onOpenWord: (id: string) => void;
  onCreateFromLink: (title: string) => void;
  onDone: () => void;
}

const GRADE_LABEL: Record<Grade, string> = { again: 'Forgot', hard: 'Hard', good: 'Good', easy: 'Easy' };

function nextUp(index: VaultIndex): { days: number; count: number } | null {
  const upcoming = [...index.reviewable.values()]
    .map((n) => (n.review ? n.review.due : undefined))
    .filter((d): d is string => !!d && d > index.today)
    .sort();
  if (!upcoming.length) {
    const fresh = [...index.reviewable.values()].filter((n) => n.review !== false && !n.review.due).length;
    return fresh ? { days: 1, count: fresh } : null;
  }
  const first = upcoming[0];
  return { days: daysBetween(index.today, first), count: upcoming.filter((d) => d === first).length };
}

export function ReviewView({ index, theme, onGrade, onOpenNote, onOpenWord, onCreateFromLink, onDone }: Props) {
  // The queue is fixed when the session starts, so grading doesn't reshuffle it.
  const [queue, setQueue] = useState<string[]>(() => [...index.due, ...index.fresh.slice(0, NEW_PER_SESSION)].map((n) => n.id));
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [tally, setTally] = useState<Record<Grade, number>>({ again: 0, hard: 0, good: 0, easy: 0 });
  const [forgotten, setForgotten] = useState<Set<string>>(new Set());

  const current: Reviewable | undefined = index.reviewable.get(queue[pos]);
  const done = pos >= queue.length;

  const previews = useMemo(() => {
    if (!current) return null;
    const state = current.review || {};
    return Object.fromEntries(GRADES.map((g) => [g, formatInterval(schedule(state, g).interval)])) as Record<Grade, string>;
  }, [current]);

  const grade = (g: Grade) => {
    if (!current || !revealed) return;
    // A forgotten card comes back once at the end of the session for practice;
    // it is already scheduled for tomorrow, so that second pass isn't graded.
    const practice = forgotten.has(current.id);
    if (!practice) {
      onGrade(current.id, g);
      setTally((t) => ({ ...t, [g]: t[g] + 1 }));
    }
    if (g === 'again' && !practice) {
      setForgotten(new Set(forgotten).add(current.id));
      setQueue((q) => [...q, current.id]);
    }
    setRevealed(false);
    setPos((p) => p + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, .cm-editor')) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter') && current) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        grade(GRADES[Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Skip ids whose item was deleted mid-session.
  useEffect(() => {
    if (!done && !current) setPos((p) => p + 1);
  }, [done, current]);

  if (queue.length === 0 || done) {
    const reviewed = Object.values(tally).reduce((a, b) => a + b, 0);
    const next = nextUp(index);
    return (
      <div className="review-stage">
        <div className="review-done">
          <h1 className="done-title">{reviewed ? 'Review finished' : 'Nothing to review today'}</h1>
          {reviewed > 0 ? (
            <p>
              You went through {reviewed} card{reviewed === 1 ? '' : 's'}. {tally.again > 0 ? `${tally.again} slipped and will come back tomorrow.` : 'Nothing slipped.'}
            </p>
          ) : (
            <p>New notes and words join the queue the day after you capture them, while the idea is still fresh enough to test.</p>
          )}
          {next && (
            <p className="muted">
              Next up: {next.count} card{next.count === 1 ? '' : 's'} {formatInterval(next.days)}.
            </p>
          )}
          <button type="button" className="btn btn-primary" onClick={onDone}>
            Back to the graph
          </button>
        </div>
      </div>
    );
  }

  if (!current) return null;

  const firstReview = !current.review || !current.review.due;

  return (
    <div className="review-stage">
      <p className="review-progress" aria-live="polite">
        {pos + 1} of {queue.length}
      </p>
      <article className={`card review-card ${current.kind === 'word' ? 'review-word' : ''}`}>
        <div className="card-toolbar">
          <div className="chips">
            {current.kind === 'word' ? (
              <>
                <span className="chip static" style={{ ['--chip' as string]: posColor(current.pos, theme) }}>
                  {current.pos}
                </span>
                {current.fields.map((f) => (
                  <span key={f} className="chip static plain">
                    {f}
                  </span>
                ))}
              </>
            ) : (
              current.domains.map((s) => {
                const d = index.domainBySlug.get(s);
                return (
                  <span key={s} className="chip static" style={{ ['--chip' as string]: inkColor(d?.color, theme) }}>
                    {d?.name ?? s}
                  </span>
                );
              })
            )}
          </div>
          {firstReview && <span className="new-mark">First review</span>}
        </div>
        <div className="card-scroll">
          {current.kind === 'word' ? (
            <WordCard word={current} index={index} revealed={revealed} onReveal={() => setRevealed(true)} onOpen={() => onOpenWord(current.id)} />
          ) : (
            <NoteCard note={current} index={index} revealed={revealed} onReveal={() => setRevealed(true)} onOpen={() => onOpenNote(current.id)} onCreateFromLink={onCreateFromLink} />
          )}
        </div>
      </article>
      {revealed && previews && (
        <div className="grades" role="group" aria-label="How well did you remember?">
          {GRADES.map((g, i) => (
            <button key={g} type="button" className={`grade grade-${g}`} onClick={() => grade(g)}>
              <span className="grade-label">
                <kbd>{i + 1}</kbd> {GRADE_LABEL[g]}
              </span>
              <span className="grade-when">{previews[g]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NoteCard({ note, index, revealed, onReveal, onOpen, onCreateFromLink }: { note: Note; index: VaultIndex; revealed: boolean; onReveal: () => void; onOpen: () => void; onCreateFromLink: (t: string) => void }) {
  return (
    <>
      <header className="card-head">
        <Inline as="h1" className="card-title" text={note.question ?? note.title} />
      </header>
      <div className="card-body">
        {!note.question && !revealed && <p className="muted">Recall the key idea and an example before you reveal the note.</p>}
        {revealed ? (
          <div className="answer">
            {note.question && <h2 className="answer-title">{note.title}</h2>}
            {note.summary && <Inline as="p" className="card-summary" text={note.summary} />}
            <Markdown source={note.body} resolve={index.resolveLink} onCreateLink={onCreateFromLink} />
            <button type="button" className="link-button" onClick={onOpen}>
              Open this note
            </button>
          </div>
        ) : (
          <button type="button" className="btn reveal" onClick={onReveal}>
            Show the answer <kbd>Space</kbd>
          </button>
        )}
      </div>
    </>
  );
}

/**
 * A word is tested from both sides. The side alternates with every review:
 * first the word, asking for its meaning; next time the meaning, asking for the word.
 */
function WordCard({ word, index, revealed, onReveal, onOpen }: { word: Word; index: VaultIndex; revealed: boolean; onReveal: () => void; onOpen: () => void }) {
  const side = wordSide(word);
  return (
    <>
      <header className="card-head">
        <p className="review-prompt">{side === 'meaning' ? 'What does this mean?' : 'Which word is this?'}</p>
        <h1 className={`card-title ${side === 'word' ? 'as-definition' : ''}`} {...textProps(side === 'meaning' ? word.word : word.definition, word.language)}>
          {side === 'meaning' ? word.word : word.definition}
        </h1>
      </header>
      <div className="card-body">
        {revealed ? (
          <div className="answer">
            {side === 'meaning' ? (
              <p className="word-definition" {...textProps(word.definition, word.language)}>
                {word.definition}
              </p>
            ) : (
              <h2 className="answer-title word-answer" {...textProps(word.word, word.language)}>
                {word.word}
              </h2>
            )}
            {word.example && (
              <blockquote className="word-example" {...textProps(word.example, word.language)}>
                {word.example}
              </blockquote>
            )}
            {Object.keys(word.translations).length > 0 && (
              <dl className="translations review-translations">
                {Object.entries(word.translations).map(([code, text]) => (
                  <div key={code} style={{ display: 'contents' }}>
                    <dt>{index.languages.byCode.get(code)?.name ?? code}</dt>
                    <dd {...textProps(text, code)}>{text}</dd>
                  </div>
                ))}
              </dl>
            )}
            {word.synonyms.length > 0 && (
              <p className="muted small">
                Synonyms: {word.synonyms.join(', ')}
                {word.antonyms.length > 0 && ` · Antonyms: ${word.antonyms.join(', ')}`}
              </p>
            )}
            {word.antonyms.length > 0 && word.synonyms.length === 0 && <p className="muted small">Antonyms: {word.antonyms.join(', ')}</p>}
            {word.root && <p className="muted small">Root: {word.root}</p>}
            <button type="button" className="link-button" onClick={onOpen}>
              Open this entry
            </button>
          </div>
        ) : (
          <button type="button" className="btn reveal" onClick={onReveal}>
            {side === 'meaning' ? 'Show the meaning' : 'Show the word'} <kbd>Space</kbd>
          </button>
        )}
      </div>
    </>
  );
}
