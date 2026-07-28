// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var openToolsMenu = null;
var selectedToolKey = null;
var selectedTopicId = null;
var toolsMenu = document.getElementById('syllentras-chat-tools-menu');
var toolsWrap = toolsBtn ? toolsBtn.closest('.syllentras-tools-wrap') : null;

var STUDY_TOOLS = [
    {
        key: 'study_guide',
        label: 'Study guide',
        description: 'Summarize course material into notes',
        promptPrefix: 'Create a study guide about '
    },
    {
        key: 'flashcards',
        label: 'Flashcards',
        description: 'Practice with flip cards',
        promptPrefix: 'Create flashcards about '
    },
    {
        key: 'practice_quiz',
        label: 'Practice quiz',
        description: 'Test yourself with quiz questions',
        promptPrefix: 'Create a practice quiz about '
    }
];

function closeToolsMenu() {
    if (toolsMenu) {
        toolsMenu.hidden = true;
        toolsMenu.innerHTML = '';
    }
    openToolsMenu = null;
    selectedToolKey = null;
    selectedTopicId = null;
    if (toolsBtn) {
        toolsBtn.classList.remove('open');
        toolsBtn.setAttribute('aria-expanded', 'false');
    }
}

function buildStructuralTopicSuggestions() {
    var suggestions = [];
    var sections = Array.isArray(courseSections) ? courseSections.slice() : [];
    sections = sections.filter(function (s) {
        return s && s.name && String(s.name).trim().toLowerCase() !== 'ai content';
    });
    sections.sort(function (a, b) {
        return (b.number || 0) - (a.number || 0);
    });

    function pushSuggestion(id, label, promptFragment) {
        if (!label || !promptFragment) return false;
        var key = String(promptFragment).toLowerCase();
        var labelKey = String(label).toLowerCase();
        if (suggestions.some(function (s) {
            return s.promptFragment.toLowerCase() === key || s.label.toLowerCase() === labelKey;
        })) {
            return false;
        }
        suggestions.push({
            id: id,
            label: label,
            promptFragment: promptFragment
        });
        return true;
    }

    pushSuggestion('whole-course', 'Whole course', 'the whole course');

    var titleLabel = '';
    if (activeConversation) {
        if (activeConversation.type === 'section') {
            titleLabel = (activeConversation.sectionName || activeConversation.title || '').trim();
        } else if (activeConversation.type === 'manual') {
            titleLabel = (activeConversation.title || '').trim();
        } else {
            // Main / general — title "Main" is not a useful topic.
            var genericTitle = !activeConversation.title
                || String(activeConversation.title).trim().toLowerCase() === 'main';
            if (!genericTitle) {
                titleLabel = String(activeConversation.title).trim();
            }
        }
    }

    if (titleLabel
        && titleLabel.toLowerCase() !== 'whole course'
        && titleLabel.toLowerCase() !== 'the whole course') {
        pushSuggestion('conversation-title', titleLabel, titleLabel);
    }

    if (suggestions.length < 2) {
        var numbered = sections.filter(function (s) {
            return s && s.name && (s.number || 0) > 0;
        });
        for (var i = 0; i < numbered.length && suggestions.length < 2; i++) {
            pushSuggestion('section-' + numbered[i].id, numbered[i].name, numbered[i].name);
        }
    }

    if (suggestions.length < 2) {
        var courseLabel = (typeof courseName === 'string' && courseName.trim())
            ? courseName.trim()
            : 'this course';
        pushSuggestion('course-fallback', courseLabel, courseLabel);
    }

    if (suggestions.length < 2) {
        pushSuggestion('key-topics', 'Key topics from this course', 'key topics from this course');
    }

    pushSuggestion('surprise-me', 'Surprise me', 'surprise me');

    // Pad to exactly 3 with remaining sections if Surprise me somehow collided.
    for (var j = 0; j < sections.length && suggestions.length < 3; j++) {
        if (!sections[j] || !sections[j].name) continue;
        pushSuggestion('section-pad-' + sections[j].id, sections[j].name, sections[j].name);
    }
    if (suggestions.length < 3) {
        pushSuggestion('key-topics', 'Key topics from this course', 'key topics from this course');
    }

    return suggestions.slice(0, 3);
}

