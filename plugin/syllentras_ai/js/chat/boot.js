(function () {
'use strict';

var root = document.getElementById('syllentras-chat-root');
if (!root || !root.getAttribute('data-config')) { return; }
var config = JSON.parse(root.getAttribute('data-config'));
var API_URL = config.apiUrl;
var courseId = config.courseId;
var courseName = config.courseName;
var moodleUserId = config.moodleUserId;
var userFirstName = config.userFirstName;
var courseSections = config.courseSections || [];


// ===== preamble.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var PAGE_SIZE = 30;
var PANEL_MARGIN = 16;
var PANEL_MIN_WIDTH = 360;
var INPUT_MIN_HEIGHT = 42;
var INPUT_MAX_HEIGHT = 180;
var MESSAGES_MIN_HEIGHT = 120;
var PANEL_CHROME_HEIGHT = 130;
var PANEL_MIN_HEIGHT = PANEL_CHROME_HEIGHT + MESSAGES_MIN_HEIGHT + INPUT_MAX_HEIGHT;
var PANEL_DEFAULT_WIDTH = 920;
var PANEL_DEFAULT_HEIGHT = 650;
var PANEL_DEFAULT_RIGHT = 24;
var PANEL_DEFAULT_BOTTOM = 88;

var btn       = document.getElementById('syllentras-chat-btn');
var panel     = document.getElementById('syllentras-chat-panel');
var close     = document.getElementById('syllentras-chat-close');
var expandBtn = document.getElementById('syllentras-chat-expand');
var resetBtn  = document.getElementById('syllentras-chat-reset');
var input     = document.getElementById('syllentras-chat-input');
var send      = document.getElementById('syllentras-chat-send');
var toolsBtn  = document.getElementById('syllentras-chat-tools-btn');
var msgs      = document.getElementById('syllentras-chat-messages');
var loadMore  = document.getElementById('syllentras-chat-load-more');
var courseEl  = document.getElementById('syllentras-chat-course');
var header    = document.getElementById('syllentras-chat-header');
var sidebar   = document.getElementById('syllentras-chat-sidebar');
var sidebarResizer = document.getElementById('syllentras-chat-sidebar-resizer');
var inputResizer = document.getElementById('syllentras-chat-input-resizer');
var modal     = document.getElementById('syllentras-chat-modal');
var conversationsEl = document.getElementById('syllentras-chat-conversations');
var searchInput = document.getElementById('syllentras-chat-search');
var newBtn = document.getElementById('syllentras-chat-new');
var activeTitle = document.getElementById('syllentras-chat-active-title');
var activeTag = document.getElementById('syllentras-chat-active-tag');
var msgSearchToggle = document.getElementById('syllentras-msg-search-toggle');
var msgSearchPanel = document.getElementById('syllentras-msg-search');
var msgSearchInput = document.getElementById('syllentras-msg-search-input');
var msgSearchCount = document.getElementById('syllentras-msg-search-count');
var msgSearchResults = document.getElementById('syllentras-msg-search-results');
var msgSearchPrev = document.getElementById('syllentras-msg-search-prev');
var msgSearchNext = document.getElementById('syllentras-msg-search-next');
var msgSearchClose = document.getElementById('syllentras-msg-search-close');
var pendingDeleteConversation = null;
var openMenu = null;

courseEl.textContent = (courseId > 1 && courseName) ? courseName : 'Dashboard';

// Dashboard default chat is named Home. Course default stays Main.
function isDashboardContext() {
    return !(courseId > 1);
}

function generalChatTitle() {
    return isDashboardContext() ? 'Home' : 'Main';
}

function generalChatTag() {
    return isDashboardContext() ? '#Home' : '#Main';
}

function generalConversationGroupTitle() {
    return generalChatTitle();
}

function generalChatPlaceholder() {
    return isDashboardContext() ? 'Ask a question from Home...' : 'Ask a question about this course...';
}

function displayConversationTitle(conversation) {
    if (conversation && conversation.type === 'general') {
        return generalChatTitle();
    }
    return (conversation && conversation.title) || 'Conversation';
}

function displayConversationTag(conversation) {
    if (conversation && conversation.type === 'general') {
        return generalChatTag();
    }
    return (conversation && conversation.tag) || '';
}

if (activeTitle) {
    activeTitle.textContent = generalChatTitle();
}
if (activeTag) {
    activeTag.textContent = generalChatTag();
}
if (input) {
    input.placeholder = generalChatPlaceholder();
}

var conversationId = null;
var activeConversation = null;
var hasMore = false;
var loadingHistory = false;
var loadingOlder = false;
var layoutSaveTimer = null;
var isDraggingPanel = false;
var isResizingPanel = false;
var isResizingSidebar = false;
var isResizingInput = false;
var dragOffsetX = 0;
var dragOffsetY = 0;
var resizeEdge = null;
var resizeStartX = 0;
var resizeStartY = 0;
var resizeStartRect = null;
var inputResizeStartY = 0;
var inputResizeStartHeight = 0;
var mobileLayout = window.matchMedia('(max-width: 700px)');
var isExpanded = localStorage.getItem('syllentras_expanded') === '1';
var SIDEBAR_MIN_WIDTH = 150;
var SIDEBAR_MAX_WIDTH = 340;
var SIDEBAR_DEFAULT_WIDTH = 190;

// ===== layout.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function layoutStorageKey() {
    return 'syllentras_layout_' + moodleUserId;
}

function normalLayoutStorageKey() {
    return 'syllentras_layout_normal_' + moodleUserId;
}

function sidebarWidthStorageKey() {
    return 'syllentras_sidebar_width_' + moodleUserId;
}

function inputHeightStorageKey() {
    return 'syllentras_input_height_' + moodleUserId;
}

function isMobileLayout() {
    return mobileLayout.matches;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function normalizePanelRect(rect) {
    var maxWidth = Math.max(1, window.innerWidth - PANEL_MARGIN * 2);
    var maxHeight = Math.max(1, window.innerHeight - PANEL_MARGIN * 2);
    var minWidth = Math.min(PANEL_MIN_WIDTH, maxWidth);
    var minHeight = Math.min(PANEL_MIN_HEIGHT, maxHeight);
    var width = clamp(rect.width || PANEL_DEFAULT_WIDTH, minWidth, maxWidth);
    var height = clamp(rect.height || panel.offsetHeight || PANEL_DEFAULT_HEIGHT, minHeight, maxHeight);
    var left = clamp(rect.left, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN));
    var top = clamp(rect.top, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN));

    return { left: left, top: top, width: width, height: height };
}

function setPanelRect(rect) {
    panel.style.left = Math.round(rect.left) + 'px';
    panel.style.top = Math.round(rect.top) + 'px';
    panel.style.width = Math.round(rect.width) + 'px';
    panel.style.height = Math.round(rect.height) + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
}

function getCurrentPanelRect() {
    var rect = panel.getBoundingClientRect();
    return normalizePanelRect({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
    });
}

function loadStoredLayout(normalSize) {
    try {
        var raw = localStorage.getItem(normalSize ? normalLayoutStorageKey() : layoutStorageKey());
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function savePanelLayout() {
    if (isMobileLayout() || panel.hidden) return;

    try {
        var rect = JSON.stringify(getCurrentPanelRect());
        localStorage.setItem(layoutStorageKey(), rect);
        if (!isExpanded) {
            localStorage.setItem(normalLayoutStorageKey(), rect);
        }
    } catch (e) {
        // The chat still works if browser storage is unavailable.
    }
}

function scheduleLayoutSave() {
    if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
    layoutSaveTimer = setTimeout(savePanelLayout, 150);
}

function applyStoredSidebarWidth() {
    if (isMobileLayout()) return;
    var stored = parseInt(localStorage.getItem(sidebarWidthStorageKey()) || '', 10);
    if (!Number.isNaN(stored)) setSidebarWidth(stored);
}

function setSidebarWidth(width) {
    var panelWidth = panel.getBoundingClientRect().width || PANEL_DEFAULT_WIDTH;
    var maxByPanel = Math.max(SIDEBAR_MIN_WIDTH, panelWidth - 280);
    var nextWidth = clamp(width, SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, maxByPanel));
    sidebar.style.width = nextWidth + 'px';
    sidebar.style.flexBasis = nextWidth + 'px';
}

function saveSidebarWidth() {
    if (isMobileLayout()) return;
    localStorage.setItem(sidebarWidthStorageKey(), String(Math.round(sidebar.getBoundingClientRect().width)));
}

function applyStoredInputHeight() {
    var stored = parseInt(localStorage.getItem(inputHeightStorageKey()) || '', 10);
    if (!Number.isNaN(stored)) setInputHeight(stored);
}

function setInputHeight(height) {
    input.style.height = clamp(height, INPUT_MIN_HEIGHT, INPUT_MAX_HEIGHT) + 'px';
}

function saveInputHeight() {
    localStorage.setItem(inputHeightStorageKey(), String(Math.round(input.getBoundingClientRect().height)));
}

function getDefaultPanelRect() {
    return normalizePanelRect({
        left: window.innerWidth - PANEL_DEFAULT_WIDTH - PANEL_DEFAULT_RIGHT,
        top: window.innerHeight - PANEL_DEFAULT_HEIGHT - PANEL_DEFAULT_BOTTOM,
        width: PANEL_DEFAULT_WIDTH,
        height: PANEL_DEFAULT_HEIGHT
    });
}

function resetPanelLayout() {
    if (isMobileLayout()) return;

    isExpanded = false;
    localStorage.setItem('syllentras_expanded', '0');
    panel.classList.remove('expanded');
    expandBtn.innerHTML = '&#x2922;';
    expandBtn.setAttribute('aria-label', 'Expand');
    setPanelRect(getDefaultPanelRect());
    savePanelLayout();
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    saveSidebarWidth();
    setInputHeight(INPUT_MIN_HEIGHT);
    saveInputHeight();
}

function applyStoredLayout(normalSize) {
    if (isMobileLayout()) return;
    var stored = loadStoredLayout(normalSize);
    if (stored) setPanelRect(normalizePanelRect(stored));
}

function clampCurrentPanelLayout() {
    if (isMobileLayout() || panel.hidden) return;
    setPanelRect(getCurrentPanelRect());
    savePanelLayout();
}

function applyExpandedState(forceFullHeight) {
    if (isExpanded) {
        panel.classList.add('expanded');
        expandBtn.innerHTML = '&#x2921;';
        expandBtn.setAttribute('aria-label', 'Collapse');
        if (forceFullHeight && !panel.hidden && !isMobileLayout()) {
            var expandedRect = getCurrentPanelRect();
            expandedRect.top = PANEL_MARGIN;
            expandedRect.height = window.innerHeight - PANEL_MARGIN * 2;
            setPanelRect(normalizePanelRect(expandedRect));
        }
    } else {
        panel.classList.remove('expanded');
        expandBtn.innerHTML = '&#x2922;';
        expandBtn.setAttribute('aria-label', 'Expand');
        applyStoredLayout(true);
    }
    clampCurrentPanelLayout();
}

function showPanel() {
    panel.hidden = false;
    btn.hidden = true;
    applyStoredLayout();
    applyStoredSidebarWidth();
    applyStoredInputHeight();
    applyExpandedState(false);
    clampCurrentPanelLayout();
}


// ===== api.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function fetchJson(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    return fetch(API_URL + path, options).then(function (res) {
        return res.text().then(function (text) {
            var data = null;
            if (text) {
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    data = null;
                }
            }
            if (!res.ok) {
                // Nest usually returns { message: "..." } — surface that, never secrets.
                var msg = null;
                if (data) {
                    if (typeof data.message === 'string') msg = data.message;
                    else if (Array.isArray(data.message)) msg = data.message.join(' ');
                }
                throw new Error(msg || ('Request failed (' + res.status + '). Please try again.'));
            }
            return data;
        });
    });
}


// ===== providers.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var PROVIDER_STORAGE_KEY = 'syllentras_ai_provider';
var UNAVAILABLE_PROVIDER_MESSAGE =
    'This AI provider is currently unavailable because it has not been configured yet.';

var providerBtn = document.getElementById('syllentras-provider-btn');
var providerMenu = document.getElementById('syllentras-provider-menu');
var providerWrap = providerBtn ? providerBtn.closest('.syllentras-provider-wrap') : null;

var providerList = [];
var selectedProviderId = null;
var defaultProviderId = null;
var providersLoaded = false;
var isGeneratingResponse = false;

function getSelectedProviderId() {
    return selectedProviderId || defaultProviderId || null;
}

function setGeneratingState(busy) {
    isGeneratingResponse = !!busy;
    if (providerBtn) {
        providerBtn.disabled = isGeneratingResponse;
        providerBtn.setAttribute('aria-busy', isGeneratingResponse ? 'true' : 'false');
        if (isGeneratingResponse) {
            closeProviderMenu();
        }
    }
    if (toolsBtn) {
        toolsBtn.disabled = isGeneratingResponse;
    }
    if (typeof modeBtn !== 'undefined' && modeBtn) {
        modeBtn.disabled = isGeneratingResponse;
        if (isGeneratingResponse && typeof closeModeMenu === 'function') {
            closeModeMenu();
        }
    }
}

