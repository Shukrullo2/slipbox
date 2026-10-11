// "Fill in with AI": completes a dictionary entry or a note from whatever the
// user has typed so far. One call per click; the client only fills empty fields.
//
// Two providers:
//   huggingface  Hugging Face Inference Providers (free monthly credit), OpenAI-compatible
//                chat completions at router.huggingface.co. JSON is requested in the prompt
//                and validated here, with one retry if it comes back malformed.
//   anthropic    The Claude API with structured outputs, so the JSON is guaranteed.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { LANGUAGE_CODES, hasArabic, languageName, needsHarakat, sameLetters } from '../shared/languages.js';
import { HttpError, LIMITS, PARTS_OF_SPEECH } from './vault.js';

const DEFAULT_MODEL = { anthropic: 'claude-opus-5-5', huggingface: 'Qwen/Qwen2.5-72B-Instruct' };
const HF_URL = 'https://router.huggingface.co/v1/chat/completions';
const MAX_CALLS = 40;
const WINDOW_MS = 10 * 60 * 1000;

const WordSuggestion = z.object({
  word: z.string().describe('The word as it should be written, with casing and spelling corrected'),
  language: z.enum(LANGUAGE_CODES).describe('The language the word is in'),
  pos: z.enum(PARTS_OF_SPEECH),
  definition: z.string().describe('Plain-language meaning in the entry language, one or two sentences, your own phrasing'),
  example: z.string().describe('One natural sentence using the word, in the entry language, from the user’s context when known'),
  pronunciation: z.string().describe('IPA, or empty if the user is unlikely to need it'),
  translations: z.array(z.object({ language: z.enum(LANGUAGE_CODES), text: z.string() })).describe('The word in each requested target language: the most natural equivalent, in that language’s own script'),
  synonyms: z.array(z.string()).describe('Same meaning in the same sense, in the entry language; empty if none fit'),
  antonyms: z.array(z.string()).describe('Opposite meaning; empty if none fit'),
  related: z.array(z.string()).describe('Words worth knowing alongside it; prefer ones already in the dictionary'),
  root: z.string().describe('Origin or word family when it helps memory, e.g. "Latin idem (same) + potens (able)"; empty otherwise'),
  fields: z.array(z.string()).describe('1 to 3 topic slugs, lowercase and hyphenated; reuse existing fields where they fit'),
});

const NoteSuggestion = z.object({
  title: z.string().describe('The idea as a plain sentence under 80 characters, sentence case; keep the user’s title if it already reads that way'),
  summary: z.string().describe('The takeaway in one sentence'),
  question: z.string().describe('A recall question that tests understanding ("Why does X happen and what’s the fix?"), answerable from the body'),
  tags: z.array(z.string()).describe('2 to 4 lowercase tags; reuse existing tags where they fit'),
  domains: z.array(z.string()).describe('1 or 2 domain slugs; reuse existing ones where they fit'),
  body: z.string().describe('Markdown: 2 to 5 plain sentences on what and why, then "## Example" with a minimal fenced code block, then "## Why it matters". Under 250 words. Keep the user’s body if they wrote one, improving only its structure.'),
});

/** Shared by every prompt that may produce Arabic. */
const ARABIC_RULE = `Write every Arabic word, phrase and sentence with full harakat (tashkil): fatha, damma, kasra, sukun, shadda and tanwin, in Modern Standard Arabic. Single words and short phrases take the pausal form (no final case ending); full sentences take case endings.`;

const HARAKAT_SYSTEM = `You add harakat (tashkil) to Arabic text for a learner's personal dictionary.
${ARABIC_RULE}
Rules: return exactly one output string per input string, in the same order. Do not add, remove, replace or reorder any letter, word, space or punctuation; only insert vowel marks (and hamza on alef where Modern Standard spelling requires it). Text in other scripts inside a string stays untouched. If a string has several plausible readings, choose the one that fits a software or business context.`;

const Vocalized = z.object({ texts: z.array(z.string()).describe('The input strings with harakat added, same count and order') });

