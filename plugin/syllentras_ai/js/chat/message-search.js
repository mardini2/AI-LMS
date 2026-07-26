// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.
//
// Find-in-chat guts. Keeps a tiny searchable list of the messages we already
// loaded so typing in the find box doesn't walk the whole message DOM.
// Rendering / scrolling lives in messages.js; this file just indexes + queries.

var MESSAGE_SEARCH_DEBOUNCE_MS = 160;
var MESSAGE_SEARCH_PREVIEW_RADIUS = 42;

var messageSearchIndex = [];
var messageSearchLocalSeq = 0;
var messageSearchQuery = '';
var messageSearchResults = [];
var messageSearchActiveIndex = -1;
var messageSearchDebounceTimer = null;
var messageSearchOpen = false;

function nextLocalMessageId() {
    messageSearchLocalSeq += 1;
    return 'local-' + Date.now() + '-' + messageSearchLocalSeq;
}

function resetMessageSearchIndex() {
    messageSearchIndex = [];
}

function upsertMessageSearchEntry(entry) {
    if (!entry || !entry.id || entry.role === 'error' || entry.role === 'system') {
        return;
    }
    var content = entry.content == null ? '' : String(entry.content);
    if (content === '...') {
        return;
    }
    var row = {
        id: String(entry.id),
        role: entry.role === 'assistant' ? 'assistant' : 'user',
        content: content,
        createdAt: entry.createdAt || null
    };
    for (var i = 0; i < messageSearchIndex.length; i++) {
        if (messageSearchIndex[i].id === row.id) {
            messageSearchIndex[i] = row;
            return;
        }
    }
    messageSearchIndex.push(row);
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function findMatchRanges(content, query) {
    var ranges = [];
    if (!content || !query) return ranges;
    var hay = content.toLowerCase();
    var needle = query.toLowerCase();
    var from = 0;
    while (from <= hay.length) {
        var hit = hay.indexOf(needle, from);
        if (hit === -1) break;
        ranges.push({ start: hit, end: hit + needle.length });
        from = hit + Math.max(needle.length, 1);
    }
    return ranges;
}

function buildMatchPreview(content, query) {
    var ranges = findMatchRanges(content, query);
    if (!ranges.length) {
        return escapeHtml(content).slice(0, MESSAGE_SEARCH_PREVIEW_RADIUS * 2);
    }
    var first = ranges[0];
    var start = Math.max(0, first.start - MESSAGE_SEARCH_PREVIEW_RADIUS);
    var end = Math.min(content.length, first.end + MESSAGE_SEARCH_PREVIEW_RADIUS);
    var slice = content.slice(start, end);
    var localQuery = query;
    var re = new RegExp(escapeRegExp(localQuery), 'ig');
    var highlighted = escapeHtml(slice).replace(re, function (match) {
        return '<mark class="syllentras-search-mark">' + match + '</mark>';
    });
    return (start > 0 ? '…' : '') + highlighted + (end < content.length ? '…' : '');
}

// Pure query over the index. Cheap enough for big chats because we never touch the DOM here.
function queryMessageSearchIndex(rawQuery) {
    var query = (rawQuery || '').trim();
    if (!query) return [];

    var out = [];
    for (var i = 0; i < messageSearchIndex.length; i++) {
        var entry = messageSearchIndex[i];
        var ranges = findMatchRanges(entry.content, query);
        if (!ranges.length) continue;
        out.push({
            id: entry.id,
            role: entry.role,
            content: entry.content,
            matchCount: ranges.length,
            previewHtml: buildMatchPreview(entry.content, query)
        });
    }
    return out;
}

function setMessageSearchResults(results, query) {
    messageSearchResults = results || [];
    messageSearchQuery = query || '';
    messageSearchActiveIndex = messageSearchResults.length ? 0 : -1;
}

function getActiveMessageSearchResult() {
    if (messageSearchActiveIndex < 0 || messageSearchActiveIndex >= messageSearchResults.length) {
        return null;
    }
    return messageSearchResults[messageSearchActiveIndex];
}

function moveMessageSearchSelection(delta) {
    if (!messageSearchResults.length) {
        messageSearchActiveIndex = -1;
        return null;
    }
    var next = messageSearchActiveIndex + delta;
    if (next < 0) next = messageSearchResults.length - 1;
    if (next >= messageSearchResults.length) next = 0;
    messageSearchActiveIndex = next;
    return getActiveMessageSearchResult();
}

function scheduleMessageSearch(rawQuery, onDone) {
    if (messageSearchDebounceTimer) {
        clearTimeout(messageSearchDebounceTimer);
    }
    messageSearchDebounceTimer = setTimeout(function () {
        messageSearchDebounceTimer = null;
        var query = (rawQuery || '').trim();
        var results = query ? queryMessageSearchIndex(query) : [];
        setMessageSearchResults(results, query);
        if (typeof onDone === 'function') onDone(results, query);
    }, MESSAGE_SEARCH_DEBOUNCE_MS);
}

function clearMessageSearchSchedule() {
    if (messageSearchDebounceTimer) {
        clearTimeout(messageSearchDebounceTimer);
        messageSearchDebounceTimer = null;
    }
}
