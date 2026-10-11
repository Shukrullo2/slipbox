// Reads and writes the vault: a folder of Markdown files with YAML frontmatter.
// Layout:  vault/<domain-slug>/_domain.md      domain metadata + description
//          vault/<domain-slug>/<Note title>.md  one learning per file
// Anything in a dot-folder (.trash, .slipbox, .obsidian) is ignored.

import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { NEW_PER_SESSION, addDays, isDue, isNew, localDate, schedule } from '../shared/srs.js';
import { linkGraph } from '../shared/links.js';
import { LANGUAGE_CODES, detectLanguage, foldText, languageCode } from '../shared/languages.js';

export const PALETTE = ['prussian', 'viridian', 'oxblood', 'ochre', 'violet', 'teal', 'sepia', 'slate', 'olive', 'magenta'];
const DOMAIN_FILE = '_domain.md';
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const ACRONYMS = new Set(['sql', 'css', 'html', 'api', 'aws', 'gcp', 'ml', 'ai', 'llm', 'ci', 'cd', 'dns', 'http', 'jvm', 'k8s', 'ui', 'ux', 'etl', 'orm', 'os']);

export const LIMITS = { title: 200, field: 1000, body: 200_000, domains: 8, tags: 20, word: 100, relations: 20 };
export const PARTS_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'abbreviation', 'other'];
const WORDS_DIR = 'words';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- small helpers ----------

export function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+#]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nameFromSlug(slug) {
  return slug
    .split('-')
    .map((w, i) => (ACRONYMS.has(w) ? w.toUpperCase() : i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function sanitizeFilename(title) {
  const cleaned = String(title)
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/, '');
  return cleaned || 'Untitled';
}

const str = (v) => (v === undefined || v === null ? undefined : String(v).trim() || undefined);
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : undefined);
function dateStr(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return localDate(v);
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
}
/** `translations:` map in the frontmatter, plus the older single `translation:` string as "other". */
function translationMap(map, single) {
  const out = {};
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    for (const [k, v] of Object.entries(map)) {
      const code = languageCode(k);
      const text = str(v);
      if (code && text) out[code] = text;
    }
  }
  const legacy = str(single);
  if (legacy && !Object.keys(out).length) out.other = legacy;
  return out;
}

/** Which face a word card shows first: even reviews ask for the meaning, odd ones for the word. */
export const wordSide = (w) => ((w.review && w.review.count) || 0) % 2 === 0 ? 'meaning' : 'word';

const reviewState = (data) => ({
  due: dateStr(data['sr-due']),
  interval: num(data['sr-interval']),
  ease: num(data['sr-ease']),
  count: num(data['sr-reviews']) ?? 0,
});
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const STOPWORDS = new Set(
  'a an and are as at be by can do does for from how in into is it its not of on or so than that the their then there these this to use using vs was what when where which while who why will with without you your instead'.split(' '),
);

/** Weighted match of search terms; notes that match more of the words rank higher. */
function relevance(n, terms) {
  const fields = [
    [foldText(n.title), 5],
    [foldText(n.tags.join(' ')), 3],
    [foldText(`${n.summary ?? ''} ${n.question ?? ''}`), 2],
    [foldText(n.body), 1],
  ];
  let score = 0;
  let matched = 0;
  for (const t of terms) {
    let hit = 0;
    for (const [text, weight] of fields) if (text.includes(t)) hit += weight;
    if (hit) matched++;
    score += hit;
  }
  return matched ? score * (matched / terms.length) : 0;
}

// ---------- frontmatter ----------

export function splitFrontmatter(raw) {
  const m = raw.match(FM_RE);
  if (!m) return { yaml: null, body: raw };
  return { yaml: m[1], body: raw.slice(m[0].length) };
}

function parseFrontmatter(raw) {
  const { yaml, body } = splitFrontmatter(raw);
  if (yaml === null) return { data: {}, body, error: undefined };
  try {
    const data = YAML.parse(yaml);
    if (data && typeof data === 'object' && !Array.isArray(data)) return { data, body, error: undefined };
    return { data: {}, body, error: undefined };
  } catch (e) {
    return { data: {}, body, error: `Frontmatter is not valid YAML: ${e.message.split('\n')[0]}` };
  }
}

/** A whole note sent as Markdown (frontmatter + body) → fields for create/update. */
export function parseMarkdownNote(raw) {
  const { data, body, error } = parseFrontmatter(String(raw ?? ''));
  if (error) throw new HttpError(400, error);
  const out = { body: body.replace(/^\s*\n/, '') };
  for (const k of ['title', 'domains', 'domain', 'tags', 'summary', 'question', 'source', 'created']) {
    if (data[k] !== undefined && data[k] !== null) out[k === 'domain' ? 'domains' : k] = data[k];
  }
  if (out.created instanceof Date) out.created = localDate(out.created);
  return out;
}

