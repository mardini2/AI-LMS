// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function normalizeMessageMode(mode) {
    if (mode === 'coach') return 'coach';
    // Legacy / missing mode on assistant turns defaults to Direct.
    return 'direct';
}

function applyModeChip(el, mode) {
    if (!el) return;
    var existing = el.querySelector('.syllentras-msg-mode');
    if (existing) existing.remove();
    var normalized = normalizeMessageMode(mode);
    var chip = document.createElement('span');
    chip.className = 'syllentras-msg-mode syllentras-msg-mode-' + normalized;
    chip.textContent = normalized === 'coach' ? 'Coach' : 'Direct';
    el.insertBefore(chip, el.firstChild);
    el.dataset.mode = normalized;
}

function appendSystemNotice(text, options) {
    options = options || {};
    if (!msgs || !text) return null;
    var div = document.createElement('div');
    div.className = 'syllentras-msg system';
    div.textContent = text;
    msgs.appendChild(div);
    if (options.scroll !== false) msgs.scrollTop = msgs.scrollHeight;
    return div;
}

function createMessageElement(role, text, options) {
    options = options || {};
    var div = document.createElement('div');
    div.className = 'syllentras-msg ' + role;
    if (options.messageId) div.dataset.messageId = options.messageId;
    if (options.createdAt) div.dataset.createdAt = options.createdAt;
    if (role === 'assistant' && text !== '...') {
        renderAssistantContent(div, text);
        applyModeChip(div, options.mode);
    } else {
        div.textContent = text;
    }
    return div;
}

function appendMessage(role, text, options) {
    options = options || {};
    var div = createMessageElement(role, text, options);
    msgs.appendChild(div);
    if (options.scroll !== false) msgs.scrollTop = msgs.scrollHeight;
    return div;
}

function prependMessage(role, text, options) {
    options = options || {};
    if (typeof options === 'string') {
        // Legacy callers passed createdAt as the third argument.
        options = { createdAt: options };
    }
    var div = createMessageElement(role, text, options);
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

function findMessageElement(messageId) {
    if (!messageId) return null;
    var nodes = msgs.querySelectorAll('.syllentras-msg[data-message-id]');
    return Array.from(nodes).find(function (node) {
        return node.dataset.messageId === messageId;
    }) || null;
}

function renderMessageBatch(messages, prepend) {
    var list = prepend ? messages.slice().reverse() : messages;
    list.forEach(function (m) {
        var role = m.role === 'assistant' ? 'assistant' : 'user';
        var opts = {
            scroll: false,
            createdAt: m.createdAt,
            messageId: m.id,
            mode: m.mode
        };
        if (prepend) {
            prependMessage(role, m.content, opts);
        } else {
            appendMessage(role, m.content, opts);
        }
    });
}

function focusSearchMessage(messageId) {
    var target = findMessageElement(messageId);
    if (!target) return false;

    var top = target.offsetTop - Math.max(0, (msgs.clientHeight - target.offsetHeight) / 2);
    if (typeof msgs.scrollTo === 'function') {
        msgs.scrollTo({ top: top, behavior: 'smooth' });
    } else {
        msgs.scrollTop = top;
    }
    target.classList.remove('syllentras-search-match');
    // Restart the animation when the same result is selected twice.
    void target.offsetWidth;
    target.classList.add('syllentras-search-match');
    window.setTimeout(function () {
        target.classList.remove('syllentras-search-match');
    }, 3200);
    return true;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        findMessageElement: findMessageElement,
        focusSearchMessage: focusSearchMessage
    };
}
