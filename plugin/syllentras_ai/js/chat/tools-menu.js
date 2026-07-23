// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var openToolsMenu = null;

var STUDY_TOOLS = [
    {
        label: 'Study guide',
        description: 'Summarize course material into notes',
        prompt: 'Create a study guide about '
    },
    {
        label: 'Flashcards',
        description: 'Practice with flip cards',
        prompt: 'Create flashcards about '
    },
    {
        label: 'Practice quiz',
        description: 'Test yourself with quiz questions',
        prompt: 'Create a practice quiz about '
    }
];

function closeToolsMenu() {
    if (openToolsMenu) {
        openToolsMenu.remove();
        openToolsMenu = null;
    }
    if (toolsBtn) {
        toolsBtn.classList.remove('open');
        toolsBtn.setAttribute('aria-expanded', 'false');
    }
}

function prefillToolPrompt(prompt) {
    input.value = prompt;
    input.focus();
    var len = input.value.length;
    if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(len, len);
    }
}

function showToolsMenu() {
    closeConversationMenu();
    closeToolsMenu();
    if (!toolsBtn || toolsBtn.disabled) return;

    toolsBtn.classList.add('open');
    toolsBtn.setAttribute('aria-expanded', 'true');

    var menu = document.createElement('div');
    menu.className = 'syllentras-tools-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Study tools');

    STUDY_TOOLS.forEach(function (tool) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'syllentras-tools-menu-item';
        button.setAttribute('role', 'menuitem');

        var label = document.createElement('span');
        label.className = 'syllentras-tools-menu-item-label';
        label.textContent = tool.label;

        var desc = document.createElement('span');
        desc.className = 'syllentras-tools-menu-item-desc';
        desc.textContent = tool.description;

        button.appendChild(label);
        button.appendChild(desc);
        button.addEventListener('click', function (e) {
            e.stopPropagation();
            closeToolsMenu();
            prefillToolPrompt(tool.prompt);
        });
        menu.appendChild(button);
    });

    document.body.appendChild(menu);

    var rect = toolsBtn.getBoundingClientRect();
    var menuHeight = menu.offsetHeight;
    var menuWidth = menu.offsetWidth;
    var left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
    var top = rect.top - menuHeight - 6;
    if (top < 8) {
        top = Math.min(window.innerHeight - menuHeight - 8, rect.bottom + 6);
    }
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    openToolsMenu = menu;
}

function toggleToolsMenu(e) {
    if (e) e.stopPropagation();
    if (!toolsBtn || toolsBtn.disabled) return;
    if (openToolsMenu) {
        closeToolsMenu();
        return;
    }
    showToolsMenu();
}

function initToolsMenu() {
    if (!toolsBtn) return;
    if (courseId <= 1) {
        toolsBtn.disabled = true;
        toolsBtn.title = 'Open a course to use study tools';
        toolsBtn.setAttribute('aria-label', 'Study tools unavailable on dashboard');
        return;
    }
    toolsBtn.addEventListener('click', toggleToolsMenu);
}
