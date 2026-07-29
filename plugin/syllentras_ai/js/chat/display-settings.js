// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var DISPLAY_THEME_KEY = 'syllentras_display_theme';
var DISPLAY_FONT_SCALE_KEY = 'syllentras_display_font_scale';

var DISPLAY_THEMES = [
    { id: 'default', label: 'Default' },
    { id: 'high-contrast', label: 'High contrast' },
    { id: 'dark', label: 'Dark' },
    { id: 'soft', label: 'Soft' }
];

var DISPLAY_FONT_STEPS = [
    { step: 1, scale: 1, label: 'Default' },
    { step: 2, scale: 1.125, label: 'Large' },
    { step: 3, scale: 1.25, label: 'Extra large' },
    { step: 4, scale: 1.4, label: 'Largest' }
];

var displayBtn = document.getElementById('syllentras-display-btn');
var displayMenu = document.getElementById('syllentras-display-menu');
var displayWrap = displayBtn ? displayBtn.closest('.syllentras-display-wrap') : null;

var selectedDisplayTheme = 'default';
var selectedFontStep = 1;
var displayMenuBuilt = false;
var displayFontValueEl = null;
var displayFontSlider = null;

function normalizeDisplayTheme(raw) {
    for (var i = 0; i < DISPLAY_THEMES.length; i++) {
        if (DISPLAY_THEMES[i].id === raw) return raw;
    }
    return 'default';
}

function normalizeFontStep(raw) {
    var n = parseInt(raw, 10);
    if (n >= 1 && n <= DISPLAY_FONT_STEPS.length) return n;
    return 1;
}

function fontStepInfo(step) {
    return DISPLAY_FONT_STEPS[normalizeFontStep(step) - 1];
}

function applyDisplaySettings() {
    if (!root) return;
    var info = fontStepInfo(selectedFontStep);
    root.setAttribute('data-theme', selectedDisplayTheme);
    root.setAttribute('data-font-scale', String(info.step));
    root.style.setProperty('--syll-font-scale', String(info.scale));
}

function saveDisplaySettings() {
    try {
        localStorage.setItem(DISPLAY_THEME_KEY, selectedDisplayTheme);
        localStorage.setItem(DISPLAY_FONT_SCALE_KEY, String(selectedFontStep));
    } catch (e) { /* ignore quota / private mode */ }
}

function loadDisplaySettings() {
    var themeRaw = null;
    var fontRaw = null;
    try {
        themeRaw = localStorage.getItem(DISPLAY_THEME_KEY);
        fontRaw = localStorage.getItem(DISPLAY_FONT_SCALE_KEY);
    } catch (e) {
        themeRaw = null;
        fontRaw = null;
    }
    selectedDisplayTheme = normalizeDisplayTheme(themeRaw);
    selectedFontStep = normalizeFontStep(fontRaw);
    applyDisplaySettings();
}

function setDisplayTheme(themeId) {
    selectedDisplayTheme = normalizeDisplayTheme(themeId);
    applyDisplaySettings();
    saveDisplaySettings();
    syncDisplayMenuUi();
}

function setFontStep(step) {
    selectedFontStep = normalizeFontStep(step);
    applyDisplaySettings();
    saveDisplaySettings();
    syncDisplayMenuUi();
}

function resetDisplaySettings() {
    selectedDisplayTheme = 'default';
    selectedFontStep = 1;
    applyDisplaySettings();
    saveDisplaySettings();
    syncDisplayMenuUi();
}

