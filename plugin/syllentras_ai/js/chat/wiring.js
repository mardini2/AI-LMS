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
    openConversation({ type: 'general', title: 'Main' });
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
    if (openToolsMenu && !openToolsMenu.contains(e.target) && !e.target.closest('#syllentras-chat-tools-btn')) {
        closeToolsMenu();
    }
});

modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        closeConversationMenu();
        closeToolsMenu();
        if (!modal.hidden) closeModal();
    }
});

window.addEventListener('resize', function () {
    closeToolsMenu();
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
loadConversations();
installSectionButtons();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installSectionButtons);
}
// Some Moodle course formats finish rendering section markup after this footer hook runs.
window.setTimeout(installSectionButtons, 500);
