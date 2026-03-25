# Syllentra architecture (current repo)

this is the practical architecture used right now in this repo.

## repo layout

- `apps/api`: NestJS backend API
- `apps/web`: React + Vite frontend
- `docs`: docs for routes and architecture
- `docker-compose.yml`: local infra (postgres + ollama + optional api/web containers)

## backend shape

the API is module-based and each feature has controller + service:

- `auth`: login + current user
- `users`: admin user management + enrollments
- `courses`: courses and announcements
- `course-modules`: modules inside courses
- `content-items`: content CRUD, submissions, files, grading
- `reviews`: AI review requests + human decisions
- `ai`: coaching + student guidance using Ollama
- `dashboard`: counters + recent review activity
- `notifications`: list/unread/mark-read
- `calendar`: manual events + due-date events for students
- `health`: service health endpoint
- `audit-log`: action tracking entries
- `prisma`: database access layer

## data and auth

- DB: PostgreSQL via Prisma
- auth: JWT bearer tokens
- roles: `ADMIN`, `INSTRUCTOR`, `REVIEWER`, `STUDENT`
- guard pattern: `JwtAuthGuard` + `RolesGuard` on protected routes

## AI setup used by the app

- provider: local Ollama server
- model default: `llama3.1:8b`
- config comes from env:
  - `OLLAMA_BASE_URL` (default local `http://localhost:11434`)
  - `OLLAMA_MODEL` (default `llama3.1:8b`)

the review flow uses multiple prompts/agents and then a synthesis step.
coaching and student guidance also use the same local model path.

## frontend shape

- React + TypeScript + Vite
- routing: React Router
- data fetching: TanStack Query + Axios client wrapper
- forms: React Hook Form + Zod
- auth session is stored in localStorage

## local runtime flow

1. postgres is started with Docker
2. prisma migrate + seed prepare data
3. ollama runs locally with `llama3.1:8b`
4. `npm run dev` starts API and web together

## current priorities in this codebase

- keep behavior clear and role-aware
- keep AI fully local/free to run
- keep setup reproducible with a short command path