function closeProviderMenu() {
    if (!providerMenu || !providerBtn) return;
    providerMenu.hidden = true;
    providerBtn.setAttribute('aria-expanded', 'false');
    providerBtn.classList.remove('open');
}

function openProviderMenu() {
    if (!providerMenu || !providerBtn || isGeneratingResponse) return;
    // Close the tools menu if it is open so the two popovers do not overlap.
    if (typeof closeToolsMenu === 'function') {
        closeToolsMenu();
    }
    if (typeof closeModeMenu === 'function') {
        closeModeMenu();
    }
    renderProviderMenu();
    providerMenu.hidden = false;
    providerBtn.setAttribute('aria-expanded', 'true');
    providerBtn.classList.add('open');
}

function toggleProviderMenu() {
    if (!providerMenu) return;
    if (providerMenu.hidden) {
        openProviderMenu();
    } else {
        closeProviderMenu();
    }
}

function findProvider(id) {
    for (var i = 0; i < providerList.length; i++) {
        if (providerList[i].id === id) return providerList[i];
    }
    return null;
}

function updateProviderLabel() {
    var active = findProvider(getSelectedProviderId());
    if (providerBtn) {
        providerBtn.setAttribute(
            'aria-label',
            active
                ? ('AI provider: ' + active.displayName + '. Click to change.')
                : 'Choose AI provider'
        );
    }
}

function selectProvider(id) {
    var provider = findProvider(id);
    if (!provider || !provider.available) return;
    selectedProviderId = provider.id;
    try {
        localStorage.setItem(PROVIDER_STORAGE_KEY, selectedProviderId);
    } catch (e) { /* ignore quota / private mode */ }
    updateProviderLabel();
    closeProviderMenu();
}

function renderProviderMenu() {
    if (!providerMenu) return;
    providerMenu.innerHTML = '';

    var heading = document.createElement('div');
    heading.className = 'syllentras-provider-menu-heading';
    heading.textContent = 'AI provider';
    providerMenu.appendChild(heading);

    var activeId = getSelectedProviderId();

    if (!providerList.length) {
        var empty = document.createElement('div');
        empty.className = 'syllentras-provider-empty';
        empty.textContent = 'No AI providers are configured yet.';
        providerMenu.appendChild(empty);
        return;
    }

    providerList.forEach(function (provider) {
        var option = document.createElement('button');
        option.type = 'button';
        option.className = 'syllentras-provider-option';
        option.setAttribute('role', 'option');
        option.dataset.providerId = provider.id;

        var row = document.createElement('span');
        row.className = 'syllentras-provider-option-row';

        var nameEl = document.createElement('span');
        nameEl.className = 'syllentras-provider-option-name';
        nameEl.textContent = provider.displayName;
        row.appendChild(nameEl);

        if (provider.id === activeId) {
            option.classList.add('active');
            option.setAttribute('aria-selected', 'true');
            var check = document.createElement('span');
            check.className = 'syllentras-provider-option-check';
            check.setAttribute('aria-hidden', 'true');
            check.textContent = '\u2713';
            row.appendChild(check);
        } else {
            option.setAttribute('aria-selected', 'false');
        }

        option.appendChild(row);

        if (!provider.available) {
            option.classList.add('disabled');
            option.setAttribute('aria-disabled', 'true');
            option.title = UNAVAILABLE_PROVIDER_MESSAGE;
            var unavailable = document.createElement('span');
            unavailable.className = 'syllentras-provider-option-status';
            unavailable.textContent = 'Unavailable';
            row.appendChild(unavailable);

            option.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
            });
        } else {
            option.addEventListener('click', function () {
                selectProvider(provider.id);
            });
        }

        providerMenu.appendChild(option);
    });
}

function applyProviderList(data) {
    providerList = Array.isArray(data && data.providers) ? data.providers : [];
    defaultProviderId = (data && data.defaultProviderId) || null;

    var stored = null;
    try {
        stored = localStorage.getItem(PROVIDER_STORAGE_KEY);
    } catch (e) {
        stored = null;
    }

    var storedProvider = stored ? findProvider(stored) : null;
    if (storedProvider && storedProvider.available) {
        selectedProviderId = storedProvider.id;
    } else if (defaultProviderId && findProvider(defaultProviderId)) {
        selectedProviderId = defaultProviderId;
    } else {
        var firstAvailable = null;
        for (var i = 0; i < providerList.length; i++) {
            if (providerList[i].available) {
                firstAvailable = providerList[i].id;
                break;
            }
        }
        selectedProviderId = firstAvailable;
    }

    providersLoaded = true;
    updateProviderLabel();
    renderProviderMenu();
}

function loadProviders() {
    return fetchJson('/chat/providers')
        .then(function (data) {
            applyProviderList(data);
        })
        .catch(function () {
            providerList = [];
            defaultProviderId = null;
            selectedProviderId = null;
            providersLoaded = true;
            updateProviderLabel();
        });
}

if (providerBtn) {
    providerBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isGeneratingResponse) return;
        toggleProviderMenu();
    });
}

document.addEventListener('click', function (e) {
    if (!providerMenu || providerMenu.hidden) return;
    if (providerWrap && providerWrap.contains(e.target)) return;
    closeProviderMenu();
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        closeProviderMenu();
    }
});

// ===== mode-selector.js =====
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

// ===== markdown.js =====
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

// ===== pending-actions.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var QUIZ_COUNT_MIN = 5;
var QUIZ_COUNT_MAX = 40;
var FLASHCARD_COUNT_MIN = 8;
var FLASHCARD_COUNT_MAX = 40;
var QUIZ_DIFFICULTIES = [
    { value: 'easy', label: 'Easy' },
    { value: 'medium', label: 'Medium' },
    { value: 'hard', label: 'Hard' },
    { value: 'expert', label: 'Expert' }
];
var QUIZ_DIFFICULTY_DEFAULT = 'medium';

function normalizePendingDifficulty(value) {
    var raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    for (var i = 0; i < QUIZ_DIFFICULTIES.length; i++) {
        if (QUIZ_DIFFICULTIES[i].value === raw) return raw;
    }
    return QUIZ_DIFFICULTY_DEFAULT;
}

function clearPendingActionUi(root) {
    var scope = root || msgs;
    Array.from(scope.querySelectorAll('.syllentras-pending-action, .syllentras-review-offer')).forEach(function (node) {
        node.remove();
    });
}

function resolvePendingActionType(pendingAction) {
    if (!pendingAction) return 'practice_quiz';
    if (pendingAction.type === 'flashcards') return 'flashcards';
    if (pendingAction.type === 'study_guide') return 'study_guide';
    if (pendingAction.type === 'practice_quiz') return 'practice_quiz';
    if (typeof pendingAction.cardCount === 'number') return 'flashcards';
    // Study-guide DTOs omit questionCount/cardCount; quizzes always include a number.
    if (typeof pendingAction.questionCount !== 'number') return 'study_guide';
    return 'practice_quiz';
}

function createPendingField(labelText, inputEl) {
    var field = document.createElement('label');
    field.className = 'syllentras-pending-field';
    var label = document.createElement('span');
    label.className = 'syllentras-pending-field-label';
    label.textContent = labelText;
    field.appendChild(label);
    field.appendChild(inputEl);
    return field;
}

function attachPendingAction(messageEl, pendingAction) {
    if (!messageEl || !pendingAction || !pendingAction.id) return;
    clearPendingActionUi(messageEl);

    var actionType = resolvePendingActionType(pendingAction);
    var wrap = document.createElement('div');
    wrap.className = 'syllentras-pending-action';
    wrap.dataset.actionId = pendingAction.id;
    wrap.dataset.actionType = actionType;

    var summary = document.createElement('div');
    summary.className = 'syllentras-pending-summary';

    var defaultTitle =
        actionType === 'study_guide'
            ? 'Study guide'
            : actionType === 'flashcards'
              ? 'Flashcards'
              : 'Practice quiz';

    var titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'syllentras-pending-title-input';
    titleInput.maxLength = 200;
    titleInput.value = pendingAction.title || defaultTitle;
    titleInput.setAttribute('aria-label', 'Title');
    summary.appendChild(createPendingField('Title', titleInput));

    var countInput = null;
    var countMin = null;
    var countMax = null;
    var difficultySelect = null;
    if (actionType === 'flashcards') {
        countMin = FLASHCARD_COUNT_MIN;
        countMax = FLASHCARD_COUNT_MAX;
        countInput = document.createElement('input');
        countInput.type = 'number';
        countInput.className = 'syllentras-pending-count-input';
        countInput.min = String(countMin);
        countInput.max = String(countMax);
        countInput.step = '1';
        countInput.value = String(pendingAction.cardCount || FLASHCARD_COUNT_MIN);
        countInput.setAttribute('aria-label', 'Number of flashcards');
        summary.appendChild(createPendingField('Flashcards', countInput));
    } else if (actionType === 'practice_quiz') {
        countMin = QUIZ_COUNT_MIN;
        countMax = QUIZ_COUNT_MAX;
        countInput = document.createElement('input');
        countInput.type = 'number';
        countInput.className = 'syllentras-pending-count-input';
        countInput.min = String(countMin);
        countInput.max = String(countMax);
        countInput.step = '1';
        countInput.value = String(pendingAction.questionCount || QUIZ_COUNT_MIN);
        countInput.setAttribute('aria-label', 'Number of questions');
        summary.appendChild(createPendingField('Questions', countInput));

        difficultySelect = document.createElement('select');
        difficultySelect.className = 'syllentras-pending-difficulty-select';
        difficultySelect.setAttribute('aria-label', 'Difficulty');
        var selectedDifficulty = normalizePendingDifficulty(pendingAction.difficulty);
        QUIZ_DIFFICULTIES.forEach(function (opt) {
            var option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (opt.value === selectedDifficulty) {
                option.selected = true;
            }
            difficultySelect.appendChild(option);
        });
        summary.appendChild(createPendingField('Difficulty', difficultySelect));
    } else {
        var guideNote = document.createElement('div');
        guideNote.className = 'syllentras-pending-note';
        guideNote.textContent = 'Private study guide Page';
        summary.appendChild(guideNote);
    }

    var covers = document.createElement('div');
    covers.className = 'syllentras-pending-note';
    covers.textContent = 'Covers: ' + (pendingAction.scopeSummary || 'course material');
    summary.appendChild(covers);

    wrap.appendChild(summary);

    var actions = document.createElement('div');
    actions.className = 'syllentras-pending-actions';

    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'syllentras-pending-confirm';
    confirmBtn.textContent = 'Confirm';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'syllentras-pending-cancel';
    cancelBtn.textContent = 'Cancel';

    function setBusy(busy) {
        confirmBtn.disabled = busy;
        cancelBtn.disabled = busy;
        titleInput.disabled = busy;
        if (countInput) countInput.disabled = busy;
        if (difficultySelect) difficultySelect.disabled = busy;
        confirmBtn.textContent = busy ? 'Creating...' : 'Confirm';
    }

    function createFailedMessage() {
        var kind = wrap.dataset.actionType || actionType;
        if (kind === 'study_guide') {
            return 'Could not create the study guide. Please try again.';
        }
        if (kind === 'flashcards') {
            return 'Could not create the flashcards. Please try again.';
        }
        return 'Could not create the practice quiz. Please try again.';
    }

    function readCount() {
        if (!countInput || countMin == null || countMax == null) return undefined;
        var n = Number(countInput.value);
        if (!Number.isFinite(n)) {
            n = countMin;
        }
        n = Math.round(n);
        if (n < countMin) n = countMin;
        if (n > countMax) n = countMax;
        countInput.value = String(n);
        return n;
    }

    confirmBtn.addEventListener('click', function () {
        var title = (titleInput.value || '').trim();
        if (!title) {
            titleInput.focus();
            return;
        }
        var count = readCount();
        setBusy(true);
        var body = {
            actionId: pendingAction.id,
            moodleUserId: moodleUserId,
            title: title
        };
        if (typeof count === 'number') {
            body.count = count;
        }
        if (difficultySelect) {
            body.difficulty = normalizePendingDifficulty(difficultySelect.value);
        }
        var providerId = typeof getSelectedProviderId === 'function' ? getSelectedProviderId() : null;
        if (providerId) {
            body.provider = providerId;
        }
        setGeneratingState(true);
        fetchJson('/chat/actions/confirm', {
            method: 'POST',
            body: JSON.stringify(body)
        })
        .then(function (data) {
            clearPendingActionUi(messageEl);
            if (data.response) {
                appendMessage('assistant', data.response);
            }
            if (typeof refreshAiContentList === 'function' && typeof isAiContentTabActive === 'function' && isAiContentTabActive()) {
                refreshAiContentList();
            }
            return loadConversations().then(loadReviewOfferForConversation);
        })
        .catch(function (err) {
            setBusy(false);
            appendMessage('error', (err && err.message) ? err.message : createFailedMessage());
        })
        .finally(function () {
            setGeneratingState(false);
        });
    });

    cancelBtn.addEventListener('click', function () {
        setBusy(true);
        fetchJson('/chat/actions/cancel', {
            method: 'POST',
            body: JSON.stringify({
                actionId: pendingAction.id,
                moodleUserId: moodleUserId
            })
        })
        .then(function (data) {
            clearPendingActionUi(messageEl);
            if (data.response) {
                appendMessage('assistant', data.response);
            }
        })
        .catch(function () {
            setBusy(false);
            appendMessage('error', 'Could not cancel that request. Please try again.');
        });
    });

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    wrap.appendChild(actions);
    messageEl.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
}

