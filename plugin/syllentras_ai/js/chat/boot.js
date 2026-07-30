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

// Brand marks (simple-icons paths) rendered as currentColor SVGs for the picker.
var PROVIDER_ICON_PATHS = {
    openai:
        'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
    gemini:
        'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
    anthropic:
        'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
    xai: 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z',
    mistral:
        'M17.143 3.429v3.428h-3.429v3.429h-3.428V6.857H6.857V3.43H3.43v13.714H0v3.428h10.286v-3.428H6.857v-3.429h3.429v3.429h3.429v-3.429h3.428v3.429h-3.428v3.428H24v-3.428h-3.43V3.429z'
};

var PROVIDER_FALLBACK_ICON_PATH =
    'M12 2l1.4 4.2L18 7.6l-3.6 3.1L15.8 16 12 13.8 8.2 16l1.4-5.3L6 7.6l4.6-1.4L12 2zm0 14.5c2.5 0 4.5 1.3 4.5 2.8S14.5 22 12 22s-4.5-1.2-4.5-2.7 2-2.8 4.5-2.8z';

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

function createProviderIcon(providerId, className) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (className) {
        svg.setAttribute('class', className);
    }

    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute(
        'd',
        PROVIDER_ICON_PATHS[providerId] || PROVIDER_FALLBACK_ICON_PATH
    );
    svg.appendChild(path);
    return svg;
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
    if (typeof closeDisplayMenu === 'function') {
        closeDisplayMenu();
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
    var activeId = getSelectedProviderId();
    var active = findProvider(activeId);
    if (!providerBtn) return;

    providerBtn.setAttribute(
        'aria-label',
        active
            ? ('AI provider: ' + active.displayName + '. Click to change.')
            : 'Choose AI provider'
    );
    providerBtn.title = active ? active.displayName : 'Choose AI provider';

    providerBtn.innerHTML = '';
    providerBtn.appendChild(
        createProviderIcon(activeId, 'syllentras-provider-btn-icon')
    );
    if (activeId && PROVIDER_ICON_PATHS[activeId]) {
        providerBtn.dataset.providerId = activeId;
    } else {
        providerBtn.removeAttribute('data-provider-id');
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

        var main = document.createElement('span');
        main.className = 'syllentras-provider-option-main';

        var iconWrap = document.createElement('span');
        iconWrap.className = 'syllentras-provider-option-icon';
        iconWrap.setAttribute('aria-hidden', 'true');
        iconWrap.appendChild(createProviderIcon(provider.id));
        main.appendChild(iconWrap);

        var nameEl = document.createElement('span');
        nameEl.className = 'syllentras-provider-option-name';
        nameEl.textContent = provider.displayName;
        main.appendChild(nameEl);

        row.appendChild(main);

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
    note.textContent = 'No extra settings - answers directly from your course.';
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
    if (typeof closeDisplayMenu === 'function') closeDisplayMenu();

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
    var speakBtn = el.querySelector('.syllentras-msg-speak');
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
    // Markdown replace wipes the bubble; put the speaker back if we had one,
    // otherwise add it now that there is real text to read.
    if (speakBtn) {
        el.appendChild(speakBtn);
    } else if (typeof attachMessageSpeakButton === 'function') {
        attachMessageSpeakButton(el);
    }
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

// ===== message-speech.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.
//
// Read-aloud for chat bubbles. Picks the nicest system voice we can find for
// Grace (female) / Ben (male), and respects the speed slider from display settings.

var SPEECH_VOICE_KEY = 'syllentras_speech_voice';
var SPEECH_RATE_KEY = 'syllentras_speech_rate_step';

var SPEECH_VOICES = [
    { id: 'grace', label: 'Grace', gender: 'female' },
    { id: 'ben', label: 'Ben', gender: 'male' }
];

// Same idea as the font size steps — a few named speeds instead of a weird float.
var SPEECH_RATE_STEPS = [
    { step: 1, rate: 0.75, label: 'Slow' },
    { step: 2, rate: 0.9, label: 'Steady' },
    { step: 3, rate: 1.0, label: 'Default' },
    { step: 4, rate: 1.15, label: 'Brisk' },
    { step: 5, rate: 1.3, label: 'Fast' }
];

var speakingMessageEl = null;
var selectedSpeechVoice = 'grace';
var selectedSpeechRateStep = 3;
var cachedSpeechVoices = [];
// True while we cancel + re-speak after a speed/voice tweak.
var speechRestartPending = false;

function speechSupported() {
    return typeof window !== 'undefined'
        && 'speechSynthesis' in window
        && typeof SpeechSynthesisUtterance !== 'undefined';
}

function normalizeSpeechVoice(raw) {
    for (var i = 0; i < SPEECH_VOICES.length; i++) {
        if (SPEECH_VOICES[i].id === raw) return raw;
    }
    return 'grace';
}

function normalizeSpeechRateStep(raw) {
    var n = parseInt(raw, 10);
    if (n >= 1 && n <= SPEECH_RATE_STEPS.length) return n;
    return 3;
}

function speechRateInfo(step) {
    return SPEECH_RATE_STEPS[normalizeSpeechRateStep(step) - 1];
}

function refreshSpeechVoiceCache() {
    if (!speechSupported()) {
        cachedSpeechVoices = [];
        return cachedSpeechVoices;
    }
    cachedSpeechVoices = window.speechSynthesis.getVoices() || [];
    return cachedSpeechVoices;
}

function scoreSpeechVoice(voice, wantFemale) {
    if (!voice) return -1000;
    var name = String(voice.name || '');
    var lang = String(voice.lang || '').toLowerCase();
    var score = 0;

    // Stick to English when we can — course chat is in English.
    if (lang.indexOf('en') === 0) score += 40;
    else if (lang.indexOf('en') !== -1) score += 20;
    else score -= 30;

    // Neural / natural voices sound way less "GPS lady" than the old defaults.
    if (/neural|natural|premium|enhanced|online|wave|studio/i.test(name)) score += 35;
    if (voice.localService === false) score += 8;

    if (wantFemale) {
        if (/female|woman|zira|samantha|karen|moira|susan|victoria|linda|jenny|aria|sara|salli|joanna|kendra|kimberly|ivy|emma|amy|google us english$/i.test(name)) {
            score += 50;
        }
        if (/male|man|david|mark|daniel|alex|guy|ryan|tony|matthew|justin|brian|ravi/i.test(name) && !/female/i.test(name)) {
            score -= 40;
        }
    } else {
        if (/male|man|david|mark|daniel|alex|guy|ryan|tony|matthew|justin|brian|ravi|google uk english male/i.test(name)) {
            score += 50;
        }
        if (/female|woman|zira|samantha|karen|moira|jenny|aria|sara/i.test(name) && !/male/i.test(name)) {
            score -= 40;
        }
    }

    // Mild preference for US/UK/AU/CA English.
    if (/en-us|en_us/.test(lang)) score += 6;
    if (/en-gb|en_gb|en-au|en_au|en-ca|en_ca/.test(lang)) score += 4;

    return score;
}

function pickSpeechVoice(preference) {
    var voices = cachedSpeechVoices.length ? cachedSpeechVoices : refreshSpeechVoiceCache();
    if (!voices.length) return null;

    var wantFemale = normalizeSpeechVoice(preference) !== 'ben';
    var best = null;
    var bestScore = -Infinity;
    for (var i = 0; i < voices.length; i++) {
        var score = scoreSpeechVoice(voices[i], wantFemale);
        if (score > bestScore) {
            bestScore = score;
            best = voices[i];
        }
    }
    return best;
}

function loadSpeechSettings() {
    var voiceRaw = null;
    var rateRaw = null;
    try {
        voiceRaw = localStorage.getItem(SPEECH_VOICE_KEY);
        rateRaw = localStorage.getItem(SPEECH_RATE_KEY);
    } catch (e) {
        voiceRaw = null;
        rateRaw = null;
    }
    selectedSpeechVoice = normalizeSpeechVoice(voiceRaw);
    selectedSpeechRateStep = normalizeSpeechRateStep(rateRaw);
}

function saveSpeechSettings() {
    try {
        localStorage.setItem(SPEECH_VOICE_KEY, selectedSpeechVoice);
        localStorage.setItem(SPEECH_RATE_KEY, String(selectedSpeechRateStep));
    } catch (e) { /* private mode / quota — ignore */ }
}

function setSpeechVoicePreference(voiceId) {
    var next = normalizeSpeechVoice(voiceId);
    if (next === selectedSpeechVoice) return;
    selectedSpeechVoice = next;
    saveSpeechSettings();
    // Live preview — if something is already talking, kick it off again.
    restartMessageSpeechIfPlaying();
}

function setSpeechRateStep(step) {
    var next = normalizeSpeechRateStep(step);
    if (next === selectedSpeechRateStep) return;
    selectedSpeechRateStep = next;
    saveSpeechSettings();
    restartMessageSpeechIfPlaying();
}

function resetSpeechSettings() {
    selectedSpeechVoice = 'grace';
    selectedSpeechRateStep = 3;
    saveSpeechSettings();
    restartMessageSpeechIfPlaying();
}

function stopMessageSpeech() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    if (!speakingMessageEl) return;
    speakingMessageEl.classList.remove('is-speaking');
    var btn = speakingMessageEl.querySelector('.syllentras-msg-speak');
    if (btn) {
        btn.setAttribute('aria-pressed', 'false');
        btn.title = 'Read aloud';
        btn.setAttribute('aria-label', 'Read aloud');
    }
    speakingMessageEl = null;
}

function getMessageSpeakText(el) {
    if (!el) return '';
    var clone = el.cloneNode(true);
    Array.from(clone.querySelectorAll(
        '.syllentras-msg-speak, .syllentras-msg-mode, .syllentras-pending-action, .syllentras-content-open-btn, .syllentras-review-toolbar'
    )).forEach(function (node) {
        node.remove();
    });
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function setSpeakButtonPlaying(el, playing) {
    if (!el) return;
    var btn = el.querySelector('.syllentras-msg-speak');
    el.classList.toggle('is-speaking', !!playing);
    if (!btn) return;
    btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    btn.title = playing ? 'Stop reading' : 'Read aloud';
    btn.setAttribute('aria-label', playing ? 'Stop reading' : 'Read aloud');
}

function startMessageSpeech(el) {
    if (!speechSupported() || !el) return;

    var text = getMessageSpeakText(el);
    if (!text || text === '...') return;

    // Drop whatever was mid-sentence before starting fresh.
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    refreshSpeechVoiceCache();

    var utterance = new SpeechSynthesisUtterance(text);
    var voice = pickSpeechVoice(selectedSpeechVoice);
    if (voice) {
        utterance.voice = voice;
        // Some engines ignore voice.lang unless we set it too.
        if (voice.lang) utterance.lang = voice.lang;
    }
    utterance.rate = speechRateInfo(selectedSpeechRateStep).rate;
    // Tiny pitch nudge so Grace/Ben don't sound identical and flat.
    utterance.pitch = selectedSpeechVoice === 'ben' ? 0.92 : 1.08;
    utterance.volume = 1;

    utterance.onend = function () {
        if (speechRestartPending) return;
        if (speakingMessageEl === el) {
            setSpeakButtonPlaying(el, false);
            speakingMessageEl = null;
        }
    };
    utterance.onerror = function () {
        // cancel() fires an error — ignore that when we're about to restart.
        if (speechRestartPending) return;
        if (speakingMessageEl === el) {
            setSpeakButtonPlaying(el, false);
            speakingMessageEl = null;
        }
    };

    speakingMessageEl = el;
    setSpeakButtonPlaying(el, true);
    window.speechSynthesis.speak(utterance);
}

// Browsers don't let you change rate mid-utterance, so we restart the same bubble.
function restartMessageSpeechIfPlaying() {
    var el = speakingMessageEl;
    if (!el || !speechSupported()) return;

    speechRestartPending = true;
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    // Give the engine a tick to finish cancelling, then speak with the new settings.
    window.setTimeout(function () {
        speechRestartPending = false;
        if (!el.isConnected) {
            speakingMessageEl = null;
            return;
        }
        startMessageSpeech(el);
    }, 40);
}

function toggleMessageSpeech(el) {
    if (!speechSupported() || !el) return;

    // Same bubble again = stop.
    if (speakingMessageEl === el) {
        speechRestartPending = false;
        stopMessageSpeech();
        return;
    }

    startMessageSpeech(el);
}

function attachMessageSpeakButton(el) {
    if (!el || !speechSupported()) return null;
    if (el.classList.contains('system') || el.classList.contains('error')) return null;

    var existing = el.querySelector('.syllentras-msg-speak');
    if (existing) return existing;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'syllentras-msg-speak';
    btn.title = 'Read aloud';
    btn.setAttribute('aria-label', 'Read aloud');
    btn.setAttribute('aria-pressed', 'false');
    // Clean outline speaker — no box around it, just the icon.
    btn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true" focusable="false">' +
        '<path d="M11 5L6 9H3v6h3l5 4V5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<path d="M15.2 8.8a4.2 4.2 0 0 1 0 6.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
        '<path d="M17.8 6.2a7.2 7.2 0 0 1 0 11.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
        '</svg>';

    btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleMessageSpeech(el);
    });

    el.appendChild(btn);
    return btn;
}

