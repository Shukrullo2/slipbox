---
title: Debug-print with the f-string = specifier
domains: [python]
tags: [debugging, strings]
summary: "f\"{expr=}\" prints both the expression and its value."
question: "What's the shortest way to print a variable's name and value in Python 3.8+?"
source: "Sample note"
created: 2026-08-25
sr-due: 2026-10-14
sr-interval: 20
sr-ease: 265
---

Adding `=` after an expression in an f-string prints the expression text, then its `repr`:

```python
user_id = 42
items = ["a", "b"]
print(f"{user_id=} {len(items)=}")
# user_id=42 len(items)=2

print(f"{price=:.2f}")   # format specs still work after =
```

Faster than typing `print("user_id", user_id)` and it survives renames made by your editor.