function loadPendingActionForConversation() {
    if (!conversationId || !moodleUserId) return Promise.resolve();
    return fetchJson('/chat/actions/pending?conversationId='
        + encodeURIComponent(conversationId)
        + '&moodleUserId=' + encodeURIComponent(moodleUserId))
    .then(function (data) {
        if (!data.pendingAction) return;
        var assistants = msgs.querySelectorAll('.syllentras-msg.assistant');
        var last = assistants.length ? assistants[assistants.length - 1] : null;
        if (last) {
            attachPendingAction(last, data.pendingAction);
        }
    })
    .catch(function () { /* ignore */ });
}

// ===== review-offer.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function attachReviewOffer(messageEl, offer) {
    if (!messageEl || !offer || !offer.actionId) return;
    Array.from(messageEl.querySelectorAll('.syllentras-review-offer')).forEach(function (node) {
        node.remove();
    });

    var wrap = document.createElement('div');
    wrap.className = 'syllentras-review-offer';
    wrap.dataset.actionId = offer.actionId;

    var summary = document.createElement('div');
    summary.className = 'syllentras-pending-summary';
    summary.innerHTML = '<strong></strong><div></div><div></div>';
    summary.querySelector('strong').textContent = 'Want me to walk through what you missed?';
    summary.children[1].textContent = 'You got ' + (offer.scoreLabel || (offer.score + '/' + offer.maxScore))
        + ' on "' + (offer.title || 'your practice quiz') + '".';
    summary.children[2].textContent = 'I can explain the ' + offer.wrongCount
        + ' wrong answer' + (offer.wrongCount === 1 ? '' : 's')
        + ' using your course materials.';
    wrap.appendChild(summary);

    var explainBtn = document.createElement('button');
    explainBtn.type = 'button';
    explainBtn.className = 'syllentras-review-explain';
    explainBtn.textContent = 'Explain my wrong answers';

    explainBtn.addEventListener('click', function () {
        explainBtn.disabled = true;
        explainBtn.textContent = 'Explaining...';
        setGeneratingState(true);
        var body = {
            conversationId: conversationId,
            moodleUserId: moodleUserId
        };
        var providerId = typeof getSelectedProviderId === 'function' ? getSelectedProviderId() : null;
        if (providerId) {
            body.provider = providerId;
        }
        fetchJson('/chat/actions/review-explain', {
            method: 'POST',
            body: JSON.stringify(body)
        })
        .then(function (data) {
            wrap.remove();
            if (data.response) {
                appendMessage('assistant', data.response);
            }
        })
        .catch(function (err) {
            explainBtn.disabled = false;
            explainBtn.textContent = 'Explain my wrong answers';
            appendMessage('error', (err && err.message)
                ? err.message
                : 'Could not explain your wrong answers. Please try again.');
        })
        .finally(function () {
            setGeneratingState(false);
        });
    });

    wrap.appendChild(explainBtn);
    messageEl.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
}

function loadReviewOfferForConversation() {
    if (!conversationId || !moodleUserId) return Promise.resolve();
    return fetchJson('/chat/actions/review-offer?conversationId='
        + encodeURIComponent(conversationId)
        + '&moodleUserId=' + encodeURIComponent(moodleUserId))
    .then(function (data) {
        if (!data.offer) return;
        var assistants = msgs.querySelectorAll('.syllentras-msg.assistant');
        var last = assistants.length ? assistants[assistants.length - 1] : null;
        if (last) {
            attachReviewOffer(last, data.offer);
        }
    })
    .catch(function () { /* ignore */ });
}


// ===== message-search.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.
//
// Find-in-chat guts. Keeps a tiny searchable list of the messages we already
// loaded so typing in the find box doesn't walk the whole message DOM.
// Rendering / scrolling lives in messages.js; this file just indexes + queries.

var MESSAGE_SEARCH_DEBOUNCE_MS = 160;
var MESSAGE_SEARCH_PREVIEW_RADIUS = 42;

var messageSearchIndex = [];
var messageSearchLocalSeq = 0;
var messageSearchQuery = '';
var messageSearchResults = [];
var messageSearchActiveIndex = -1;
var messageSearchDebounceTimer = null;
var messageSearchOpen = false;

function nextLocalMessageId() {
    messageSearchLocalSeq += 1;
    return 'local-' + Date.now() + '-' + messageSearchLocalSeq;
}

function resetMessageSearchIndex() {
    messageSearchIndex = [];
}

