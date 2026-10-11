# Slipbox

Knowledge-graph app. Notes are Markdown files with YAML frontmatter in a vault folder; the app is a view and editor over those files. It runs on a server (vault at `/var/lib/slipbox/vault`); `vault/` here is the local dev copy with sample content.

## Commands

- `npm run dev`: API (node --watch, port 4747) + Vite (port 5173, proxies `/api`)
- `npm start`: type-check, build to `dist/`, serve everything on 4747
- `npm run typecheck`
- `scripts/set-ai.sh huggingface|anthropic`: push the token from `~/.config/slipbox/hf-token` or `anthropic-api-key` into the server's `.env` and restart the container
- `scripts/set-telegram.sh @user,id`: put the bot token (from `~/.config/slipbox/telegram-bot-token`) and the allowed accounts into the server's `.env`, then restart the container
- `npm run deploy`: build, rsync to `$SLIPBOX_DEPLOY_HOST:/opt/slipbox`, `docker compose up -d --build` (never touches the server vault or `.env`)
- `SLIPBOX_URL=… npm run install-skill`: install the `/learn` skill to `~/.claude/skills/learn/` pointed at a server

## Layout

- `server/vault.js`: the only code that touches the file system: scan and cache, frontmatter patching that keeps key order and comments (`yaml` Document API), create, update with rename and link rewrite, trash, review.
- `server/index.js`: Express JSON API (accepts JSON or `text/markdown` notes) plus an SSE `/api/events` stream fired by `fs.watch` on the vault. Refuses a non-loopback bind without keys.
- `server/auth.js`: people sign in to the web UI with Telegram's Login Widget (payload HMAC checked against the bot token, account checked against `SLIPBOX_TELEGRAM_USERS`, re-checked on every request). Machines use API keys (`SLIPBOX_API_KEYS`, Bearer or `X-API-Key`), which don't open browser sessions while Telegram is configured. Sessions are signed cookies carrying the identity. Per-IP lockout after failed attempts.
- `server/mcp.js`: stateless Streamable HTTP MCP server at `/mcp` (header auth) and `/mcp/:key` (for Claude connectors, which can't send headers).
- `shared/srs.js`: scheduling plus the due/new rules; `shared/links.js`: wikilink parsing, resolution and the link graph. Shared by server (API) and client so both agree. Plain JS with JSDoc.
- `server/openapi.js`: the public OpenAPI 3.1 description at `/api/openapi.json`. Update it with any route change.
- `src/vault.ts`: `useVault` (load, live reload, reconnect) and `buildIndex` (link resolution, backlinks, due queue, MiniSearch index). Everything the UI derives comes from `VaultIndex`.
- `src/components/`: GraphView (react-force-graph-2d, custom canvas painting), NotePanel and DomainPanel (the index cards), NoteForm (CodeMirror with `[[` completion), ReviewView, TimelineView, CommandPalette.
- `claude/skills/slipbox/`: portable skill (SKILL.md + stdlib `slipbox.py`) for machines without connectors; `npm run package-skill` fills in the URL and a key from `~/.config/slipbox/credentials` and writes it to `~/Desktop/slipbox-skill/`. Never commit a filled-in copy.
- `claude/skills/learn/SKILL.md`: template for the Claude Code capture skill; `{{SLIPBOX_URL}}` is filled in by `install-skill` or by the public `/setup/learn/SKILL.md` route. It calls the API with `curl -K ~/.config/slipbox/curl.cfg` so keys stay out of commands. Write full curl commands in it: zsh doesn't word-split `$VAR` commands, and `-G` would move the body into the URL (use `--url-query`).

## Dictionary

- Entries are `.md` files with `type: word` in the frontmatter (by default under `words/`), parsed by `Vault.toWord`. Fields: word, pos (`PARTS_OF_SPEECH`), fields, definition, example, translation, pronunciation, synonyms, antonyms, related, root, source. Relations are stored as plain words and resolved by lowercase match at read time (`wordDetail` on the server, `buildIndex` on the client); renaming a word rewrites the lists in other entries.
- `shared/srs.js` rules apply unchanged. `sr-reviews` counts reviews; `wordSide()` uses its parity so the card alternates between asking for the meaning and asking for the word.
- `src/components/WordWheel.tsx` is the dictionary graph: SVG, words on a ring alphabetically, chords by relation kind, root families chained. `DictionaryView` filters (field from the route, part of speech, letter, search) and feeds both the list and the wheel.
- Entries carry `language` (ISO code, `shared/languages.js`) and a `translations:` map keyed by code; the older single `translation:` string is read as `translations.other`. `SLIPBOX_LANGUAGES` sets the translation targets.
- `server/ai.js` is "Fill in with AI": one structured call per click, provider chosen by which key is set. Hugging Face uses the OpenAI-compatible router with JSON asked for in the prompt and validated with zod (one retry); Claude uses `client.beta.messages.parse` with `zodOutputFormat`, effort `low`, and `fallbacks: "default"`. The client fills only empty fields. Per-IP limit of 40 calls per 10 minutes.
- Arabic: every AI prompt carries `ARABIC_RULE` (full harakat). `ai.vocalize()` adds harakat in batches of 40 and keeps a result only if `sameLetters()` (letters equal after stripping marks and folding hamza seats on alef) holds. Matching everywhere (search, relations, wikilinks, duplicates) goes through `foldText()` in `shared/languages.js`, which drops case and Arabic marks. `src/script.ts` `textProps()` puts `lang="ar" dir="rtl"` on Arabic text; CSS sets it in Noto Naskh Arabic a size up.
- REST under `/api/words` and `/api/ai/*`, MCP tools `search_words`, `get_word`, `add_word`, `update_word`, `get_translation_targets`, script commands `words`, `word`, `add-word`, `update-word`.

## Conventions

- The project is a public git repo (`main`, origin `git@github.com:Shukrullo2/slipbox.git`). Commit sample vault content; never commit `.env`, keys, server addresses, `deploy/deploy.env`, `CLAUDE.local.md`, or a packaged skill with a key baked in (`~/Desktop/slipbox-skill` is outside the repo for that reason). Commits use the GitHub noreply email.
- Note id = vault-relative path without `.md`. The first domain decides the folder; the filename is the sanitized title.
- Wikilinks resolve by id, then filename, then title, then aliases (case-insensitive), the same order as `buildIndex`.
- Review state lives in the note's frontmatter as `sr-due`, `sr-interval`, `sr-ease` (ease ×100), compatible with Obsidian's spaced-repetition plugin.
- Colors are named inks (`src/palette.ts`) with separate light (engineering paper) and dark (blueprint) values; the canvas reads CSS variables, so the theme attribute is set during render in `useTheme`.
- Deleting moves to `vault/.trash/`. Never hard-delete user notes.

## Deployment

- Slipbox runs as one Docker container (`deploy/docker-compose.yml`) on an external Docker network shared with a reverse proxy that terminates HTTPS; it publishes no ports and is capped at 256 MB / 0.5 CPU. The network name and time zone come from the server's `.env` (`SLIPBOX_PROXY_NETWORK`, `SLIPBOX_TZ`) via `docker compose --env-file .env`; secrets live in that `.env` too.
- `deploy/Caddyfile.slipbox` is the site block to add to the proxy. The scripts read the target host from `deploy/deploy.env` (git-ignored; see `deploy/deploy.env.example`).
- The specifics for this checkout's server (host, proxy, paths, how to reload the proxy safely) are in `CLAUDE.local.md`, which is git-ignored. Read it before deploying or touching the server.