loadSpeechSettings();

if (speechSupported()) {
    refreshSpeechVoiceCache();
    // Chrome loads voices late — refresh when they show up.
    if (typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
        window.speechSynthesis.onvoiceschanged = refreshSpeechVoiceCache;
    }
    window.speechSynthesis.addEventListener('voiceschanged', refreshSpeechVoiceCache);
}

// ===== message-dictation.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.
//
// Mic next to the composer. Uses the browser speech-recognition API to dump
// what you say into the message box (speech-to-text).

var dictationRecognition = null;
var dictationListening = false;
var dictationBaseText = '';
var dictationToastTimer = null;
var dictationToastEl = null;
var micBtn = document.getElementById('syllentras-chat-mic');

function speechRecognitionSupported() {
    return typeof window !== 'undefined'
        && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function appendDictationChunk(base, chunk) {
    var left = (base || '').replace(/\s+$/, '');
    var right = String(chunk || '').replace(/^\s+/, '');
    if (!right) return left;
    if (!left) return right;
    return left + ' ' + right;
}

function ensureDictationToast() {
    if (dictationToastEl) return dictationToastEl;
    var host = document.getElementById('syllentras-chat-main') || panel || root;
    if (!host) return null;
    dictationToastEl = document.createElement('div');
    dictationToastEl.id = 'syllentras-dictation-toast';
    dictationToastEl.className = 'syllentras-dictation-toast';
    dictationToastEl.setAttribute('role', 'status');
    dictationToastEl.setAttribute('aria-live', 'polite');
    dictationToastEl.hidden = true;
    host.appendChild(dictationToastEl);
    return dictationToastEl;
}

function showDictationToast(message) {
    var el = ensureDictationToast();
    if (!el) return;
    el.textContent = String(message || '');
    el.hidden = false;
    // Force reflow so the fade-in class actually animates when we re-show.
    void el.offsetWidth;
    el.classList.add('is-visible');
    if (dictationToastTimer) {
        clearTimeout(dictationToastTimer);
    }
    dictationToastTimer = setTimeout(function () {
        el.classList.remove('is-visible');
        dictationToastTimer = setTimeout(function () {
            el.hidden = true;
            dictationToastTimer = null;
        }, 220);
    }, 3000);
}

function dictationErrorMessage(code) {
    if (code === 'not-allowed' || code === 'service-not-allowed') {
        return 'Microphone access blocked. Allow it in your browser or system settings.';
    }
    if (code === 'audio-capture') {
        return 'No microphone detected.';
    }
    return '';
}

function mediaErrorKind(err) {
    var name = err && err.name ? String(err.name) : '';
    if (
        name === 'NotFoundError'
        || name === 'DevicesNotFoundError'
        || name === 'NotReadableError'
        || name === 'OverconstrainedError'
    ) {
        return 'no-mic';
    }
    if (
        name === 'NotAllowedError'
        || name === 'PermissionDeniedError'
        || name === 'SecurityError'
    ) {
        return 'blocked';
    }
    return 'unknown';
}

function probeMicrophone(done) {
    if (
        !navigator.mediaDevices
        || typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
        done(null);
        return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        try {
            stream.getTracks().forEach(function (track) {
                track.stop();
            });
        } catch (e) { /* ignore */ }
        done(null);
    }).catch(function (err) {
        done(mediaErrorKind(err));
    });
}