const WORD_SYSTEM = `You complete entries in a personal dictionary that a software engineer keeps for words and terms met while working: programming jargon, business vocabulary, and words from languages they are learning.
Write definitions in your own plain words, not copied from a dictionary. Examples should sound like something said at work. Synonyms and antonyms only in the same sense as the definition. Translations are the natural equivalent a native speaker would use, in the target language's own script. Return every field; use empty strings or arrays where nothing fits.
${ARABIC_RULE}`;

const NOTE_SYSTEM = `You help a software engineer keep a knowledge graph of things learned while working with AI tools. Each note is one atomic idea a strong practitioner would be expected to know.
Write for the user months from now with no memory of today: no "we", no "in this session". Plain language, correct technical detail, a minimal runnable example. If the user has already written parts of the note, keep their wording and fill in only what is missing or clearly improve structure. Return every field.
${ARABIC_RULE}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** First JSON object in a model reply, tolerating code fences and chatter around it. */
function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in the reply');
  return JSON.parse(candidate.slice(start, end + 1));
}

// ---------- providers ----------

function anthropicProvider({ apiKey, baseURL, model }) {
  const client = new Anthropic({ apiKey, baseURL: baseURL || undefined, maxRetries: 2, timeout: 60_000 });
  return async (system, schema, payload) => {
    let response;
    try {
      // fallbacks "default": a safety-classifier decline is re-run on Anthropic's recommended model.
      response = await client.beta.messages.parse({
        model,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: zodOutputFormat(schema) },
        system,
        messages: [{ role: 'user', content: JSON.stringify(payload, null, 2) }],
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new HttpError(502, "The Claude API key isn't valid. Check SLIPBOX_AI_API_KEY on the server.");
      if (e instanceof Anthropic.RateLimitError) throw new HttpError(503, 'The Claude API is rate-limited right now. Try again in a moment.');
      if (e instanceof Anthropic.APIConnectionError) throw new HttpError(503, "Can't reach the Claude API.");
      if (e instanceof Anthropic.APIError) throw new HttpError(502, `The Claude API answered with an error (${e.status}).`);
      throw e;
    }
    if (response.stop_reason === 'refusal') throw new HttpError(502, 'The AI declined to fill this in.');
    if (response.stop_reason === 'max_tokens') throw new HttpError(502, 'The AI answer was cut off. Try again.');
    if (!response.parsed_output) throw new HttpError(502, "The AI answer couldn't be read. Try again.");
    return response.parsed_output;
  };
}

function huggingFaceProvider({ token, model }) {
  const call = async (messages) => {
    const res = await fetch(HF_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: 2500, temperature: 0.2, response_format: { type: 'json_object' } }),
      signal: AbortSignal.timeout(90_000),
    }).catch((e) => {
      throw new HttpError(503, `Can't reach Hugging Face (${e.name === 'TimeoutError' ? 'timed out' : e.message}).`);
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new HttpError(502, "The Hugging Face token isn't valid. Check SLIPBOX_HF_TOKEN on the server.");
    if (res.status === 402) throw new HttpError(503, "This month's free Hugging Face credit is used up. It resets monthly; a PRO plan or a Claude key raises the limit.");
    if (res.status === 429) throw new HttpError(503, 'Hugging Face is rate-limited right now. Try again in a moment.');
    if (res.status === 503) throw new HttpError(503, 'The Hugging Face model is loading. Try again in a minute.');
    if (!res.ok) throw new HttpError(502, `Hugging Face answered with an error (${res.status}${data?.error ? `: ${typeof data.error === 'string' ? data.error : data.error.message ?? ''}` : ''}).`);
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new HttpError(502, 'Hugging Face returned no text.');
    return text;
  };

  return async (system, schema, payload) => {
    const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
    const messages = [
      { role: 'system', content: `${system}\n\nAnswer with one JSON object only, no prose, matching this JSON schema exactly:\n${jsonSchema}` },
      { role: 'user', content: JSON.stringify(payload, null, 2) },
    ];
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await call(messages);
      try {
        const parsed = schema.safeParse(extractJson(text));
        if (parsed.success) return parsed.data;
        lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      } catch (e) {
        lastError = e.message;
      }
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `That did not match the schema (${lastError}). Reply again with only the corrected JSON object.` });
      await sleep(300);
    }
    throw new HttpError(502, `The AI answer couldn't be read (${lastError}). Try again.`);
  };
}

