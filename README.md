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


| Service    | Image / Stack              | Purpose                        |
| ---------- | -------------------------- | ------------------------------ |
| Moodle     | moodle-docker (PHP/Apache) | LMS platform                   |
| MariaDB    | moodle-docker (MariaDB)    | Moodle's database              |
| NestJS API | node:24-alpine             | LLM proxy + conversation logic |
| PostgreSQL | postgres:18                | Conversation history           |


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

### 2. Enable Docker Desktop WSL2 integration

Open Docker Desktop → **Settings** → **Resources** → **WSL Integration** → toggle on your Linux distro (e.g. Ubuntu) → **Apply & Restart**.

This allows Docker to be called from inside WSL2, which is required for the fast dev workflow.

### 3. Run the setup script

Open a WSL2 terminal (search "Ubuntu" or "WSL" in Start), navigate to the project, and run:

```bash
cd /mnt/c/Users/<your-username>/source/repos/AI-LMS-Tool
chmod +x setup.sh dev.sh
./setup.sh
```

This clones `moodle/` and `moodle-docker/` into `~/AI-LMS-Tool-deps/` on the WSL2 Linux filesystem and sets `MOODLE_DOCKER_WWWROOT` automatically. See [Performance Notes](#performance-notes-wsl2) for why this matters.

> `moodle/` and `moodle-docker/` are gitignored — they are local dependencies, not part of this repo.

### 4. Fill in your `.env` file

Open `.env` and set:


| Variable                | What to set                                            |
| ----------------------- | ------------------------------------------------------ |
| `MOODLE_ADMIN_PASSWORD` | Choose any password for the local Moodle admin account |
| `POSTGRES_PASSWORD`     | Choose any password for the local PostgreSQL database  |
| `DATABASE_URL`          | Replace `CHANGEME` with your `POSTGRES_PASSWORD`       |
| `GEMINI_API_KEY`        | Get this from your team lead                           |
| `MOODLE_TOKEN`          | Leave blank for now — generated in step 8 below        |


### 5. Start all services

```powershell
.\dev.ps1 up
```

Works from PowerShell regardless of which setup path you used — it auto-delegates to WSL2 when the WSL2 path is detected in `.env`.

The first run pulls Docker images and may take a few minutes. Subsequent starts are fast.


| Service | URL                                            |
| ------- | ---------------------------------------------- |
| Moodle  | [http://localhost:8000](http://localhost:8000) |
| API     | [http://localhost:3000](http://localhost:3000) |


### 6. Initialize the Moodle database (first time only)

```powershell
.\dev.ps1 moodle-install
```

This takes a few minutes — Moodle installs all its built-in plugins.

### 7. Register the plugin (first time only)

1. Visit [http://localhost:8000/admin](http://localhost:8000/admin)
2. Log in with `admin` / your `MOODLE_ADMIN_PASSWORD`
3. Complete the brief setup wizard (site name, timezone)
4. The Syllentras AI chat button will appear on all Moodle pages

### 8. Enable Moodle Web Services and get `MOODLE_TOKEN`

The API needs a token to call Moodle's REST API for course content. Navigate to **Site administration → Server → Web services → Overview** and complete these steps:

**Enable web services and REST protocol**
1. Site administration → Advanced features → Enable web services → Save
2. Web services Overview → Step 2 → enable the **REST protocol** → Save

**Create a dedicated API user** (Step 3 on the Overview page)
- Username: `syllentras_api`, First name: `Syllentras`, Last name: `API`
- Email: `api@example.com`, uncheck "Force password change"

**Create a Web Service role** (Step 4)

Site administration → Users → Permissions → Define roles → Add a new role:
- Name: `Web Service`, Short name: `webservice`, Archetype: None
- Check **System** under "Context types where this role may be assigned"
- Allow these capabilities: `webservice/rest:use`, `moodle/course:view`, `moodle/course:viewhiddencourses`, `mod/page:view`

Assign role: Site administration → Users → Permissions → Assign system roles → **Web Service** → add `syllentras_api`

**Create the external service** (Step 5)

Web services Overview → Step 5 → Add:
- Name: `Syllentras AI Service`, Enabled: checked, Authorised users only: checked

**Add functions to the service** (Step 6)

On the new service page → Add functions:
- `core_course_get_contents`
- `core_course_get_courses`
- `core_enrol_get_users_courses`
- `mod_page_get_pages_by_courses`

**Add the API user as an authorised user** (Step 7)

Service page → Authorised users → move `syllentras_api` to the authorised column → Save

**Create the token** (Step 8)

Web services Overview → Step 8 → Create token:
- User: `syllentras_api`, Service: `Syllentras AI Service`

Copy the token and set it in `.env`:
```
MOODLE_TOKEN=your_token_here
```

Then do a full restart to pick up the new token:
```powershell
.\dev.ps1 down
.\dev.ps1 up
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


| What changed                              | What to do                                |
| ----------------------------------------- | ----------------------------------------- |
| PHP logic files (`lib.php`, `classes/**`) | Refresh browser — live via bind mount     |
| `db/hooks.php` or `db/access.php`         | `.\dev.ps1 moodle-purge`                  |
| `version.php` bump or new DB schema       | `.\dev.ps1 moodle-upgrade`                |
| `api/src/` files                          | Container auto-reloads — no action needed |


---

## Debugging

### NestJS API (TypeScript breakpoints)

1. Ensure `.\dev.ps1 up` is running
2. In VS Code: **Run and Debug** → select **"Attach: NestJS API"** → press F5
3. Set breakpoints in `api/src/` — they will be hit on the next API request

### Moodle Plugin (PHP breakpoints)

1. Ensure `MOODLE_DOCKER_XDEBUG=1` in `.env` and services are running
2. In VS Code: **Run and Debug** → select **"Listen: Xdebug (Moodle)"** → press F5
3. Set breakpoints in `plugin/syllentras_ai/classes/hook/output/before_footer.php` — they will be hit on the next page load

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

### `GET /conversations/active`

Return the most recent conversation for a user+course pair (used to resume chat when local storage is empty).

**Query:** `moodleUserId`, `courseId`

**Response:**

```json
{ "conversationId": "uuid-or-null" }
```

### `GET /conversations/:id/messages`

Paginated messages for a conversation. Requires the caller to prove ownership via `moodleUserId` (403 if mismatch).

**Query:**

| Param | Description |
| ----- | ----------- |
| `moodleUserId` | Required — must match the conversation owner |
| `limit` | Page size (default 30, max 100) |
| `before` | ISO-8601 timestamp — return messages older than this cursor |

**Response:**

```json
{
  "messages": [
    { "id": "uuid", "role": "user", "content": "...", "createdAt": "2026-06-16T12:00:00.000Z" }
  ],
  "hasMore": true
}
```

Messages are returned in chronological order (oldest first within the page). Omit `before` to fetch the most recent page; pass the oldest message's `createdAt` to load the next older page (scroll-up infinite load in the widget).

### `GET /conversations/:id`

Retrieve a conversation and all its messages.

---

## Repo Structure

```
AI-LMS-Tool/
├── setup.sh                     — one-time setup (clones moodle deps to ~/AI-LMS-Tool-deps/)
├── dev.ps1                      — dev commands (PowerShell, auto-delegates to WSL2)
├── dev.sh                       — dev commands (WSL2 / Linux)
├── docker-compose.override.yml  — extends moodle-docker for local dev
├── .env.example                 — copy to .env and fill in secrets
├── .vscode/
│   ├── launch.json              — debug configs (NestJS + PHP)
│   └── extensions.json          — recommended VS Code extensions
├── plugin/
│   └── syllentras_ai/           — Moodle local plugin (PHP)
│       ├── classes/hook/output/ — Moodle 5.x hook listeners
│       ├── db/hooks.php         — hook registration (purge caches after editing)
└── api/
    ├── Dockerfile               — production build
    └── src/
        ├── chat/                — POST /chat/message
        ├── conversation/        — conversation CRUD + paginated messages
        └── context/             — Moodle content fetching + cache
```

---

## Environment Variables

See `.env.example` for the full list with descriptions. Key variables:


| Variable                | Description                                                            |
| ----------------------- | ---------------------------------------------------------------------- |
| `MOODLE_DOCKER_WWWROOT` | Absolute path to Moodle source — set automatically by the setup script |
| `GEMINI_API_KEY`        | Google Gemini API key                                                  |
| `MOODLE_TOKEN`          | Moodle web service token (generated after first boot)                  |
| `DATABASE_URL`          | PostgreSQL connection string for the API                               |
| `MOODLE_INTERNAL_URL`   | Docker-internal URL to Moodle (`http://webserver` in dev)              |
| `MOODLE_INTERNAL_HOST`  | Host header for internal Moodle requests (`localhost:8000` in dev)     |
| `NODE_ENV`              | `development` locally, `production` in deployment                      |


---

## Performance Notes (WSL2)

On Windows, Moodle page loads are 10–15 seconds without WSL2 and under 0.5 seconds with it.

**Why:** Moodle includes ~2,000 PHP files on every page load. When `moodle/` lives on the Windows drive (`C:\...`), each file stat crosses the NTFS → WSL2 → Docker bridge at ~5ms each — 10+ seconds of pure filesystem overhead, regardless of PHP opcache.

**The fix:** `setup.sh` clones `moodle/` and `moodle-docker/` into `~/AI-LMS-Tool-deps/` on the WSL2 native Linux filesystem. Docker mounts these at full Linux speed. Your project repo, plugin code, and API stay on Windows — only the large Moodle source tree (20,000+ files) moves.

**How it works transparently:** `dev.ps1` checks if `MOODLE_DOCKER_WWWROOT` starts with `/` (a Linux path). If so, it translates the current Windows directory to `/mnt/c/...` and runs `dev.sh` inside WSL2 automatically. You keep using `.\dev.ps1 up` from PowerShell and get WSL2 performance without thinking about it.

**Shell script line endings:** `.sh` files must use LF line endings to run in WSL2. The repo's `.gitattributes` enforces this on clone. If you see `/usr/bin/env: 'bash\r'` errors, run `sed -i 's/\r//' setup.sh dev.sh` once in a WSL2 terminal.