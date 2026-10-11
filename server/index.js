import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, PALETTE, PARTS_OF_SPEECH, Vault, parseMarkdownNote, parseMarkdownWord, slugify, wordSide } from './vault.js';
import { createAuth } from './auth.js';
import { mountMcp } from './mcp.js';
import { openapiSpec } from './openapi.js';
import { createAi } from './ai.js';
import { DEFAULT_TARGETS, LANGUAGES, languageCode } from '../shared/languages.js';
import { GRADES, localDate } from '../shared/srs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const VAULT_DIR = path.resolve(process.env.SLIPBOX_VAULT ?? path.join(ROOT, 'vault'));
const DIST_DIR = path.join(ROOT, 'dist');
const PORT = Number(process.env.SLIPBOX_PORT ?? 4747);
const HOST = process.env.SLIPBOX_HOST ?? '127.0.0.1';
const PUBLIC_URL = (process.env.SLIPBOX_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, '');
const KEYS = (process.env.SLIPBOX_API_KEYS ?? '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

const TELEGRAM_TOKEN = process.env.SLIPBOX_TELEGRAM_BOT_TOKEN?.trim();
const TELEGRAM_ALLOWED = (process.env.SLIPBOX_TELEGRAM_USERS ?? '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

const isLoopback = ['127.0.0.1', '::1', 'localhost'].includes(HOST);
if (!isLoopback && !KEYS.length) {
  console.error(`Refusing to listen on ${HOST} without SLIPBOX_API_KEYS. Set at least one key, or bind to 127.0.0.1.`);
  process.exit(1);
}
if (TELEGRAM_TOKEN && !TELEGRAM_ALLOWED.length) {
  console.warn('SLIPBOX_TELEGRAM_USERS is empty, so nobody can sign in with Telegram yet.');
}

/** The Login Widget needs the bot's username; ask Telegram so only the token has to be configured. */
async function telegramBotUsername() {
  if (process.env.SLIPBOX_TELEGRAM_BOT) return process.env.SLIPBOX_TELEGRAM_BOT.replace(/^@/, '');
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getMe`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (data.ok) return data.result.username;
    console.error(`Telegram rejected the bot token: ${data.description ?? res.status}`);
  } catch (e) {
    console.error(`Couldn't reach Telegram to look up the bot: ${e.message}`);
  }
  return undefined;
}
if (KEYS.some((k) => k.length < 24)) {
  console.error('Every key in SLIPBOX_API_KEYS must be at least 24 characters.');
  process.exit(1);
}

const LANGUAGE_TARGETS = (process.env.SLIPBOX_LANGUAGES ?? DEFAULT_TARGETS.join(','))
  .split(',')
  .map((c) => languageCode(c))
  .filter((c) => c && c !== 'other');

const vault = new Vault(VAULT_DIR);
const ai = createAi({
  provider: process.env.SLIPBOX_AI_PROVIDER,
  anthropicKey: process.env.SLIPBOX_AI_API_KEY,
  anthropicBaseUrl: process.env.SLIPBOX_AI_BASE_URL,
  huggingFaceToken: process.env.SLIPBOX_HF_TOKEN,
  model: process.env.SLIPBOX_AI_MODEL,
  vault,
  targets: LANGUAGE_TARGETS,
});
const auth = createAuth({
  keys: KEYS,
  telegram: TELEGRAM_TOKEN ? { botToken: TELEGRAM_TOKEN, botUsername: await telegramBotUsername(), allowed: TELEGRAM_ALLOWED } : undefined,
});
const noteUrl = (id) => `${PUBLIC_URL}/#/graph?note=${encodeURIComponent(id)}`;

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy on the same host or Docker network.
app.set('trust proxy', process.env.SLIPBOX_TRUST_PROXY ?? 'loopback, uniquelocal');
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: ['text/markdown', 'text/plain'], limit: '1mb' }));

const route =
  (fn, status = 200) =>
  async (req, res, next) => {
    try {
      res.status(status).json(await fn(req, res));
    } catch (e) {
      next(e);
    }
  };
const idParam = (req) => {
  const id = String(req.query.id ?? '');
  if (!id) throw new HttpError(400, 'Missing ?id=');
  return id;
};
/** JSON fields or a whole Markdown note (frontmatter + body). */
const noteInput = (req) => (typeof req.body === 'string' ? parseMarkdownNote(req.body) : (req.body ?? {}));
const truthy = (v) => v === true || v === '1' || v === 'true';
const withUrl = (n) => ({ ...n, url: noteUrl(n.id) });
const brief = (n) => ({ id: n.id, title: n.title, domains: n.domains, tags: n.tags, summary: n.summary, question: n.question, created: n.created, url: noteUrl(n.id) });

