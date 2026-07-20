(function () {
'use strict';

var root = document.getElementById('syllentras-chat-root');
if (!root || !root.getAttribute('data-config')) { return; }
var config = JSON.parse(root.getAttribute('data-config'));
var API_URL = config.apiUrl;
var courseId = config.courseId;
var courseName = config.courseName;
var moodleUserId = config.moodleUserId;
var userFirstName = config.userFirstName;
var courseSections = config.courseSections || [];


// ===== preamble.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var PAGE_SIZE = 30;
var PANEL_MARGIN = 16;
var PANEL_MIN_WIDTH = 360;
var INPUT_MIN_HEIGHT = 42;
var INPUT_MAX_HEIGHT = 180;
var MESSAGES_MIN_HEIGHT = 120;
var PANEL_CHROME_HEIGHT = 130;
var PANEL_MIN_HEIGHT = PANEL_CHROME_HEIGHT + MESSAGES_MIN_HEIGHT + INPUT_MAX_HEIGHT;
var PANEL_DEFAULT_WIDTH = 620;
var PANEL_DEFAULT_HEIGHT = 520;
var PANEL_DEFAULT_RIGHT = 24;
var PANEL_DEFAULT_BOTTOM = 88;

var btn       = document.getElementById('syllentras-chat-btn');
var panel     = document.getElementById('syllentras-chat-panel');
var close     = document.getElementById('syllentras-chat-close');
var expandBtn = document.getElementById('syllentras-chat-expand');
var resetBtn  = document.getElementById('syllentras-chat-reset');
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
var SIDEBAR_DEFAULT_WIDTH = 190;

// ===== layout.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

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

function getDefaultPanelRect() {
    return normalizePanelRect({
        left: window.innerWidth - PANEL_DEFAULT_WIDTH - PANEL_DEFAULT_RIGHT,
        top: window.innerHeight - PANEL_DEFAULT_HEIGHT - PANEL_DEFAULT_BOTTOM,
        width: PANEL_DEFAULT_WIDTH,
        height: PANEL_DEFAULT_HEIGHT
    });
}

function resetPanelLayout() {
    if (isMobileLayout()) return;

    isExpanded = false;
    localStorage.setItem('syllentras_expanded', '0');
    panel.classList.remove('expanded');
    expandBtn.innerHTML = '&#x2922;';
    expandBtn.setAttribute('aria-label', 'Expand');
    setPanelRect(getDefaultPanelRect());
    savePanelLayout();
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    saveSidebarWidth();
    setInputHeight(INPUT_MIN_HEIGHT);
    saveInputHeight();
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

function showPanel() {
    panel.hidden = false;
    btn.hidden = true;
    applyStoredLayout();
    applyStoredSidebarWidth();
    applyStoredInputHeight();
    applyExpandedState(false);
    clampCurrentPanelLayout();
}


// ===== api.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function fetchJson(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    return fetch(API_URL + path, options).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    });
}


// ===== markdown.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function renderAssistantContent(el, text) {
    el.classList.add('syllentras-markdown');
    var raw = marked.parse(text, { breaks: true });
    el.innerHTML = DOMPurify.sanitize(raw);
    Array.from(el.querySelectorAll('a[href]')).forEach(function (anchor) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
    });
}


// ===== pending-actions.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function clearPendingActionUi(root) {
    var scope = root || msgs;
    Array.from(scope.querySelectorAll('.syllentras-pending-action, .syllentras-review-offer')).forEach(function (node) {
        node.remove();
    });
}

function isStudyGuidePendingAction(pendingAction) {
    if (!pendingAction) return false;
    if (pendingAction.type === 'study_guide') return true;
    if (pendingAction.type === 'practice_quiz') return false;
    // Study-guide DTOs omit questionCount; quizzes always include a number.
    return typeof pendingAction.questionCount !== 'number';
}

function attachPendingAction(messageEl, pendingAction) {
    if (!messageEl || !pendingAction || !pendingAction.id) return;
    clearPendingActionUi(messageEl);

    var isStudyGuide = isStudyGuidePendingAction(pendingAction);
    var actionType = isStudyGuide ? 'study_guide' : 'practice_quiz';
    var wrap = document.createElement('div');
    wrap.className = 'syllentras-pending-action';
    wrap.dataset.actionId = pendingAction.id;
    wrap.dataset.actionType = actionType;

    var summary = document.createElement('div');
    summary.className = 'syllentras-pending-summary';
    summary.innerHTML = '<strong></strong><div></div><div></div>';
    summary.querySelector('strong').textContent =
        pendingAction.title || (isStudyGuide ? 'Study guide' : 'Practice quiz');
    if (isStudyGuide) {
        summary.children[1].textContent = 'Private study guide Page';
    } else {
        summary.children[1].textContent = (pendingAction.questionCount || '?')
            + ' questions (multiple choice and true/false)';
    }
    summary.children[2].textContent = 'Covers: ' + (pendingAction.scopeSummary || 'course material');
    wrap.appendChild(summary);

    var actions = document.createElement('div');
    actions.className = 'syllentras-pending-actions';

    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'syllentras-pending-confirm';
    confirmBtn.textContent = 'Confirm';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'syllentras-pending-cancel';
    cancelBtn.textContent = 'Cancel';

    function setBusy(busy) {
        confirmBtn.disabled = busy;
        cancelBtn.disabled = busy;
        confirmBtn.textContent = busy ? 'Creating...' : 'Confirm';
    }

    function createFailedMessage() {
        var kind = wrap.dataset.actionType || actionType;
        return kind === 'study_guide'
            ? 'Could not create the study guide. Please try again.'
            : 'Could not create the practice quiz. Please try again.';
    }

    confirmBtn.addEventListener('click', function () {
        setBusy(true);
        fetchJson('/chat/actions/confirm', {
            method: 'POST',
            body: JSON.stringify({
                actionId: pendingAction.id,
                moodleUserId: moodleUserId
            })
        })
        .then(function (data) {
            clearPendingActionUi(messageEl);
            if (data.response) {
                appendMessage('assistant', data.response);
            }
            return loadConversations().then(loadReviewOfferForConversation);
        })
        .catch(function () {
            setBusy(false);
            appendMessage('error', createFailedMessage());
        });
    });

    cancelBtn.addEventListener('click', function () {
        setBusy(true);
        fetchJson('/chat/actions/cancel', {
            method: 'POST',
            body: JSON.stringify({
                actionId: pendingAction.id,
                moodleUserId: moodleUserId
            })
        })
        .then(function (data) {
            clearPendingActionUi(messageEl);
            if (data.response) {
                appendMessage('assistant', data.response);
            }
        })
        .catch(function () {
            setBusy(false);
            appendMessage('error', 'Could not cancel that request. Please try again.');
        });
    });

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    wrap.appendChild(actions);
    messageEl.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
}

