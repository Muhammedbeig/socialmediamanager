# Social Publisher

An internal marketing tool: compose a Post once, publish it to every selected Channel. One Member today (the owner), built so it can launch publicly later.

- **Domain language** lives in [GLOSSARY.md](GLOSSARY.md). Use its terms in code, UI copy and commits (Channel, Delivery, Brand, Replace...), and add a term there when one is settled.
- **Product spec** is the PRD: https://claude.ai/artifact/SujFXZLdhzEFNygZ8mVShx. Read it for scope, screens, per-network limits and open questions.
- **Decisions** with their reasons go in `docs/adr/`.
- **Design** follows [DESIGN.md](DESIGN.md): the owner's Aeolyzer application look (parrot accent, Inter, flat panels). Read it before building or changing a screen.

## Architecture

- Runs entirely on the owner's Windows 11 laptop: a background service started at login, plus a full web interface on localhost.
- Stack: Next.js (TypeScript), PostgreSQL, pg-boss (job queue inside PostgreSQL), Playwright, FFmpeg.
- One job per Delivery. Deliveries are independent: each fails, retries and succeeds on its own, and a live Delivery is never sent twice.
- Post status is computed from its Deliveries.
- Scheduling uses the laptop's time zone. Jobs due while the laptop slept run on wake; each Delivery records its scheduled and actual time.
- Instagram and Threads fetch media from a public URL: upload the file to Cloudflare R2 at publish time and delete it once the Delivery is live.
- Network tokens are encrypted at rest, with the key in Windows Credential Manager.
- Alerts are Windows desktop notifications plus an in-app badge.
- No backups: an accepted risk.

## Connectors

Each network is one Connector behind a shared interface: publish, edit text, remove, and declare its capabilities (formats, limits, what it can edit). The composer and Post detail read those capabilities; network rules live only in the Connector.

- **API Connectors**: Facebook Pages, Instagram, Threads, LinkedIn, YouTube. Official APIs only.
- **Browser Connectors**: TikTok, Pinterest, X, driven by Playwright in a headed Chromium with one persistent profile per Channel.

Platform limits change often. Before building or changing a Connector, check the network's official docs (links in the PRD's Sources section).

### Browser Connector guardrails

- Always headed, at human pace: Deliveries to the same network go out one at a time, 3 minutes apart by default.
- Login checks, codes and CAPTCHAs belong to the Member. On detection, set the Delivery to Needs attention, notify, bring that Channel's window forward, wait, then resume.
- The browser stays honest: no stealth plugins, fingerprint spoofing, CAPTCHA solvers or simulated human behaviour.
- Logins happen in a plain Chrome window on the Channel's profile that the app starts but does not control, so "Sign in with Google" works. Posting windows reuse that saved session.
- Assert the page state at every step. On a mismatch, fail the Delivery as "page changed" with a screenshot and leave it for a manual retry after the script is fixed.
- Browser Connectors serve the owner's Brands only. A public launch moves these networks to their official APIs.

## Publishing rules

- The composer flags content a Channel cannot take before publishing. Format, codec and file-size conversion happen automatically; cropping and trimming only after the Member approves a preview.
- Edit changes text only. When the media changes or the network cannot edit, offer Replace or keep as is.
- Removal runs per Delivery and records its own result; the confirmation states whether each network's removal is permanent.
- Retries: API Deliveries retry 3 times over about 15 minutes; browser Deliveries resume after Needs attention; every failed Delivery has a manual Retry.
- The app manages only Posts it published.

## Build order

All networks ship together in v1, built in three slices:

1. Core app plus Facebook Pages, Instagram and Threads
2. LinkedIn and YouTube
3. Browser Connectors for TikTok, Pinterest and X