function upsertMessageSearchEntry(entry) {
    if (!entry || !entry.id || entry.role === 'error' || entry.role === 'system') {
        return;
    }
    var content = entry.content == null ? '' : String(entry.content);
    if (content === '...') {
        return;
    }
    var row = {
        id: String(entry.id),
        role: entry.role === 'assistant' ? 'assistant' : 'user',
        content: content,
        createdAt: entry.createdAt || null
    };
    for (var i = 0; i < messageSearchIndex.length; i++) {
        if (messageSearchIndex[i].id === row.id) {
            messageSearchIndex[i] = row;
            return;
        }
    }
    messageSearchIndex.push(row);
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function stripMarkdown(text) {
    return String(text || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        .replace(/^>\s?/gm, '')
        .replace(/^[-*+]\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function findMatchRanges(content, query) {
    var ranges = [];
    if (!content || !query) return ranges;
    var hay = content.toLowerCase();
    var needle = query.toLowerCase();
    var from = 0;
    while (from <= hay.length) {
        var hit = hay.indexOf(needle, from);
        if (hit === -1) break;
        ranges.push({ start: hit, end: hit + needle.length });
        from = hit + Math.max(needle.length, 1);
    }
    return ranges;
}

function buildMatchPreview(content, query) {
    content = stripMarkdown(content);
    var ranges = findMatchRanges(content, query);
    if (!ranges.length) {
        return escapeHtml(content).slice(0, MESSAGE_SEARCH_PREVIEW_RADIUS * 2);
    }
    var first = ranges[0];
    var start = Math.max(0, first.start - MESSAGE_SEARCH_PREVIEW_RADIUS);
    var end = Math.min(content.length, first.end + MESSAGE_SEARCH_PREVIEW_RADIUS);
    var slice = content.slice(start, end);
    var localQuery = query;
    var re = new RegExp(escapeRegExp(localQuery), 'ig');
    var highlighted = escapeHtml(slice).replace(re, function (match) {
        return '<mark class="syllentras-search-mark">' + match + '</mark>';
    });
    return (start > 0 ? '…' : '') + highlighted + (end < content.length ? '…' : '');
}

// Pure query over the index. Cheap enough for big chats because we never touch the DOM here.
function queryMessageSearchIndex(rawQuery) {
    var query = (rawQuery || '').trim();
    if (!query) return [];

    var out = [];
    for (var i = 0; i < messageSearchIndex.length; i++) {
        var entry = messageSearchIndex[i];
        var ranges = findMatchRanges(entry.content, query);
        if (!ranges.length) continue;
        out.push({
            id: entry.id,
            role: entry.role,
            content: entry.content,
            matchCount: ranges.length,
            previewHtml: buildMatchPreview(entry.content, query)
        });
    }
    return out;
}

function setMessageSearchResults(results, query) {
    messageSearchResults = results || [];
    messageSearchQuery = query || '';
    messageSearchActiveIndex = messageSearchResults.length ? 0 : -1;
}

function getActiveMessageSearchResult() {
    if (messageSearchActiveIndex < 0 || messageSearchActiveIndex >= messageSearchResults.length) {
        return null;
    }
    return messageSearchResults[messageSearchActiveIndex];
}

function moveMessageSearchSelection(delta) {
    if (!messageSearchResults.length) {
        messageSearchActiveIndex = -1;
        return null;
    }
    var next = messageSearchActiveIndex + delta;
    if (next < 0) next = messageSearchResults.length - 1;
    if (next >= messageSearchResults.length) next = 0;
    messageSearchActiveIndex = next;
    return getActiveMessageSearchResult();
}

function scheduleMessageSearch(rawQuery, onDone) {
    if (messageSearchDebounceTimer) {
        clearTimeout(messageSearchDebounceTimer);
    }
    messageSearchDebounceTimer = setTimeout(function () {
        messageSearchDebounceTimer = null;
        var query = (rawQuery || '').trim();
        var results = query ? queryMessageSearchIndex(query) : [];
        setMessageSearchResults(results, query);
        if (typeof onDone === 'function') onDone(results, query);
    }, MESSAGE_SEARCH_DEBOUNCE_MS);
}

function clearMessageSearchSchedule() {
    if (messageSearchDebounceTimer) {
        clearTimeout(messageSearchDebounceTimer);
        messageSearchDebounceTimer = null;
    }
}

// ===== messages.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var messageFlashTimer = null;
var messageMarkFadeTimer = null;

function normalizeMessageMode(mode) {
    if (mode === 'coach') return 'coach';
    // Legacy / missing mode on assistant turns defaults to Direct.
    return 'direct';
}

function applyModeChip(el, mode) {
    if (!el) return;
    var existing = el.querySelector('.syllentras-msg-mode');
    if (existing) existing.remove();
    var normalized = normalizeMessageMode(mode);
    var chip = document.createElement('span');
    chip.className = 'syllentras-msg-mode syllentras-msg-mode-' + normalized;
    chip.textContent = normalized === 'coach' ? 'Coach' : 'Direct';
    el.insertBefore(chip, el.firstChild);
    el.dataset.mode = normalized;
}

function appendSystemNotice(text, options) {
    options = options || {};
    if (!msgs || !text) return null;
    var div = document.createElement('div');
    div.className = 'syllentras-msg system';
    div.textContent = text;
    msgs.appendChild(div);
    if (options.scroll !== false) msgs.scrollTop = msgs.scrollHeight;
    return div;
}

function createMessageElement(role, text, options) {
    options = options || {};
    var div = document.createElement('div');
    div.className = 'syllentras-msg ' + role;
    if (options.createdAt) div.dataset.createdAt = options.createdAt;
    var messageId = options.id || nextLocalMessageId();
    div.dataset.messageId = String(messageId);
    if (role === 'assistant' && text !== '...') {
        renderAssistantContent(div, text);
        applyModeChip(div, options.mode);
    } else {
        div.textContent = text;
    }
    if (role === 'user' || (role === 'assistant' && text !== '...')) {
        upsertMessageSearchEntry({
            id: messageId,
            role: role,
            content: text,
            createdAt: options.createdAt || null
        });
    }
    return div;
}

function appendMessage(role, text, options) {
    options = options || {};
    var div = createMessageElement(role, text, options);
    msgs.appendChild(div);
    if (options.scroll !== false) msgs.scrollTop = msgs.scrollHeight;
    return div;
}

function prependMessage(role, text, options) {
    options = options || {};
    if (typeof options === 'string') {
        // Legacy callers passed createdAt as the third argument.
        options = { createdAt: options };
    }
    var div = createMessageElement(role, text, options);
    msgs.insertBefore(div, loadMore.nextSibling);
    return div;
}

function clearMessages() {
    Array.from(msgs.querySelectorAll('.syllentras-msg')).forEach(function (node) {
        node.remove();
    });
    resetMessageSearchIndex();
    clearMessageTextHighlights();
    if (typeof setMessageSearchResults === 'function') {
        setMessageSearchResults([], '');
    }
    if (typeof renderMessageSearchResults === 'function') {
        renderMessageSearchResults([]);
    }
    if (typeof updateMessageSearchCount === 'function') {
        updateMessageSearchCount();
    }
}

function getOldestMessageCreatedAt() {
    var nodes = msgs.querySelectorAll('.syllentras-msg[data-created-at]');
    return nodes.length ? nodes[0].dataset.createdAt : null;
}

function scrollToBottom() {
    msgs.scrollTop = msgs.scrollHeight;
}

function renderMessageBatch(messages, prepend) {
    var list = prepend ? messages.slice().reverse() : messages;
    list.forEach(function (m) {
        var role = m.role === 'assistant' ? 'assistant' : 'user';
        var opts = {
            scroll: false,
            createdAt: m.createdAt,
            mode: m.mode,
            id: m.id
        };
        if (prepend) {
            prependMessage(role, m.content, opts);
        } else {
            appendMessage(role, m.content, opts);
        }
    });
}

function findMessageElement(messageId) {
    if (!msgs || messageId == null) return null;
    var id = String(messageId);
    var nodes = msgs.querySelectorAll('.syllentras-msg[data-message-id]');
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].dataset.messageId === id) return nodes[i];
    }
    return null;
}

function clearMessageTextHighlights() {
    if (!msgs) return;
    Array.from(msgs.querySelectorAll('mark.syllentras-search-mark')).forEach(function (mark) {
        var parent = mark.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
    });
    Array.from(msgs.querySelectorAll('.syllentras-msg-flash')).forEach(function (el) {
        el.classList.remove('syllentras-msg-flash');
    });
    if (messageFlashTimer) {
        clearTimeout(messageFlashTimer);
        messageFlashTimer = null;
    }
    if (messageMarkFadeTimer) {
        clearTimeout(messageMarkFadeTimer);
        messageMarkFadeTimer = null;
    }
}

function highlightTextNodeMatches(root, query) {
    if (!root || !query) return;
    var needle = query.toLowerCase();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
            if (!node.nodeValue || !node.nodeValue.toLowerCase().includes(needle)) {
                return NodeFilter.FILTER_REJECT;
            }
            // Don't mess with mode chips or other chrome.
            if (node.parentElement && node.parentElement.closest('.syllentras-msg-mode')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    var textNodes = [];
    var current = walker.nextNode();
    while (current) {
        textNodes.push(current);
        current = walker.nextNode();
    }

    textNodes.forEach(function (textNode) {
        var value = textNode.nodeValue;
        var lower = value.toLowerCase();
        var frag = document.createDocumentFragment();
        var cursor = 0;
        var hit = lower.indexOf(needle, cursor);
        while (hit !== -1) {
            if (hit > cursor) {
                frag.appendChild(document.createTextNode(value.slice(cursor, hit)));
            }
            var mark = document.createElement('mark');
            mark.className = 'syllentras-search-mark';
            mark.textContent = value.slice(hit, hit + needle.length);
            frag.appendChild(mark);
            cursor = hit + needle.length;
            hit = lower.indexOf(needle, cursor);
        }
        if (cursor < value.length) {
            frag.appendChild(document.createTextNode(value.slice(cursor)));
        }
        textNode.parentNode.replaceChild(frag, textNode);
    });
}

function flashMessageElement(el, query) {
    if (!el) return;
    clearMessageTextHighlights();
    el.classList.add('syllentras-msg-flash');
    if (query) {
        highlightTextNodeMatches(el, query);
    }
    messageFlashTimer = setTimeout(function () {
        el.classList.remove('syllentras-msg-flash');
        messageFlashTimer = null;
    }, 2400);
    messageMarkFadeTimer = setTimeout(function () {
        Array.from(el.querySelectorAll('mark.syllentras-search-mark')).forEach(function (mark) {
            mark.classList.add('is-fading');
        });
        setTimeout(function () {
            Array.from(el.querySelectorAll('mark.syllentras-search-mark')).forEach(function (mark) {
                var parent = mark.parentNode;
                if (!parent) return;
                parent.replaceChild(document.createTextNode(mark.textContent), mark);
                parent.normalize();
            });
            messageMarkFadeTimer = null;
        }, 900);
    }, 1800);
}

function scrollMessageIntoView(el) {
    if (!el || !msgs) return;
    // Scroll the messages pane itself. scrollIntoView can move the wrong
    // parent in this layout and leave you stuck where you already were.
    var containerTop = msgs.getBoundingClientRect().top;
    var elTop = el.getBoundingClientRect().top;
    var delta = elTop - containerTop - (msgs.clientHeight / 2 - el.offsetHeight / 2);
    var nextTop = Math.max(0, msgs.scrollTop + delta);
    if (typeof msgs.scrollTo === 'function') {
        msgs.scrollTo({ top: nextTop, behavior: 'smooth' });
    } else {
        msgs.scrollTop = nextTop;
    }
}

function focusMessageById(messageId, query) {
    var el = findMessageElement(messageId);
    if (!el) return Promise.resolve(null);
    scrollMessageIntoView(el);
    flashMessageElement(el, query);
    return Promise.resolve(el);
}

// Shared jump used by Find (Ctrl/Cmd+F) and sidebar search hits.
// If the match is older than the page we have loaded, keep pulling older
// pages until it shows up (or we run out of history).
function navigateToSearchMessage(messageId, query) {
    if (!messageId) return Promise.resolve(null);
    return ensureMessageVisible(messageId, query || '');
}

function ensureMessageVisible(messageId, query) {
    var existing = findMessageElement(messageId);
    if (existing) {
        return focusMessageById(messageId, query);
    }

    function pullOlder() {
        if (!hasMore) {
            return Promise.resolve(null);
        }
        return loadOlderMessages().then(function (loaded) {
            if (findMessageElement(messageId)) {
                return focusMessageById(messageId, query);
            }
            if (!loaded) {
                return null;
            }
            return pullOlder();
        });
    }

    return pullOlder();
}

// ===== conversations.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function setActiveConversation(conversation, options) {
    options = options || {};
    activeConversation = conversation;
    if (activeConversation && Array.isArray(conversation.topicSuggestions)) {
        activeConversation.topicSuggestions = conversation.topicSuggestions;
    }
    conversationId = conversation.id;
    activeTitle.textContent = displayConversationTitle(conversation);
    activeTag.textContent = displayConversationTag(conversation);
    if (typeof closeMessageSearch === 'function') {
        closeMessageSearch();
    }
    clearMessages();
    hasMore = false;
    loadingHistory = false;
    updateActiveConversationButtons();
    return loadCurrentHistory(options);
}

function loadCurrentHistory(options) {
    options = options || {};
    if (!conversationId || loadingHistory) return Promise.resolve();
    loadingHistory = true;

    return fetchJson('/conversations/' + encodeURIComponent(conversationId)
        + '/messages?moodleUserId=' + encodeURIComponent(moodleUserId)
        + '&limit=' + PAGE_SIZE)
    .then(function (page) {
        if (page.messages && page.messages.length) {
            renderMessageBatch(page.messages, false);
            hasMore = !!page.hasMore;
            // Skip jumping to the bottom when a search hit is about to scroll us elsewhere.
            if (!options.deferScroll) {
                scrollToBottom();
            }
        }
        return loadPendingActionForConversation().then(loadReviewOfferForConversation);
    })
    .catch(function () {
        appendMessage('error', 'Could not load chat history.', { scroll: false });
    })
    .finally(function () {
        loadingHistory = false;
    });
}

var loadOlderMessagesInFlight = null;

function loadOlderMessages() {
    // Reuse the same request if scroll-up and find-in-chat both ask at once.
    if (loadOlderMessagesInFlight) {
        return loadOlderMessagesInFlight;
    }
    if (!hasMore || !conversationId) {
        return Promise.resolve(false);
    }

    var before = getOldestMessageCreatedAt();
    if (!before) {
        return Promise.resolve(false);
    }

    loadingOlder = true;
    loadMore.hidden = false;

    var prevScrollHeight = msgs.scrollHeight;
    loadOlderMessagesInFlight = fetchJson('/conversations/' + encodeURIComponent(conversationId)
        + '/messages?moodleUserId=' + encodeURIComponent(moodleUserId)
        + '&limit=' + PAGE_SIZE
        + '&before=' + encodeURIComponent(before))
    .then(function (page) {
        if (page.messages && page.messages.length) {
            renderMessageBatch(page.messages, true);
            hasMore = !!page.hasMore;
            msgs.scrollTop = msgs.scrollHeight - prevScrollHeight;
            return true;
        }
        hasMore = false;
        return false;
    })
    .catch(function () {
        hasMore = false;
        return false;
    })
    .finally(function () {
        loadingOlder = false;
        loadMore.hidden = true;
        loadOlderMessagesInFlight = null;
    });

    return loadOlderMessagesInFlight;
}

function openConversation(options) {
    showPanel();
    return fetchJson('/conversations/open', {
        method: 'POST',
        body: JSON.stringify(Object.assign({
            courseId: courseId,
            moodleUserId: moodleUserId
        }, options))
    })
    .then(function (conversation) {
        return setActiveConversation(conversation).then(function () {
            return loadConversations();
        });
    })
    .then(function () {
        input.focus();
    })
    .catch(function () {
        appendMessage('error', 'Could not open the conversation.', { scroll: false });
    });
}

function openConversationById(id, options) {
    options = options || {};
    var focusMessageId = options.messageId || null;
    var focusQuery = options.query || '';
    showPanel();

    // Already on this chat? Just reuse the Find jump helper.
    if (conversationId === id && focusMessageId) {
        return navigateToSearchMessage(focusMessageId, focusQuery);
    }

    return fetchJson('/conversations/' + encodeURIComponent(id)
        + '?moodleUserId=' + encodeURIComponent(moodleUserId))
    .then(function (conversation) {
        return setActiveConversation(conversation, {
            deferScroll: !!focusMessageId
        });
    })
    .then(function () {
        if (focusMessageId) {
            return navigateToSearchMessage(focusMessageId, focusQuery);
        }
        input.focus();
    });
}

function loadConversations() {
    return fetchJson('/conversations?moodleUserId=' + encodeURIComponent(moodleUserId)
        + '&courseId=' + encodeURIComponent(courseId))
    .then(renderConversationList)
    .catch(function () {
        conversationsEl.textContent = 'Could not load conversations.';
    });
}

function renderConversationList(conversations) {
    conversationsEl.innerHTML = '';
    var pinned = conversations.filter(function (c) { return c.pinned && c.type !== 'general'; });
    renderConversationGroup(generalConversationGroupTitle(), conversations.filter(function (c) { return c.type === 'general'; }));
    if (pinned.length) renderConversationGroup('Pinned', pinned);
    renderConversationGroup('Course Sections', conversations.filter(function (c) { return !c.pinned && c.type === 'section'; }));
    renderConversationGroup('Other Conversations', conversations.filter(function (c) { return !c.pinned && c.type === 'manual'; }));
    updateActiveConversationButtons();
}

function renderConversationGroup(label, conversations) {
    if (!conversations.length) return;
    var heading = document.createElement('div');
    heading.className = 'syllentras-conversation-group-title';
    heading.textContent = label;
    conversationsEl.appendChild(heading);
    conversations.forEach(renderConversationItem);
}

function renderConversationItem(conversation) {
    var item = document.createElement('div');
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.className = 'syllentras-conversation-item';
    item.dataset.conversationId = conversation.id;
    item.innerHTML =
        '<span class="syllentras-conversation-name"></span>' +
        '<span class="syllentras-conversation-tag"></span>' +
        '<button type="button" class="syllentras-conversation-menu-btn" aria-label="Conversation menu" aria-haspopup="menu">&#8942;</button>';
    var nameEl = item.querySelector('.syllentras-conversation-name');
    nameEl.textContent = displayConversationTitle(conversation);
    nameEl.classList.toggle('pinned', !!conversation.pinned);
    item.querySelector('.syllentras-conversation-tag').textContent = displayConversationTag(conversation);
    item.addEventListener('click', function () {
        openConversationById(conversation.id);
    });
    item.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openConversationById(conversation.id);
        }
    });
    item.querySelector('.syllentras-conversation-menu-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        showConversationMenu(e.currentTarget, conversation);
    });
    conversationsEl.appendChild(item);
}

function renderSearchResultItem(conversation, matchedMessage) {
    var item = document.createElement('div');
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.className = 'syllentras-conversation-item is-search-result';
    item.dataset.conversationId = conversation.id;
    if (matchedMessage && matchedMessage.id) {
        item.dataset.messageId = matchedMessage.id;
    }

    var nameEl = document.createElement('span');
    nameEl.className = 'syllentras-conversation-name';
    nameEl.textContent = displayConversationTitle(conversation);
    nameEl.classList.toggle('pinned', !!conversation.pinned);
    item.appendChild(nameEl);

    if (matchedMessage && matchedMessage.id) {
        var meta = document.createElement('span');
        meta.className = 'syllentras-conversation-search-meta';
        var roleLabel = matchedMessage.role === 'assistant' ? 'Assistant' : 'You';
        var when = matchedMessage.createdAt
            ? new Date(matchedMessage.createdAt).toLocaleString()
            : '';
        meta.textContent = when ? roleLabel + ' · ' + when : roleLabel;
        item.appendChild(meta);

        if (matchedMessage.content) {
            var match = document.createElement('span');
            match.className = 'syllentras-conversation-match';
            match.textContent = stripMarkdown(matchedMessage.content).slice(0, 120);
            item.appendChild(match);
        }
    } else {
        var tag = document.createElement('span');
        tag.className = 'syllentras-conversation-tag';
        tag.textContent = displayConversationTag(conversation);
        item.appendChild(tag);
    }

    item.addEventListener('click', function () {
        openConversationFromSearch(conversation, matchedMessage);
    });
    item.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openConversationFromSearch(conversation, matchedMessage);
        }
    });
    conversationsEl.appendChild(item);
}

