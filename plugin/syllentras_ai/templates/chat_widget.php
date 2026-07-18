<?php
defined('MOODLE_INTERNAL') || die();
/**
 * Chat widget markup. Expects $widgetconfigjson (JSON string for data-config).
 */
?>
<div id="syllentras-chat-root" data-config="<?php echo s($widgetconfigjson); ?>">
    <button id="syllentras-chat-btn" aria-label="Open AI Assistant" title="Open AI Assistant">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/>
        </svg>
    </button>

    <div id="syllentras-chat-panel" role="dialog" aria-label="Course AI Assistant" hidden>
        <div id="syllentras-chat-header">
            <div class="syllentras-chat-header-text">
                <span class="syllentras-chat-title">Syllentras AI</span>
                <span id="syllentras-chat-course" class="syllentras-chat-subtitle"></span>
            </div>
            <div class="syllentras-chat-header-actions">
                <button id="syllentras-chat-reset" aria-label="Reset layout" title="Reset layout">&#x21BA;</button>
                <button id="syllentras-chat-expand" aria-label="Expand">&#x2922;</button>
                <button id="syllentras-chat-close" aria-label="Close">&times;</button>
            </div>
        </div>

        <div id="syllentras-chat-body">
            <aside id="syllentras-chat-sidebar" aria-label="Conversations">
                <div class="syllentras-sidebar-row">
                    <input id="syllentras-chat-search" type="search" placeholder="Search conversations" aria-label="Search conversations">
                    <button id="syllentras-chat-new" type="button" title="New conversation">New</button>
                </div>
                <div id="syllentras-chat-conversations"></div>
            </aside>
            <div id="syllentras-chat-sidebar-resizer" role="separator" aria-label="Resize conversation sidebar" aria-orientation="vertical"></div>

            <main id="syllentras-chat-main">
                <div id="syllentras-chat-active-meta">
                    <span id="syllentras-chat-active-title">Main</span>
                    <span id="syllentras-chat-active-tag">#main</span>
                </div>
                <div id="syllentras-chat-messages" role="log" aria-live="polite">
                    <div id="syllentras-chat-load-more" hidden>Loading...</div>
                </div>
                <div id="syllentras-chat-input-resizer" role="separator" aria-label="Resize message input" aria-orientation="horizontal"></div>
                <div id="syllentras-chat-input-row">
                    <textarea
                        id="syllentras-chat-input"
                        placeholder="Ask a question about this course..."
                        rows="2"
                        aria-label="Your message"
                    ></textarea>
                    <button id="syllentras-chat-send" aria-label="Send">Send</button>
                </div>
            </main>
        </div>

        <div id="syllentras-chat-modal" hidden>
            <div class="syllentras-modal-card" role="dialog" aria-modal="true" aria-labelledby="syllentras-modal-title">
                <div id="syllentras-modal-title" class="syllentras-modal-title"></div>
                <div id="syllentras-modal-body" class="syllentras-modal-body"></div>
                <div id="syllentras-modal-actions" class="syllentras-modal-actions"></div>
            </div>
        </div>

        <div class="syllentras-panel-resize-handle" data-edge="n" role="separator" aria-label="Resize panel from top" aria-orientation="horizontal"></div>
        <div class="syllentras-panel-resize-handle" data-edge="s" role="separator" aria-label="Resize panel from bottom" aria-orientation="horizontal"></div>
        <div class="syllentras-panel-resize-handle" data-edge="e" role="separator" aria-label="Resize panel from right" aria-orientation="vertical"></div>
        <div class="syllentras-panel-resize-handle" data-edge="w" role="separator" aria-label="Resize panel from left" aria-orientation="vertical"></div>
        <div class="syllentras-panel-resize-handle" data-edge="ne" role="separator" aria-label="Resize panel from top-right corner"></div>
        <div class="syllentras-panel-resize-handle" data-edge="nw" role="separator" aria-label="Resize panel from top-left corner"></div>
        <div class="syllentras-panel-resize-handle" data-edge="se" role="separator" aria-label="Resize panel from bottom-right corner"></div>
        <div class="syllentras-panel-resize-handle" data-edge="sw" role="separator" aria-label="Resize panel from bottom-left corner"></div>
    </div>
</div>
