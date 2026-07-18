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
    var width = clamp(rect.width || 620, minWidth, maxWidth);
    var height = clamp(rect.height || panel.offsetHeight || 520, minHeight, maxHeight);
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
    var panelWidth = panel.getBoundingClientRect().width || 620;
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

