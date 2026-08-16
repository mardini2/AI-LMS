// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.
//
// Find-in-chat UI: the little search bar above the messages, result list, and
// keyboard bits. Talks to message-search.js for matches and messages.js to jump.

function isMessageSearchUiReady() {
    return !!(msgSearchPanel && msgSearchInput && msgSearchResults);
}

function openMessageSearch() {
    if (!isMessageSearchUiReady()) return;
    messageSearchOpen = true;
    msgSearchPanel.hidden = false;
    if (msgSearchToggle) {
        msgSearchToggle.setAttribute('aria-expanded', 'true');
    }
    msgSearchInput.focus();
    msgSearchInput.select();
    if (msgSearchInput.value.trim()) {
        runMessageSearch(msgSearchInput.value);
    } else {
        renderMessageSearchResults([]);
        updateMessageSearchCount();
    }
}

function closeMessageSearch() {
    if (!isMessageSearchUiReady()) return;
    messageSearchOpen = false;
    clearMessageSearchSchedule();
    msgSearchPanel.hidden = true;
    if (msgSearchToggle) {
        msgSearchToggle.setAttribute('aria-expanded', 'false');
    }
    setMessageSearchResults([], '');
    renderMessageSearchResults([]);
    updateMessageSearchCount();
    clearMessageTextHighlights();
}

function toggleMessageSearch() {
    if (messageSearchOpen) {
        closeMessageSearch();
    } else {
        openMessageSearch();
    }
}

function updateMessageSearchCount() {
    if (!msgSearchCount) return;
    var total = messageSearchResults.length;
    if (!messageSearchQuery) {
        msgSearchCount.textContent = '';
        return;
    }
    if (!total) {
        msgSearchCount.textContent = '0 matches';
        return;
    }
    msgSearchCount.textContent = (messageSearchActiveIndex + 1) + ' / ' + total;
}

function renderMessageSearchResults(results) {
    if (!msgSearchResults) return;
    msgSearchResults.innerHTML = '';
    if (!results.length) {
        if (messageSearchQuery) {
            var empty = document.createElement('div');
            empty.className = 'syllentras-msg-search-empty';
            empty.textContent = 'No matches in this conversation';
            msgSearchResults.appendChild(empty);
        }
        return;
    }

    results.forEach(function (result, index) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'syllentras-msg-search-result';
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', index === messageSearchActiveIndex ? 'true' : 'false');
        btn.dataset.resultIndex = String(index);
        if (index === messageSearchActiveIndex) {
            btn.classList.add('is-active');
        }

        var meta = document.createElement('span');
        meta.className = 'syllentras-msg-search-result-meta';
        meta.textContent = (result.role === 'assistant' ? 'Assistant' : 'You')
            + (result.matchCount > 1 ? ' · ' + result.matchCount + ' matches' : '');

        var preview = document.createElement('span');
        preview.className = 'syllentras-msg-search-result-preview';
        preview.innerHTML = result.previewHtml;

        btn.appendChild(meta);
        btn.appendChild(preview);
        btn.addEventListener('click', function () {
            messageSearchActiveIndex = index;
            renderMessageSearchResults(messageSearchResults);
            updateMessageSearchCount();
            openMessageSearchResult(result);
        });
        msgSearchResults.appendChild(btn);
    });

    var active = msgSearchResults.querySelector('.syllentras-msg-search-result.is-active');
    if (active && typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'nearest' });
    }
}

function runMessageSearch(rawQuery) {
    scheduleMessageSearch(rawQuery, function (results) {
        renderMessageSearchResults(results);
        updateMessageSearchCount();
    });
}

function openMessageSearchResult(result) {
    if (!result) return Promise.resolve(null);
    // Same jump path as sidebar search hits / keyboard Enter.
    return navigateToSearchMessage(result.id, messageSearchQuery);
}

function openActiveMessageSearchResult() {
    return openMessageSearchResult(getActiveMessageSearchResult());
}

function stepMessageSearch(delta) {
    var result = moveMessageSearchSelection(delta);
    renderMessageSearchResults(messageSearchResults);
    updateMessageSearchCount();
    if (result) {
        openMessageSearchResult(result);
    }
}

function onMessageSearchInput() {
    runMessageSearch(msgSearchInput.value);
}

function onMessageSearchKeydown(e) {
    if (!messageSearchOpen) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        closeMessageSearch();
        if (input) input.focus();
        return;
    }
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        stepMessageSearch(1);
        return;
    }
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        stepMessageSearch(-1);
        return;
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        openActiveMessageSearchResult();
    }
}

function bindMessageSearchUi() {
    if (!isMessageSearchUiReady()) return;

    if (msgSearchToggle) {
        msgSearchToggle.addEventListener('click', function () {
            toggleMessageSearch();
        });
    }
    if (msgSearchClose) {
        msgSearchClose.addEventListener('click', function () {
            closeMessageSearch();
            if (input) input.focus();
        });
    }
    if (msgSearchPrev) {
        msgSearchPrev.addEventListener('click', function () {
            stepMessageSearch(-1);
        });
    }
    if (msgSearchNext) {
        msgSearchNext.addEventListener('click', function () {
            stepMessageSearch(1);
        });
    }
    msgSearchInput.addEventListener('input', onMessageSearchInput);
    msgSearchInput.addEventListener('keydown', onMessageSearchKeydown);

    // Ctrl/Cmd+F while the chat panel is open jumps to find-in-conversation.
    document.addEventListener('keydown', function (e) {
        if (!panel || panel.hidden) return;
        var key = (e.key || '').toLowerCase();
        if (key === 'f' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            openMessageSearch();
        }
    });
}
