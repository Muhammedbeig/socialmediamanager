# Social Publisher

Compose a Post once and publish it to every selected Channel. An internal tool that runs on the
owner's Windows 11 laptop.

- [AGENTS.md](AGENTS.md): architecture and rules
- [GLOSSARY.md](GLOSSARY.md): the project's terms
- [docs/setup.md](docs/setup.md): what to install and configure
- [docs/adr/](docs/adr/): decisions and their reasons

## Commands

```powershell
npm run dev        # web app at https://localhost:3000
npm run db:setup   # apply migrations and seed the owner Member
npm test           # tests (need TEST_DATABASE_URL)
npm run typecheck
npm run lint
```
