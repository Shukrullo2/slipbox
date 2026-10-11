# Slipbox

A knowledge graph for the things you learn while working with AI.

Every learning is one Markdown file (an index card). Domains like SQL or Python are the big nodes in the graph; notes cluster around them and link to each other with `[[wikilinks]]`. A spaced-repetition review brings each note back just before you'd forget it.

It runs on your own server (see [Running and deploying](#running-and-deploying)). People sign in with Telegram; only accounts on the allowed list get in, and they stay signed in for 30 days. The API and Claude use API keys instead (see [Keys](#keys)). The examples below use `https://notes.example.com` for your address.

## The daily loop

1. **Work with Claude as usual.** When a session taught you something worth keeping, say `/learn` in Claude Code, or "save what I learned to Slipbox" in the Claude app. Claude picks the few ideas worth knowing, checks for duplicates, and saves linked notes with a recall question. They appear in the open app immediately.
2. **Capture by hand** with <kbd>N</kbd> for anything you learn elsewhere.
3. **Review** with <kbd>R</kbd> once a day. Each card shows the recall question; answer from memory, reveal, then grade yourself. Intervals grow as you keep remembering (2 days, then 5, 13, about a month…). New notes join the queue the day after you capture them.

## Signing in

The web app uses Telegram's Login Widget with a bot made for Slipbox (its domain is set to this site in @BotFather). Telegram signs the login, the server checks that signature with the bot token, and then checks the account against `SLIPBOX_TELEGRAM_USERS`. That list holds numeric Telegram ids or @usernames, comma-separated; ids are safer, since usernames can change hands. Removing an account signs it out on its next request.

To set the bot token and the allowed list, or change them later:

```bash
scripts/set-telegram.sh @your_username,123456789
```

It reads the token from `~/.config/slipbox/telegram-bot-token` and restarts only the Slipbox container. If someone not on the list tries to sign in, the error shows their Telegram id, which you can add.

## Keys

Two API keys were generated at deploy time and saved on this Mac in `~/.config/slipbox/credentials` (mode 600). Keys work for the API and Claude only; they don't sign in to the web app.

- `SLIPBOX_API_KEY`: authenticates Claude Code and scripts.
- `SLIPBOX_MCP_URL`: the connector URL for the Claude apps. It contains a second key, so you can revoke it separately.

To revoke or add keys, edit `SLIPBOX_API_KEYS` (comma-separated, each at least 24 characters) in `/opt/slipbox/.env` on the server, then restart with `docker compose -f deploy/docker-compose.yml up -d` from `/opt/slipbox`. Changing the bot token signs out every browser; API keys never affect browser sessions.

## Use it from other devices

**Claude apps (web, desktop, phone):** in Settings → Connectors, choose *Add custom connector*, name it Slipbox, and paste `SLIPBOX_MCP_URL` from the credentials file. Connectors sync across your devices. Then ask Claude to "save what we learned to Slipbox", or "quiz me on my due notes". It can search, read, create, edit and link notes, run your review queue, and record grades.

**A work laptop where connectors are blocked:** `npm run package-skill` builds `~/Desktop/slipbox-skill/` with the `slipbox` skill (`SKILL.md` + `slipbox.py`, standard-library Python) and its own key, `SLIPBOX_WORK_LAPTOP_KEY`, filled in. Copy the `slipbox` folder to `~/.claude/skills/slipbox/` there for Claude Code, or upload `slipbox-skill.zip` as a skill in the Claude app if your organization allows it. `python3 slipbox.py check` tests the connection.

**Claude Code on another computer:**

```bash
mkdir -p ~/.claude/skills/learn ~/.config/slipbox
curl -fsSL https://notes.example.com/setup/learn/SKILL.md -o ~/.claude/skills/learn/SKILL.md
```

Then create `~/.config/slipbox/curl.cfg` with mode 600, containing one line with your `SLIPBOX_API_KEY`:

```
header = "Authorization: Bearer <SLIPBOX_API_KEY>"
```

The skill reads the key from that file, so it never appears in commands or chat.

## API

Base URL `https://notes.example.com`. Send `Authorization: Bearer <key>` (or `X-API-Key: <key>`) with every request. After 20 failed attempts, an IP is blocked for 15 minutes.

The full description is at [`/api/openapi.json`](https://notes.example.com/api/openapi.json) (OpenAPI 3.1), so tools and Claude can discover it.

| Method and path | What it does |
|---|---|
| `GET /api/notes?q=&domain=&tag=&since=&until=&due=&sort=&offset=&limit=` | Search and filter. Without `q`, newest first. Returns `{ total, offset, notes }`. |
| `GET /api/notes?id=…` | One note with its body, `links`, `backlinks` and `unresolved` link targets. |
| `GET /api/notes/raw?id=…` | The note file exactly as stored (`text/markdown`). |
| `GET /api/notes/related?id=…` | Notes sharing tags, a domain or title words that aren't linked yet. |
| `POST /api/notes` | Create a note. `201` with its `url`; `409` with `existingId` if the title exists (`?allow_duplicate=1` to override). |
| `POST /api/notes/batch` | Create up to 20 notes: `{ "notes": [ {…fields} or { "markdown": "…" } ] }`. |
| `PUT` or `PATCH /api/notes?id=…` | Change only the fields sent; `add_tags` / `remove_tags` too. Renaming updates every link to the note. |
| `POST /api/notes/append?id=…` | Append Markdown to the end of a note. |
| `DELETE /api/notes?id=…` | Move a note to `.trash/`. |
| `GET /api/words?q=&field=&pos=&letter=&due=&sort=&offset=&limit=` | Search the dictionary; `?word=idempotent` or `?id=` fetches one entry with resolved relations and the notes that use it. |
| `POST /api/words`, `PUT /api/words?id=…`, `DELETE /api/words?id=…` | Add (JSON or `text/markdown`), change, or remove an entry. `POST /api/words/batch` adds up to 50. |
| `GET /api/words/fields` | Fields and languages in use, the parts of speech accepted, and the translation targets. |
| `POST /api/ai/word`, `POST /api/ai/note` | Fill in with AI: send what you have, get a complete suggestion back. `GET /api/ai` says whether it's set up. |
| `POST /api/ai/harakat`, `POST /api/ai/harakat/dictionary` | Add harakat to up to 60 strings (letters verified unchanged), or to every unvowelled Arabic string in the dictionary. |
| `GET /api/review/due?limit=&new=` | Today's review queue (due first, then new): notes with questions and bodies, words with their definition and which side to ask. |
| `POST /api/review?id=…` | `{ "grade": "again" \| "hard" \| "good" \| "easy" }`. Schedules the next review. |
| `GET /api/domains`, `GET /api/domains/{slug}` | Domains with counts; one domain with its notes and sub-domains. |
| `POST /api/domains`, `PATCH /api/domains/{slug}` | Create, or rename, recolor, re-parent, describe. |
| `DELETE /api/domains/{slug}` | Delete an empty domain. |
| `GET /api/tags`, `GET /api/stats` | Tag counts; totals, due today, streak, recent activity, notes per domain. |
| `GET /api/export` | Every file as stored, for backups. |
| `POST /mcp` | MCP endpoint for Claude (Streamable HTTP), with the same abilities as tools. `POST /mcp/<key>` for clients that can't send headers. |

`POST` and `PUT` accept either JSON (`title`, `domains`, `tags`, `summary`, `question`, `source`, `body`) or a whole note as `Content-Type: text/markdown`, with frontmatter and body exactly as stored:

```bash
curl -sS -K ~/.config/slipbox/curl.cfg -X POST https://notes.example.com/api/notes \
  -H "Content-Type: text/markdown" --data-binary @note.md
```

## The dictionary

Words and terms live in their own section, separate from notes, because they behave differently. A note is one idea; a word is a point in a web of meaning.

- **Entries** hold the word and its language (English, Uzbek, Russian, Arabic, and more), its part of speech, a plain-language meaning, an example sentence, translations into your languages, optional pronunciation, synonyms, antonyms, see-also words, and the root or origin. Fields (statistics, legal…) group them.
- **Arabic carries harakat.** The AI writes Arabic fully vowelled (tashkil), and **Add harakat** in the word form vowels Arabic you typed yourself. The server checks the letters came back unchanged and keeps your text if they didn't. "Add harakat to Arabic in the dictionary" in the command palette does every entry at once. Search, links and duplicate checks ignore harakat, so «مفهوم» still finds «مَفْهُوم». Arabic is set in Noto Naskh Arabic, a size up, so the marks are readable.
- **Fill in with AI.** Type the word, press the button, and the rest is drafted: meaning, example, translations into each of your languages, synonyms, antonyms, related words, root, fields. It only fills what you left empty, so your own wording wins. The same button on a note drafts the summary, recall question, tags, domains, and a body. See [AI fill](#ai-fill).
- **The word wheel** (press <kbd>D</kbd>) puts every word on a ring in alphabetical order, like a dictionary's thumb index, and draws chords across the ring between related words: solid for synonyms, dashed red for antonyms, dotted for see-also, thin blue between words that share a root. Dots are colored by part of speech. Hover a word to see its connections; filter by letter, part of speech, field or search.
- **Review from both sides.** A word's card alternates each time it comes up: first it shows the word and asks for the meaning; next time it shows the meaning and asks for the word. The same spaced-repetition schedule applies as for notes.
- **Linked to your notes.** A word's card lists the notes that use it, and `[[idempotent]]` inside a note links to the entry.
- **Claude can fill it.** "Add idempotent to my Slipbox dictionary" works from any connected Claude; the Python skill has `add-word`, `word` and `words`.

Entries are Markdown files in `words/` with `type: word` in the frontmatter:

```markdown
---
type: word
word: idempotent
language: en
pos: adjective
fields: [api-design]
definition: "Gives the same result no matter how many times it is applied."
example: "PUT is idempotent: sending the same request twice leaves the resource unchanged."
translations:
  uz: idempotent
  ru: идемпотентный
  ar: متكرر النتيجة
synonyms: [repeatable]
related: [side effect]
root: "Latin idem (same) + potens (able)"
created: 2026-10-09
---
```

## AI fill

The server does the AI calls, so the key never reaches the browser. The live server uses the Claude API; Hugging Face is wired in as an alternative.

| | Claude API (in use) | Hugging Face |
|---|---|---|
| Cost | Pay as you go: a word fill is about a cent, a note draft about two, at low effort. | Needs inference credit on the account (free accounts currently get none without a card; PRO includes $2 a month). |
| Quality | Best: correct in Uzbek and Arabic in testing, guaranteed-valid output, refusal fallbacks on. | Good for English and Russian; weaker on Uzbek and Arabic, and the JSON occasionally needs a retry (done automatically). |
| Setup | A key from the Anthropic console, saved to `~/.config/slipbox/anthropic-api-key`. | A fine-grained token with permission to call Inference Providers, saved to `~/.config/slipbox/hf-token`. |

Then run `scripts/set-ai.sh anthropic` or `scripts/set-ai.sh huggingface` (`off` removes both). It copies the key into the server's `.env` without it appearing in any command and restarts only the Slipbox container. The buttons show "AI fill is not set up" until a key is set.

| Variable | Default | |
|---|---|---|
| `SLIPBOX_HF_TOKEN` | none | Hugging Face token. |
| `SLIPBOX_AI_API_KEY` | none | Claude API key. |
| `SLIPBOX_AI_PROVIDER` | whichever key is set (Claude wins if both) | `anthropic` or `huggingface`. |
| `SLIPBOX_AI_MODEL` | `Qwen/Qwen2.5-72B-Instruct` or `claude-opus-5-5` | Any chat model the provider serves. |
| `SLIPBOX_LANGUAGES` | `en,uz,ru,ar` | Languages to translate dictionary entries into. |

## What's in the app

| | |
|---|---|
| Graph | Domains as seals, notes as dots colored by their domain's ink. Red rings mark notes due for review. Hover to see a note's neighbours; click to open its card. |
| Note card | Rendered Markdown with highlighted code, callouts (`> [!tip]`), backlinks, links that don't exist yet (click to create), and notes that might be related. |
| Editor | Markdown editor with `[[` autocomplete for note titles. Domains and tags are dropdowns with an option to add new ones. |
| Review | Spaced repetition (a simplified SM-2) with Forgot, Hard, Good, Easy. |
| Timeline | A year of activity, and everything you learned, grouped by week. |
| Dictionary | Words on an alphabetical wheel with chords for synonyms, antonyms, see-also and shared roots. See [The dictionary](#the-dictionary). |
| Search | <kbd>⌘K</kbd> or <kbd>/</kbd>: full-text, typo-tolerant search over notes and words, plus commands. |

Shortcuts: <kbd>N</kbd> new note, <kbd>W</kbd> new word, <kbd>D</kbd> dictionary, <kbd>R</kbd> review, <kbd>G</kbd> graph, <kbd>T</kbd> timeline, <kbd>E</kbd> edit the open note, <kbd>⌘↵</kbd> save, <kbd>Esc</kbd> close. "Sign out on this device" in the command palette signs out.

## The vault

Plain Markdown files. On the server they live in `/var/lib/slipbox/vault`; the `vault/` folder in this repo is the local development copy.

```
vault/
  sql/
    _domain.md                                   # name, ink color, optional parent, description
    NOT IN returns no rows when the subquery contains NULL.md
  pandas/
    _domain.md                                   # parent: python  (a sub-domain)
```

A note:

```markdown
---
title: NOT IN returns no rows when the subquery contains NULL
domains: [sql]                  # first one decides the folder; add more to cross-link domains
tags: [nulls, gotcha]
summary: "One NULL in the list makes NOT IN match nothing. Use NOT EXISTS."
question: "Why can NOT IN (subquery) silently return zero rows?"
source: "Claude Code in billing-api: fixing a report"
created: 2026-09-02
sr-due: 2026-09-28               # written by Slipbox when you review; leave out on new notes
sr-interval: 3
sr-ease: 235
---

Body in Markdown. Link other notes with [[Their title]].
```

Set `review: false` in a note's frontmatter to keep it out of reviews. Deleted notes go to `.trash/`, and review history is logged in `.slipbox/reviews.jsonl`. The ten notes that ship are samples marked `source: "Sample note"`.

To back up the server's vault to this Mac:

```bash
rsync -az root@your-server:/var/lib/slipbox/vault/ ~/Documents/slipbox-backup/
```

## Git

The project is a git repository, so the skills under `claude/skills/` can be pulled onto any machine:

```bash
git clone git@github.com:Shukrullo2/slipbox.git
cp -r slipbox/claude/skills/slipbox ~/.claude/skills/
```

Then put the address and a key in `~/.config/slipbox/credentials` on that machine (two lines: `SLIPBOX_URL=…` and `SLIPBOX_API_KEY=…`, mode 600). The script reads that file, so nothing secret is ever in git. The sample notes and words in `vault/` are committed on purpose; the real vault lives on the server.

## Running and deploying

```bash
npm install
npm run dev          # local development: API on 4747, app on http://localhost:5173
npm run deploy       # build, ship to the server, rebuild and restart the container
```

`npm run deploy` never touches the server's vault or `.env`.

On the server, Slipbox runs as the Docker container `slipbox` (`/opt/slipbox`), capped at 256 MB of memory and half a CPU. It publishes no ports: it joins the Docker network of an existing reverse proxy, which serves it with HTTPS. [deploy/Caddyfile.slipbox](deploy/Caddyfile.slipbox) is the site block for Caddy.

First deploy:

1. Copy `deploy/deploy.env.example` to `deploy/deploy.env` and set your server and address. It's git-ignored.
2. On the server, create `/opt/slipbox/.env` (mode 600) with `SLIPBOX_API_KEYS`, `SLIPBOX_PUBLIC_URL`, `SLIPBOX_PROXY_NETWORK` (the proxy's Docker network) and optionally `SLIPBOX_TZ`, and create `/var/lib/slipbox/vault` owned by uid 1000.
3. Add the site block to your proxy, then run `npm run deploy`.

| Variable | Default | |
|---|---|---|
| `SLIPBOX_API_KEYS` | none | Comma-separated API keys. Required unless bound to localhost. |
| `SLIPBOX_TELEGRAM_BOT_TOKEN` | none | Turns on Telegram sign-in for the web app. Without it, the web app takes an API key instead. |
| `SLIPBOX_TELEGRAM_USERS` | none | Telegram ids or @usernames allowed to sign in. |
| `SLIPBOX_TELEGRAM_BOT` | looked up | The bot's username. By default it's fetched from Telegram using the token. |
| `SLIPBOX_PUBLIC_URL` | `http://localhost:4747` | Used in note links and the setup skill. |
| `SLIPBOX_PROXY_NETWORK` | none | Server `.env` only: the reverse proxy's Docker network the container joins. |
| `SLIPBOX_TZ` | `UTC` | Server `.env` only: time zone, which decides when a day's reviews roll over. |
| `SLIPBOX_VAULT` | `./vault` | Where notes live. |
| `SLIPBOX_HOST` / `SLIPBOX_PORT` | `127.0.0.1` / `4747` | Listen address. |
