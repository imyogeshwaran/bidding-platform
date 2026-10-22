---
name: Database-independent auction demo
description: The user's storage constraint for the online auction academic project.
---

Do not create or connect a database for this project. Keep the data-access boundary replaceable and use in-memory repositories for the demonstration.

**Why:** the user explicitly excluded database implementation and deployment in the project brief.

**How to apply:** do not run database setup, add schemas, or provision credentials. Explain that in-memory accounts and activity reset when the API process restarts.
