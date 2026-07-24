// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function setActiveConversation(conversation) {
    activeConversation = conversation;
    if (activeConversation && Array.isArray(conversation.topicSuggestions)) {
        activeConversation.topicSuggestions = conversation.topicSuggestions;
    }
    conversationId = conversation.id;
    activeTitle.textContent = displayConversationTitle(conversation);
    activeTag.textContent = displayConversationTag(conversation);
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
    renderConversationGroup(generalConversationGroupTitle(), conversations.filter(function (c) { return c.type === 'general'; }));
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
    nameEl.textContent = displayConversationTitle(conversation);
    nameEl.classList.toggle('pinned', !!conversation.pinned);
    item.querySelector('.syllentras-conversation-tag').textContent = displayConversationTag(conversation);
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
    setGeneratingState(true);
    appendMessage('user', text);
    var loadingEl = appendMessage('assistant', '...');

    var body = {
        courseId: courseId,
        courseName: courseName || undefined,
        moodleUserId: moodleUserId,
        userFirstName: userFirstName || undefined,
        message: text,
        conversationId: conversationId
    };
    // Selected provider rides along so mid-chat switches apply to the next turn.
    var providerId = typeof getSelectedProviderId === 'function' ? getSelectedProviderId() : null;
    if (providerId) {
        body.provider = providerId;
    }
    var modeId = typeof getSelectedModeId === 'function' ? getSelectedModeId() : 'direct';
    body.mode = modeId === 'coach' ? 'coach' : 'direct';
    if (body.mode === 'coach' && typeof getSelectedGuidance === 'function') {
        body.guidance = getSelectedGuidance();
    }

    fetchJson('/chat/message', {
        method: 'POST',
        body: JSON.stringify(body)
    })
    .then(function (data) {
        renderAssistantContent(loadingEl, data.response);
        applyModeChip(loadingEl, data.mode || body.mode);
        loadingEl.dataset.createdAt = new Date().toISOString();
        conversationId = data.conversationId || conversationId;
        if (Array.isArray(data.topicSuggestions)) {
            if (!activeConversation) activeConversation = { id: conversationId };
            activeConversation.topicSuggestions = data.topicSuggestions;
        }
        if (data.pendingAction) {
            attachPendingAction(loadingEl, data.pendingAction);
        }
        return loadConversations();
    })
    .catch(function (err) {
        loadingEl.className = 'syllentras-msg error';
        loadingEl.textContent = (err && err.message)
            ? err.message
            : 'Something went wrong. Please try again.';
    })
    .finally(function () {
        send.disabled = false;
        setGeneratingState(false);
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

