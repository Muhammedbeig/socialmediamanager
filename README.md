# Social Publisher

Compose a Post once and publish it to every selected Channel. An internal tool that runs on the
owner's Windows 11 laptop.

- [AGENTS.md](AGENTS.md): architecture and rules
- [GLOSSARY.md](GLOSSARY.md): the project's terms
- [docs/api-keys.md](docs/api-keys.md): every API key, where to get it, and where it goes
- [docs/setup.md](docs/setup.md): what to install and configure
- [docs/first-run.md](docs/first-run.md): checking everything with your real Channels, step by step
- [docs/adr/](docs/adr/): decisions and their reasons

## Commands

```powershell
npm run dev                # web app and worker for development, at APP_URL
npm run db:setup           # apply migrations and seed the owner Member
npm test                   # tests (need TEST_DATABASE_URL); real networks are never called
npm run typecheck
npm run lint
npm run build              # production build, needed by the service
npm run service            # the service in this window (web app + worker)
npm run service:install    # start the service hidden at every Windows login
npm run service:start      # start it hidden now
npm run service:uninstall  # stop starting it at login
```

## How publishing works

- Saving a Post creates one Delivery per Channel. The worker checks every 5 seconds for due
  Deliveries and publishes each as its own job (decision record 0006).
- Retryable errors retry at about 2, 4 and 8 minutes; then the Delivery is Failed, raises an
  alert, and offers Retry. A live Delivery is never sent twice.
- Instagram and Threads fetch media from Cloudflare R2, where each file lives only for the call.
