// OpenAPI 3.1 description of the Slipbox API, served at /api/openapi.json.

const id = { name: 'id', in: 'query', required: true, description: 'Note id: its vault path without .md, e.g. "sql/Running totals with window functions"', schema: { type: 'string' } };
const slug = { name: 'slug', in: 'path', required: true, schema: { type: 'string' } };
const json = (schema) => ({ 'application/json': { schema } });
const ok = (description, schema = { type: 'object' }) => ({ description, content: json(schema) });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

export function openapiSpec(serverUrl) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Slipbox API',
      version: '1.4.0',
      description:
        'A personal knowledge graph of things learned while working, plus a dictionary of words and terms. Every request needs an API key, sent as `Authorization: Bearer <key>` or `X-API-Key: <key>`. Notes can be sent as JSON or as a whole Markdown file (`Content-Type: text/markdown`, YAML frontmatter + body).',
    },
    servers: [{ url: serverUrl }],
    security: [{ bearer: [] }, { apiKey: [] }],
    paths: {
      '/api/notes': {
        get: {
          summary: 'Search and filter notes, or fetch one note with ?id=',
          description: 'With `id`: the full note plus `links` and `backlinks` (notes), `words` (dictionary entries it links to) and `unresolved` link targets. Otherwise a page of brief notes.',
          parameters: [
            { ...id, required: false },
            { name: 'q', in: 'query', description: 'Keywords; ranks by relevance', schema: { type: 'string' } },
            { name: 'domain', in: 'query', schema: { type: 'string' } },
            { name: 'tag', in: 'query', schema: { type: 'string' } },
            { name: 'since', in: 'query', description: 'Captured on or after (YYYY-MM-DD)', schema: { type: 'string', format: 'date' } },
            { name: 'until', in: 'query', description: 'Captured on or before (YYYY-MM-DD)', schema: { type: 'string', format: 'date' } },
            { name: 'due', in: 'query', description: 'true: only notes waiting for review', schema: { type: 'boolean' } },
            { name: 'sort', in: 'query', schema: { enum: ['relevance', 'created', 'updated', 'title'] } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          ],
          responses: { 200: ok('A note, or { total, offset, notes }') },
        },
        post: {
          summary: 'Create a note',
          parameters: [{ name: 'allow_duplicate', in: 'query', description: 'Create even if the title exists', schema: { type: 'boolean' } }],
          requestBody: { required: true, content: { ...json(ref('NoteInput')), 'text/markdown': { schema: { type: 'string' } } } },
          responses: {
            201: ok('The created note, with its url', ref('Note')),
            409: ok('A note with this title exists; `existingId` names it'),
          },
        },
        put: {
          summary: 'Update a note (only the fields sent)',
          description: 'Renaming a note rewrites every [[link]] to it. JSON may include `add_tags` and `remove_tags`.',
          parameters: [id],
          requestBody: { required: true, content: { ...json(ref('NoteUpdate')), 'text/markdown': { schema: { type: 'string' } } } },
          responses: { 200: ok('The updated note', ref('Note')) },
        },
        patch: { summary: 'Same as PUT', parameters: [id], requestBody: { required: true, content: json(ref('NoteUpdate')) }, responses: { 200: ok('The updated note', ref('Note')) } },
        delete: { summary: 'Move a note to the trash', parameters: [id], responses: { 200: ok('Where it went') } },
      },
      '/api/notes/raw': {
        get: { summary: 'A note file exactly as stored', parameters: [id], responses: { 200: { description: 'Markdown', content: { 'text/markdown': { schema: { type: 'string' } } } } } },
      },
      '/api/notes/related': {
        get: {
          summary: 'Notes that share tags, a domain or title words, and are not linked yet',
          parameters: [id, { name: 'limit', in: 'query', schema: { type: 'integer', default: 5, maximum: 20 } }],
          responses: { 200: ok('{ notes }') },
        },
      },
      '/api/notes/batch': {
        post: {
          summary: 'Create up to 20 notes at once',
          requestBody: {
            required: true,
            content: json({ type: 'object', properties: { notes: { type: 'array', maxItems: 20, items: { oneOf: [ref('NoteInput'), { type: 'object', properties: { markdown: { type: 'string' } }, required: ['markdown'] }] } } }, required: ['notes'] }),
          },
          responses: { 200: ok('{ created, results: [{ status: created | exists | error, id, url, error }] }') },
        },
      },
      '/api/notes/append': {
        post: {
          summary: 'Append Markdown to the end of a note',
          parameters: [id],
          requestBody: { required: true, content: { 'text/markdown': { schema: { type: 'string' } }, ...json({ type: 'object', properties: { text: { type: 'string' } } }) } },
          responses: { 200: ok('The updated note', ref('Note')) },
        },
      },
      '/api/words': {
        get: {
          summary: 'Search the dictionary, or fetch one entry with ?id= or ?word=',
          description: 'With `id` or `word`: the entry with its synonyms, antonyms and related words resolved to existing entries (`{ text, id }`), the notes that use the word (`mentionedIn`), and which face its review card shows next (`side`).',
          parameters: [
            { name: 'id', in: 'query', schema: { type: 'string' } },
            { name: 'word', in: 'query', description: 'Look up by the word itself, case-insensitive', schema: { type: 'string' } },
            { name: 'q', in: 'query', description: 'Keywords; matches the word, relations, definition, example, translation', schema: { type: 'string' } },
            { name: 'field', in: 'query', schema: { type: 'string' } },
            { name: 'pos', in: 'query', schema: { enum: ['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'particle', 'phrase', 'abbreviation', 'other'] } },
            { name: 'language', in: 'query', description: 'ISO code of the language the word is in', schema: { type: 'string' } },
            { name: 'letter', in: 'query', description: 'First letter', schema: { type: 'string', maxLength: 1 } },
            { name: 'due', in: 'query', schema: { type: 'boolean' } },
            { name: 'sort', in: 'query', schema: { enum: ['relevance', 'word', 'created'] } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
          ],
          responses: { 200: ok('An entry, or { total, offset, words }') },
        },
        post: {
          summary: 'Add a word or term',
          parameters: [{ name: 'allow_duplicate', in: 'query', schema: { type: 'boolean' } }],
          requestBody: { required: true, content: { ...json(ref('WordInput')), 'text/markdown': { schema: { type: 'string' }, example: '---\ntype: word\nword: idempotent\npos: adjective\ndefinition: "…"\n---\n' } } },
          responses: { 201: ok('The entry', ref('Word')), 409: ok('The word exists; `existingId` names it') },
        },
        put: {
          summary: 'Update an entry (only the fields sent)',
          description: 'Renaming the word updates every other entry that lists it. `add_fields` / `remove_fields` adjust fields.',
          parameters: [id],
          requestBody: { required: true, content: json(ref('WordInput')) },
          responses: { 200: ok('The entry', ref('Word')) },
        },
        patch: { summary: 'Same as PUT', parameters: [id], requestBody: { required: true, content: json(ref('WordInput')) }, responses: { 200: ok('The entry', ref('Word')) } },
        delete: { summary: 'Move an entry to the trash', parameters: [id], responses: { 200: ok('Where it went') } },
      },
      '/api/words/fields': { get: { summary: 'Fields and languages in use with counts, the parts of speech accepted, known languages and translation targets', responses: { 200: ok('{ fields, languages, partsOfSpeech, knownLanguages, translationTargets }') } } },
      '/api/ai': { get: { summary: 'Whether AI fill is set up, and which provider and model it uses', responses: { 200: ok('{ enabled, provider, model, targets }') } } },
      '/api/ai/word': {
        post: {
          summary: 'Complete a dictionary entry with AI from the word and any fields already typed',
          requestBody: { required: true, content: json({ type: 'object', required: ['word'], properties: { word: { type: 'string' }, language: { type: 'string' }, pos: { type: 'string' }, definition: { type: 'string' }, example: { type: 'string' }, targets: { type: 'array', items: { type: 'string' }, description: 'Language codes to translate into; defaults to the server setting' } } }) },
          responses: { 200: ok('A full suggested entry: word, language, pos, definition, example, pronunciation, translations {code: text}, synonyms, antonyms, related, root, fields'), 503: ok('AI fill is not set up') },
        },
      },
      '/api/ai/harakat': {
        post: {
          summary: 'Add harakat (Arabic vowel marks) to up to 60 strings',
          description: 'A result is accepted only if its letters match the input, so words are never changed; rejected strings come back unchanged and are counted in `rejected`.',
          requestBody: { required: true, content: json({ type: 'object', required: ['texts'], properties: { texts: { type: 'array', maxItems: 60, items: { type: 'string' } } } }) },
          responses: { 200: ok('{ texts, rejected }'), 503: ok('AI fill is not set up') },
        },
      },
      '/api/ai/harakat/dictionary': {
        post: {
          summary: 'Add harakat to every Arabic string in the dictionary that has none',
          description: 'Covers Arabic translations of every entry, and the word, meaning, example and related words of entries in Arabic.',
          responses: { 200: ok('{ words, strings, rejected }'), 503: ok('AI fill is not set up') },
        },
      },
      '/api/ai/note': {
        post: {
          summary: 'Complete a note with AI: title, summary, recall question, tags, domains, and a body if none was written',
          requestBody: { required: true, content: json({ type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, domains: { type: 'array', items: { type: 'string' } }, tags: { type: 'array', items: { type: 'string' } } } }) },
          responses: { 200: ok('{ title, summary, question, tags, domains, body }'), 503: ok('AI fill is not set up') },
        },
      },
      '/api/words/batch': {
        post: {
          summary: 'Add up to 50 words at once',
          requestBody: { required: true, content: json({ type: 'object', properties: { words: { type: 'array', maxItems: 50, items: { oneOf: [ref('WordInput'), { type: 'object', properties: { markdown: { type: 'string' } }, required: ['markdown'] }] } } }, required: ['words'] }) },
          responses: { 200: ok('{ created, results: [{ status: created | exists | error, id, url, error }] }') },
        },
      },
      '/api/review/due': {
        get: {
          summary: "Today's review queue: due notes and words first, then new ones",
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
            { name: 'new', in: 'query', description: 'How many never-reviewed notes to include', schema: { type: 'integer', default: 10 } },
          ],
          responses: { 200: ok('{ today, due, new, items } where each item has kind "note" (question, summary, body) or "word" (definition, example, and `side`: "meaning" asks what the word means, "word" gives the definition and asks for the word)') },
        },
      },
      '/api/review': {
        post: {
          summary: 'Record how well a note was remembered; schedules the next review',
          parameters: [id],
          requestBody: { required: true, content: json({ type: 'object', properties: { grade: { enum: ['again', 'hard', 'good', 'easy'] } }, required: ['grade'] }) },
          responses: { 200: ok('The note with nextReview and intervalDays') },
        },
      },
      '/api/domains': {
        get: { summary: 'All domains with note counts', responses: { 200: ok('{ domains }') } },
        post: {
          summary: 'Create a domain',
          requestBody: { required: true, content: json(ref('DomainInput')) },
          responses: { 201: ok('The domain'), 409: ok('It already exists') },
        },
      },
      '/api/domains/{slug}': {
        get: { summary: 'One domain with its notes', parameters: [slug], responses: { 200: ok('The domain, children and notes') } },
        patch: { summary: 'Rename, recolor, re-parent or describe a domain', parameters: [slug], requestBody: { required: true, content: json(ref('DomainInput')) }, responses: { 200: ok('The domain') } },
        delete: { summary: 'Delete an empty domain (moved to the trash)', parameters: [slug], responses: { 200: ok('Where it went'), 409: ok('It still has notes or sub-domains') } },
      },
      '/api/tags': { get: { summary: 'Tags with note counts, most used first', responses: { 200: ok('{ tags }') } } },
      '/api/stats': { get: { summary: 'Totals, due counts, streak, recent activity, notes per domain', responses: { 200: ok('Stats') } } },
      '/api/export': { get: { summary: 'Every note and domain file as stored, for backups', responses: { 200: ok('{ exported, files: [{ path, markdown }] }') } } },
    },
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer' },
        apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      schemas: {
        NoteInput: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', maxLength: 200, description: 'The idea as a plain sentence' },
            domains: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Domain slugs; the first is primary. Unknown slugs create domains.' },
            tags: { type: 'array', items: { type: 'string' }, maxItems: 20 },
            summary: { type: 'string', description: 'The takeaway in one sentence' },
            question: { type: 'string', description: 'Recall question used in review' },
            source: { type: 'string', description: 'Where it was learned' },
            body: { type: 'string', description: 'Markdown; link notes with [[Title]]' },
            created: { type: 'string', format: 'date' },
          },
        },
        NoteUpdate: {
          allOf: [
            { $ref: '#/components/schemas/NoteInput' },
            { type: 'object', properties: { add_tags: { type: 'array', items: { type: 'string' } }, remove_tags: { type: 'array', items: { type: 'string' } } } },
          ],
        },
        Note: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            domains: { type: 'array', items: { type: 'string' } },
            tags: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
            question: { type: 'string' },
            source: { type: 'string' },
            created: { type: 'string', format: 'date' },
            body: { type: 'string' },
            url: { type: 'string', description: 'Opens the note in the web app' },
          },
        },
        WordInput: {
          type: 'object',
          required: ['word', 'definition'],
          properties: {
            word: { type: 'string', maxLength: 100 },
            pos: { enum: ['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'particle', 'phrase', 'abbreviation', 'other'], default: 'other' },
            definition: { type: 'string', description: 'Plain-language meaning, one or two sentences' },
            example: { type: 'string', description: 'A sentence that uses the word' },
            language: { type: 'string', description: 'ISO code of the language the word is in; default en' },
            translations: { type: 'object', additionalProperties: { type: 'string' }, description: 'Keyed by language code, e.g. { "uz": "…", "ru": "…" }' },
            add_translations: { type: 'object', additionalProperties: { type: 'string' }, description: 'Update only: merge into existing translations' },
            pronunciation: { type: 'string' },
            synonyms: { type: 'array', items: { type: 'string' }, maxItems: 20 },
            antonyms: { type: 'array', items: { type: 'string' }, maxItems: 20 },
            related: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'See-also words' },
            root: { type: 'string', description: 'Etymology or word family' },
            fields: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Topic slugs, e.g. statistics' },
            source: { type: 'string' },
            body: { type: 'string', description: 'Optional longer notes in Markdown' },
            add_fields: { type: 'array', items: { type: 'string' }, description: 'Update only' },
            remove_fields: { type: 'array', items: { type: 'string' }, description: 'Update only' },
          },
        },
        Word: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            word: { type: 'string' },
            pos: { type: 'string' },
            fields: { type: 'array', items: { type: 'string' } },
            definition: { type: 'string' },
            example: { type: 'string' },
            language: { type: 'string' },
            translations: { type: 'object', additionalProperties: { type: 'string' } },
            synonyms: { type: 'array', items: { type: 'string' } },
            antonyms: { type: 'array', items: { type: 'string' } },
            related: { type: 'array', items: { type: 'string' } },
            root: { type: 'string' },
            created: { type: 'string', format: 'date' },
            url: { type: 'string' },
          },
        },
        DomainInput: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            slug: { type: 'string', description: 'Defaults to a slug of the name' },
            color: { type: 'string', description: 'prussian, viridian, oxblood, ochre, violet, teal, sepia, slate, olive, magenta, or #rrggbb' },
            parent: { type: 'string', description: 'Parent domain slug' },
            description: { type: 'string' },
          },
        },
      },
    },
  };
}
