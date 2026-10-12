import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { WordWheel } from './WordWheel';
import type { VaultIndex } from '../vault';
import { PARTS_OF_SPEECH, type PartOfSpeech, type Word } from '../types';
import { posColor, type Theme } from '../palette';
import { textProps } from '../script';
import { daysBetween } from '../../shared/srs.js';

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

type ListMode = 'off' | 'side' | 'full';
type SortKey = 'word' | 'translation' | 'created' | 'review';

const initial = (w: Word) => (w.word[0] ?? '#').toLocaleUpperCase();
const wide = () => window.matchMedia('(min-width: 900px)').matches;
const ALL = 'all';

/** A preference remembered per device. */
function usePref<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key) as T | null;
      return v && allowed.includes(v) ? v : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }, [key, value]);
  return [value, setValue] as const;
}

/**
 * The dictionary: the word wheel fills the view, and filters and the list are
 * panels. The list can sit beside the wheel or take the whole view as a table.
 */
export function DictionaryView({ index, theme, selectedWord, field, onOpenWord, onSetField, onNewWord, onBackground }: Props) {
  const [query, setQuery] = useState('');
  const [posFilter, setPosFilter] = useState<Set<PartOfSpeech>>(new Set());
  const [letter, setLetter] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = usePref<'1' | '0'>('slipbox:dict-filters', wide() ? '1' : '0', ['1', '0']);
  const [listMode, setListMode] = usePref<ListMode>('slipbox:dict-list-mode', wide() ? 'side' : 'off', ['off', 'side', 'full']);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'word', dir: 1 });

  const { targets, byCode } = index.languages;
  // Translation languages to offer: the user's targets, plus any language entries already have.
  const translationLangs = useMemo(() => {
    const present = new Set(index.words.flatMap((w) => Object.keys(w.translations)));
    return [...new Set([...targets, ...present])];
  }, [index, targets]);
  const [translationLang, setTranslationLang] = usePref<string>('slipbox:dict-translation', translationLangs[0] ?? 'en', [...translationLangs, ALL]);

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

  /** The translation shown for a word in the chosen language; null when the word is already in it. */
  const translationOf = (w: Word): string | null => {
    if (translationLang === ALL) return Object.values(w.translations).join(' · ');
    if (w.language === translationLang) return null;
    return w.translations[translationLang] ?? '';
  };

  const nextReview = (w: Word) => {
    if (w.review === false) return { label: 'off', due: false };
    if (index.isDue(w)) return { label: 'due', due: true };
    if (!w.review.due) return { label: 'new', due: false };
    const days = daysBetween(index.today, w.review.due);
    return { label: days === 1 ? 'tomorrow' : `${days} days`, due: false };
  };

  const listed = useMemo(() => {
    const key = (w: Word): string => {
      if (sort.key === 'translation') return translationOf(w) ?? '';
      if (sort.key === 'created') return w.created;
      if (sort.key === 'review') return w.review === false ? '9999' : (w.review.due ?? '0000');
      return w.word;
    };
    return [...shown].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      // Words without a translation sink to the bottom whichever way the column is sorted.
      if (sort.key === 'translation' && !ka !== !kb) return ka ? -1 : 1;
      return sort.dir * ka.localeCompare(kb, undefined, { sensitivity: 'base' });
    });
  }, [shown, sort, translationLang]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'created' ? -1 : 1 }));
  const sortMark = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : '');

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
  const langName = (code: string) => byCode.get(code)?.name ?? (code === 'other' ? 'Other' : code);
  const translationPicker = (
    <select className="input lang-pick" aria-label="Translation language" value={translationLang} onChange={(e) => setTranslationLang(e.target.value)}>
      {translationLangs.map((code) => (
        <option key={code} value={code}>
          {langName(code)}
        </option>
      ))}
      <option value={ALL}>All languages</option>
    </select>
  );
  const translationCell = (w: Word, stacked = false) => {
    if (translationLang === ALL && stacked) {
      // One line per language, in the same order as the picker, each tagged with its code.
      const order = (code: string) => (translationLangs.indexOf(code) + 1 || 999);
      const entries = Object.entries(w.translations)
        .filter(([, text]) => text)
        .sort(([a], [b]) => order(a) - order(b));
      if (!entries.length) return <span className="muted small">none yet</span>;
      return (
        <span className="tr-lines">
          {entries.map(([code, text]) => (
            <span key={code} className="tr-line">
              <abbr className="tr-code" title={langName(code)}>
                {code === 'other' ? '…' : code}
              </abbr>
              <span {...textProps(text, code)}>{text}</span>
            </span>
          ))}
        </span>
      );
    }
    const t = translationOf(w);
    if (t === null)
      return (
        <span className="muted" title={`Already in ${langName(translationLang)}`}>
          —
        </span>
      );
    if (!t) return <span className="muted small">none yet</span>;
    return <span {...(translationLang === ALL ? {} : textProps(t, translationLang))}>{t}</span>;
  };

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
        <button type="button" className={`btn dict-toggle ${filtersOpen === '1' ? 'on' : ''}`} aria-expanded={filtersOpen === '1'} onClick={() => setFiltersOpen(filtersOpen === '1' ? '0' : '1')}>
          Filters
          {activeFilters > 0 && <span className="chip-count">{activeFilters}</span>}
        </button>
        <button type="button" className={`btn dict-toggle ${listMode !== 'off' ? 'on' : ''}`} aria-expanded={listMode !== 'off'} onClick={() => setListMode(listMode === 'off' ? 'side' : 'off')}>
          List
          <span className="chip-count">{shown.length}</span>
        </button>
        <button type="button" className="btn btn-primary dict-new" onClick={onNewWord} title="New word (W)">
          <Icon name="plus" size={16} /> New word
        </button>
      </div>

      {filtersOpen === '1' && (
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
                      {byCode.get(code)?.native ?? code}
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

      <div className={`dict-main ${listMode === 'side' ? 'with-list' : ''} ${listMode === 'full' ? 'list-full' : ''}`}>
        {listMode !== 'full' && (
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
        )}
        {shown.length === 0 && (
          <div className="dict-nomatch">
            <p className="muted">No words match.</p>
            <button type="button" className="link-button" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}
        {listMode !== 'off' && (
          <aside className="word-sheet" aria-label="Word list">
            <div className="word-sheet-head">
              <span className="word-sheet-title">{shown.length === index.words.length ? `${shown.length} words` : `${shown.length} of ${index.words.length}`}</span>
              {translationPicker}
              <button
                type="button"
                className="icon-btn"
                aria-label={listMode === 'full' ? 'Show the wheel' : 'Full screen list'}
                title={listMode === 'full' ? 'Show the wheel' : 'Full screen list'}
                onClick={() => setListMode(listMode === 'full' ? 'side' : 'full')}
              >
                <Icon name={listMode === 'full' ? 'collapse' : 'expand'} size={16} />
              </button>
              <button type="button" className="icon-btn" aria-label="Hide list" title="Hide list" onClick={() => setListMode('off')}>
                <Icon name="close" size={16} />
              </button>
            </div>

            {listMode === 'full' ? (
              <div className="word-table-wrap">
                <table className="word-table">
                  <thead>
                    <tr>
                      <th>
                        <button type="button" onClick={() => sortBy('word')}>
                          Word{sortMark('word')}
                        </button>
                      </th>
                      <th>
                        <button type="button" onClick={() => sortBy('translation')}>
                          {translationLang === ALL ? 'Translations' : langName(translationLang)}
                          {sortMark('translation')}
                        </button>
                      </th>
                      <th>Meaning</th>
                      <th className="wt-pos">Part of speech</th>
                      <th className="wt-fields">Fields</th>
                      <th className="wt-date">
                        <button type="button" onClick={() => sortBy('created')}>
                          Added{sortMark('created')}
                        </button>
                      </th>
                      <th>
                        <button type="button" onClick={() => sortBy('review')}>
                          Review{sortMark('review')}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {listed.map((w) => {
                      const r = nextReview(w);
                      return (
                        <tr key={w.id} className={selectedWord === w.id ? 'selected' : ''} onClick={() => onOpenWord(w.id)}>
                          <td className="wt-word" data-label="Word">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenWord(w.id);
                              }}
                            >
                              <span className="dot" style={{ background: posColor(w.pos, theme) }} />
                              <span {...textProps(w.word, w.language)}>{w.word}</span>
                            </button>
                            {w.pronunciation && <span className="wt-sub">{w.pronunciation}</span>}
                          </td>
                          <td className="wt-translation" data-label={translationLang === ALL ? 'Translations' : langName(translationLang)}>
                            {translationCell(w, true)}
                          </td>
                          <td className="wt-meaning" data-label="Meaning">
                            <span {...textProps(w.definition, w.language)}>{w.definition}</span>
                          </td>
                          <td className="wt-pos" data-label="Part of speech">
                            <em className="pos">{w.pos}</em>
                          </td>
                          <td className="wt-fields" data-label="Fields">
                            {w.fields.join(', ') || <span className="muted">—</span>}
                          </td>
                          <td className="wt-date" data-label="Added">
                            {new Date(`${w.created}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </td>
                          <td className="wt-review" data-label="Review">
                            <span className={r.due ? 'due-text' : 'muted'}>
                              {r.due && <span className="due-mark" />}
                              {r.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="word-list">
                {listed.map((w) => (
                  <li key={w.id}>
                    <button type="button" className={`word-row ${selectedWord === w.id ? 'selected' : ''}`} onClick={() => onOpenWord(w.id)} aria-current={selectedWord === w.id ? 'true' : undefined}>
                      <span className="dot" style={{ background: posColor(w.pos, theme) }} />
                      <span className="word-row-text">
                        <span className="word-row-line">
                          <span className="word-row-word">
                            <span {...textProps(w.word, w.language)}>{w.word}</span> <em className="pos">{w.pos}</em>
                            {index.isDue(w) && <span className="due-mark" title="Due for review" />}
                          </span>
                          <span className="word-row-translation">{translationCell(w)}</span>
                        </span>
                        <span className="word-row-def" {...textProps(w.definition, w.language)}>
                          {w.definition}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
