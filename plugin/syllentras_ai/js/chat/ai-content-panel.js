// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var activeChatTab = 'chat';
var aiContentList = null;
var aiContentEmptyEl = null;
var aiContentToolbar = null;
var aiContentOpenMenu = null;
var tabChatBtn = document.getElementById('syllentras-tab-chat');
var tabAiContentBtn = document.getElementById('syllentras-tab-ai-content');
var panelChat = document.getElementById('syllentras-panel-chat');
var panelAiContent = document.getElementById('syllentras-panel-ai-content');

var aiContentItems = [];
var aiContentSortKey = 'course';
var aiContentSortDir = 'asc';
var aiContentFilterKinds = {};
var aiContentBulkMode = false;
var aiContentSelected = {};
var aiContentToolbarBound = false;

var SORT_LABELS = {
    course: 'Course order',
    modified: 'Recently modified',
    alpha: 'Alphabetical'
};
var SORT_DEFAULT_DIR = {
    course: 'asc',
    modified: 'desc',
    alpha: 'asc'
};

function kindBadgeLabel(kind) {
    if (kind === 'flashcards') return 'Flashcards';
    if (kind === 'practice_quiz') return 'Quiz';
    return 'Guide';
}

function isAiContentTabActive() {
    return activeChatTab === 'ai-content';
}

function bindAiContentDom() {
    if (!panelAiContent) return;
    aiContentList = panelAiContent.querySelector('#syllentras-ai-content-list') ||
        panelAiContent.querySelector('.syllentras-ai-content-list');
    aiContentEmptyEl = panelAiContent.querySelector('.syllentras-ai-content-empty');
    aiContentToolbar = panelAiContent.querySelector('#syllentras-ai-content-toolbar');
    if (!aiContentToolbarBound && aiContentToolbar) {
        bindAiContentToolbar();
        aiContentToolbarBound = true;
    }
}