function getTopicSuggestionsForUi() {
    var result = [];
    var seen = {};

    function addItem(item) {
        if (!item || !item.label || !item.promptFragment) return;
        var key = String(item.promptFragment).toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        result.push(item);
    }

    var cached = activeConversation && activeConversation.topicSuggestions;
    if (Array.isArray(cached)) {
        cached.slice(0, 3).forEach(function (topic, index) {
            if (typeof topic !== 'string' || !topic.trim()) return;
            addItem({
                id: 'llm-' + index,
                label: topic.trim(),
                promptFragment: topic.trim()
            });
        });
    }

    buildStructuralTopicSuggestions().forEach(addItem);
    return result.slice(0, 3);
}

function findStudyTool(key) {
    return STUDY_TOOLS.find(function (tool) { return tool.key === key; }) || null;
}

function hasOpenPendingAction() {
    return !!(msgs && msgs.querySelector('.syllentras-pending-action'));
}

function updateContinueState(panel) {
    if (!panel) return;
    var continueBtn = panel.querySelector('.syllentras-tools-continue');
    var customInput = panel.querySelector('.syllentras-tools-custom-input');
    if (!continueBtn) return;

    if (hasOpenPendingAction()) {
        continueBtn.disabled = true;
        continueBtn.title = 'Confirm or cancel the draft first';
        return;
    }

    continueBtn.title = '';
    if (!selectedToolKey) {
        continueBtn.disabled = true;
        return;
    }
    if (selectedTopicId === 'custom') {
        continueBtn.disabled = !(customInput && customInput.value.trim());
        return;
    }
    continueBtn.disabled = !selectedTopicId;
}

function clearTopicSelection(topicsCol) {
    Array.from(topicsCol.querySelectorAll('.syllentras-tools-topic-option')).forEach(function (el) {
        el.classList.remove('selected');
    });
    var customWrap = topicsCol.querySelector('.syllentras-tools-custom');
    if (customWrap) customWrap.classList.remove('selected');
}

function selectTopicSuggestion(topicsCol, button) {
    if (!button) return;
    selectedTopicId = button.dataset.topicId;
    clearTopicSelection(topicsCol);
    button.classList.add('selected');
    updateContinueState(topicsCol);
}

function selectCustomTopic(topicsCol, focusInput) {
    selectedTopicId = 'custom';
    clearTopicSelection(topicsCol);
    var customWrap = topicsCol.querySelector('.syllentras-tools-custom');
    if (customWrap) customWrap.classList.add('selected');
    var customInput = topicsCol.querySelector('.syllentras-tools-custom-input');
    if (focusInput && customInput) customInput.focus();
    updateContinueState(topicsCol);
}

function selectFirstTopicIfNeeded(topicsCol) {
    if (selectedTopicId) return;
    var first = topicsCol.querySelector('.syllentras-tools-topic-option[data-topic-id]');
    if (first) {
        selectTopicSuggestion(topicsCol, first);
    }
}

function submitToolsLaunch(panel) {
    var tool = findStudyTool(selectedToolKey);
    if (!tool || hasOpenPendingAction()) return;

    var fragment = '';
    if (selectedTopicId === 'custom') {
        var customInput = panel.querySelector('.syllentras-tools-custom-input');
        fragment = customInput ? customInput.value.trim() : '';
    } else {
        var selectedBtn = panel.querySelector('.syllentras-tools-topic-option.selected[data-topic-id]');
        fragment = selectedBtn ? (selectedBtn.dataset.promptFragment || selectedBtn.textContent || '') : '';
        fragment = String(fragment).trim();
    }

    if (!fragment) return;

    closeToolsMenu();
    input.value = tool.promptPrefix + fragment;
    sendMessage();
}

