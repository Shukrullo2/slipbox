---
name: slipbox
description: The user's Slipbox knowledge graph and dictionary. Save what was learned as atomic, linked notes with recall questions; add words and terms to the dictionary; search, edit and organize; and quiz the user on what's due for spaced-repetition review. Use when the user says /learn or /slipbox, "save what I learned", "add this to Slipbox", "remember this", "add X to my dictionary", "define X", "quiz me", "review my notes", or asks what their notes say about something.
---

# Slipbox

Slipbox is the user's personal knowledge graph of things they learned while working, mostly through AI tools. Each note is one idea, filed under domains (sql, python, …), and comes back in spaced-repetition review.

Everything goes through `slipbox.py`, which sits in this skill's folder. Run it with `python3` (or `python` if `python3` isn't found):

```bash
python3 <skill folder>/slipbox.py check                    # confirms the connection
python3 <skill folder>/slipbox.py domains                  # also: tags, stats
python3 <skill folder>/slipbox.py search "a few keywords"  # --domain, --tag, --since YYYY-MM-DD, --sort, --limit
python3 <skill folder>/slipbox.py get "<note id>"          # body, links, backlinks
python3 <skill folder>/slipbox.py related "<note id>"      # notes worth linking
python3 <skill folder>/slipbox.py create <note file>
python3 <skill folder>/slipbox.py append "<note id>" <file>
python3 <skill folder>/slipbox.py update "<note id>" --add-tag x --remove-tag y --title "…" --question "…"
python3 <skill folder>/slipbox.py delete "<note id>"       # moves to trash; only when the user asks
python3 <skill folder>/slipbox.py due                      # today's review queue
python3 <skill folder>/slipbox.py grade "<note id>" good   # again | hard | good | easy
python3 <skill folder>/slipbox.py words "query"            # dictionary: --field, --pos, --language, --letter
python3 <skill folder>/slipbox.py word idempotent          # one entry, with relations and the notes using it
python3 <skill folder>/slipbox.py add-word <file>          # see Dictionary below
python3 <skill folder>/slipbox.py update-word "<id>" <file>
```

The script finds the address and key in `~/.config/slipbox/credentials` (`SLIPBOX_URL=…` and `SLIPBOX_API_KEY=…`) unless they are baked in; never print, echo or repeat the key.

## 1. Choose what to capture

Look back over the conversation for what the user would need to know to do this work without you:

- techniques, commands, flags, or APIs that solved the problem
- gotchas, and the reason they bite
- debugging moves that found the cause
- design decisions and the trade-off behind them
- concepts the solution depended on

Keep 1 to 5 notes; depth beats coverage. Skip facts only true for this one project, things the user plainly already knew, and generic advice. If the user named a topic, capture only that. If nothing qualifies, say so instead of inventing notes.

## 2. Check what's already there

Run `domains`, then `search` with a few keywords for each idea.

- The same idea already exists: `append` the new angle to it instead of duplicating.
- Related notes exist: link them from the new note with `[[Exact Title]]`.
- Reuse an existing domain slug when one fits; a new slug creates a new domain.

## 3. Create each note

Write each note to its own file (for example `slipbox-note.md` in a temp folder), then run `create` on it:

```markdown
---
title: <the idea as a plain sentence, under 80 characters>
domains: [<primary-slug>, <optional-second-slug>]
tags: [<2 to 4 lowercase tags>]
summary: "<the takeaway in one sentence>"
question: "<a question future-you should answer from memory>"
source: "<where it came from, e.g. Claude on work laptop: <task in a few words>>"
---

<2 to 5 sentences in plain language: what it is and why it works.>

## Example

<a minimal, realistic code block or command with a language tag>

## Why it matters

<when it bites or pays off, and what you'd have done wrong without it>

Related: [[<Existing note title>]]
```

`create` exits with code 3 and prints the existing id when the title is already taken; append to that note instead.

Rules:

- Title: "NOT IN returns no rows when the subquery contains NULL", not "SQL NULL stuff". Sentence case.
- Domain slugs are lowercase and hyphenated (`sql`, `python`, `machine-learning`). The first is primary.
- Wrap `summary`, `question` and `source` in double quotes, since they often contain colons.
- The question should test understanding ("Why does X happen and what's the fix?"), not trivia, and be answerable from the note.
- Write for the user months from now with no memory of this chat: no "we", no "in this chat", no paths from the current project unless essential.
- Under about 250 words per note. Examples minimal but runnable.

## 4. Add to an existing note

Write the addition to a file starting with a heading such as `## More: <the new angle>`, then run `append "<note id>" <file>`.

After creating a note, run `related` on it; if a listed note is clearly connected, `append` a `Related: [[Title]]` line to one of them.

## 5. Report back

A short list: each note's title, its domain, new or updated, and its url. Don't paste the note bodies.

## Dictionary

When the user wants to add, define or look up a word or term ("add idempotent to my dictionary", "what's a good word for…", vocabulary from any language):

1. Run `word "<the word>"`. If it exists, use `update-word` with what's new instead of adding it again.
2. Write the entry to a file and run `add-word`:

```markdown
---
type: word
word: idempotent
language: en                        # the language the word is in: en, uz, ru, ar, tr, de, fr, … (ISO code)
pos: adjective                      # noun | verb | adjective | adverb | phrase | abbreviation | other
fields: [api-design]                # topic slugs; optional
definition: "Gives the same result no matter how many times it is applied."
example: "PUT is idempotent: sending the same request twice leaves the resource unchanged."
translations:                       # into the user's languages; `words --help` or /api/words/fields lists the targets
  uz: "idempotent (takroriy chaqirilganda ham bir xil natija beruvchi)"
  ru: "идемпотентный"
  ar: "مُتَكَرِّرُ النَّتِيجَة"
synonyms: [repeatable]              # only in the same sense; optional
antonyms: []
related: [side effect]              # worth seeing together; optional
root: "Latin idem (same) + potens (able)"   # when it helps memory; optional
source: "Claude on work laptop: reviewing a payments API"
---

Optional longer notes in Markdown.
```

Write all Arabic with full harakat (tashkil): fatha, damma, kasra, sukun, shadda, tanwin; single words in pausal form, sentences with case endings. The definition and example are in the entry's own language. Translations are the natural equivalent a native speaker would use, in that language's script; the default targets are English, Uzbek, Russian and Arabic (skip the entry's own language). Reply with the word, its definition and its translations, one line each.

## Quiz the user

When the user asks to review, be quizzed, or test what they remember:

1. Run `due`. Take the notes one at a time.
2. Items are notes or words. For a note, ask its question (or, if it has none, ask them to explain the idea in its title). For a word with `side: meaning`, show the word and ask what it means; with `side: word`, give the definition and ask which word it is. Don't reveal the answer yet.
3. After they answer, give the key points from the note and say plainly what they got right or missed.
4. Grade it: ask them, or judge fairly yourself. `again` = forgot, `hard` = got there with effort, `good` = remembered, `easy` = instant. Run `grade`.
5. At the end, say how many you reviewed and when the next ones are due (from `stats` or the grade output).

## If it can't connect

`check` explains the problem. A "can't reach" error inside Claude's cloud sandbox usually means the organization's network settings for code execution don't allow this address; tell the user, since only an admin can change that.
