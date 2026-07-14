<?php
namespace local_syllentras_ai\hook\output;

defined('MOODLE_INTERNAL') || die();

/**
 * Hook listener that injects the Syllentras AI chat widget before </body>.
 */
class before_footer {

    public static function callback(\core\hook\output\before_footer_html_generation $hook): void {
        global $CFG, $PAGE, $USER;

        if (!isloggedin() || isguestuser()) {
            return;
        }

        $apiUrl = rtrim(get_config('local_syllentras_ai', 'api_url') ?: 'http://localhost:3000', '/');

        $courseid = (int) ($PAGE->course->id ?? 0);
        $coursename = ($courseid > 1) ? format_string($PAGE->course->fullname) : '';
        $moodleuserid = (int) $USER->id;
        $userfirstname = format_string($USER->firstname);
        $sections = [];

        if ($courseid > 1) {
            $modinfo = get_fast_modinfo($PAGE->course);
            foreach ($modinfo->get_section_info_all() as $sectioninfo) {
                if (empty($sectioninfo->uservisible)) {
                    continue;
                }

                $sectionnumber = (int) $sectioninfo->section;
                $sectionname = trim(get_section_name($PAGE->course, $sectioninfo));
                if ($sectionname === '') {
                    $sectionname = ($sectionnumber === 0) ? 'General' : 'Section ' . $sectionnumber;
                }

                $sections[] = [
                    'id' => (int) $sectioninfo->id,
                    'number' => $sectionnumber,
                    'name' => format_string($sectionname),
                ];
            }
        }

        ob_start();
        ?>
        <div id="syllentras-chat-root">
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

                    <main id="syllentras-chat-main">
                        <div id="syllentras-chat-active-meta">
                            <span id="syllentras-chat-active-title">Main</span>
                            <span id="syllentras-chat-active-tag">#main</span>
                        </div>
                        <div id="syllentras-chat-messages" role="log" aria-live="polite">
                            <div id="syllentras-chat-load-more" hidden>Loading...</div>
                        </div>
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
            </div>
        </div>

        <style>
            #syllentras-chat-root {
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 9999;
                font-family: system-ui, -apple-system, sans-serif;
            }
            #syllentras-chat-btn {
                width: 52px;
                height: 52px;
                border-radius: 50%;
                background: #0066cc;
                color: #fff;
                border: none;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0,0,0,0.25);
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }
            #syllentras-chat-btn:hover,
            .syllentras-section-chat-btn:hover {
                background: #0052a3;
            }
            #syllentras-chat-panel {
                position: fixed;
                bottom: 88px;
                right: 24px;
                width: 620px;
                height: 520px;
                min-width: 360px;
                min-height: 360px;
                max-width: calc(100vw - 32px);
                max-height: calc(100vh - 32px);
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.18);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                resize: both;
            }
            #syllentras-chat-panel[hidden] { display: none; }
            #syllentras-chat-header {
                background: #0066cc;
                color: #fff;
                padding: 12px 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: move;
                user-select: none;
            }
            .syllentras-chat-header-text {
                display: flex;
                flex-direction: column;
                min-width: 0;
                flex: 1;
            }
            .syllentras-chat-title {
                font-weight: 600;
                font-size: 15px;
                line-height: 1.2;
            }
            .syllentras-chat-subtitle {
                font-weight: 400;
                font-size: 12px;
                opacity: 0.85;
                margin-top: 2px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .syllentras-chat-header-actions {
                display: flex;
                gap: 4px;
                align-items: center;
            }
            #syllentras-chat-expand,
            #syllentras-chat-close {
                background: none;
                border: none;
                color: #fff;
                cursor: pointer;
                line-height: 1;
            }
            #syllentras-chat-expand {
                font-size: 16px;
                padding: 0 4px;
            }
            #syllentras-chat-close {
                font-size: 20px;
            }
            #syllentras-chat-panel.expanded {
                height: calc(100vh - 104px);
                max-height: calc(100vh - 104px);
            }
            #syllentras-chat-body {
                flex: 1;
                min-height: 0;
                display: flex;
            }
            #syllentras-chat-sidebar {
                width: 190px;
                border-right: 1px solid #e0e0e0;
                background: #f8f9fb;
                padding: 10px;
                overflow-y: auto;
            }
            .syllentras-sidebar-row {
                display: flex;
                gap: 6px;
                margin-bottom: 10px;
            }
            #syllentras-chat-search {
                min-width: 0;
                flex: 1;
                border: 1px solid #ccc;
                border-radius: 6px;
                padding: 5px 7px;
                font-size: 12px;
            }
            #syllentras-chat-new,
            .syllentras-section-chat-btn {
                background: #0066cc;
                color: #fff;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
            }
            #syllentras-chat-new {
                padding: 5px 8px;
            }
            .syllentras-conversation-group-title {
                color: #555;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.03em;
                margin: 12px 0 5px;
                text-transform: uppercase;
            }
            .syllentras-conversation-item {
                width: 100%;
                text-align: left;
                border: 1px solid transparent;
                background: transparent;
                border-radius: 7px;
                padding: 7px;
                cursor: pointer;
                color: #222;
                margin-bottom: 4px;
            }
            .syllentras-conversation-item.active {
                background: #e6f0fb;
                border-color: #b9d6f2;
            }
            .syllentras-conversation-name {
                display: block;
                font-size: 13px;
                font-weight: 600;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .syllentras-conversation-tag {
                display: block;
                color: #666;
                font-size: 11px;
                margin-top: 2px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .syllentras-conversation-match {
                display: block;
                color: #444;
                font-size: 11px;
                line-height: 1.25;
                margin-top: 4px;
            }
            .syllentras-conversation-delete {
                border: none;
                background: transparent;
                color: #9a1c1c;
                cursor: pointer;
                font-size: 11px;
                margin: -2px 0 5px 6px;
                padding: 0;
            }
            #syllentras-chat-confirm {
                border-bottom: 1px solid #e0e0e0;
                background: #fff7e6;
                padding: 10px 12px;
            }
            #syllentras-chat-new-prompt {
                border-bottom: 1px solid #e0e0e0;
                background: #f8f9fb;
                padding: 10px 12px;
            }
            #syllentras-chat-confirm[hidden],
            #syllentras-chat-new-prompt[hidden] {
                display: none;
            }
            #syllentras-chat-confirm-text,
            #syllentras-chat-new-prompt label {
                color: #222;
                font-size: 13px;
                line-height: 1.35;
                margin-bottom: 8px;
            }
            #syllentras-chat-new-name {
                border: 1px solid #ccc;
                border-radius: 6px;
                box-sizing: border-box;
                font: inherit;
                margin-bottom: 8px;
                padding: 6px 8px;
                width: 100%;
            }
            #syllentras-chat-new-error {
                color: #9a1c1c;
                font-size: 12px;
                margin-bottom: 8px;
            }
            #syllentras-chat-new-error[hidden] {
                display: none;
            }
            .syllentras-confirm-actions {
                display: flex;
                gap: 8px;
            }
            .syllentras-confirm-delete,
            .syllentras-confirm-cancel,
            .syllentras-new-create,
            .syllentras-new-cancel {
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                padding: 5px 10px;
            }
            .syllentras-confirm-delete {
                background: #9a1c1c;
                color: #fff;
            }
            .syllentras-new-create {
                background: #0066cc;
                color: #fff;
            }
            .syllentras-confirm-cancel,
            .syllentras-new-cancel {
                background: #e6e6e6;
                color: #222;
            }
            #syllentras-chat-main {
                flex: 1;
                min-width: 0;
                min-height: 0;
                display: flex;
                flex-direction: column;
            }
            #syllentras-chat-active-meta {
                border-bottom: 1px solid #e0e0e0;
                display: flex;
                gap: 8px;
                align-items: center;
                padding: 8px 12px;
                min-height: 34px;
            }
            #syllentras-chat-active-title {
                font-weight: 600;
                font-size: 13px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            #syllentras-chat-active-tag {
                color: #666;
                font-size: 12px;
                white-space: nowrap;
            }
            #syllentras-chat-messages {
                flex: 1;
                overflow-y: auto;
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                min-height: 180px;
            }
            #syllentras-chat-load-more {
                align-self: center;
                font-size: 12px;
                color: #666;
                padding: 4px 0 8px;
            }
            #syllentras-chat-load-more[hidden] {
                display: none;
            }
            .syllentras-msg {
                max-width: 85%;
                padding: 8px 12px;
                border-radius: 8px;
                line-height: 1.4;
                font-size: 14px;
                word-break: break-word;
            }
            .syllentras-msg.user {
                align-self: flex-end;
                background: #0066cc;
                color: #fff;
                white-space: pre-wrap;
            }
            .syllentras-msg.assistant {
                align-self: flex-start;
                background: #f0f0f0;
                color: #111;
            }
            .syllentras-msg.assistant.syllentras-markdown {
                white-space: normal;
            }
            .syllentras-msg.assistant.syllentras-markdown :first-child { margin-top: 0; }
            .syllentras-msg.assistant.syllentras-markdown :last-child { margin-bottom: 0; }
            .syllentras-msg.assistant.syllentras-markdown h3,
            .syllentras-msg.assistant.syllentras-markdown h4 {
                font-size: 14px;
                font-weight: 700;
                margin: 10px 0 6px;
            }
            .syllentras-msg.assistant.syllentras-markdown p { margin: 6px 0; }
            .syllentras-msg.assistant.syllentras-markdown ul,
            .syllentras-msg.assistant.syllentras-markdown ol {
                margin: 6px 0;
                padding-left: 20px;
            }
            .syllentras-msg.assistant.syllentras-markdown li { margin: 2px 0; }
            .syllentras-msg.assistant.syllentras-markdown code {
                background: rgba(0, 0, 0, 0.06);
                padding: 1px 4px;
                border-radius: 3px;
                font-size: 13px;
            }
            .syllentras-msg.assistant.syllentras-markdown pre {
                background: rgba(0, 0, 0, 0.06);
                padding: 8px;
                border-radius: 4px;
                overflow-x: auto;
                margin: 6px 0;
            }
            .syllentras-msg.assistant.syllentras-markdown pre code {
                background: none;
                padding: 0;
            }
            .syllentras-msg.error {
                align-self: flex-start;
                background: #ffeaea;
                color: #c00;
            }
            #syllentras-chat-input-row {
                display: flex;
                gap: 8px;
                padding: 10px 12px;
                border-top: 1px solid #e0e0e0;
            }
            #syllentras-chat-input {
                flex: 1;
                resize: none;
                border: 1px solid #ccc;
                border-radius: 6px;
                padding: 6px 10px;
                font-size: 14px;
                font-family: inherit;
            }
            #syllentras-chat-send {
                background: #0066cc;
                color: #fff;
                border: none;
                border-radius: 6px;
                padding: 6px 14px;
                cursor: pointer;
                font-size: 14px;
                align-self: flex-end;
            }
            #syllentras-chat-send:disabled { opacity: 0.5; cursor: not-allowed; }
            .syllentras-section-chat-btn {
                margin-left: 8px;
                padding: 4px 8px;
                vertical-align: middle;
            }
            @media (max-width: 700px) {
                #syllentras-chat-root {
                    bottom: 16px;
                    right: 16px;
                }
                #syllentras-chat-panel {
                    left: 12px !important;
                    right: 12px !important;
                    bottom: 80px !important;
                    top: auto !important;
                    width: auto !important;
                    height: auto !important;
                    max-height: calc(100vh - 104px);
                    min-width: 0;
                    resize: none;
                }
                #syllentras-chat-header {
                    cursor: default;
                }
                #syllentras-chat-body {
                    flex-direction: column;
                }
                #syllentras-chat-sidebar {
                    width: auto;
                    max-height: 150px;
                    border-right: none;
                    border-bottom: 1px solid #e0e0e0;
                }
                #syllentras-chat-input-row {
                    flex-direction: column;
                }
                #syllentras-chat-send {
                    align-self: stretch;
                }
            }
        </style>

        <script src="<?php echo $CFG->wwwroot; ?>/local/syllentras_ai/js/purify.min.js"></script>
        <script src="<?php echo $CFG->wwwroot; ?>/local/syllentras_ai/js/marked.min.js"></script>
        <script>
        (function () {
            var API_URL = <?php echo json_encode($apiUrl); ?>;
            var courseId = <?php echo json_encode($courseid); ?>;
            var courseName = <?php echo json_encode($coursename); ?>;
            var moodleUserId = <?php echo json_encode($moodleuserid); ?>;
            var userFirstName = <?php echo json_encode($userfirstname); ?>;
            var courseSections = <?php echo json_encode($sections); ?>;
            var PAGE_SIZE = 30;
            var PANEL_MARGIN = 16;
            var PANEL_MIN_WIDTH = 360;
            var PANEL_MIN_HEIGHT = 360;

            var btn       = document.getElementById('syllentras-chat-btn');
            var panel     = document.getElementById('syllentras-chat-panel');
            var close     = document.getElementById('syllentras-chat-close');
            var expandBtn = document.getElementById('syllentras-chat-expand');
            var input     = document.getElementById('syllentras-chat-input');
            var send      = document.getElementById('syllentras-chat-send');
            var msgs      = document.getElementById('syllentras-chat-messages');
            var loadMore  = document.getElementById('syllentras-chat-load-more');
            var courseEl  = document.getElementById('syllentras-chat-course');
            var header    = document.getElementById('syllentras-chat-header');
            var conversationsEl = document.getElementById('syllentras-chat-conversations');
            var searchInput = document.getElementById('syllentras-chat-search');
            var newBtn = document.getElementById('syllentras-chat-new');
            var activeTitle = document.getElementById('syllentras-chat-active-title');
            var activeTag = document.getElementById('syllentras-chat-active-tag');
            var pendingDeleteConversation = null;

            courseEl.textContent = (courseId > 1 && courseName) ? courseName : 'Dashboard';

            var conversationId = null;
            var activeConversation = null;
            var hasMore = false;
            var loadingHistory = false;
            var loadingOlder = false;
            var layoutSaveTimer = null;
            var isDraggingPanel = false;
            var dragOffsetX = 0;
            var dragOffsetY = 0;
            var mobileLayout = window.matchMedia('(max-width: 700px)');
            var isExpanded = localStorage.getItem('syllentras_expanded') === '1';

            function layoutStorageKey() {
                return 'syllentras_layout_' + moodleUserId;
            }

            function normalLayoutStorageKey() {
                return 'syllentras_layout_normal_' + moodleUserId;
            }

            function isMobileLayout() {
                return mobileLayout.matches;
            }

            function clamp(value, min, max) {
                return Math.min(Math.max(value, min), max);
            }

            function normalizePanelRect(rect) {
                var maxWidth = Math.max(1, window.innerWidth - PANEL_MARGIN * 2);
                var maxHeight = Math.max(1, window.innerHeight - PANEL_MARGIN * 2);
                var minWidth = Math.min(PANEL_MIN_WIDTH, maxWidth);
                var minHeight = Math.min(PANEL_MIN_HEIGHT, maxHeight);
                var width = clamp(rect.width || 620, minWidth, maxWidth);
                var height = clamp(rect.height || panel.offsetHeight || 520, minHeight, maxHeight);
                var left = clamp(rect.left, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN));
                var top = clamp(rect.top, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN));

                return { left: left, top: top, width: width, height: height };
            }

            function setPanelRect(rect) {
                panel.style.left = Math.round(rect.left) + 'px';
                panel.style.top = Math.round(rect.top) + 'px';
                panel.style.width = Math.round(rect.width) + 'px';
                panel.style.height = Math.round(rect.height) + 'px';
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
            }

            function getCurrentPanelRect() {
                var rect = panel.getBoundingClientRect();
                return normalizePanelRect({
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height
                });
            }

            function loadStoredLayout(normalSize) {
                try {
                    var raw = localStorage.getItem(normalSize ? normalLayoutStorageKey() : layoutStorageKey());
                    return raw ? JSON.parse(raw) : null;
                } catch (e) {
                    return null;
                }
            }

            function savePanelLayout() {
                if (isMobileLayout() || panel.hidden) return;

                try {
                    var rect = JSON.stringify(getCurrentPanelRect());
                    localStorage.setItem(layoutStorageKey(), rect);
                    if (!isExpanded) {
                        localStorage.setItem(normalLayoutStorageKey(), rect);
                    }
                } catch (e) {
                    // The chat still works if browser storage is unavailable.
                }
            }

            function scheduleLayoutSave() {
                if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
                layoutSaveTimer = setTimeout(savePanelLayout, 150);
            }

            function applyStoredLayout(normalSize) {
                if (isMobileLayout()) return;
                var stored = loadStoredLayout(normalSize);
                if (stored) setPanelRect(normalizePanelRect(stored));
            }

            function clampCurrentPanelLayout() {
                if (isMobileLayout() || panel.hidden) return;
                setPanelRect(getCurrentPanelRect());
                savePanelLayout();
            }

            function applyExpandedState(forceFullHeight) {
                if (isExpanded) {
                    panel.classList.add('expanded');
                    expandBtn.innerHTML = '&#x2921;';
                    expandBtn.setAttribute('aria-label', 'Collapse');
                    if (forceFullHeight && !panel.hidden && !isMobileLayout()) {
                        var expandedRect = getCurrentPanelRect();
                        expandedRect.top = PANEL_MARGIN;
                        expandedRect.height = window.innerHeight - PANEL_MARGIN * 2;
                        setPanelRect(normalizePanelRect(expandedRect));
                    }
                } else {
                    panel.classList.remove('expanded');
                    expandBtn.innerHTML = '&#x2922;';
                    expandBtn.setAttribute('aria-label', 'Expand');
                    applyStoredLayout(true);
                }
                clampCurrentPanelLayout();
            }

            function fetchJson(path, options) {
                options = options || {};
                options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
                return fetch(API_URL + path, options).then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                });
            }

            function showPanel() {
                panel.hidden = false;
                btn.hidden = true;
                applyStoredLayout();
                applyExpandedState(false);
                clampCurrentPanelLayout();
            }

            function renderAssistantContent(el, text) {
                el.classList.add('syllentras-markdown');
                var raw = marked.parse(text, { breaks: true });
                el.innerHTML = DOMPurify.sanitize(raw);
            }

            function createMessageElement(role, text, createdAt) {
                var div = document.createElement('div');
                div.className = 'syllentras-msg ' + role;
                if (createdAt) div.dataset.createdAt = createdAt;
                if (role === 'assistant' && text !== '...') {
                    renderAssistantContent(div, text);
                } else {
                    div.textContent = text;
                }
                return div;
            }

            function appendMessage(role, text, options) {
                options = options || {};
                var div = createMessageElement(role, text, options.createdAt);
                msgs.appendChild(div);
                if (options.scroll !== false) msgs.scrollTop = msgs.scrollHeight;
                return div;
            }

            function prependMessage(role, text, createdAt) {
                var div = createMessageElement(role, text, createdAt);
                msgs.insertBefore(div, loadMore.nextSibling);
                return div;
            }

            function clearMessages() {
                Array.from(msgs.querySelectorAll('.syllentras-msg')).forEach(function (node) {
                    node.remove();
                });
            }

            function getOldestMessageCreatedAt() {
                var nodes = msgs.querySelectorAll('.syllentras-msg[data-created-at]');
                return nodes.length ? nodes[0].dataset.createdAt : null;
            }

            function scrollToBottom() {
                msgs.scrollTop = msgs.scrollHeight;
            }

            function renderMessageBatch(messages, prepend) {
                var list = prepend ? messages.slice().reverse() : messages;
                list.forEach(function (m) {
                    var role = m.role === 'assistant' ? 'assistant' : 'user';
                    if (prepend) {
                        prependMessage(role, m.content, m.createdAt);
                    } else {
                        appendMessage(role, m.content, { scroll: false, createdAt: m.createdAt });
                    }
                });
            }

            function setActiveConversation(conversation) {
                activeConversation = conversation;
                conversationId = conversation.id;
                activeTitle.textContent = conversation.title || 'Conversation';
                activeTag.textContent = conversation.tag || '';
                clearMessages();
                hasMore = false;
                loadingHistory = false;
                updateActiveConversationButtons();
                return loadCurrentHistory();
            }

            function loadCurrentHistory() {
                if (!conversationId || loadingHistory) return Promise.resolve();
                loadingHistory = true;

                return fetchJson('/conversations/' + encodeURIComponent(conversationId)
                    + '/messages?moodleUserId=' + encodeURIComponent(moodleUserId)
                    + '&limit=' + PAGE_SIZE)
                .then(function (page) {
                    if (page.messages && page.messages.length) {
                        renderMessageBatch(page.messages, false);
                        hasMore = !!page.hasMore;
                        scrollToBottom();
                    }
                })
                .catch(function () {
                    appendMessage('error', 'Could not load chat history.', { scroll: false });
                })
                .finally(function () {
                    loadingHistory = false;
                });
            }

            function loadOlderMessages() {
                if (loadingOlder || !hasMore || !conversationId) return;

                var before = getOldestMessageCreatedAt();
                if (!before) return;

                loadingOlder = true;
                loadMore.hidden = false;

                var prevScrollHeight = msgs.scrollHeight;
                fetchJson('/conversations/' + encodeURIComponent(conversationId)
                    + '/messages?moodleUserId=' + encodeURIComponent(moodleUserId)
                    + '&limit=' + PAGE_SIZE
                    + '&before=' + encodeURIComponent(before))
                .then(function (page) {
                    if (page.messages && page.messages.length) {
                        renderMessageBatch(page.messages, true);
                        hasMore = !!page.hasMore;
                        msgs.scrollTop = msgs.scrollHeight - prevScrollHeight;
                    } else {
                        hasMore = false;
                    }
                })
                .catch(function () {
                    hasMore = false;
                })
                .finally(function () {
                    loadingOlder = false;
                    loadMore.hidden = true;
                });
            }

            function openConversation(options) {
                showPanel();
                return fetchJson('/conversations/open', {
                    method: 'POST',
                    body: JSON.stringify(Object.assign({
                        courseId: courseId,
                        moodleUserId: moodleUserId
                    }, options))
                })
                .then(function (conversation) {
                    return setActiveConversation(conversation).then(function () {
                        return loadConversations();
                    });
                })
                .then(function () {
                    input.focus();
                })
                .catch(function () {
                    appendMessage('error', 'Could not open the conversation.', { scroll: false });
                });
            }

            function openConversationById(id) {
                showPanel();
                return fetchJson('/conversations/' + encodeURIComponent(id)
                    + '?moodleUserId=' + encodeURIComponent(moodleUserId))
                .then(function (conversation) {
                    return setActiveConversation(conversation);
                })
                .then(function () {
                    input.focus();
                });
            }

            function loadConversations() {
                return fetchJson('/conversations?moodleUserId=' + encodeURIComponent(moodleUserId)
                    + '&courseId=' + encodeURIComponent(courseId))
                .then(renderConversationList)
                .catch(function () {
                    conversationsEl.textContent = 'Could not load conversations.';
                });
            }

            function renderConversationList(conversations) {
                conversationsEl.innerHTML = '';
                renderConversationGroup('Main', conversations.filter(function (c) { return c.type === 'general'; }));
                renderConversationGroup('Course Sections', conversations.filter(function (c) { return c.type === 'section'; }));
                renderConversationGroup('Other Conversations', conversations.filter(function (c) { return c.type === 'manual'; }));
                updateActiveConversationButtons();
            }

            function renderConversationGroup(label, conversations) {
                if (!conversations.length) return;
                var heading = document.createElement('div');
                heading.className = 'syllentras-conversation-group-title';
                heading.textContent = label;
                conversationsEl.appendChild(heading);
                conversations.forEach(renderConversationItem);
            }

            function renderConversationItem(conversation, matchedMessage) {
                var item = document.createElement('button');
                item.type = 'button';
                item.className = 'syllentras-conversation-item';
                item.dataset.conversationId = conversation.id;
                item.innerHTML = '<span class="syllentras-conversation-name"></span><span class="syllentras-conversation-tag"></span>';
                item.querySelector('.syllentras-conversation-name').textContent = conversation.title || 'Conversation';
                item.querySelector('.syllentras-conversation-tag').textContent = conversation.tag || '';
                if (matchedMessage && matchedMessage.content) {
                    var match = document.createElement('span');
                    match.className = 'syllentras-conversation-match';
                    match.textContent = matchedMessage.content.slice(0, 120);
                    item.appendChild(match);
                }
                item.addEventListener('click', function () {
                    openConversationById(conversation.id);
                });
                conversationsEl.appendChild(item);

                var del = document.createElement('button');
                del.type = 'button';
                del.className = 'syllentras-conversation-delete';
                del.textContent = 'Delete';
                del.addEventListener('click', function (e) {
                    e.stopPropagation();
                    deleteConversation(conversation);
                });
                conversationsEl.appendChild(del);
            }

            function ensureDeleteConfirmation() {
                var existing = document.getElementById('syllentras-chat-confirm');
                if (existing) return existing;

                var confirm = document.createElement('div');
                confirm.id = 'syllentras-chat-confirm';
                confirm.hidden = true;
                confirm.setAttribute('role', 'dialog');
                confirm.setAttribute('aria-label', 'Confirm conversation deletion');
                confirm.innerHTML =
                    '<div id="syllentras-chat-confirm-text"></div>' +
                    '<div class="syllentras-confirm-actions">' +
                    '<button type="button" class="syllentras-confirm-delete">Delete</button>' +
                    '<button type="button" class="syllentras-confirm-cancel">Cancel</button>' +
                    '</div>';
                document.getElementById('syllentras-chat-main').insertBefore(confirm, document.getElementById('syllentras-chat-active-meta'));

                confirm.querySelector('.syllentras-confirm-delete').addEventListener('click', confirmDeleteConversation);
                confirm.querySelector('.syllentras-confirm-cancel').addEventListener('click', cancelDeleteConversation);
                confirm.addEventListener('keydown', function (e) {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelDeleteConversation();
                    }
                });

                return confirm;
            }

            function ensureNewConversationPrompt() {
                var existing = document.getElementById('syllentras-chat-new-prompt');
                if (existing) return existing;

                var prompt = document.createElement('div');
                prompt.id = 'syllentras-chat-new-prompt';
                prompt.hidden = true;
                prompt.setAttribute('role', 'dialog');
                prompt.setAttribute('aria-label', 'Name new conversation');
                prompt.innerHTML =
                    '<label for="syllentras-chat-new-name">Name this conversation</label>' +
                    '<input id="syllentras-chat-new-name" type="text" autocomplete="off" maxlength="120">' +
                    '<div id="syllentras-chat-new-error" hidden>Please enter a conversation name.</div>' +
                    '<div class="syllentras-confirm-actions">' +
                    '<button type="button" class="syllentras-new-create">Create</button>' +
                    '<button type="button" class="syllentras-new-cancel">Cancel</button>' +
                    '</div>';
                document.getElementById('syllentras-chat-main').insertBefore(prompt, document.getElementById('syllentras-chat-active-meta'));

                prompt.querySelector('.syllentras-new-create').addEventListener('click', confirmNewConversation);
                prompt.querySelector('.syllentras-new-cancel').addEventListener('click', cancelNewConversation);
                prompt.querySelector('#syllentras-chat-new-name').addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        confirmNewConversation();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelNewConversation();
                    }
                });

                return prompt;
            }

            function updateActiveConversationButtons() {
                Array.from(conversationsEl.querySelectorAll('.syllentras-conversation-item')).forEach(function (item) {
                    item.classList.toggle('active', item.dataset.conversationId === conversationId);
                });
            }

            function deleteConversation(conversation) {
                var title = conversation.title || 'this conversation';
                var confirm = ensureDeleteConfirmation();
                pendingDeleteConversation = conversation;
                confirm.querySelector('#syllentras-chat-confirm-text').textContent =
                    'Delete "' + title + '" and its history? Course content will not be deleted.';
                confirm.hidden = false;
                confirm.querySelector('.syllentras-confirm-cancel').focus();
            }

            function cancelDeleteConversation() {
                var confirm = ensureDeleteConfirmation();
                pendingDeleteConversation = null;
                confirm.hidden = true;
            }

            function confirmDeleteConversation() {
                if (!pendingDeleteConversation) return;

                var conversation = pendingDeleteConversation;
                cancelDeleteConversation();

                fetchJson('/conversations/' + encodeURIComponent(conversation.id)
                    + '?moodleUserId=' + encodeURIComponent(moodleUserId), { method: 'DELETE' })
                .then(function () {
                    if (conversation.id === conversationId) {
                        clearMessages();
                        conversationId = null;
                        activeConversation = null;
                        return openConversation({ type: 'general', title: 'Main' });
                    }
                    return loadConversations();
                });
            }

            function showNewConversationPrompt() {
                showPanel();
                cancelDeleteConversation();

                var prompt = ensureNewConversationPrompt();
                var nameInput = prompt.querySelector('#syllentras-chat-new-name');
                var error = prompt.querySelector('#syllentras-chat-new-error');
                error.textContent = 'Please enter a conversation name.';
                error.hidden = true;
                nameInput.value = '';
                prompt.hidden = false;
                nameInput.focus();
            }

            function cancelNewConversation() {
                var prompt = ensureNewConversationPrompt();
                prompt.hidden = true;
            }

            function confirmNewConversation() {
                var prompt = ensureNewConversationPrompt();
                var nameInput = prompt.querySelector('#syllentras-chat-new-name');
                var error = prompt.querySelector('#syllentras-chat-new-error');
                var title = nameInput.value.trim();

                if (!title) {
                    error.hidden = false;
                    nameInput.focus();
                    return;
                }

                prompt.querySelector('.syllentras-new-create').disabled = true;
                createManualConversation(title)
                    .catch(function () {
                        error.textContent = 'Could not create the conversation. Please try again.';
                        error.hidden = false;
                    })
                    .finally(function () {
                        prompt.querySelector('.syllentras-new-create').disabled = false;
                    });
            }

            function searchConversations(query) {
                if (!query.trim()) {
                    loadConversations();
                    return;
                }

                fetchJson('/conversations/search?moodleUserId=' + encodeURIComponent(moodleUserId)
                    + '&courseId=' + encodeURIComponent(courseId)
                    + '&q=' + encodeURIComponent(query.trim()))
                .then(function (results) {
                    conversationsEl.innerHTML = '';
                    var heading = document.createElement('div');
                    heading.className = 'syllentras-conversation-group-title';
                    heading.textContent = 'Search Results';
                    conversationsEl.appendChild(heading);
                    results.forEach(function (result) {
                        renderConversationItem(result.conversation, result.matchedMessage);
                    });
                    if (!results.length) {
                        conversationsEl.appendChild(document.createTextNode('No results found.'));
                    }
                    updateActiveConversationButtons();
                });
            }

            function createManualConversation(title) {
                return fetchJson('/conversations', {
                    method: 'POST',
                    body: JSON.stringify({
                        courseId: courseId,
                        moodleUserId: moodleUserId,
                        type: 'manual',
                        title: title
                    })
                })
                .then(function (conversation) {
                    cancelNewConversation();
                    return setActiveConversation(conversation).then(loadConversations);
                });
            }

            function sendMessage() {
                var text = input.value.trim();
                if (!text || !conversationId) return;

                input.value = '';
                send.disabled = true;
                appendMessage('user', text);
                var loadingEl = appendMessage('assistant', '...');

                fetchJson('/chat/message', {
                    method: 'POST',
                    body: JSON.stringify({
                        courseId: courseId,
                        courseName: courseName || undefined,
                        moodleUserId: moodleUserId,
                        userFirstName: userFirstName || undefined,
                        message: text,
                        conversationId: conversationId
                    })
                })
                .then(function (data) {
                    renderAssistantContent(loadingEl, data.response);
                    loadingEl.dataset.createdAt = new Date().toISOString();
                    conversationId = data.conversationId || conversationId;
                    return loadConversations();
                })
                .catch(function () {
                    loadingEl.className = 'syllentras-msg error';
                    loadingEl.textContent = 'Something went wrong. Please try again.';
                })
                .finally(function () {
                    send.disabled = false;
                    input.focus();
                });
            }

            function installSectionButtons() {
                if (!courseSections.length) return;
                courseSections.forEach(function (section) {
                    var target = findSectionElement(section);
                    if (!target || target.querySelector('.syllentras-section-chat-btn[data-section-id="' + section.id + '"]')) return;

                    var button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'syllentras-section-chat-btn';
                    button.dataset.sectionId = String(section.id);
                    button.textContent = 'AI chat';
                    button.setAttribute('aria-label', 'Open AI chat for ' + section.name);
                    button.addEventListener('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        openConversation({
                            type: 'section',
                            title: section.name,
                            sectionId: section.id || undefined,
                            sectionNumber: section.number,
                            sectionName: section.name
                        });
                    });

                    var headerTarget = target.querySelector('.course-section-header, .sectionname, h3, h4') || target;
                    headerTarget.appendChild(button);
                });
            }

            function findSectionElement(section) {
                var root = document.querySelector('#region-main .course-content')
                    || document.querySelector('.course-content')
                    || document.querySelector('#region-main')
                    || document;
                var selectors = [
                    '[data-for="section"][data-id="' + section.id + '"]',
                    '.course-section[data-id="' + section.id + '"]',
                    'li.section[data-id="' + section.id + '"]',
                    '#section-' + section.number,
                    '.course-section[data-section="' + section.number + '"]',
                    'li.section[data-section="' + section.number + '"]',
                    '[data-for="section"][data-number="' + section.number + '"]',
                    '.course-section[data-number="' + section.number + '"]',
                    'li.section[data-number="' + section.number + '"]'
                ];

                for (var i = 0; i < selectors.length; i++) {
                    var found = root.querySelector(selectors[i]);
                    if (found) return found;
                }

                var candidates = Array.from(root.querySelectorAll('.course-section, li.section, [data-for="section"], [id^="section-"]'));
                return candidates.find(function (candidate) {
                    var heading = candidate.querySelector('.sectionname, .course-section-header h3, .course-section-header h4, h3, h4');
                    return heading && heading.textContent && heading.textContent.trim() === section.name;
                }) || null;
            }

            expandBtn.addEventListener('click', function () {
                if (!isExpanded) savePanelLayout();
                isExpanded = !isExpanded;
                localStorage.setItem('syllentras_expanded', isExpanded ? '1' : '0');
                applyExpandedState(isExpanded);
            });

            btn.addEventListener('click', function () {
                openConversation({ type: 'general', title: 'Main' });
            });

            close.addEventListener('click', function () {
                panel.hidden = true;
                btn.hidden = false;
            });

            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });

            send.addEventListener('click', sendMessage);
            newBtn.addEventListener('click', showNewConversationPrompt);
            searchInput.addEventListener('input', function () {
                searchConversations(searchInput.value);
            });

            msgs.addEventListener('scroll', function () {
                if (msgs.scrollTop === 0 && hasMore && !loadingOlder) {
                    loadOlderMessages();
                }
            });

            header.addEventListener('pointerdown', function (e) {
                if (isMobileLayout() || e.button !== 0 || e.target.closest('button')) return;

                var rect = panel.getBoundingClientRect();
                isDraggingPanel = true;
                dragOffsetX = e.clientX - rect.left;
                dragOffsetY = e.clientY - rect.top;
                setPanelRect(normalizePanelRect({
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height
                }));
                e.preventDefault();
            });

            document.addEventListener('pointermove', function (e) {
                if (!isDraggingPanel) return;
                setPanelRect(normalizePanelRect({
                    left: e.clientX - dragOffsetX,
                    top: e.clientY - dragOffsetY,
                    width: panel.offsetWidth,
                    height: panel.offsetHeight
                }));
            });

            document.addEventListener('pointerup', function () {
                if (!isDraggingPanel) return;
                isDraggingPanel = false;
                savePanelLayout();
            });

            window.addEventListener('resize', clampCurrentPanelLayout);

            if (window.ResizeObserver) {
                new ResizeObserver(function () {
                    if (!isDraggingPanel) clampCurrentPanelLayout();
                }).observe(panel);
            } else {
                panel.addEventListener('mouseup', scheduleLayoutSave);
            }

            applyExpandedState();
            loadConversations();
            installSectionButtons();
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', installSectionButtons);
            }
            // Some Moodle course formats finish rendering section markup after this footer hook runs.
            window.setTimeout(installSectionButtons, 500);
        })();
        </script>
        <?php
        $hook->add_html(ob_get_clean());
    }
}
