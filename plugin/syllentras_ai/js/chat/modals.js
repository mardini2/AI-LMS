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
    closeToolsMenu();
    closeConversationMenu();
    anchor.classList.add('open');

    var menu = document.createElement('div');
    menu.className = 'syllentras-conversation-menu';
    menu.setAttribute('role', 'menu');

    // Only show a clock after the student has actually typed — welcome-only
    // Main/Home (or a just-cleared one) should stay quiet.
    var when = conversation.lastUserMessageAt || null;
    var relative =
        when && typeof formatRelativeConversationTime === 'function'
            ? formatRelativeConversationTime(when)
            : '';
    if (relative) {
        var meta = document.createElement('div');
        meta.className = 'syllentras-conversation-menu-meta';
        meta.textContent = relative;
        meta.title = new Date(when).toLocaleString();
        menu.appendChild(meta);
    }

    addMenuAction(menu, 'Rename', function () { showRenameModal(conversation); }, conversation.type !== 'manual');
    addMenuAction(menu, conversation.pinned ? 'Unpin' : 'Pin', function () { togglePinConversation(conversation); }, conversation.type === 'general');
    addMenuAction(menu, 'Export', function () { showExportModal(conversation); });
    addMenuAction(menu, 'Delete', function () { deleteConversation(conversation); }, false, true);
    // Keep it under #syllentras-chat-root so theme colors (panel bg, text, etc.) actually apply.
    // Dropping it on document.body made background: var(--syll-panel-bg) resolve to nothing.
    (root || document.body).appendChild(menu);

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
    closeToolsMenu();
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
        var generalTitle = generalChatTitle();
        showModal(
            'Clear ' + generalTitle + ' history?',
            'Clear all messages in ' + generalTitle + '? The conversation will stay available. Course content will not be deleted.',
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
            // Reload history so the fresh welcome bubble shows up after clear.
            if (conversation.id === conversationId) {
                return setActiveConversation(result.conversation || conversation)
                    .then(function () {
                        if (typeof broadcastChatSync === 'function') {
                            broadcastChatSync('messages-updated', conversation.id);
                            broadcastChatSync('conversation-list-changed', conversation.id);
                        }
                        return loadConversations();
                    });
            }
            if (typeof broadcastChatSync === 'function') {
                broadcastChatSync('conversation-list-changed', conversation.id);
            }
            return loadConversations();
        }

        if (conversation.id === conversationId) {
            clearMessages();
            conversationId = null;
            activeConversation = null;
            persistLastConversationId(null);
            return openConversation({ type: 'general', title: generalChatTitle() })
                .then(function () {
                    if (typeof broadcastChatSync === 'function') {
                        broadcastChatSync('conversation-list-changed', conversation.id);
                    }
                });
        }
        if (typeof broadcastChatSync === 'function') {
            broadcastChatSync('conversation-list-changed', conversation.id);
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
                        if (typeof broadcastChatSync === 'function') {
                            broadcastChatSync('conversation-list-changed', conversation.id);
                        }
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
            if (typeof broadcastChatSync === 'function') {
                broadcastChatSync('conversation-list-changed', conversation.id);
            }
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
        displayConversationTitle(conversation),
        displayConversationTag(conversation),
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

