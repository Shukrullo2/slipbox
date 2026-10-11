---
title: Running totals with window functions
domains: [sql]
tags: [window-functions, analytics]
summary: "SUM(x) OVER (ORDER BY ...) gives a running total without a self-join or subquery."
question: "How do you compute a running total per customer in a single SELECT?"
source: "Sample note"
created: 2026-08-18
sr-due: 2026-09-29
sr-interval: 5
sr-ease: 250
---

An aggregate becomes a **window function** when you add `OVER (...)`. Rows are not collapsed: each row keeps its own values and gets the aggregate computed over its *window*.

```sql
SELECT
  customer_id,
  ordered_at,
  amount,
  SUM(amount) OVER (
    PARTITION BY customer_id
    ORDER BY ordered_at
  ) AS running_total
FROM orders;
```

- `PARTITION BY` restarts the total for each customer.
- `ORDER BY` inside `OVER` makes the frame "start of partition up to this row".

> [!warning]
> With `ORDER BY` the default frame is `RANGE`, so rows that tie on `ordered_at` are summed together. Add `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` when you need a strict row-by-row total.

## Why it matters
Replaces correlated subqueries that are O(n²) and hard to read. The same pattern gives moving averages, rank, and `LAG`/`LEAD` comparisons.
