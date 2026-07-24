// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var OPEN_CONTENT_LINK_RE = /^Open (practice quiz|study guide|flashcards)$/i;

function allReviewItemsOpen(items) {
    return items.every(function (item) { return item.open; });
}

function syncReviewToggleLabel(btn, items) {
    btn.textContent = allReviewItemsOpen(items) ? 'Collapse all' : 'Expand all';
}

function attachReviewCollapseControls(el) {
    var items = Array.from(el.querySelectorAll('details.syllentras-review-item'));
    if (items.length < 2) return;

    var toolbar = document.createElement('div');
    toolbar.className = 'syllentras-review-toolbar';

    var toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'syllentras-review-toggle-all';
    syncReviewToggleLabel(toggleBtn, items);

    toggleBtn.addEventListener('click', function () {
        var expand = !allReviewItemsOpen(items);
        items.forEach(function (item) { item.open = expand; });
        syncReviewToggleLabel(toggleBtn, items);
    });

    items.forEach(function (item) {
        item.addEventListener('toggle', function () {
            syncReviewToggleLabel(toggleBtn, items);
        });
    });

    toolbar.appendChild(toggleBtn);
    items[0].parentNode.insertBefore(toolbar, items[0]);
}

function renderAssistantContent(el, text) {
    var modeChip = el.querySelector('.syllentras-msg-mode');
    el.classList.add('syllentras-markdown');
    var raw = marked.parse(text, { breaks: true });
    el.innerHTML = DOMPurify.sanitize(raw);
    if (modeChip) {
        el.insertBefore(modeChip, el.firstChild);
    }
    Array.from(el.querySelectorAll('a[href]')).forEach(function (anchor) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
        var label = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
        if (OPEN_CONTENT_LINK_RE.test(label)) {
            anchor.classList.add('syllentras-content-open-btn');
        }
    });
    attachReviewCollapseControls(el);
}
