# Syllentra architecture

current layout: LMS core with local Ollama for coaching and student guidance.

## repo layout

- `apps/api`: NestJS backend API
- `apps/web`: React + Vite frontend
- `docs`: routes and architecture notes
- `docker-compose.yml`: local infra (postgres + ollama + optional api/web containers)

## backend shape

the API is module-based; each feature has controller + service:

- `auth`: login + current user
- `users`: admin user management + enrollments
- `courses`: courses
- `course-modules`: modules inside courses
- `content-items`: content CRUD, submissions, files, grading
- `ai`: coaching + student guidance using Ollama
- `dashboard`: course count for staff home
- `health`: service health endpoint
- `prisma`: database access layer

## data and auth

- DB: PostgreSQL via Prisma
- auth: JWT bearer tokens
- roles: `ADMIN`, `INSTRUCTOR`, `REVIEWER`, `STUDENT`
- guard pattern: `JwtAuthGuard` + `RolesGuard` on protected routes

## AI setup

- provider: local Ollama server
- model default: `llama3.2:1b` (override with `OLLAMA_MODEL`)
- config from env: `OLLAMA_BASE_URL`, `OLLAMA_MODEL`

coaching and student guidance call Ollama `/api/generate` with course and module context baked into the prompt.

## frontend shape

- React + TypeScript + Vite
- routing: React Router
- data fetching: TanStack Query + Axios client wrapper
- forms: React Hook Form + Zod
- auth session is stored in localStorage

## local runtime flow

1. postgres is started with Docker
2. prisma migrate + seed prepare data
3. ollama runs locally with the configured model
4. `npm run dev` starts API and web together
