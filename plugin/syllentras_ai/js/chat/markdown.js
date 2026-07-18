// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function renderAssistantContent(el, text) {
    el.classList.add('syllentras-markdown');
    var raw = marked.parse(text, { breaks: true });
    el.innerHTML = DOMPurify.sanitize(raw);
    Array.from(el.querySelectorAll('a[href]')).forEach(function (anchor) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
    });
}