function ensureNewConversationPrompt() {
    var existing = document.getElementById('syllentras-chat-new-prompt');
    if (existing) return existing;

    var prompt = document.createElement('div');
    prompt.id = 'syllentras-chat-new-prompt';
    prompt.hidden = true;
    prompt.setAttribute('role', 'dialog');
    prompt.setAttribute('aria-label', 'Name new conversation');
    prompt.innerHTML =
        '<label for="syllentras-chat-new-name">Name this conversation</label>' +
        '<input id="syllentras-chat-new-name" type="text" autocomplete="off" maxlength="120">' +
        '<div id="syllentras-chat-new-error" hidden>Please enter a conversation name.</div>' +
        '<div class="syllentras-confirm-actions">' +
        '<button type="button" class="syllentras-new-create">Create</button>' +
        '<button type="button" class="syllentras-new-cancel">Cancel</button>' +
        '</div>';
    document.getElementById('syllentras-chat-main').insertBefore(prompt, document.getElementById('syllentras-chat-active-meta'));

    prompt.querySelector('.syllentras-new-create').addEventListener('click', confirmNewConversation);
    prompt.querySelector('.syllentras-new-cancel').addEventListener('click', cancelNewConversation);
    prompt.querySelector('#syllentras-chat-new-name').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            confirmNewConversation();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelNewConversation();
        }
    });

    return prompt;
}

function showNewConversationPrompt() {
    showPanel();
    cancelDeleteConversation();

    var prompt = ensureNewConversationPrompt();
    var nameInput = prompt.querySelector('#syllentras-chat-new-name');
    var error = prompt.querySelector('#syllentras-chat-new-error');
    error.textContent = 'Please enter a conversation name.';
    error.hidden = true;
    nameInput.value = '';
    prompt.hidden = false;
    nameInput.focus();
}

function cancelNewConversation() {
    var prompt = ensureNewConversationPrompt();
    prompt.hidden = true;
}

function confirmNewConversation() {
    var prompt = ensureNewConversationPrompt();
    var nameInput = prompt.querySelector('#syllentras-chat-new-name');
    var error = prompt.querySelector('#syllentras-chat-new-error');
    var title = nameInput.value.trim();

    if (!title) {
        error.hidden = false;
        nameInput.focus();
        return;
    }

    prompt.querySelector('.syllentras-new-create').disabled = true;
    createManualConversation(title)
        .catch(function () {
            error.textContent = 'Could not create the conversation. Please try again.';
            error.hidden = false;
        })
        .finally(function () {
            prompt.querySelector('.syllentras-new-create').disabled = false;
        });
}

function openConversationFromSearch(conversation, matchedMessage) {
    var query = (searchInput && searchInput.value ? searchInput.value : '').trim();
    if (matchedMessage && matchedMessage.id) {
        // Same navigateToSearchMessage path as the Find panel / Ctrl+F.
        return openConversationById(conversation.id, {
            messageId: matchedMessage.id,
            query: query
        });
    }
    return openConversationById(conversation.id);
}

function searchConversations(query) {
    if (!query.trim()) {
        loadConversations();
        return;
    }

    fetchJson('/conversations/search?moodleUserId=' + encodeURIComponent(moodleUserId)
        + '&courseId=' + encodeURIComponent(courseId)
        + '&q=' + encodeURIComponent(query.trim()))
    .then(function (results) {
        conversationsEl.innerHTML = '';
        var heading = document.createElement('div');
        heading.className = 'syllentras-conversation-group-title';
        heading.textContent = 'Search Results';
        conversationsEl.appendChild(heading);
        results.forEach(function (result) {
            renderSearchResultItem(result.conversation, result.matchedMessage);
        });
        if (!results.length) {
            conversationsEl.appendChild(document.createTextNode('No results found.'));
        }
        updateActiveConversationButtons();
    });
}

function createManualConversation(title) {
    return fetchJson('/conversations', {
        method: 'POST',
        body: JSON.stringify({
            courseId: courseId,
            moodleUserId: moodleUserId,
            type: 'manual',
            title: title
        })
    })
    .then(function (conversation) {
        cancelNewConversation();
        return setActiveConversation(conversation).then(loadConversations);
    });
}

function sendMessage() {
    var text = input.value.trim();
    if (!text || !conversationId) return;

    input.value = '';
    send.disabled = true;
    setGeneratingState(true);
    appendMessage('user', text);
    var loadingEl = appendMessage('assistant', '...');
    var pendingAssistantId = loadingEl.dataset.messageId || nextLocalMessageId();
    loadingEl.dataset.messageId = pendingAssistantId;

    var body = {
        courseId: courseId,
        courseName: courseName || undefined,
        moodleUserId: moodleUserId,
        userFirstName: userFirstName || undefined,
        message: text,
        conversationId: conversationId
    };
    // Selected provider rides along so mid-chat switches apply to the next turn.
    var providerId = typeof getSelectedProviderId === 'function' ? getSelectedProviderId() : null;
    if (providerId) {
        body.provider = providerId;
    }
    var modeId = typeof getSelectedModeId === 'function' ? getSelectedModeId() : 'direct';
    body.mode = modeId === 'coach' ? 'coach' : 'direct';
    if (body.mode === 'coach' && typeof getSelectedGuidance === 'function') {
        body.guidance = getSelectedGuidance();
    }

    fetchJson('/chat/message', {
        method: 'POST',
        body: JSON.stringify(body)
    })
    .then(function (data) {
        renderAssistantContent(loadingEl, data.response);
        applyModeChip(loadingEl, data.mode || body.mode);
        loadingEl.dataset.createdAt = new Date().toISOString();
        upsertMessageSearchEntry({
            id: pendingAssistantId,
            role: 'assistant',
            content: data.response,
            createdAt: loadingEl.dataset.createdAt
        });
        if (messageSearchOpen && msgSearchInput && msgSearchInput.value.trim()) {
            runMessageSearch(msgSearchInput.value);
        }
        conversationId = data.conversationId || conversationId;
        if (Array.isArray(data.topicSuggestions)) {
            if (!activeConversation) activeConversation = { id: conversationId };
            activeConversation.topicSuggestions = data.topicSuggestions;
        }
        if (data.pendingAction) {
            attachPendingAction(loadingEl, data.pendingAction);
        }
        return loadConversations();
    })
    .catch(function (err) {
        loadingEl.className = 'syllentras-msg error';
        loadingEl.textContent = (err && err.message)
            ? err.message
            : 'Something went wrong. Please try again.';
    })
    .finally(function () {
        send.disabled = false;
        setGeneratingState(false);
        input.focus();
    });
}

function updateActiveConversationButtons() {
    Array.from(conversationsEl.querySelectorAll('.syllentras-conversation-item')).forEach(function (item) {
        item.classList.toggle('active', item.dataset.conversationId === conversationId);
    });
}

function updateConversation(id, changes) {
    return fetchJson('/conversations/' + encodeURIComponent(id)
        + '?moodleUserId=' + encodeURIComponent(moodleUserId), {
        method: 'PATCH',
        body: JSON.stringify(changes)
    });
}


// ===== message-search-ui.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.
//
// Find-in-chat UI: the little search bar above the messages, result list, and
// keyboard bits. Talks to message-search.js for matches and messages.js to jump.

function isMessageSearchUiReady() {
    return !!(msgSearchPanel && msgSearchInput && msgSearchResults);
}

function openMessageSearch() {
    if (!isMessageSearchUiReady()) return;
    messageSearchOpen = true;
    msgSearchPanel.hidden = false;
    if (msgSearchToggle) {
        msgSearchToggle.setAttribute('aria-expanded', 'true');
    }
    msgSearchInput.focus();
    msgSearchInput.select();
    if (msgSearchInput.value.trim()) {
        runMessageSearch(msgSearchInput.value);
    } else {
        renderMessageSearchResults([]);
        updateMessageSearchCount();
    }
}

function closeMessageSearch() {
    if (!isMessageSearchUiReady()) return;
    messageSearchOpen = false;
    clearMessageSearchSchedule();
    msgSearchPanel.hidden = true;
    if (msgSearchToggle) {
        msgSearchToggle.setAttribute('aria-expanded', 'false');
    }
    setMessageSearchResults([], '');
    renderMessageSearchResults([]);
    updateMessageSearchCount();
    clearMessageTextHighlights();
}

function toggleMessageSearch() {
    if (messageSearchOpen) {
        closeMessageSearch();
    } else {
        openMessageSearch();
    }
}

function updateMessageSearchCount() {
    if (!msgSearchCount) return;
    var total = messageSearchResults.length;
    if (!messageSearchQuery) {
        msgSearchCount.textContent = '';
        return;
    }
    if (!total) {
        msgSearchCount.textContent = '0 matches';
        return;
    }
    msgSearchCount.textContent = (messageSearchActiveIndex + 1) + ' / ' + total;
}

function renderMessageSearchResults(results) {
    if (!msgSearchResults) return;
    msgSearchResults.innerHTML = '';
    if (!results.length) {
        if (messageSearchQuery) {
            var empty = document.createElement('div');
            empty.className = 'syllentras-msg-search-empty';
            empty.textContent = 'No matches in this conversation';
            msgSearchResults.appendChild(empty);
        }
        return;
    }

    results.forEach(function (result, index) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'syllentras-msg-search-result';
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', index === messageSearchActiveIndex ? 'true' : 'false');
        btn.dataset.resultIndex = String(index);
        if (index === messageSearchActiveIndex) {
            btn.classList.add('is-active');
        }

        var meta = document.createElement('span');
        meta.className = 'syllentras-msg-search-result-meta';
        meta.textContent = (result.role === 'assistant' ? 'Assistant' : 'You')
            + (result.matchCount > 1 ? ' · ' + result.matchCount + ' matches' : '');

        var preview = document.createElement('span');
        preview.className = 'syllentras-msg-search-result-preview';
        preview.innerHTML = result.previewHtml;

        btn.appendChild(meta);
        btn.appendChild(preview);
        btn.addEventListener('click', function () {
            messageSearchActiveIndex = index;
            renderMessageSearchResults(messageSearchResults);
            updateMessageSearchCount();
            openMessageSearchResult(result);
        });
        msgSearchResults.appendChild(btn);
    });

    var active = msgSearchResults.querySelector('.syllentras-msg-search-result.is-active');
    if (active && typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'nearest' });
    }
}

function runMessageSearch(rawQuery) {
    scheduleMessageSearch(rawQuery, function (results) {
        renderMessageSearchResults(results);
        updateMessageSearchCount();
    });
}

function openMessageSearchResult(result) {
    if (!result) return Promise.resolve(null);
    // Same jump path as sidebar search hits / keyboard Enter.
    return navigateToSearchMessage(result.id, messageSearchQuery);
}

function openActiveMessageSearchResult() {
    return openMessageSearchResult(getActiveMessageSearchResult());
}

function stepMessageSearch(delta) {
    var result = moveMessageSearchSelection(delta);
    renderMessageSearchResults(messageSearchResults);
    updateMessageSearchCount();
    if (result) {
        openMessageSearchResult(result);
    }
}

function onMessageSearchInput() {
    runMessageSearch(msgSearchInput.value);
}

function onMessageSearchKeydown(e) {
    if (!messageSearchOpen) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        closeMessageSearch();
        if (input) input.focus();
        return;
    }
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        stepMessageSearch(1);
        return;
    }
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        stepMessageSearch(-1);
        return;
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        openActiveMessageSearchResult();
    }
}

function bindMessageSearchUi() {
    if (!isMessageSearchUiReady()) return;

    if (msgSearchToggle) {
        msgSearchToggle.addEventListener('click', function () {
            toggleMessageSearch();
        });
    }
    if (msgSearchClose) {
        msgSearchClose.addEventListener('click', function () {
            closeMessageSearch();
            if (input) input.focus();
        });
    }
    if (msgSearchPrev) {
        msgSearchPrev.addEventListener('click', function () {
            stepMessageSearch(-1);
        });
    }
    if (msgSearchNext) {
        msgSearchNext.addEventListener('click', function () {
            stepMessageSearch(1);
        });
    }
    msgSearchInput.addEventListener('input', onMessageSearchInput);
    msgSearchInput.addEventListener('keydown', onMessageSearchKeydown);

    // Ctrl/Cmd+F while the chat panel is open jumps to find-in-conversation.
    document.addEventListener('keydown', function (e) {
        if (!panel || panel.hidden) return;
        var key = (e.key || '').toLowerCase();
        if (key === 'f' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            openMessageSearch();
        }
    });
}

