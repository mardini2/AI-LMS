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
                    <span>Syllentras AI</span>
                    <div style="display:flex;gap:4px;align-items:center;">
                        <button id="syllentras-chat-expand" aria-label="Expand">&#x2922;</button>
                        <button id="syllentras-chat-close" aria-label="Close">&times;</button>
                    </div>
                </div>
                <div id="syllentras-chat-messages" role="log" aria-live="polite"></div>
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
                position: absolute;
                bottom: 64px;
                right: 0;
                width: 360px;
                max-height: 520px;
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.18);
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            #syllentras-chat-panel[hidden] { display: none; }
            #syllentras-chat-header {
                background: #0066cc;
                color: #fff;
                padding: 12px 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-weight: 600;
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
        </style>

        <script src="<?php echo $CFG->wwwroot; ?>/local/syllentras_ai/js/purify.min.js"></script>
        <script src="<?php echo $CFG->wwwroot; ?>/local/syllentras_ai/js/marked.min.js"></script>
        <script>
        (function () {
            var API_URL = <?php echo json_encode($apiUrl); ?>;
            var courseId = <?php echo json_encode($courseid); ?>;
            var courseName = <?php echo json_encode($coursename); ?>;
            var moodleUserId = <?php echo json_encode($moodleuserid); ?>;
            var conversationId = sessionStorage.getItem('syllentras_conversation_id') || null;

            var btn       = document.getElementById('syllentras-chat-btn');
            var panel     = document.getElementById('syllentras-chat-panel');
            var close     = document.getElementById('syllentras-chat-close');
            var expandBtn = document.getElementById('syllentras-chat-expand');
            var input     = document.getElementById('syllentras-chat-input');
            var send      = document.getElementById('syllentras-chat-send');
            var msgs      = document.getElementById('syllentras-chat-messages');

            var isExpanded = localStorage.getItem('syllentras_expanded') === '1';

            function applyExpandedState() {
                if (isExpanded) {
                    panel.classList.add('expanded');
                    expandBtn.innerHTML = '&#x2921;';
                    expandBtn.setAttribute('aria-label', 'Collapse');
                } else {
                    panel.classList.remove('expanded');
                    expandBtn.innerHTML = '&#x2922;';
                    expandBtn.setAttribute('aria-label', 'Expand');
                }
            }

            expandBtn.addEventListener('click', function () {
                isExpanded = !isExpanded;
                localStorage.setItem('syllentras_expanded', isExpanded ? '1' : '0');
                applyExpandedState();
            });

            applyExpandedState();

            var history = [];

            btn.addEventListener('click', function () {
                panel.hidden = false;
                btn.hidden = true;
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

            function renderAssistantContent(el, text) {
                el.classList.add('syllentras-markdown');
                var raw = marked.parse(text, { breaks: true });
                el.innerHTML = DOMPurify.sanitize(raw);
            }

            function appendMessage(role, text) {
                var div = document.createElement('div');
                div.className = 'syllentras-msg ' + role;
                if (role === 'assistant' && text !== '...') {
                    renderAssistantContent(div, text);
                } else {
                    div.textContent = text;
                }
                msgs.appendChild(div);
                msgs.scrollTop = msgs.scrollHeight;
                return div;
            }

            function sendMessage() {
                var text = input.value.trim();
                if (!text) return;

                input.value = '';
                send.disabled = true;

                appendMessage('user', text);
                history.push({ role: 'user', content: text });

                var loadingEl = appendMessage('assistant', '...');

                fetch(API_URL + '/chat/message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        courseId: courseId,
                        courseName: courseName || undefined,
                        moodleUserId: moodleUserId,
                        message: text,
                        conversationId: conversationId,
                        history: history
                    })
                })
                .then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function (data) {
                    renderAssistantContent(loadingEl, data.response);
                    history.push({ role: 'assistant', content: data.response });

                    if (data.conversationId) {
                        conversationId = data.conversationId;
                        sessionStorage.setItem('syllentras_conversation_id', conversationId);
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
