<?php
// Hooks for local_syllentras_ai.
// Moodle calls local_syllentras_ai_before_footer() before </body> on every page,
// allowing us to inject the floating chat UI globally without requiring teachers
// to add a block to each course.

defined('MOODLE_INTERNAL') || die();

/**
 * Injects the Syllentras AI chat widget into every Moodle page.
 *
 * @return string HTML to inject before </body>
 */
function local_syllentras_ai_before_footer(): string {
    global $CFG, $PAGE, $USER;

    // Only show the chat UI to logged-in users.
    if (!isloggedin() || isguestuser()) {
        return '';
    }

    $apiUrl = rtrim(get_config('local_syllentras_ai', 'api_url') ?: 'http://localhost:3000', '/');

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
                <span>Course Assistant</span>
                <button id="syllentras-chat-close" aria-label="Close">&times;</button>
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
        #syllentras-chat-close {
            background: none;
            border: none;
            color: #fff;
            font-size: 20px;
            cursor: pointer;
            line-height: 1;
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
            white-space: pre-wrap;
            word-break: break-word;
        }
        .syllentras-msg.user {
            align-self: flex-end;
            background: #0066cc;
            color: #fff;
        }
        .syllentras-msg.assistant {
            align-self: flex-start;
            background: #f0f0f0;
            color: #111;
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

    <script>
    (function () {
        var API_URL = <?php echo json_encode($apiUrl); ?>;
        // Moodle exposes the current course ID via M.cfg; fall back to 0 for non-course pages.
        var courseId = (window.M && M.cfg && M.cfg.courseId) ? M.cfg.courseId : 0;
        var conversationId = sessionStorage.getItem('syllentras_conversation_id') || null;

        var btn    = document.getElementById('syllentras-chat-btn');
        var panel  = document.getElementById('syllentras-chat-panel');
        var close  = document.getElementById('syllentras-chat-close');
        var input  = document.getElementById('syllentras-chat-input');
        var send   = document.getElementById('syllentras-chat-send');
        var msgs   = document.getElementById('syllentras-chat-messages');

        // Conversation history sent with each request so the API stays stateless per-turn.
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

        function appendMessage(role, text) {
            var div = document.createElement('div');
            div.className = 'syllentras-msg ' + role;
            div.textContent = text;
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
                loadingEl.textContent = data.response;
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
    return ob_get_clean();
}