// ---------- public ----------

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/session', auth.describe);
app.post('/api/session', auth.loginWithKey);
app.post('/api/session/telegram', auth.loginWithTelegram);
app.delete('/api/session', auth.logout);

// The /learn skill for Claude Code on any device, with this server's URL filled in.
app.get('/setup/learn/SKILL.md', (_req, res) => {
  const template = fs.readFileSync(path.join(ROOT, 'claude', 'skills', 'learn', 'SKILL.md'), 'utf8');
  res.type('text/markdown').send(template.replaceAll('{{SLIPBOX_URL}}', PUBLIC_URL));
});

app.get('/api/openapi.json', (_req, res) => res.json(openapiSpec(PUBLIC_URL)));

mountMcp(app, { vault, auth, noteUrl, targets: LANGUAGE_TARGETS });

// ---------- everything else under /api needs a key or a session ----------

app.use('/api', auth.require);

app.get(
  '/api/vault',
  route(async () => {
    const { notes, words, domains } = await vault.load();
    return {
      notes,
      words,
      domains,
      palette: PALETTE,
      reviews: await vault.reviewActivity(),
      today: localDate(),
      root: VAULT_DIR,
      authRequired: auth.enabled,
      languages: { known: LANGUAGES, targets: LANGUAGE_TARGETS },
      ai: { enabled: ai.enabled, provider: ai.provider, model: ai.model },
    };
  }),
);

// ---------- notes ----------

const listQuery = (q) => ({
  q: q.q,
  domain: q.domain,
  tag: q.tag,
  since: q.since,
  until: q.until,
  due: q.due,
  sort: q.sort,
  offset: q.offset,
  limit: q.limit,
});

// GET /api/notes?id=…    one note with its body, links and backlinks
// GET /api/notes?…       search and filter (q, domain, tag, since, until, due, sort, offset, limit)
app.get(
  '/api/notes',
  route(async (req) => {
    if (req.query.id) return withUrl(await vault.noteDetail(String(req.query.id)));
    const { total, offset, notes } = await vault.listNotes(listQuery(req.query));
    return { total, offset, notes: notes.map(brief) };
  }),
);

app.get('/api/notes/raw', async (req, res, next) => {
  try {
    res.type('text/markdown').send(await vault.rawNote(idParam(req)));
  } catch (e) {
    next(e);
  }
});

app.get(
  '/api/notes/related',
  route(async (req) => ({ notes: (await vault.relatedNotes(idParam(req), req.query.limit)).map((n) => ({ ...brief(n), score: n.score })) })),
);

app.post(
  '/api/notes',
  route(async (req) => withUrl(await vault.createNote(noteInput(req), { allowDuplicate: truthy(req.query.allow_duplicate) })), 201),
);

// Up to 20 notes at once; each item is note fields as JSON or { markdown: "…" }.
app.post(
  '/api/notes/batch',
  route(async (req) => {
    const items = req.body?.notes;
    if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Send { "notes": [ … ] }');
    if (items.length > 20) throw new HttpError(400, 'At most 20 notes per batch');
    const results = [];
    for (const item of items) {
      try {
        const input = typeof item?.markdown === 'string' ? parseMarkdownNote(item.markdown) : (item ?? {});
        const n = await vault.createNote(input, { allowDuplicate: truthy(req.query.allow_duplicate) });
        results.push({ status: 'created', id: n.id, title: n.title, url: noteUrl(n.id) });
      } catch (e) {
        if (e.existingId) results.push({ status: 'exists', id: e.existingId, url: noteUrl(e.existingId), error: e.message });
        else results.push({ status: 'error', error: e.status && e.status < 500 ? e.message : 'Something went wrong on the server.' });
      }
    }
    return { created: results.filter((r) => r.status === 'created').length, results };
  }),
);

// PUT and PATCH both change only the fields you send. JSON may also carry add_tags / remove_tags.
const updateNote = route(async (req) => withUrl(await vault.updateNote(idParam(req), noteInput(req))));
app.put('/api/notes', updateNote);
app.patch('/api/notes', updateNote);
app.post(
  '/api/notes/append',
  route(async (req) => withUrl(await vault.appendToNote(idParam(req), typeof req.body === 'string' ? req.body : req.body?.text))),
);
app.delete('/api/notes', route((req) => vault.trashNote(idParam(req))));

// ---------- review ----------

