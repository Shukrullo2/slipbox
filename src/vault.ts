import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MiniSearch from 'minisearch';
import { LockedError, api, type TelegramUser } from './api';
import type { Domain, Language, Note, Reviewable, VaultData, Word } from './types';
import { DEFAULT_TARGETS, LANGUAGES, foldText } from '../shared/languages.js';
import { linkGraph, makeResolver } from '../shared/links.js';
import { NEW_PER_SESSION, isDue as isDueOn, isNew as isNewOn } from '../shared/srs.js';

export { NEW_PER_SESSION };

export type RelationKind = 'synonym' | 'antonym' | 'related' | 'root';
export interface WordRelation {
  text: string;
  word?: Word;
}
export interface WordEdge {
  source: string;
  target: string;
  kind: RelationKind;
}

/** Which face a word's review card shows first; alternates with every review. */
export const wordSide = (w: Word): 'meaning' | 'word' => (((w.review && w.review.count) || 0) % 2 === 0 ? 'meaning' : 'word');

export interface VaultIndex {
  today: string;
  root: string;
  notes: Note[];
  noteById: Map<string, Note>;
  domains: Domain[];
  domainBySlug: Map<string, Domain>;
  rootDomains: Domain[];
  childDomains: Map<string, Domain[]>;
  notesByDomain: Map<string, Note[]>;
  outLinks: Map<string, string[]>;
  backLinks: Map<string, string[]>;
  /** Link targets that match neither a note nor a dictionary word. */
  unresolved: Map<string, string[]>;
  /** Dictionary words each note links to with [[word]]. */
  wordsLinkedFrom: Map<string, Word[]>;
  reviews: Record<string, number>;
  resolve: (target: string) => Note | undefined;
  /** Notes first, then dictionary words, so [[idempotent]] in a note opens the entry. */
  resolveLink: (target: string) => Note | Word | undefined;
  isDue: (item: Reviewable) => boolean;
  isNew: (item: Reviewable) => boolean;
  due: Reviewable[];
  fresh: Reviewable[];
  reviewable: Map<string, Reviewable>;
  search: MiniSearch<Note>;
  // dictionary
  words: Word[];
  wordById: Map<string, Word>;
  wordByText: Map<string, Word>;
  wordRelations: Map<string, Record<'synonyms' | 'antonyms' | 'related', WordRelation[]>>;
  wordEdges: WordEdge[];
  fieldCounts: Map<string, number>;
  languageCounts: Map<string, number>;
  /** Languages the app knows, and the ones to translate into. */
  languages: { known: Language[]; byCode: Map<string, Language>; targets: string[] };
  ai: { enabled: boolean; provider: string | null; model: string | null };
  wordSearch: MiniSearch<Word>;
  /** Notes whose title, summary or body use the word. */
  mentionsOf: (word: Word) => Note[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeRoot = (root: string) =>
  root
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}+ ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function buildIndex(data: VaultData): VaultIndex {
  const { notes, domains, today } = data;
  const words = [...(data.words ?? [])].sort((a, b) => a.word.localeCompare(b.word, undefined, { sensitivity: 'base' }));
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const { resolve, out: outLinks, back: backLinks, unresolved: unresolvedAll } = linkGraph(notes);

  const domainBySlug = new Map(domains.map((d) => [d.slug, d]));
  const childDomains = new Map<string, Domain[]>();
  const rootDomains: Domain[] = [];
  for (const d of [...domains].sort((a, b) => a.name.localeCompare(b.name))) {
    if (d.parent && domainBySlug.has(d.parent) && d.parent !== d.slug) {
      childDomains.set(d.parent, [...(childDomains.get(d.parent) ?? []), d]);
    } else rootDomains.push(d);
  }

  const notesByDomain = new Map<string, Note[]>();
  for (const n of notes) for (const s of n.domains) notesByDomain.set(s, [...(notesByDomain.get(s) ?? []), n]);
  for (const list of notesByDomain.values()) list.sort((a, b) => b.created.localeCompare(a.created));

  // ----- dictionary -----
  const wordById = new Map(words.map((w) => [w.id, w]));
  const wordByText = new Map<string, Word>();
  // Keyed without case or Arabic vowel marks, so «مفهوم» finds «مَفْهُوم».
  for (const w of words) if (!wordByText.has(foldText(w.word))) wordByText.set(foldText(w.word), w);
  const wordRelations = new Map<string, Record<'synonyms' | 'antonyms' | 'related', WordRelation[]>>();
  const wordEdges: WordEdge[] = [];
  const seenEdge = new Set<string>();
  const addEdge = (a: string, b: string, kind: RelationKind) => {
    if (a === b) return;
    const key = `${kind}:${[a, b].sort().join('\0')}`;
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    wordEdges.push({ source: a, target: b, kind });
  };
  for (const w of words) {
    const rel = (list: string[]) => list.map((text) => ({ text, word: wordByText.get(foldText(text)) }));
    const r = { synonyms: rel(w.synonyms), antonyms: rel(w.antonyms), related: rel(w.related) };
    wordRelations.set(w.id, r);
    for (const x of r.synonyms) if (x.word) addEdge(w.id, x.word.id, 'synonym');
    for (const x of r.antonyms) if (x.word) addEdge(w.id, x.word.id, 'antonym');
    for (const x of r.related) if (x.word) addEdge(w.id, x.word.id, 'related');
  }
  // Words that share a root form a family; chain them so the family reads as one thread.
  const families = new Map<string, Word[]>();
  for (const w of words) {
    const key = w.root ? normalizeRoot(w.root) : '';
    if (key) families.set(key, [...(families.get(key) ?? []), w]);
  }
  for (const family of families.values()) for (let i = 1; i < family.length; i++) addEdge(family[i - 1].id, family[i].id, 'root');

  const fieldCounts = new Map<string, number>();
  for (const w of words) for (const f of w.fields) fieldCounts.set(f, (fieldCounts.get(f) ?? 0) + 1);
  const languageCounts = new Map<string, number>();
  for (const w of words) languageCounts.set(w.language, (languageCounts.get(w.language) ?? 0) + 1);
  const known: Language[] = data.languages?.known ?? (LANGUAGES as Language[]);
  const languages = { known, byCode: new Map(known.map((l) => [l.code, l])), targets: data.languages?.targets ?? DEFAULT_TARGETS };
  const ai = data.ai ?? { enabled: false, provider: null, model: null };

  const wordSearch = new MiniSearch<Word>({
    fields: ['word', 'definition', 'example', 'translation', 'relations', 'fields', 'body'],
    extractField: (doc, field) => {
      if (field === 'relations') return [...doc.synonyms, ...doc.antonyms, ...doc.related].join(' ');
      if (field === 'fields') return doc.fields.join(' ');
      if (field === 'translation') return Object.values(doc.translations).join(' ');
      return (doc as unknown as Record<string, string>)[field] ?? '';
    },
    processTerm: (term) => foldText(term),
    searchOptions: { boost: { word: 5, relations: 2, definition: 1.5, translation: 1.5 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
  });
  wordSearch.addAll(words);

  const wordLinks = makeResolver(words.map((w) => ({ id: w.id, basename: w.basename, title: w.word, aliases: [] as string[], w })));
  const resolveLink = (target: string) => resolve(target) ?? wordLinks(target)?.w;

  // A [[link]] to a dictionary word is resolved, not missing.
  const unresolved = new Map<string, string[]>();
  const wordsLinkedFrom = new Map<string, Word[]>();
  for (const [id, targets] of unresolvedAll) {
    const missing: string[] = [];
    const linked: Word[] = [];
    for (const t of targets) {
      const w = wordLinks(t)?.w;
      if (w) {
        if (!linked.includes(w)) linked.push(w);
      } else missing.push(t);
    }
    unresolved.set(id, missing);
    if (linked.length) wordsLinkedFrom.set(id, linked);
  }

  const mentionCache = new Map<string, Note[]>();
  const mentionsOf = (word: Word) => {
    const hit = mentionCache.get(word.id);
    if (hit) return hit;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word.word)}(?=$|[^\\p{L}\\p{N}])`, 'iu');
    const found = notes
      .filter((n) => re.test(n.title) || re.test(n.summary ?? '') || re.test(n.body))
      .sort((a, b) => b.created.localeCompare(a.created));
    mentionCache.set(word.id, found);
    return found;
  };

  // ----- review -----
  const isDue = (n: Reviewable) => isDueOn(n, today);
  const isNew = (n: Reviewable) => isNewOn(n, today);
  const all: Reviewable[] = [...notes, ...words];
  const due = all.filter(isDue).sort((a, b) => ((a.review || {}).due ?? '').localeCompare((b.review || {}).due ?? ''));
  const fresh = all.filter(isNew).sort((a, b) => a.created.localeCompare(b.created));
  const reviewable = new Map(all.map((x) => [x.id, x]));

  const search = new MiniSearch<Note>({
    fields: ['title', 'aliases', 'tags', 'summary', 'question', 'body', 'domainNames'],
    processTerm: (term) => foldText(term),
    extractField: (doc, field) => {
      if (field === 'tags' || field === 'aliases') return doc[field].join(' ');
      if (field === 'domainNames') return doc.domains.map((s) => domainBySlug.get(s)?.name ?? s).join(' ');
      return (doc as unknown as Record<string, string>)[field] ?? '';
    },
    searchOptions: {
      boost: { title: 4, aliases: 3, tags: 2, summary: 1.5, question: 1.2, domainNames: 1.5 },
      prefix: true,
      fuzzy: 0.2,
      combineWith: 'AND',
    },
  });
  search.addAll(notes);

  return {
    today,
    root: data.root,
    notes,
    noteById,
    domains,
    domainBySlug,
    rootDomains,
    childDomains,
    notesByDomain,
    outLinks,
    backLinks,
    unresolved,
    wordsLinkedFrom,
    reviews: data.reviews,
    resolve,
    resolveLink,
    isDue,
    isNew,
    due,
    fresh,
    reviewable,
    search,
    words,
    wordById,
    wordByText,
    wordRelations,
    wordEdges,
    fieldCounts,
    languageCounts,
    languages,
    ai,
    wordSearch,
    mentionsOf,
  };
}

/**
 * Loads the vault and keeps it fresh: the server pushes a `change` event
 * whenever a file in the vault changes (from this app, Claude, or any editor).
 */
export function useVault(onExternalItem?: (item: Reviewable) => void) {
  const [data, setData] = useState<VaultData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const localUntil = useRef(0);
  const onExternal = useRef(onExternalItem);
  onExternal.current = onExternalItem;

  const reload = useCallback(async () => {
    try {
      const next = await api.vault();
      const items: Reviewable[] = [...next.notes, ...(next.words ?? [])];
      if (known.current && Date.now() > localUntil.current) {
        for (const n of items) if (!known.current.has(n.id)) onExternal.current?.(n);
      }
      known.current = new Set(items.map((n) => n.id));
      setData(next);
      setError(null);
      setLocked(false);
    } catch (e) {
      if (e instanceof LockedError) setLocked(true);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Live updates. Paused while locked, since the stream needs a session too.
  useEffect(() => {
    if (locked) return;
    let events: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = () => {
      events = new EventSource('/api/events');
      events.addEventListener('change', () => reload());
      events.onopen = () => reload();
      events.onerror = () => {
        // The browser gives up after an HTTP error (server down, or session gone); check and retry.
        if (events?.readyState === EventSource.CLOSED && !stopped) {
          reload();
          retry = setTimeout(connect, 3000);
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      events?.close();
    };
  }, [reload, locked]);

  /** Call before this app writes to the vault, so its own changes aren't announced as arrivals. */
  const markLocalChange = useCallback(() => {
    localUntil.current = Date.now() + 2000;
  }, []);

  const unlock = useCallback(
    async (key: string) => {
      await api.unlock(key);
      await reload();
    },
    [reload],
  );

  const signInWithTelegram = useCallback(
    async (user: TelegramUser) => {
      await api.signInWithTelegram(user);
      await reload();
    },
    [reload],
  );

  const lock = useCallback(async () => {
    await api.lock();
    known.current = null;
    setData(null);
    setLocked(true);
  }, []);

  const index = useMemo(() => (data ? buildIndex(data) : null), [data]);
  return { index, error, locked, reload, markLocalChange, unlock, signInWithTelegram, lock, authRequired: !!data?.authRequired };
}
