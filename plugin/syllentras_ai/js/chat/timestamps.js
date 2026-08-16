// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.
//
// Chat timeline helpers: date/time separators, message grouping, and relative
// times for the conversation ⋮ menu. Kept in one place so messages.js /
// conversations.js don't each reinvent date math.

// Same sender + closer than this = one visual cluster (no time chip between).
var MSG_GROUP_GAP_MS = 10 * 60 * 1000;

function parseMessageDate(value) {
    if (!value) return null;
    var d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d;
}

function isSameLocalDay(a, b) {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

function startOfLocalDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// "3:45 PM" — short clock for bubbles and in-chat time gaps.
function formatChatClock(d) {
    return d.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit'
    });
}

// Labels for the --- Today --- style day markers.
function formatChatDateLabel(d) {
    var now = new Date();
    var today = startOfLocalDay(now);
    var day = startOfLocalDay(d);
    var diffDays = Math.round((today - day) / 86400000);

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays > 1 && diffDays < 7) {
        return d.toLocaleDateString(undefined, { weekday: 'long' });
    }
    return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
}

// Short relative stamp for the conversation ⋮ menu (and search meta).
function formatRelativeConversationTime(value) {
    var d = parseMessageDate(value);
    if (!d) return '';

    var now = new Date();
    var sec = Math.max(0, Math.floor((now - d) / 1000));

    if (sec < 60) return 'Just now';

    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm';

    var hours = Math.floor(min / 60);
    if (hours < 24) return hours + 'h';

    if (isSameLocalDay(d, now)) {
        return formatChatClock(d);
    }

    var diffDays = Math.round(
        (startOfLocalDay(now) - startOfLocalDay(d)) / 86400000
    );
    if (diffDays >= 1 && diffDays < 7) {
        return d.toLocaleDateString(undefined, { weekday: 'short' });
    }

    return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
}

function createChatSeparator(kind, label) {
    var el = document.createElement('div');
    el.className = 'syllentras-chat-sep syllentras-chat-sep-' + kind;
    el.setAttribute('role', 'separator');
    el.dataset.sepKind = kind;

    // --- Today ---  (hairlines on both sides; time gaps skip the lines)
    if (kind === 'date') {
        var left = document.createElement('span');
        left.className = 'syllentras-chat-sep-line';
        left.setAttribute('aria-hidden', 'true');
        var text = document.createElement('span');
        text.className = 'syllentras-chat-sep-label';
        text.textContent = label;
        var right = document.createElement('span');
        right.className = 'syllentras-chat-sep-line';
        right.setAttribute('aria-hidden', 'true');
        el.appendChild(left);
        el.appendChild(text);
        el.appendChild(right);
    } else {
        var span = document.createElement('span');
        span.className = 'syllentras-chat-sep-label';
        span.textContent = label;
        el.appendChild(span);
    }
    return el;
}

function isChatBubble(el) {
    return !!(
        el &&
        el.classList &&
        el.classList.contains('syllentras-msg') &&
        (el.classList.contains('user') || el.classList.contains('assistant'))
    );
}

