// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var MODE_STORAGE_KEY_LEGACY = 'syllentras_ai_mode';
var GUIDANCE_STORAGE_KEY_LEGACY = 'syllentras_ai_guidance';

var CHAT_MODES = [
    {
        id: 'direct',
        label: 'Direct',
        description: 'Clear answers from your course materials'
    },
    {
        id: 'coach',
        label: 'Coach',
        description: 'Questions and hints so you figure it out'
    }
];

var GUIDANCE_LEVEL_LABELS = {
    1: 'Minimal',
    2: 'Light',
    3: 'Balanced',
    4: 'Strong',
    5: 'Maximum'
};

var modeBtn = document.getElementById('syllentras-mode-btn');
var modeMenu = document.getElementById('syllentras-mode-menu');
var modeWrap = modeBtn ? modeBtn.closest('.syllentras-mode-wrap') : null;
var modeLabelEl = document.getElementById('syllentras-mode-btn-label');
var activeModeEl = document.getElementById('syllentras-chat-active-mode');
var openModeMenu = null;

var selectedModeId = 'direct';
var selectedGuidance = 3;

function modeStorageKey() {
    return 'syllentras_ai_mode_' + courseId;
}

function guidanceStorageKey() {
    return 'syllentras_ai_guidance_' + courseId;
}

function coachTipSeenKey() {
    return 'syllentras_ai_coach_tip_seen_' + moodleUserId;
}

function normalizeModeId(value) {
    return value === 'coach' ? 'coach' : 'direct';
}

function normalizeGuidance(value) {
    var n = parseInt(value, 10);
    if (!Number.isFinite(n)) return 3;
    return Math.min(5, Math.max(1, n));
}

function guidanceLevelLabel(level) {
    return GUIDANCE_LEVEL_LABELS[normalizeGuidance(level)] || 'Balanced';
}

function getSelectedModeId() {
    return selectedModeId;
}

function getSelectedGuidance() {
    return selectedModeId === 'coach' ? selectedGuidance : null;
}

function modeDisplayLabel(modeId) {
    return modeId === 'coach' ? 'Coach' : 'Direct';
}

function hasSeenCoachTip() {
    try {
        return localStorage.getItem(coachTipSeenKey()) === '1';
    } catch (err) {
        return true;
    }
}

function markCoachTipSeen() {
    try {
        localStorage.setItem(coachTipSeenKey(), '1');
    } catch (err) {
        // Ignore storage failures.
    }
}

function persistModePrefs() {
    try {
        localStorage.setItem(modeStorageKey(), selectedModeId);
        localStorage.setItem(guidanceStorageKey(), String(selectedGuidance));
    } catch (err) {
        // Ignore storage failures (private mode, quota, etc.).
    }
}

function loadModePrefs() {
    var modeRaw = null;
    var guidanceRaw = null;
    var migrated = false;
    try {
        modeRaw = localStorage.getItem(modeStorageKey());
        guidanceRaw = localStorage.getItem(guidanceStorageKey());
        if (modeRaw === null) {
            modeRaw = localStorage.getItem(MODE_STORAGE_KEY_LEGACY);
            migrated = modeRaw !== null;
        }
        if (guidanceRaw === null) {
            guidanceRaw = localStorage.getItem(GUIDANCE_STORAGE_KEY_LEGACY);
            if (guidanceRaw !== null) migrated = true;
        }
    } catch (err) {
        modeRaw = null;
        guidanceRaw = null;
    }
    selectedModeId = normalizeModeId(modeRaw);
    selectedGuidance = normalizeGuidance(guidanceRaw);
    if (migrated) {
        persistModePrefs();
    }
}

function updateModeUi() {
    if (modeLabelEl) {
        modeLabelEl.textContent = modeDisplayLabel(selectedModeId);
    }
    if (modeBtn) {
        modeBtn.setAttribute(
            'aria-label',
            'Chat mode: ' + modeDisplayLabel(selectedModeId) + '. Click to change.'
        );
        modeBtn.title = 'Chat mode: ' + modeDisplayLabel(selectedModeId);
    }
    if (activeModeEl) {
        activeModeEl.textContent = modeDisplayLabel(selectedModeId);
        activeModeEl.dataset.mode = selectedModeId;
    }
}

function setSelectedMode(modeId, options) {
    options = options || {};
    var previous = selectedModeId;
    var next = normalizeModeId(modeId);
    selectedModeId = next;
    if (options.guidance !== undefined) {
        selectedGuidance = normalizeGuidance(options.guidance);
    }
    if (options.persist !== false) {
        persistModePrefs();
    }
    updateModeUi();
    if (options.notify !== false) {
        announceModeChange(previous, next);
    }
    if (openModeMenu || (modeMenu && !modeMenu.hidden)) {
        renderModeMenu();
    }
}

function setSelectedGuidance(level, options) {
    options = options || {};
    selectedGuidance = normalizeGuidance(level);
    if (options.persist !== false) {
        persistModePrefs();
    }
    // Do not rebuild the menu here — recreating the slider mid-drag cancels the drag.
}

function announceModeChange(previous, next) {
    if (previous === next) return;
    if (typeof appendSystemNotice !== 'function') return;
    appendSystemNotice('Switched to ' + modeDisplayLabel(next));
    if (next === 'coach' && !hasSeenCoachTip()) {
        appendSystemNotice(
            'I\u2019ll answer deadlines and \u201cwhere is X?\u201d directly; I\u2019ll coach concepts and problems.'
        );
        markCoachTipSeen();
    }
}