function loadPendingActionForConversation() {
    if (!conversationId || !moodleUserId) return Promise.resolve();
    return fetchJson('/chat/actions/pending?conversationId='
        + encodeURIComponent(conversationId)
        + '&moodleUserId=' + encodeURIComponent(moodleUserId))
    .then(function (data) {
        if (!data.pendingAction) return;
        var assistants = msgs.querySelectorAll('.syllentras-msg.assistant');
        var last = assistants.length ? assistants[assistants.length - 1] : null;
        if (last) {
            attachPendingAction(last, data.pendingAction);
        }
    })
    .catch(function () { /* ignore */ });
}

// ===== review-offer.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function attachReviewOffer(messageEl, offer) {
    if (!messageEl || !offer || !offer.actionId) return;
    Array.from(messageEl.querySelectorAll('.syllentras-review-offer')).forEach(function (node) {
        node.remove();
    });

    var wrap = document.createElement('div');
    wrap.className = 'syllentras-review-offer';
    wrap.dataset.actionId = offer.actionId;

    var summary = document.createElement('div');
    summary.className = 'syllentras-pending-summary';
    summary.innerHTML = '<strong></strong><div></div><div></div>';
    summary.querySelector('strong').textContent = 'Want me to walk through what you missed?';
    summary.children[1].textContent = 'You got ' + (offer.scoreLabel || (offer.score + '/' + offer.maxScore))
        + ' on "' + (offer.title || 'your practice quiz') + '".';
    summary.children[2].textContent = 'I can explain the ' + offer.wrongCount
        + ' wrong answer' + (offer.wrongCount === 1 ? '' : 's')
        + ' using your course materials.';
    wrap.appendChild(summary);

    var explainBtn = document.createElement('button');
    explainBtn.type = 'button';
    explainBtn.className = 'syllentras-review-explain';
    explainBtn.textContent = 'Explain my wrong answers';

    explainBtn.addEventListener('click', function () {
        explainBtn.disabled = true;
        explainBtn.textContent = 'Explaining...';
        fetchJson('/chat/actions/review-explain', {
            method: 'POST',
            body: JSON.stringify({
                conversationId: conversationId,
                moodleUserId: moodleUserId
            })
        })
        .then(function (data) {
            wrap.remove();
            if (data.response) {
                appendMessage('assistant', data.response);
            }
        })
        .catch(function () {
            explainBtn.disabled = false;
            explainBtn.textContent = 'Explain my wrong answers';
            appendMessage('error', 'Could not explain your wrong answers. Please try again.');
        });
    });

    wrap.appendChild(explainBtn);
    messageEl.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
}

function loadReviewOfferForConversation() {
    if (!conversationId || !moodleUserId) return Promise.resolve();
    return fetchJson('/chat/actions/review-offer?conversationId='
        + encodeURIComponent(conversationId)
        + '&moodleUserId=' + encodeURIComponent(moodleUserId))
    .then(function (data) {
        if (!data.offer) return;
        var assistants = msgs.querySelectorAll('.syllentras-msg.assistant');
        var last = assistants.length ? assistants[assistants.length - 1] : null;
        if (last) {
            attachReviewOffer(last, data.offer);
        }
    })
    .catch(function () { /* ignore */ });
}


// ===== messages.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

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


// ===== conversations.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

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
        return loadPendingActionForConversation().then(loadReviewOfferForConversation);
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
        if (data.pendingAction) {
            attachPendingAction(loadingEl, data.pendingAction);
        }
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

function updateActiveConversationButtons() {
    Array.from(conversationsEl.querySelectorAll('.syllentras-conversation-item')).forEach(function (item) {
        item.classList.toggle('active', item.dataset.conversationId === conversationId);
    });
}

function updateConversation(id, changes) {
    return fetchJson('/conversations/' + encodeURIComponent(id)
        + '?moodleUserId=' + encodeURIComponent(moodleUserId), {
        method: 'PATCH',
        body: JSON.stringify(changes)
    });
}


// ===== modals.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

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


// ===== section-buttons.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

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


// ===== wiring.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

expandBtn.addEventListener('click', function () {
    if (!isExpanded) savePanelLayout();
    isExpanded = !isExpanded;
    localStorage.setItem('syllentras_expanded', isExpanded ? '1' : '0');
    applyExpandedState(isExpanded);
});

resetBtn.addEventListener('click', resetPanelLayout);

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
