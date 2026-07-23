// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var OPEN_CONTENT_LINK_RE = /^Open (practice quiz|study guide|flashcards)$/i;

function renderAssistantContent(el, text) {
    el.classList.add('syllentras-markdown');
    var raw = marked.parse(text, { breaks: true });
    el.innerHTML = DOMPurify.sanitize(raw);
    Array.from(el.querySelectorAll('a[href]')).forEach(function (anchor) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
        var label = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
        if (OPEN_CONTENT_LINK_RE.test(label)) {
            anchor.classList.add('syllentras-content-open-btn');
        }
    });
}

