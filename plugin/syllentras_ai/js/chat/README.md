# Chat widget JS modules

Source is split for maintainability. The browser loads **`boot.js`**, a single IIFE bundle that preserves a shared closure (same behavior as the old inline script).

## Edit workflow

1. Change the relevant module (`layout.js`, `conversations.js`, `providers.js`, etc.), `preamble.js`, or `wiring.js`.
2. From the repo root:

```powershell
.\dev.ps1 rebuild-chat-js
```

```bash
./dev.sh rebuild-chat-js
```

That rebuilds `boot.js`, runs Moodle upgrade (no-op if `version.php` is unchanged), and purges caches.

3. Hard-refresh the Moodle page if it still looks stale.

Bump `$plugin->version` / `$plugin->release` in `version.php` when you want a formal plugin upgrade / CSS cache-bust; `rebuild-chat-js` will pick that up via upgrade.

Do **not** load the individual module files as separate `<script>` tags — they are not standalone.

## Cross-tab sync

`cross-tab-sync.js` keeps chat **server state** aligned across same-origin tabs/windows for the same Moodle user via `BroadcastChannel` (`syllentras-chat-{moodleUserId}`).

Sends use a **persist-first** turn:

1. `POST /chat/message/start` — save the user message and set `generatingStartedAt`
2. Broadcast `turn-started` — peers refetch, show the user bubble + `...`, disable send
3. `POST /chat/message/complete` — generate and save the assistant reply
4. Broadcast `turn-finished` / `messages-updated` — peers refetch the final transcript and unlock

Legacy `POST /chat/message` still works as start+complete in one call. Composer drafts, speech, panel chrome, and **which conversation is active** stay tab-local (windows can talk in different chats). Soft list/message sync still updates create/rename/pin/delete and shared conversation transcripts. A `visibilitychange` refetch covers missed events.

SSE token streaming can replace the blocking complete call later without changing the peer turn UI (`user_saved` → `done` map to start/finish).

Production DB (when `synchronize` is off) needs:

```sql
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS generating_started_at TIMESTAMPTZ NULL;
```

## AI provider selector

`providers.js` loads `GET /chat/providers` and renders a small AI provider button beside the study-tools plus control. Selection is stored in `localStorage` (`syllentras_ai_provider`) and sent as `provider` on chat / confirm / review requests. The selector is disabled while a response is generating. Unavailable providers stay visible but muted with an `Unavailable` label; hovering one shows a tooltip explaining that the provider has not been configured yet.
