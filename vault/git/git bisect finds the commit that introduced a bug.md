---
title: git bisect finds the commit that introduced a bug
domains: [git]
tags: [debugging]
summary: "Binary search over history: mark one good and one bad commit, test the midpoints, and git narrows it down in log2(n) steps."
question: "How do you find which of 400 commits broke a test, without reading them?"
source: "Sample note"
created: 2026-09-29
---

```bash
git bisect start
git bisect bad                 # current commit is broken
git bisect good v2.3.0         # this tag was fine
# git checks out a midpoint; test it, then:
git bisect good               # or: git bisect bad
git bisect reset               # when done
```

Automate it when you have a command that exits non-zero on failure:

```bash
git bisect run pytest tests/test_invoices.py -x
```

400 commits take about 9 steps.

Related: [[git reflog recovers commits after a bad reset]]
