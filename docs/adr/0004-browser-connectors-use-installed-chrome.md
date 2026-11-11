# 4. Browser Connectors drive the installed Google Chrome

Date: 2026-11-11

## Decision

Playwright launches the Google Chrome already installed on the laptop (`channel: "chrome"`),
headed, with one persistent profile folder per Channel. Playwright's own Chromium build is not
downloaded.

## Why

- The owner asked for no separate Chromium download.
- Installed Chrome is the browser a person would use, which fits the "browser stays honest"
  guardrail in AGENTS.md.
- Each Channel still gets its own profile folder, separate from the owner's personal Chrome
  profile, as the PRD requires.
