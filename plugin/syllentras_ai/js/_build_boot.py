"""Rebuild js/chat/boot.js from the plain source modules (shared IIFE closure).

Usage (from plugin/syllentras_ai):
  python js/_build_boot.py
"""
from pathlib import Path

out_dir = Path(__file__).resolve().parent / "chat"

ORDER = [
    "preamble.js",
    "layout.js",
    "api.js",
    "providers.js",
    "mode-selector.js",
    "markdown.js",
    "pending-actions.js",
    "review-offer.js",
    "message-search.js",
    "message-speech.js",
    "messages.js",
    "conversations.js",
    "message-search-ui.js",
    "modals.js",
    "tools-menu.js",
    "section-buttons.js",
    "ai-content-panel.js",
    "display-settings.js",
    "wiring.js",
]

parts = [
    "(function () {\n",
    "'use strict';\n\n",
    "var root = document.getElementById('syllentras-chat-root');\n",
    "if (!root || !root.getAttribute('data-config')) { return; }\n",
    "var config = JSON.parse(root.getAttribute('data-config'));\n",
    "var API_URL = config.apiUrl;\n",
    "var courseId = config.courseId;\n",
    "var courseName = config.courseName;\n",
    "var moodleUserId = config.moodleUserId;\n",
    "var userFirstName = config.userFirstName;\n",
    "var courseSections = config.courseSections || [];\n\n",
]

for name in ORDER:
    path = out_dir / name
    if not path.exists():
        raise SystemExit(f"Missing module: {path}")
    parts.append(f"\n// ===== {name} =====\n")
    src = path.read_text(encoding="utf-8")
    parts.append(src)
    if not src.endswith("\n"):
        parts.append("\n")

parts.append("\n})();\n")
boot = "".join(parts)
(out_dir / "boot.js").write_text(boot, encoding="utf-8", newline="\n")
print(f"Wrote {out_dir / 'boot.js'} ({len(boot)} bytes)")