// ===== modals.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function closeConversationMenu() {
    if (openMenu) {
        openMenu.remove();
        openMenu = null;
    }
    Array.from(conversationsEl.querySelectorAll('.syllentras-conversation-menu-btn.open')).forEach(function (btn) {
        btn.classList.remove('open');
    });
}

function showConversationMenu(anchor, conversation) {
    closeToolsMenu();
    closeConversationMenu();
    anchor.classList.add('open');

    var menu = document.createElement('div');
    menu.className = 'syllentras-conversation-menu';
    menu.setAttribute('role', 'menu');
    addMenuAction(menu, 'Rename', function () { showRenameModal(conversation); }, conversation.type !== 'manual');
    addMenuAction(menu, conversation.pinned ? 'Unpin' : 'Pin', function () { togglePinConversation(conversation); }, conversation.type === 'general');
    addMenuAction(menu, 'Export', function () { showExportModal(conversation); });
    addMenuAction(menu, 'Delete', function () { deleteConversation(conversation); }, false, true);
    document.body.appendChild(menu);

    var rect = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, rect.right - 124) + 'px';
    menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4) + 'px';
    openMenu = menu;
}

function addMenuAction(menu, label, handler, disabled, danger) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'syllentras-menu-action' + (danger ? ' danger' : '');
    button.textContent = label;
    button.disabled = !!disabled;
    button.addEventListener('click', function (e) {
        e.stopPropagation();
        closeConversationMenu();
        if (!button.disabled) handler();
    });
    menu.appendChild(button);
}

function showModal(title, bodyNode, actions) {
    closeConversationMenu();
    closeToolsMenu();
    modal.querySelector('#syllentras-modal-title').textContent = title;
    var body = modal.querySelector('#syllentras-modal-body');
    var actionArea = modal.querySelector('#syllentras-modal-actions');
    body.innerHTML = '';
    actionArea.innerHTML = '';
    if (typeof bodyNode === 'string') {
        body.textContent = bodyNode;
    } else {
        body.appendChild(bodyNode);
    }
    actions.forEach(function (action) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = action.className || 'syllentras-modal-secondary';
        button.textContent = action.label;
        button.addEventListener('click', action.onClick);
        actionArea.appendChild(button);
    });
    modal.hidden = false;
    var firstButton = actionArea.querySelector('button');
    if (firstButton) firstButton.focus();
}

function closeModal() {
    modal.hidden = true;
}

function deleteConversation(conversation) {
    pendingDeleteConversation = conversation;
    if (conversation.type === 'general') {
        var generalTitle = generalChatTitle();
        showModal(
            'Clear ' + generalTitle + ' history?',
            'Clear all messages in ' + generalTitle + '? The conversation will stay available. Course content will not be deleted.',
            [
                { label: 'Cancel', className: 'syllentras-modal-secondary', onClick: cancelDeleteConversation },
                { label: 'Clear', className: 'syllentras-modal-danger', onClick: confirmDeleteConversation }
            ]
        );
        return;
    }

    var title = conversation.title || 'this conversation';
    showModal(
        'Delete conversation',
        'Delete "' + title + '" and its history? Course content will not be deleted.',
        [
            { label: 'Cancel', className: 'syllentras-modal-secondary', onClick: cancelDeleteConversation },
            { label: 'Delete', className: 'syllentras-modal-danger', onClick: confirmDeleteConversation }
        ]
    );
}

function cancelDeleteConversation() {
    pendingDeleteConversation = null;
    closeModal();
}

function confirmDeleteConversation() {
    if (!pendingDeleteConversation) return;

    var conversation = pendingDeleteConversation;
    cancelDeleteConversation();

    fetchJson('/conversations/' + encodeURIComponent(conversation.id)
        + '?moodleUserId=' + encodeURIComponent(moodleUserId), { method: 'DELETE' })
    .then(function (result) {
        if (result && result.cleared) {
            if (conversation.id === conversationId) {
                clearMessages();
                if (result.conversation) {
                    activeConversation = result.conversation;
                }
            }
            return loadConversations();
        }

        if (conversation.id === conversationId) {
            clearMessages();
            conversationId = null;
            activeConversation = null;
            return openConversation({ type: 'general', title: generalChatTitle() });
        }
        return loadConversations();
    });
}

function showRenameModal(conversation) {
    var wrapper = document.createElement('div');
    wrapper.textContent = 'Enter a new name for this conversation.';
    var inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.maxLength = 120;
    inputEl.value = conversation.title || '';
    var error = document.createElement('div');
    error.className = 'syllentras-modal-error';
    error.hidden = true;
    wrapper.appendChild(inputEl);
    wrapper.appendChild(error);

    showModal('Rename conversation', wrapper, [
        { label: 'Cancel', className: 'syllentras-modal-secondary', onClick: closeModal },
        {
            label: 'Rename',
            className: 'syllentras-modal-primary',
            onClick: function () {
                var title = inputEl.value.trim();
                if (!title) {
                    error.textContent = 'Please enter a conversation name.';
                    error.hidden = false;
                    inputEl.focus();
                    return;
                }
                updateConversation(conversation.id, { title: title })
                    .then(function (updated) {
                        closeModal();
                        if (conversation.id === conversationId) setActiveConversation(updated);
                        return loadConversations();
                    })
                    .catch(function () {
                        error.textContent = 'Could not rename this conversation.';
                        error.hidden = false;
                    });
            }
        }
    ]);
    inputEl.focus();
    inputEl.select();
}

function togglePinConversation(conversation) {
    updateConversation(conversation.id, { pinned: !conversation.pinned })
        .then(function (updated) {
            if (conversation.id === conversationId) activeConversation = updated;
            return loadConversations();
        })
        .catch(function () {
            showModal('Pin conversation', 'Could not update the pinned state. Please refresh the page and try again.', [
                { label: 'Close', className: 'syllentras-modal-secondary', onClick: closeModal }
            ]);
        });
}

function showExportModal(conversation) {
    fetchConversationMessages(conversation.id)
        .then(function (messages) {
            var exportText = formatConversationExport(conversation, messages);
            var wrapper = document.createElement('div');
            wrapper.textContent = 'Copy or download this conversation.';
            var textArea = document.createElement('textarea');
            textArea.readOnly = true;
            textArea.value = exportText;
            wrapper.appendChild(textArea);

            showModal('Export conversation', wrapper, [
                { label: 'Close', className: 'syllentras-modal-secondary', onClick: closeModal },
                {
                    label: 'Copy',
                    className: 'syllentras-modal-primary',
                    onClick: function () {
                        copyText(exportText);
                    }
                },
                {
                    label: 'Download',
                    className: 'syllentras-modal-primary',
                    onClick: function () {
                        downloadText(safeFileName(conversation.title || 'conversation') + '.txt', exportText);
                    }
                }
            ]);
            textArea.focus();
            textArea.select();
        })
        .catch(function () {
            showModal('Export conversation', 'Could not load this conversation for export.', [
                { label: 'Close', className: 'syllentras-modal-secondary', onClick: closeModal }
            ]);
        });
}

function fetchConversationMessages(id) {
    var all = [];
    function loadPage(before) {
        var path = '/conversations/' + encodeURIComponent(id)
            + '/messages?moodleUserId=' + encodeURIComponent(moodleUserId)
            + '&limit=100';
        if (before) path += '&before=' + encodeURIComponent(before);
        return fetchJson(path).then(function (page) {
            var messages = page.messages || [];
            all = messages.concat(all);
            if (page.hasMore && messages.length) {
                return loadPage(messages[0].createdAt);
            }
            return all;
        });
    }
    return loadPage();
}

function formatConversationExport(conversation, messages) {
    var lines = [
        displayConversationTitle(conversation),
        displayConversationTag(conversation),
        courseName ? 'Course: ' + courseName : '',
        'Exported: ' + new Date().toLocaleString(),
        ''
    ].filter(function (line, index) { return index < 4 ? line !== '' : true; });

    messages.forEach(function (message) {
        var role = message.role === 'assistant' ? 'Assistant' : 'User';
        var date = message.createdAt ? new Date(message.createdAt).toLocaleString() : '';
        lines.push('[' + role + (date ? ' - ' + date : '') + ']');
        lines.push(message.content || '');
        lines.push('');
    });

    return lines.join('\n').trim() + '\n';
}

function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return;
    }

    var temp = document.createElement('textarea');
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    temp.remove();
}

function downloadText(filename, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    URL.revokeObjectURL(link.href);
    link.remove();
}

function safeFileName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'conversation';
}


// ===== tools-menu.js =====
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

// ===== section-buttons.js =====
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


// ===== ai-content-panel.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var activeChatTab = 'chat';
var aiContentList = null;
var aiContentEmptyEl = null;
var aiContentToolbar = null;
var aiContentOpenMenu = null;
var tabChatBtn = document.getElementById('syllentras-tab-chat');
var tabAiContentBtn = document.getElementById('syllentras-tab-ai-content');
var panelChat = document.getElementById('syllentras-panel-chat');
var panelAiContent = document.getElementById('syllentras-panel-ai-content');

var aiContentItems = [];
var aiContentSortKey = 'course';
var aiContentSortDir = 'asc';
var aiContentFilterKinds = {};
var aiContentBulkMode = false;
var aiContentSelected = {};
var aiContentToolbarBound = false;

var SORT_LABELS = {
    course: 'Course order',
    modified: 'Recently modified',
    alpha: 'Alphabetical'
};
var SORT_DEFAULT_DIR = {
    course: 'asc',
    modified: 'desc',
    alpha: 'asc'
};

function kindBadgeLabel(kind) {
    if (kind === 'flashcards') return 'Flashcards';
    if (kind === 'practice_quiz') return 'Quiz';
    return 'Guide';
}

function isAiContentTabActive() {
    return activeChatTab === 'ai-content';
}

function bindAiContentDom() {
    if (!panelAiContent) return;
    aiContentList = panelAiContent.querySelector('#syllentras-ai-content-list') ||
        panelAiContent.querySelector('.syllentras-ai-content-list');
    aiContentEmptyEl = panelAiContent.querySelector('.syllentras-ai-content-empty');
    aiContentToolbar = panelAiContent.querySelector('#syllentras-ai-content-toolbar');
    if (!aiContentToolbarBound && aiContentToolbar) {
        bindAiContentToolbar();
        aiContentToolbarBound = true;
    }
}

function setChatTab(tab) {
    if (tab !== 'chat' && tab !== 'ai-content') {
        tab = 'chat';
    }
    activeChatTab = tab;

    var chatSelected = tab === 'chat';
    if (tabChatBtn) {
        tabChatBtn.setAttribute('aria-selected', chatSelected ? 'true' : 'false');
        tabChatBtn.tabIndex = chatSelected ? 0 : -1;
    }
    if (tabAiContentBtn) {
        tabAiContentBtn.setAttribute('aria-selected', chatSelected ? 'false' : 'true');
        tabAiContentBtn.tabIndex = chatSelected ? -1 : 0;
    }
    if (panelChat) {
        panelChat.hidden = !chatSelected;
    }
    if (panelAiContent) {
        panelAiContent.hidden = chatSelected;
    }

    closeAiContentMenu();
    closeAiContentDropdowns();
    closeConversationMenu();
    closeToolsMenu();

    if (!chatSelected) {
        refreshAiContentList();
    }
}

function closeAiContentMenu() {
    if (aiContentOpenMenu) {
        aiContentOpenMenu.remove();
        aiContentOpenMenu = null;
    }
    if (aiContentList) {
        Array.from(aiContentList.querySelectorAll('.syllentras-ai-content-menu-btn.open')).forEach(function (btn) {
            btn.classList.remove('open');
        });
    }
}

function closeAiContentDropdowns() {
    if (!aiContentToolbar) return;
    Array.from(aiContentToolbar.querySelectorAll('.syllentras-ai-content-dd-panel')).forEach(function (panel) {
        panel.hidden = true;
    });
    Array.from(aiContentToolbar.querySelectorAll('.syllentras-ai-content-dd-btn')).forEach(function (btn) {
        btn.setAttribute('aria-expanded', 'false');
    });
}

function selectedKindCount() {
    return Object.keys(aiContentFilterKinds).filter(function (k) {
        return aiContentFilterKinds[k];
    }).length;
}

function selectedCmCount() {
    return Object.keys(aiContentSelected).filter(function (id) {
        return aiContentSelected[id];
    }).length;
}

