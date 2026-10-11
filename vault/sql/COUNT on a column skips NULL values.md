---
title: COUNT on a column skips NULL values
domains: [sql]
tags: [nulls, aggregates]
summary: "COUNT(*) counts rows; COUNT(col) counts non-NULL values of col."
question: "What's the difference between COUNT(*) and COUNT(email)?"
source: "Sample note"
created: 2026-09-02
---

- `COUNT(*)` counts rows, whatever they contain.
- `COUNT(col)` counts rows where `col IS NOT NULL`.
- `COUNT(DISTINCT col)` counts distinct non-NULL values.

```sql
SELECT
  COUNT(*)              AS users,
  COUNT(email)          AS users_with_email,
  COUNT(*) - COUNT(email) AS missing_email
FROM users;
```

After a `LEFT JOIN`, count a column from the right-hand table to count matches: `COUNT(o.id)` gives 0 for customers with no orders, while `COUNT(*)` would give 1.

Related: [[NOT IN returns no rows when the subquery contains NULL]]
