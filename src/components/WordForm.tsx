import { useState } from 'react';
import { TokenInput, type TokenOption } from './TokenInput';
import { Icon } from './Icon';
import { api } from '../api';
import type { VaultIndex } from '../vault';
import { PARTS_OF_SPEECH, type PartOfSpeech, type Word, type WordInput } from '../types';
import { posColor, type Theme } from '../palette';
import { detectLanguage, needsHarakat } from '../../shared/languages.js';
import { textProps } from '../script';

export interface WordDraft {
  word: string;
  language: string;
  pos: PartOfSpeech;
  definition: string;
  example: string;
  translations: Record<string, string>;
  pronunciation: string;
  synonyms: string[];
  antonyms: string[];
  related: string[];
  root: string;
  fields: string[];
  source: string;
  body: string;
}

export const emptyWordDraft = (partial: Partial<WordDraft> = {}): WordDraft => ({
  word: '',
  language: 'en',
  pos: 'noun',
  definition: '',
  example: '',
  translations: {},
  pronunciation: '',
  synonyms: [],
  antonyms: [],
  related: [],
  root: '',
  fields: [],
  source: '',
  body: '',
  ...partial,
});

export const wordToDraft = (w: Word): WordDraft => ({
  word: w.word,
  language: w.language,
  pos: w.pos,
  definition: w.definition,
  example: w.example ?? '',
  translations: { ...w.translations },
  pronunciation: w.pronunciation ?? '',
  synonyms: w.synonyms,
  antonyms: w.antonyms,
  related: w.related,
  root: w.root ?? '',
  fields: w.fields,
  source: w.source ?? '',
  body: w.body,
});

const slug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+#]+/g, '-').replace(/^-+|-+$/g, '');

interface Props {
  initial: Partial<WordDraft>;
  /** Set when editing an existing entry. */
  editing?: Word;
  index: VaultIndex;
  theme: Theme;
  onClose: () => void;
  onSubmit: (input: WordInput) => Promise<void>;
}