function getVisibleAiContentItems() {
    var filtered = aiContentItems.filter(function (item) {
        if (selectedKindCount() === 0) return true;
        return !!aiContentFilterKinds[item.kind];
    });

    var dir = aiContentSortDir === 'desc' ? -1 : 1;
    filtered.sort(function (a, b) {
        var cmp = 0;
        if (aiContentSortKey === 'modified') {
            cmp = (a.timeModified || 0) - (b.timeModified || 0);
            if (cmp === 0) cmp = (a.sortOrder || 0) - (b.sortOrder || 0);
        } else if (aiContentSortKey === 'alpha') {
            cmp = String(a.name || '').localeCompare(String(b.name || ''), undefined, {
                sensitivity: 'base'
            });
            if (cmp === 0) cmp = (a.sortOrder || 0) - (b.sortOrder || 0);
        } else {
            cmp = (a.sortOrder || 0) - (b.sortOrder || 0);
        }
        if (cmp === 0) cmp = (a.cmId || 0) - (b.cmId || 0);
        return cmp * dir;
    });
    return filtered;
}

function updateAiContentToolbarChrome() {
    if (!aiContentToolbar) return;

    var sortBtn = aiContentToolbar.querySelector('#syllentras-ai-sort-btn');
    var filterBtn = aiContentToolbar.querySelector('#syllentras-ai-filter-btn');
    var bulkToggle = aiContentToolbar.querySelector('#syllentras-ai-bulk-toggle');
    var bulkRow = aiContentToolbar.querySelector('#syllentras-ai-bulk-row');
    var bulkDelete = aiContentToolbar.querySelector('#syllentras-ai-bulk-delete');
    var arrow = aiContentSortDir === 'desc' ? '↓' : '↑';

    if (sortBtn) {
        sortBtn.innerHTML =
            'Sort: ' +
            (SORT_LABELS[aiContentSortKey] || 'Course order') +
            ' <span class="syllentras-ai-content-sort-arrow" aria-hidden="true">' +
            arrow +
            '</span>';
    }

    Array.from(aiContentToolbar.querySelectorAll('.syllentras-ai-content-dd-option[data-sort]')).forEach(
        function (opt) {
            var key = opt.getAttribute('data-sort');
            var active = key === aiContentSortKey;
            opt.classList.toggle('is-active', active);
            var existing = opt.querySelector('.syllentras-ai-content-sort-arrow');
            if (active) {
                if (!existing) {
                    existing = document.createElement('span');
                    existing.className = 'syllentras-ai-content-sort-arrow';
                    existing.setAttribute('aria-hidden', 'true');
                    opt.appendChild(existing);
                }
                existing.textContent = arrow;
            } else if (existing) {
                existing.remove();
            }
        }
    );

    if (filterBtn) {
        var n = selectedKindCount();
        if (n === 0) {
            filterBtn.textContent = 'Type: All';
        } else if (n === 1) {
            var only = Object.keys(aiContentFilterKinds).find(function (k) {
                return aiContentFilterKinds[k];
            });
            filterBtn.textContent =
                'Type: ' +
                (only === 'flashcards'
                    ? 'Flashcards'
                    : only === 'practice_quiz'
                      ? 'Quiz'
                      : 'Study guide');
        } else {
            filterBtn.textContent = 'Type: ' + n + ' selected';
        }
    }

    if (bulkToggle) {
        bulkToggle.textContent = aiContentBulkMode ? 'Done' : 'Select';
    }
    if (bulkRow) {
        bulkRow.hidden = !aiContentBulkMode;
    }
    if (bulkDelete) {
        bulkDelete.disabled = selectedCmCount() < 1;
        bulkDelete.textContent =
            selectedCmCount() > 0 ? 'Delete (' + selectedCmCount() + ')' : 'Delete';
    }
}

function renderAiContentList() {
    if (!aiContentList || !aiContentEmptyEl) return;

    closeAiContentMenu();
    var visible = getVisibleAiContentItems();
    aiContentList.innerHTML = '';

    if (!aiContentItems.length) {
        if (aiContentToolbar) aiContentToolbar.hidden = true;
        aiContentEmptyEl.hidden = false;
        aiContentEmptyEl.textContent = 'No AI Content yet in this course.';
        updateAiContentToolbarChrome();
        return;
    }

    if (aiContentToolbar) aiContentToolbar.hidden = false;

    if (!visible.length) {
        aiContentEmptyEl.hidden = false;
        aiContentEmptyEl.textContent = 'No items match the selected type filter.';
        updateAiContentToolbarChrome();
        return;
    }

    aiContentEmptyEl.hidden = true;
    visible.forEach(function (item) {
        aiContentList.appendChild(renderAiContentRow(item));
    });
    updateAiContentToolbarChrome();
}

function refreshAiContentList() {
    bindAiContentDom();
    if (!aiContentList || !aiContentEmptyEl) return;

    aiContentSelected = {};
    aiContentBulkMode = false;
    closeAiContentDropdowns();

    if (courseId <= 1) {
        aiContentItems = [];
        aiContentList.innerHTML = '';
        if (aiContentToolbar) aiContentToolbar.hidden = true;
        aiContentEmptyEl.hidden = false;
        aiContentEmptyEl.textContent = 'Open a course page to manage your AI Content.';
        updateAiContentToolbarChrome();
        return;
    }

    aiContentList.innerHTML = '<p class="syllentras-ai-content-loading">Loading…</p>';
    aiContentEmptyEl.hidden = true;
    if (aiContentToolbar) aiContentToolbar.hidden = true;

    fetchJson(
        '/ai-content?courseId=' + encodeURIComponent(courseId) +
        '&moodleUserId=' + encodeURIComponent(moodleUserId)
    )
        .then(function (data) {
            aiContentItems = ((data && data.items) || []).map(function (item, index) {
                return {
                    cmId: item.cmId,
                    modname: item.modname,
                    name: item.name,
                    kind: item.kind,
                    viewUrl: item.viewUrl,
                    sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index,
                    timeModified: typeof item.timeModified === 'number' ? item.timeModified : 0
                };
            });
            renderAiContentList();
        })
        .catch(function () {
            aiContentItems = [];
            aiContentList.innerHTML = '';
            if (aiContentToolbar) aiContentToolbar.hidden = true;
            aiContentEmptyEl.hidden = false;
            aiContentEmptyEl.textContent = 'Could not load AI Content. Try again.';
            updateAiContentToolbarChrome();
        });
}

function renderAiContentRow(item) {
    var row = document.createElement('div');
    row.className = 'syllentras-ai-content-item' + (aiContentBulkMode ? ' is-bulk' : '');
    row.setAttribute('data-cmid', String(item.cmId));

    if (aiContentBulkMode) {
        var checkWrap = document.createElement('label');
        checkWrap.className = 'syllentras-ai-content-item-check';
        var check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = !!aiContentSelected[item.cmId];
        check.setAttribute('aria-label', 'Select ' + (item.name || 'item'));
        check.addEventListener('change', function () {
            if (check.checked) {
                aiContentSelected[item.cmId] = true;
            } else {
                delete aiContentSelected[item.cmId];
            }
            updateAiContentToolbarChrome();
        });
        checkWrap.appendChild(check);
        row.appendChild(checkWrap);
    }

    var main = document.createElement('div');
    main.className = 'syllentras-ai-content-item-main';
    var nameEl = document.createElement('a');
    nameEl.className = 'syllentras-ai-content-name';
    nameEl.textContent = item.name || 'Untitled';
    nameEl.href = item.viewUrl || '#';
    nameEl.target = '_blank';
    nameEl.rel = 'noopener noreferrer';
    var kindEl = document.createElement('span');
    kindEl.className = 'syllentras-ai-content-kind';
    kindEl.textContent = kindBadgeLabel(item.kind);
    main.appendChild(nameEl);
    main.appendChild(kindEl);
    row.appendChild(main);

    var menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'syllentras-ai-content-menu-btn';
    menuBtn.setAttribute('aria-label', 'Content menu');
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.innerHTML = '&#8942;';
    menuBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (aiContentBulkMode) return;
        showAiContentMenu(e.currentTarget, item);
    });
    row.appendChild(menuBtn);

    return row;
}

function showAiContentMenu(anchor, item) {
    closeConversationMenu();
    closeToolsMenu();
    closeAiContentMenu();
    closeAiContentDropdowns();
    anchor.classList.add('open');

    var menu = document.createElement('div');
    menu.className = 'syllentras-ai-content-menu';
    menu.setAttribute('role', 'menu');

    function addAction(label, handler, danger) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'syllentras-menu-action' + (danger ? ' danger' : '');
        button.textContent = label;
        button.addEventListener('click', function (e) {
            e.stopPropagation();
            closeAiContentMenu();
            handler();
        });
        menu.appendChild(button);
    }

    addAction('Open', function () {
        if (item.viewUrl) window.open(item.viewUrl, '_blank', 'noopener,noreferrer');
    });
    addAction('Download PDF', function () { downloadAiContentItemPdf(item); });
    addAction('Rename', function () { renameAiContentItem(item); });
    addAction('Delete', function () { deleteAiContentItem(item); }, true);

    document.body.appendChild(menu);
    var rect = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, rect.right - 140) + 'px';
    menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4) + 'px';
    aiContentOpenMenu = menu;
}

var aiContentPdfBusy = false;

function downloadAiContentItemPdf(item) {
    if (aiContentPdfBusy) return;
    if (
        !window.SyllentrasAiContentPdf ||
        typeof window.SyllentrasAiContentPdf.download !== 'function'
    ) {
        showModal('Download PDF', 'PDF export is unavailable on this page.', [
            { label: 'Close', className: 'syllentras-modal-secondary', onClick: closeModal }
        ]);
        return;
    }
    aiContentPdfBusy = true;

    showModal('Download PDF', 'Preparing PDF…', [
        { label: 'Close', className: 'syllentras-modal-secondary', onClick: closeModal }
    ]);

    window.SyllentrasAiContentPdf.download(item, {
        apiUrl: API_URL,
        courseId: courseId,
        moodleUserId: moodleUserId,
        courseName: courseName
    })
        .then(function () {
            closeModal();
        })
        .catch(function (err) {
            var detail = err && err.message ? String(err.message) : '';
            var message = detail
                ? 'Could not export this item. ' + detail
                : 'Could not export this item.';
            showModal('Download PDF', message, [
                { label: 'Close', className: 'syllentras-modal-secondary', onClick: closeModal }
            ]);
        })
        .then(function () {
            aiContentPdfBusy = false;
        });
}

function renameAiContentItem(item) {
    var wrap = document.createElement('div');
    var label = document.createElement('label');
    label.textContent = 'Title';
    var hint = document.createElement('p');
    hint.style.margin = '0 0 6px';
    hint.style.fontSize = '12px';
    hint.style.color = '#667788';
    hint.textContent = kindBadgeLabel(item.kind) + ' prefix is kept automatically.';
    var input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 200;
    input.value = String(item.name || '')
        .replace(/^(Study Guide|Flashcards|Quiz|Practice Quiz)\s*:\s*/i, '')
        .trim();
    wrap.appendChild(label);
    wrap.appendChild(hint);
    wrap.appendChild(input);

    showModal('Rename', wrap, [
        { label: 'Cancel', className: 'syllentras-modal-secondary', onClick: closeModal },
        {
            label: 'Save',
            className: 'syllentras-modal-primary',
            onClick: function () {
                var name = (input.value || '').trim();
                if (!name) return;
                closeModal();
                fetchJson('/ai-content/rename', {
                    method: 'POST',
                    body: JSON.stringify({
                        courseId: courseId,
                        moodleUserId: moodleUserId,
                        cmId: item.cmId,
                        name: name,
                        kind: item.kind || 'study_guide'
                    })
                })
                    .then(function () {
                        refreshAiContentList();
                    })
                    .catch(function () {
                        showModal('Rename', 'Could not rename this item.', [
                            { label: 'Close', className: 'syllentras-modal-secondary', onClick: closeModal }
                        ]);
                    });
            }
        }
    ]);
    setTimeout(function () { input.focus(); input.select(); }, 0);
}

function deleteAiContentItem(item) {
    showModal(
        'Delete this content?',
        'Delete "' + (item.name || 'this item') + '"? This cannot be undone.',
        [
            { label: 'Cancel', className: 'syllentras-modal-secondary', onClick: closeModal },
            {
                label: 'Delete',
                className: 'syllentras-modal-danger',
                onClick: function () {
                    closeModal();
                    fetchJson('/ai-content/delete', {
                        method: 'POST',
                        body: JSON.stringify({
                            courseId: courseId,
                            moodleUserId: moodleUserId,
                            cmId: item.cmId
                        })
                    })
                        .then(function () {
                            refreshAiContentList();
                        })
                        .catch(function () {
                            showModal('Delete', 'Could not delete this item.', [
                                { label: 'Close', className: 'syllentras-modal-secondary', onClick: closeModal }
                            ]);
                        });
                }
            }
        ]
    );
}

