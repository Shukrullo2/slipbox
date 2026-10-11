import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { useVault } from './vault';
import { useRoute, type View } from './router';
import { useTheme } from './theme';
import type { DomainInput, Grade, Note, NoteInput, Reviewable, Word, WordInput } from './types';
import type { Draft } from './components/NoteForm';
import type { WordDraft } from './components/WordForm';
import { Sidebar } from './components/Sidebar';
import { GraphView } from './components/GraphView';
import { DictionaryView } from './components/DictionaryView';
import { NotePanel } from './components/NotePanel';
import { DomainPanel } from './components/DomainPanel';
import { WordPanel } from './components/WordPanel';
import { ReviewView } from './components/ReviewView';
import { TimelineView } from './components/TimelineView';
import { CommandPalette, type Command } from './components/CommandPalette';
import { CaptureModal } from './components/CaptureModal';
import { WordModal } from './components/WordForm';
import { Toasts, type Toast } from './components/Toasts';
import { SignInScreen } from './components/SignInScreen';

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || !!el.closest('input, textarea, select, .cm-editor'));

export default function App() {
  const { theme, pref, cycle } = useTheme();
  const { route, navigate } = useRoute();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [capture, setCapture] = useState<Partial<Draft> | null>(null);
  const [wordCapture, setWordCapture] = useState<Partial<WordDraft> | null>(null);
  const [editing, setEditing] = useState(false);
  const [editingWord, setEditingWord] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const toastId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (text: string, opts: Omit<Toast, 'id' | 'text'> = {}) => {
      const id = ++toastId.current;
      setToasts((ts) => [...ts.slice(-3), { id, text, ...opts }]);
      setTimeout(() => dismiss(id), opts.action ? 9000 : 4500);
    },
    [dismiss],
  );

  // Notes open over the graph or the timeline; words over the dictionary; from review, go to the graph.
  const noteView = (v: View): View => (v === 'timeline' ? 'timeline' : 'graph');
  const openNote = useCallback((id: string) => navigate({ view: noteView(route.view), note: id }), [navigate, route.view]);
  const openDomain = useCallback((slug: string) => navigate({ view: 'graph', domain: slug }), [navigate]);
  const openWord = useCallback(
    (id: string) => navigate({ view: 'dictionary', word: id, field: route.view === 'dictionary' ? route.field : undefined }),
    [navigate, route.view, route.field],
  );
  const setField = useCallback(
    (slug: string | undefined) => navigate({ view: 'dictionary', field: slug, word: route.view === 'dictionary' ? route.word : undefined }),
    [navigate, route.view, route.word],
  );
  const closePanel = useCallback(() => navigate({ view: route.view, field: route.field }), [navigate, route.view, route.field]);

  const openNoteRef = useRef(openNote);
  openNoteRef.current = openNote;
  const openWordRef = useRef(openWord);
  openWordRef.current = openWord;
  const onExternalItem = useCallback(
    (item: Reviewable) =>
      item.kind === 'word'
        ? toast(`New word: ${item.word}`, { action: { label: 'Open', run: () => openWordRef.current(item.id) } })
        : toast(`New note: ${item.title}`, { action: { label: 'Open', run: () => openNoteRef.current(item.id) } }),
    [toast],
  );
  const { index, error, locked, reload, markLocalChange, unlock, signInWithTelegram, lock, authRequired } = useVault(onExternalItem);

  useEffect(() => {
    setEditing(false);
    setEditingWord(false);
  }, [route.note, route.word]);

  const note = route.note ? index?.noteById.get(route.note) : undefined;
  const domain = !note && route.domain ? index?.domainBySlug.get(route.domain) : undefined;
  const word = route.word ? index?.wordById.get(route.word) : undefined;

  const startCapture = useCallback(
    (partial: Partial<Draft> = {}) => {
      const domains = route.domain ? [route.domain] : note ? [note.domains[0]] : [];
      setCapture({ domains, ...partial });
    },
    [route.domain, note],
  );
  const startWordCapture = useCallback(
    (partial: Partial<WordDraft> = {}) => setWordCapture({ fields: route.field ? [route.field] : [], ...partial }),
    [route.field],
  );

  // ----- mutations -----
  const createNote = async (input: NoteInput) => {
    markLocalChange();
    const created = await api.createNote(input);
    await reload();
    setCapture(null);
    navigate({ view: noteView(route.view), note: created.id });
  };

  const saveNote = async (id: string, input: NoteInput) => {
    markLocalChange();
    const saved = await api.updateNote(id, input);
    await reload();
    if (saved.id !== id) navigate({ view: route.view, note: saved.id }, { replace: true });
  };

  const trashNote = async (n: Note) => {
    if (!confirm(`Move “${n.title}” to the trash?\n\nThe file moves to vault/.trash, so you can restore it from there.`)) return;
    try {
      markLocalChange();
      await api.trashNote(n.id);
      closePanel();
      await reload();
      toast(`Moved “${n.title}” to the trash`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: 'error' });
    }
  };

  const createWord = async (input: WordInput) => {
    markLocalChange();
    const created = await api.createWord(input);
    await reload();
    setWordCapture(null);
    navigate({ view: 'dictionary', word: created.id, field: route.view === 'dictionary' ? route.field : undefined });
  };

  const saveWord = async (id: string, input: WordInput) => {
    markLocalChange();
    const saved = await api.updateWord(id, input);
    await reload();
    setEditingWord(false);
    if (saved.id !== id) navigate({ view: 'dictionary', word: saved.id, field: route.field }, { replace: true });
  };

  const trashWord = async (w: Word) => {
    if (!confirm(`Remove “${w.word}” from the dictionary?\n\nThe file moves to vault/.trash, so you can restore it from there.`)) return;
    try {
      markLocalChange();
      await api.trashWord(w.id);
      closePanel();
      await reload();
      toast(`Removed “${w.word}” from the dictionary`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: 'error' });
    }
  };

  const vowelDictionary = async () => {
    toast('Adding harakat to the Arabic in your dictionary…');
    try {
      markLocalChange();
      const r = await api.harakatDictionary();
      await reload();
      if (!r.strings && !r.rejected) toast('All Arabic in the dictionary already has harakat.');
      else
        toast(
          `Added harakat in ${r.words} entr${r.words === 1 ? 'y' : 'ies'}.` +
            (r.rejected ? ` ${r.rejected} piece${r.rejected === 1 ? '' : 's'} came back with different letters and ${r.rejected === 1 ? 'was' : 'were'} left as written.` : ''),
        );
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: 'error' });
    }
  };

  const gradeNote = async (id: string, grade: Grade) => {
    try {
      markLocalChange();
      await api.review(id, grade);
      await reload();
    } catch (e) {
      toast(`Couldn't save that review: ${e instanceof Error ? e.message : e}`, { tone: 'error' });
    }
  };

  const saveDomain = async (slug: string, input: DomainInput) => {
    markLocalChange();
    await api.saveDomain(slug, input);
    await reload();
  };

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || paletteOpen || capture || wordCapture || editing || editingWord) return;
      const key = e.key.toLowerCase();
      if (key === 'n') {
        e.preventDefault();
        startCapture();
      } else if (key === 'w') {
        e.preventDefault();
        startWordCapture();
      } else if (key === '/') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (key === 'g') navigate({ view: 'graph', note: route.note, domain: route.domain });
      else if (key === 'd') navigate({ view: 'dictionary', word: route.word, field: route.field });
      else if (key === 'r') navigate({ view: 'review' });
      else if (key === 't') navigate({ view: 'timeline', note: route.note });
      else if (key === 'e' && route.view === 'dictionary' && word) {
        e.preventDefault();
        setEditingWord(true);
      } else if (key === 'e' && note) {
        e.preventDefault();
        setEditing(true);
      } else if (key === 'escape' && (route.note || route.domain || route.word)) closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, capture, wordCapture, editing, editingWord, note, word, route, navigate, closePanel, startCapture, startWordCapture]);

  const aiEnabled = !!index?.ai.enabled;
  const commands: Command[] = useMemo(
    () => [
      { id: 'new', label: 'New note', hint: 'N', icon: 'plus', run: () => startCapture() },
      { id: 'new-word', label: 'New word in the dictionary', hint: 'W', icon: 'book', run: () => startWordCapture() },
      { id: 'review', label: 'Start review', hint: 'R', icon: 'review', run: () => navigate({ view: 'review' }) },
      { id: 'graph', label: 'Go to graph', hint: 'G', icon: 'graph', run: () => navigate({ view: 'graph' }) },
      { id: 'dictionary', label: 'Go to dictionary', hint: 'D', icon: 'book', run: () => navigate({ view: 'dictionary' }) },
      { id: 'timeline', label: 'Go to timeline', hint: 'T', icon: 'timeline', run: () => navigate({ view: 'timeline' }) },
      { id: 'theme', label: 'Change theme', icon: theme === 'dark' ? 'sun' : 'moon', run: cycle },
      ...(aiEnabled ? [{ id: 'harakat', label: 'Add harakat to Arabic in the dictionary', icon: 'sparkle', run: () => void vowelDictionary() }] : []),
      ...(authRequired ? [{ id: 'lock', label: 'Sign out on this device', icon: 'lock', run: () => void lock() }] : []),
    ],
    [startCapture, startWordCapture, navigate, theme, cycle, authRequired, lock, aiEnabled], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (locked) return <SignInScreen onTelegram={signInWithTelegram} onKey={unlock} />;

  if (!index) {
    return (
      <div className="boot">
        {error ? (
          <div className="boot-error">
            <h1>Can't reach the Slipbox server</h1>
            <p>
              Start it from the project folder with <code>npm run dev</code>, then reload this page.
            </p>
            <p className="muted small">{error}</p>
          </div>
        ) : (
          <p className="muted">Opening your vault…</p>
        )}
      </div>
    );
  }

  const panelOpen = route.view === 'dictionary' ? !!word : route.view !== 'review' && !!(note || domain);

  return (
    <div className={`app ${panelOpen ? 'has-panel' : ''}`}>
      <Sidebar
        index={index}
        theme={theme}
        themePref={pref}
        view={route.view}
        selectedDomain={domain?.slug}
        selectedField={route.field}
        onView={(v) =>
          navigate({
            view: v,
            note: v === 'review' || v === 'dictionary' ? undefined : route.note,
            domain: v === 'graph' ? route.domain : undefined,
            word: v === 'dictionary' ? route.word : undefined,
            field: v === 'dictionary' ? route.field : undefined,
          })
        }
        onOpenDomain={openDomain}
        onOpenField={setField}
        onSearch={() => setPaletteOpen(true)}
        onCapture={() => startCapture()}
        onCaptureWord={() => startWordCapture()}
        onCycleTheme={cycle}
      />

      <main className={`stage view-${route.view}`}>
        {route.view === 'graph' && (
          <GraphView
            index={index}
            theme={theme}
            selectedNote={note?.id}
            selectedDomain={domain?.slug}
            panelOpen={panelOpen}
            onOpenNote={openNote}
            onOpenDomain={openDomain}
            onBackground={closePanel}
          />
        )}
        {route.view === 'dictionary' && (
          <DictionaryView
            index={index}
            theme={theme}
            selectedWord={word?.id}
            field={route.field}
            onOpenWord={openWord}
            onSetField={setField}
            onNewWord={() => startWordCapture()}
            onBackground={closePanel}
          />
        )}
        {route.view === 'timeline' && <TimelineView index={index} theme={theme} selectedNote={note?.id} onOpenNote={openNote} onOpenWord={openWord} />}
        {route.view === 'review' && (
          <ReviewView
            index={index}
            theme={theme}
            onGrade={gradeNote}
            onOpenNote={(id) => navigate({ view: 'graph', note: id })}
            onOpenWord={(id) => navigate({ view: 'dictionary', word: id })}
            onCreateFromLink={(title) => startCapture({ title })}
            onDone={() => navigate({ view: 'graph' })}
          />
        )}

        {panelOpen && note && route.view !== 'dictionary' && (
          <NotePanel
            key={note.id}
            note={note}
            index={index}
            theme={theme}
            editing={editing}
            expanded={expanded}
            onEdit={setEditing}
            onToggleExpand={() => setExpanded((x) => !x)}
            onSave={(input) => saveNote(note.id, input)}
            onTrash={() => trashNote(note)}
            onClose={closePanel}
            onOpenNote={openNote}
            onOpenDomain={openDomain}
            onCreateFromLink={(title) => startCapture({ title })}
          />
        )}
        {panelOpen && domain && route.view !== 'dictionary' && (
          <DomainPanel
            domain={domain}
            index={index}
            theme={theme}
            onClose={closePanel}
            onOpenNote={openNote}
            onOpenDomain={openDomain}
            onNewNote={(slug) => startCapture({ domains: [slug] })}
            onSave={(input) => saveDomain(domain.slug, input)}
          />
        )}
        {panelOpen && word && route.view === 'dictionary' && (
          <WordPanel
            key={word.id}
            word={word}
            index={index}
            theme={theme}
            onEdit={() => setEditingWord(true)}
            onTrash={() => trashWord(word)}
            onClose={closePanel}
            onOpenWord={openWord}
            onOpenNote={(id) => navigate({ view: 'graph', note: id })}
            onCreateWord={(prefill) => startWordCapture(prefill)}
            onSetField={setField}
          />
        )}

        {error && (
          <div className="offline" role="alert">
            Lost the connection to the Slipbox server. Changes won't save until it's running again.
          </div>
        )}
      </main>

      {paletteOpen && (
        <CommandPalette
          index={index}
          theme={theme}
          commands={commands}
          onClose={() => setPaletteOpen(false)}
          onOpenNote={openNote}
          onOpenDomain={openDomain}
          onOpenWord={openWord}
          onCreate={(title) => startCapture({ title })}
        />
      )}
      {capture && <CaptureModal initial={capture} index={index} theme={theme} onClose={() => setCapture(null)} onCreate={createNote} />}
      {wordCapture && <WordModal initial={wordCapture} index={index} theme={theme} onClose={() => setWordCapture(null)} onSubmit={createWord} />}
      {editingWord && word && <WordModal initial={{}} editing={word} index={index} theme={theme} onClose={() => setEditingWord(false)} onSubmit={(input) => saveWord(word.id, input)} />}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
