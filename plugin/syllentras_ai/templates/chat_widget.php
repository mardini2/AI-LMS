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
                <div class="syllentras-display-wrap">
                    <button
                        type="button"
                        id="syllentras-display-btn"
                        aria-label="Display settings"
                        title="Display settings"
                        aria-haspopup="dialog"
                        aria-expanded="false"
                        aria-controls="syllentras-display-menu"
                    >Aa</button>
                    <div
                        id="syllentras-display-menu"
                        class="syllentras-display-menu"
                        role="dialog"
                        aria-label="Display settings"
                        hidden
                    ></div>
                </div>
                <button id="syllentras-chat-reset" aria-label="Reset layout" title="Reset layout">&#x21BA;</button>
                <button id="syllentras-chat-expand" aria-label="Expand">&#x2922;</button>
                <button id="syllentras-chat-close" aria-label="Close">&times;</button>
            </div>
        </div>

        <div id="syllentras-chat-tabs" role="tablist" aria-label="Syllentras AI views">
            <button
                type="button"
                id="syllentras-tab-chat"
                role="tab"
                aria-selected="true"
                aria-controls="syllentras-panel-chat"
                tabindex="0"
            >Chat</button>
            <button
                type="button"
                id="syllentras-tab-ai-content"
                role="tab"
                aria-selected="false"
                aria-controls="syllentras-panel-ai-content"
                tabindex="-1"
            >AI Content</button>
        </div>

        <div
            id="syllentras-panel-chat"
            role="tabpanel"
            aria-labelledby="syllentras-tab-chat"
        >
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
                        <span id="syllentras-chat-active-title"><?php echo s($generaltitle); ?></span>
                        <span id="syllentras-chat-active-tag"><?php echo s($generaltag); ?></span>
                        <span id="syllentras-chat-active-mode" data-mode="direct">Direct</span>
                        <button
                            type="button"
                            id="syllentras-msg-search-toggle"
                            class="syllentras-msg-search-toggle"
                            aria-label="Find in conversation"
                            aria-expanded="false"
                            aria-controls="syllentras-msg-search"
                            title="Find in conversation"
                        >Find</button>
                    </div>
                    <div id="syllentras-msg-search" hidden>
                        <div class="syllentras-msg-search-bar">
                            <input
                                id="syllentras-msg-search-input"
                                type="search"
                                placeholder="Find in conversation"
                                aria-label="Find in conversation"
                                autocomplete="off"
                            >
                            <span id="syllentras-msg-search-count" aria-live="polite"></span>
                            <button type="button" id="syllentras-msg-search-prev" aria-label="Previous match" title="Previous match">&#9650;</button>
                            <button type="button" id="syllentras-msg-search-next" aria-label="Next match" title="Next match">&#9660;</button>
                            <button type="button" id="syllentras-msg-search-close" aria-label="Close find" title="Close find">&times;</button>
                        </div>
                        <div
                            id="syllentras-msg-search-results"
                            class="syllentras-msg-search-results"
                            role="listbox"
                            aria-label="Matching messages"
                        ></div>
                    </div>
                    <div id="syllentras-chat-messages" role="log" aria-live="polite">
                        <div id="syllentras-chat-load-more" hidden>Loading...</div>
                    </div>
                    <div id="syllentras-chat-input-resizer" role="separator" aria-label="Resize message input" aria-orientation="horizontal"></div>
                    <div id="syllentras-chat-input-row">
                        <div class="syllentras-tools-wrap">
                            <button
                                type="button"
                                id="syllentras-chat-tools-btn"
                                class="syllentras-chat-icon-btn"
                                aria-label="Study tools"
                                aria-haspopup="menu"
                                aria-expanded="false"
                                title="Study tools"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                                    <path fill="currentColor" d="M19 11h-6V5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2z"/>
                                </svg>
                            </button>
                            <div
                                id="syllentras-chat-tools-menu"
                                class="syllentras-tools-menu"
                                role="menu"
                                aria-label="Study tools"
                                hidden
                            ></div>
                        </div>
                        <div class="syllentras-provider-wrap">
                            <button
                                type="button"
                                id="syllentras-provider-btn"
                                class="syllentras-chat-icon-btn"
                                aria-label="Choose AI provider"
                                aria-haspopup="listbox"
                                aria-expanded="false"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                                    <path fill="currentColor" d="M12 2l1.4 4.2L18 7.6l-3.6 3.1L15.8 16 12 13.8 8.2 16l1.4-5.3L6 7.6l4.6-1.4L12 2zm0 14.5c2.5 0 4.5 1.3 4.5 2.8S14.5 22 12 22s-4.5-1.2-4.5-2.7 2-2.8 4.5-2.8z"/>
                                </svg>
                            </button>
                            <div
                                id="syllentras-provider-menu"
                                class="syllentras-provider-menu"
                                role="listbox"
                                aria-label="AI providers"
                                hidden
                            ></div>
                        </div>
                        <div class="syllentras-mode-wrap">
                            <button
                                type="button"
                                id="syllentras-mode-btn"
                                class="syllentras-mode-btn"
                                aria-label="Chat mode: Direct. Click to change."
                                aria-haspopup="menu"
                                aria-expanded="false"
                                title="Chat mode: Direct"
                            >
                                <span id="syllentras-mode-btn-label">Direct</span>
                            </button>
                            <div
                                id="syllentras-mode-menu"
                                class="syllentras-mode-menu"
                                role="menu"
                                aria-label="Chat modes"
                                hidden
                            ></div>
                        </div>
                        <textarea
                            id="syllentras-chat-input"
                            placeholder="<?php echo s($chatplaceholder); ?>"
                            rows="2"
                            aria-label="Your message"
                        ></textarea>
                        <button id="syllentras-chat-send" aria-label="Send">Send</button>
                    </div>
                </main>
            </div>
        </div>

        <div
            id="syllentras-panel-ai-content"
            role="tabpanel"
            aria-labelledby="syllentras-tab-ai-content"
            hidden
        >
            <div class="syllentras-ai-content-view">
                <div class="syllentras-ai-content-view-header">
                    <h2 class="syllentras-ai-content-view-title">My AI Content</h2>
                    <p class="syllentras-ai-content-view-sub">Study guides, flashcards, and practice quizzes in this course.</p>
                </div>
                <div class="syllentras-ai-content-toolbar" id="syllentras-ai-content-toolbar" hidden>
                    <div class="syllentras-ai-content-toolbar-row">
                        <input
                            type="search"
                            id="syllentras-ai-content-search"
                            class="syllentras-ai-content-search"
                            placeholder="Search titles…"
                            aria-label="Search AI Content by title"
                            autocomplete="off"
                        />
                        <div class="syllentras-ai-content-dd" data-dd="sort">
                            <button type="button" class="syllentras-ai-content-dd-btn" id="syllentras-ai-sort-btn" aria-haspopup="listbox" aria-expanded="false">
                                Sort: Course order <span class="syllentras-ai-content-sort-arrow" aria-hidden="true">↑</span>
                            </button>
                            <div class="syllentras-ai-content-dd-panel" id="syllentras-ai-sort-panel" hidden role="listbox">
                                <button type="button" class="syllentras-ai-content-dd-option" data-sort="course" role="option">Course order</button>
                                <button type="button" class="syllentras-ai-content-dd-option" data-sort="modified" role="option">Recently modified</button>
                                <button type="button" class="syllentras-ai-content-dd-option" data-sort="alpha" role="option">Alphabetical</button>
                            </div>
                        </div>
                        <div class="syllentras-ai-content-dd" data-dd="filter">
                            <button type="button" class="syllentras-ai-content-dd-btn" id="syllentras-ai-filter-btn" aria-haspopup="true" aria-expanded="false">
                                Type: All
                            </button>
                            <div class="syllentras-ai-content-dd-panel" id="syllentras-ai-filter-panel" hidden>
                                <label class="syllentras-ai-content-filter-opt">
                                    <input type="checkbox" value="study_guide" /> Study guide
                                </label>
                                <label class="syllentras-ai-content-filter-opt">
                                    <input type="checkbox" value="flashcards" /> Flashcards
                                </label>
                                <label class="syllentras-ai-content-filter-opt">
                                    <input type="checkbox" value="practice_quiz" /> Quiz
                                </label>
                            </div>
                        </div>
                        <button type="button" class="syllentras-ai-content-bulk-toggle" id="syllentras-ai-bulk-toggle">Select</button>
                        <button type="button" class="syllentras-ai-content-reset" id="syllentras-ai-content-reset" title="Reset search, sort, filters, and selection">Reset</button>
                    </div>
                    <div class="syllentras-ai-content-bulk-row" id="syllentras-ai-bulk-row" hidden>
                        <button type="button" class="syllentras-ai-content-bulk-btn" id="syllentras-ai-select-all">Select all</button>
                        <button type="button" class="syllentras-ai-content-bulk-btn" id="syllentras-ai-deselect-all">Deselect all</button>
                        <button type="button" class="syllentras-ai-content-bulk-btn danger" id="syllentras-ai-bulk-delete" disabled>Delete</button>
                    </div>
                </div>
                <div class="syllentras-ai-content-view-body">
                    <p class="syllentras-ai-content-empty" hidden>No AI Content yet in this course.</p>
                    <div class="syllentras-ai-content-list" id="syllentras-ai-content-list"></div>
                </div>
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

    <!-- Outside the panel so flashcard (and other) confirms work when chat is closed -->
    <div id="syllentras-chat-modal" hidden>
        <div class="syllentras-modal-card" role="dialog" aria-modal="true" aria-labelledby="syllentras-modal-title">
            <div id="syllentras-modal-title" class="syllentras-modal-title"></div>
            <div id="syllentras-modal-body" class="syllentras-modal-body"></div>
            <div id="syllentras-modal-actions" class="syllentras-modal-actions"></div>
        </div>
    </div>
</div>
