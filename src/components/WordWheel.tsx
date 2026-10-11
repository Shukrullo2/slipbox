import { useEffect, useMemo, useRef, useState } from 'react';
import type { Word } from '../types';
import type { WordEdge } from '../vault';
import { posColor, type Theme } from '../palette';
import { hasArabic } from '../../shared/languages.js';

/**
 * The dictionary's graph: words sit on a ring in alphabetical order, like the
 * thumb index of a printed dictionary, and chords across the ring show how
 * they relate. Solid for synonyms, dashed red for antonyms, dotted for
 * see-also, thin blue for words that share a root.
 */
interface Props {
  words: Word[];
  edges: WordEdge[];
  isDue: (w: Word) => boolean;
  theme: Theme;
  selected?: string;
  /** Letter currently filtering the wheel; the markers inside the ring toggle it. */
  activeLetter?: string | null;
  onLetter?: (letter: string) => void;
  onOpen: (id: string) => void;
  onBackground: () => void;
}

const TAU = Math.PI * 2;
const MIN_SPACING = 11;

export function WordWheel({ words, edges, isDue, theme, selected, activeLetter, onLetter, onOpen, onBackground }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    const n = words.length;
    // On a phone the ring matters more than full labels: shorten them so the ring can grow.
    const compact = Math.min(size.w, size.h) < 600;
    const maxChars = compact ? 11 : 40;
    const longest = Math.min(maxChars, words.reduce((m, w) => Math.max(m, w.word.length), 4));
    const perChar = compact ? 5.5 : 6.5;
    // Labels stay on as long as neighbours on the ring are far enough apart to read.
    const withLabels = Math.max(40, Math.min(size.w, size.h) / 2 - Math.min(150, 30 + perChar * longest));
    const spacing = (TAU * withLabels) / Math.max(n, 1);
    const showLabels = spacing >= MIN_SPACING;
    const fontSize = compact ? 9.5 : Math.max(9.5, Math.min(11.5, spacing * 0.8));
    // Without labels the ring can grow, but hovered and selected words still show theirs, so keep room for one.
    const R = showLabels ? withLabels : Math.max(40, Math.min(size.w, size.h) / 2 - Math.min(110, 24 + 5 * longest));
    const cx = size.w / 2;
    const cy = size.h / 2;
    const pos = new Map<string, { x: number; y: number; angle: number; i: number }>();
    words.forEach((w, i) => {
      const angle = -Math.PI / 2 + (i / Math.max(n, 1)) * TAU;
      pos.set(w.id, { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle), angle, i });
    });
    // Letter groups, for the thumb index inside the ring.
    const letters: { letter: string; mid: number; start: number }[] = [];
    words.forEach((w, i) => {
      const letter = (w.word[0] ?? '#').toLocaleUpperCase();
      const last = letters.at(-1);
      if (!last || last.letter !== letter) letters.push({ letter, mid: i, start: i });
    });
    for (let k = 0; k < letters.length; k++) {
      const end = k + 1 < letters.length ? letters[k + 1].start : n;
      letters[k].mid = -Math.PI / 2 + (((letters[k].start + end) / 2 - 0.5) / Math.max(n, 1)) * TAU;
    }
    const neighbors = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!pos.has(e.source) || !pos.has(e.target)) continue;
      if (!neighbors.has(e.source)) neighbors.set(e.source, new Set());
      if (!neighbors.has(e.target)) neighbors.set(e.target, new Set());
      neighbors.get(e.source)!.add(e.target);
      neighbors.get(e.target)!.add(e.source);
    }
    return { n, R, cx, cy, pos, letters, showLabels, fontSize, maxChars, neighbors };
  }, [words, edges, size]);

  const focus = hover ?? selected ?? null;
  const lit = focus && layout.pos.has(focus) ? new Set([focus, ...(layout.neighbors.get(focus) ?? [])]) : null;

  if (!size.w || !words.length) return <div className="wheel" ref={wrap} />;

  const { R, cx, cy, pos, letters, showLabels, fontSize, maxChars } = layout;
  const short = (t: string) => (t.length > maxChars ? t.slice(0, maxChars - 1).trimEnd() + '…' : t);
  // A crowded wheel draws its chords lighter, so hovering is what reveals structure.
  const calm = edges.length > 90 ? 0.6 : 1;
  const chord = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    // Pull the control point toward the centre so chords bow inward.
    const qx = cx + (a.x + b.x - 2 * cx) * 0.22;
    const qy = cy + (a.y + b.y - 2 * cy) * 0.22;
    return `M${a.x},${a.y} Q${qx},${qy} ${b.x},${b.y}`;
  };
  const edgeStyle: Record<WordEdge['kind'], { stroke: string; width: number; dash?: string; opacity: number }> = {
    synonym: { stroke: 'var(--ink-2)', width: 1.6, opacity: 0.6 },
    antonym: { stroke: 'var(--red)', width: 1.4, dash: '5 4', opacity: 0.7 },
    related: { stroke: 'var(--ink-2)', width: 1.2, dash: '1.5 4', opacity: 0.6 },
    root: { stroke: 'var(--link)', width: 1, opacity: 0.45 },
  };

  return (
    <div className="wheel" ref={wrap}>
      <svg width={size.w} height={size.h} onClick={onBackground} role="img" aria-label={`${words.length} words arranged alphabetically, with lines between related words`}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--grid-major)" strokeWidth={1} />
        {letters.map((l, k) => {
          const tick = -Math.PI / 2 + ((l.start - 0.5) / Math.max(layout.n, 1)) * TAU;
          return (
            <g key={l.letter + k}>
              {letters.length > 1 && (
                <line
                  x1={cx + (R - 3) * Math.cos(tick)}
                  y1={cy + (R - 3) * Math.sin(tick)}
                  x2={cx + (R + 3) * Math.cos(tick)}
                  y2={cy + (R + 3) * Math.sin(tick)}
                  stroke="var(--line-strong)"
                />
              )}
              <g
                className={`wheel-letter-hit ${onLetter ? 'clickable' : ''} ${activeLetter === l.letter ? 'active' : ''}`}
                onClick={(e) => {
                  if (!onLetter) return;
                  e.stopPropagation();
                  onLetter(l.letter);
                }}
                role={onLetter ? 'button' : undefined}
                aria-label={onLetter ? `Only words starting with ${l.letter}` : undefined}
              >
                <circle cx={cx + (R - 22) * Math.cos(l.mid)} cy={cy + (R - 22) * Math.sin(l.mid)} r={14} fill="transparent" />
                <text x={cx + (R - 22) * Math.cos(l.mid)} y={cy + (R - 22) * Math.sin(l.mid)} className="wheel-letter" textAnchor="middle" dominantBaseline="middle" opacity={lit ? 0.35 : 1}>
                  {l.letter}
                </text>
              </g>
            </g>
          );
        })}
        {edges.map((e, i) => {
          const a = pos.get(e.source);
          const b = pos.get(e.target);
          if (!a || !b) return null;
          const st = edgeStyle[e.kind];
          const on = !lit || (lit.has(e.source) && lit.has(e.target));
          return (
            <path
              key={i}
              d={chord(a, b)}
              fill="none"
              stroke={st.stroke}
              strokeWidth={on && lit ? st.width + 0.6 : st.width}
              strokeDasharray={st.dash}
              opacity={on ? (lit ? st.opacity : st.opacity * calm) : 0.06}
              strokeLinecap="round"
            />
          );
        })}
        {words.map((w) => {
          const p = pos.get(w.id)!;
          const dim = lit && !lit.has(w.id);
          const degree = layout.neighbors.get(w.id)?.size ?? 0;
          const r = 3.5 + Math.min(degree, 6) * 0.6;
          const deg = (p.angle * 180) / Math.PI;
          const flip = deg > 90 || deg < -90;
          const label = showLabels || w.id === hover || w.id === selected || (lit?.has(w.id) && lit.size <= 30);
          return (
            <g
              key={w.id}
              className="wheel-word"
              opacity={dim ? 0.18 : 1}
              onMouseEnter={() => setHover(w.id)}
              onMouseLeave={() => setHover(null)}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(w.id);
              }}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(w.id)}
              tabIndex={0}
              role="button"
              aria-label={w.word}
            >
              <title>{`${w.word} (${w.pos}): ${w.definition}`}</title>
              {isDue(w) && <circle cx={p.x} cy={p.y} r={r + 2.6} fill="none" stroke="var(--red)" strokeWidth={1.3} />}
              {w.id === selected && <circle cx={p.x} cy={p.y} r={r + 5} fill="none" stroke="var(--ink)" strokeWidth={1.5} />}
              <circle cx={p.x} cy={p.y} r={r} fill={posColor(w.pos, theme)} />
              <circle cx={p.x} cy={p.y} r={Math.max(r + 8, 12)} fill="transparent" />
              {label && (
                <text
                  className={`wheel-label ${w.id === selected || w.id === hover ? 'strong' : ''} ${hasArabic(w.word) ? 'ar' : ''}`}
                  transform={`translate(${cx + (R + r + 7) * Math.cos(p.angle)},${cy + (R + r + 7) * Math.sin(p.angle)}) rotate(${flip ? deg + 180 : deg})`}
                  textAnchor={flip ? 'end' : 'start'}
                  dominantBaseline="middle"
                  fontSize={fontSize}
                >
                  {w.id === selected || w.id === hover ? w.word : short(w.word)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="wheel-legend" aria-hidden>
        <span>
          <i className="leg leg-synonym" /> synonym
        </span>
        <span>
          <i className="leg leg-antonym" /> antonym
        </span>
        <span>
          <i className="leg leg-related" /> see also
        </span>
        <span>
          <i className="leg leg-root" /> same root
        </span>
      </div>
    </div>
  );
}
