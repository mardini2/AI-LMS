// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var messageFlashTimer = null;
var messageMarkFadeTimer = null;

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
    if (options.createdAt) div.dataset.createdAt = options.createdAt;
    var messageId = options.id || nextLocalMessageId();
    div.dataset.messageId = String(messageId);
    if (role === 'assistant' && text !== '...') {
        renderAssistantContent(div, text);
        applyModeChip(div, options.mode);
    } else {
        div.textContent = text;
    }
    if (role === 'user' || (role === 'assistant' && text !== '...')) {
        upsertMessageSearchEntry({
            id: messageId,
            role: role,
            content: text,
            createdAt: options.createdAt || null
        });
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
    resetMessageSearchIndex();
    clearMessageTextHighlights();
    if (typeof setMessageSearchResults === 'function') {
        setMessageSearchResults([], '');
    }
    if (typeof renderMessageSearchResults === 'function') {
        renderMessageSearchResults([]);
    }
    if (typeof updateMessageSearchCount === 'function') {
        updateMessageSearchCount();
    }
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
        var opts = {
            scroll: false,
            createdAt: m.createdAt,
            mode: m.mode,
            id: m.id
        };
        if (prepend) {
            prependMessage(role, m.content, opts);
        } else {
            appendMessage(role, m.content, opts);
        }
    });
}

function findMessageElement(messageId) {
    if (!msgs || messageId == null) return null;
    var id = String(messageId);
    var nodes = msgs.querySelectorAll('.syllentras-msg[data-message-id]');
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].dataset.messageId === id) return nodes[i];
    }
    return null;
}

function clearMessageTextHighlights() {
    if (!msgs) return;
    Array.from(msgs.querySelectorAll('mark.syllentras-search-mark')).forEach(function (mark) {
        var parent = mark.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
    });
    Array.from(msgs.querySelectorAll('.syllentras-msg-flash')).forEach(function (el) {
        el.classList.remove('syllentras-msg-flash');
    });
    if (messageFlashTimer) {
        clearTimeout(messageFlashTimer);
        messageFlashTimer = null;
    }
    if (messageMarkFadeTimer) {
        clearTimeout(messageMarkFadeTimer);
        messageMarkFadeTimer = null;
    }
}

function highlightTextNodeMatches(root, query) {
    if (!root || !query) return;
    var needle = query.toLowerCase();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
            if (!node.nodeValue || !node.nodeValue.toLowerCase().includes(needle)) {
                return NodeFilter.FILTER_REJECT;
            }
            // Don't mess with mode chips or other chrome.
            if (node.parentElement && node.parentElement.closest('.syllentras-msg-mode')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    var textNodes = [];
    var current = walker.nextNode();
    while (current) {
        textNodes.push(current);
        current = walker.nextNode();
    }

    textNodes.forEach(function (textNode) {
        var value = textNode.nodeValue;
        var lower = value.toLowerCase();
        var frag = document.createDocumentFragment();
        var cursor = 0;
        var hit = lower.indexOf(needle, cursor);
        while (hit !== -1) {
            if (hit > cursor) {
                frag.appendChild(document.createTextNode(value.slice(cursor, hit)));
            }
            var mark = document.createElement('mark');
            mark.className = 'syllentras-search-mark';
            mark.textContent = value.slice(hit, hit + needle.length);
            frag.appendChild(mark);
            cursor = hit + needle.length;
            hit = lower.indexOf(needle, cursor);
        }
        if (cursor < value.length) {
            frag.appendChild(document.createTextNode(value.slice(cursor)));
        }
        textNode.parentNode.replaceChild(frag, textNode);
    });
}

function flashMessageElement(el, query) {
    if (!el) return;
    clearMessageTextHighlights();
    el.classList.add('syllentras-msg-flash');
    if (query) {
        highlightTextNodeMatches(el, query);
    }
    messageFlashTimer = setTimeout(function () {
        el.classList.remove('syllentras-msg-flash');
        messageFlashTimer = null;
    }, 2400);
    messageMarkFadeTimer = setTimeout(function () {
        Array.from(el.querySelectorAll('mark.syllentras-search-mark')).forEach(function (mark) {
            mark.classList.add('is-fading');
        });
        setTimeout(function () {
            Array.from(el.querySelectorAll('mark.syllentras-search-mark')).forEach(function (mark) {
                var parent = mark.parentNode;
                if (!parent) return;
                parent.replaceChild(document.createTextNode(mark.textContent), mark);
                parent.normalize();
            });
            messageMarkFadeTimer = null;
        }, 900);
    }, 1800);
}

function scrollMessageIntoView(el) {
    if (!el || !msgs) return;
    // Scroll the messages pane itself. scrollIntoView can move the wrong
    // parent in this layout and leave you stuck where you already were.
    var containerTop = msgs.getBoundingClientRect().top;
    var elTop = el.getBoundingClientRect().top;
    var delta = elTop - containerTop - (msgs.clientHeight / 2 - el.offsetHeight / 2);
    var nextTop = Math.max(0, msgs.scrollTop + delta);
    if (typeof msgs.scrollTo === 'function') {
        msgs.scrollTo({ top: nextTop, behavior: 'smooth' });
    } else {
        msgs.scrollTop = nextTop;
    }
}

function focusMessageById(messageId, query) {
    var el = findMessageElement(messageId);
    if (!el) return Promise.resolve(null);
    scrollMessageIntoView(el);
    flashMessageElement(el, query);
    return Promise.resolve(el);
}

// Shared jump used by Find (Ctrl/Cmd+F) and sidebar search hits.
// If the match is older than the page we have loaded, keep pulling older
// pages until it shows up (or we run out of history).
function navigateToSearchMessage(messageId, query) {
    if (!messageId) return Promise.resolve(null);
    return ensureMessageVisible(messageId, query || '');
}

function ensureMessageVisible(messageId, query) {
    var existing = findMessageElement(messageId);
    if (existing) {
        return focusMessageById(messageId, query);
    }

    function pullOlder() {
        if (!hasMore) {
            return Promise.resolve(null);
        }
        return loadOlderMessages().then(function (loaded) {
            if (findMessageElement(messageId)) {
                return focusMessageById(messageId, query);
            }
            if (!loaded) {
                return null;
            }
            return pullOlder();
        });
    }

    return pullOlder();
}
