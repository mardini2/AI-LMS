# Chat widget JS modules

Source is split for maintainability. The browser loads **`boot.js`**, a single IIFE bundle that preserves a shared closure (same behavior as the old inline script).

## Edit workflow

1. Change the relevant module (`layout.js`, `conversations.js`, etc.), `preamble.js`, or `wiring.js`.
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
