---
name: learn
description: Save what was learned in this session to the user's Slipbox knowledge graph as atomic, linked notes with recall questions. Use when the user says /learn, "save what I learned", "add this to my notes", "remember this", "note this down", or asks to capture takeaways at the end of a task.
---

# Capture learnings into Slipbox

The user does most of their work through AI tools and wants to keep the professional knowledge those sessions reveal. Distill this session into a few atomic notes that a strong practitioner in the user's role would be expected to know, and save them to Slipbox. They show up in the graph right away and join the spaced-repetition review queue tomorrow.

Slipbox: `{{SLIPBOX_URL}}`

Every request authenticates with the user's key through a curl config file, `-K ~/.config/slipbox/curl.cfg`, so the key never appears in commands or output. Write the full curl command each time; shell variables and functions don't carry over between commands.

If that file is missing, stop and tell the user to create `~/.config/slipbox/curl.cfg` containing `header = "Authorization: Bearer <their key>"` (mode 600). Never ask them to paste the key into the chat.

## 1. Choose what to capture

Look back over the conversation for what the user would need to know to do this work without you:

- techniques, commands, flags, or APIs that solved the problem
- gotchas, and the reason they bite
- debugging moves that found the cause
- design decisions and the trade-off behind them
- concepts the solution depended on

Keep 1 to 5 notes; depth beats coverage. Skip facts only true for this project (file names, this repo's config), things the user plainly already knew, and generic advice ("write tests").

If the user named a topic (`/learn the window function trick`), capture only that. If nothing in the session qualifies, say so instead of inventing notes.

## 2. Check what's already there

```bash
curl -sS --fail-with-body -K ~/.config/slipbox/curl.cfg "{{SLIPBOX_URL}}/api/domains"
curl -sS --fail-with-body -K ~/.config/slipbox/curl.cfg "{{SLIPBOX_URL}}/api/notes" --url-query "q=<a few keywords>"
```

- The same idea already exists: add the new angle to it instead of duplicating (step 4).
- Related notes exist: link them from the new note with `[[Exact Title]]`.
- Reuse an existing domain slug when one fits. Use a new slug only for a genuinely separate field; Slipbox creates the domain.

## 3. Create each note

Write the note to a temp file in this format, then upload it:

```markdown
---
title: <the idea as a plain sentence, under 80 characters>
domains: [<primary-slug>, <optional-second-slug>]
tags: [<2 to 4 lowercase tags>]
summary: "<the takeaway in one sentence>"
question: "<a question future-you should answer from memory>"
source: "<Claude Code in <repo>: <task in a few words>>"
---

<2 to 5 sentences in plain language: what it is and why it works.>

## Example

<a minimal, realistic code block or command with a language tag>

## Why it matters

<when it bites or pays off, and what you'd have done wrong without it>

Related: [[<Existing note title>]]
```

```bash
curl -sS --fail-with-body -K ~/.config/slipbox/curl.cfg -X POST "{{SLIPBOX_URL}}/api/notes" \
  -H "Content-Type: text/markdown" --data-binary @/tmp/slipbox-note.md
```

A `409` response means a note with that title exists; its `existingId` is in the response. Append to it instead.

Rules:

- Title: "NOT IN returns no rows when the subquery contains NULL", not "SQL NULL stuff". Sentence case.
- Domain slugs are lowercase and hyphenated (`sql`, `python`, `machine-learning`). The first one is primary.
- Wrap `summary`, `question` and `source` in double quotes, since they often contain colons.
- The question should test understanding, not trivia: "Why does X happen and what's the fix?" beats "What is X?". It must be answerable from the note.
- Write for the user months from now with no memory of this session: no "we", no "in this session", no paths from the current repo unless essential.
- Keep each note under about 250 words. Examples should be minimal but runnable.

## 4. Add to an existing note

```bash
curl -sS --fail-with-body -K ~/.config/slipbox/curl.cfg -X POST "{{SLIPBOX_URL}}/api/notes/append" \
  --url-query "id=<note id>" -H "Content-Type: text/markdown" --data-binary @/tmp/slipbox-more.md
```

Start the appended text with a heading such as `## More: <the new angle>`.

## Dictionary entries

For a word or term the user wants to keep (jargon met during the work, vocabulary from any language), add a dictionary entry instead of a note. Check first, then add:

```bash
curl -sS --fail-with-body -K ~/.config/slipbox/curl.cfg "{{SLIPBOX_URL}}/api/words" --url-query "word=<the word>"
curl -sS --fail-with-body -K ~/.config/slipbox/curl.cfg -X POST "{{SLIPBOX_URL}}/api/words" \
  -H "Content-Type: text/markdown" --data-binary @/tmp/slipbox-word.md
```

```markdown
---
type: word
word: idempotent
language: en                   # ISO code of the word's language: en, uz, ru, ar, tr, …
pos: adjective                 # noun | verb | adjective | adverb | phrase | abbreviation | other
fields: [api-design]
definition: "Gives the same result no matter how many times it is applied."
example: "PUT is idempotent: sending the same request twice leaves the resource unchanged."
translations:                  # the user's languages: en, uz, ru, ar by default; skip the entry's own
  uz: "idempotent"
  ru: "идемпотентный"
  ar: "مُتَكَرِّرُ النَّتِيجَة"
synonyms: [repeatable]
related: [side effect]
root: "Latin idem (same) + potens (able)"
source: "Claude Code in payments-api: idempotency keys"
---
```

Arabic always with full harakat (tashkil). Definition and example in the entry's own language, in plain words; translations in each target language's own script; synonyms and antonyms only in the same sense. A `409` means it exists: update it with `PUT /api/words?id=<existingId>` and the changed fields.

## 5. Report back

Reply with a short list: each note's title, its domain, and whether it was new or an update, with the `url` from the response. Don't paste the note bodies.
