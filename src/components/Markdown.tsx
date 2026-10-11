import { useMemo } from 'react';
import { Marked, type TokenizerAndRendererExtension } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import type { Note, Word } from '../types';

type Resolver = (target: string) => Note | Word | undefined;
let currentResolver: Resolver = () => undefined;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const wikilink: TokenizerAndRendererExtension = {
  name: 'wikilink',
  level: 'inline',
  start: (src) => src.indexOf('[['),
  tokenizer(src) {
    const m = /^\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/.exec(src);
    if (!m) return undefined;
    return { type: 'wikilink', raw: m[0], target: m[1].trim(), alias: m[3]?.trim() };
  },
  renderer(token) {
    const label = escapeHtml(token.alias || token.target);
    const hit = currentResolver(token.target);
    if (hit?.kind === 'word') {
      const href = `#/dictionary?word=${encodeURIComponent(hit.id)}`;
      return `<a class="wikilink word" href="${href}" title="${escapeHtml(hit.definition)}">${label}</a>`;
    }
    if (hit) {
      const href = `#/graph?note=${encodeURIComponent(hit.id)}`;
      return `<a class="wikilink" href="${href}" data-note="${escapeHtml(hit.id)}">${label}</a>`;
    }
    return `<a class="wikilink unresolved" href="#" data-create="${escapeHtml(token.target)}" title="No note yet. Click to create it.">${label}</a>`;
  },
};

const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
  { gfm: true, breaks: false, extensions: [wikilink] },
);

const CALLOUT_LABELS: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  info: 'Info',
  warning: 'Watch out',
  caution: 'Watch out',
  danger: 'Danger',
  example: 'Example',
  question: 'Question',
  important: 'Important',
};

/** Turns `> [!tip]` blockquotes into callouts, Obsidian style. */
function decorateCallouts(html: string): string {
  if (!html.includes('[!')) return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  for (const bq of tpl.content.querySelectorAll('blockquote')) {
    const p = bq.firstElementChild;
    if (p?.tagName !== 'P') continue;
    const m = /^\s*\[!(\w+)\][+-]?[ \t]*([^\n<]*)/.exec(p.innerHTML);
    if (!m) continue;
    const type = m[1].toLowerCase();
    bq.classList.add('callout', `callout-${CALLOUT_LABELS[type] ? type : 'note'}`);
    const title = m[2].trim() || CALLOUT_LABELS[type] || m[1];
    p.innerHTML = p.innerHTML.slice(m[0].length).replace(/^\s*\n/, '');
    const head = document.createElement('p');
    head.className = 'callout-title';
    head.textContent = title;
    bq.insertBefore(head, p);
    if (!p.innerHTML.trim()) p.remove();
  }
  return tpl.innerHTML;
}

export function renderMarkdown(src: string, resolve: Resolver): string {
  currentResolver = resolve;
  const html = marked.parse(src, { async: false }) as string;
  return decorateCallouts(DOMPurify.sanitize(html, { ADD_ATTR: ['target'] }));
}

/** Renders a single line of Markdown (code spans, emphasis) for titles and summaries. */
export function Inline({ text, as: Tag = 'span', className }: { text: string; as?: 'span' | 'p' | 'h1' | 'h2'; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parseInline(text, { async: false }) as string), [text]);
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Strips Markdown punctuation for compact list rows. */
export const plain = (text: string) => text.replace(/`/g, '').replace(/(\*\*|__)(.+?)\1/g, '$2');

interface Props {
  source: string;
  resolve: Resolver;
  onCreateLink?: (title: string) => void;
  className?: string;
}

export function Markdown({ source, resolve, onCreateLink, className }: Props) {
  const html = useMemo(() => renderMarkdown(source, resolve), [source, resolve]);
  return (
    <div
      className={`prose ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (!a) return;
        if (a.dataset.create) {
          e.preventDefault();
          onCreateLink?.(a.dataset.create);
        } else if (/^https?:/.test(a.getAttribute('href') ?? '')) {
          a.target = '_blank';
          a.rel = 'noreferrer';
        }
      }}
    />
  );
}
