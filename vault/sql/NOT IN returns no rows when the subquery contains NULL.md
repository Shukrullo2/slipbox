---
title: NOT IN returns no rows when the subquery contains NULL
domains: [sql]
tags: [nulls, subqueries, gotcha]
summary: "One NULL in the NOT IN list makes every comparison UNKNOWN, so nothing matches. Use NOT EXISTS."
question: "Why can `WHERE id NOT IN (SELECT ...)` silently return zero rows, and what should you write instead?"
source: "Sample note"
created: 2026-09-02
sr-due: 2026-09-28
sr-interval: 3
sr-ease: 235
---

`x NOT IN (a, b, NULL)` expands to `x <> a AND x <> b AND x <> NULL`. The last term is `UNKNOWN`, so the whole predicate can never be `TRUE`, and the query returns nothing without an error.

```sql
-- Returns 0 rows if any invoice has customer_id = NULL
SELECT * FROM customers
WHERE id NOT IN (SELECT customer_id FROM invoices);

-- Correct anti-join
SELECT * FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM invoices i WHERE i.customer_id = c.id
);
```

## Why it matters
The bug only appears once a nullable column gets its first NULL, often months after the query was written. `NOT EXISTS` is also what the planner turns into an efficient anti-join.

Related: [[COUNT on a column skips NULL values]]
