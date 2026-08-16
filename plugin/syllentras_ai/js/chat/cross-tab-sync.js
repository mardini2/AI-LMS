// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var CHAT_SYNC_DEBOUNCE_MS = 200;
var CHAT_SYNC_VISIBILITY_STALE_MS = 3000;

var chatSyncChannel = null;
var chatSyncDebounceTimer = null;
var chatSyncPendingTypes = Object.create(null);
var chatSyncPendingConversationId = null;
var peerRefreshQueued = false;
var lastChatSyncAt = 0;
/** Peer-driven mid-turn lock (other tab started a turn). */
var peerTurnActive = false;

function chatSyncChannelName() {
    return 'syllentras-chat-' + String(moodleUserId || '');
}

function markChatSyncNow() {
    lastChatSyncAt = Date.now();
}

function broadcastChatSync(type, conversationId) {
    if (!type) return;
    markChatSyncNow();
    if (!chatSyncChannel) return;
    try {
        chatSyncChannel.postMessage({
            type: String(type),
            courseId: courseId,
            conversationId: conversationId || null,
            at: lastChatSyncAt
        });
    } catch (e) {
        // Ignore closed / unsupported channel failures.
    }
}

function refreshAiContentIfNeeded() {
    if (typeof refreshAiContentList === 'function'
        && typeof isAiContentTabActive === 'function'
        && isAiContentTabActive()) {
        refreshAiContentList();
    }
}

function setPeerTurnGenerating(busy) {
    peerTurnActive = !!busy;
    if (typeof setGeneratingState === 'function') {
        setGeneratingState(peerTurnActive, { fromPeer: true });
    } else if (typeof refreshGeneratingChrome === 'function') {
        refreshGeneratingChrome();
    } else if (typeof updateComposerLock === 'function') {
        updateComposerLock();
    } else if (send) {
        send.disabled = peerTurnActive
            || (typeof isConversationGenerating === 'function' && isConversationGenerating(conversationId));
    }
}

function isLocalTurnForActiveChat() {
    return typeof isConversationGenerating === 'function'
        && isConversationGenerating(conversationId);
}

function ensurePeerThinkingPlaceholder() {
    if (!msgs || typeof appendMessage !== 'function') return null;
    var nodes = msgs.querySelectorAll('.syllentras-msg');
    var last = nodes.length ? nodes[nodes.length - 1] : null;
    if (last && last.classList.contains('assistant')) {
        var text = (last.textContent || '').trim();
        if (text === '...' || last.dataset.peerThinking === '1') {
            last.dataset.peerThinking = '1';
            return last;
        }
    }
    if (last && last.classList.contains('user')) {
        var loadingEl = appendMessage('assistant', '...', {
            forceScroll: true,
            skipTimeline: true
        });
        loadingEl.dataset.peerThinking = '1';
        if (typeof rebuildChatTimeline === 'function') {
            rebuildChatTimeline();
        }
        return loadingEl;
    }
    return null;
}

function reloadActiveConversationFromPeer(options) {
    options = options || {};
    if (!conversationId || typeof clearMessages !== 'function' || typeof loadCurrentHistory !== 'function') {
        return Promise.resolve();
    }
    if (loadingHistory) {
        peerRefreshQueued = true;
        return Promise.resolve();
    }

    var stick = !!pinnedToBottom;
    clearMessages();
    pinnedToBottom = stick;
    if (typeof beginMessageListSettle === 'function') {
        beginMessageListSettle();
    }
    hasMore = false;
    loadingHistory = false;

    return loadCurrentHistory({ deferScroll: !stick }).then(function () {
        if (options.showThinking || peerTurnActive) {
            ensurePeerThinkingPlaceholder();
        }
        refreshAiContentIfNeeded();
        markChatSyncNow();
    });
}

function queueOrReloadActiveConversationFromPeer(options) {
    // Local in-flight send already owns the optimistic UI — don't wipe it.
    if (isLocalTurnForActiveChat() && !peerTurnActive) {
        peerRefreshQueued = true;
        return Promise.resolve();
    }
    return reloadActiveConversationFromPeer(options);
}

function flushPeerSyncQueue() {
    if (!peerRefreshQueued) return;
    if (isLocalTurnForActiveChat() && !peerTurnActive) {
        return;
    }
    peerRefreshQueued = false;
    reloadActiveConversationFromPeer({ showThinking: peerTurnActive });
}

