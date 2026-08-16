// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var SUGGESTED_LINK_OPEN_PREFIX =
    'Please read this page and explain how it relates to my course: ';

/**
 * Attach a horizontal row of Read-link buttons under an assistant message.
 * Click fills the composer with a short prompt + URL and sends via sendMessage().
 */
function attachSuggestedLinks(messageEl, links) {
    if (!messageEl || !Array.isArray(links) || !links.length) return;

    var existing = messageEl.querySelector('.syllentras-suggested-links');
    if (existing) existing.remove();

    var row = document.createElement('div');
    row.className = 'syllentras-suggested-links';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Read recommended pages');

    links.slice(0, 3).forEach(function (link, index) {
        if (!link || !link.url) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'syllentras-suggested-link-btn';
        btn.textContent = 'Read link ' + (index + 1);
        btn.title = link.title
            ? String(link.title).replace(/\s+/g, ' ').trim() + '\n' + link.url
            : link.url;
        btn.addEventListener('click', function () {
            if (typeof isActiveChatBusy === 'function' && isActiveChatBusy()) return;
            if (!input || input.disabled || (send && send.disabled)) return;
            input.value = SUGGESTED_LINK_OPEN_PREFIX + link.url;
            if (typeof sendMessage === 'function') {
                sendMessage();
            }
        });
        row.appendChild(btn);
    });

    if (!row.childNodes.length) return;
    messageEl.appendChild(row);
}
