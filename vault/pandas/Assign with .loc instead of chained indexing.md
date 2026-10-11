---
title: Assign with .loc instead of chained indexing
domains: [pandas]
tags: [indexing, copy-on-write]
summary: "df[mask][\"col\"] = v writes to a temporary copy. df.loc[mask, \"col\"] = v writes to df."
question: "Why does `df[df.age > 30][\"group\"] = \"senior\"` not change df, and what's the fix?"
source: "Sample note"
created: 2026-09-09
---

`df[mask]` returns a new object, so `df[mask]["col"] = v` modifies that temporary and throws it away. Older pandas warned with `SettingWithCopyWarning`; with Copy-on-Write (the default since pandas 3.0) chained assignment never updates the original.

```python
# Wrong: silently does nothing to df
df[df.age > 30]["group"] = "senior"

# Right: one indexing operation, rows and column together
df.loc[df.age > 30, "group"] = "senior"
```

Rule of thumb: one `.loc[rows, cols]` call per assignment.