function syncMicButtonUi() {
    if (!micBtn) return;
    micBtn.classList.toggle('is-listening', dictationListening);
    micBtn.setAttribute('aria-pressed', dictationListening ? 'true' : 'false');
    micBtn.title = dictationListening ? 'Stop listening' : 'Dictate message';
    micBtn.setAttribute(
        'aria-label',
        dictationListening ? 'Stop listening' : 'Dictate message'
    );
}

function stopDictation() {
    if (!dictationRecognition) {
        dictationListening = false;
        syncMicButtonUi();
        return;
    }
    try {
        dictationRecognition.onend = null;
        dictationRecognition.stop();
    } catch (e) { /* already stopped */ }
    dictationListening = false;
    syncMicButtonUi();
}

function beginSpeechRecognition() {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    dictationRecognition = new Recognition();
    dictationRecognition.lang = 'en-US';
    dictationRecognition.continuous = true;
    dictationRecognition.interimResults = true;
    dictationBaseText = input.value || '';

    dictationRecognition.onresult = function (event) {
        var interim = '';
        var finals = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
            var piece = event.results[i][0].transcript || '';
            if (event.results[i].isFinal) {
                finals += piece;
            } else {
                interim += piece;
            }
        }
        if (finals) {
            dictationBaseText = appendDictationChunk(dictationBaseText, finals);
            input.value = dictationBaseText;
        } else {
            input.value = appendDictationChunk(dictationBaseText, interim);
        }
        // Keep the caret at the end so you can see what just came in.
        try {
            input.focus();
            var len = input.value.length;
            input.setSelectionRange(len, len);
        } catch (e) { /* some browsers are picky about selection on textarea */ }
    };

    dictationRecognition.onerror = function (event) {
        // no-speech / aborted are normal — only nag on real mic problems.
        var code = event && event.error ? String(event.error) : '';
        var msg = dictationErrorMessage(code);
        if (msg) {
            showDictationToast(msg);
            micBtn.title = msg;
        }
        dictationListening = false;
        syncMicButtonUi();
    };

    dictationRecognition.onend = function () {
        // continuous mode can end on its own — flip the button back off.
        dictationListening = false;
        syncMicButtonUi();
    };

    try {
        dictationRecognition.start();
        dictationListening = true;
        syncMicButtonUi();
        input.focus();
    } catch (e) {
        dictationListening = false;
        syncMicButtonUi();
        showDictationToast('Could not start the microphone.');
    }
}

