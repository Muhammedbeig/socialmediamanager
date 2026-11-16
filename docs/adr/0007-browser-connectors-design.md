# 7. How browser Connectors run

Date: 2026-11-16

## Decision

- Each TikTok, Pinterest or X Channel has its own Chrome profile folder under
  `data\browser-profiles\<channel id>`. A task opens a visible window on that profile, does one
  thing (publish, edit, remove, or log in), and closes it.
- A database lock per Channel makes sure only one task, in any process, uses that profile at a time.
- Logging in happens in the worker: adding an account marks it, and the worker opens the window at
  the login page and waits up to 15 minutes. The session is detected by the site's own login cookie.
- During any task, a missing login cookie or a verification page hands control to the Member:
  the Delivery shows Needs attention, a desktop notification fires, the window comes forward,
  and the task waits up to an hour, then carries on.
- Once the post button is pressed, a step that cannot be confirmed fails as "may or may not be
  live", never as a plain failure, so a manual Retry cannot post twice by accident.
- The dispatcher sends one Delivery at a time per browser network, spaced by the Settings value
  (3 minutes by default).

## Why

- AGENTS.md: headed, honest, human-paced, with login checks belonging to the Member.
- Short-lived windows mean nothing stays open between Posts, and a crash cannot leave a profile locked.

## Known limit

The page scripts were written without access to the owner's accounts, from the sites' structure
as known in November 2026. Expect to adjust selectors on first real use: a changed page fails with
a screenshot in `data\screenshots` that shows where.
