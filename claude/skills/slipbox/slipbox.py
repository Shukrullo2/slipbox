#!/usr/bin/env python3
"""Talk to Slipbox from a Claude skill. Standard library only; Python 3.8+.

  python3 slipbox.py check                          # test the connection
  python3 slipbox.py domains | tags | stats
  python3 slipbox.py search "window function"       # --domain sql --tag gotcha --since 2026-09-01 --limit 10
  python3 slipbox.py get "sql/Some note title"      # full note with links and backlinks
  python3 slipbox.py related "sql/Some note title"
  python3 slipbox.py create note.md                 # new note (- reads stdin)
  python3 slipbox.py append "sql/Some note" more.md
  python3 slipbox.py update "sql/Some note" --add-tag perf --question "..."   # or: update ID changes.md
  python3 slipbox.py delete "sql/Some note"         # moves it to the trash
  python3 slipbox.py due                            # today's review queue
  python3 slipbox.py grade "sql/Some note" good     # again | hard | good | easy

  python3 slipbox.py words "query"                  # dictionary search (--field, --pos, --language, --letter)
  python3 slipbox.py word idempotent                # one entry
  python3 slipbox.py add-word entry.md              # add a word (frontmatter: word, pos, definition, …)
  python3 slipbox.py update-word "words/idempotent" changes.md

Settings: SLIPBOX_URL / SLIPBOX_API_KEY from the environment, else from
~/.config/slipbox/credentials (KEY=VALUE lines), else the values baked into this file.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

CREDENTIALS_FILE = os.path.join(os.path.expanduser("~"), ".config", "slipbox", "credentials")


def _credentials():
    """KEY=VALUE lines from ~/.config/slipbox/credentials, if it exists."""
    out = {}
    try:
        with open(CREDENTIALS_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    out[k.strip()] = v.strip()
    except OSError:
        pass
    return out


_CREDS = _credentials()
SLIPBOX_URL = os.environ.get("SLIPBOX_URL") or _CREDS.get("SLIPBOX_URL") or "{{SLIPBOX_URL}}"
SLIPBOX_URL = SLIPBOX_URL.rstrip("/")
SLIPBOX_API_KEY = os.environ.get("SLIPBOX_API_KEY") or _CREDS.get("SLIPBOX_API_KEY") or "{{SLIPBOX_API_KEY}}"


def fail(message, code=1):
    print(f"Error: {message}", file=sys.stderr)
    sys.exit(code)


def call(method, path, query=None, body=None, content_type=None):
    if "{{" in SLIPBOX_URL or "{{" in SLIPBOX_API_KEY:
        fail(f"no Slipbox address or API key. Put SLIPBOX_URL=… and SLIPBOX_API_KEY=… in {CREDENTIALS_FILE}.")
    url = SLIPBOX_URL + path
    if query:
        url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
    req = urllib.request.Request(url, data=body.encode("utf-8") if body is not None else None, method=method)
    req.add_header("Authorization", f"Bearer {SLIPBOX_API_KEY}")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "slipbox-skill/1.0")
    if content_type:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw or "{}")
        except ValueError:
            # Slipbox always answers in JSON, so something in between (a proxy) replied.
            fail(blocked(f"HTTP {e.code} {e.reason}: {raw.strip()[:160]}"))
        return e.code, payload
    except urllib.error.URLError as e:
        fail(blocked(str(e.reason)))


def blocked(detail):
    host = urllib.parse.urlparse(SLIPBOX_URL).hostname
    return (
        f"the request never reached Slipbox ({detail}).\n"
        f"If this runs inside the Claude app, its sandbox isn't allowed to connect to {host}. "
        f"An organization admin can add {host} to the allowed domains for code execution; "
        "otherwise use the skill from Claude Code on the laptop, where it runs locally."
    )


def ok_or_fail(status, payload):
    if status == 401:
        fail("Slipbox rejected the API key. It may have been revoked.")
    if status >= 400:
        fail(payload.get("error", f"request failed with status {status}"))
    return payload


def read_text(path):
    if path == "-":
        return sys.stdin.read()
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError as e:
        fail(f"can't read {path}: {e.strerror}")


def show(data):
    print(json.dumps(data, indent=2, ensure_ascii=False))


BRIEF = ("id", "title", "domains", "tags", "summary")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Save, search, review and update notes in Slipbox.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, text in (("check", "test the connection"), ("domains", "domains with note counts"), ("tags", "tags with note counts"), ("stats", "totals, due today, streak")):
        sub.add_parser(name, help=text)
    p = sub.add_parser("search", help="find notes by keywords and filters")
    p.add_argument("query", nargs="?", default="")
    p.add_argument("--domain")
    p.add_argument("--tag")
    p.add_argument("--since", help="captured on or after YYYY-MM-DD")
    p.add_argument("--until", help="captured on or before YYYY-MM-DD")
    p.add_argument("--sort", choices=["relevance", "created", "updated", "title"])
    p.add_argument("--limit", type=int, default=10)
    p = sub.add_parser("get", help="one note with links and backlinks")
    p.add_argument("id")
    p = sub.add_parser("related", help="notes worth linking to this one")
    p.add_argument("id")
    p.add_argument("--limit", type=int, default=5)
    p = sub.add_parser("create", help="save a new note from a Markdown file (frontmatter + body)")
    p.add_argument("file", help="path to the note, or - for stdin")
    p = sub.add_parser("append", help="add Markdown to the end of a note")
    p.add_argument("id")
    p.add_argument("file", help="path to the text, or - for stdin")
    p = sub.add_parser("update", help="change fields of a note")
    p.add_argument("id")
    p.add_argument("file", nargs="?", help="optional Markdown file whose frontmatter/body replace the note's")
    p.add_argument("--title")
    p.add_argument("--domains", help="comma-separated slugs; replaces all")
    p.add_argument("--add-tag", action="append", default=[])
    p.add_argument("--remove-tag", action="append", default=[])
    p.add_argument("--summary")
    p.add_argument("--question")
    p.add_argument("--source")
    p = sub.add_parser("delete", help="move a note to the trash")
    p.add_argument("id")
    p = sub.add_parser("due", help="today's review queue")
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--new", type=int, default=10, help="how many never-reviewed notes to include")
    p = sub.add_parser("grade", help="record a review: again (forgot), hard, good, easy")
    p.add_argument("id")
    p.add_argument("grade", choices=["again", "hard", "good", "easy"])
    p = sub.add_parser("words", help="search the dictionary")
    p.add_argument("query", nargs="?", default="")
    p.add_argument("--field")
    p.add_argument("--pos", choices=["noun", "verb", "adjective", "adverb", "phrase", "abbreviation", "other"])
    p.add_argument("--language", help="ISO code of the language the word is in, e.g. uz")
    p.add_argument("--letter")
    p.add_argument("--limit", type=int, default=20)
    p = sub.add_parser("word", help="one dictionary entry")
    p.add_argument("word", help="the word itself, or its id")
    p = sub.add_parser("add-word", help="add a word from a Markdown file (frontmatter: word, pos, definition, example, synonyms, …)")
    p.add_argument("file", help="path, or - for stdin")
    p = sub.add_parser("update-word", help="change fields of an entry from a Markdown file")
    p.add_argument("id")
    p.add_argument("file", help="path, or - for stdin")
    args = parser.parse_args()
    cmd = args.command

    if cmd == "check":
        data = ok_or_fail(*call("GET", "/api/domains"))
        print(f"Connected to {SLIPBOX_URL}. {len(data['domains'])} domains.")

    elif cmd == "domains":
        data = ok_or_fail(*call("GET", "/api/domains"))
        show([{k: d.get(k) for k in ("slug", "name", "parent", "notes")} for d in data["domains"]])

    elif cmd == "tags":
        show(ok_or_fail(*call("GET", "/api/tags"))["tags"])

    elif cmd == "stats":
        show(ok_or_fail(*call("GET", "/api/stats")))

    elif cmd == "search":
        query = {"q": args.query or None, "domain": args.domain, "tag": args.tag, "since": args.since, "until": args.until, "sort": args.sort, "limit": args.limit}
        data = ok_or_fail(*call("GET", "/api/notes", query))
        show({"total": data["total"], "notes": [{k: n.get(k) for k in BRIEF} for n in data["notes"]]})

    elif cmd == "get":
        n = ok_or_fail(*call("GET", "/api/notes", {"id": args.id}))
        show({k: n.get(k) for k in (*BRIEF, "question", "source", "body", "links", "backlinks", "unresolved", "url")})

    elif cmd == "related":
        data = ok_or_fail(*call("GET", "/api/notes/related", {"id": args.id, "limit": args.limit}))
        show([{k: n.get(k) for k in (*BRIEF, "score")} for n in data["notes"]])

    elif cmd == "create":
        status, n = call("POST", "/api/notes", body=read_text(args.file), content_type="text/markdown")
        if status == 409:
            print(f"Already exists: {n.get('existingId')}. Use append to add to it.")
            sys.exit(3)
        n = ok_or_fail(status, n)
        print(f"Created: {n['title']}\nid: {n['id']}\ndomains: {', '.join(n['domains'])}\nurl: {n['url']}")

    elif cmd == "append":
        n = ok_or_fail(*call("POST", "/api/notes/append", {"id": args.id}, read_text(args.file), "text/markdown"))
        print(f"Updated: {n['title']}\nurl: {n['url']}")

    elif cmd == "update":
        if args.file:
            n = ok_or_fail(*call("PUT", "/api/notes", {"id": args.id}, read_text(args.file), "text/markdown"))
        else:
            fields = {"title": args.title, "summary": args.summary, "question": args.question, "source": args.source}
            fields = {k: v for k, v in fields.items() if v is not None}
            if args.domains:
                fields["domains"] = [d.strip() for d in args.domains.split(",") if d.strip()]
            if args.add_tag:
                fields["add_tags"] = args.add_tag
            if args.remove_tag:
                fields["remove_tags"] = args.remove_tag
            if not fields:
                fail("nothing to change. Pass a file or options such as --title or --add-tag.")
            n = ok_or_fail(*call("PATCH", "/api/notes", {"id": args.id}, json.dumps(fields), "application/json"))
        print(f"Updated: {n['title']}\nid: {n['id']}\ntags: {', '.join(n['tags'])}\nurl: {n['url']}")

    elif cmd == "delete":
        data = ok_or_fail(*call("DELETE", "/api/notes", {"id": args.id}))
        print(f"Moved to trash: {data['trashedTo']}")

    elif cmd == "due":
        data = ok_or_fail(*call("GET", "/api/review/due", {"limit": args.limit, "new": args.new}))
        show({
            "due": data["due"],
            "new": data["new"],
            "notes": [{k: n.get(k) for k in ("id", "title", "question", "summary", "body", "firstReview")} for n in data["notes"]],
        })

    elif cmd == "words":
        query = {"q": args.query or None, "field": args.field, "pos": args.pos, "language": args.language, "letter": args.letter, "limit": args.limit}
        data = ok_or_fail(*call("GET", "/api/words", query))
        show({"total": data["total"], "words": [{k: w.get(k) for k in ("id", "word", "language", "pos", "definition", "translations", "fields")} for w in data["words"]]})

    elif cmd == "word":
        key = "id" if args.word.startswith("words/") else "word"
        w = ok_or_fail(*call("GET", "/api/words", {key: args.word}))
        show({k: w.get(k) for k in ("id", "word", "language", "pos", "fields", "definition", "example", "translations", "pronunciation", "synonyms", "antonyms", "related", "root", "body", "mentionedIn", "url")})

    elif cmd == "add-word":
        status, w = call("POST", "/api/words", body=read_text(args.file), content_type="text/markdown")
        if status == 409:
            print(f"Already in the dictionary: {w.get('existingId')}. Use update-word to change it.")
            sys.exit(3)
        w = ok_or_fail(status, w)
        print(f"Added: {w['word']} ({w['pos']})\nid: {w['id']}\nurl: {w['url']}")

    elif cmd == "update-word":
        w = ok_or_fail(*call("PUT", "/api/words", {"id": args.id}, read_text(args.file), "text/markdown"))
        print(f"Updated: {w['word']}\nid: {w['id']}\nurl: {w['url']}")

    elif cmd == "grade":
        n = ok_or_fail(*call("POST", "/api/review", {"id": args.id}, json.dumps({"grade": args.grade}), "application/json"))
        print(f"Recorded {args.grade} for: {n['title']}\nnext review: {n.get('nextReview')} (in {n.get('intervalDays')} days)")


if __name__ == "__main__":
    main()