function startDictation() {
    if (!speechRecognitionSupported() || !input || !micBtn) return;
    if (dictationListening) return;

    // Don't talk over yourself — pause read-aloud if it's going.
    if (typeof stopMessageSpeech === 'function') {
        stopMessageSpeech();
    }

    // Quick mic check so we can say "blocked" vs "not found" clearly.
    probeMicrophone(function (kind) {
        if (kind === 'blocked') {
            showDictationToast(
                'Microphone access blocked. Allow it in your browser or system settings.'
            );
            return;
        }
        if (kind === 'no-mic') {
            showDictationToast('No microphone detected.');
            return;
        }
        beginSpeechRecognition();
    });
}

function toggleDictation() {
    if (dictationListening) {
        stopDictation();
    } else {
        startDictation();
    }
}

function initDictation() {
    if (!micBtn) return;

    if (!speechRecognitionSupported()) {
        micBtn.hidden = true;
        return;
    }

    micBtn.hidden = false;
    syncMicButtonUi();
    micBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleDictation();
    });
}

initDictation();

// ===== attachments.js =====
// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.
//
// Chat file attachments: Tools → Attach files, or drag-and-drop onto the chat.

var CHAT_ATTACHMENT_MAX_FILES = 10;
var CHAT_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
var CHAT_ATTACHMENT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
var CHAT_ATTACHMENT_USER_QUOTA_MB = 1024;
var CHAT_ATTACHMENT_TOAST_MS = 3200;
var CHAT_ATTACHMENT_ALLOWED_EXTENSIONS = [
    'pdf', 'docx', 'pptx', 'txt', 'md', 'png', 'jpg', 'jpeg',
    'py', 'java', 'js', 'ts', 'cpp', 'c', 'cs', 'php',
    'xlsx', 'csv', 'zip', 'json', 'xml', 'sql', 'odt', 'ods', 'odp',
    'mp3', 'wav', 'm4a', 'mp4', 'mov', 'avi', 'epub', 'tex'
];

var pendingAttachments = [];
var attachmentInput = document.getElementById('syllentras-chat-file-input');
var attachmentBar = document.getElementById('syllentras-chat-attachments');
var attachmentListEl = document.getElementById('syllentras-chat-attachment-list');
var attachmentCountEl = document.getElementById('syllentras-chat-attachment-count');
var attachmentErrorEl = document.getElementById('syllentras-chat-attachment-error');
var attachmentToastEl = null;
var attachmentToastTimer = null;
var attachmentDragDepth = 0;
var attachmentDropHost = null;

function attachmentExtension(filename) {
    var base = String(filename || '').split(/[/\\]/).pop() || '';
    var dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) return '';
    return base.slice(dot + 1).toLowerCase();
}

function isAllowedAttachmentFilename(filename) {
    var ext = attachmentExtension(filename);
    return !!ext && CHAT_ATTACHMENT_ALLOWED_EXTENSIONS.indexOf(ext) !== -1;
}

function buildAcceptAttribute() {
    return CHAT_ATTACHMENT_ALLOWED_EXTENSIONS.map(function (ext) {
        return '.' + ext;
    }).join(',');
}

function attachmentLimitMessages() {
    return {
        tooManyFiles: 'You can attach up to 10 files per message.',
        tooLargeFile: 'This file is too large. Maximum size is 15 MB per file.',
        tooLargeTotal: 'Upload limit exceeded. Maximum total upload size is 100 MB.',
        quotaFull: 'Your attachment storage is full. Maximum storage is 1 GB.',
        unsupportedType: 'This file type is not supported.'
    };
}

function friendlyAttachmentError(raw) {
    var text = String(raw || '').trim();
    var limits = attachmentLimitMessages();
    if (!text) return 'Upload failed. Please try again.';
    var lower = text.toLowerCase();
    if (lower.indexOf('not supported') !== -1
        || lower.indexOf('unsupported') !== -1
        || lower.indexOf('not a supported') !== -1
        || lower.indexOf('supported file type') !== -1) {
        return limits.unsupportedType;
    }
    if (lower.indexOf('storage is full') !== -1 || lower.indexOf('quota') !== -1) {
        return limits.quotaFull;
    }
    if (lower.indexOf('total upload') !== -1 || lower.indexOf('combined') !== -1) {
        return limits.tooLargeTotal;
    }
    if (lower.indexOf('too large') !== -1 || lower.indexOf('per file') !== -1) {
        return limits.tooLargeFile;
    }
    if (lower.indexOf('up to 10') !== -1 || lower.indexOf('at most 10') !== -1) {
        return limits.tooManyFiles;
    }
    // Never leak paths or stack-looking text.
    if (text.indexOf('/') !== -1 || text.indexOf('\\') !== -1 || text.indexOf('Error:') === 0) {
        return 'Upload failed. Please try again.';
    }
    return text;
}

function ensureAttachmentToast() {
    if (attachmentToastEl) return attachmentToastEl;
    var host = document.getElementById('syllentras-chat-main') || panel || root;
    if (!host) return null;
    attachmentToastEl = document.createElement('div');
    attachmentToastEl.id = 'syllentras-attachment-toast';
    attachmentToastEl.className = 'syllentras-dictation-toast syllentras-attachment-toast';
    attachmentToastEl.setAttribute('role', 'status');
    attachmentToastEl.setAttribute('aria-live', 'polite');
    attachmentToastEl.hidden = true;
    host.appendChild(attachmentToastEl);
    return attachmentToastEl;
}

