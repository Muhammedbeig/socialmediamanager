# 2. No login screen in v1

Date: 2026-11-11

## Decision

v1 has no sign-in. The app listens on `127.0.0.1` only, and one seeded Member (the owner, Admin
role) owns every Brand and Post. The `members` table and its Admin and Editor roles exist in the
schema.

## Why

- The PRD lists sign-up and inviting Members under "Before public launch", not v1.
- The app runs on the owner's laptop and is not reachable from the network, so a login would
  protect nothing the Windows account does not already protect.
- Keeping `members` and `posts.created_by` now means adding sign-in later changes no existing data.
