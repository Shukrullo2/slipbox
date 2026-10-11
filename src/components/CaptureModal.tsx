import { useState } from 'react';
import { NoteForm, draftToInput, emptyDraft, type Draft } from './NoteForm';
import type { VaultIndex } from '../vault';
import type { NoteInput } from '../types';
import type { Theme } from '../palette';

interface Props {
  initial: Partial<Draft>;
  index: VaultIndex;
  theme: Theme;
  onClose: () => void;
  onCreate: (input: NoteInput) => Promise<void>;
}

export function CaptureModal({ initial, index, theme, onClose, onCreate }: Props) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!draft.title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(draftToInput(draft));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const cancel = () => {
    const dirty = JSON.stringify(draft) !== JSON.stringify(emptyDraft(initial));
    if (dirty && !confirm('Discard this note?')) return;
    onClose();
  };

  return (
    <div className="overlay" onMouseDown={cancel}>
      <div className="capture card" role="dialog" aria-label="New note" onMouseDown={(e) => e.stopPropagation()}>
        <NoteForm
          draft={draft}
          onChange={setDraft}
          onSubmit={submit}
          onCancel={cancel}
          index={index}
          theme={theme}
          submitLabel="Save note"
          busy={busy}
          error={error}
          autoFocus={initial.title ? 'body' : 'title'}
        />
      </div>
    </div>
  );
}
