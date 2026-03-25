# Codename: Syllentra

Syllentra is a local AI-powered LMS support app!
it helps admins, instructors, reviewers, and students manage courses and run AI-assisted content review!

## what is in this repo

- `apps/api`: NestJS backend (auth, courses, modules, content, reviews, AI, notifications, calendar, dashboard)
- `apps/web`: React + Vite frontend
- `docs`: architecture and API docs
- `docker-compose.yml`: local services (postgres, ollama, api, web)

## quick requirements

- Node.js `20+`
- npm `10+`
- Docker Desktop (or Docker Engine + Compose)
- Ollama (for local/free AI)

## first-time setup (follow in this order)

### 0) env files

copy env examples before running anything:

```bash
copy apps\api\.env.example apps\api\.env
copy apps\web\.env.example apps\web\.env
```
for `JWT_SECRET` in `apps/api/.env`, generate a strong random value in PowerShell:

```powershell
[Convert]::ToBase64String((1..64 | ForEach-Object { Get-Random -Maximum 256 }))
```

then copy the output and set:

```env
JWT_SECRET=your_generated_value_here
```

### 1) install packages

```bash
npm install
```

what it does:
- installs all workspace dependencies for root + `apps/api` + `apps/web`

### 2) install Nest platform express package (requested step)

```bash
npm install @nestjs/platform-express
```

what it does:
- makes sure the HTTP platform adapter used by NestJS is installed
- this repo already uses it, but running this is safe and keeps setup explicit

### 3) make sure docker is running, then reset old DB volume

```bash
docker compose down -v
```

what it does:
- stops compose services
- removes old volumes (`-v`) so you get a clean local database state

### 4) start only postgres

```bash
docker compose up -d postgres
```

what it does:
- starts postgres in background only
- local DB is exposed on `localhost:55432`

### 5) run DB migrations

```bash
npm run db:migrate
```

what it does:
- runs Prisma migrations from `apps/api/prisma/migrations`
- creates/updates schema in your local postgres database

### 6) seed demo data

```bash
npm run db:seed
```

what it does:
- inserts demo users/course/module/content used for local testing

### 7) install ollama and pull model (needed for AI features)

Syllentra uses a local Ollama model from `apps/api/.env`:
- `OLLAMA_MODEL=llama3.1:8b`

simple setup:
1. install Ollama from [ollama.com/download](https://ollama.com/download)
2. finish install and open Ollama once (service should start)
3. pull the model used by this repo in a new terminal window:

```bash
ollama pull llama3.1:8b
```

4. optional quick check:

```bash
ollama run llama3.1:8b "hello"
```

if that responds, AI routes should work.

### 8) run the app

```bash
npm run dev
```

what it does:
- starts API on `http://localhost:3000`
- waits for API, then starts web on `http://localhost:5173`

## one-block command list

if you just want the exact sequence:

```bash
npm install
npm install @nestjs/platform-express
docker compose down -v
docker compose up -d postgres
npm run db:migrate
npm run db:seed
ollama pull llama3.1:8b
npm run dev
```

## seeded login accounts

- Admin: `admin@syllentra.local` / `Admin123!`
- Instructor: `instructor@syllentra.local` / `Instructor123!`
- Reviewer: `reviewer@syllentra.local` / `Reviewer123!`
- Student: `student@syllentra.local` / `Student123!`

## useful links

- web app: [http://localhost:5173](http://localhost:5173)
- API health: [http://localhost:3000/health](http://localhost:3000/health)
- architecture notes: `docs/architecture.md`
- routes list: `docs/api-routes.md`

## quick troubleshooting

- if API says DB connection failed: make sure `docker compose up -d postgres` is running
- if AI endpoints fail: make sure Ollama is running and `llama3.1:8b` is pulled
- if ports are busy: close old dev processes, then re-run `npm run dev`