function showAttachmentToast(message) {
    var el = ensureAttachmentToast();
    if (!el) return;
    var text = friendlyAttachmentError(message);
    el.textContent = text;
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('is-visible');
    if (attachmentToastTimer) {
        clearTimeout(attachmentToastTimer);
    }
    attachmentToastTimer = setTimeout(function () {
        el.classList.remove('is-visible');
        attachmentToastTimer = setTimeout(function () {
            el.hidden = true;
            attachmentToastTimer = null;
        }, 220);
    }, CHAT_ATTACHMENT_TOAST_MS);
}

function setAttachmentError(message) {
    if (!attachmentErrorEl) {
        if (message) showAttachmentToast(message);
        return;
    }
    if (!message) {
        attachmentErrorEl.hidden = true;
        attachmentErrorEl.textContent = '';
        return;
    }
    var friendly = friendlyAttachmentError(message);
    // Prefer the temporary toast; keep the inline alert empty so UI stays clean.
    attachmentErrorEl.hidden = true;
    attachmentErrorEl.textContent = '';
    showAttachmentToast(friendly);
}

function formatAttachmentSize(bytes) {
    if (!bytes || bytes < 1024) return (bytes || 0) + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function attachmentStatusLabel(status) {
    if (status === 'uploading') return 'Uploading…';
    if (status === 'processing') return 'Processing…';
    if (status === 'ready') return 'Ready';
    if (status === 'failed') return 'Failed';
    if (status === 'uploaded') return 'Uploaded';
    return status || '';
}

function renderAttachmentBar() {
    if (!attachmentBar || !attachmentListEl || !attachmentCountEl) return;

    attachmentListEl.innerHTML = '';
    pendingAttachments.forEach(function (item, index) {
        var chip = document.createElement('div');
        chip.className = 'syllentras-attachment-chip status-' + (item.status || 'ready');
        chip.title = item.filename + ' (' + formatAttachmentSize(item.size) + ') — ' +
            attachmentStatusLabel(item.status);

        var name = document.createElement('span');
        name.className = 'syllentras-attachment-chip-name';
        name.textContent = item.filename;

        var status = document.createElement('span');
        status.className = 'syllentras-attachment-chip-status';
        status.textContent = attachmentStatusLabel(item.status);

        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'syllentras-attachment-chip-remove';
        remove.setAttribute('aria-label', 'Remove ' + item.filename);
        remove.textContent = '×';
        remove.disabled = item.status === 'uploading' || item.status === 'processing';
        remove.addEventListener('click', function (e) {
            e.stopPropagation();
            var removed = pendingAttachments.splice(index, 1)[0];
            setAttachmentError('');
            renderAttachmentBar();
            if (removed && removed.id && typeof deleteUploadedAttachment === 'function') {
                deleteUploadedAttachment(removed.id).catch(function () { /* best-effort */ });
            }
        });

        chip.appendChild(name);
        chip.appendChild(status);
        chip.appendChild(remove);
        attachmentListEl.appendChild(chip);
    });

    attachmentCountEl.textContent = pendingAttachments.length + ' / ' + CHAT_ATTACHMENT_MAX_FILES + ' files';
    attachmentBar.hidden = pendingAttachments.length === 0;
}

function clearPendingAttachments() {
    pendingAttachments = [];
    if (attachmentInput) attachmentInput.value = '';
    setAttachmentError('');
    renderAttachmentBar();
}

function getPendingAttachmentsForSend() {
    return pendingAttachments
        .filter(function (item) {
            return item.id && (item.status === 'ready' || item.status === 'uploaded' || item.status === 'processing');
        })
        .map(function (item) {
            return {
                id: item.id,
                filename: item.filename,
                status: item.status
            };
        });
}

function hasPendingAttachmentUploads() {
    return pendingAttachments.some(function (item) {
        return item.status === 'uploading' || item.status === 'processing';
    });
}

function deleteUploadedAttachment(id) {
    if (!id) return Promise.resolve();
    return fetch(
        API_URL + '/chat/attachments/' + encodeURIComponent(id) +
        '?moodleUserId=' + encodeURIComponent(moodleUserId),
        { method: 'DELETE' }
    ).then(function (res) {
        if (!res.ok) {
            return res.text().then(function () {
                // Swallow — chip already removed locally.
            });
        }
    });
}

function uploadAttachmentFile(file, localItem) {
    var form = new FormData();
    form.append('files', file, file.name);

    var url = API_URL + '/chat/attachments'
        + '?moodleUserId=' + encodeURIComponent(moodleUserId)
        + '&courseId=' + encodeURIComponent(courseId);
    if (conversationId) {
        url += '&conversationId=' + encodeURIComponent(conversationId);
    }

    localItem.status = 'uploading';
    renderAttachmentBar();

    return fetch(url, { method: 'POST', body: form })
        .then(function (res) {
            return res.text().then(function (text) {
                var data = null;
                if (text) {
                    try { data = JSON.parse(text); } catch (e) { data = null; }
                }
                if (!res.ok) {
                    var msg = null;
                    if (data) {
                        if (typeof data.message === 'string') msg = data.message;
                        else if (Array.isArray(data.message)) msg = data.message.join(' ');
                    }
                    throw new Error(msg || 'Upload failed. Please try again.');
                }
                return data;
            });
        })
        .then(function (data) {
            var uploaded = (data && data.attachments && data.attachments[0]) || null;
            if (!uploaded || !uploaded.id) {
                throw new Error('Upload did not return an attachment id.');
            }
            localItem.id = uploaded.id;
            localItem.status = uploaded.status || 'ready';
            localItem.size = uploaded.byteLength || file.size;
            localItem.mimeType = uploaded.mimeType || file.type || '';
            if (uploaded.status === 'failed') {
                localItem.error = uploaded.processingError || 'Processing failed.';
                setAttachmentError(localItem.error);
            }
            renderAttachmentBar();
            return localItem;
        })
        .catch(function (err) {
            localItem.status = 'failed';
            localItem.error = friendlyAttachmentError((err && err.message) || 'Upload failed.');
            setAttachmentError(localItem.error);
            // Remove failed chip after toast so the bar stays tidy.
            var idx = pendingAttachments.indexOf(localItem);
            if (idx !== -1) {
                pendingAttachments.splice(idx, 1);
            }
            renderAttachmentBar();
            throw err;
        });
}

/**
 * Validate and enqueue FileList / File[] selections, then multipart-upload each.
 * Returns { added, errors } for callers/tests.
 */
function addAttachmentFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var errors = [];
    var limits = attachmentLimitMessages();

    if (!files.length) {
        return { added: 0, errors: errors };
    }

    var remaining = CHAT_ATTACHMENT_MAX_FILES - pendingAttachments.length;
    if (remaining <= 0) {
        errors.push(limits.tooManyFiles);
        setAttachmentError(errors[0]);
        return { added: 0, errors: errors };
    }

    if (files.length > remaining) {
        errors.push(limits.tooManyFiles);
        files = files.slice(0, remaining);
    }

    var pendingBytes = pendingAttachments.reduce(function (sum, item) {
        return sum + (item.size || 0);
    }, 0);
    var batchBytes = 0;
    var queue = [];

    files.forEach(function (file) {
        if (!file) return;
        if (!isAllowedAttachmentFilename(file.name)) {
            errors.push(limits.unsupportedType);
            return;
        }
        if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
            errors.push(limits.tooLargeFile);
            return;
        }
        if (pendingBytes + batchBytes + file.size > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
            errors.push(limits.tooLargeTotal);
            return;
        }
        var dup = pendingAttachments.some(function (existing) {
            return existing.filename === file.name && existing.size === file.size;
        });
        if (dup) {
            errors.push('"' + file.name + '" is already attached.');
            return;
        }
        queue.push(file);
        batchBytes += file.size;
    });

    if (!queue.length) {
        // Always toast validation failures (unsupported type, size, etc.).
        setAttachmentError(errors[0] || limits.unsupportedType);
        return { added: 0, errors: errors };
    }

    queue.forEach(function (file) {
        var localItem = {
            id: null,
            filename: file.name,
            mimeType: file.type || '',
            size: file.size,
            status: 'uploading',
            error: null
        };
        pendingAttachments.push(localItem);
        renderAttachmentBar();
        uploadAttachmentFile(file, localItem).catch(function () { /* toast already shown */ });
    });

    // Mixed batch: some files accepted, some rejected — still notify.
    if (errors.length) {
        setAttachmentError(errors[0]);
    }
    return { added: queue.length, errors: errors };
}