function syncDisplayMenuUi() {
    if (!displayMenuBuilt || !displayMenu) return;
    var info = fontStepInfo(selectedFontStep);
    if (displayFontValueEl) {
        displayFontValueEl.textContent = info.label;
    }
    if (displayFontSlider) {
        displayFontSlider.value = String(info.step);
    }
    Array.from(displayMenu.querySelectorAll('.syllentras-display-theme-btn')).forEach(function (btn) {
        var active = btn.dataset.themeId === selectedDisplayTheme;
        btn.classList.toggle('selected', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function buildDisplayMenu() {
    if (!displayMenu || displayMenuBuilt) return;
    displayMenu.innerHTML = '';

    var fontSection = document.createElement('div');
    fontSection.className = 'syllentras-display-section';

    var fontLabel = document.createElement('div');
    fontLabel.className = 'syllentras-display-label';
    fontLabel.textContent = 'Font size';
    fontSection.appendChild(fontLabel);

    displayFontValueEl = document.createElement('div');
    displayFontValueEl.className = 'syllentras-display-value';
    displayFontValueEl.id = 'syllentras-display-font-value';
    fontSection.appendChild(displayFontValueEl);

    displayFontSlider = document.createElement('input');
    displayFontSlider.type = 'range';
    displayFontSlider.className = 'syllentras-display-slider';
    displayFontSlider.min = '1';
    displayFontSlider.max = String(DISPLAY_FONT_STEPS.length);
    displayFontSlider.step = '1';
    displayFontSlider.setAttribute('aria-label', 'Font size');
    displayFontSlider.setAttribute('aria-valuetext', fontStepInfo(selectedFontStep).label);
    displayFontSlider.addEventListener('input', function () {
        setFontStep(displayFontSlider.value);
        displayFontSlider.setAttribute('aria-valuetext', fontStepInfo(selectedFontStep).label);
    });
    displayFontSlider.addEventListener('click', function (e) {
        e.stopPropagation();
    });
    fontSection.appendChild(displayFontSlider);
    displayMenu.appendChild(fontSection);

    var themeSection = document.createElement('div');
    themeSection.className = 'syllentras-display-section';

    var themeLabel = document.createElement('div');
    themeLabel.className = 'syllentras-display-label';
    themeLabel.textContent = 'Theme';
    themeSection.appendChild(themeLabel);

    var themeList = document.createElement('div');
    themeList.className = 'syllentras-display-theme-list';
    themeList.setAttribute('role', 'group');
    themeList.setAttribute('aria-label', 'Color theme');

    DISPLAY_THEMES.forEach(function (theme) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'syllentras-display-theme-btn';
        btn.dataset.themeId = theme.id;
        btn.textContent = theme.label;
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            setDisplayTheme(theme.id);
        });
        themeList.appendChild(btn);
    });
    themeSection.appendChild(themeList);
    displayMenu.appendChild(themeSection);

    var resetSection = document.createElement('div');
    resetSection.className = 'syllentras-display-section';
    var resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'syllentras-display-reset';
    resetBtn.textContent = 'Reset display';
    resetBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        resetDisplaySettings();
    });
    resetSection.appendChild(resetBtn);
    displayMenu.appendChild(resetSection);

    displayMenu.addEventListener('click', function (e) {
        e.stopPropagation();
    });

    displayMenuBuilt = true;
    syncDisplayMenuUi();
}

function closeDisplayMenu() {
    if (!displayMenu || !displayBtn) return;
    displayMenu.hidden = true;
    displayBtn.setAttribute('aria-expanded', 'false');
}

function openDisplayMenu() {
    if (!displayMenu || !displayBtn) return;
    if (typeof closeToolsMenu === 'function') closeToolsMenu();
    if (typeof closeProviderMenu === 'function') closeProviderMenu();
    if (typeof closeModeMenu === 'function') closeModeMenu();
    buildDisplayMenu();
    displayMenu.hidden = false;
    displayBtn.setAttribute('aria-expanded', 'true');
}

function toggleDisplayMenu(e) {
    if (e) e.stopPropagation();
    if (!displayMenu) return;
    if (displayMenu.hidden) {
        openDisplayMenu();
    } else {
        closeDisplayMenu();
    }
}

function initDisplaySettings() {
    loadDisplaySettings();
    if (!displayBtn || !displayMenu) return;
    displayBtn.addEventListener('click', toggleDisplayMenu);
}

initDisplaySettings();

document.addEventListener('click', function (e) {
    if (!displayMenu || displayMenu.hidden) return;
    if (displayMenu.contains(e.target)) return;
    if (displayWrap && displayWrap.contains(e.target)) return;
    closeDisplayMenu();
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        closeDisplayMenu();
    }
});

window.addEventListener('resize', function () {
    closeDisplayMenu();
});
