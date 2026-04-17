# API app (`apps/api`)

this is the NestJS backend for Syllentra.

## what this app handles

- auth (`/auth`)
- users/admin operations (`/users`)
- courses, modules, content, submissions
- AI coaching + student guidance routes (Ollama)
- dashboard course totals for staff
- health check (`/health`)

## run from repo root (recommended)

most setup is workspace-based, so use the root README flow first:
- install deps
- run postgres
- run migrations + seed
- pull Ollama model `llama3.2:1b` (or set `OLLAMA_MODEL` in `.env`)

then use:

```bash
npm run dev
```

that starts this API in watch mode through the root script.

## run API only

from repo root:

```bash
npm run start:dev --workspace api
```

or from this folder:

```bash
npm run start:dev
```

## API scripts

- `npm run start`: run API once
- `npm run start:dev`: run API with hot reload
- `npm run build`: build to `dist`
- `npm run test`: unit tests
- `npm run test:cov`: coverage report
- `npm run prisma:generate`: generate Prisma client
- `npm run prisma:migrate`: apply migrations (dev)
- `npm run prisma:seed`: seed demo data

## env keys used by API

- `PORT`
- `WEB_ORIGIN`
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL` (default in code: `llama3.2:1b` if unset)
