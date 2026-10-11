// A remote MCP server so Claude (web, desktop, mobile) can search and add
// notes as a custom connector. Stateless: each POST gets a fresh server.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { GRADES, formatInterval } from '../shared/srs.js';
import { LIMITS, PARTS_OF_SPEECH, wordSide } from './vault.js';
import { LANGUAGE_CODES } from '../shared/languages.js';

const INSTRUCTIONS = `Slipbox is the user's personal knowledge graph of things they learned while working, mostly with AI tools.
Each note is one atomic idea filed under one or more domains (SQL, Python, ...) and comes back in spaced-repetition review.

When asked to save or remember what was learned:
1. Pick 1 to 5 ideas a strong practitioner in the user's role would be expected to know: techniques, commands, gotchas and why they bite, debugging moves, design trade-offs. Skip project-specific trivia and things the user plainly already knew.
2. Call list_domains, and search_notes for each idea. If the idea already exists, use append_to_note with the new angle instead of creating a duplicate.
3. create_note for each new idea:
   - title: the idea as a plain sentence under 80 characters ("NOT IN returns no rows when the subquery contains NULL").
   - domains: existing domain slugs where they fit; a new lowercase slug only for a genuinely new field.
   - question: a recall question that tests understanding ("Why does X happen and what's the fix?"), answerable from the note.
   - summary: the takeaway in one sentence.
   - body: Markdown. 2-5 plain sentences on what and why, then "## Example" with a minimal fenced code block, then "## Why it matters". Link related notes with [[Exact Title]]. Under about 250 words. Written for the user months from now, with no "we" or "in this chat".
   - source: where it came from, e.g. "Claude chat: debugging a slow report".
4. Reply with a short list of titles and whether each was new or an update.

The dictionary holds words and terms (jargon, vocabulary from any language) the user wants to keep. When they ask to add, define, or look up a word, or say "add X to my dictionary":
1. search_words for it first; if it exists, update_word with what's new.
2. add_word with: the word; language (the language the word is in); pos; a plain-language definition in one or two sentences in that language (not a copy from a dictionary); one example sentence from the user's own context when possible; translations into the user's languages (call get_translation_targets, or default to en, uz, ru, ar) as {"code": "text"}; synonyms and antonyms only in the same sense; related words worth seeing together; root (origin or word family) when it helps memory; fields = topic slugs. Write all Arabic with full harakat (tashkil); single words in pausal form.
3. Reply with the word and its definition in one line each.

When asked to review, quiz, or test what the user knows:
1. Call review_queue. Go through the notes one at a time.
2. For a note, ask its question (or, if it has none, ask them to explain the title's idea). For a word with side "meaning", give the word and ask what it means; with side "word", give the definition and ask which word it is. Don't reveal the answer yet.
3. After they answer, show the key points from the note and say what they got right or missed.
4. Ask how it went, or judge it fairly yourself: again (forgot), hard, good, or easy. Call record_review with that grade.
5. When the queue is done, say how many were reviewed and when the next ones are due.`;

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e?.message ?? String(e) }] });

