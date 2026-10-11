import { Icon } from './Icon';
import type { VaultIndex } from '../vault';
import { NEW_PER_SESSION } from '../vault';
import type { Domain } from '../types';
import type { View } from '../router';
import { inkColor, type Theme } from '../palette';
import type { ThemePref } from '../theme';

interface Props {
  index: VaultIndex;
  theme: Theme;
  themePref: ThemePref;
  view: View;
  selectedDomain?: string;
  selectedField?: string;
  onView: (v: View) => void;
  onOpenDomain: (slug: string) => void;
  onOpenField: (slug: string | undefined) => void;
  onSearch: () => void;
  onCapture: () => void;
  onCaptureWord: () => void;
  onCycleTheme: () => void;
}

export function Sidebar({ index, theme, themePref, view, selectedDomain, selectedField, onView, onOpenDomain, onOpenField, onSearch, onCapture, onCaptureWord, onCycleTheme }: Props) {
  const toReview = index.due.length + Math.min(index.fresh.length, NEW_PER_SESSION);
  const dictionary = view === 'dictionary';

  const renderDomain = (d: Domain, depth: number, seen: Set<string>) => {
    if (seen.has(d.slug)) return null;
    const next = new Set(seen).add(d.slug);
    const count = index.notesByDomain.get(d.slug)?.length ?? 0;
    const children = index.childDomains.get(d.slug) ?? [];
    return (
      <li key={d.slug}>
        <button
          type="button"
          className={`domain-row ${selectedDomain === d.slug ? 'active' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => onOpenDomain(d.slug)}
          aria-current={selectedDomain === d.slug ? 'true' : undefined}
        >
          <span className="seal small" style={{ background: inkColor(d.color, theme) }} />
          <span className="domain-name">{d.name}</span>
          <span className="count">{count}</span>
        </button>
        {children.length > 0 && <ul>{children.map((c) => renderDomain(c, depth + 1, next))}</ul>}
      </li>
    );
  };

  const fields = [...index.fieldCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const nav: { v: View; label: string; icon: string; key: string }[] = [
    { v: 'graph', label: 'Graph', icon: 'graph', key: 'G' },
    { v: 'dictionary', label: 'Dictionary', icon: 'book', key: 'D' },
    { v: 'review', label: 'Review', icon: 'review', key: 'R' },
    { v: 'timeline', label: 'Timeline', icon: 'timeline', key: 'T' },
  ];

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
          <rect x="3" y="6" width="26" height="20" rx="2" fill="var(--surface)" stroke="var(--ink)" strokeWidth="1.5" />
          <path d="M3 11.5h26" stroke="var(--red)" strokeWidth="1.5" />
          <path d="M6 16h20M6 20h20" stroke="var(--rule-blue)" strokeWidth="1" />
          <circle cx="22" cy="18" r="3" fill={inkColor('prussian', theme)} />
        </svg>
        <span>Slipbox</span>
      </div>

      <button type="button" className="search-trigger" onClick={onSearch}>
        <Icon name="search" size={16} />
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>

      <ul className="nav">
        {nav.map((item) => (
          <li key={item.v}>
            <button type="button" className={view === item.v ? 'active' : ''} aria-current={view === item.v ? 'page' : undefined} onClick={() => onView(item.v)} title={`${item.label} (${item.key})`}>
              <Icon name={item.icon} />
              <span className="nav-label">{item.label}</span>
              {item.v === 'review' && toReview > 0 && (
                <span className="badge" aria-label={`${toReview} to review`}>
                  {toReview}
                </span>
              )}
              {item.v === 'dictionary' && index.words.length > 0 && <span className="count">{index.words.length}</span>}
            </button>
          </li>
        ))}
      </ul>

      {dictionary ? (
        <div className="domains">
          <h2 className="side-heading">Fields</h2>
          {fields.length ? (
            <ul className="domain-tree">
              <li>
                <button type="button" className={`domain-row ${!selectedField ? 'active' : ''}`} onClick={() => onOpenField(undefined)}>
                  <span className="domain-name">All words</span>
                  <span className="count">{index.words.length}</span>
                </button>
              </li>
              {fields.map(([f, n]) => (
                <li key={f}>
                  <button type="button" className={`domain-row ${selectedField === f ? 'active' : ''}`} onClick={() => onOpenField(f)} aria-current={selectedField === f ? 'true' : undefined}>
                    <span className="domain-name">{f}</span>
                    <span className="count">{n}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Give words a field (statistics, legal, Uzbek…) to group them here.</p>
          )}
        </div>
      ) : (
        <div className="domains">
          <h2 className="side-heading">Domains</h2>
          {index.rootDomains.length ? (
            <ul className="domain-tree">{index.rootDomains.map((d) => renderDomain(d, 0, new Set()))}</ul>
          ) : (
            <p className="muted small">Domains appear when you file your first note.</p>
          )}
        </div>
      )}

      <div className="side-foot">
        {dictionary ? (
          <button type="button" className="btn btn-primary capture-btn" onClick={onCaptureWord} title="New word (W)">
            <Icon name="plus" size={16} />
            <span>New word</span>
            <kbd>W</kbd>
          </button>
        ) : (
          <button type="button" className="btn btn-primary capture-btn" onClick={onCapture} title="New note (N)">
            <Icon name="plus" size={16} />
            <span>New note</span>
            <kbd>N</kbd>
          </button>
        )}
        <button type="button" className="icon-btn" onClick={onCycleTheme} title={`Theme: ${themePref === 'system' ? 'follows your system' : themePref}. Click to change.`}>
          <Icon name={themePref === 'system' ? 'auto' : themePref === 'dark' ? 'moon' : 'sun'} title="Change theme" />
        </button>
      </div>
    </nav>
  );
}