function renderTopicPanel(topicsCol) {
    topicsCol.innerHTML = '';
    topicsCol.hidden = false;
    selectedTopicId = null;

    var heading = document.createElement('div');
    heading.className = 'syllentras-tools-pane-heading';
    heading.textContent = 'What should this cover?';
    topicsCol.appendChild(heading);

    var suggestions = getTopicSuggestionsForUi();

    suggestions.forEach(function (suggestion) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'syllentras-tools-topic-option';
        button.dataset.topicId = suggestion.id;
        button.dataset.promptFragment = suggestion.promptFragment;
        button.textContent = suggestion.label;
        button.addEventListener('click', function (e) {
            e.stopPropagation();
            selectTopicSuggestion(topicsCol, button);
        });
        topicsCol.appendChild(button);
    });

    var customWrap = document.createElement('div');
    customWrap.className = 'syllentras-tools-custom';

    var customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'syllentras-tools-topic-option custom-label';
    customBtn.textContent = 'Custom topic';
    customBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        selectCustomTopic(topicsCol, true);
    });

    var customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.className = 'syllentras-tools-custom-input';
    customInput.placeholder = 'weeks 2–4, debugging, surprise me…';
    customInput.setAttribute('aria-label', 'Custom topic');
    customInput.addEventListener('click', function (e) {
        e.stopPropagation();
        selectCustomTopic(topicsCol, false);
    });
    customInput.addEventListener('input', function () {
        selectCustomTopic(topicsCol, false);
    });
    customInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            submitToolsLaunch(topicsCol);
        }
    });

    customWrap.appendChild(customBtn);
    customWrap.appendChild(customInput);
    topicsCol.appendChild(customWrap);

    var continueBtn = document.createElement('button');
    continueBtn.type = 'button';
    continueBtn.className = 'syllentras-tools-continue';
    continueBtn.textContent = 'Continue';
    continueBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        submitToolsLaunch(topicsCol);
    });
    topicsCol.appendChild(continueBtn);

    updateContinueState(topicsCol);
}

function showToolsMenu() {
    closeConversationMenu();
    closeToolsMenu();
    if (typeof closeModeMenu === 'function') closeModeMenu();
    if (typeof closeProviderMenu === 'function') closeProviderMenu();
    if (typeof closeDisplayMenu === 'function') closeDisplayMenu();
    if (!toolsBtn || toolsBtn.disabled || !toolsMenu) return;

    toolsBtn.classList.add('open');
    toolsBtn.setAttribute('aria-expanded', 'true');
    selectedToolKey = null;
    selectedTopicId = null;

    toolsMenu.innerHTML = '';
    toolsMenu.hidden = false;
    openToolsMenu = toolsMenu;

    var toolsCol = document.createElement('div');
    toolsCol.className = 'syllentras-tools-menu-tools';

    var toolsHeading = document.createElement('div');
    toolsHeading.className = 'syllentras-tools-pane-heading';
    toolsHeading.textContent = 'Tools';
    toolsCol.appendChild(toolsHeading);

    var topicsCol = document.createElement('div');
    topicsCol.className = 'syllentras-tools-menu-topics';

    STUDY_TOOLS.forEach(function (tool) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'syllentras-tools-menu-item';
        button.setAttribute('role', 'menuitem');
        button.dataset.toolKey = tool.key;

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
            selectedToolKey = tool.key;
            Array.from(toolsCol.querySelectorAll('.syllentras-tools-menu-item')).forEach(function (el) {
                el.classList.toggle('selected', el === button);
            });
            selectFirstTopicIfNeeded(topicsCol);
            updateContinueState(topicsCol);
        });
        toolsCol.appendChild(button);
    });

    toolsMenu.appendChild(toolsCol);
    toolsMenu.appendChild(topicsCol);
    renderTopicPanel(topicsCol);
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
