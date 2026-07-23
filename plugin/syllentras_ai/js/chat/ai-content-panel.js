// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var aiContentBtn = null;
var aiContentPanel = null;
var aiContentList = null;
var aiContentOpenMenu = null;

function kindBadgeLabel(kind) {
    if (kind === 'flashcards') return 'Flashcards';
    if (kind === 'practice_quiz') return 'Quiz';
    return 'Guide';
}

function ensureAiContentUi() {
    if (aiContentPanel) return;

    var sidebar = document.getElementById('syllentras-chat-sidebar');
    if (!sidebar) return;

    var row = sidebar.querySelector('.syllentras-sidebar-row');
    if (row && !document.getElementById('syllentras-ai-content-btn')) {
        aiContentBtn = document.createElement('button');
        aiContentBtn.id = 'syllentras-ai-content-btn';
        aiContentBtn.type = 'button';
        aiContentBtn.title = 'My AI Content';
        aiContentBtn.textContent = 'AI Content';
        row.appendChild(aiContentBtn);
        aiContentBtn.addEventListener('click', toggleAiContentPanel);
    }

    aiContentPanel = document.createElement('div');
    aiContentPanel.id = 'syllentras-ai-content-panel';
    aiContentPanel.hidden = true;
    aiContentPanel.innerHTML =
        '<div class="syllentras-ai-content-header">' +
        '<span>My AI Content</span>' +
        '<button type="button" class="syllentras-ai-content-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="syllentras-ai-content-body">' +
        '<p class="syllentras-ai-content-empty" hidden>No AI Content yet in this course.</p>' +
        '<div class="syllentras-ai-content-list"></div>' +
        '</div>';
    sidebar.appendChild(aiContentPanel);
    aiContentList = aiContentPanel.querySelector('.syllentras-ai-content-list');
    aiContentPanel.querySelector('.syllentras-ai-content-close').addEventListener('click', function () {
        aiContentPanel.hidden = true;
    });
}

function toggleAiContentPanel() {
    ensureAiContentUi();
    if (!aiContentPanel) return;
    if (!aiContentPanel.hidden) {
        aiContentPanel.hidden = true;
        return;
    }
    if (courseId <= 1) {
        showModal('My AI Content', 'Open a course page to manage your AI Content.', [
            { label: 'Close', className: 'syllentras-modal-secondary', onClick: closeModal }
        ]);
        return;
    }
    aiContentPanel.hidden = false;
    refreshAiContentList();
}

function closeAiContentMenu() {
    if (aiContentOpenMenu) {
        aiContentOpenMenu.remove();
        aiContentOpenMenu = null;
    }
    if (aiContentList) {
        Array.from(aiContentList.querySelectorAll('.syllentras-ai-content-menu-btn.open')).forEach(function (btn) {
            btn.classList.remove('open');
        });
    }
}

function refreshAiContentList() {
    ensureAiContentUi();
    if (!aiContentList || courseId <= 1) return;

    var emptyEl = aiContentPanel.querySelector('.syllentras-ai-content-empty');
    aiContentList.innerHTML = '<p class="syllentras-ai-content-loading">Loading…</p>';
    emptyEl.hidden = true;

    fetchJson(
        '/ai-content?courseId=' + encodeURIComponent(courseId) +
        '&moodleUserId=' + encodeURIComponent(moodleUserId)
    )
        .then(function (data) {
            var items = (data && data.items) || [];
            aiContentList.innerHTML = '';
            if (!items.length) {
                emptyEl.hidden = false;
                return;
            }
            emptyEl.hidden = true;
            items.forEach(function (item) {
                aiContentList.appendChild(renderAiContentRow(item));
            });
        })
        .catch(function () {
            aiContentList.innerHTML = '';
            emptyEl.hidden = false;
            emptyEl.textContent = 'Could not load AI Content. Try again.';
        });
}