function buildServer({ vault, noteUrl, targets }) {
  const server = new McpServer({ name: 'slipbox', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const brief = (n) => ({ id: n.id, title: n.title, domains: n.domains, tags: n.tags, summary: n.summary, created: n.created, url: noteUrl(n.id) });

  server.registerTool(
    'list_domains',
    {
      title: 'List domains',
      description: 'All knowledge domains (e.g. sql, python) with note counts. Call before creating notes so you reuse existing slugs.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const { notes, domains } = await vault.load();
        return text(
          domains.map((d) => ({
            slug: d.slug,
            name: d.name,
            parent: d.parent,
            notes: notes.filter((n) => n.domains.includes(d.slug)).length,
          })),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'search_notes',
    {
      title: 'Search notes',
      description: 'Find existing notes by keywords across titles, tags, summaries and bodies. Use it to avoid duplicates and to find notes to link.',
      inputSchema: {
        query: z.string().optional().describe('Keywords, e.g. "window function running total". Leave out to list newest first.'),
        domain: z.string().optional().describe('Only this domain slug'),
        tag: z.string().optional(),
        since: z.string().optional().describe('Captured on or after, YYYY-MM-DD'),
        until: z.string().optional().describe('Captured on or before, YYYY-MM-DD'),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, domain, tag, since, until, limit }) => {
      try {
        const { total, notes } = await vault.listNotes({ q: query ?? '', domain, tag, since, until, limit: limit ?? 10 });
        return text({ total, notes: notes.map(brief) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_note',
    {
      title: 'Read a note',
      description: 'The full Markdown of one note, by id (as returned by search_notes).',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      try {
        const n = await vault.noteDetail(id);
        return text({ ...brief(n), question: n.question, source: n.source, body: n.body, links: n.links, backlinks: n.backlinks, unresolved: n.unresolved });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'create_note',
    {
      title: 'Create a note',
      description: 'Save one new learning. Fails if a note with the same title exists; then use append_to_note.',
      inputSchema: {
        title: z.string().max(LIMITS.title).describe('The idea as a plain sentence, under 80 characters'),
        domains: z.array(z.string()).min(1).max(LIMITS.domains).describe('Domain slugs; the first one is primary'),
        tags: z.array(z.string()).max(LIMITS.tags).optional(),
        summary: z.string().max(LIMITS.field).optional().describe('The takeaway in one sentence'),
        question: z.string().max(LIMITS.field).optional().describe('Recall question used in review'),
        source: z.string().max(LIMITS.field).optional().describe('Where it was learned'),
        body: z.string().max(LIMITS.body).describe('Markdown body'),
      },
    },
    async (args) => {
      try {
        const note = await vault.createNote(args);
        return text({ created: brief(note) });
      } catch (e) {
        return fail(e.existingId ? new Error(`${e.message} Existing note id: ${e.existingId}`) : e);
      }
    },
  );

  server.registerTool(
    'append_to_note',
    {
      title: 'Add to a note',
      description: 'Append Markdown to an existing note, e.g. a new example or gotcha under a "## More" heading.',
      inputSchema: { id: z.string(), text: z.string().max(LIMITS.body) },
    },
    async ({ id, text: addition }) => {
      try {
        return text({ updated: brief(await vault.appendToNote(id, addition)) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'update_note',
    {
      title: 'Edit a note',
      description: 'Change only the fields given. Renaming rewrites every [[link]] to the note. Use add_tags/remove_tags to adjust tags.',
      inputSchema: {
        id: z.string(),
        title: z.string().max(LIMITS.title).optional(),
        domains: z.array(z.string()).min(1).max(LIMITS.domains).optional(),
        tags: z.array(z.string()).max(LIMITS.tags).optional().describe('Replaces all tags'),
        add_tags: z.array(z.string()).optional(),
        remove_tags: z.array(z.string()).optional(),
        summary: z.string().max(LIMITS.field).optional(),
        question: z.string().max(LIMITS.field).optional(),
        source: z.string().max(LIMITS.field).optional(),
        body: z.string().max(LIMITS.body).optional().describe('Replaces the whole body'),
      },
    },
    async ({ id, ...fields }) => {
      try {
        return text({ updated: brief(await vault.updateNote(id, fields)) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'related_notes',
    {
      title: 'Related notes',
      description: 'Notes that share tags, a domain or title words with this one and are not linked to it yet. Good candidates for [[links]].',
      inputSchema: { id: z.string(), limit: z.number().int().min(1).max(20).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ id, limit }) => {
      try {
        return text((await vault.relatedNotes(id, limit ?? 5)).map((n) => ({ ...brief(n), score: n.score })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'review_queue',
    {
      title: "Today's review queue",
      description: 'Notes and dictionary words due for spaced-repetition review, then new ones. Notes come with their question and body; words with their definition and which side to ask first. Use it to quiz the user.',
      inputSchema: { limit: z.number().int().min(1).max(50).optional(), new_notes: z.number().int().min(0).max(50).optional().describe('How many never-reviewed notes to include (default 10)') },
      annotations: { readOnlyHint: true },
    },
    async ({ limit, new_notes }) => {
      try {
        const q = await vault.reviewQueue({ limit: limit ?? 10, newLimit: new_notes ?? 10 });
        return text({
          today: q.today,
          due: q.due,
          new: q.new,
          items: q.items.map((n) =>
            n.kind === 'word'
              ? { kind: 'word', ...wordBrief(n), side: n.side, firstReview: !n.review || !n.review.due }
              : { kind: 'note', ...brief(n), question: n.question, body: n.body, firstReview: !n.review || !n.review.due },
          ),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'record_review',
    {
      title: 'Record a review',
      description: 'Save how well the user remembered a note or word; this schedules its next review. again = forgot, hard = got it with effort, good = remembered, easy = instant.',
      inputSchema: { id: z.string(), grade: z.enum(GRADES) },
    },
    async ({ id, grade }) => {
      try {
        const n = await vault.reviewNote(id, grade);
        return text({ id: n.id, title: n.title, nextReview: n.review.due, when: formatInterval(n.review.interval) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  const wordBrief = (w) => ({
    id: w.id,
    word: w.word,
    pos: w.pos,
    fields: w.fields,
    definition: w.definition,
    example: w.example,
    language: w.language,
    translations: w.translations,
    synonyms: w.synonyms,
    antonyms: w.antonyms,
    related: w.related,
    root: w.root,
    url: `${noteUrl('').split('#')[0]}#/dictionary?word=${encodeURIComponent(w.id)}`,
  });
  const relations = { synonyms: z.array(z.string()).max(LIMITS.relations).optional(), antonyms: z.array(z.string()).max(LIMITS.relations).optional(), related: z.array(z.string()).max(LIMITS.relations).optional().describe('See-also words') };
  const wordShape = {
    pos: z.enum(PARTS_OF_SPEECH).optional(),
    definition: z.string().max(LIMITS.field).optional().describe('Plain-language meaning, one or two sentences'),
    example: z.string().max(LIMITS.field).optional().describe('A sentence using the word, ideally from the user\'s context'),
    language: z.enum(LANGUAGE_CODES).optional().describe('Language the word is in (ISO code such as en, uz, ru, ar); default en'),
    translations: z.record(z.string(), z.string().max(LIMITS.field)).optional().describe('Translations keyed by language code, e.g. {"uz": "...", "ru": "...", "ar": "..."}; Arabic with full harakat'),
    pronunciation: z.string().max(LIMITS.field).optional(),
    ...relations,
    root: z.string().max(LIMITS.field).optional().describe('Origin or word family, when it helps memory'),
    fields: z.array(z.string()).max(LIMITS.domains).optional().describe('Topic slugs, e.g. statistics'),
    source: z.string().max(LIMITS.field).optional(),
    body: z.string().max(LIMITS.body).optional().describe('Optional longer notes in Markdown'),
  };

  server.registerTool(
    'search_words',
    {
      title: 'Search the dictionary',
      description: 'Find dictionary entries by keyword, field, part of speech, language or first letter. Leave everything out to list all words alphabetically.',
      inputSchema: {
        query: z.string().optional(),
        field: z.string().optional(),
        pos: z.enum(PARTS_OF_SPEECH).optional(),
        language: z.enum(LANGUAGE_CODES).optional(),
        letter: z.string().max(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, field, pos, language, letter, limit }) => {
      try {
        const { total, words } = await vault.listWords({ q: query ?? '', field, pos, language, letter, limit: limit ?? 20 });
        return text({ total, words: words.map(wordBrief) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_word',
    {
      title: 'Look up a word',
      description: 'One dictionary entry by word or id, with its relations resolved and the notes that use it.',
      inputSchema: { word: z.string().describe('The word itself, or its id') },
      annotations: { readOnlyHint: true },
    },
    async ({ word }) => {
      try {
        const w = (await vault.findWord(word)) ?? (await vault.readWord(word).catch(() => null));
        if (!w) return fail(new Error(`"${word}" is not in the dictionary.`));
        const d = await vault.wordDetail(w.id);
        return text({ ...wordBrief(d), synonyms: d.synonyms, antonyms: d.antonyms, related: d.related, body: d.body, side: wordSide(d), mentionedIn: d.mentionedIn });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'add_word',
    {
      title: 'Add a word to the dictionary',
      description: 'Save a word or term with its meaning. Fails if it already exists; then use update_word.',
      inputSchema: { word: z.string().max(LIMITS.word), ...wordShape, definition: z.string().max(LIMITS.field).describe('Plain-language meaning, one or two sentences') },
    },
    async (args) => {
      try {
        return text({ created: wordBrief(await vault.createWord(args)) });
      } catch (e) {
        return fail(e.existingId ? new Error(`${e.message} Existing id: ${e.existingId}`) : e);
      }
    },
  );

  server.registerTool(
    'update_word',
    {
      title: 'Edit a dictionary entry',
      description: 'Change only the fields given. Renaming the word updates every entry that lists it.',
      inputSchema: { id: z.string(), word: z.string().max(LIMITS.word).optional(), ...wordShape, add_fields: z.array(z.string()).optional(), remove_fields: z.array(z.string()).optional() },
    },
    async ({ id, ...fields }) => {
      try {
        return text({ updated: wordBrief(await vault.updateWord(id, fields)) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_translation_targets',
    { title: 'Translation languages', description: 'Which languages the user wants dictionary entries translated into.', inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => text({ targets: targets ?? [] }),
  );

  server.registerTool(
    'list_tags',
    { title: 'List tags', description: 'Tags in use, with note counts, most used first.', inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => {
      try {
        return text(await vault.tags());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'stats',
    {
      title: 'Learning stats',
      description: 'Totals, notes due today, review streak, recent capture and review activity, notes per domain.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return text(await vault.stats());
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

export function mountMcp(app, { vault, auth, noteUrl, targets }) {
  const handle = async (req, res) => {
    const server = buildServer({ vault, noteUrl, targets });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('MCP request failed', e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  };
  const notAllowed = (_req, res) =>
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });

  // Header auth for Claude Code and scripts; key-in-path for claude.ai connectors.
  app.post('/mcp', auth.require, handle);
  app.post('/mcp/:key', auth.checkPathKey, handle);
  app.all(['/mcp', '/mcp/:key'], notAllowed);
}