function setChatTab(tab) {
    if (tab !== 'chat' && tab !== 'ai-content') {
        tab = 'chat';
    }
    activeChatTab = tab;

    var chatSelected = tab === 'chat';
    if (tabChatBtn) {
        tabChatBtn.setAttribute('aria-selected', chatSelected ? 'true' : 'false');
        tabChatBtn.tabIndex = chatSelected ? 0 : -1;
    }
    if (tabAiContentBtn) {
        tabAiContentBtn.setAttribute('aria-selected', chatSelected ? 'false' : 'true');
        tabAiContentBtn.tabIndex = chatSelected ? -1 : 0;
    }
    if (panelChat) {
        panelChat.hidden = !chatSelected;
    }
    if (panelAiContent) {
        panelAiContent.hidden = chatSelected;
    }

    closeAiContentMenu();
    closeAiContentDropdowns();
    closeConversationMenu();
    closeToolsMenu();

    if (!chatSelected) {
        refreshAiContentList();
    }
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

function closeAiContentDropdowns() {
    if (!aiContentToolbar) return;
    Array.from(aiContentToolbar.querySelectorAll('.syllentras-ai-content-dd-panel')).forEach(function (panel) {
        panel.hidden = true;
    });
    Array.from(aiContentToolbar.querySelectorAll('.syllentras-ai-content-dd-btn')).forEach(function (btn) {
        btn.setAttribute('aria-expanded', 'false');
    });
}

function selectedKindCount() {
    return Object.keys(aiContentFilterKinds).filter(function (k) {
        return aiContentFilterKinds[k];
    }).length;
}

function selectedCmCount() {
    return Object.keys(aiContentSelected).filter(function (id) {
        return aiContentSelected[id];
    }).length;
}

function getVisibleAiContentItems() {
    var filtered = aiContentItems.filter(function (item) {
        if (selectedKindCount() === 0) return true;
        return !!aiContentFilterKinds[item.kind];
    });

    var dir = aiContentSortDir === 'desc' ? -1 : 1;
    filtered.sort(function (a, b) {
        var cmp = 0;
        if (aiContentSortKey === 'modified') {
            cmp = (a.timeModified || 0) - (b.timeModified || 0);
            if (cmp === 0) cmp = (a.sortOrder || 0) - (b.sortOrder || 0);
        } else if (aiContentSortKey === 'alpha') {
            cmp = String(a.name || '').localeCompare(String(b.name || ''), undefined, {
                sensitivity: 'base'
            });
            if (cmp === 0) cmp = (a.sortOrder || 0) - (b.sortOrder || 0);
        } else {
            cmp = (a.sortOrder || 0) - (b.sortOrder || 0);
        }
        if (cmp === 0) cmp = (a.cmId || 0) - (b.cmId || 0);
        return cmp * dir;
    });
    return filtered;
}

function updateAiContentToolbarChrome() {
    if (!aiContentToolbar) return;

    var sortBtn = aiContentToolbar.querySelector('#syllentras-ai-sort-btn');
    var filterBtn = aiContentToolbar.querySelector('#syllentras-ai-filter-btn');
    var bulkToggle = aiContentToolbar.querySelector('#syllentras-ai-bulk-toggle');
    var bulkRow = aiContentToolbar.querySelector('#syllentras-ai-bulk-row');
    var bulkDelete = aiContentToolbar.querySelector('#syllentras-ai-bulk-delete');
    var arrow = aiContentSortDir === 'desc' ? '↓' : '↑';

    if (sortBtn) {
        sortBtn.innerHTML =
            'Sort: ' +
            (SORT_LABELS[aiContentSortKey] || 'Course order') +
            ' <span class="syllentras-ai-content-sort-arrow" aria-hidden="true">' +
            arrow +
            '</span>';
    }

    Array.from(aiContentToolbar.querySelectorAll('.syllentras-ai-content-dd-option[data-sort]')).forEach(
        function (opt) {
            var key = opt.getAttribute('data-sort');
            var active = key === aiContentSortKey;
            opt.classList.toggle('is-active', active);
            var existing = opt.querySelector('.syllentras-ai-content-sort-arrow');
            if (active) {
                if (!existing) {
                    existing = document.createElement('span');
                    existing.className = 'syllentras-ai-content-sort-arrow';
                    existing.setAttribute('aria-hidden', 'true');
                    opt.appendChild(existing);
                }
                existing.textContent = arrow;
            } else if (existing) {
                existing.remove();
            }
        }
    );

    if (filterBtn) {
        var n = selectedKindCount();
        if (n === 0) {
            filterBtn.textContent = 'Type: All';
        } else if (n === 1) {
            var only = Object.keys(aiContentFilterKinds).find(function (k) {
                return aiContentFilterKinds[k];
            });
            filterBtn.textContent =
                'Type: ' +
                (only === 'flashcards'
                    ? 'Flashcards'
                    : only === 'practice_quiz'
                      ? 'Quiz'
                      : 'Study guide');
        } else {
            filterBtn.textContent = 'Type: ' + n + ' selected';
        }
    }

    if (bulkToggle) {
        bulkToggle.textContent = aiContentBulkMode ? 'Done' : 'Select';
    }
    if (bulkRow) {
        bulkRow.hidden = !aiContentBulkMode;
    }
    if (bulkDelete) {
        bulkDelete.disabled = selectedCmCount() < 1;
        bulkDelete.textContent =
            selectedCmCount() > 0 ? 'Delete (' + selectedCmCount() + ')' : 'Delete';
    }
}

function renderAiContentList() {
    if (!aiContentList || !aiContentEmptyEl) return;

    closeAiContentMenu();
    var visible = getVisibleAiContentItems();
    aiContentList.innerHTML = '';

    if (!aiContentItems.length) {
        if (aiContentToolbar) aiContentToolbar.hidden = true;
        aiContentEmptyEl.hidden = false;
        aiContentEmptyEl.textContent = 'No AI Content yet in this course.';
        updateAiContentToolbarChrome();
        return;
    }

    if (aiContentToolbar) aiContentToolbar.hidden = false;

    if (!visible.length) {
        aiContentEmptyEl.hidden = false;
        aiContentEmptyEl.textContent = 'No items match the selected type filter.';
        updateAiContentToolbarChrome();
        return;
    }

    aiContentEmptyEl.hidden = true;
    visible.forEach(function (item) {
        aiContentList.appendChild(renderAiContentRow(item));
    });
    updateAiContentToolbarChrome();
}

function refreshAiContentList() {
    bindAiContentDom();
    if (!aiContentList || !aiContentEmptyEl) return;

    aiContentSelected = {};
    aiContentBulkMode = false;
    closeAiContentDropdowns();

    if (courseId <= 1) {
        aiContentItems = [];
        aiContentList.innerHTML = '';
        if (aiContentToolbar) aiContentToolbar.hidden = true;
        aiContentEmptyEl.hidden = false;
        aiContentEmptyEl.textContent = 'Open a course page to manage your AI Content.';
        updateAiContentToolbarChrome();
        return;
    }

    aiContentList.innerHTML = '<p class="syllentras-ai-content-loading">Loading…</p>';
    aiContentEmptyEl.hidden = true;
    if (aiContentToolbar) aiContentToolbar.hidden = true;

    fetchJson(
        '/ai-content?courseId=' + encodeURIComponent(courseId) +
        '&moodleUserId=' + encodeURIComponent(moodleUserId)
    )
        .then(function (data) {
            aiContentItems = ((data && data.items) || []).map(function (item, index) {
                return {
                    cmId: item.cmId,
                    modname: item.modname,
                    name: item.name,
                    kind: item.kind,
                    viewUrl: item.viewUrl,
                    sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index,
                    timeModified: typeof item.timeModified === 'number' ? item.timeModified : 0
                };
            });
            renderAiContentList();
        })
        .catch(function () {
            aiContentItems = [];
            aiContentList.innerHTML = '';
            if (aiContentToolbar) aiContentToolbar.hidden = true;
            aiContentEmptyEl.hidden = false;
            aiContentEmptyEl.textContent = 'Could not load AI Content. Try again.';
            updateAiContentToolbarChrome();
        });
}

function renderAiContentRow(item) {
    var row = document.createElement('div');
    row.className = 'syllentras-ai-content-item' + (aiContentBulkMode ? ' is-bulk' : '');
    row.setAttribute('data-cmid', String(item.cmId));

    if (aiContentBulkMode) {
        var checkWrap = document.createElement('label');
        checkWrap.className = 'syllentras-ai-content-item-check';
        var check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = !!aiContentSelected[item.cmId];
        check.setAttribute('aria-label', 'Select ' + (item.name || 'item'));
        check.addEventListener('change', function () {
            if (check.checked) {
                aiContentSelected[item.cmId] = true;
            } else {
                delete aiContentSelected[item.cmId];
            }
            updateAiContentToolbarChrome();
        });
        checkWrap.appendChild(check);
        row.appendChild(checkWrap);
    }

    var main = document.createElement('div');
    main.className = 'syllentras-ai-content-item-main';
    var nameEl = document.createElement('a');
    nameEl.className = 'syllentras-ai-content-name';
    nameEl.textContent = item.name || 'Untitled';
    nameEl.href = item.viewUrl || '#';
    nameEl.target = '_blank';
    nameEl.rel = 'noopener noreferrer';
    var kindEl = document.createElement('span');
    kindEl.className = 'syllentras-ai-content-kind';
    kindEl.textContent = kindBadgeLabel(item.kind);
    main.appendChild(nameEl);
    main.appendChild(kindEl);
    row.appendChild(main);

    var menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'syllentras-ai-content-menu-btn';
    menuBtn.setAttribute('aria-label', 'Content menu');
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.innerHTML = '&#8942;';
    menuBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (aiContentBulkMode) return;
        showAiContentMenu(e.currentTarget, item);
    });
    row.appendChild(menuBtn);

    return row;
}

