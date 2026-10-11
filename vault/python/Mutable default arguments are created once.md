---
title: Mutable default arguments are created once
domains: [python]
tags: [gotcha, functions]
summary: "Defaults are evaluated at def time, so a default list is shared across calls. Use None and create inside."
question: "Why does `def add(item, bucket=[])` keep items from previous calls?"
source: "Sample note"
created: 2026-08-11
sr-due: 2026-09-27
sr-interval: 8
sr-ease: 250
---

Default values are evaluated **once**, when the `def` statement runs. A mutable default (`[]`, `{}`, `set()`) is one shared object.

```python
def add(item, bucket=[]):      # shared list
    bucket.append(item)
    return bucket

add(1)  # [1]
add(2)  # [1, 2]  surprise

def add(item, bucket=None):    # fix
    if bucket is None:
        bucket = []
    bucket.append(item)
    return bucket
```

The same applies to dataclasses, which is why `field(default_factory=list)` exists.