export function WordModal({ initial, editing, index, theme, onClose, onSubmit }: Props) {
  const [draft, setDraft] = useState<WordDraft>(() => (editing ? wordToDraft(editing) : emptyWordDraft(initial)));
  const [showMore, setShowMore] = useState(Boolean(draft.root || draft.source || draft.body || draft.pronunciation));
  const [busy, setBusy] = useState(false);
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [languageTouched, setLanguageTouched] = useState(!!editing || !!initial.language);
  const set = <K extends keyof WordDraft>(key: K, value: WordDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  /** Typing Cyrillic or Arabic flips the language automatically, until the user chooses one. */
  const setWord = (value: string) => setDraft((d) => ({ ...d, word: value, language: languageTouched ? d.language : detectLanguage(value) }));

  const start = editing ? wordToDraft(editing) : emptyWordDraft(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(start);
  const canSave = !!draft.word.trim() && !!draft.definition.trim() && !busy && !filling;
  const { known, byCode, targets } = index.languages;
  // Translation rows: every target language except the entry's own, plus any translation already present.
  const translationLangs = [...new Set([...targets, ...Object.keys(draft.translations)])].filter((c) => c !== draft.language);

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const translations = Object.fromEntries(Object.entries(draft.translations).filter(([c, t]) => t.trim() && c !== draft.language).map(([c, t]) => [c, t.trim()]));
      await onSubmit({ ...draft, word: draft.word.trim(), definition: draft.definition.trim(), translations });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const cancel = () => {
    if (dirty && !confirm(editing ? 'Discard your changes to this entry?' : 'Discard this entry?')) return;
    onClose();
  };

  /** Asks the server's AI to complete the entry, then fills only what is still empty. */
  /** Every Arabic string in the draft that has no vowel marks yet, with a setter to put the vowelled text back. */
  const unvowelled = (d: WordDraft) => {
    const slots: { text: string; put: (x: WordDraft, v: string) => WordDraft }[] = [];
    const arEntry = d.language === 'ar';
    if (arEntry) {
      for (const k of ['word', 'definition', 'example', 'root'] as const) if (needsHarakat(d[k])) slots.push({ text: d[k], put: (x, v) => ({ ...x, [k]: v }) });
      for (const k of ['synonyms', 'antonyms', 'related'] as const)
        d[k].forEach((t, i) => needsHarakat(t) && slots.push({ text: t, put: (x, v) => ({ ...x, [k]: x[k].map((y, j) => (j === i ? v : y)) }) }));
    }
    for (const [code, t] of Object.entries(d.translations)) if (needsHarakat(t)) slots.push({ text: t, put: (x, v) => ({ ...x, translations: { ...x.translations, [code]: v } }) });
    return slots;
  };
  const missingHarakat = unvowelled(draft).length > 0;

  /** Adds harakat to Arabic in the draft; letters are verified unchanged on the server. */
  const vowel = async (d: WordDraft): Promise<{ draft: WordDraft; rejected: number }> => {
    const slots = unvowelled(d);
    if (!slots.length) return { draft: d, rejected: 0 };
    const { texts, rejected } = await api.harakat(slots.map((x) => x.text));
    return { draft: slots.reduce((acc, slot, i) => (texts[i] && texts[i] !== slot.text ? slot.put(acc, texts[i]) : acc), d), rejected };
  };
  const addHarakat = async () => {
    if (filling) return;
    setFilling(true);
    setError(null);
    setNote(null);
    try {
      const { draft: next, rejected } = await vowel(draft);
      setDraft(next);
      setNote(rejected ? `Added harakat. ${rejected} piece${rejected === 1 ? '' : 's'} came back with different letters, so they were left as you wrote them.` : 'Added harakat. Check the vowels before saving.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFilling(false);
    }
  };

  const fillWithAi = async () => {
    if (!draft.word.trim() || filling) return;
    setFilling(true);
    setError(null);
    setNote(null);
    try {
      const s = await api.aiWord({ ...draft, word: draft.word.trim(), targets });
      const keepList = (mine: string[], theirs: string[]) => (mine.length ? mine : theirs);
      const d = draft;
      const filled: WordDraft = {
        ...d,
        word: d.word.trim() || s.word,
        language: d.language && d.language !== 'en' ? d.language : s.language || d.language,
        pos: editing ? d.pos : s.pos || d.pos,
        definition: d.definition.trim() || s.definition,
        example: d.example.trim() || s.example,
        pronunciation: d.pronunciation.trim() || s.pronunciation,
        root: d.root.trim() || s.root,
        synonyms: keepList(d.synonyms, s.synonyms),
        antonyms: keepList(d.antonyms, s.antonyms),
        related: keepList(d.related, s.related),
        fields: keepList(d.fields, s.fields),
        translations: { ...s.translations, ...Object.fromEntries(Object.entries(d.translations).filter(([, t]) => t.trim())) },
      };
      // Arabic the user typed themselves gets vowelled too.
      setDraft((await vowel(filled).catch(() => ({ draft: filled }))).draft);
      setShowMore(true);
      setNote('Filled in. Check it before saving: the AI can be confidently wrong, especially with translations.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFilling(false);
    }
  };

  const self = draft.word.trim().toLowerCase();
  const wordOptions: TokenOption[] = index.words
    .filter((w) => w.word.toLowerCase() !== self)
    .map((w) => ({ value: w.word, label: w.word, color: posColor(w.pos, theme), hint: w.pos }));
  const fieldOptions: TokenOption[] = [...index.fieldCounts.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => ({ value: f, label: f, count: n }));
  const relation = (key: 'synonyms' | 'antonyms' | 'related', label: string, placeholder: string) => (
    <div className="field">
      <span className="field-label">{label}</span>
      <TokenInput label={label} noun="word" value={draft[key]} onChange={(v) => set(key, v)} options={wordOptions} placeholder={placeholder} normalize={(t) => t.trim()} />
    </div>
  );

  return (
    <div className="overlay" onMouseDown={cancel}>
      <div
        className="capture card word-form"
        role="dialog"
        aria-label={editing ? 'Edit dictionary entry' : 'New word'}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.defaultPrevented) return;
          if ((e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.key === 's')) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancel();
          }
        }}
      >
        <div className="word-form-head">
          <input
            className="form-title word-title"
            aria-label="Word"
            placeholder="The word or term"
            value={draft.word}
            {...textProps(draft.word, draft.language)}
            autoFocus={!initial.word && !editing}
            onChange={(e) => setWord(e.target.value)}
          />
          <select
            className="input lang-select"
            aria-label="Language"
            value={draft.language}
            onChange={(e) => {
              setLanguageTouched(true);
              set('language', e.target.value);
            }}
          >
            {known.map((l) => (
              <option key={l.code} value={l.code}>
                {l.native}
              </option>
            ))}
          </select>
          <select className="input pos-select" aria-label="Part of speech" value={draft.pos} onChange={(e) => set('pos', e.target.value as PartOfSpeech)}>
            {PARTS_OF_SPEECH.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="form-rule" />

        <div className="note-form">
          <div className="form-actions ai-row">
            <span className="hint">
              {index.ai.enabled ? 'Type the word, then let the AI draft the rest; it fills only what is empty.' : 'AI fill is not set up on this server.'}
            </span>
            {index.ai.enabled && missingHarakat && (
              <button type="button" className="btn ai-fill" onClick={addHarakat} disabled={filling} title="Add Arabic vowel marks to the Arabic in this entry">
                <span lang="ar" className="harakat-glyph" aria-hidden>
                  حَرَكَات
                </span>
                Add harakat
              </button>
            )}
            <button type="button" className="btn ai-fill" onClick={fillWithAi} disabled={!index.ai.enabled || !draft.word.trim() || filling} title={index.ai.enabled ? `Uses ${index.ai.model}` : undefined}>
              {filling ? <span className="spin" aria-hidden /> : <Icon name="sparkle" size={15} />}
              {filling ? 'Filling in…' : 'Fill in with AI'}
            </button>
          </div>
          {note && <p className="ai-note">{note}</p>}

          <label className="field">
            <span className="field-label">Meaning</span>
            <textarea className="input" rows={2} {...textProps(draft.definition, draft.language)} autoFocus={!!initial.word && !editing} placeholder="In your own words, one or two sentences." value={draft.definition} onChange={(e) => set('definition', e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Example</span>
            <input className="input" {...textProps(draft.example, draft.language)} placeholder="A sentence that uses it, ideally from your own work." value={draft.example} onChange={(e) => set('example', e.target.value)} />
          </label>

          <div className="field">
            <span className="field-label">Translations</span>
            <div className="translation-grid">
              {translationLangs.map((code) => {
                const l = byCode.get(code);
                return (
                  <label key={code} className="field">
                    <span className="field-label">
                      {l?.name ?? code} <span>{l && l.native !== l.name ? l.native : ''}</span>
                    </span>
                    <input
                      className="input"
                      {...textProps(draft.translations[code], code)}
                      value={draft.translations[code] ?? ''}
                      onChange={(e) => set('translations', { ...draft.translations, [code]: e.target.value })}
                    />
                  </label>
                );
              })}
            </div>
          </div>

          <div className="form-grid">
            {relation('synonyms', 'Synonyms', 'Same meaning')}
            {relation('antonyms', 'Antonyms', 'Opposite meaning')}
          </div>
          <div className="form-grid">
            {relation('related', 'See also', 'Worth knowing together')}
            <div className="field">
              <span className="field-label">Fields</span>
              <TokenInput label="Fields" noun="field" value={draft.fields} onChange={(v) => set('fields', v)} options={fieldOptions} placeholder="statistics, legal…" normalize={slug} />
            </div>
          </div>

          {showMore ? (
            <>
              <div className="form-grid">
                <label className="field">
                  <span className="field-label">Root or origin</span>
                  <input className="input" placeholder="e.g. Latin idem (same) + potens (able)" value={draft.root} onChange={(e) => set('root', e.target.value)} />
                </label>
                <label className="field">
                  <span className="field-label">Pronunciation</span>
                  <input className="input" placeholder="/aɪˈdɛmpətənt/" value={draft.pronunciation} onChange={(e) => set('pronunciation', e.target.value)} />
                </label>
              </div>
              <label className="field">
                <span className="field-label">Where you met it</span>
                <input className="input" placeholder="e.g. Claude Code, payments API" value={draft.source} onChange={(e) => set('source', e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Notes</span>
                <textarea className="input" rows={4} placeholder="Anything else: nuances, how it differs from a near-synonym, more examples. Markdown works." value={draft.body} onChange={(e) => set('body', e.target.value)} />
              </label>
            </>
          ) : (
            <button type="button" className="link-button" onClick={() => setShowMore(true)}>
              Add root, pronunciation, source and notes
            </button>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <span className="hint">
              <kbd>⌘</kbd>
              <kbd>↵</kbd> to save, <kbd>Esc</kbd> to cancel
            </span>
            <button type="button" className="btn" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={!canSave}>
              {busy ? 'Saving…' : editing ? 'Save entry' : 'Add to dictionary'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
