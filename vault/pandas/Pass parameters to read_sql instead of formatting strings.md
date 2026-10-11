---
title: Pass parameters to read_sql instead of formatting strings
domains: [pandas, sql]
tags: [security, databases]
summary: "Use params= so the driver escapes values; f-strings in SQL are an injection risk."
question: "How do you safely pass a user-supplied value into pd.read_sql?"
source: "Sample note"
created: 2026-09-23
---

```python
from sqlalchemy import text

df = pd.read_sql(
    text("SELECT * FROM orders WHERE customer_id = :cid AND status = :status"),
    engine,
    params={"cid": customer_id, "status": "paid"},
)
```

The driver sends the values separately from the SQL text, so quotes in the input can't change the query. It also lets the database reuse the query plan.

Never build the query with an f-string from user input, see [[SQL injection]].