function applyPeerTurnStarted(eventConversationId) {
    var sameConversation = !!(conversationId && eventConversationId
        && String(conversationId) === String(eventConversationId));
    if (!sameConversation) {
        if (typeof loadConversations === 'function') {
            loadConversations();
        }
        return;
    }
    // This tab is already the sender — BroadcastChannel does not echo, but
    // guard anyway if generating locally without peerTurnActive.
    if (isLocalTurnForActiveChat() && !peerTurnActive) {
        return;
    }
    setPeerTurnGenerating(true);
    queueOrReloadActiveConversationFromPeer({ showThinking: true });
}

function applyPeerTurnFinished(eventConversationId) {
    var sameConversation = !!(conversationId && eventConversationId
        && String(conversationId) === String(eventConversationId));
    if (peerTurnActive) {
        setPeerTurnGenerating(false);
    }
    if (!sameConversation) {
        if (typeof loadConversations === 'function') {
            loadConversations();
        }
        return;
    }
    if (isLocalTurnForActiveChat() && !peerTurnActive) {
        peerRefreshQueued = true;
        return;
    }
    queueOrReloadActiveConversationFromPeer({ showThinking: false });
}

function flushPendingChatSyncTypes() {
    var types = chatSyncPendingTypes;
    var eventConversationId = chatSyncPendingConversationId;
    chatSyncPendingTypes = Object.create(null);
    chatSyncPendingConversationId = null;

    var sameConversation = !!(conversationId && eventConversationId
        && String(conversationId) === String(eventConversationId));

    markChatSyncNow();

    // Turn lifecycle takes precedence within the debounce window.
    if (types['turn-finished']) {
        applyPeerTurnFinished(eventConversationId);
        if (types['conversation-list-changed'] && typeof loadConversations === 'function') {
            loadConversations();
        }
        return;
    }
    if (types['turn-started']) {
        applyPeerTurnStarted(eventConversationId);
        if (types['conversation-list-changed'] && typeof loadConversations === 'function') {
            loadConversations();
        }
        return;
    }

    var needsList = !!types['conversation-list-changed'];
    var needsHistory = !!(types['messages-updated'] || types['pending-action-changed']
        || (types['conversation-list-changed'] && sameConversation));

    if (needsList && typeof loadConversations === 'function') {
        loadConversations();
    }
    if (needsHistory && sameConversation) {
        queueOrReloadActiveConversationFromPeer({ showThinking: peerTurnActive });
    } else if (!needsList && needsHistory && !sameConversation && typeof loadConversations === 'function') {
        loadConversations();
    }
}

function scheduleChatSyncApply(event) {
    if (!event || !event.type) return;
    if (event.courseId != null && String(event.courseId) !== String(courseId)) return;

    chatSyncPendingTypes[event.type] = true;
    if (event.conversationId) {
        chatSyncPendingConversationId = event.conversationId;
    }

    if (chatSyncDebounceTimer) {
        clearTimeout(chatSyncDebounceTimer);
    }
    chatSyncDebounceTimer = setTimeout(function () {
        chatSyncDebounceTimer = null;
        flushPendingChatSyncTypes();
    }, CHAT_SYNC_DEBOUNCE_MS);
}

function onChatSyncMessage(messageEvent) {
    var data = messageEvent && messageEvent.data;
    if (!data || typeof data !== 'object' || !data.type) return;
    scheduleChatSyncApply(data);
}

function onChatSyncVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    if (!conversationId) return;
    if (Date.now() - lastChatSyncAt < CHAT_SYNC_VISIBILITY_STALE_MS) return;
    queueOrReloadActiveConversationFromPeer({ showThinking: peerTurnActive });
}

/** After history load: if server says a turn is mid-flight, show thinking UI. */
function applyGeneratingStateFromHistoryPage(page) {
    if (!page || !page.generatingStartedAt) return;
    if (isLocalTurnForActiveChat() && !peerTurnActive) {
        // Switched back to a chat that is still generating locally — restore "...".
        ensurePeerThinkingPlaceholder();
        return;
    }
    setPeerTurnGenerating(true);
    ensurePeerThinkingPlaceholder();
}

function initCrossTabSync() {
    if (typeof BroadcastChannel === 'function' && moodleUserId) {
        try {
            chatSyncChannel = new BroadcastChannel(chatSyncChannelName());
            chatSyncChannel.addEventListener('message', onChatSyncMessage);
        } catch (e) {
            chatSyncChannel = null;
        }
    }

    document.addEventListener('visibilitychange', onChatSyncVisibilityChange);
    markChatSyncNow();
}
