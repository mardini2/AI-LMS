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

