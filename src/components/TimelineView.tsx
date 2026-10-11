import { useEffect, useMemo, useRef, useState } from 'react';
import type { VaultIndex } from '../vault';
import type { Reviewable } from '../types';
import { inkColor, posColor, type Theme } from '../palette';
import { plain } from './Markdown';
import { textProps } from '../script';
import { addDays, daysBetween } from '../../shared/srs.js';

interface Props {
  index: VaultIndex;
  theme: Theme;
  selectedNote?: string;
  onOpenNote: (id: string) => void;
  onOpenWord: (id: string) => void;
}

const WEEKS = 52;
const WORDS = '__words__';
const day = (iso: string) => new Date(`${iso}T12:00:00`);
const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => day(iso).toLocaleDateString(undefined, opts);

/** Monday of the week containing `iso`. */
function weekStart(iso: string): string {
  const dow = (day(iso).getDay() + 6) % 7;
  return addDays(iso, -dow);
}

function weekHeading(start: string, today: string): string {
  const thisWeek = weekStart(today);
  if (start === thisWeek) return 'This week';
  if (start === addDays(thisWeek, -7)) return 'Last week';
  const end = addDays(start, 6);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const a = fmt(start, { month: 'short', day: 'numeric' });
  const b = sameMonth ? fmt(end, { day: 'numeric' }) : fmt(end, { month: 'short', day: 'numeric' });
  const year = start.slice(0, 4) !== today.slice(0, 4) ? `, ${start.slice(0, 4)}` : '';
  return `${a} – ${b}${year}`;
}

const titleOf = (x: Reviewable) => (x.kind === 'word' ? x.word : x.title);

export function TimelineView({ index, theme, selectedNote, onOpenNote, onOpenWord }: Props) {
  const [filter, setFilter] = useState<string | null>(null);
  const heatRef = useRef<HTMLDivElement>(null);
  const { today } = index;

  const captured = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of [...index.notes, ...index.words]) m[n.created] = (m[n.created] ?? 0) + 1;
    return m;
  }, [index]);

  const activity = (d: string) => (captured[d] ?? 0) + (index.reviews[d] ?? 0);

  const streak = useMemo(() => {
    let d = activity(today) > 0 ? today : addDays(today, -1);
    let n = 0;
    while (activity(d) > 0) {
      n++;
      d = addDays(d, -1);
    }
    return n;
  }, [captured, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const grid = useMemo(() => {
    const first = addDays(weekStart(today), -7 * (WEEKS - 1));
    return Array.from({ length: WEEKS }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const date = addDays(first, w * 7 + d);
        return { date, future: date > today, notes: captured[date] ?? 0, reviews: index.reviews[date] ?? 0 };
      }),
    );
  }, [today, captured, index]);

  useEffect(() => {
    heatRef.current?.scrollTo({ left: heatRef.current.scrollWidth });
  }, []);

  const groups = useMemo(() => {
    const items: Reviewable[] =
      filter === WORDS ? index.words : filter ? index.notes.filter((n) => n.domains.includes(filter)) : [...index.notes, ...index.words];
    items.sort((a, b) => b.created.localeCompare(a.created) || titleOf(a).localeCompare(titleOf(b)));
    const out: { start: string; items: Reviewable[] }[] = [];
    for (const n of items) {
      const start = weekStart(n.created);
      if (out.at(-1)?.start !== start) out.push({ start, items: [] });
      out.at(-1)!.items.push(n);
    }
    return out;
  }, [index, filter]);

  const level = (count: number) => (count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4);
  const thisWeek = [...index.notes, ...index.words].filter((n) => daysBetween(weekStart(today), n.created) >= 0).length;
  const months = grid.map((week, i) => {
    const m = week[0].date.slice(5, 7);
    return i === 0 || grid[i - 1][0].date.slice(5, 7) !== m ? fmt(week[0].date, { month: 'short' }) : '';
  });
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return (
    <div className="timeline">
      <header className="timeline-head">
        <h1>What you've learned</h1>
        <p className="lede">
          {plural(index.notes.length, 'note')} across {plural(index.domains.length, 'domain')}
          {index.words.length > 0 ? `, and ${plural(index.words.length, 'word')} in the dictionary` : ''}.{' '}
          {thisWeek > 0 ? `${thisWeek} captured this week. ` : 'Nothing captured this week yet. '}
          {streak > 1 ? `You've captured or reviewed something ${streak} days in a row.` : ''}
        </p>
      </header>

      <div className="heatmap-wrap" ref={heatRef}>
        <div className="heatmap" role="img" aria-label="Daily activity over the past year: notes and words captured plus reviews">
          <div className="heat-months" aria-hidden>
            {months.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
          <div className="heat-grid">
            {grid.map((week, w) => (
              <div className="heat-week" key={w}>
                {week.map((c) => (
                  <span
                    key={c.date}
                    className={`heat-cell l${level(c.notes + c.reviews)} ${c.future ? 'future' : ''} ${c.date === today ? 'today' : ''}`}
                    title={c.future ? '' : `${fmt(c.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${c.notes} captured, ${c.reviews} reviewed`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="heat-legend">
        Less
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heat-cell l${l}`} />
        ))}
        More
      </p>

      <div className="chips filter-chips" role="group" aria-label="Filter">
        <button type="button" className={`chip plain ${!filter ? 'on' : ''}`} onClick={() => setFilter(null)} aria-pressed={!filter}>
          Everything
        </button>
        {index.domains
          .filter((d) => index.notesByDomain.get(d.slug)?.length)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((d) => (
            <button
              key={d.slug}
              type="button"
              className={`chip ${filter === d.slug ? 'on' : ''}`}
              aria-pressed={filter === d.slug}
              style={{ ['--chip' as string]: inkColor(d.color, theme) }}
              onClick={() => setFilter(filter === d.slug ? null : d.slug)}
            >
              {d.name}
            </button>
          ))}
        {index.words.length > 0 && (
          <button type="button" className={`chip plain ${filter === WORDS ? 'on' : ''}`} aria-pressed={filter === WORDS} onClick={() => setFilter(filter === WORDS ? null : WORDS)}>
            Dictionary
          </button>
        )}
      </div>

      {groups.length === 0 && <p className="muted">Nothing here yet.</p>}
      {groups.map((g) => (
        <section key={g.start} className="week">
          <h2>{weekHeading(g.start, today)}</h2>
          <ul>
            {g.items.map((n) =>
              n.kind === 'word' ? (
                <li key={n.id}>
                  <button type="button" className="week-row" onClick={() => onOpenWord(n.id)}>
                    <span className="week-day">{fmt(n.created, { weekday: 'short', day: 'numeric' })}</span>
                    <span className="dot" style={{ background: posColor(n.pos, theme) }} />
                    <span className="week-text">
                      <span className="week-title">
                        <span {...textProps(n.word, n.language)}>{n.word}</span> <em className="pos">{n.pos}</em>
                      </span>
                      <span className="week-summary">{n.definition}</span>
                    </span>
                  </button>
                </li>
              ) : (
                <li key={n.id}>
                  <button type="button" className={`week-row ${selectedNote === n.id ? 'selected' : ''}`} onClick={() => onOpenNote(n.id)}>
                    <span className="week-day">{fmt(n.created, { weekday: 'short', day: 'numeric' })}</span>
                    <span className="dot" style={{ background: inkColor(index.domainBySlug.get(n.domains[0])?.color, theme) }} />
                    <span className="week-text">
                      <span className="week-title">{n.title}</span>
                      {n.summary && <span className="week-summary">{plain(n.summary)}</span>}
                    </span>
                  </button>
                </li>
              ),
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
