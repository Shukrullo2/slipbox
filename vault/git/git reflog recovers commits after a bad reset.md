---
title: git reflog recovers commits after a bad reset
domains: [git]
tags: [recovery]
summary: "The reflog records every position HEAD has been at, so 'lost' commits can be checked out again."
question: "You ran `git reset --hard HEAD~3` by mistake. How do you get the commits back?"
source: "Sample note"
created: 2026-09-24
---

Commits aren't deleted by `reset`, `rebase` or a deleted branch; they become unreachable. `git reflog` lists where `HEAD` has pointed, newest first.

```bash
git reflog
# 1a2b3c4 HEAD@{0}: reset: moving to HEAD~3
# 9f8e7d6 HEAD@{1}: commit: add retry to webhook sender

git reset --hard HEAD@{1}      # or: git branch rescue 9f8e7d6
```

Reflog entries are local and expire (90 days by default), so recover soon.

Related: [[git bisect finds the commit that introduced a bug]]