function showAiContentMenu(anchor, item) {
    closeConversationMenu();
    closeToolsMenu();
    closeAiContentMenu();
    closeAiContentDropdowns();
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
    var hint = document.createElement('p');
    hint.style.margin = '0 0 6px';
    hint.style.fontSize = '12px';
    hint.style.color = '#667788';
    hint.textContent = kindBadgeLabel(item.kind) + ' prefix is kept automatically.';
    var input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 200;
    input.value = String(item.name || '')
        .replace(/^(Study Guide|Flashcards|Quiz|Practice Quiz)\s*:\s*/i, '')
        .trim();
    wrap.appendChild(label);
    wrap.appendChild(hint);
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
                        name: name,
                        kind: item.kind || 'study_guide'
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

function deleteSelectedAiContentItems() {
    var ids = Object.keys(aiContentSelected)
        .filter(function (id) { return aiContentSelected[id]; })
        .map(function (id) { return parseInt(id, 10); })
        .filter(function (id) { return id > 0; });

    if (!ids.length) return;

    var names = ids.map(function (id) {
        var found = aiContentItems.find(function (item) { return item.cmId === id; });
        return found && found.name ? found.name : 'Item ' + id;
    });
    var preview =
        names.length <= 3
            ? names.map(function (n) { return '"' + n + '"'; }).join(', ')
            : names.slice(0, 2).map(function (n) { return '"' + n + '"'; }).join(', ') +
              ', and ' + (names.length - 2) + ' more';

    showModal(
        'Delete selected content?',
        'Delete ' + ids.length + ' item' + (ids.length === 1 ? '' : 's') +
            ' (' + preview + ')? This cannot be undone.',
        [
            { label: 'Cancel', className: 'syllentras-modal-secondary', onClick: closeModal },
            {
                label: 'Delete',
                className: 'syllentras-modal-danger',
                onClick: function () {
                    closeModal();
                    var failed = 0;
                    var chain = Promise.resolve();
                    ids.forEach(function (cmId) {
                        chain = chain.then(function () {
                            return fetchJson('/ai-content/delete', {
                                method: 'POST',
                                body: JSON.stringify({
                                    courseId: courseId,
                                    moodleUserId: moodleUserId,
                                    cmId: cmId
                                })
                            }).catch(function () {
                                failed += 1;
                            });
                        });
                    });
                    chain.then(function () {
                        aiContentBulkMode = false;
                        aiContentSelected = {};
                        refreshAiContentList();
                        if (failed > 0) {
                            showModal(
                                'Delete',
                                failed === ids.length
                                    ? 'Could not delete the selected items.'
                                    : 'Deleted some items, but ' + failed + ' failed.',
                                [
                                    {
                                        label: 'Close',
                                        className: 'syllentras-modal-secondary',
                                        onClick: closeModal
                                    }
                                ]
                            );
                        }
                    });
                }
            }
        ]
    );
}

function bindAiContentToolbar() {
    if (!aiContentToolbar) return;

    var sortBtn = aiContentToolbar.querySelector('#syllentras-ai-sort-btn');
    var sortPanel = aiContentToolbar.querySelector('#syllentras-ai-sort-panel');
    var filterBtn = aiContentToolbar.querySelector('#syllentras-ai-filter-btn');
    var filterPanel = aiContentToolbar.querySelector('#syllentras-ai-filter-panel');
    var bulkToggle = aiContentToolbar.querySelector('#syllentras-ai-bulk-toggle');
    var selectAllBtn = aiContentToolbar.querySelector('#syllentras-ai-select-all');
    var deselectAllBtn = aiContentToolbar.querySelector('#syllentras-ai-deselect-all');
    var bulkDeleteBtn = aiContentToolbar.querySelector('#syllentras-ai-bulk-delete');

    function togglePanel(btn, panel) {
        var willOpen = panel.hidden;
        closeAiContentDropdowns();
        closeAiContentMenu();
        if (willOpen) {
            panel.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
        }
    }

    if (sortBtn && sortPanel) {
        sortBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            togglePanel(sortBtn, sortPanel);
        });
        Array.from(sortPanel.querySelectorAll('[data-sort]')).forEach(function (opt) {
            opt.addEventListener('click', function (e) {
                e.stopPropagation();
                var key = opt.getAttribute('data-sort');
                if (key === aiContentSortKey) {
                    aiContentSortDir = aiContentSortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    aiContentSortKey = key;
                    aiContentSortDir = SORT_DEFAULT_DIR[key] || 'asc';
                }
                closeAiContentDropdowns();
                renderAiContentList();
            });
        });
    }

    if (filterBtn && filterPanel) {
        filterBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            togglePanel(filterBtn, filterPanel);
        });
        Array.from(filterPanel.querySelectorAll('input[type="checkbox"]')).forEach(function (box) {
            box.addEventListener('change', function () {
                if (box.checked) {
                    aiContentFilterKinds[box.value] = true;
                } else {
                    delete aiContentFilterKinds[box.value];
                }
                aiContentSelected = {};
                renderAiContentList();
            });
            box.addEventListener('click', function (e) {
                e.stopPropagation();
            });
        });
        filterPanel.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    }

    if (bulkToggle) {
        bulkToggle.addEventListener('click', function () {
            closeAiContentDropdowns();
            closeAiContentMenu();
            aiContentBulkMode = !aiContentBulkMode;
            if (!aiContentBulkMode) {
                aiContentSelected = {};
            }
            renderAiContentList();
        });
    }

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', function () {
            getVisibleAiContentItems().forEach(function (item) {
                aiContentSelected[item.cmId] = true;
            });
            renderAiContentList();
        });
    }

    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', function () {
            getVisibleAiContentItems().forEach(function (item) {
                delete aiContentSelected[item.cmId];
            });
            renderAiContentList();
        });
    }

    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', function () {
            deleteSelectedAiContentItems();
        });
    }

    document.addEventListener('click', function (e) {
        if (!aiContentToolbar) return;
        if (aiContentToolbar.contains(e.target)) return;
        closeAiContentDropdowns();
    });
}

bindAiContentDom();
if (tabChatBtn) {
    tabChatBtn.addEventListener('click', function () { setChatTab('chat'); });
}
if (tabAiContentBtn) {
    tabAiContentBtn.addEventListener('click', function () { setChatTab('ai-content'); });
}
setChatTab('chat');
