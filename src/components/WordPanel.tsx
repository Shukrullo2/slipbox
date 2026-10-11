import { useState } from 'react';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { textProps } from '../script';
import { formatDate, reviewStatus } from './NotePanel';
import type { WordDraft } from './WordForm';
import type { VaultIndex, WordRelation } from '../vault';
import type { Word } from '../types';
import { inkColor, posColor, type Theme } from '../palette';

interface Props {
  word: Word;
  index: VaultIndex;
  theme: Theme;
  onEdit: () => void;
  onTrash: () => void;
  onClose: () => void;
  onOpenWord: (id: string) => void;
  onOpenNote: (id: string) => void;
  onCreateWord: (prefill: Partial<WordDraft>) => void;
  onSetField: (slug: string) => void;
}

export function WordPanel({ word, index, theme, onEdit, onTrash, onClose, onOpenWord, onOpenNote, onCreateWord, onSetField }: Props) {
  const [copied, setCopied] = useState(false);
  const language = index.languages.byCode.get(word.language);
  const translations = Object.entries(word.translations);
  const relations = index.wordRelations.get(word.id) ?? { synonyms: [], antonyms: [], related: [] };
  const mentions = index.mentionsOf(word).slice(0, 6);
  const family = word.root ? index.wordEdges.filter((e) => e.kind === 'root' && (e.source === word.id || e.target === word.id)) : [];
  const familyWords = family.map((e) => index.wordById.get(e.source === word.id ? e.target : e.source)).filter(Boolean) as Word[];

  /** A relation chip: opens the entry if it exists, otherwise offers to add it, pre-linked back to this word. */
  const chip = (r: WordRelation, kind: 'synonyms' | 'antonyms' | 'related') =>
    r.word ? (
      <button key={r.text} type="button" className="chip" style={{ ['--chip' as string]: posColor(r.word.pos, theme) }} onClick={() => onOpenWord(r.word!.id)}>
        {r.word.word}
      </button>
    ) : (
      <button
        key={r.text}
        type="button"
        className="chip ghost"
        title="Not in the dictionary yet. Add it."
        onClick={() => onCreateWord({ word: r.text, pos: kind === 'related' ? 'noun' : word.pos, fields: word.fields, [kind]: [word.word] })}
      >
        <Icon name="plus" size={12} />
        {r.text}
      </button>
    );

  const group = (label: string, kind: 'synonyms' | 'antonyms' | 'related') =>
    relations[kind].length > 0 && (
      <section key={kind}>
        <h2>{label}</h2>
        <div className="chips">{relations[kind].map((r) => chip(r, kind))}</div>
      </section>
    );

  return (
    <aside className="panel card word-card" aria-label={`Dictionary entry: ${word.word}`}>
      <div className="card-toolbar">
        <div className="chips">
          {word.fields.map((f) => (
            <button key={f} type="button" className="chip plain" onClick={() => onSetField(f)} title={`Show only ${f}`}>
              {f}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <button type="button" className="icon-btn" onClick={onEdit} title="Edit (E)">
            <Icon name="edit" title="Edit" />
          </button>
          <button type="button" className="icon-btn" onClick={onTrash} title="Move to trash">
            <Icon name="trash" title="Move to trash" />
          </button>
          <button type="button" className="icon-btn" onClick={onClose} title="Close (Esc)">
            <Icon name="close" title="Close" />
          </button>
        </div>
      </div>

      <div className="card-scroll">
        <header className="card-head word-head">
          <h1 className="card-title" {...textProps(word.word, word.language)}>
            {word.word}
          </h1>
          <p className="word-meta-line">
            <span className="pos-tag" style={{ ['--chip' as string]: posColor(word.pos, theme) }}>
              {word.pos}
            </span>
            {language && language.code !== 'en' && <span className="lang-tag">{language.native}</span>}
            {word.pronunciation && <span className="muted">{word.pronunciation}</span>}
          </p>
        </header>

        <div className="card-body">
          <p className="word-definition" {...textProps(word.definition, word.language)}>
            {word.definition}
          </p>
          {word.example && (
            <blockquote className="word-example" {...textProps(word.example, word.language)}>
              {word.example}
            </blockquote>
          )}
          {translations.length > 0 && (
            <dl className="translations">
              {translations.map(([code, text]) => {
                const l = index.languages.byCode.get(code);
                return (
                  <div key={code} style={{ display: 'contents' }}>
                    <dt>{l?.name ?? (code === 'other' ? 'Translation' : code)}</dt>
                    <dd {...textProps(text, code)}>{text}</dd>
                  </div>
                );
              })}
            </dl>
          )}
          {word.error && (
            <p className="form-error" role="alert">
              {word.error}. Fix the frontmatter in {word.path}.
            </p>
          )}

          {(relations.synonyms.length > 0 || relations.antonyms.length > 0 || relations.related.length > 0 || familyWords.length > 0) && (
            <div className="connections word-relations">
              {group('Synonyms', 'synonyms')}
              {group('Antonyms', 'antonyms')}
              {group('See also', 'related')}
              {familyWords.length > 0 && (
                <section>
                  <h2>Same root</h2>
                  <div className="chips">
                    {familyWords.map((w) => (
                      <button key={w.id} type="button" className="chip" style={{ ['--chip' as string]: posColor(w.pos, theme) }} onClick={() => onOpenWord(w.id)}>
                        {w.word}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {word.root && (
            <p className="word-root">
              <span>Root</span> {word.root}
            </p>
          )}

          {word.body.trim() && (
            <section className="word-notes">
              <Markdown source={word.body} resolve={index.resolveLink} />
            </section>
          )}

          {mentions.length > 0 && (
            <section className="connections">
              <section>
                <h2>Used in your notes</h2>
                <ul>
                  {mentions.map((n) => {
                    const d = index.domainBySlug.get(n.domains[0]);
                    return (
                      <li key={n.id}>
                        <button type="button" className="note-link" onClick={() => onOpenNote(n.id)}>
                          <span className="dot" style={{ background: inkColor(d?.color, theme) }} />
                          <span>{n.title}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </section>
          )}

          <dl className="card-meta">
            <div>
              <dt>Added</dt>
              <dd>{formatDate(word.created)}</dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>{reviewStatus(word, index)}</dd>
            </div>
            {word.source && (
              <div>
                <dt>Met at</dt>
                <dd>{word.source}</dd>
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
                    navigator.clipboard?.writeText(`${index.root}/${word.path}`);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1400);
                  }}
                >
                  {copied ? 'Path copied' : word.path}
                </button>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </aside>
  );
}