function deleteSelectedAiContentItems() {
    var ids = Object.keys(aiContentSelected)
        .filter(function (id) { return aiContentSelected[id]; })
        .map(function (id) { return parseInt(id, 10); })
        .filter(function (id) { return id > 0; });

    if (!ids.length) return;

    var names = ids.map(function (id) {
        var found = aiContentItems.find(function (item) { return item.cmId === id; });
        return found && found.name ? found.name : 'Item ' + id;
    });
    var preview =
        names.length <= 3
            ? names.map(function (n) { return '"' + n + '"'; }).join(', ')
            : names.slice(0, 2).map(function (n) { return '"' + n + '"'; }).join(', ') +
              ', and ' + (names.length - 2) + ' more';

    showModal(
        'Delete selected content?',
        'Delete ' + ids.length + ' item' + (ids.length === 1 ? '' : 's') +
            ' (' + preview + ')? This cannot be undone.',
        [
            { label: 'Cancel', className: 'syllentras-modal-secondary', onClick: closeModal },
            {
                label: 'Delete',
                className: 'syllentras-modal-danger',
                onClick: function () {
                    closeModal();
                    fetchJson('/ai-content/delete-many', {
                        method: 'POST',
                        body: JSON.stringify({
                            courseId: courseId,
                            moodleUserId: moodleUserId,
                            cmIds: ids
                        })
                    })
                        .then(function (data) {
                            var failed = (data && data.failed) || [];
                            aiContentBulkMode = false;
                            aiContentSelected = {};
                            refreshAiContentList();
                            if (failed.length > 0) {
                                showModal(
                                    'Delete',
                                    failed.length === ids.length
                                        ? 'Could not delete the selected items.'
                                        : 'Deleted some items, but ' +
                                          failed.length +
                                          ' failed.',
                                    [
                                        {
                                            label: 'Close',
                                            className: 'syllentras-modal-secondary',
                                            onClick: closeModal
                                        }
                                    ]
                                );
                            }
                        })
                        .catch(function () {
                            showModal('Delete', 'Could not delete the selected items.', [
                                {
                                    label: 'Close',
                                    className: 'syllentras-modal-secondary',
                                    onClick: closeModal
                                }
                            ]);
                        });
                }
            }
        ]
    );
}

function bindAiContentToolbar() {
    if (!aiContentToolbar) return;

    var sortBtn = aiContentToolbar.querySelector('#syllentras-ai-sort-btn');
    var sortPanel = aiContentToolbar.querySelector('#syllentras-ai-sort-panel');
    var filterBtn = aiContentToolbar.querySelector('#syllentras-ai-filter-btn');
    var filterPanel = aiContentToolbar.querySelector('#syllentras-ai-filter-panel');
    var bulkToggle = aiContentToolbar.querySelector('#syllentras-ai-bulk-toggle');
    var selectAllBtn = aiContentToolbar.querySelector('#syllentras-ai-select-all');
    var deselectAllBtn = aiContentToolbar.querySelector('#syllentras-ai-deselect-all');
    var bulkDeleteBtn = aiContentToolbar.querySelector('#syllentras-ai-bulk-delete');

    function togglePanel(btn, panel) {
        var willOpen = panel.hidden;
        closeAiContentDropdowns();
        closeAiContentMenu();
        if (willOpen) {
            panel.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
        }
    }

    if (sortBtn && sortPanel) {
        sortBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            togglePanel(sortBtn, sortPanel);
        });
        Array.from(sortPanel.querySelectorAll('[data-sort]')).forEach(function (opt) {
            opt.addEventListener('click', function (e) {
                e.stopPropagation();
                var key = opt.getAttribute('data-sort');
                if (key === aiContentSortKey) {
                    aiContentSortDir = aiContentSortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    aiContentSortKey = key;
                    aiContentSortDir = SORT_DEFAULT_DIR[key] || 'asc';
                }
                closeAiContentDropdowns();
                renderAiContentList();
            });
        });
    }

    if (filterBtn && filterPanel) {
        filterBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            togglePanel(filterBtn, filterPanel);
        });
        Array.from(filterPanel.querySelectorAll('input[type="checkbox"]')).forEach(function (box) {
            box.addEventListener('change', function () {
                if (box.checked) {
                    aiContentFilterKinds[box.value] = true;
                } else {
                    delete aiContentFilterKinds[box.value];
                }
                aiContentSelected = {};
                renderAiContentList();
            });
            box.addEventListener('click', function (e) {
                e.stopPropagation();
            });
        });
        filterPanel.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    }

    if (bulkToggle) {
        bulkToggle.addEventListener('click', function () {
            closeAiContentDropdowns();
            closeAiContentMenu();
            aiContentBulkMode = !aiContentBulkMode;
            if (!aiContentBulkMode) {
                aiContentSelected = {};
            }
            renderAiContentList();
        });
    }

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', function () {
            getVisibleAiContentItems().forEach(function (item) {
                aiContentSelected[item.cmId] = true;
            });
            renderAiContentList();
        });
    }

    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', function () {
            getVisibleAiContentItems().forEach(function (item) {
                delete aiContentSelected[item.cmId];
            });
            renderAiContentList();
        });
    }

    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', function () {
            deleteSelectedAiContentItems();
        });
    }

    document.addEventListener('click', function (e) {
        if (!aiContentToolbar) return;
        if (aiContentToolbar.contains(e.target)) return;
        closeAiContentDropdowns();
    });
}

bindAiContentDom();
if (tabChatBtn) {
    tabChatBtn.addEventListener('click', function () { setChatTab('chat'); });
}
if (tabAiContentBtn) {
    tabAiContentBtn.addEventListener('click', function () { setChatTab('ai-content'); });
}
setChatTab('chat');

// ===== wiring.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

expandBtn.addEventListener('click', function () {
    if (!isExpanded) savePanelLayout();
    isExpanded = !isExpanded;
    localStorage.setItem('syllentras_expanded', isExpanded ? '1' : '0');
    applyExpandedState(isExpanded);
});

resetBtn.addEventListener('click', resetPanelLayout);

btn.addEventListener('click', function () {
    openConversation({ type: 'general', title: generalChatTitle() });
});

close.addEventListener('click', function () {
    panel.hidden = true;
    btn.hidden = false;
});

input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

send.addEventListener('click', sendMessage);
newBtn.addEventListener('click', showNewConversationPrompt);
searchInput.addEventListener('input', function () {
    searchConversations(searchInput.value);
});

msgs.addEventListener('scroll', function () {
    if (msgs.scrollTop === 0 && hasMore && !loadingOlder) {
        loadOlderMessages();
    }
});

header.addEventListener('pointerdown', function (e) {
    if (isMobileLayout() || e.button !== 0 || e.target.closest('button') || e.target.closest('.syllentras-panel-resize-handle')) return;

    var rect = panel.getBoundingClientRect();
    isDraggingPanel = true;
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    setPanelRect(normalizePanelRect({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
    }));
    e.preventDefault();
});

document.addEventListener('pointermove', function (e) {
    if (isResizingPanel && resizeStartRect && resizeEdge) {
        var dx = e.clientX - resizeStartX;
        var dy = e.clientY - resizeStartY;
        var maxWidth = Math.max(1, window.innerWidth - PANEL_MARGIN * 2);
        var maxHeight = Math.max(1, window.innerHeight - PANEL_MARGIN * 2);
        var minWidth = Math.min(PANEL_MIN_WIDTH, maxWidth);
        var minHeight = Math.min(PANEL_MIN_HEIGHT, maxHeight);
        var next = {
            left: resizeStartRect.left,
            top: resizeStartRect.top,
            width: resizeStartRect.width,
            height: resizeStartRect.height
        };
        var right = resizeStartRect.left + resizeStartRect.width;
        var bottom = resizeStartRect.top + resizeStartRect.height;

        if (resizeEdge.indexOf('e') !== -1) {
            next.width = clamp(
                resizeStartRect.width + dx,
                minWidth,
                Math.max(minWidth, window.innerWidth - resizeStartRect.left - PANEL_MARGIN)
            );
        }
        if (resizeEdge.indexOf('w') !== -1) {
            next.left = clamp(resizeStartRect.left + dx, PANEL_MARGIN, right - minWidth);
            next.width = right - next.left;
        }
        if (resizeEdge.indexOf('s') !== -1) {
            next.height = clamp(
                resizeStartRect.height + dy,
                minHeight,
                Math.max(minHeight, window.innerHeight - resizeStartRect.top - PANEL_MARGIN)
            );
        }
        if (resizeEdge.indexOf('n') !== -1) {
            next.top = clamp(resizeStartRect.top + dy, PANEL_MARGIN, bottom - minHeight);
            next.height = bottom - next.top;
        }

        setPanelRect(normalizePanelRect(next));
        return;
    }

    if (!isDraggingPanel) return;
    setPanelRect(normalizePanelRect({
        left: e.clientX - dragOffsetX,
        top: e.clientY - dragOffsetY,
        width: panel.offsetWidth,
        height: panel.offsetHeight
    }));
});

document.addEventListener('pointerup', function () {
    if (isResizingPanel) {
        isResizingPanel = false;
        resizeEdge = null;
        resizeStartRect = null;
        savePanelLayout();
        return;
    }
    if (!isDraggingPanel) return;
    isDraggingPanel = false;
    savePanelLayout();
});

Array.prototype.forEach.call(panel.querySelectorAll('.syllentras-panel-resize-handle'), function (handle) {
    handle.addEventListener('pointerdown', function (e) {
        if (isMobileLayout() || e.button !== 0) return;
        var rect = panel.getBoundingClientRect();
        isResizingPanel = true;
        resizeEdge = handle.getAttribute('data-edge');
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        resizeStartRect = {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
        };
        setPanelRect(normalizePanelRect(resizeStartRect));
        if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
    });
});

sidebarResizer.addEventListener('pointerdown', function (e) {
    if (isMobileLayout()) return;
    isResizingSidebar = true;
    sidebarResizer.classList.add('resizing');
    e.preventDefault();
});

document.addEventListener('pointermove', function (e) {
    if (!isResizingSidebar) return;
    var sidebarRect = sidebar.getBoundingClientRect();
    setSidebarWidth(e.clientX - sidebarRect.left);
});

document.addEventListener('pointerup', function () {
    if (!isResizingSidebar) return;
    isResizingSidebar = false;
    sidebarResizer.classList.remove('resizing');
    saveSidebarWidth();
});

inputResizer.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    isResizingInput = true;
    inputResizeStartY = e.clientY;
    inputResizeStartHeight = input.getBoundingClientRect().height;
    inputResizer.classList.add('resizing');
    if (inputResizer.setPointerCapture) inputResizer.setPointerCapture(e.pointerId);
    e.preventDefault();
});

document.addEventListener('pointermove', function (e) {
    if (!isResizingInput) return;
    // Dragging the divider up grows the input; down shrinks it.
    setInputHeight(inputResizeStartHeight - (e.clientY - inputResizeStartY));
});

document.addEventListener('pointerup', function () {
    if (!isResizingInput) return;
    isResizingInput = false;
    inputResizer.classList.remove('resizing');
    saveInputHeight();
});

document.addEventListener('click', function (e) {
    if (openMenu && !openMenu.contains(e.target) && !e.target.closest('.syllentras-conversation-menu-btn')) {
        closeConversationMenu();
    }
    if (openToolsMenu && !openToolsMenu.contains(e.target) && !(toolsWrap && toolsWrap.contains(e.target))) {
        closeToolsMenu();
    }
    if (typeof closeModeMenu === 'function' &&
        openModeMenu &&
        !openModeMenu.contains(e.target) &&
        !e.target.closest('#syllentras-mode-btn') &&
        !e.target.closest('.syllentras-mode-wrap')) {
        closeModeMenu();
    }
    if (typeof closeAiContentMenu === 'function' &&
        aiContentOpenMenu &&
        !aiContentOpenMenu.contains(e.target) &&
        !e.target.closest('.syllentras-ai-content-menu-btn')) {
        closeAiContentMenu();
    }
});

modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        closeConversationMenu();
        closeToolsMenu();
        if (typeof closeModeMenu === 'function') closeModeMenu();
        if (typeof closeAiContentMenu === 'function') closeAiContentMenu();
        if (!modal.hidden) closeModal();
    }
});

window.addEventListener('resize', function () {
    closeToolsMenu();
    if (typeof closeModeMenu === 'function') closeModeMenu();
    clampCurrentPanelLayout();
});

if (window.ResizeObserver) {
    new ResizeObserver(function () {
        if (!isDraggingPanel && !isResizingPanel) clampCurrentPanelLayout();
    }).observe(panel);
} else {
    panel.addEventListener('mouseup', scheduleLayoutSave);
}

applyExpandedState();
applyStoredSidebarWidth();
applyStoredInputHeight();
initToolsMenu();
initModeSelector();
bindMessageSearchUi();
loadProviders();
loadConversations();
installSectionButtons();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installSectionButtons);
}
// Some Moodle course formats finish rendering section markup after this footer hook runs.
window.setTimeout(installSectionButtons, 500);

})();