/** A dictionary entry sent as Markdown (frontmatter + optional notes body). */
export function parseMarkdownWord(raw) {
  const { data, body, error } = parseFrontmatter(String(raw ?? ''));
  if (error) throw new HttpError(400, error);
  const out = { body: body.replace(/^\s*\n/, '') };
  for (const k of WORD_KEYS) if (data[k] !== undefined && data[k] !== null) out[k] = data[k];
  if (data.field !== undefined && out.fields === undefined) out.fields = data.field;
  if (out.created instanceof Date) out.created = localDate(out.created);
  return out;
}
const WORD_KEYS = ['word', 'language', 'pos', 'fields', 'definition', 'example', 'translation', 'translations', 'pronunciation', 'synonyms', 'antonyms', 'related', 'root', 'source', 'created'];

const isEmpty = (v) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && Object.keys(v).length === 0);

/**
 * Apply `patch` to a file's frontmatter while keeping the user's key order and
 * comments. Empty values remove the key. Returns the full file text.
 */
function patchFile(raw, patch, newBody) {
  const { yaml, body } = splitFrontmatter(raw ?? '');
  let doc = yaml !== null ? YAML.parseDocument(yaml) : new YAML.Document({});
  if (doc.errors.length || !YAML.isMap(doc.contents)) doc = new YAML.Document({});
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (isEmpty(value)) {
      doc.delete(key);
      continue;
    }
    const node = doc.createNode(value);
    if (YAML.isSeq(node)) node.flow = true;
    doc.set(key, node);
  }
  const fm = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
  const text = (newBody ?? body).replace(/^\s*\n/, '');
  return `---\n${fm}\n---\n\n${text.endsWith('\n') || !text ? text : text + '\n'}`;
}

// ---------- the vault ----------

export class Vault {
  constructor(root) {
    this.root = path.resolve(root);
    this.cache = new Map(); // relPath -> { mtimeMs, size, item }
    this.metaDir = path.join(this.root, '.slipbox');
    this.reviewLog = path.join(this.metaDir, 'reviews.jsonl');
  }