app.get(
  '/api/review/due',
  route(async (req) => {
    const q = await vault.reviewQueue({ limit: req.query.limit, newLimit: req.query.new });
    return {
      today: q.today,
      due: q.due,
      new: q.new,
      items: q.items.map((n) =>
        n.kind === 'word'
          ? { kind: 'word', ...wordBrief(n), side: n.side, firstReview: !n.review || !n.review.due, nextReview: n.review ? n.review.due : undefined }
          : { kind: 'note', ...brief(n), body: n.body, firstReview: !n.review || !n.review.due, nextReview: n.review ? n.review.due : undefined },
      ),
    };
  }),
);
app.post(
  '/api/review',
  route(async (req) => {
    const grade = req.body?.grade;
    if (!GRADES.includes(grade)) throw new HttpError(400, `grade must be one of ${GRADES.join(', ')}`);
    const n = await vault.reviewNote(idParam(req), grade);
    return { ...withUrl(n), nextReview: n.review ? n.review.due : undefined, intervalDays: n.review ? n.review.interval : undefined };
  }),
);

// ---------- dictionary ----------

const wordUrl = (id) => `${PUBLIC_URL}/#/dictionary?word=${encodeURIComponent(id)}`;
const wordBrief = (w) => ({
  id: w.id,
  word: w.word,
  pos: w.pos,
  fields: w.fields,
  definition: w.definition,
  example: w.example,
  language: w.language,
  translations: w.translations,
  pronunciation: w.pronunciation,
  synonyms: w.synonyms,
  antonyms: w.antonyms,
  related: w.related,
  root: w.root,
  source: w.source,
  created: w.created,
  url: wordUrl(w.id),
});
const wordInput = (req) => (typeof req.body === 'string' ? parseMarkdownWord(req.body) : (req.body ?? {}));

// GET /api/words?id=… or ?word=…   one entry with resolved relations and the notes that use it
// GET /api/words?…                 list (q, field, pos, letter, due, sort, offset, limit)
app.get(
  '/api/words',
  route(async (req) => {
    if (req.query.id || req.query.word) {
      const w = req.query.id ? await vault.readWord(String(req.query.id)) : await vault.findWord(String(req.query.word));
      if (!w) throw new HttpError(404, `"${req.query.word}" is not in the dictionary`);
      const d = await vault.wordDetail(w.id);
      return { ...wordBrief(d), synonyms: d.synonyms, antonyms: d.antonyms, related: d.related, body: d.body, review: d.review, side: wordSide(d), mentionedIn: d.mentionedIn };
    }
    const { total, offset, words } = await vault.listWords({
      q: req.query.q,
      field: req.query.field,
      pos: req.query.pos,
      language: req.query.language,
      letter: req.query.letter,
      due: req.query.due,
      sort: req.query.sort,
      offset: req.query.offset,
      limit: req.query.limit,
    });
    return { total, offset, words: words.map(wordBrief) };
  }),
);
app.get(
  '/api/words/fields',
  route(async () => ({
    fields: await vault.wordFieldCounts(),
    languages: await vault.wordLanguageCounts(),
    partsOfSpeech: PARTS_OF_SPEECH,
    knownLanguages: LANGUAGES,
    translationTargets: LANGUAGE_TARGETS,
  })),
);

// ---------- fill in with AI ----------

app.get('/api/ai', (_req, res) => res.json({ enabled: ai.enabled, provider: ai.provider, model: ai.model, targets: LANGUAGE_TARGETS }));
app.post(
  '/api/ai/word',
  route(async (req) => {
    if (!ai.enabled) throw new HttpError(503, 'AI fill is not set up on this server.');
    return ai.word(req.ip, req.body ?? {});
  }),
);
app.post(
  '/api/ai/harakat',
  route(async (req) => {
    if (!ai.enabled) throw new HttpError(503, 'AI fill is not set up on this server.');
    return ai.harakat(req.ip, req.body?.texts);
  }),
);
app.post(
  '/api/ai/harakat/dictionary',
  route(async (req) => {
    if (!ai.enabled) throw new HttpError(503, 'AI fill is not set up on this server.');
    return ai.vocalizeDictionary(req.ip);
  }),
);
app.post(
  '/api/ai/note',
  route(async (req) => {
    if (!ai.enabled) throw new HttpError(503, 'AI fill is not set up on this server.');
    return ai.note(req.ip, req.body ?? {});
  }),
);
app.post(
  '/api/words',
  route(async (req) => wordBrief(await vault.createWord(wordInput(req), { allowDuplicate: truthy(req.query.allow_duplicate) })), 201),
);
app.post(
  '/api/words/batch',
  route(async (req) => {
    const items = req.body?.words;
    if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Send { "words": [ … ] }');
    if (items.length > 50) throw new HttpError(400, 'At most 50 words per batch');
    const results = [];
    for (const item of items) {
      try {
        const input = typeof item?.markdown === 'string' ? parseMarkdownWord(item.markdown) : (item ?? {});
        const w = await vault.createWord(input);
        results.push({ status: 'created', id: w.id, word: w.word, url: wordUrl(w.id) });
      } catch (e) {
        if (e.existingId) results.push({ status: 'exists', id: e.existingId, url: wordUrl(e.existingId), error: e.message });
        else results.push({ status: 'error', error: e.status && e.status < 500 ? e.message : 'Something went wrong on the server.' });
      }
    }
    return { created: results.filter((r) => r.status === 'created').length, results };
  }),
);
const updateWord = route(async (req) => wordBrief(await vault.updateWord(idParam(req), wordInput(req))));
app.put('/api/words', updateWord);
app.patch('/api/words', updateWord);
app.delete(
  '/api/words',
  route(async (req) => {
    await vault.readWord(idParam(req));
    return vault.trashNote(idParam(req));
  }),
);