function closeModeMenu() {
    if (modeMenu) {
        modeMenu.hidden = true;
        modeMenu.innerHTML = '';
    }
    openModeMenu = null;
    if (modeBtn) {
        modeBtn.classList.remove('open');
        modeBtn.setAttribute('aria-expanded', 'false');
    }
}

function renderModeSettings(settingsCol, modeId) {
    settingsCol.innerHTML = '';

    var heading = document.createElement('div');
    heading.className = 'syllentras-mode-pane-heading';
    heading.textContent = 'Settings';
    settingsCol.appendChild(heading);

    if (modeId === 'coach') {
        var guidanceLabel = document.createElement('div');
        guidanceLabel.className = 'syllentras-mode-guidance-label';
        guidanceLabel.textContent = 'Guidance';
        settingsCol.appendChild(guidanceLabel);

        var valueEl = document.createElement('div');
        valueEl.className = 'syllentras-mode-guidance-value';
        valueEl.textContent = guidanceLevelLabel(selectedGuidance);
        settingsCol.appendChild(valueEl);

        var slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'syllentras-mode-guidance-slider';
        slider.min = '1';
        slider.max = '5';
        slider.step = '1';
        slider.value = String(selectedGuidance);
        slider.setAttribute('aria-label', 'Coach guidance level');
        slider.addEventListener('input', function (e) {
            e.stopPropagation();
            setSelectedGuidance(slider.value);
            valueEl.textContent = guidanceLevelLabel(selectedGuidance);
        });
        slider.addEventListener('click', function (e) {
            e.stopPropagation();
        });
        settingsCol.appendChild(slider);

        var ends = document.createElement('div');
        ends.className = 'syllentras-mode-guidance-ends';
        var low = document.createElement('span');
        low.textContent = 'Low';
        var high = document.createElement('span');
        high.textContent = 'High';
        ends.appendChild(low);
        ends.appendChild(high);
        settingsCol.appendChild(ends);

        var hint = document.createElement('p');
        hint.className = 'syllentras-mode-settings-note';
        hint.textContent = 'Low asks more questions; high gives stronger hints.';
        settingsCol.appendChild(hint);
        return;
    }

    var note = document.createElement('p');
    note.className = 'syllentras-mode-settings-note';
    note.textContent = 'No extra settings — answers directly from your course.';
    settingsCol.appendChild(note);
}

function renderModeMenu() {
    if (!modeMenu) return;
    modeMenu.innerHTML = '';

    var modesCol = document.createElement('div');
    modesCol.className = 'syllentras-mode-menu-modes';

    var modesHeading = document.createElement('div');
    modesHeading.className = 'syllentras-mode-pane-heading';
    modesHeading.textContent = 'Mode';
    modesCol.appendChild(modesHeading);

    var settingsCol = document.createElement('div');
    settingsCol.className = 'syllentras-mode-menu-settings';

    CHAT_MODES.forEach(function (mode) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'syllentras-mode-menu-item';
        if (mode.id === selectedModeId) {
            button.classList.add('selected');
        }
        button.setAttribute('role', 'menuitemradio');
        button.setAttribute('aria-checked', mode.id === selectedModeId ? 'true' : 'false');
        button.dataset.modeId = mode.id;

        var label = document.createElement('span');
        label.className = 'syllentras-mode-menu-item-label';
        label.textContent = mode.label;

        var desc = document.createElement('span');
        desc.className = 'syllentras-mode-menu-item-desc';
        desc.textContent = mode.description;

        button.appendChild(label);
        button.appendChild(desc);
        button.addEventListener('click', function (e) {
            e.stopPropagation();
            // Avoid double-render: setSelectedMode would rebuild the whole menu.
            var previous = selectedModeId;
            selectedModeId = normalizeModeId(mode.id);
            persistModePrefs();
            updateModeUi();
            announceModeChange(previous, selectedModeId);
            Array.from(modesCol.querySelectorAll('.syllentras-mode-menu-item')).forEach(function (el) {
                var active = el.dataset.modeId === mode.id;
                el.classList.toggle('selected', active);
                el.setAttribute('aria-checked', active ? 'true' : 'false');
            });
            renderModeSettings(settingsCol, mode.id);
        });
        modesCol.appendChild(button);
    });

    renderModeSettings(settingsCol, selectedModeId);
    modeMenu.appendChild(modesCol);
    modeMenu.appendChild(settingsCol);
}

function showModeMenu() {
    if (!modeBtn || modeBtn.disabled || !modeMenu) return;
    if (typeof closeToolsMenu === 'function') closeToolsMenu();
    if (typeof closeProviderMenu === 'function') closeProviderMenu();

    modeBtn.classList.add('open');
    modeBtn.setAttribute('aria-expanded', 'true');
    modeMenu.hidden = false;
    openModeMenu = modeMenu;
    renderModeMenu();
}

function toggleModeMenu(e) {
    if (e) e.stopPropagation();
    if (!modeBtn || modeBtn.disabled) return;
    if (openModeMenu && modeMenu && !modeMenu.hidden) {
        closeModeMenu();
        return;
    }
    showModeMenu();
}

function initModeSelector() {
    loadModePrefs();
    updateModeUi();

    if (!modeBtn) return;
    modeBtn.addEventListener('click', toggleModeMenu);
}

document.addEventListener('click', function (e) {
    if (!openModeMenu) return;
    if (openModeMenu.contains(e.target)) return;
    if (modeWrap && modeWrap.contains(e.target)) return;
    closeModeMenu();
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        closeModeMenu();
    }
});

window.addEventListener('resize', function () {
    closeModeMenu();
});