// ---------- the service ----------

export function createAi({ provider, anthropicKey, anthropicBaseUrl, huggingFaceToken, model, vault, targets }) {
  const chosen = provider || (anthropicKey ? 'anthropic' : huggingFaceToken ? 'huggingface' : null);
  if (chosen === 'anthropic' && !anthropicKey) console.warn('SLIPBOX_AI_PROVIDER=anthropic but SLIPBOX_AI_API_KEY is not set; AI fill is off.');
  if (chosen === 'huggingface' && !huggingFaceToken) console.warn('SLIPBOX_AI_PROVIDER=huggingface but SLIPBOX_HF_TOKEN is not set; AI fill is off.');
  const ready = (chosen === 'anthropic' && anthropicKey) || (chosen === 'huggingface' && huggingFaceToken);
  if (!ready) return { enabled: false, provider: null, model: null, targets };

  const modelId = model || DEFAULT_MODEL[chosen];
  const ask = chosen === 'anthropic' ? anthropicProvider({ apiKey: anthropicKey, baseURL: anthropicBaseUrl, model: modelId }) : huggingFaceProvider({ token: huggingFaceToken, model: modelId });
  const calls = new Map(); // ip -> timestamps

  const allow = (ip) => {
    const now = Date.now();
    const recent = (calls.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_CALLS) throw new HttpError(429, `That's ${MAX_CALLS} AI fills in 10 minutes. Take a short break.`);
    recent.push(now);
    calls.set(ip, recent);
  };

  /**
   * Adds harakat to each string. A result is kept only if it has the same letters as
   * the input, so a model that "corrects" a word can't change what the user wrote.
   */
  async function vocalize(texts) {
    const out = [...texts];
    const todo = texts.map((t, i) => ({ t, i })).filter(({ t }) => hasArabic(t));
    let rejected = 0;
    for (let start = 0; start < todo.length; start += 40) {
      const batch = todo.slice(start, start + 40);
      const { texts: result } = await ask(HARAKAT_SYSTEM, Vocalized, { task: 'Add harakat to each string.', texts: batch.map((b) => b.t) });
      batch.forEach(({ t, i }, k) => {
        const v = typeof result[k] === 'string' ? result[k].trim() : '';
        if (v && result.length === batch.length && sameLetters(t, v)) out[i] = v;
        else rejected++;
      });
    }
    return { texts: out, rejected };
  }

  return {
    enabled: true,
    provider: chosen,
    model: modelId,
    targets,

    /** POST /api/ai/harakat: vowel up to 60 strings at once. */
    async harakat(ip, texts) {
      allow(ip);
      if (!Array.isArray(texts) || !texts.length) throw new HttpError(400, 'Send { "texts": [ … ] }');
      if (texts.length > 60) throw new HttpError(400, 'At most 60 strings at once.');
      const clean = texts.map((t) => String(t ?? ''));
      if (clean.some((t) => t.length > LIMITS.field)) throw new HttpError(400, `Each string must be under ${LIMITS.field} characters.`);
      return vocalize(clean);
    },

    /**
     * Adds harakat to every Arabic string in the dictionary that has none: Arabic
     * translations of every entry, and all text of entries whose language is Arabic.
     */
    async vocalizeDictionary(ip) {
      allow(ip);
      const { words } = await vault.load();
      const jobs = []; // { id, path: [field] | [field, key|index], text }
      for (const w of words) {
        const arEntry = w.language === 'ar';
        if (arEntry) {
          for (const k of ['word', 'definition', 'example']) if (needsHarakat(w[k])) jobs.push({ id: w.id, path: [k], text: w[k] });
          for (const k of ['synonyms', 'antonyms', 'related']) w[k].forEach((t, i) => needsHarakat(t) && jobs.push({ id: w.id, path: [k, i], text: t }));
        }
        for (const [code, t] of Object.entries(w.translations)) if (needsHarakat(t)) jobs.push({ id: w.id, path: ['translations', code], text: t });
      }
      if (!jobs.length) return { words: 0, strings: 0, rejected: 0 };
      const { texts, rejected } = await vocalize(jobs.map((j) => j.text));

      const patches = new Map();
      jobs.forEach((job, n) => {
        if (texts[n] === job.text) return;
        const w = words.find((x) => x.id === job.id);
        const patch = patches.get(job.id) ?? {};
        const [field, key] = job.path;
        if (field === 'translations') patch.translations = { ...(patch.translations ?? w.translations), [key]: texts[n] };
        else if (key !== undefined) {
          patch[field] = [...(patch[field] ?? w[field])];
          patch[field][key] = texts[n];
        } else patch[field] = texts[n];
        patches.set(job.id, patch);
      });
      // The headword last: renaming it moves the file and rewrites references.
      for (const [id, patch] of patches) {
        const { word, ...rest } = patch;
        let current = id;
        if (Object.keys(rest).length) current = (await vault.updateWord(current, rest)).id;
        if (word) await vault.updateWord(current, { word });
      }
      return { words: patches.size, strings: jobs.length - rejected, rejected };
    },

    /** Complete a dictionary entry from a word and whatever else the user typed. */
    async word(ip, input) {
      allow(ip);
      const word = String(input.word ?? '').trim();
      if (!word) throw new HttpError(400, 'Type the word first.');
      if (word.length > LIMITS.word) throw new HttpError(400, 'That word is too long.');
      const { words } = await vault.load();
      const fields = await vault.wordFieldCounts();
      const wanted = [...new Set((Array.isArray(input.targets) ? input.targets : targets).map(String))].filter((c) => LANGUAGE_CODES.includes(c));
      const result = await ask(WORD_SYSTEM, WordSuggestion, {
        task: `Complete this dictionary entry. Fill every field; keep what the user already wrote unless it is clearly wrong. Give translations for: ${wanted.map((c) => `${c} (${languageName(c)})`).join(', ')}. Skip the entry's own language.`,
        entry: {
          word,
          language: input.language || 'detect from the word',
          pos: input.pos || undefined,
          definition: input.definition || undefined,
          example: input.example || undefined,
          synonyms: input.synonyms?.length ? input.synonyms : undefined,
          antonyms: input.antonyms?.length ? input.antonyms : undefined,
          related: input.related?.length ? input.related : undefined,
          root: input.root || undefined,
          fields: input.fields?.length ? input.fields : undefined,
          translations: input.translations && Object.keys(input.translations).length ? input.translations : undefined,
        },
        existing_fields: fields.slice(0, 40).map((f) => f.field),
        words_already_in_dictionary: words.slice(0, 400).map((w) => w.word),
      });
      return {
        ...result,
        translations: Object.fromEntries(result.translations.filter((t) => t.text.trim() && t.language !== result.language).map((t) => [t.language, t.text.trim()])),
      };
    },

    /** Complete a note: summary, recall question, tags, domains, and a body if the user hasn't written one. */
    async note(ip, input) {
      allow(ip);
      const title = String(input.title ?? '').trim();
      const body = String(input.body ?? '').trim();
      if (!title && !body) throw new HttpError(400, 'Give the note a title, or write something in the body, first.');
      if (body.length > 20_000) throw new HttpError(400, 'The body is too long for AI fill. Shorten it or fill the fields yourself.');
      const { notes, domains } = await vault.load();
      const tags = await vault.tags();
      const words = (title + ' ' + body).toLowerCase();
      return ask(NOTE_SYSTEM, NoteSuggestion, {
        task: 'Complete this note. Keep the user’s wording where it exists.',
        note: {
          title: title || undefined,
          body: body || undefined,
          summary: input.summary || undefined,
          question: input.question || undefined,
          tags: input.tags?.length ? input.tags : undefined,
          domains: input.domains?.length ? input.domains : undefined,
          source: input.source || undefined,
        },
        existing_domains: domains.map((d) => ({ slug: d.slug, name: d.name })),
        existing_tags: tags.slice(0, 60).map((t) => t.tag),
        titles_of_related_notes: notes
          .filter((n) => n.title.toLowerCase().split(/\W+/).some((w) => w.length > 3 && words.includes(w)))
          .slice(0, 20)
          .map((n) => n.title),
      });
    },
  };
}