  resolveInside(rel) {
    const abs = path.resolve(this.root, rel);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) throw new HttpError(400, 'Path escapes the vault');
    return abs;
  }

  async walk(dir = this.root, rel = '') {
    const out = [];
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') return out;
      throw e;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...(await this.walk(path.join(dir, e.name), childRel)));
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(childRel);
    }
    return out;
  }

  async readItem(rel) {
    const abs = path.join(this.root, rel);
    const stat = await fs.stat(abs);
    const hit = this.cache.get(rel);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.item;
    const raw = await fs.readFile(abs, 'utf8');
    let item;
    if (path.basename(rel) === DOMAIN_FILE) item = this.toDomain(rel, raw);
    else {
      const parsed = parseFrontmatter(raw);
      item = parsed.data.type === 'word' ? this.toWord(rel, parsed, stat) : this.toNote(rel, parsed, stat);
    }
    this.cache.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size, item });
    return item;
  }

  /** A dictionary entry: one word or term, its meaning, and how it relates to other words. */
  toWord(rel, { data, body, error }, stat) {
    const id = rel.replace(/\.md$/i, '');
    const basename = id.split('/').pop();
    const words = (v) => [...new Set(list(v).map((w) => String(w).trim()).filter(Boolean))];
    const pos = str(data.pos)?.toLowerCase();
    return {
      kind: 'word',
      id,
      path: rel,
      basename,
      word: str(data.word) ?? basename,
      pos: PARTS_OF_SPEECH.includes(pos) ? pos : 'other',
      language: languageCode(data.language) ?? detectLanguage(str(data.word) ?? basename),
      fields: [...new Set(list(data.fields ?? data.field).map(slugify).filter(Boolean))],
      definition: str(data.definition) ?? '',
      example: str(data.example),
      translations: translationMap(data.translations, data.translation),
      pronunciation: str(data.pronunciation),
      synonyms: words(data.synonyms),
      antonyms: words(data.antonyms),
      related: words(data.related),
      root: str(data.root),
      source: str(data.source),
      created: dateStr(data.created) ?? localDate(stat.birthtime),
      updated: stat.mtime.toISOString(),
      review: data.review === false ? false : reviewState(data),
      body,
      error,
    };
  }

  toNote(rel, { data, body, error }, stat) {
    const id = rel.replace(/\.md$/i, '');
    const segments = id.split('/');
    const basename = segments[segments.length - 1];
    const folder = segments.length > 1 ? segments[segments.length - 2] : undefined;

    let domains = list(data.domains ?? data.domain).map(slugify).filter(Boolean);
    if (!domains.length) domains = [folder ? slugify(folder) : 'inbox'];

    return {
      kind: 'note',
      id,
      path: rel,
      basename,
      title: str(data.title) ?? basename,
      domains: [...new Set(domains)],
      tags: list(data.tags).map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean),
      aliases: list(data.aliases).map(String),
      summary: str(data.summary),
      question: str(data.question),
      source: str(data.source),
      created: dateStr(data.created) ?? localDate(stat.birthtime),
      updated: stat.mtime.toISOString(),
      review: data.review === false ? false : reviewState(data),
      body,
      error,
    };
  }

  toDomain(rel, raw) {
    const { data, body } = parseFrontmatter(raw);
    const folder = rel.split('/').slice(-2, -1)[0] ?? '';
    const slug = slugify(folder);
    return {
      kind: 'domain',
      slug,
      path: rel,
      name: str(data.name) ?? nameFromSlug(slug),
      color: str(data.color),
      parent: data.parent ? slugify(data.parent) : undefined,
      description: body.trim(),
    };
  }

  /** Full scan. Creates `_domain.md` for any domain referenced but not yet defined. */
  async load() {
    await fs.mkdir(this.root, { recursive: true });
    const files = await this.walk();
    const seen = new Set(files);
    for (const key of this.cache.keys()) if (!seen.has(key)) this.cache.delete(key);

    const items = await Promise.all(files.map((f) => this.readItem(f).catch(() => null)));
    const notes = items.filter((i) => i?.kind === 'note');
    const words = items.filter((i) => i?.kind === 'word').sort((a, b) => a.word.localeCompare(b.word, undefined, { sensitivity: 'base' }));
    const domainMap = new Map();
    for (const d of items) if (d?.kind === 'domain' && d.slug && !domainMap.has(d.slug)) domainMap.set(d.slug, d);

    const referenced = new Set();
    for (const n of notes) n.domains.forEach((s) => referenced.add(s));
    for (const d of domainMap.values()) if (d.parent) referenced.add(d.parent);
    const missing = [...referenced].filter((s) => !domainMap.has(s));
    if (missing.length) {
      for (const slug of missing) domainMap.set(slug, await this.writeDomain(slug, {}, [...domainMap.values()]));
    }

    return { notes, words, domains: [...domainMap.values()] };
  }

  async getDomains() {
    return (await this.load()).domains;
  }

  pickColor(existing) {
    const counts = new Map(PALETTE.map((c) => [c, 0]));
    for (const d of existing) if (counts.has(d.color)) counts.set(d.color, counts.get(d.color) + 1);
    return [...counts.entries()].sort((a, b) => a[1] - b[1])[0][0];
  }

  async writeDomain(slug, fields, existing) {
    slug = slugify(slug);
    if (!slug) throw new HttpError(400, 'Domain needs a name');
    const rel = `${slug}/${DOMAIN_FILE}`;
    const abs = this.resolveInside(rel);
    let raw = null;
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch {}
    const patch = {
      name: fields.name ?? (raw ? undefined : nameFromSlug(slug)),
      color: fields.color ?? (raw ? undefined : this.pickColor(existing ?? (await this.getDomains()))),
      parent: fields.parent === undefined ? undefined : fields.parent ? slugify(fields.parent) : '',
    };
    if (patch.parent === slug) throw new HttpError(400, 'A domain cannot be its own parent');
    const body = fields.description === undefined ? undefined : String(fields.description).trim();
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, patchFile(raw, patch, body));
    return this.readItem(rel);
  }

  async uniquePath(dir, title, currentRel) {
    const base = sanitizeFilename(title);
    for (let i = 1; ; i++) {
      const rel = `${dir}/${i === 1 ? base : `${base} ${i}`}.md`;
      if (rel === currentRel) return rel;
      try {
        await fs.access(this.resolveInside(rel));
      } catch {
        return rel;
      }
    }
  }

  noteFields(input) {
    const out = {};
    if (input.title !== undefined) {
      out.title = String(input.title).replace(/\s+/g, ' ').trim();
      if (!out.title) throw new HttpError(400, 'Title is required');
      if (out.title.length > LIMITS.title) throw new HttpError(400, `Title is longer than ${LIMITS.title} characters`);
    }
    if (input.domains !== undefined) {
      out.domains = [...new Set(list(input.domains).map(slugify).filter(Boolean))];
      if (!out.domains.length) out.domains = ['inbox'];
      if (out.domains.length > LIMITS.domains) throw new HttpError(400, `A note can have at most ${LIMITS.domains} domains`);
    }
    if (input.tags !== undefined) {
      out.tags = [...new Set(list(input.tags).map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean))];
      if (out.tags.length > LIMITS.tags) throw new HttpError(400, `A note can have at most ${LIMITS.tags} tags`);
    }
    for (const k of ['summary', 'question', 'source']) {
      if (input[k] === undefined) continue;
      out[k] = String(input[k]).trim();
      if (out[k].length > LIMITS.field) throw new HttpError(400, `${k} is longer than ${LIMITS.field} characters`);
    }
    if (input.body !== undefined && String(input.body).length > LIMITS.body) {
      throw new HttpError(413, `Note body is longer than ${LIMITS.body} characters`);
    }
    return out;
  }

  /** Creates missing domains; returns the folder each slug lives in. */
  async ensureDomains(slugs) {
    const domains = await this.getDomains();
    const known = new Set(domains.map((d) => d.slug));
    for (const s of slugs) if (!known.has(s)) domains.push(await this.writeDomain(s, {}, domains));
    return new Map(domains.map((d) => [d.slug, path.posix.dirname(d.path)]));
  }

  /** Notes whose title (or file name) matches, ignoring case. */
  async findByTitle(title) {
    const t = String(title).trim().toLowerCase();
    const { notes } = await this.load();
    return notes.find((n) => n.title.toLowerCase() === t || n.basename.toLowerCase() === t);
  }

  async createNote(input, { allowDuplicate = false } = {}) {
    const fields = this.noteFields({ domains: [], ...input });
    if (!fields.title) throw new HttpError(400, 'Title is required');
    if (!allowDuplicate) {
      const existing = await this.findByTitle(fields.title);
      if (existing) {
        throw Object.assign(new HttpError(409, `A note titled "${existing.title}" already exists. Append to it or pick another title.`), {
          existingId: existing.id,
        });
      }
    }
    const folders = await this.ensureDomains(fields.domains);
    const rel = await this.uniquePath(folders.get(fields.domains[0]) ?? fields.domains[0], fields.title);
    const frontmatter = {
      title: fields.title,
      domains: fields.domains,
      tags: fields.tags,
      summary: fields.summary,
      question: fields.question,
      source: fields.source,
      created: dateStr(input.created) ?? localDate(),
    };
    const abs = this.resolveInside(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, patchFile(null, frontmatter, String(input.body ?? '')), { flag: 'wx' });
    return this.readItem(rel);
  }

  /** Adds Markdown to the end of a note, e.g. a new angle on an idea already captured. */
  async appendToNote(id, text) {
    const addition = String(text ?? '').trim();
    if (!addition) throw new HttpError(400, 'Nothing to append');
    const { rel, abs, raw } = await this.readNoteFile(id);
    const { body } = splitFrontmatter(raw);
    if (body.length + addition.length > LIMITS.body) throw new HttpError(413, `Note would be longer than ${LIMITS.body} characters`);
    await fs.writeFile(abs, patchFile(raw, {}, `${body.trimEnd()}\n\n${addition}\n`));
    return this.readItem(rel);
  }

  /**
   * Find notes. With `q`, ranked by relevance (title > tags > summary/question > body);
   * otherwise newest first. Filters combine with AND.
   */
  async listNotes({ q = '', domain, tag, since, until, due, sort, offset = 0, limit = 20 } = {}) {
    const { notes } = await this.load();
    const today = localDate();
    const terms = foldText(q).split(/[^\p{L}\p{N}_+#.-]+/u).filter((t) => t.length > 1);
    const domainSlug = domain ? slugify(domain) : undefined;
    const tagName = tag ? String(tag).replace(/^#/, '').toLowerCase() : undefined;
    const sinceDate = dateStr(since);
    const untilDate = dateStr(until);
    const wantDue = due === undefined ? undefined : due === true || due === 'true' || due === '1';

    let rows = notes
      .filter((n) => !domainSlug || n.domains.includes(domainSlug))
      .filter((n) => !tagName || n.tags.some((t) => t.toLowerCase() === tagName))
      .filter((n) => !sinceDate || n.created >= sinceDate)
      .filter((n) => !untilDate || n.created <= untilDate)
      .filter((n) => wantDue === undefined || (isDue(n, today) || isNew(n, today)) === wantDue)
      .map((n) => ({ n, score: terms.length ? relevance(n, terms) : 1 }))
      .filter((r) => r.score > 0);

    const order = sort ?? (terms.length ? 'relevance' : 'created');
    const by = {
      relevance: (a, b) => b.score - a.score || b.n.created.localeCompare(a.n.created),
      created: (a, b) => b.n.created.localeCompare(a.n.created) || a.n.title.localeCompare(b.n.title),
      updated: (a, b) => b.n.updated.localeCompare(a.n.updated),
      title: (a, b) => a.n.title.localeCompare(b.n.title),
    }[order];
    if (!by) throw new HttpError(400, 'sort must be relevance, created, updated or title');
    rows.sort(by);

    const start = Math.max(Number(offset) || 0, 0);
    const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return { total: rows.length, offset: start, notes: rows.slice(start, start + size).map((r) => r.n) };
  }

  async searchNotes(query = '', { domain, limit = 20 } = {}) {
    return (await this.listNotes({ q: query, domain, limit })).notes;
  }

  /** One note plus what it links to, what links to it, and links with no note yet. */
  async noteDetail(id) {
    const { notes } = await this.load();
    const note = notes.find((n) => n.id === id);
    if (!note) throw new HttpError(404, `No note with id "${id}"`);
    const graph = linkGraph(notes);
    const ref = (nid) => {
      const n = notes.find((x) => x.id === nid);
      return { id: nid, title: n?.title };
    };
    return {
      ...note,
      links: (graph.out.get(id) ?? []).map(ref),
      backlinks: (graph.back.get(id) ?? []).map(ref),
      unresolved: graph.unresolved.get(id) ?? [],
    };
  }

  /** Notes that share tags, a domain, or distinctive title words with this one, and aren't linked to it yet. */
  async relatedNotes(id, limit = 5) {
    const { notes } = await this.load();
    const note = notes.find((n) => n.id === id);
    if (!note) throw new HttpError(404, `No note with id "${id}"`);
    const graph = linkGraph(notes);
    const skip = new Set([id, ...(graph.out.get(id) ?? []), ...(graph.back.get(id) ?? [])]);
    const words = note.title
      .toLowerCase()
      .split(/[^\p{L}\p{N}_+#.-]+/u)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
    const scored = notes
      .filter((n) => !skip.has(n.id))
      .map((n) => {
        const sharedTags = n.tags.filter((t) => note.tags.includes(t)).length;
        const sameDomain = n.domains.some((d) => note.domains.includes(d)) ? 1 : 0;
        const text = words.length ? relevance(n, words) / words.length / 5 : 0;
        return { n, score: sharedTags * 3 + sameDomain + Math.min(text, 2) };
      })
      .filter((r) => r.score >= 2)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.min(Math.max(Number(limit) || 5, 1), 20)).map((r) => ({ ...r.n, score: Math.round(r.score * 10) / 10 }));
  }

  /** What a review session would show today: overdue and due notes first, then up to `newLimit` new ones. */
  /**
   * What a review session shows today: overdue and due items first, then up to `newLimit` new ones.
   * Words carry a `side`: which face of the card to show first. It alternates every review, so
   * you practise both recalling the meaning from the word and the word from its meaning.
   */
  async reviewQueue({ limit = 20, newLimit = NEW_PER_SESSION } = {}) {
    const { notes, words } = await this.load();
    const today = localDate();
    const all = [...notes, ...words];
    const due = all.filter((n) => isDue(n, today)).sort((a, b) => a.review.due.localeCompare(b.review.due));
    const fresh = all
      .filter((n) => isNew(n, today))
      .sort((a, b) => a.created.localeCompare(b.created))
      .slice(0, Math.max(Number(newLimit) || 0, 0));
    const queue = [...due, ...fresh].map((item) => (item.kind === 'word' ? { ...item, side: wordSide(item) } : item));
    return { today, due: due.length, new: fresh.length, items: queue.slice(0, Math.min(Math.max(Number(limit) || 20, 1), 100)) };
  }

  async tags() {
    const { notes } = await this.load();
    const counts = new Map();
    for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, notes]) => ({ tag, notes }));
  }

  async stats() {
    const { notes, words, domains } = await this.load();
    const reviews = await this.reviewActivity();
    const today = localDate();
    const captured = {};
    for (const n of [...notes, ...words]) captured[n.created] = (captured[n.created] ?? 0) + 1;
    const active = (d) => (captured[d] ?? 0) + (reviews[d] ?? 0) > 0;
    let streak = 0;
    for (let d = active(today) ? today : addDays(today, -1); active(d); d = addDays(d, -1)) streak++;
    const days = (n) => Array.from({ length: n }, (_, i) => addDays(today, -i));
    const sum = (map, n) => days(n).reduce((acc, d) => acc + (map[d] ?? 0), 0);
    return {
      today,
      notes: notes.length,
      words: words.length,
      domains: domains.length,
      dueToday: [...notes, ...words].filter((n) => isDue(n, today)).length,
      newToReview: [...notes, ...words].filter((n) => isNew(n, today)).length,
      notInReview: [...notes, ...words].filter((n) => n.review === false).length,
      streakDays: streak,
      captured: { last7Days: sum(captured, 7), last30Days: sum(captured, 30) },
      reviewed: { last7Days: sum(reviews, 7), last30Days: sum(reviews, 30) },
      byDomain: domains
        .map((d) => ({ slug: d.slug, name: d.name, notes: notes.filter((n) => n.domains.includes(d.slug)).length }))
        .sort((a, b) => b.notes - a.notes),
    };
  }

  /** The note file exactly as stored. */
  async rawNote(id) {
    return (await this.readNoteFile(id)).raw;
  }

  /** Every note and domain file as stored, for backups. */
  async exportAll() {
    const files = [];
    for (const rel of await this.walk()) files.push({ path: rel, markdown: await fs.readFile(path.join(this.root, rel), 'utf8') });
    return { exported: new Date().toISOString(), files };
  }

  async createDomain(input) {
    const slug = slugify(input.slug ?? input.name);
    if (!slug) throw new HttpError(400, 'A domain needs a name');
    const domains = await this.getDomains();
    if (domains.some((d) => d.slug === slug)) throw new HttpError(409, `Domain "${slug}" already exists`);
    if (input.parent && !domains.some((d) => d.slug === slugify(input.parent))) throw new HttpError(400, `No parent domain "${input.parent}"`);
    if (input.color && !PALETTE.includes(input.color) && !/^#[0-9a-f]{6}$/i.test(input.color)) {
      throw new HttpError(400, `color must be one of ${PALETTE.join(', ')} or a #rrggbb hex`);
    }
    return this.writeDomain(slug, { name: input.name ? String(input.name).trim() : undefined, color: input.color, parent: input.parent, description: input.description }, domains);
  }

  /** Only empty domains can go; the file moves to .trash like notes do. */
  async trashDomain(slug) {
    slug = slugify(slug);
    const { notes, domains } = await this.load();
    const domain = domains.find((d) => d.slug === slug);
    if (!domain) throw new HttpError(404, `No domain "${slug}"`);
    const used = notes.filter((n) => n.domains.includes(slug)).length;
    if (used) throw new HttpError(409, `"${domain.name}" still has ${used} note${used === 1 ? '' : 's'}. Move or delete them first.`);
    const children = domains.filter((d) => d.parent === slug);
    if (children.length) throw new HttpError(409, `"${domain.name}" is the parent of ${children.map((c) => c.name).join(', ')}.`);
    const abs = this.resolveInside(domain.path);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(this.root, '.trash', `${stamp} ${slug}${DOMAIN_FILE}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(abs, target);
    this.cache.delete(domain.path);
    await fs.rmdir(path.dirname(abs)).catch(() => {}); // only if now empty
    return { trashedTo: path.relative(this.root, target) };
  }

  async readNoteFile(id) {
    const rel = `${id}.md`;
    const abs = this.resolveInside(rel);
    try {
      return { rel, abs, raw: await fs.readFile(abs, 'utf8') };
    } catch (e) {
      if (e.code === 'ENOENT') throw new HttpError(404, `No note with id "${id}"`);
      throw e;
    }
  }

  async updateNote(id, input) {
    const { rel, abs, raw } = await this.readNoteFile(id);
    const before = await this.readItem(rel);
    if (input.add_tags !== undefined || input.remove_tags !== undefined) {
      const drop = new Set(list(input.remove_tags).map((t) => String(t).replace(/^#/, '').trim().toLowerCase()));
      const base = list(input.tags ?? before.tags).filter((t) => !drop.has(String(t).toLowerCase()));
      input = { ...input, tags: [...base, ...list(input.add_tags)] };
    }
    const fields = this.noteFields(input);
    const folders = await this.ensureDomains(fields.domains ?? before.domains);

    await fs.writeFile(abs, patchFile(raw, fields, input.body === undefined ? undefined : String(input.body)));

    // Move the file when the title or primary domain changes, then fix links.
    const title = fields.title ?? before.title;
    const primary = (fields.domains ?? before.domains)[0];
    const dir =
      rel.includes('/') && primary === before.domains[0] ? path.posix.dirname(rel) : (folders.get(primary) ?? primary);
    let finalRel = rel;
    if (title !== before.title || dir !== path.posix.dirname(rel)) {
      finalRel = await this.uniquePath(dir, title, rel);
      if (finalRel !== rel) {
        const target = this.resolveInside(finalRel);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rename(abs, target);
        this.cache.delete(rel);
      }
    }
    if (title !== before.title) {
      const newName = path.posix.basename(finalRel, '.md');
      await this.rewriteLinks([before.title, before.basename], newName === title ? title : `${newName}|${title}`);
    }
    return this.readItem(finalRel);
  }

  /** Point every [[old]] wikilink at the note's new name. */
  async rewriteLinks(oldNames, newTarget) {
    const names = [...new Set(oldNames.filter(Boolean))];
    const re = new RegExp(`\\[\\[\\s*(?:${names.map(escapeRe).join('|')})\\s*(#[^\\]|]*)?(\\|[^\\]]*)?\\]\\]`, 'gi');
    const [target, fallbackAlias] = newTarget.split('|');
    for (const rel of await this.walk()) {
      if (path.basename(rel) === DOMAIN_FILE) continue;
      const abs = path.join(this.root, rel);
      const raw = await fs.readFile(abs, 'utf8');
      const next = raw.replace(re, (_m, heading = '', alias) => `[[${target}${heading}${alias ?? (fallbackAlias ? `|${fallbackAlias}` : '')}]]`);
      if (next !== raw) await fs.writeFile(abs, next);
    }
  }

  async trashNote(id) {
    const { rel, abs } = await this.readNoteFile(id);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(this.root, '.trash', `${stamp} ${path.basename(rel)}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(abs, target);
    this.cache.delete(rel);
    return { trashedTo: path.relative(this.root, target) };
  }

  async reviewNote(id, grade) {
    const { rel, abs, raw } = await this.readNoteFile(id);
    const note = await this.readItem(rel);
    const today = localDate();
    const next = schedule(note.review || {}, grade);
    const count = ((note.review && note.review.count) || 0) + 1;
    await fs.writeFile(
      abs,
      patchFile(raw, { 'sr-due': addDays(today, next.interval), 'sr-interval': next.interval, 'sr-ease': next.ease, 'sr-reviews': count }),
    );
    await fs.mkdir(this.metaDir, { recursive: true });
    await fs.appendFile(this.reviewLog, JSON.stringify({ date: today, id, grade }) + '\n');
    return this.readItem(rel);
  }

  // ---------- dictionary ----------

  wordFields(input, { creating = false } = {}) {
    const out = {};
    const text = (k, limit) => {
      if (input[k] === undefined) return;
      out[k] = String(input[k]).replace(/\s+/g, ' ').trim();
      if (out[k].length > limit) throw new HttpError(400, `${k} is longer than ${limit} characters`);
    };
    text('word', LIMITS.word);
    if (creating && !out.word) throw new HttpError(400, 'word is required');
    if (out.word === '') throw new HttpError(400, 'word cannot be empty');
    if (input.pos !== undefined) {
      out.pos = String(input.pos).trim().toLowerCase() || 'other';
      if (!PARTS_OF_SPEECH.includes(out.pos)) throw new HttpError(400, `pos must be one of ${PARTS_OF_SPEECH.join(', ')}`);
    }
    for (const k of ['definition', 'example', 'pronunciation', 'root', 'source']) text(k, LIMITS.field);
    if (input.language !== undefined) {
      out.language = languageCode(input.language) ?? 'en';
    }
    if (input.translations !== undefined || input.translation !== undefined) {
      const map = translationMap(input.translations, input.translation);
      for (const [code, value] of Object.entries(map)) {
        if (!LANGUAGE_CODES.includes(code)) throw new HttpError(400, `Unknown language "${code}" in translations`);
        if (value.length > LIMITS.field) throw new HttpError(400, `The ${code} translation is longer than ${LIMITS.field} characters`);
      }
      if (Object.keys(map).length > 12) throw new HttpError(400, 'At most 12 translations');
      out.translations = map;
      out.translation = '';
    }
    if (creating && !out.definition) throw new HttpError(400, 'definition is required');
    if (out.definition === '') throw new HttpError(400, 'definition cannot be empty');
    const self = foldText(out.word ?? '');
    for (const k of ['synonyms', 'antonyms', 'related']) {
      if (input[k] === undefined) continue;
      out[k] = [...new Set(list(input[k]).map((w) => String(w).replace(/\s+/g, ' ').trim()).filter((w) => w && foldText(w) !== self))];
      if (out[k].length > LIMITS.relations) throw new HttpError(400, `At most ${LIMITS.relations} ${k}`);
    }
    if (input.fields !== undefined || input.field !== undefined) {
      out.fields = [...new Set(list(input.fields ?? input.field).map(slugify).filter(Boolean))];
      if (out.fields.length > LIMITS.domains) throw new HttpError(400, `At most ${LIMITS.domains} fields`);
    }
    if (input.body !== undefined && String(input.body).length > LIMITS.body) throw new HttpError(413, `Notes are longer than ${LIMITS.body} characters`);
    return out;
  }

  /** Finds an entry by its word, ignoring case and Arabic vowel marks. */
  async findWord(text) {
    const t = foldText(String(text).trim());
    const { words } = await this.load();
    return words.find((w) => foldText(w.word) === t || foldText(w.basename) === t || w.id === text);
  }

  async createWord(input, { allowDuplicate = false } = {}) {
    const fields = this.wordFields(input, { creating: true });
    if (!allowDuplicate) {
      const existing = await this.findWord(fields.word);
      if (existing) {
        throw Object.assign(new HttpError(409, `"${existing.word}" is already in the dictionary. Update it instead.`), { existingId: existing.id });
      }
    }
    const rel = await this.uniquePath(WORDS_DIR, fields.word);
    const frontmatter = {
      type: 'word',
      word: fields.word,
      language: fields.language ?? detectLanguage(fields.word),
      pos: fields.pos ?? 'other',
      fields: fields.fields,
      definition: fields.definition,
      example: fields.example,
      translations: fields.translations,
      pronunciation: fields.pronunciation,
      synonyms: fields.synonyms,
      antonyms: fields.antonyms,
      related: fields.related,
      root: fields.root,
      source: fields.source,
      created: dateStr(input.created) ?? localDate(),
    };
    const abs = this.resolveInside(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, patchFile(null, frontmatter, String(input.body ?? '')), { flag: 'wx' });
    return this.readItem(rel);
  }

  async readWord(id) {
    const { rel } = await this.readNoteFile(id);
    const item = await this.readItem(rel);
    if (item.kind !== 'word') throw new HttpError(404, `"${id}" is a note, not a dictionary entry`);
    return item;
  }

  async updateWord(id, input) {
    const before = await this.readWord(id);
    const { rel, abs, raw } = await this.readNoteFile(id);
    const fields = this.wordFields({ ...input, word: input.word ?? before.word });
    if (input.add_fields !== undefined || input.remove_fields !== undefined) {
      const drop = new Set(list(input.remove_fields).map(slugify));
      fields.fields = [...new Set([...(fields.fields ?? before.fields).filter((f) => !drop.has(f)), ...list(input.add_fields).map(slugify)])].filter(Boolean);
    }
    if (input.word === undefined) delete fields.word;
    if (input.add_translations && typeof input.add_translations === 'object') {
      const extra = translationMap(input.add_translations);
      fields.translations = { ...(fields.translations ?? before.translations), ...extra };
      fields.translation = '';
    }
    await fs.writeFile(abs, patchFile(raw, fields, input.body === undefined ? undefined : String(input.body)));

    let finalRel = rel;
    if (fields.word && fields.word !== before.word) {
      const clash = await this.findWord(fields.word);
      if (clash && clash.id !== id) throw new HttpError(409, `"${clash.word}" is already in the dictionary.`);
      finalRel = await this.uniquePath(path.posix.dirname(rel), fields.word, rel);
      if (finalRel !== rel) {
        await fs.rename(abs, this.resolveInside(finalRel));
        this.cache.delete(rel);
      }
      await this.renameWordReferences(before.word, fields.word);
    }
    return this.readItem(finalRel);
  }

  /** Other entries that list the renamed word as a synonym, antonym or related word follow the rename. */
  async renameWordReferences(oldWord, newWord) {
    const { words } = await this.load();
    const same = (w) => foldText(w) === foldText(oldWord);
    for (const w of words) {
      const patch = {};
      for (const k of ['synonyms', 'antonyms', 'related']) if (w[k].some(same)) patch[k] = w[k].map((x) => (same(x) ? newWord : x));
      if (!Object.keys(patch).length) continue;
      const abs = this.resolveInside(w.path);
      await fs.writeFile(abs, patchFile(await fs.readFile(abs, 'utf8'), patch));
    }
  }

  /** Find words. With `q`, ranked by relevance; otherwise alphabetical. */
  async listWords({ q = '', field, pos, language, letter, due, sort, offset = 0, limit = 50 } = {}) {
    const { words } = await this.load();
    const today = localDate();
    const terms = foldText(q).split(/[^\p{L}\p{N}_+#.-]+/u).filter((t) => t.length > 1);
    const fieldSlug = field ? slugify(field) : undefined;
    const posName = pos ? String(pos).toLowerCase() : undefined;
    const lang = language ? languageCode(language) : undefined;
    const initial = letter ? String(letter).slice(0, 1).toLowerCase() : undefined;
    const wantDue = due === undefined ? undefined : due === true || due === 'true' || due === '1';
    const score = (w) => {
      if (!terms.length) return 1;
      const fields = [
        [foldText(w.word), 5],
        [foldText([...w.synonyms, ...w.antonyms, ...w.related].join(' ')), 3],
        [foldText(`${w.definition} ${w.example ?? ''} ${Object.values(w.translations).join(' ')}`), 2],
        [foldText(w.body), 1],
      ];
      let total = 0;
      let matched = 0;
      for (const t of terms) {
        let hit = 0;
        for (const [text, weight] of fields) if (text.includes(t)) hit += weight;
        if (hit) matched++;
        total += hit;
      }
      return matched ? total * (matched / terms.length) : 0;
    };
    const rows = words
      .filter((w) => !fieldSlug || w.fields.includes(fieldSlug))
      .filter((w) => !posName || w.pos === posName)
      .filter((w) => !lang || w.language === lang)
      .filter((w) => !initial || foldText(w.word).startsWith(initial))
      .filter((w) => wantDue === undefined || (isDue(w, today) || isNew(w, today)) === wantDue)
      .map((w) => ({ w, score: score(w) }))
      .filter((r) => r.score > 0);
    const order = sort ?? (terms.length ? 'relevance' : 'word');
    const by = {
      relevance: (a, b) => b.score - a.score || a.w.word.localeCompare(b.w.word),
      word: (a, b) => a.w.word.localeCompare(b.w.word, undefined, { sensitivity: 'base' }),
      created: (a, b) => b.w.created.localeCompare(a.w.created) || a.w.word.localeCompare(b.w.word),
    }[order];
    if (!by) throw new HttpError(400, 'sort must be relevance, word or created');
    rows.sort(by);
    const start = Math.max(Number(offset) || 0, 0);
    const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return { total: rows.length, offset: start, words: rows.slice(start, start + size).map((r) => r.w) };
  }

  /** One entry with its relations resolved to existing entries, and the notes that use the word. */
  async wordDetail(id) {
    const word = await this.readWord(id);
    const { words, notes } = await this.load();
    const byText = new Map(words.map((w) => [foldText(w.word), w]));
    const resolve = (list) => list.map((text) => ({ text, id: byText.get(foldText(text))?.id }));
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word.word)}(?=$|[^\\p{L}\\p{N}])`, 'iu');
    const mentionedIn = notes
      .filter((n) => re.test(n.title) || re.test(n.summary ?? '') || re.test(n.body))
      .sort((a, b) => b.created.localeCompare(a.created))
      .slice(0, 10)
      .map((n) => ({ id: n.id, title: n.title }));
    return { ...word, synonyms: resolve(word.synonyms), antonyms: resolve(word.antonyms), related: resolve(word.related), mentionedIn };
  }

  async wordFieldCounts() {
    const { words } = await this.load();
    const counts = new Map();
    for (const w of words) for (const f of w.fields) counts.set(f, (counts.get(f) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([field, words]) => ({ field, words }));
  }

  async wordLanguageCounts() {
    const { words } = await this.load();
    const counts = new Map();
    for (const w of words) counts.set(w.language, (counts.get(w.language) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([language, words]) => ({ language, words }));
  }

  /** Reviews per day, from the append-only log. */
  async reviewActivity() {
    const counts = {};
    try {
      const raw = await fs.readFile(this.reviewLog, 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const { date } = JSON.parse(line);
          counts[date] = (counts[date] ?? 0) + 1;
        } catch {}
      }
    } catch {}
    return counts;
  }
}
