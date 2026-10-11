import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { WordWheel } from './WordWheel';
import { textProps } from '../script';
import type { VaultIndex } from '../vault';
import { PARTS_OF_SPEECH, type PartOfSpeech, type Word } from '../types';
import { posColor, type Theme } from '../palette';

interface Props {
  index: VaultIndex;
  theme: Theme;
  selectedWord?: string;
  field?: string;
  onOpenWord: (id: string) => void;
  onSetField: (slug: string | undefined) => void;
  onNewWord: () => void;
  onBackground: () => void;
}

const initial = (w: Word) => (w.word[0] ?? '#').toLocaleUpperCase();
const wide = () => window.matchMedia('(min-width: 900px)').matches;

/** A yes/no preference remembered per device; the default depends on screen size. */
function usePref(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === '1';
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, value ? '1' : '0');
    } catch {}
  }, [key, value]);
  return [value, setValue] as const;
}

/**
 * The dictionary: the word wheel fills the view; filters and the list are
 * panels you open when you need them. The letters inside the ring are the index.
 */
export function DictionaryView({ index, theme, selectedWord, field, onOpenWord, onSetField, onNewWord, onBackground }: Props) {
  const [query, setQuery] = useState('');
  const [posFilter, setPosFilter] = useState<Set<PartOfSpeech>>(new Set());
  const [letter, setLetter] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = usePref('slipbox:dict-filters', wide());
  const [listOpen, setListOpen] = usePref('slipbox:dict-list', wide());

  const inField = useMemo(() => (field ? index.words.filter((w) => w.fields.includes(field)) : index.words), [index, field]);
  const inLanguage = useMemo(() => (language ? inField.filter((w) => w.language === language) : inField), [inField, language]);
  const posCounts = useMemo(() => {
    const m = new Map<PartOfSpeech, number>();
    for (const w of inLanguage) m.set(w.pos, (m.get(w.pos) ?? 0) + 1);
    return m;
  }, [inLanguage]);
  // Initials actually present, in the wheel's order, so any script gets an index.
  const initials = useMemo(() => [...new Set(inLanguage.map(initial))], [inLanguage]);

  const shown = useMemo(() => {
    let list = inLanguage;
    if (posFilter.size) list = list.filter((w) => posFilter.has(w.pos));
    if (letter) list = list.filter((w) => initial(w) === letter);
    if (query.trim()) {
      const ids = new Set(index.wordSearch.search(query).map((r) => r.id as string));
      list = list.filter((w) => ids.has(w.id));
    }
    return list;
  }, [inLanguage, posFilter, letter, query, index]);
  const shownIds = useMemo(() => new Set(shown.map((w) => w.id)), [shown]);
  const edges = useMemo(() => index.wordEdges.filter((e) => shownIds.has(e.source) && shownIds.has(e.target)), [index, shownIds]);

  const togglePos = (p: PartOfSpeech) =>
    setPosFilter((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const activeFilters = posFilter.size + (letter ? 1 : 0) + (language ? 1 : 0) + (field ? 1 : 0);
  const clearFilters = () => {
    setPosFilter(new Set());
    setLetter(null);
    setLanguage(null);
    setQuery('');
    if (field) onSetField(undefined);
  };

  if (index.words.length === 0) {
    return (
      <div className="dictionary">
        <div className="dict-empty">
          <p className="graph-empty-title">Your dictionary is empty</p>
          <p>
            Press <kbd>W</kbd> to add a word or term, or ask Claude to “add idempotent to my Slipbox dictionary”. Words connect through synonyms, antonyms and shared roots, and come back in review from both sides: word to meaning, and meaning to word.
          </p>
          <button type="button" className="btn btn-primary" onClick={onNewWord}>
            <Icon name="plus" size={16} /> New word
          </button>
        </div>
      </div>
    );
  }

  const fields = [...index.fieldCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return (
    <div className="dictionary">
      <div className="dict-bar">
        <label className="dict-search">
          <Icon name="search" size={15} />
          <input placeholder="Find a word, meaning or translation" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a word" />
          {query && (
            <button type="button" className="token-x" aria-label="Clear search" onClick={() => setQuery('')}>
              ×
            </button>
          )}
        </label>
        <button type="button" className={`btn dict-toggle ${filtersOpen ? 'on' : ''}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
          Filters
          {activeFilters > 0 && <span className="chip-count">{activeFilters}</span>}
        </button>
        <button type="button" className={`btn dict-toggle ${listOpen ? 'on' : ''}`} aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>
          List
          <span className="chip-count">{shown.length}</span>
        </button>
        <button type="button" className="btn btn-primary dict-new" onClick={onNewWord} title="New word (W)">
          <Icon name="plus" size={16} /> New word
        </button>
      </div>

      {filtersOpen && (
        <div className="dict-filters">
          <div className="filter-group">
            <span className="filter-label">Part of speech</span>
            <div className="chips">
              {PARTS_OF_SPEECH.filter((p) => posCounts.get(p)).map((p) => (
                <button key={p} type="button" className={`chip ${posFilter.has(p) ? 'on' : ''}`} aria-pressed={posFilter.has(p)} style={{ ['--chip' as string]: posColor(p, theme) }} onClick={() => togglePos(p)}>
                  {p}
                  <span className="chip-count">{posCounts.get(p)}</span>
                </button>
              ))}
            </div>
          </div>
          {index.languageCounts.size > 1 && (
            <div className="filter-group">
              <span className="filter-label">Language</span>
              <div className="chips">
                {[...index.languageCounts.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, n]) => (
                    <button key={code} type="button" className={`chip plain ${language === code ? 'on' : ''}`} aria-pressed={language === code} onClick={() => setLanguage(language === code ? null : code)}>
                      {index.languages.byCode.get(code)?.native ?? code}
                      <span className="chip-count">{n}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
          {fields.length > 0 && (
            <div className="filter-group">
              <span className="filter-label">Field</span>
              <div className="chips">
                {fields.map(([f, n]) => (
                  <button key={f} type="button" className={`chip plain ${field === f ? 'on' : ''}`} aria-pressed={field === f} onClick={() => onSetField(field === f ? undefined : f)}>
                    {f}
                    <span className="chip-count">{n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="filter-group">
            <span className="filter-label">First letter</span>
            <div className="thumb-index">
              {initials.map((l) => (
                <button key={l} type="button" className={letter === l ? 'on' : ''} aria-pressed={letter === l} onClick={() => setLetter(letter === l ? null : l)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {(activeFilters > 0 || query) && (
            <button type="button" className="link-button" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className={`dict-main ${listOpen ? 'with-list' : ''}`}>
        <WordWheel
          words={shown}
          edges={edges}
          isDue={index.isDue}
          theme={theme}
          selected={selectedWord}
          activeLetter={letter}
          onLetter={(l) => setLetter(letter === l ? null : l)}
          onOpen={onOpenWord}
          onBackground={onBackground}
        />
        {shown.length === 0 && (
          <div className="dict-nomatch">
            <p className="muted">No words match.</p>
            <button type="button" className="link-button" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}
        {listOpen && (
          <aside className="word-sheet" aria-label="Word list">
            <div className="word-sheet-head">
              <span>
                {shown.length === index.words.length ? 'All words' : `${shown.length} of ${index.words.length} words`}
              </span>
              <button type="button" className="icon-btn" aria-label="Hide list" onClick={() => setListOpen(false)}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <ul className="word-list">
              {shown.map((w) => (
                <li key={w.id}>
                  <button type="button" className={`word-row ${selectedWord === w.id ? 'selected' : ''}`} onClick={() => onOpenWord(w.id)} aria-current={selectedWord === w.id ? 'true' : undefined}>
                    <span className="dot" style={{ background: posColor(w.pos, theme) }} />
                    <span className="word-row-text">
                      <span className="word-row-word">
                        <span {...textProps(w.word, w.language)}>{w.word}</span> <em className="pos">{w.pos}</em>
                        {index.isDue(w) && <span className="due-mark" title="Due for review" />}
                      </span>
                      <span className="word-row-def" {...textProps(w.definition, w.language)}>
                        {w.definition}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