function openAttachmentPicker() {
    if (!attachmentInput) return;
    setAttachmentError('');
    if (pendingAttachments.length >= CHAT_ATTACHMENT_MAX_FILES) {
        setAttachmentError(attachmentLimitMessages().tooManyFiles);
        if (attachmentBar) attachmentBar.hidden = false;
        return;
    }
    attachmentInput.value = '';
    attachmentInput.click();
}

function parseStoredAttachmentNames(content) {
    var text = String(content || '');
    var match = text.match(/^\[syllentras-files:\s*([^\]]+)\]\s*(?:\n+)?([\s\S]*)$/i);
    if (!match) {
        return { filenames: [], displayText: text };
    }
    var filenames = match[1].split(',').map(function (part) {
        return part.trim();
    }).filter(Boolean);
    return {
        filenames: filenames,
        displayText: (match[2] || '').trim()
    };
}

function renderUserMessageContent(el, text, attachmentNames) {
    if (!el) return;
    el.textContent = '';

    var names = Array.isArray(attachmentNames) ? attachmentNames.slice() : [];
    var parsed = parseStoredAttachmentNames(text);
    if (!names.length && parsed.filenames.length) {
        names = parsed.filenames;
    }
    var displayText = names.length ? parsed.displayText : text;

    if (names.length) {
        var wrap = document.createElement('div');
        wrap.className = 'syllentras-msg-attachments';
        names.forEach(function (name) {
            var chip = document.createElement('span');
            chip.className = 'syllentras-msg-attachment-chip';
            chip.textContent = typeof name === 'string' ? name : (name.filename || name);
            wrap.appendChild(chip);
        });
        el.appendChild(wrap);
    }

    if (displayText) {
        var body = document.createElement('div');
        body.className = 'syllentras-msg-text';
        body.textContent = displayText;
        el.appendChild(body);
    } else if (!names.length) {
        el.textContent = text;
    }
}

function eventHasFiles(e) {
    var types = e && e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    if (typeof types.includes === 'function') return types.includes('Files');
    return Array.prototype.indexOf.call(types, 'Files') !== -1;
}

function setAttachmentDropHighlight(active) {
    if (!attachmentDropHost) return;
    attachmentDropHost.classList.toggle('is-file-dragover', !!active);
}

function clearAttachmentDropHighlight() {
    attachmentDragDepth = 0;
    setAttachmentDropHighlight(false);
}

