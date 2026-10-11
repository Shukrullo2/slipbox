import type { Domain, DomainInput, Grade, Note, NoteInput, NoteSuggestion, VaultData, WordInput, WordSuggestion } from './types';

/** The server wants a key (no session, or it expired). */
export class LockedError extends Error {}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/api/session')) throw new LockedError(data.error ?? 'Locked');
  if (!res.ok) throw new Error(data.error ?? `Request failed with status ${res.status}`);
  return data as T;
}

const q = (id: string) => `?id=${encodeURIComponent(id)}`;

export interface SessionInfo {
  required: boolean;
  authenticated: boolean;
  method: 'telegram' | 'key';
  telegramBot: string | null;
  user: { id: string; username?: string; name: string } | null;
}

/** What Telegram's Login Widget hands to its callback. */
export type TelegramUser = Record<string, string | number>;

export const api = {
  session: () => request<SessionInfo>('GET', '/api/session'),
  signInWithTelegram: (user: TelegramUser) => request<{ ok: true }>('POST', '/api/session/telegram', user),
  unlock: (key: string) => request<{ ok: true }>('POST', '/api/session', { key }),
  lock: () => request<{ ok: true }>('DELETE', '/api/session'),
  vault: () => request<VaultData>('GET', '/api/vault'),
  createNote: (input: NoteInput) => request<Note>('POST', '/api/notes', input),
  updateNote: (id: string, input: NoteInput) => request<Note>('PUT', `/api/notes${q(id)}`, input),
  trashNote: (id: string) => request<{ trashedTo: string }>('DELETE', `/api/notes${q(id)}`),
  review: (id: string, grade: Grade) => request<Note>('POST', `/api/review${q(id)}`, { grade }),
  createWord: (input: WordInput) => request<{ id: string; word: string; url: string }>('POST', '/api/words', input),
  updateWord: (id: string, input: WordInput) => request<{ id: string; word: string; url: string }>('PUT', `/api/words${q(id)}`, input),
  trashWord: (id: string) => request<{ trashedTo: string }>('DELETE', `/api/words${q(id)}`),
  aiWord: (input: WordInput & { targets?: string[] }) => request<WordSuggestion>('POST', '/api/ai/word', input),
  aiNote: (input: NoteInput) => request<NoteSuggestion>('POST', '/api/ai/note', input),
  harakat: (texts: string[]) => request<{ texts: string[]; rejected: number }>('POST', '/api/ai/harakat', { texts }),
  harakatDictionary: () => request<{ words: number; strings: number; rejected: number }>('POST', '/api/ai/harakat/dictionary', {}),
  saveDomain: (slug: string, input: DomainInput) =>
    request<Domain>('PUT', `/api/domains/${encodeURIComponent(slug)}`, input),
};
