// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function installSectionButtons() {
    if (!courseSections.length) return;
    courseSections.forEach(function (section) {
        var target = findSectionElement(section);
        if (!target || target.querySelector('.syllentras-section-chat-btn[data-section-id="' + section.id + '"]')) return;

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'syllentras-section-chat-btn';
        button.dataset.sectionId = String(section.id);
        button.textContent = 'AI chat';
        button.setAttribute('aria-label', 'Open AI chat for ' + section.name);
        button.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openConversation({
                type: 'section',
                title: section.name,
                sectionId: section.id || undefined,
                sectionNumber: section.number,
                sectionName: section.name
            });
        });

        var headerTarget = target.querySelector('.course-section-header, .sectionname, h3, h4') || target;
        headerTarget.appendChild(button);
    });
}

function findSectionElement(section) {
    var root = document.querySelector('#region-main .course-content')
        || document.querySelector('.course-content')
        || document.querySelector('#region-main')
        || document;
    var selectors = [
        '[data-for="section"][data-id="' + section.id + '"]',
        '.course-section[data-id="' + section.id + '"]',
        'li.section[data-id="' + section.id + '"]',
        '#section-' + section.number,
        '.course-section[data-section="' + section.number + '"]',
        'li.section[data-section="' + section.number + '"]',
        '[data-for="section"][data-number="' + section.number + '"]',
        '.course-section[data-number="' + section.number + '"]',
        'li.section[data-number="' + section.number + '"]'
    ];

    for (var i = 0; i < selectors.length; i++) {
        var found = root.querySelector(selectors[i]);
        if (found) return found;
    }

    var candidates = Array.from(root.querySelectorAll('.course-section, li.section, [data-for="section"], [id^="section-"]'));
    return candidates.find(function (candidate) {
        var heading = candidate.querySelector('.sectionname, .course-section-header h3, .course-section-header h4, h3, h4');
        return heading && heading.textContent && heading.textContent.trim() === section.name;
    }) || null;
}

