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
                min-height: 430px;
                max-width: calc(100vw - 32px);
                max-height: calc(100vh - 32px);
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.18);
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .syllentras-panel-resize-handle {
                position: absolute;
                z-index: 10;
                background: transparent;
                touch-action: none;
            }
            .syllentras-panel-resize-handle[data-edge="n"] {
                top: 0;
                left: 8px;
                right: 8px;
                height: 8px;
                cursor: n-resize;
            }
            .syllentras-panel-resize-handle[data-edge="s"] {
                bottom: 0;
                left: 8px;
                right: 8px;
                height: 8px;
                cursor: s-resize;
            }
            .syllentras-panel-resize-handle[data-edge="e"] {
                top: 8px;
                right: 0;
                bottom: 8px;
                width: 8px;
                cursor: e-resize;
            }
            .syllentras-panel-resize-handle[data-edge="w"] {
                top: 8px;
                left: 0;
                bottom: 8px;
                width: 8px;
                cursor: w-resize;
            }
            .syllentras-panel-resize-handle[data-edge="ne"],
            .syllentras-panel-resize-handle[data-edge="nw"],
            .syllentras-panel-resize-handle[data-edge="se"],
            .syllentras-panel-resize-handle[data-edge="sw"] {
                width: 12px;
                height: 12px;
                z-index: 11;
            }
            .syllentras-panel-resize-handle[data-edge="ne"] {
                top: 0;
                right: 0;
                cursor: ne-resize;
            }
            .syllentras-panel-resize-handle[data-edge="nw"] {
                top: 0;
                left: 0;
                cursor: nw-resize;
            }
            .syllentras-panel-resize-handle[data-edge="se"] {
                bottom: 0;
                right: 0;
                cursor: se-resize;
            }
            .syllentras-panel-resize-handle[data-edge="sw"] {
                bottom: 0;
                left: 0;
                cursor: sw-resize;
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
                background: #f8f9fb;
                padding: 10px;
                overflow-y: auto;
                flex: 0 0 190px;
                min-width: 150px;
                max-width: 340px;
            }
            #syllentras-chat-sidebar-resizer {
                width: 6px;
                flex: 0 0 6px;
                cursor: col-resize;
                background: linear-gradient(to right, #e0e0e0, #f8f9fb);
            }
            #syllentras-chat-sidebar-resizer:hover,
            #syllentras-chat-sidebar-resizer.resizing {
                background: #b9d6f2;
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
                box-sizing: border-box;
                position: relative;
                width: 100%;
                text-align: left;
                border: 1px solid transparent;
                background: transparent;
                border-radius: 7px;
                padding: 7px 30px 7px 7px;
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
            .syllentras-conversation-name.pinned::before {
                content: "Pinned ";
                color: #0066cc;
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
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
            .syllentras-conversation-menu-btn {
                position: absolute;
                right: 5px;
                top: 6px;
                width: 22px;
                height: 22px;
                border: none;
                background: transparent;
                border-radius: 50%;
                color: #555;
                cursor: pointer;
                padding: 0;
            }
            .syllentras-conversation-menu-btn:hover,
            .syllentras-conversation-menu-btn.open {
                background: #ddeafa;
                color: #111;
            }
            .syllentras-conversation-menu {
                background: #fff;
                border: 1px solid #d7dce2;
                border-radius: 8px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.16);
                min-width: 116px;
                padding: 4px;
                position: fixed;
                z-index: 10001;
            }
            .syllentras-conversation-menu[hidden] { display: none; }
            .syllentras-menu-action {
                background: transparent;
                border: none;
                border-radius: 6px;
                color: #222;
                cursor: pointer;
                display: block;
                font-size: 12px;
                padding: 7px 8px;
                text-align: left;
                width: 100%;
            }
            .syllentras-menu-action:hover { background: #edf4fc; }
            .syllentras-menu-action:disabled {
                color: #999;
                cursor: not-allowed;
            }
            .syllentras-menu-action.danger { color: #9a1c1c; }
            #syllentras-chat-new-prompt {
                border-bottom: 1px solid #e0e0e0;
                background: #f8f9fb;
                padding: 10px 12px;
            }
            #syllentras-chat-new-prompt[hidden] {
                display: none;
            }
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
            .syllentras-new-cancel,
            .syllentras-modal-primary,
            .syllentras-modal-secondary,
            .syllentras-modal-danger {
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
            .syllentras-new-cancel,
            .syllentras-modal-secondary {
                background: #e6e6e6;
                color: #222;
            }
            .syllentras-modal-primary {
                background: #0066cc;
                color: #fff;
            }
            .syllentras-modal-danger {
                background: #9a1c1c;
                color: #fff;
            }
            #syllentras-chat-modal {
                align-items: center;
                background: rgba(18, 31, 48, 0.38);
                display: flex;
                inset: 0;
                justify-content: center;
                padding: 18px;
                position: absolute;
                z-index: 10000;
            }
            #syllentras-chat-modal[hidden] { display: none; }
            .syllentras-modal-card {
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 16px 36px rgba(0,0,0,0.24);
                color: #222;
                max-width: 360px;
                padding: 16px;
                width: min(360px, 100%);
            }
            .syllentras-modal-title {
                font-size: 15px;
                font-weight: 700;
                margin-bottom: 8px;
            }
            .syllentras-modal-body {
                font-size: 13px;
                line-height: 1.4;
                margin-bottom: 12px;
            }
            .syllentras-modal-body input,
            .syllentras-modal-body textarea {
                border: 1px solid #ccc;
                border-radius: 6px;
                box-sizing: border-box;
                font: inherit;
                margin-top: 8px;
                padding: 7px 8px;
                width: 100%;
            }
            .syllentras-modal-body textarea {
                min-height: 160px;
                resize: vertical;
            }
            .syllentras-modal-error {
                color: #9a1c1c;
                font-size: 12px;
                margin-top: 6px;
            }
            .syllentras-modal-actions {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
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
                min-height: 120px;
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
            #syllentras-chat-input-resizer {
                flex: 0 0 6px;
                cursor: row-resize;
                background: #e0e0e0;
                touch-action: none;
            }
            #syllentras-chat-input-resizer:hover,
            #syllentras-chat-input-resizer.resizing {
                background: #b9d6f2;
            }
            #syllentras-chat-input-row {
                display: flex;
                gap: 8px;
                padding: 10px 12px;
            }
            #syllentras-chat-input {
                flex: 1;
                line-height: 1.35;
                max-height: 180px;
                min-height: 42px;
                height: 42px;
                resize: none;
                border: 1px solid #ccc;
                border-radius: 6px;
                box-sizing: border-box;
                overflow: auto;
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
                align-self: center;
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
                }
                #syllentras-chat-header {
                    cursor: default;
                }
                #syllentras-chat-body {
                    flex-direction: column;
                }
                #syllentras-chat-sidebar {
                    width: auto;
                    flex: 0 0 auto;
                    max-height: 150px;
                    border-right: none;
                    border-bottom: 1px solid #e0e0e0;
                }
                #syllentras-chat-sidebar-resizer,
                .syllentras-panel-resize-handle {
                    display: none;
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
            var INPUT_MIN_HEIGHT = 42;
            var INPUT_MAX_HEIGHT = 180;
            var MESSAGES_MIN_HEIGHT = 120;
            var PANEL_CHROME_HEIGHT = 130;
            var PANEL_MIN_HEIGHT = PANEL_CHROME_HEIGHT + MESSAGES_MIN_HEIGHT + INPUT_MAX_HEIGHT;

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
            var sidebar   = document.getElementById('syllentras-chat-sidebar');
            var sidebarResizer = document.getElementById('syllentras-chat-sidebar-resizer');
            var inputResizer = document.getElementById('syllentras-chat-input-resizer');
            var modal     = document.getElementById('syllentras-chat-modal');
            var conversationsEl = document.getElementById('syllentras-chat-conversations');
            var searchInput = document.getElementById('syllentras-chat-search');
            var newBtn = document.getElementById('syllentras-chat-new');
            var activeTitle = document.getElementById('syllentras-chat-active-title');
            var activeTag = document.getElementById('syllentras-chat-active-tag');
            var pendingDeleteConversation = null;
            var openMenu = null;

            courseEl.textContent = (courseId > 1 && courseName) ? courseName : 'Dashboard';

            var conversationId = null;
            var activeConversation = null;
            var hasMore = false;
            var loadingHistory = false;
            var loadingOlder = false;
            var layoutSaveTimer = null;
            var isDraggingPanel = false;
            var isResizingPanel = false;
            var isResizingSidebar = false;
            var isResizingInput = false;
            var dragOffsetX = 0;
            var dragOffsetY = 0;
            var resizeEdge = null;
            var resizeStartX = 0;
            var resizeStartY = 0;
            var resizeStartRect = null;
            var inputResizeStartY = 0;
            var inputResizeStartHeight = 0;
            var mobileLayout = window.matchMedia('(max-width: 700px)');
            var isExpanded = localStorage.getItem('syllentras_expanded') === '1';
            var SIDEBAR_MIN_WIDTH = 150;
            var SIDEBAR_MAX_WIDTH = 340;

            function layoutStorageKey() {
                return 'syllentras_layout_' + moodleUserId;
            }

            function normalLayoutStorageKey() {
                return 'syllentras_layout_normal_' + moodleUserId;
            }

            function sidebarWidthStorageKey() {
                return 'syllentras_sidebar_width_' + moodleUserId;
            }

            function inputHeightStorageKey() {
                return 'syllentras_input_height_' + moodleUserId;
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

            function applyStoredSidebarWidth() {
                if (isMobileLayout()) return;
                var stored = parseInt(localStorage.getItem(sidebarWidthStorageKey()) || '', 10);
                if (!Number.isNaN(stored)) setSidebarWidth(stored);
            }

            function setSidebarWidth(width) {
                var panelWidth = panel.getBoundingClientRect().width || 620;
                var maxByPanel = Math.max(SIDEBAR_MIN_WIDTH, panelWidth - 280);
                var nextWidth = clamp(width, SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, maxByPanel));
                sidebar.style.width = nextWidth + 'px';
                sidebar.style.flexBasis = nextWidth + 'px';
            }

            function saveSidebarWidth() {
                if (isMobileLayout()) return;
                localStorage.setItem(sidebarWidthStorageKey(), String(Math.round(sidebar.getBoundingClientRect().width)));
            }

            function applyStoredInputHeight() {
                var stored = parseInt(localStorage.getItem(inputHeightStorageKey()) || '', 10);
                if (!Number.isNaN(stored)) setInputHeight(stored);
            }

            function setInputHeight(height) {
                input.style.height = clamp(height, INPUT_MIN_HEIGHT, INPUT_MAX_HEIGHT) + 'px';
            }

            function saveInputHeight() {
                localStorage.setItem(inputHeightStorageKey(), String(Math.round(input.getBoundingClientRect().height)));
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
                applyStoredSidebarWidth();
                applyStoredInputHeight();
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
                var pinned = conversations.filter(function (c) { return c.pinned && c.type !== 'general'; });
                renderConversationGroup('Main', conversations.filter(function (c) { return c.type === 'general'; }));
                if (pinned.length) renderConversationGroup('Pinned', pinned);
                renderConversationGroup('Course Sections', conversations.filter(function (c) { return !c.pinned && c.type === 'section'; }));
                renderConversationGroup('Other Conversations', conversations.filter(function (c) { return !c.pinned && c.type === 'manual'; }));
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
                var item = document.createElement('div');
                item.tabIndex = 0;
                item.setAttribute('role', 'button');
                item.className = 'syllentras-conversation-item';
                item.dataset.conversationId = conversation.id;
                item.innerHTML =
                    '<span class="syllentras-conversation-name"></span>' +
                    '<span class="syllentras-conversation-tag"></span>' +
                    '<button type="button" class="syllentras-conversation-menu-btn" aria-label="Conversation menu" aria-haspopup="menu">&#8942;</button>';
                var nameEl = item.querySelector('.syllentras-conversation-name');
                nameEl.textContent = conversation.title || 'Conversation';
                nameEl.classList.toggle('pinned', !!conversation.pinned);
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
                item.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openConversationById(conversation.id);
                    }
                });
                item.querySelector('.syllentras-conversation-menu-btn').addEventListener('click', function (e) {
                    e.stopPropagation();
                    showConversationMenu(e.currentTarget, conversation);
                });
                conversationsEl.appendChild(item);
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

            function closeConversationMenu() {
                if (openMenu) {
                    openMenu.remove();
                    openMenu = null;
                }
                Array.from(conversationsEl.querySelectorAll('.syllentras-conversation-menu-btn.open')).forEach(function (btn) {
                    btn.classList.remove('open');
                });
            }

            function showConversationMenu(anchor, conversation) {
                closeConversationMenu();
                anchor.classList.add('open');

                var menu = document.createElement('div');
                menu.className = 'syllentras-conversation-menu';
                menu.setAttribute('role', 'menu');
                addMenuAction(menu, 'Rename', function () { showRenameModal(conversation); }, conversation.type !== 'manual');
                addMenuAction(menu, conversation.pinned ? 'Unpin' : 'Pin', function () { togglePinConversation(conversation); }, conversation.type === 'general');
                addMenuAction(menu, 'Export', function () { showExportModal(conversation); });
                addMenuAction(menu, 'Delete', function () { deleteConversation(conversation); }, false, true);
                document.body.appendChild(menu);

                var rect = anchor.getBoundingClientRect();
                menu.style.left = Math.max(8, rect.right - 124) + 'px';
                menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4) + 'px';
                openMenu = menu;
            }

            function addMenuAction(menu, label, handler, disabled, danger) {
                var button = document.createElement('button');
                button.type = 'button';
                button.className = 'syllentras-menu-action' + (danger ? ' danger' : '');
                button.textContent = label;
                button.disabled = !!disabled;
                button.addEventListener('click', function (e) {
                    e.stopPropagation();
                    closeConversationMenu();
                    if (!button.disabled) handler();
                });
                menu.appendChild(button);
            }

            function showModal(title, bodyNode, actions) {
                closeConversationMenu();
                modal.querySelector('#syllentras-modal-title').textContent = title;
                var body = modal.querySelector('#syllentras-modal-body');
                var actionArea = modal.querySelector('#syllentras-modal-actions');
                body.innerHTML = '';
                actionArea.innerHTML = '';
                if (typeof bodyNode === 'string') {
                    body.textContent = bodyNode;
                } else {
                    body.appendChild(bodyNode);
                }
                actions.forEach(function (action) {
                    var button = document.createElement('button');
                    button.type = 'button';
                    button.className = action.className || 'syllentras-modal-secondary';
                    button.textContent = action.label;
                    button.addEventListener('click', action.onClick);
                    actionArea.appendChild(button);
                });
                modal.hidden = false;
                var firstButton = actionArea.querySelector('button');
                if (firstButton) firstButton.focus();
            }

            function closeModal() {
                modal.hidden = true;
            }

            function updateActiveConversationButtons() {
                Array.from(conversationsEl.querySelectorAll('.syllentras-conversation-item')).forEach(function (item) {
                    item.classList.toggle('active', item.dataset.conversationId === conversationId);
                });
            }

            function deleteConversation(conversation) {
                pendingDeleteConversation = conversation;
                if (conversation.type === 'general') {
                    showModal(
                        'Clear Main history?',
                        'Clear all messages in Main? The conversation will stay available. Course content will not be deleted.',
                        [
                            { label: 'Cancel', className: 'syllentras-modal-secondary', onClick: cancelDeleteConversation },
                            { label: 'Clear', className: 'syllentras-modal-danger', onClick: confirmDeleteConversation }
                        ]
                    );
                    return;
                }

                var title = conversation.title || 'this conversation';
                showModal(
                    'Delete conversation',
                    'Delete "' + title + '" and its history? Course content will not be deleted.',
                    [
                        { label: 'Cancel', className: 'syllentras-modal-secondary', onClick: cancelDeleteConversation },
                        { label: 'Delete', className: 'syllentras-modal-danger', onClick: confirmDeleteConversation }
                    ]
                );
            }

            function cancelDeleteConversation() {
                pendingDeleteConversation = null;
                closeModal();
            }

            function confirmDeleteConversation() {
                if (!pendingDeleteConversation) return;

                var conversation = pendingDeleteConversation;
                cancelDeleteConversation();

                fetchJson('/conversations/' + encodeURIComponent(conversation.id)
                    + '?moodleUserId=' + encodeURIComponent(moodleUserId), { method: 'DELETE' })
                .then(function (result) {
                    if (result && result.cleared) {
                        if (conversation.id === conversationId) {
                            clearMessages();
                            if (result.conversation) {
                                activeConversation = result.conversation;
                            }
                        }
                        return loadConversations();
                    }

                    if (conversation.id === conversationId) {
                        clearMessages();
                        conversationId = null;
                        activeConversation = null;
                        return openConversation({ type: 'general', title: 'Main' });
                    }
                    return loadConversations();
                });
            }

            function showRenameModal(conversation) {
                var wrapper = document.createElement('div');
                wrapper.textContent = 'Enter a new name for this conversation.';
                var inputEl = document.createElement('input');
                inputEl.type = 'text';
                inputEl.maxLength = 120;
                inputEl.value = conversation.title || '';
                var error = document.createElement('div');
                error.className = 'syllentras-modal-error';
                error.hidden = true;
                wrapper.appendChild(inputEl);
                wrapper.appendChild(error);

                showModal('Rename conversation', wrapper, [
                    { label: 'Cancel', className: 'syllentras-modal-secondary', onClick: closeModal },
                    {
                        label: 'Rename',
                        className: 'syllentras-modal-primary',
                        onClick: function () {
                            var title = inputEl.value.trim();
                            if (!title) {
                                error.textContent = 'Please enter a conversation name.';
                                error.hidden = false;
                                inputEl.focus();
                                return;
                            }
                            updateConversation(conversation.id, { title: title })
                                .then(function (updated) {
                                    closeModal();
                                    if (conversation.id === conversationId) setActiveConversation(updated);
                                    return loadConversations();
                                })
                                .catch(function () {
                                    error.textContent = 'Could not rename this conversation.';
                                    error.hidden = false;
                                });
                        }
                    }
                ]);
                inputEl.focus();
                inputEl.select();
            }

            function togglePinConversation(conversation) {
                updateConversation(conversation.id, { pinned: !conversation.pinned })
                    .then(function (updated) {
                        if (conversation.id === conversationId) activeConversation = updated;
                        return loadConversations();
                    })
                    .catch(function () {
                        showModal('Pin conversation', 'Could not update the pinned state. Please refresh the page and try again.', [
                            { label: 'Close', className: 'syllentras-modal-secondary', onClick: closeModal }
                        ]);
                    });
            }

            function updateConversation(id, changes) {
                return fetchJson('/conversations/' + encodeURIComponent(id)
                    + '?moodleUserId=' + encodeURIComponent(moodleUserId), {
                    method: 'PATCH',
                    body: JSON.stringify(changes)
                });
            }

            function showExportModal(conversation) {
                fetchConversationMessages(conversation.id)
                    .then(function (messages) {
                        var exportText = formatConversationExport(conversation, messages);
                        var wrapper = document.createElement('div');
                        wrapper.textContent = 'Copy or download this conversation.';
                        var textArea = document.createElement('textarea');
                        textArea.readOnly = true;
                        textArea.value = exportText;
                        wrapper.appendChild(textArea);

                        showModal('Export conversation', wrapper, [
                            { label: 'Close', className: 'syllentras-modal-secondary', onClick: closeModal },
                            {
                                label: 'Copy',
                                className: 'syllentras-modal-primary',
                                onClick: function () {
                                    copyText(exportText);
                                }
                            },
                            {
                                label: 'Download',
                                className: 'syllentras-modal-primary',
                                onClick: function () {
                                    downloadText(safeFileName(conversation.title || 'conversation') + '.txt', exportText);
                                }
                            }
                        ]);
                        textArea.focus();
                        textArea.select();
                    })
                    .catch(function () {
                        showModal('Export conversation', 'Could not load this conversation for export.', [
                            { label: 'Close', className: 'syllentras-modal-secondary', onClick: closeModal }
                        ]);
                    });
            }

            function fetchConversationMessages(id) {
                var all = [];
                function loadPage(before) {
                    var path = '/conversations/' + encodeURIComponent(id)
                        + '/messages?moodleUserId=' + encodeURIComponent(moodleUserId)
                        + '&limit=100';
                    if (before) path += '&before=' + encodeURIComponent(before);
                    return fetchJson(path).then(function (page) {
                        var messages = page.messages || [];
                        all = messages.concat(all);
                        if (page.hasMore && messages.length) {
                            return loadPage(messages[0].createdAt);
                        }
                        return all;
                    });
                }
                return loadPage();
            }

            function formatConversationExport(conversation, messages) {
                var lines = [
                    conversation.title || 'Conversation',
                    conversation.tag || '',
                    courseName ? 'Course: ' + courseName : '',
                    'Exported: ' + new Date().toLocaleString(),
                    ''
                ].filter(function (line, index) { return index < 4 ? line !== '' : true; });

                messages.forEach(function (message) {
                    var role = message.role === 'assistant' ? 'Assistant' : 'User';
                    var date = message.createdAt ? new Date(message.createdAt).toLocaleString() : '';
                    lines.push('[' + role + (date ? ' - ' + date : '') + ']');
                    lines.push(message.content || '');
                    lines.push('');
                });

                return lines.join('\n').trim() + '\n';
            }

            function copyText(text) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text);
                    return;
                }

                var temp = document.createElement('textarea');
                temp.value = text;
                document.body.appendChild(temp);
                temp.select();
                document.execCommand('copy');
                temp.remove();
            }

            function downloadText(filename, text) {
                var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                var link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                URL.revokeObjectURL(link.href);
                link.remove();
            }

            function safeFileName(name) {
                return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'conversation';
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
                if (isMobileLayout() || e.button !== 0 || e.target.closest('button') || e.target.closest('.syllentras-panel-resize-handle')) return;

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
                if (isResizingPanel && resizeStartRect && resizeEdge) {
                    var dx = e.clientX - resizeStartX;
                    var dy = e.clientY - resizeStartY;
                    var maxWidth = Math.max(1, window.innerWidth - PANEL_MARGIN * 2);
                    var maxHeight = Math.max(1, window.innerHeight - PANEL_MARGIN * 2);
                    var minWidth = Math.min(PANEL_MIN_WIDTH, maxWidth);
                    var minHeight = Math.min(PANEL_MIN_HEIGHT, maxHeight);
                    var next = {
                        left: resizeStartRect.left,
                        top: resizeStartRect.top,
                        width: resizeStartRect.width,
                        height: resizeStartRect.height
                    };
                    var right = resizeStartRect.left + resizeStartRect.width;
                    var bottom = resizeStartRect.top + resizeStartRect.height;

                    if (resizeEdge.indexOf('e') !== -1) {
                        next.width = clamp(
                            resizeStartRect.width + dx,
                            minWidth,
                            Math.max(minWidth, window.innerWidth - resizeStartRect.left - PANEL_MARGIN)
                        );
                    }
                    if (resizeEdge.indexOf('w') !== -1) {
                        next.left = clamp(resizeStartRect.left + dx, PANEL_MARGIN, right - minWidth);
                        next.width = right - next.left;
                    }
                    if (resizeEdge.indexOf('s') !== -1) {
                        next.height = clamp(
                            resizeStartRect.height + dy,
                            minHeight,
                            Math.max(minHeight, window.innerHeight - resizeStartRect.top - PANEL_MARGIN)
                        );
                    }
                    if (resizeEdge.indexOf('n') !== -1) {
                        next.top = clamp(resizeStartRect.top + dy, PANEL_MARGIN, bottom - minHeight);
                        next.height = bottom - next.top;
                    }

                    setPanelRect(normalizePanelRect(next));
                    return;
                }

                if (!isDraggingPanel) return;
                setPanelRect(normalizePanelRect({
                    left: e.clientX - dragOffsetX,
                    top: e.clientY - dragOffsetY,
                    width: panel.offsetWidth,
                    height: panel.offsetHeight
                }));
            });

            document.addEventListener('pointerup', function () {
                if (isResizingPanel) {
                    isResizingPanel = false;
                    resizeEdge = null;
                    resizeStartRect = null;
                    savePanelLayout();
                    return;
                }
                if (!isDraggingPanel) return;
                isDraggingPanel = false;
                savePanelLayout();
            });

            Array.prototype.forEach.call(panel.querySelectorAll('.syllentras-panel-resize-handle'), function (handle) {
                handle.addEventListener('pointerdown', function (e) {
                    if (isMobileLayout() || e.button !== 0) return;
                    var rect = panel.getBoundingClientRect();
                    isResizingPanel = true;
                    resizeEdge = handle.getAttribute('data-edge');
                    resizeStartX = e.clientX;
                    resizeStartY = e.clientY;
                    resizeStartRect = {
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height
                    };
                    setPanelRect(normalizePanelRect(resizeStartRect));
                    if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
                    e.preventDefault();
                    e.stopPropagation();
                });
            });

            sidebarResizer.addEventListener('pointerdown', function (e) {
                if (isMobileLayout()) return;
                isResizingSidebar = true;
                sidebarResizer.classList.add('resizing');
                e.preventDefault();
            });

            document.addEventListener('pointermove', function (e) {
                if (!isResizingSidebar) return;
                var sidebarRect = sidebar.getBoundingClientRect();
                setSidebarWidth(e.clientX - sidebarRect.left);
            });

            document.addEventListener('pointerup', function () {
                if (!isResizingSidebar) return;
                isResizingSidebar = false;
                sidebarResizer.classList.remove('resizing');
                saveSidebarWidth();
            });

            inputResizer.addEventListener('pointerdown', function (e) {
                if (e.button !== 0) return;
                isResizingInput = true;
                inputResizeStartY = e.clientY;
                inputResizeStartHeight = input.getBoundingClientRect().height;
                inputResizer.classList.add('resizing');
                if (inputResizer.setPointerCapture) inputResizer.setPointerCapture(e.pointerId);
                e.preventDefault();
            });

            document.addEventListener('pointermove', function (e) {
                if (!isResizingInput) return;
                // Dragging the divider up grows the input; down shrinks it.
                setInputHeight(inputResizeStartHeight - (e.clientY - inputResizeStartY));
            });

            document.addEventListener('pointerup', function () {
                if (!isResizingInput) return;
                isResizingInput = false;
                inputResizer.classList.remove('resizing');
                saveInputHeight();
            });

            document.addEventListener('click', function (e) {
                if (openMenu && !openMenu.contains(e.target) && !e.target.closest('.syllentras-conversation-menu-btn')) {
                    closeConversationMenu();
                }
            });

            modal.addEventListener('click', function (e) {
                if (e.target === modal) closeModal();
            });

            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    closeConversationMenu();
                    if (!modal.hidden) closeModal();
                }
            });

            window.addEventListener('resize', clampCurrentPanelLayout);

            if (window.ResizeObserver) {
                new ResizeObserver(function () {
                    if (!isDraggingPanel && !isResizingPanel) clampCurrentPanelLayout();
                }).observe(panel);
            } else {
                panel.addEventListener('mouseup', scheduleLayoutSave);
            }

            applyExpandedState();
            applyStoredSidebarWidth();
            applyStoredInputHeight();
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