// Seeded Main/Home intro — not a real turn, so no hover clock / no day chip for it alone.
function isSeededWelcomeBubble(el) {
    if (!isChatBubble(el) || !el.classList.contains('assistant')) return false;
    var text = String(el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
    return (
        /I'm Syllentras AI/i.test(text) && /chat in any language/i.test(text)
    );
}

function countsForTimeline(el) {
    return isChatBubble(el) && !isSeededWelcomeBubble(el);
}

function getTimelineMessages() {
    if (!msgs) return [];
    return Array.from(msgs.children).filter(isChatBubble);
}

function messageRoleKey(el) {
    return el.classList.contains('user') ? 'user' : 'assistant';
}

// True when two bubbles should sit in the same stack (tight spacing, shared look).
function canGroupMessages(a, b) {
    if (!isChatBubble(a) || !isChatBubble(b)) return false;
    if (isSeededWelcomeBubble(a) || isSeededWelcomeBubble(b)) return false;
    if (messageRoleKey(a) !== messageRoleKey(b)) return false;

    var da = parseMessageDate(a.dataset.createdAt);
    var db = parseMessageDate(b.dataset.createdAt);
    if (!da || !db) return false;
    if (!isSameLocalDay(da, db)) return false;
    if (Math.abs(db - da) >= MSG_GROUP_GAP_MS) return false;

    // Anything sitting between them in the pane (system note, error, etc.)
    // breaks the cluster — we only group neighbors that feel consecutive.
    var n = a.nextElementSibling;
    while (n && n !== b) {
        if (isChatBubble(n)) return false;
        if (n.classList.contains('syllentras-msg')) return false;
        n = n.nextElementSibling;
    }
    return n === b;
}

function ensureMessageTimeEl(el) {
    if (!isChatBubble(el)) return null;
    var existing = el.querySelector('.syllentras-msg-time');

    // Intro bubble + typing placeholder — no stamp.
    if (isSeededWelcomeBubble(el) || el.textContent === '...') {
        if (existing) existing.remove();
        return null;
    }

    var when = parseMessageDate(el.dataset.createdAt);
    if (!when) {
        if (existing) existing.remove();
        return null;
    }

    var label = formatChatClock(when);
    if (!existing) {
        existing = document.createElement('time');
        existing.className = 'syllentras-msg-time';
        el.appendChild(existing);
    }
    existing.dateTime = when.toISOString();
    existing.textContent = label;
    existing.setAttribute('aria-hidden', 'true');
    return existing;
}

function bindMessageTimeReveal(el) {
    if (!el || el.dataset.timeBound === '1') return;
    el.dataset.timeBound = '1';

    // Phones don't hover — tap the bubble to peek the time; tap again / elsewhere to hide.
    el.addEventListener('click', function (e) {
        if (e.target.closest('button, a, summary, input, textarea, .syllentras-pending-actions')) {
            return;
        }
        if (isSeededWelcomeBubble(el) || !el.querySelector('.syllentras-msg-time')) {
            return;
        }
        var canHover =
            window.matchMedia &&
            window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        if (canHover) return;

        var open = el.classList.toggle('is-time-visible');
        if (open && msgs) {
            Array.from(msgs.querySelectorAll('.syllentras-msg.is-time-visible')).forEach(
                function (other) {
                    if (other !== el) other.classList.remove('is-time-visible');
                }
            );
        }
    });

    // Long-press also works if a quick tap got eaten by selection / scroll.
    var pressTimer = null;
    el.addEventListener(
        'touchstart',
        function () {
            if (isSeededWelcomeBubble(el) || !el.querySelector('.syllentras-msg-time')) {
                return;
            }
            pressTimer = setTimeout(function () {
                el.classList.add('is-time-visible');
                if (msgs) {
                    Array.from(
                        msgs.querySelectorAll('.syllentras-msg.is-time-visible')
                    ).forEach(function (other) {
                        if (other !== el) other.classList.remove('is-time-visible');
                    });
                }
            }, 420);
        },
        { passive: true }
    );
    function clearPress() {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    }
    el.addEventListener('touchend', clearPress);
    el.addEventListener('touchcancel', clearPress);
    el.addEventListener('touchmove', clearPress);
}

function applyMessageGrouping(nodes) {
    for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        el.classList.remove('is-group-start', 'is-group-end', 'is-group-continued');

        var prev = nodes[i - 1];
        var next = nodes[i + 1];
        var withPrev = !!(prev && canGroupMessages(prev, el));
        var withNext = !!(next && canGroupMessages(el, next));

        if (!withPrev) el.classList.add('is-group-start');
        if (!withNext) el.classList.add('is-group-end');
        if (withPrev) el.classList.add('is-group-continued');

        // Overlay clock on hover/tap — middle bubbles of a stack stay quiet
        // unless you hover that specific one.
        ensureMessageTimeEl(el);
        bindMessageTimeReveal(el);
    }
}

// Walk the transcript, drop old separators, and put fresh date/time markers
// back in. Cheap enough to run after history loads and after each send.
function rebuildChatTimeline() {
    if (!msgs) return;

    Array.from(msgs.querySelectorAll('.syllentras-chat-sep')).forEach(function (node) {
        node.remove();
    });

    var nodes = getTimelineMessages();
    // Timeline "starts" when someone actually chats — ignore the seeded intro.
    var prev = null;

    for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (!countsForTimeline(el)) {
            continue;
        }

        var curDate = parseMessageDate(el.dataset.createdAt);
        if (curDate) {
            if (!prev) {
                msgs.insertBefore(
                    createChatSeparator('date', formatChatDateLabel(curDate)),
                    el
                );
            } else {
                var prevDate = parseMessageDate(prev.dataset.createdAt);
                if (prevDate) {
                    if (!isSameLocalDay(prevDate, curDate)) {
                        msgs.insertBefore(
                            createChatSeparator('date', formatChatDateLabel(curDate)),
                            el
                        );
                    } else if (curDate - prevDate >= MSG_GROUP_GAP_MS) {
                        msgs.insertBefore(
                            createChatSeparator('time', formatChatClock(curDate)),
                            el
                        );
                    }
                }
            }
            prev = el;
        }
    }

    applyMessageGrouping(nodes);
}
