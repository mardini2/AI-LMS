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
        .catch(function () {
            setBusy(false);
            appendMessage('error', createFailedMessage());
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
