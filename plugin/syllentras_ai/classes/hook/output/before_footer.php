<?php
namespace local_syllentras_ai\hook\output;

defined('MOODLE_INTERNAL') || die();

/**
 * Hook listener that injects the Syllentras AI chat widget before </body>.
 *
 * Replaces the deprecated local_syllentras_ai_before_footer() callback from
 * Moodle 4.x. In Moodle 5.x, use $hook->add_html() instead of returning a
 * string from a lib.php callback function.
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

        ob_start();
        ?>
        <div id="syllentras-chat-root">
            <!-- Chat toggle button -->
            <button
                id="syllentras-chat-btn"
                aria-label="Open AI Assistant"
                title="Open AI Assistant"
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                    <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/>
                </svg>
            </button>

            <!-- Chat panel -->
            <div id="syllentras-chat-panel" role="dialog" aria-label="Course AI Assistant" hidden>
                <div id="syllentras-chat-header">
                    <div class="syllentras-chat-header-text">
                        <span class="syllentras-chat-title">Syllentras AI</span>
                        <span id="syllentras-chat-course" class="syllentras-chat-subtitle"></span>
                    </div>
                    <div style="display:flex;gap:4px;align-items:center;">
                        <button id="syllentras-chat-expand" aria-label="Expand">&#x2922;</button>
                        <button id="syllentras-chat-close" aria-label="Close">&times;</button>
                    </div>
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
            #syllentras-chat-btn:hover { background: #0052a3; }
            #syllentras-chat-panel {
                position: fixed;
                bottom: 88px;
                right: 24px;
                width: 360px;
                min-width: 280px;
                min-height: 320px;
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
            #syllentras-chat-load-more {
                align-self: center;
                font-size: 12px;
                color: #666;
                padding: 4px 0 8px;
            }
            #syllentras-chat-load-more[hidden] {
                display: none;
            }
            #syllentras-chat-expand {
                background: none;
                border: none;
                color: #fff;
                font-size: 16px;
                cursor: pointer;
                line-height: 1;
                padding: 0 4px;
            }
            #syllentras-chat-close {
                background: none;
                border: none;
                color: #fff;
                font-size: 20px;
                cursor: pointer;
                line-height: 1;
            }
            #syllentras-chat-panel.expanded {
                height: calc(100vh - 104px);
                max-height: calc(100vh - 104px);
            }
            #syllentras-chat-panel.expanded #syllentras-chat-messages {
                max-height: none;
            }
            #syllentras-chat-messages {
                flex: 1;
                overflow-y: auto;
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                min-height: 200px;
                max-height: 360px;
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
            .syllentras-msg.assistant.syllentras-markdown :first-child {
                margin-top: 0;
            }
            .syllentras-msg.assistant.syllentras-markdown :last-child {
                margin-bottom: 0;
            }
            .syllentras-msg.assistant.syllentras-markdown h3,
            .syllentras-msg.assistant.syllentras-markdown h4 {
                font-size: 14px;
                font-weight: 700;
                margin: 10px 0 6px;
            }
            .syllentras-msg.assistant.syllentras-markdown p {
                margin: 6px 0;
            }
            .syllentras-msg.assistant.syllentras-markdown ul,
            .syllentras-msg.assistant.syllentras-markdown ol {
                margin: 6px 0;
                padding-left: 20px;
            }
            .syllentras-msg.assistant.syllentras-markdown li {
                margin: 2px 0;
            }
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
            @media (max-width: 600px) {
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
            var PAGE_SIZE = 30;

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

            courseEl.textContent = (courseId > 1 && courseName) ? courseName : 'Dashboard';

            var conversationId = null;
            var historyLoaded = false;
            var hasMore = false;
            var loadingHistory = false;
            var loadingOlder = false;
            var layoutSaveTimer = null;
            var isDraggingPanel = false;
            var dragOffsetX = 0;
            var dragOffsetY = 0;
            var mobileLayout = window.matchMedia('(max-width: 600px)');
            var PANEL_MARGIN = 16;
            var PANEL_MIN_WIDTH = 280;
            var PANEL_MIN_HEIGHT = 320;

            function convStorageKey() {
                return 'syllentras_conv_' + moodleUserId + '_' + courseId;
            }

            function layoutStorageKey() {
                return 'syllentras_layout_' + moodleUserId;
            }

            function normalLayoutStorageKey() {
                return 'syllentras_layout_normal_' + moodleUserId;
            }

            function loadStoredConversationId() {
                return localStorage.getItem(convStorageKey()) || null;
            }

            function saveConversationId(id) {
                conversationId = id;
                if (id) {
                    localStorage.setItem(convStorageKey(), id);
                }
            }

            conversationId = loadStoredConversationId();

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
                var width = clamp(rect.width || 360, minWidth, maxWidth);
                var height = clamp(rect.height || panel.offsetHeight || PANEL_MIN_HEIGHT, minHeight, maxHeight);
                var left = clamp(rect.left, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN));
                var top = clamp(rect.top, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN));

                return {
                    left: left,
                    top: top,
                    width: width,
                    height: height
                };
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
                    // Layout persistence is optional; chat should keep working if storage is unavailable.
                }
            }

            function scheduleLayoutSave() {
                if (layoutSaveTimer) {
                    clearTimeout(layoutSaveTimer);
                }
                layoutSaveTimer = setTimeout(savePanelLayout, 150);
            }

            function applyStoredLayout(normalSize) {
                if (isMobileLayout()) {
                    return;
                }

                var stored = loadStoredLayout(normalSize);
                if (!stored) {
                    return;
                }

                setPanelRect(normalizePanelRect(stored));
            }

            function clampCurrentPanelLayout() {
                if (isMobileLayout() || panel.hidden) {
                    return;
                }

                setPanelRect(getCurrentPanelRect());
                savePanelLayout();
            }

            var isExpanded = localStorage.getItem('syllentras_expanded') === '1';

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

            expandBtn.addEventListener('click', function () {
                if (!isExpanded) {
                    savePanelLayout();
                }
                isExpanded = !isExpanded;
                localStorage.setItem('syllentras_expanded', isExpanded ? '1' : '0');
                applyExpandedState(isExpanded);
            });

            applyExpandedState();

            btn.addEventListener('click', function () {
                panel.hidden = false;
                btn.hidden = true;
                applyStoredLayout();
                applyExpandedState(false);
                clampCurrentPanelLayout();
                ensureHistoryLoaded();
                input.focus();
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

            msgs.addEventListener('scroll', function () {
                if (msgs.scrollTop === 0 && hasMore && !loadingOlder && historyLoaded) {
                    loadOlderMessages();
                }
            });

            header.addEventListener('pointerdown', function (e) {
                if (isMobileLayout() || e.button !== 0 || e.target.closest('button')) {
                    return;
                }

                var rect = panel.getBoundingClientRect();
                isDraggingPanel = true;
                dragOffsetX = e.clientX - rect.left;
                dragOffsetY = e.clientY - rect.top;

                // Move from bottom/right positioning to fixed coordinates before dragging.
                setPanelRect(normalizePanelRect({
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height
                }));
                e.preventDefault();
            });

            document.addEventListener('pointermove', function (e) {
                if (!isDraggingPanel) {
                    return;
                }

                setPanelRect(normalizePanelRect({
                    left: e.clientX - dragOffsetX,
                    top: e.clientY - dragOffsetY,
                    width: panel.offsetWidth,
                    height: panel.offsetHeight
                }));
            });

            document.addEventListener('pointerup', function () {
                if (!isDraggingPanel) {
                    return;
                }

                isDraggingPanel = false;
                savePanelLayout();
            });

            window.addEventListener('resize', clampCurrentPanelLayout);

            if (window.ResizeObserver) {
                new ResizeObserver(function () {
                    if (!isDraggingPanel) {
                        clampCurrentPanelLayout();
                    }
                }).observe(panel);
            } else {
                panel.addEventListener('mouseup', scheduleLayoutSave);
            }

            function renderAssistantContent(el, text) {
                el.classList.add('syllentras-markdown');
                var raw = marked.parse(text, { breaks: true });
                el.innerHTML = DOMPurify.sanitize(raw);
            }

            function createMessageElement(role, text, createdAt) {
                var div = document.createElement('div');
                div.className = 'syllentras-msg ' + role;
                if (createdAt) {
                    div.dataset.createdAt = createdAt;
                }
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
                if (options.scroll !== false) {
                    msgs.scrollTop = msgs.scrollHeight;
                }
                return div;
            }

            function prependMessage(role, text, createdAt) {
                var div = createMessageElement(role, text, createdAt);
                msgs.insertBefore(div, loadMore.nextSibling);
                return div;
            }

            function getOldestMessageCreatedAt() {
                var nodes = msgs.querySelectorAll('.syllentras-msg[data-created-at]');
                if (!nodes.length) return null;
                return nodes[0].dataset.createdAt;
            }

            function scrollToBottom() {
                msgs.scrollTop = msgs.scrollHeight;
            }

            function resolveConversationId() {
                if (conversationId) {
                    return Promise.resolve(conversationId);
                }
                return fetch(
                    API_URL + '/conversations/active?moodleUserId=' + encodeURIComponent(moodleUserId)
                        + '&courseId=' + encodeURIComponent(courseId)
                )
                .then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function (data) {
                    if (data.conversationId) {
                        saveConversationId(data.conversationId);
                    }
                    return conversationId;
                });
            }

            function fetchMessagesPage(before) {
                var url = API_URL + '/conversations/' + encodeURIComponent(conversationId)
                    + '/messages?moodleUserId=' + encodeURIComponent(moodleUserId)
                    + '&limit=' + PAGE_SIZE;
                if (before) {
                    url += '&before=' + encodeURIComponent(before);
                }
                return fetch(url).then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                });
            }

            function renderMessageBatch(messages, prepend) {
                var list = prepend ? messages.slice().reverse() : messages;
                list.forEach(function (m) {
                    var role = m.role === 'assistant' ? 'assistant' : 'user';
                    var createdAt = m.createdAt;
                    if (prepend) {
                        prependMessage(role, m.content, createdAt);
                    } else {
                        appendMessage(role, m.content, { scroll: false, createdAt: createdAt });
                    }
                });
            }

            function ensureHistoryLoaded() {
                if (historyLoaded || loadingHistory) {
                    return Promise.resolve();
                }
                loadingHistory = true;

                return resolveConversationId()
                .then(function (id) {
                    if (!id) {
                        historyLoaded = true;
                        return null;
                    }
                    return fetchMessagesPage(null);
                })
                .then(function (page) {
                    if (page && page.messages && page.messages.length) {
                        renderMessageBatch(page.messages, false);
                        hasMore = !!page.hasMore;
                        scrollToBottom();
                    } else if (page) {
                        hasMore = !!page.hasMore;
                    }
                })
                .catch(function () {
                    appendMessage('error', 'Could not load chat history.', { scroll: false });
                    scrollToBottom();
                })
                .finally(function () {
                    loadingHistory = false;
                    historyLoaded = true;
                });
            }

            function loadOlderMessages() {
                if (loadingOlder || !hasMore || !conversationId) return;

                var before = getOldestMessageCreatedAt();
                if (!before) return;

                loadingOlder = true;
                loadMore.hidden = false;

                var prevScrollHeight = msgs.scrollHeight;

                fetchMessagesPage(before)
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

            function sendMessage() {
                var text = input.value.trim();
                if (!text) return;

                input.value = '';
                send.disabled = true;

                appendMessage('user', text);

                var loadingEl = appendMessage('assistant', '...');

                fetch(API_URL + '/chat/message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        courseId: courseId,
                        courseName: courseName || undefined,
                        moodleUserId: moodleUserId,
                        userFirstName: userFirstName || undefined,
                        message: text,
                        conversationId: conversationId
                    })
                })
                .then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function (data) {
                    renderAssistantContent(loadingEl, data.response);
                    loadingEl.dataset.createdAt = new Date().toISOString();

                    if (data.conversationId) {
                        saveConversationId(data.conversationId);
                        historyLoaded = true;
                    }
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
        })();
        </script>
        <?php
        $hook->add_html(ob_get_clean());
    }
}
