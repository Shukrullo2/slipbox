import { useId, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { api } from '../api';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { TokenInput, type TokenOption } from './TokenInput';
import type { VaultIndex } from '../vault';
import type { NoteInput } from '../types';
import { inkColor, type Theme } from '../palette';

export interface Draft {
  title: string;
  domains: string[];
  tags: string[];
  summary: string;
  question: string;
  source: string;
  body: string;
}

export const emptyDraft = (partial: Partial<Draft> = {}): Draft => ({
  title: '',
  domains: [],
  tags: [],
  summary: '',
  question: '',
  source: '',
  body: '',
  ...partial,
});

export const draftToInput = (d: Draft): NoteInput => ({ ...d, title: d.title.trim() });

const slug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+#]+/g, '-').replace(/^-+|-+$/g, '');

const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700', color: 'var(--ink)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--link)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', color: 'var(--code-ink)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.quote], color: 'var(--ink-2)' },
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--code-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--ink-2)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.definition(t.variableName)], color: 'var(--code-fn)' },
]);

interface Props {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  index: VaultIndex;
  theme: Theme;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  autoFocus?: 'title' | 'body';
}

export function NoteForm({ draft, onChange, onSubmit, onCancel, index, theme, submitLabel, busy, error, autoFocus = 'title' }: Props) {
  const [showMore, setShowMore] = useState(Boolean(draft.source || draft.summary));
  const [filling, setFilling] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);

  /** Asks the server's AI to complete the note, then fills only what is still empty. */
  const fillWithAi = async () => {
    if (filling || (!draft.title.trim() && !draft.body.trim())) return;
    setFilling(true);
    setAiError(null);
    setAiNote(null);
    try {
      const s = await api.aiNote({ ...draft, title: draft.title.trim() });
      onChange({
        ...draft,
        title: draft.title.trim() || s.title,
        summary: draft.summary.trim() || s.summary,
        question: draft.question.trim() || s.question,
        tags: draft.tags.length ? draft.tags : s.tags,
        domains: draft.domains.length ? draft.domains : s.domains,
        body: draft.body.trim() ? draft.body : s.body,
      });
      setShowMore(true);
      setAiNote(draft.body.trim() ? 'Filled in the summary, question and tags. Check them before saving.' : 'Drafted the note. Read it closely: the AI can be confidently wrong, and the recall question only helps if you agree with the answer.');
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setFilling(false);
    }
  };
  const formId = useId();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });

  // Refs keep CodeMirror extensions stable while their data changes.
  const titlesRef = useRef<string[]>([]);
  titlesRef.current = index.notes.map((n) => n.title);
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(highlight),
      EditorView.lineWrapping,
      cmPlaceholder('What did you learn? Explain it in your own words, add an example, note where it bites.\nType [[ to link another note.'),
      // CodeMirror binds Mod-Enter itself, so saving has to win inside the editor.
      Prec.highest(
        keymap.of([
          { key: 'Mod-Enter', run: () => (submitRef.current(), true) },
          { key: 'Mod-s', run: () => (submitRef.current(), true), preventDefault: true },
        ]),
      ),
      autocompletion({
        override: [
          (ctx: CompletionContext) => {
            const m = ctx.matchBefore(/\[\[[^\]\n]*/);
            if (!m) return null;
            return {
              from: m.from + 2,
              validFor: /^[^\]\n]*$/,
              options: titlesRef.current.map((title) => ({
                label: title,
                type: 'text',
                apply: (view: EditorView, _c: unknown, from: number, to: number) => {
                  const closed = view.state.sliceDoc(to, to + 2) === ']]';
                  const insert = closed ? title : `${title}]]`;
                  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + (closed ? 2 : 0) } });
                },
              })),
            };
          },
        ],
      }),
    ],
    [],
  );

  const domainOptions: TokenOption[] = [...index.domains]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => {
      const parent = d.parent ? index.domainBySlug.get(d.parent) : undefined;
      return {
        value: d.slug,
        label: d.name,
        color: inkColor(d.color, theme),
        hint: parent ? `in ${parent.name}` : undefined,
        count: index.notesByDomain.get(d.slug)?.length ?? 0,
      };
    });
  const tagCounts = new Map<string, number>();
  for (const n of index.notes) for (const tag of n.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const tagOptions: TokenOption[] = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ value: tag, label: tag, count }));

  return (
    <div
      className="note-form"
      onKeyDown={(e) => {
        // CodeMirror marks keys it handled (e.g. Escape closing autocomplete).
        if (e.defaultPrevented) return;
        if ((e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.key === 's')) {
          e.preventDefault();
          onSubmit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <textarea
        className="form-title"
        aria-label="Title"
        rows={1}
        placeholder="Name the idea in one line"
        value={draft.title}
        autoFocus={autoFocus === 'title'}
        onChange={(e) => set('title', e.target.value.replace(/\n/g, ' '))}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        }}
      />
      <div className="form-rule" />

      <div className="form-actions ai-row">
        <span className="hint">
          {index.ai.enabled ? 'Name the idea, then let the AI draft the rest; it fills only what is empty.' : 'AI fill is not set up on this server.'}
        </span>
        <button
          type="button"
          className="btn ai-fill"
          onClick={fillWithAi}
          disabled={!index.ai.enabled || filling || (!draft.title.trim() && !draft.body.trim())}
          title={index.ai.enabled ? `Uses ${index.ai.model}` : undefined}
        >
          {filling ? <span className="spin" aria-hidden /> : <Icon name="sparkle" size={15} />}
          {filling ? 'Filling in…' : 'Fill in with AI'}
        </button>
      </div>
      {aiNote && <p className="ai-note">{aiNote}</p>}
      {aiError && (
        <p className="form-error" role="alert">
          {aiError}
        </p>
      )}

      <div className="form-grid">
        <div className="field">
          <label className="field-label" htmlFor={`${formId}-domains`}>
            Domains
          </label>
          <TokenInput
            id={`${formId}-domains`}
            label="Domains"
            noun="domain"
            value={draft.domains}
            onChange={(v) => set('domains', v)}
            options={domainOptions}
            normalize={slug}
            placeholder="Choose or add a domain"
            renderToken={(v) => {
              const d = index.domainBySlug.get(v);
              return (
                <>
                  <span className="dot" style={{ background: inkColor(d?.color, theme) }} />
                  {d?.name ?? v.charAt(0).toUpperCase() + v.slice(1).replace(/-/g, ' ')}
                </>
              );
            }}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${formId}-tags`}>
            Tags
          </label>
          <TokenInput
            id={`${formId}-tags`}
            label="Tags"
            noun="tag"
            value={draft.tags}
            onChange={(v) => set('tags', v)}
            options={tagOptions}
            normalize={(s) => s.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase()}
            placeholder="Choose or add tags"
          />
        </div>
      </div>

      <label className="field">
        <span className="field-label">Recall question</span>
        <input
          className="input"
          value={draft.question}
          onChange={(e) => set('question', e.target.value)}
          placeholder="What should future you be able to answer? Used when you review."
        />
      </label>

      <div className="field">
        <span className="field-label">Note</span>
        <CodeMirror
          className="editor"
          value={draft.body}
          onChange={(v) => set('body', v)}
          extensions={extensions}
          theme="none"
          autoFocus={autoFocus === 'body'}
          basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false, searchKeymap: true }}
          minHeight="180px"
        />
      </div>

      {showMore ? (
        <div className="form-grid">
          <label className="field">
            <span className="field-label">One-line summary</span>
            <input className="input" value={draft.summary} onChange={(e) => set('summary', e.target.value)} placeholder="The takeaway, shown in lists and on review cards" />
          </label>
          <label className="field">
            <span className="field-label">Where you learned it</span>
            <input className="input" value={draft.source} onChange={(e) => set('source', e.target.value)} placeholder="e.g. Claude Code, billing-api repo" />
          </label>
        </div>
      ) : (
        <button type="button" className="link-button" onClick={() => setShowMore(true)}>
          Add summary and source
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
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onSubmit} disabled={busy || !draft.title.trim()}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
