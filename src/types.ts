export type Grade = 'again' | 'hard' | 'good' | 'easy';

export type ReviewState = { due?: string; interval?: number; ease?: number; count?: number } | false;

export type PartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb' | 'phrase' | 'abbreviation' | 'other';
export const PARTS_OF_SPEECH: PartOfSpeech[] = ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'abbreviation', 'other'];

/** A dictionary entry: a word or term, its meaning, and how it relates to other words. */
export interface Word {
  kind: 'word';
  id: string;
  path: string;
  basename: string;
  word: string;
  pos: PartOfSpeech;
  fields: string[];
  definition: string;
  example?: string;
  language: string;
  translations: Record<string, string>;
  pronunciation?: string;
  synonyms: string[];
  antonyms: string[];
  related: string[];
  root?: string;
  source?: string;
  created: string;
  updated: string;
  review: ReviewState;
  body: string;
  error?: string;
}

export interface WordInput {
  word?: string;
  pos?: PartOfSpeech;
  fields?: string[];
  definition?: string;
  example?: string;
  language?: string;
  translations?: Record<string, string>;
  pronunciation?: string;
  synonyms?: string[];
  antonyms?: string[];
  related?: string[];
  root?: string;
  source?: string;
  body?: string;
}

/** Anything that can be in the review queue. */
export type Reviewable = Note | Word;

export interface Note {
  kind: 'note';
  id: string;
  path: string;
  basename: string;
  title: string;
  domains: string[];
  tags: string[];
  aliases: string[];
  summary?: string;
  question?: string;
  source?: string;
  created: string;
  updated: string;
  review: ReviewState;
  body: string;
  error?: string;
}

export interface Domain {
  kind: 'domain';
  slug: string;
  path: string;
  name: string;
  color?: string;
  parent?: string;
  description: string;
}

export interface VaultData {
  notes: Note[];
  words: Word[];
  domains: Domain[];
  palette: string[];
  reviews: Record<string, number>;
  today: string;
  root: string;
  authRequired?: boolean;
  languages?: { known: Language[]; targets: string[] };
  ai?: { enabled: boolean; provider: string | null; model: string | null };
}

export interface Language {
  code: string;
  name: string;
  native: string;
  rtl?: boolean;
}

/** What "Fill in with AI" returns for a word. */
export interface WordSuggestion {
  word: string;
  language: string;
  pos: PartOfSpeech;
  definition: string;
  example: string;
  pronunciation: string;
  translations: Record<string, string>;
  synonyms: string[];
  antonyms: string[];
  related: string[];
  root: string;
  fields: string[];
}

/** What "Fill in with AI" returns for a note. */
export interface NoteSuggestion {
  title: string;
  summary: string;
  question: string;
  tags: string[];
  domains: string[];
  body: string;
}

export interface NoteInput {
  title?: string;
  domains?: string[];
  tags?: string[];
  summary?: string;
  question?: string;
  source?: string;
  body?: string;
}

export interface DomainInput {
  name?: string;
  color?: string;
  parent?: string;
  description?: string;
}
