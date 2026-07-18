// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function clearPendingActionUi(root) {
    var scope = root || msgs;
    Array.from(scope.querySelectorAll('.syllentras-pending-action, .syllentras-review-offer')).forEach(function (node) {
        node.remove();
    });
}

function attachPendingAction(messageEl, pendingAction) {
    if (!messageEl || !pendingAction || !pendingAction.id) return;
    clearPendingActionUi(messageEl);

    var wrap = document.createElement('div');
    wrap.className = 'syllentras-pending-action';
    wrap.dataset.actionId = pendingAction.id;

    var summary = document.createElement('div');
    summary.className = 'syllentras-pending-summary';
    summary.innerHTML = '<strong></strong><div></div><div></div>';
    summary.querySelector('strong').textContent = pendingAction.title || 'Practice quiz';
    summary.children[1].textContent = (pendingAction.questionCount || '?')
        + ' questions (multiple choice and true/false)';
    summary.children[2].textContent = 'Covers: ' + (pendingAction.scopeSummary || 'course material');
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
        confirmBtn.textContent = busy ? 'Creating...' : 'Confirm';
    }

    confirmBtn.addEventListener('click', function () {
        setBusy(true);
        fetchJson('/chat/actions/confirm', {
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
            return loadConversations().then(loadReviewOfferForConversation);
        })
        .catch(function () {
            setBusy(false);
            appendMessage('error', 'Could not create the practice quiz. Please try again.');
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