// ---------- domains, tags, stats, export ----------

app.get(
  '/api/domains',
  route(async () => {
    const { notes, domains } = await vault.load();
    return {
      domains: domains.map((d) => ({
        slug: d.slug,
        name: d.name,
        color: d.color,
        parent: d.parent,
        description: d.description || undefined,
        notes: notes.filter((n) => n.domains.includes(d.slug)).length,
      })),
    };
  }),
);
app.get(
  '/api/domains/:slug',
  route(async (req) => {
    const slug = slugify(req.params.slug);
    const { notes, domains } = await vault.load();
    const d = domains.find((x) => x.slug === slug);
    if (!d) throw new HttpError(404, `No domain "${slug}"`);
    return {
      ...d,
      children: domains.filter((x) => x.parent === slug).map((x) => x.slug),
      notes: notes.filter((n) => n.domains.includes(slug)).sort((a, b) => b.created.localeCompare(a.created)).map(brief),
    };
  }),
);
app.post('/api/domains', route((req) => vault.createDomain(req.body ?? {}), 201));
app.put('/api/domains/:slug', route((req) => vault.writeDomain(slugify(req.params.slug), req.body ?? {})));
app.patch(
  '/api/domains/:slug',
  route(async (req) => {
    const slug = slugify(req.params.slug);
    if (!(await vault.getDomains()).some((d) => d.slug === slug)) throw new HttpError(404, `No domain "${slug}"`);
    return vault.writeDomain(slug, req.body ?? {});
  }),
);
app.delete('/api/domains/:slug', route((req) => vault.trashDomain(req.params.slug)));

app.get('/api/tags', route(async () => ({ tags: await vault.tags() })));
app.get('/api/stats', route(() => vault.stats()));
app.get('/api/export', route(() => vault.exportAll()));

// Live updates: anything that touches the vault (this app, Claude, your
// editor) tells connected browsers to refetch.
const clients = new Set();
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 2000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'No such endpoint')));

let debounce;
fs.mkdirSync(VAULT_DIR, { recursive: true });
fs.watch(VAULT_DIR, { recursive: true }, (_event, filename) => {
  if (filename && String(filename).split(path.sep).some((seg) => seg.startsWith('.'))) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    for (const res of clients) res.write('event: change\ndata: {}\n\n');
  }, 150);
});

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false }));
  app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(DIST_DIR, 'index.html')) : next()));
}

app.use((err, _req, res, _next) => {
  const status = err.status ?? err.statusCode ?? 500;
  // Errors we raised on purpose carry a message meant for the user, whatever the status.
  const intentional = err instanceof HttpError;
  if (status >= 500 && !intentional) console.error(err);
  res.status(status).json({ error: intentional || status < 500 ? err.message : 'Something went wrong on the server.', ...(err.existingId ? { existingId: err.existingId } : {}) });
});

app.listen(PORT, HOST, () => {
  console.log(`Slipbox running at ${PUBLIC_URL} (listening on ${HOST}:${PORT})`);
  console.log(`Vault: ${VAULT_DIR}`);
  console.log(auth.enabled ? `API keys: ${KEYS.length} configured` : 'API keys: none (local only)');
  console.log(ai.enabled ? `AI fill: ${ai.provider} (${ai.model})` : 'AI fill: off (set SLIPBOX_HF_TOKEN or SLIPBOX_AI_API_KEY)');
  if (TELEGRAM_TOKEN) console.log(`Telegram sign-in: ${TELEGRAM_ALLOWED.length} allowed account(s)`);
});
