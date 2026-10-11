---
title: Read EXPLAIN ANALYZE from the innermost node out
domains: [sql]
tags: [performance, postgres]
summary: "Plans execute leaves-first. Compare estimated rows to actual rows to find where the planner guessed wrong."
question: "In a Postgres query plan, where do you look first and what number tells you the statistics are off?"
source: "Sample note"
created: 2026-09-16
---

`EXPLAIN ANALYZE` actually runs the query and annotates each plan node with real timings and row counts.

- The most indented nodes run first; their output feeds the parent.
- Each node shows `rows=` twice: the **estimate** (in the cost part) and the **actual** (in the `actual` part). A gap of 10× or more usually explains a bad join choice.
- `loops=N` means the node ran N times; multiply its time by `loops`.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...;
```

> [!tip]
> Wrap data-modifying statements in `BEGIN; ... ROLLBACK;` since ANALYZE executes them for real.

When estimates are badly off, run `ANALYZE table_name;` to refresh statistics before reaching for indexes.
