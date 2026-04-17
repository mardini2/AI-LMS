# Syllentra

Syllentra is a local-first LMS: courses, modules, and content with student submissions, grading, file uploads, and AI coaching powered by [Ollama](https://ollama.com) on your machine.

## what is in this repo

- **`apps/api`**: NestJS REST API (JWT auth, RBAC, Prisma/PostgreSQL, local Ollama for coaching and student guidance)
- **`apps/web`**: React + Vite SPA (TanStack Query, React Router)
- **`docs`**: architecture notes and route list (`docs/architecture.md`, `docs/api-routes.md`)
- **`docker-compose.yml`**: optional local stack (PostgreSQL, Ollama, API, web containers)

## requirements

- Node.js **20+**
- npm **10+**
- Docker Desktop (or Docker Engine + Compose), for PostgreSQL
- [Ollama](https://ollama.com/download), for AI features (coaching and “explain this task” guidance)

## first-time setup

### 0) Environment files

Copy the examples, then edit values (especially `JWT_SECRET`):

```bash
copy apps\api\.env.example apps\api\.env
copy apps\web\.env.example apps\web\.env
```

Generate a strong `JWT_SECRET` in PowerShell:

```powershell
[Convert]::ToBase64String((1..64 | ForEach-Object { Get-Random -Maximum 256 }))
```

Put the result in `apps/api/.env`:

```env
JWT_SECRET=your_generated_value_here
```

Default AI model in `.env` is **`llama3.2:1b`** (set `OLLAMA_MODEL` if you use something else).

### 1) Install dependencies

```bash
npm install
```

### 2) Optional: Nest platform adapter (workspace safety)

```bash
npm install @nestjs/platform-express
```

### 3) Clean database volume (optional fresh start)

```bash
docker compose down -v
```

### 4) Start PostgreSQL

```bash
docker compose up -d postgres
```

Postgres is exposed at **`localhost:55432`** (see `DATABASE_URL` in `apps/api/.env.example`).

### 5) Migrations and seed

```bash
npm run db:migrate
npm run db:seed
```

This creates sample users, a course, a module, and published content for local testing.

### 6) Ollama and the model

The API reads `OLLAMA_BASE_URL` and `OLLAMA_MODEL` from `apps/api/.env`. This repo defaults to **`llama3.2:1b`** (small and fast on modest hardware).

1. Install Ollama and ensure the app/service is running.
2. Pull the model:

```bash
ollama pull llama3.2:1b
```

3. Quick check:

```bash
ollama run llama3.2:1b "hello"
```

### 7) Run the app

```bash
npm run dev
```

- API: [http://localhost:3000](http://localhost:3000) (health: `/health`)
- Web: [http://localhost:5173](http://localhost:5173) (Vite proxies `/api` to the API in dev)

## One-shot command sequence

```bash
npm install
docker compose down -v
docker compose up -d postgres
npm run db:migrate
npm run db:seed
ollama pull llama3.2:1b
npm run dev
```

## Seeded accounts

| Role        | Email                      | Password        |
|------------|----------------------------|-----------------|
| Admin      | `admin@syllentra.local`    | `Admin123!`     |
| Instructor | `instructor@syllentra.local` | `Instructor123!` |
| Reviewer   | `reviewer@syllentra.local` | `Reviewer123!`  |
| Student    | `student@syllentra.local`  | `Student123!`   |

## Useful links

- Web app: [http://localhost:5173](http://localhost:5173)
- API health: [http://localhost:3000/health](http://localhost:3000/health)

## Troubleshooting

- **Database connection errors**: ensure `docker compose up -d postgres` is running and `DATABASE_URL` matches the port (`55432` for the default compose mapping).
- **AI endpoints fail**: ensure Ollama is running and **`ollama pull llama3.2:1b`** has completed; confirm `OLLAMA_MODEL` and `OLLAMA_BASE_URL` in `apps/api/.env`.
- **Port already in use**: stop other processes on `3000` / `5173`, or adjust ports in your env and Vite config.

## Docker Compose (full stack)

You can run API + web + Postgres + Ollama via Compose; see `docker-compose.yml` and set `JWT_SECRET` and any URLs for container networking. For day-to-day dev, running Postgres in Docker and `npm run dev` on the host is usually simplest.
