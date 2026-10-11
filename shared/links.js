// Wikilink parsing and resolution, shared by the server (API backlinks) and the
// client (graph, note cards) so both agree on what links where.

import { foldText } from './languages.js';

const WIKILINK_RE = /\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;

/** Link targets in a Markdown body, ignoring code. @param {string} body */
export function extractLinks(body) {
  const text = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return [...text.matchAll(WIKILINK_RE)].map((m) => m[1].trim());
}

/**
 * Resolves like Obsidian: path, then file name, then title, then aliases (case-insensitive).
 * @template {{ id: string, basename: string, title: string, aliases: string[] }} N
 * @param {N[]} notes
 * @returns {(target: string) => N | undefined}
 */
export function makeResolver(notes) {
  /** @type {Map<string, N>} */
  const lookup = new Map();
  const add = (/** @type {string} */ key, /** @type {N} */ n) => {
    const k = foldText(key.trim());
    if (k && !lookup.has(k)) lookup.set(k, n);
  };
  for (const n of notes) add(n.id, n);
  for (const n of notes) add(n.basename, n);
  for (const n of notes) add(n.title, n);
  for (const n of notes) n.aliases.forEach((a) => add(a, n));
  return (target) => lookup.get(foldText(target.replace(/\.md$/i, '').trim()));
}

/**
 * Outgoing links, backlinks and unresolved targets for every note, keyed by id.
 * @template {{ id: string, basename: string, title: string, aliases: string[], body: string }} N
 * @param {N[]} notes
 */
export function linkGraph(notes) {
  const resolve = makeResolver(notes);
  /** @type {Map<string, string[]>} */ const out = new Map();
  /** @type {Map<string, string[]>} */ const back = new Map();
  /** @type {Map<string, string[]>} */ const unresolved = new Map();
  for (const n of notes) {
    const outs = new Set();
    const missing = new Set();
    for (const target of extractLinks(n.body)) {
      const hit = resolve(target);
      if (hit && hit.id !== n.id) outs.add(hit.id);
      else if (!hit) missing.add(target);
    }
    out.set(n.id, [...outs]);
    unresolved.set(n.id, [...missing]);
    for (const t of outs) back.set(t, [...(back.get(t) ?? []), n.id]);
  }
  return { resolve, out, back, unresolved };
}
