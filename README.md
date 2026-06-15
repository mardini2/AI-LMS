# AI-LMS-Tool — Syllentras AI

An AI chat assistant plugin for Moodle that lets students ask questions about course material, powered by Google Gemini. Built as a capstone project.

## Architecture

```
Browser (Moodle page)
  └── Plugin JS (local_syllentras_ai) — floating chat widget
        └── POST /chat/message → NestJS API
                                    ├── Moodle REST API (course content)
                                    ├── PostgreSQL (conversation history)
                                    └── Gemini API (LLM response)
```

| Service      | Image / Stack              | Purpose                        |
|--------------|----------------------------|--------------------------------|
| Moodle       | moodle-docker (PHP/Apache) | LMS platform                   |
| MariaDB      | moodle-docker (MariaDB)    | Moodle's database              |
| NestJS API   | node:24-alpine             | LLM proxy + conversation logic |
| PostgreSQL   | postgres:18                | Conversation history           |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (with Docker Compose v2)
- [Git](https://git-scm.com/)
- [Node.js 24 LTS](https://nodejs.org/) (only needed for local IDE tooling, not for running the app)
- [VS Code](https://code.visualstudio.com/) or Cursor — open the repo and install recommended extensions when prompted

---

## First-Time Setup (run once per machine)

### 1. Clone this repo

```powershell
git clone <your-repo-url> AI-LMS-Tool
cd AI-LMS-Tool
```

### 2. Run the setup script

```powershell
.\setup.ps1
```

This will:
- Clone `moodlehq/moodle-docker` into `./moodle-docker/`
- Clone Moodle v5.2.1 into `./moodle/`
- Copy `.env.example` to `.env` and set `MOODLE_DOCKER_WWWROOT` automatically

> **Note:** `./moodle/` and `./moodle-docker/` are gitignored. They are local dependencies, not part of this repo.

### 3. Fill in your `.env` file

Open `.env` and set the following values:

| Variable             | What to set                                              |
|----------------------|----------------------------------------------------------|
| `MOODLE_ADMIN_PASSWORD` | Choose any password for the local Moodle admin account |
| `POSTGRES_PASSWORD`  | Choose any password for the local PostgreSQL database    |
| `DATABASE_URL`       | Replace `CHANGEME` with your `POSTGRES_PASSWORD`         |
| `GEMINI_API_KEY`     | Get this from your team lead                             |
| `MOODLE_TOKEN`       | Leave blank for now — generated in step 5 below          |

### 4. Start all services

```powershell
.\dev.ps1 up
```

The first run will pull Docker images and may take a few minutes. Subsequent starts are fast.

| Service    | URL                        |
|------------|----------------------------|
| Moodle     | http://localhost:8000      |
| API        | http://localhost:3000      |

### 5. Initialize the Moodle database (first time only)

```powershell
docker compose -f moodle-docker/base.yml -f docker-compose.override.yml `
  exec webserver php admin/cli/install_database.php `
  --agree-license `
  --adminpass="$env:MOODLE_ADMIN_PASSWORD" `
  --adminemail="$env:MOODLE_ADMIN_EMAIL"
```

### 6. Register the plugin (first time only)

1. Visit http://localhost:8000/admin
2. Log in with `admin` / your `MOODLE_ADMIN_PASSWORD`
3. Moodle will detect the new plugin and prompt: **"Upgrade Moodle database now"** — click it
4. The Syllentras AI chat button will now appear on all pages

### 7. Enable Moodle Web Services and get `MOODLE_TOKEN`

The API needs a token to call Moodle's REST API for course content.

1. **Enable web services:**
   Site administration → Advanced features → Enable web services → Save

2. **Enable the REST protocol:**
   Site administration → Plugins → Web services → Manage protocols → Enable REST protocol

3. **Create a service:**
   Site administration → Plugins → Web services → External services → Add
   - Name: `Syllentras AI`
   - Enable: checked

4. **Add functions to the service:**
   Click "Add functions" on the new service and add:
   - `core_course_get_contents`
   - `mod_page_get_pages_by_courses`

5. **Generate a token:**
   Site administration → Plugins → Web services → Manage tokens → Create token
   - User: admin (or a dedicated service account)
   - Service: Syllentras AI

6. Copy the token and set it in `.env`:
   ```
   MOODLE_TOKEN=your_token_here
   ```

7. Restart the API:
   ```powershell
   .\dev.ps1 restart
   ```

---

## Daily Dev Workflow

```powershell
.\dev.ps1 up        # Start everything
.\dev.ps1 down      # Stop everything
.\dev.ps1 restart   # Restart all services
.\dev.ps1 logs      # Stream all logs
.\dev.ps1 ps        # Check service status
```

**Plugin changes** (`plugin/syllentras_ai/`): edit locally, refresh the browser — changes are live immediately via volume mount.

**API changes** (`api/src/`): edit locally, the container auto-reloads via `--watch` — no restart needed.

**Plugin version changes** (`version.php`): visit http://localhost:8000/admin and run the upgrade.

---

## Debugging

### NestJS API (TypeScript breakpoints)

1. Ensure `.\dev.ps1 up` is running
2. In VS Code: **Run and Debug** → select **"Attach: NestJS API"** → press F5
3. Set breakpoints in `api/src/` — they will be hit on the next API request

### Moodle Plugin (PHP breakpoints)

1. Ensure `MOODLE_DOCKER_XDEBUG=1` in `.env` and services are running
2. In VS Code: **Run and Debug** → select **"Listen: Xdebug (Moodle)"** → press F5
3. Set breakpoints in `plugin/syllentras_ai/lib.php` — they will be hit on the next page load

> Install recommended VS Code extensions when prompted (`.vscode/extensions.json`). The PHP Debug extension is required for Xdebug.

---

## API Reference

### `POST /chat/message`
Send a student message and receive an AI response.

**Request body:**
```json
{
  "courseId": 2,
  "message": "What is the difference between X and Y?",
  "conversationId": "optional-uuid-for-existing-conversation",
  "history": []
}
```

**Response:**
```json
{
  "response": "Based on the course material...",
  "conversationId": "uuid"
}
```

### `POST /conversations`
Create a new conversation.

**Request body:** `{ "courseId": 2, "moodleUserId": 5 }`

### `GET /conversations/:id`
Retrieve a conversation and all its messages.

---

## Repo Structure

```
AI-LMS-Tool/
├── setup.ps1                    — one-time setup script
├── dev.ps1                      — dev commands (up/down/logs/etc.)
├── docker-compose.override.yml  — extends moodle-docker for local dev
├── .env.example                 — copy to .env and fill in secrets
├── .vscode/
│   ├── launch.json              — debug configs (NestJS + PHP)
│   └── extensions.json          — recommended VS Code extensions
├── plugin/
│   └── syllentras_ai/           — Moodle local plugin (PHP)
└── api/
    ├── Dockerfile               — production build
    └── src/
        ├── chat/                — POST /chat/message
        ├── conversation/        — GET|POST /conversations
        └── context/             — Moodle content fetching + cache
```

---

## Environment Variables

See `.env.example` for the full list with descriptions. Key variables:

| Variable              | Description                                               |
|-----------------------|-----------------------------------------------------------|
| `MOODLE_DOCKER_WWWROOT` | Absolute path to `./moodle` — set automatically by setup.ps1 |
| `GEMINI_API_KEY`      | Google Gemini API key                                     |
| `MOODLE_TOKEN`        | Moodle web service token (generated after first boot)     |
| `DATABASE_URL`        | PostgreSQL connection string for the API                  |
| `MOODLE_INTERNAL_URL` | Docker-internal URL to Moodle (`http://webserver` in dev) |
| `NODE_ENV`            | `development` locally, `production` in deployment         |