function renderAiContentRow(item) {
    var row = document.createElement('div');
    row.className = 'syllentras-ai-content-item';
    row.innerHTML =
        '<div class="syllentras-ai-content-item-main">' +
        '<a class="syllentras-ai-content-name" href="#"></a>' +
        '<span class="syllentras-ai-content-kind"></span>' +
        '</div>' +
        '<button type="button" class="syllentras-ai-content-menu-btn" aria-label="Content menu" aria-haspopup="menu">&#8942;</button>';

    var nameEl = row.querySelector('.syllentras-ai-content-name');
    nameEl.textContent = item.name || 'Untitled';
    nameEl.href = item.viewUrl || '#';
    nameEl.target = '_blank';
    nameEl.rel = 'noopener noreferrer';
    row.querySelector('.syllentras-ai-content-kind').textContent = kindBadgeLabel(item.kind);

    row.querySelector('.syllentras-ai-content-menu-btn').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showAiContentMenu(e.currentTarget, item);
    });

    return row;
}

function showAiContentMenu(anchor, item) {
    closeConversationMenu();
    closeToolsMenu();
    closeAiContentMenu();
    anchor.classList.add('open');

    var menu = document.createElement('div');
    menu.className = 'syllentras-ai-content-menu';
    menu.setAttribute('role', 'menu');

    function addAction(label, handler, danger) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'syllentras-menu-action' + (danger ? ' danger' : '');
        button.textContent = label;
        button.addEventListener('click', function (e) {
            e.stopPropagation();
            closeAiContentMenu();
            handler();
        });
        menu.appendChild(button);
    }

    addAction('Open', function () {
        if (item.viewUrl) window.open(item.viewUrl, '_blank', 'noopener,noreferrer');
    });
    addAction('Rename', function () { renameAiContentItem(item); });
    addAction('Delete', function () { deleteAiContentItem(item); }, true);

    document.body.appendChild(menu);
    var rect = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, rect.right - 140) + 'px';
    menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4) + 'px';
    aiContentOpenMenu = menu;
}

function renameAiContentItem(item) {
    var wrap = document.createElement('div');
    var label = document.createElement('label');
    label.textContent = 'Title';
    var input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 200;
    input.value = item.name || '';
    wrap.appendChild(label);
    wrap.appendChild(input);

    showModal('Rename', wrap, [
        { label: 'Cancel', className: 'syllentras-modal-secondary', onClick: closeModal },
        {
            label: 'Save',
            className: 'syllentras-modal-primary',
            onClick: function () {
                var name = (input.value || '').trim();
                if (!name) return;
                closeModal();
                fetchJson('/ai-content/rename', {
                    method: 'POST',
                    body: JSON.stringify({
                        courseId: courseId,
                        moodleUserId: moodleUserId,
                        cmId: item.cmId,
                        name: name
                    })
                })
                    .then(function () {
                        refreshAiContentList();
                    })
                    .catch(function () {
                        showModal('Rename', 'Could not rename this item.', [
                            { label: 'Close', className: 'syllentras-modal-secondary', onClick: closeModal }
                        ]);
                    });
            }
        }
    ]);
    setTimeout(function () { input.focus(); input.select(); }, 0);
}

function deleteAiContentItem(item) {
    showModal(
        'Delete this content?',
        'Delete "' + (item.name || 'this item') + '"? This cannot be undone.',
        [
            { label: 'Cancel', className: 'syllentras-modal-secondary', onClick: closeModal },
            {
                label: 'Delete',
                className: 'syllentras-modal-danger',
                onClick: function () {
                    closeModal();
                    fetchJson('/ai-content/delete', {
                        method: 'POST',
                        body: JSON.stringify({
                            courseId: courseId,
                            moodleUserId: moodleUserId,
                            cmId: item.cmId
                        })
                    })
                        .then(function () {
                            refreshAiContentList();
                        })
                        .catch(function () {
                            showModal('Delete', 'Could not delete this item.', [
                                { label: 'Close', className: 'syllentras-modal-secondary', onClick: closeModal }
                            ]);
                        });
                }
            }
        ]
    );
}

ensureAiContentUi();
