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
