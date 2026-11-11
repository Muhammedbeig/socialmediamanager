# 1. One repo holds the web app and the background service

Date: 2026-11-11

## Decision

The Next.js app, the background service (`service/`), the docs and the glossary live in one git
repo with one `package.json`, rooted at the project folder. Database access uses Drizzle ORM, with
SQL migrations committed under `src/db/migrations`.

## Why

- The service and the web app share the schema, the Connectors and the job handlers. One package
  means no cross-package builds for a tool with one developer.
- AGENTS.md and GLOSSARY.md sit beside the code they govern, so they are versioned with it.
- Drizzle keeps the schema in TypeScript, generates plain SQL migrations that can be read in
  review, and adds no runtime engine. pg-boss shares the same PostgreSQL database.
