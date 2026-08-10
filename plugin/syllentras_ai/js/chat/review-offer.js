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
    if (typeof stickToBottomIfNeeded === 'function') {
        stickToBottomIfNeeded({ afterLayout: true });
    } else {
        msgs.scrollTop = msgs.scrollHeight;
    }
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