function initAttachmentDragDrop() {
    attachmentDropHost = document.getElementById('syllentras-chat-main') || panel;
    if (!attachmentDropHost) return;

    attachmentDropHost.addEventListener('dragenter', function (e) {
        if (!eventHasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        attachmentDragDepth += 1;
        setAttachmentDropHighlight(true);
    });

    attachmentDropHost.addEventListener('dragover', function (e) {
        if (!eventHasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        setAttachmentDropHighlight(true);
    });

    attachmentDropHost.addEventListener('dragleave', function (e) {
        if (!eventHasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        attachmentDragDepth = Math.max(0, attachmentDragDepth - 1);
        if (attachmentDragDepth === 0) {
            setAttachmentDropHighlight(false);
        }
    });

    attachmentDropHost.addEventListener('drop', function (e) {
        if (!eventHasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        clearAttachmentDropHighlight();
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) {
            addAttachmentFiles(files);
        }
    });

    // Avoid the browser navigating away if a file is dropped outside the host.
    document.addEventListener('dragover', function (e) {
        if (eventHasFiles(e)) e.preventDefault();
    });
    document.addEventListener('drop', function (e) {
        if (eventHasFiles(e)) e.preventDefault();
    });
}

function initAttachments() {
    if (attachmentInput) {
        attachmentInput.setAttribute('accept', buildAcceptAttribute());
        attachmentInput.addEventListener('change', function () {
            addAttachmentFiles(attachmentInput.files);
            attachmentInput.value = '';
        });
    }
    initAttachmentDragDrop();
    renderAttachmentBar();
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
    } else if (role === 'user') {
        if (typeof renderUserMessageContent === 'function') {
            renderUserMessageContent(div, text, options.attachmentNames);
        } else {
            div.textContent = text;
        }
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
        if (typeof attachMessageSpeakButton === 'function') {
            attachMessageSpeakButton(div);
        }
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
    if (typeof stopMessageSpeech === 'function') {
        stopMessageSpeech();
    }
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
        var attachmentNames = [];
        if (Array.isArray(m.attachments) && m.attachments.length) {
            attachmentNames = m.attachments.map(function (a) {
                return a.filename || a;
            });
        }
        var opts = {
            scroll: false,
            createdAt: m.createdAt,
            mode: m.mode,
            id: m.id,
            attachmentNames: attachmentNames
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
    var attachmentsPayload = typeof getPendingAttachmentsForSend === 'function'
        ? getPendingAttachmentsForSend()
        : [];
    var hasAttachments = attachmentsPayload.length > 0;
    if ((!text && !hasAttachments) || !conversationId) return;

    if (typeof hasPendingAttachmentUploads === 'function' && hasPendingAttachmentUploads()) {
        if (typeof setAttachmentError === 'function') {
            setAttachmentError('Wait for uploads to finish before sending.');
        }
        return;
    }

    var failed = attachmentsPayload.filter(function (item) {
        return item.status === 'failed';
    });
    if (failed.length) {
        if (typeof setAttachmentError === 'function') {
            setAttachmentError('Remove failed attachments before sending.');
        }
        return;
    }

    if (typeof stopDictation === 'function') {
        stopDictation();
    }

    var attachmentNames = attachmentsPayload.map(function (item) {
        return item.filename;
    });
    var attachmentIds = attachmentsPayload.map(function (item) {
        return item.id;
    }).filter(Boolean);
    input.value = '';
    if (typeof clearPendingAttachments === 'function') {
        clearPendingAttachments();
    }
    send.disabled = true;
    setGeneratingState(true);

    var displayText = text || (hasAttachments ? 'Please review the attached file(s).' : '');
    appendMessage('user', displayText, {
        attachmentNames: attachmentNames
    });

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
    if (attachmentIds.length) {
        body.attachmentIds = attachmentIds;
    }
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
        if (typeof attachMessageSpeakButton === 'function') {
            attachMessageSpeakButton(loadingEl);
        }
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
        if (Array.isArray(data.attachmentWarnings) && data.attachmentWarnings.length) {
            if (typeof appendSystemNotice === 'function') {
                appendSystemNotice(data.attachmentWarnings.join(' '));
            }
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
    // Keep it under #syllentras-chat-root so theme colors (panel bg, text, etc.) actually apply.
    // Dropping it on document.body made background: var(--syll-panel-bg) resolve to nothing.
    (root || document.body).appendChild(menu);

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
            topicsCol.hidden = false;
            selectFirstTopicIfNeeded(topicsCol);
            updateContinueState(topicsCol);
        });
        toolsCol.appendChild(button);
    });

    var attachBtn = document.createElement('button');
    attachBtn.type = 'button';
    attachBtn.className = 'syllentras-tools-menu-item syllentras-tools-attach-item';
    attachBtn.setAttribute('role', 'menuitem');
    attachBtn.dataset.toolKey = 'attach_files';

    var attachRow = document.createElement('span');
    attachRow.className = 'syllentras-tools-attach-row';

    var attachIcon = document.createElement('span');
    attachIcon.className = 'syllentras-tools-attach-icon';
    attachIcon.setAttribute('aria-hidden', 'true');
    attachIcon.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" focusable="false">' +
        '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" ' +
        'stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';

    var attachText = document.createElement('span');
    attachText.className = 'syllentras-tools-attach-text';

    var attachLabel = document.createElement('span');
    attachLabel.className = 'syllentras-tools-menu-item-label';
    attachLabel.textContent = 'Attach files';

    var attachDesc = document.createElement('span');
    attachDesc.className = 'syllentras-tools-menu-item-desc';
    attachDesc.textContent = 'Drop files here or browse';

    attachText.appendChild(attachLabel);
    attachText.appendChild(attachDesc);
    attachRow.appendChild(attachIcon);
    attachRow.appendChild(attachText);
    attachBtn.appendChild(attachRow);
    attachBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeToolsMenu();
        if (typeof openAttachmentPicker === 'function') {
            openAttachmentPicker();
        }
    });
    toolsCol.appendChild(attachBtn);

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
var aiContentSearchQuery = '';
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
    var needle = (aiContentSearchQuery || '').trim().toLowerCase();
    var filtered = aiContentItems.filter(function (item) {
        if (selectedKindCount() > 0 && !aiContentFilterKinds[item.kind]) {
            return false;
        }
        if (needle) {
            var name = String(item.name || '').toLowerCase();
            if (name.indexOf(needle) === -1) return false;
        }
        return true;
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
        if ((aiContentSearchQuery || '').trim()) {
            aiContentEmptyEl.textContent = 'No items match your search.';
        } else if (selectedKindCount() > 0) {
            aiContentEmptyEl.textContent = 'No items match the selected type filter.';
        } else {
            aiContentEmptyEl.textContent = 'No items match.';
        }
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

function resetAiContentListControls() {
    aiContentSearchQuery = '';
    aiContentSortKey = 'course';
    aiContentSortDir = 'asc';
    aiContentFilterKinds = {};
    aiContentBulkMode = false;
    aiContentSelected = {};
    closeAiContentDropdowns();
    closeAiContentMenu();

    if (aiContentToolbar) {
        var searchInput = aiContentToolbar.querySelector('#syllentras-ai-content-search');
        if (searchInput) searchInput.value = '';
        Array.from(aiContentToolbar.querySelectorAll('#syllentras-ai-filter-panel input[type="checkbox"]')).forEach(
            function (box) {
                box.checked = false;
            }
        );
    }

    renderAiContentList();
}

function bindAiContentToolbar() {
    if (!aiContentToolbar) return;

    var searchInput = aiContentToolbar.querySelector('#syllentras-ai-content-search');
    var sortBtn = aiContentToolbar.querySelector('#syllentras-ai-sort-btn');
    var sortPanel = aiContentToolbar.querySelector('#syllentras-ai-sort-panel');
    var filterBtn = aiContentToolbar.querySelector('#syllentras-ai-filter-btn');
    var filterPanel = aiContentToolbar.querySelector('#syllentras-ai-filter-panel');
    var bulkToggle = aiContentToolbar.querySelector('#syllentras-ai-bulk-toggle');
    var resetBtn = aiContentToolbar.querySelector('#syllentras-ai-content-reset');
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

    if (searchInput) {
        searchInput.value = aiContentSearchQuery || '';
        searchInput.addEventListener('input', function () {
            aiContentSearchQuery = searchInput.value || '';
            renderAiContentList();
        });
        searchInput.addEventListener('click', function (e) {
            e.stopPropagation();
        });
        searchInput.addEventListener('keydown', function (e) {
            e.stopPropagation();
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            resetAiContentListControls();
        });
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

// ===== display-settings.js =====
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
var displaySpeechRateValueEl = null;
var displaySpeechRateSlider = null;

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
    if (typeof resetSpeechSettings === 'function') {
        resetSpeechSettings();
    }
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

    if (typeof speechRateInfo === 'function' && typeof selectedSpeechRateStep !== 'undefined') {
        var rateInfo = speechRateInfo(selectedSpeechRateStep);
        if (displaySpeechRateValueEl) {
            displaySpeechRateValueEl.textContent = rateInfo.label;
        }
        if (displaySpeechRateSlider) {
            displaySpeechRateSlider.value = String(rateInfo.step);
            displaySpeechRateSlider.setAttribute('aria-valuetext', rateInfo.label);
        }
    }

    Array.from(displayMenu.querySelectorAll('.syllentras-display-theme-btn')).forEach(function (btn) {
        var active = btn.dataset.themeId === selectedDisplayTheme;
        btn.classList.toggle('selected', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    Array.from(displayMenu.querySelectorAll('.syllentras-display-voice-btn')).forEach(function (btn) {
        var active = typeof selectedSpeechVoice !== 'undefined'
            && btn.dataset.voiceId === selectedSpeechVoice;
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

    // Voice + speed only show up when the browser can actually talk.
    if (typeof speechSupported === 'function' && speechSupported()
        && typeof SPEECH_VOICES !== 'undefined'
        && typeof SPEECH_RATE_STEPS !== 'undefined') {
        var voiceSection = document.createElement('div');
        voiceSection.className = 'syllentras-display-section';

        var voiceLabel = document.createElement('div');
        voiceLabel.className = 'syllentras-display-label';
        voiceLabel.textContent = 'Voice';
        voiceSection.appendChild(voiceLabel);

        var voiceList = document.createElement('div');
        voiceList.className = 'syllentras-display-theme-list';
        voiceList.setAttribute('role', 'group');
        voiceList.setAttribute('aria-label', 'Read aloud voice');

        SPEECH_VOICES.forEach(function (voice) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'syllentras-display-theme-btn syllentras-display-voice-btn';
            btn.dataset.voiceId = voice.id;
            btn.textContent = voice.label;
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                setSpeechVoicePreference(voice.id);
                syncDisplayMenuUi();
            });
            voiceList.appendChild(btn);
        });
        voiceSection.appendChild(voiceList);
        displayMenu.appendChild(voiceSection);

        var rateSection = document.createElement('div');
        rateSection.className = 'syllentras-display-section';

        var rateLabel = document.createElement('div');
        rateLabel.className = 'syllentras-display-label';
        rateLabel.textContent = 'Speech speed';
        rateSection.appendChild(rateLabel);

        displaySpeechRateValueEl = document.createElement('div');
        displaySpeechRateValueEl.className = 'syllentras-display-value';
        displaySpeechRateValueEl.id = 'syllentras-display-speech-rate-value';
        rateSection.appendChild(displaySpeechRateValueEl);

        displaySpeechRateSlider = document.createElement('input');
        displaySpeechRateSlider.type = 'range';
        displaySpeechRateSlider.className = 'syllentras-display-slider';
        displaySpeechRateSlider.min = '1';
        displaySpeechRateSlider.max = String(SPEECH_RATE_STEPS.length);
        displaySpeechRateSlider.step = '1';
        displaySpeechRateSlider.setAttribute('aria-label', 'Speech speed');
        displaySpeechRateSlider.setAttribute(
            'aria-valuetext',
            speechRateInfo(selectedSpeechRateStep).label
        );
        displaySpeechRateSlider.addEventListener('input', function () {
            setSpeechRateStep(displaySpeechRateSlider.value);
            displaySpeechRateSlider.setAttribute(
                'aria-valuetext',
                speechRateInfo(selectedSpeechRateStep).label
            );
            syncDisplayMenuUi();
        });
        displaySpeechRateSlider.addEventListener('click', function (e) {
            e.stopPropagation();
        });
        rateSection.appendChild(displaySpeechRateSlider);
        displayMenu.appendChild(rateSection);
    }

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
    resetBtn.textContent = 'Reset';
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
    if (typeof stopDictation === 'function') {
        stopDictation();
    }
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
    if (isMobileLayout() || e.button !== 0 || e.target.closest('button') || e.target.closest('.syllentras-display-wrap') || e.target.closest('.syllentras-panel-resize-handle')) return;

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
        if (typeof closeDisplayMenu === 'function') closeDisplayMenu();
        if (typeof closeAiContentMenu === 'function') closeAiContentMenu();
        if (!modal.hidden) closeModal();
    }
});

window.addEventListener('resize', function () {
    closeToolsMenu();
    if (typeof closeModeMenu === 'function') closeModeMenu();
    if (typeof closeDisplayMenu === 'function') closeDisplayMenu();
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
initAttachments();
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
