/**
 * Progressive enhancement for Syllentras AI flashcards Pages.
 * Study mode: single-card carousel + self-check scoring.
 * Edit mode: full grid with add/delete/reorder + save via Nest API.
 */
(function () {
    'use strict';

    var CARD_COUNT_MIN = 8;
    var CARD_COUNT_MAX = 40;

    function ready(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    function shuffleInPlace(arr) {
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
        return arr;
    }

    function readChatConfig() {
        var root = document.getElementById('syllentras-chat-root');
        if (!root) {
            return null;
        }
        var raw = root.getAttribute('data-config');
        if (!raw) {
            return null;
        }
        try {
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function resolveCmId() {
        try {
            var params = new URLSearchParams(window.location.search);
            var id = parseInt(params.get('id') || '', 10);
            return Number.isFinite(id) && id > 0 ? id : 0;
        } catch (e) {
            return 0;
        }
    }

    function textContentOf(el) {
        return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    }

    function cloneCards(cards) {
        return cards.map(function (c) {
            return { front: c.front, back: c.back };
        });
    }

    function ensureStudyChrome(root, grid) {
        var stage = root.querySelector('.syll-fc-stage');
        if (!stage) {
            stage = document.createElement('div');
            stage.className = 'syll-fc-stage';
            grid.parentNode.insertBefore(stage, grid);
            stage.appendChild(grid);
        }

        var toolbar = root.querySelector('.syll-fc-toolbar');
        if (!toolbar) {
            toolbar = document.createElement('div');
            toolbar.className = 'syll-fc-toolbar';
            var progress = document.createElement('span');
            progress.className = 'syll-fc-progress';
            progress.setAttribute('aria-live', 'polite');
            toolbar.appendChild(progress);
            stage.parentNode.insertBefore(toolbar, stage);
        }

        var progressEl = toolbar.querySelector('.syll-fc-progress');
        if (!progressEl) {
            progressEl = document.createElement('span');
            progressEl.className = 'syll-fc-progress';
            progressEl.setAttribute('aria-live', 'polite');
            toolbar.appendChild(progressEl);
        }

        var studyControls = toolbar.querySelector('.syll-fc-study-controls');
        if (!studyControls) {
            studyControls = document.createElement('div');
            studyControls.className = 'syll-fc-study-controls';
            toolbar.appendChild(studyControls);
        }

        var editControls = toolbar.querySelector('.syll-fc-edit-controls');
        if (!editControls) {
            editControls = document.createElement('div');
            editControls.className = 'syll-fc-edit-controls';
            editControls.hidden = true;
            toolbar.appendChild(editControls);
        }

        var restartBtn =
            studyControls.querySelector('.syll-fc-btn-restart') ||
            toolbar.querySelector('.syll-fc-btn-restart') ||
            root.querySelector('.syll-fc-btn-restart');
        if (!restartBtn) {
            restartBtn = document.createElement('button');
            restartBtn.type = 'button';
            restartBtn.className = 'syll-fc-btn syll-fc-btn-restart';
            restartBtn.textContent = 'Shuffle & try again';
        }
        if (restartBtn.parentNode !== studyControls) {
            studyControls.appendChild(restartBtn);
        }

        var editBtn = studyControls.querySelector('.syll-fc-btn-edit');
        if (!editBtn) {
            editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'syll-fc-btn syll-fc-btn-edit';
            editBtn.textContent = 'Edit';
            studyControls.appendChild(editBtn);
        }

        var liveScoreEl = studyControls.querySelector('.syll-fc-score-live');
        if (!liveScoreEl) {
            liveScoreEl = document.createElement('span');
            liveScoreEl.className = 'syll-fc-score-live';
            liveScoreEl.setAttribute('aria-live', 'polite');
            liveScoreEl.textContent = 'Score: 0 / 0';
        }
        if (liveScoreEl.parentNode !== studyControls || liveScoreEl.previousSibling !== editBtn) {
            if (editBtn.nextSibling) {
                studyControls.insertBefore(liveScoreEl, editBtn.nextSibling);
            } else {
                studyControls.appendChild(liveScoreEl);
            }
        }

        var addBtn = editControls.querySelector('.syll-fc-btn-add');
        if (!addBtn) {
            addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'syll-fc-btn syll-fc-btn-add';
            addBtn.textContent = 'Add card';
            editControls.appendChild(addBtn);
        }

        // Save / Cancel live on the AI Content manage bar — remove any legacy buttons.
        Array.prototype.forEach.call(
            editControls.querySelectorAll('.syll-fc-btn-save, .syll-fc-btn-cancel'),
            function (btn) {
                btn.remove();
            }
        );

        var hintEl = toolbar.querySelector('.syll-fc-edit-hint');
        if (!hintEl) {
            hintEl = document.createElement('p');
            hintEl.className = 'syll-fc-edit-hint';
            hintEl.hidden = true;
            toolbar.appendChild(hintEl);
        }

        var errorEl = toolbar.querySelector('.syll-fc-edit-error');
        if (!errorEl) {
            errorEl = document.createElement('p');
            errorEl.className = 'syll-fc-edit-error';
            errorEl.hidden = true;
            toolbar.appendChild(errorEl);
        }

        var actions = root.querySelector('.syll-fc-actions');
        if (!actions) {
            actions = document.createElement('div');
            actions.className = 'syll-fc-actions';
            actions.innerHTML =
                '<button type="button" class="syll-fc-btn syll-fc-btn-correct">Got it</button>' +
                '<button type="button" class="syll-fc-btn syll-fc-btn-incorrect">Missed it</button>';
            stage.parentNode.insertBefore(actions, stage.nextSibling);
        }

        var results = root.querySelector('.syll-fc-results');
        if (!results) {
            results = document.createElement('div');
            results.className = 'syll-fc-results';
            results.innerHTML = '<p class="syll-fc-score" aria-live="polite"></p>';
            var footer = root.querySelector('.syll-fc-footer');
            if (footer) {
                root.insertBefore(results, footer);
            } else {
                root.appendChild(results);
            }
        }

        var scoreEl = results.querySelector('.syll-fc-score');
        if (!scoreEl) {
            scoreEl = document.createElement('p');
            scoreEl.className = 'syll-fc-score';
            scoreEl.setAttribute('aria-live', 'polite');
            results.insertBefore(scoreEl, results.firstChild);
        }

        var editBoard = root.querySelector('.syll-fc-edit-board');
        if (!editBoard) {
            editBoard = document.createElement('div');
            editBoard.className = 'syll-fc-edit-board';
            editBoard.hidden = true;
            stage.parentNode.insertBefore(editBoard, actions);
        }

        var intro = root.querySelector('.syll-fc-intro');
        if (!intro) {
            var firstP = root.querySelector(':scope > p');
            if (firstP && !firstP.classList.contains('syll-fc-footer')) {
                intro = firstP;
                intro.classList.add('syll-fc-intro');
            }
        }
        if (intro && /click a card to flip/i.test(intro.textContent || '')) {
            intro.textContent = 'Flip the card, then mark whether you got it right.';
        }

        Array.prototype.forEach.call(root.querySelectorAll(':scope > h1'), function (heading) {
            heading.hidden = true;
        });

        return {
            stage: stage,
            toolbar: toolbar,
            progressEl: progressEl,
            studyControls: studyControls,
            editControls: editControls,
            restartBtn: restartBtn,
            editBtn: editBtn,
            addBtn: addBtn,
            hintEl: hintEl,
            errorEl: errorEl,
            actions: actions,
            correctBtn: actions.querySelector('.syll-fc-btn-correct'),
            incorrectBtn: actions.querySelector('.syll-fc-btn-incorrect'),
            results: results,
            scoreEl: scoreEl,
            liveScoreEl: liveScoreEl,
            editBoard: editBoard,
            intro: intro,
        };
    }

    function initDeck(root) {
        var grid = root.querySelector('.syll-fc-grid');
        if (!grid) {
            return;
        }

        var studyCards = Array.prototype.slice.call(grid.querySelectorAll('.syll-fc-card'));
        if (studyCards.length < 1) {
            return;
        }

        var chrome = ensureStudyChrome(root, grid);
        var config = readChatConfig();
        var cmId = resolveCmId();
        var canEdit =
            !!(config && config.apiUrl && config.courseId > 1 && config.moodleUserId > 0 && cmId > 0);

        root.classList.add('is-study');
        root.classList.remove('is-edit');
        root.setAttribute('data-syll-fc-study', '1');

        chrome.toolbar.hidden = false;
        chrome.actions.hidden = false;
        chrome.results.hidden = true;
        chrome.editControls.hidden = true;
        chrome.editBoard.hidden = true;
        // Edit lives on the AI Content manage bar (Rename / Edit / Delete).
        chrome.editBtn.hidden = true;

        var order = studyCards.map(function (_, i) {
            return i;
        });
        var current = 0;
        var marks = [];
        var flipped = false;
        var mode = 'study';
        var editModel = [];
        var editSnapshot = [];

        function cardAt(orderIndex) {
            return studyCards[order[orderIndex]];
        }

        function extractCardsFromDom() {
            return studyCards.map(function (card) {
                return {
                    front: textContentOf(card.querySelector('.syll-fc-prompt')),
                    back: textContentOf(card.querySelector('.syll-fc-answer')),
                };
            });
        }

        function resetCardFlip(card) {
            if (!card) {
                return;
            }
            card.classList.remove('is-flipped');
            var toggle = card.querySelector('.syll-fc-toggle');
            if (toggle) {
                toggle.checked = false;
                toggle.disabled = true;
            }
            var face = card.querySelector('.syll-fc-face');
            if (face && face.getAttribute('for')) {
                face.removeAttribute('for');
                face.setAttribute('role', 'button');
                face.setAttribute('tabindex', '0');
            }
        }

        function updateIndexLabels() {
            var total = order.length;
            order.forEach(function (cardIndex, displayIndex) {
                var card = studyCards[cardIndex];
                var label = displayIndex + 1 + ' / ' + total;
                Array.prototype.forEach.call(
                    card.querySelectorAll('.syll-fc-index'),
                    function (el) {
                        el.textContent = label;
                    }
                );
            });
        }

        function setActionsEnabled(enabled) {
            if (mode !== 'study') {
                return;
            }
            chrome.actions.hidden = false;
            if (chrome.correctBtn) {
                chrome.correctBtn.disabled = !enabled;
            }
            if (chrome.incorrectBtn) {
                chrome.incorrectBtn.disabled = !enabled;
            }
        }

        function updateLiveScore() {
            if (!chrome.liveScoreEl) {
                return;
            }
            var correct = 0;
            for (var i = 0; i < marks.length; i++) {
                if (marks[i] === true) {
                    correct += 1;
                }
            }
            chrome.liveScoreEl.textContent =
                'Score: ' + correct + ' / ' + order.length;
        }

        function showCard(index) {
            if (mode !== 'study') {
                return;
            }
            current = index;
            flipped = false;
            studyCards.forEach(function (card) {
                card.classList.remove('is-active', 'is-flipped');
                card.hidden = true;
                resetCardFlip(card);
            });

            var card = cardAt(current);
            if (!card) {
                return;
            }
            card.hidden = false;
            card.classList.add('is-active');
            chrome.progressEl.textContent =
                'Card: ' + (current + 1) + ' / ' + order.length;
            updateLiveScore();
            chrome.toolbar.hidden = false;
            chrome.results.hidden = true;
            setActionsEnabled(false);
        }

        function flipActive() {
            if (mode !== 'study' || !chrome.results.hidden) {
                return;
            }
            var card = cardAt(current);
            if (!card || marks[current] != null) {
                return;
            }
            flipped = !flipped;
            card.classList.toggle('is-flipped', flipped);
            setActionsEnabled(flipped);
        }

        function showResults() {
            var correct = 0;
            for (var i = 0; i < marks.length; i++) {
                if (marks[i] === true) {
                    correct += 1;
                }
            }
            var total = order.length;
            var percent = total > 0 ? Math.round((correct / total) * 100) : 0;
            chrome.scoreEl.textContent =
                'You got ' + correct + ' / ' + total + ' correct (' + percent + '%).';
            updateLiveScore();
            chrome.toolbar.hidden = false;
            chrome.progressEl.textContent = 'Done';
            chrome.actions.hidden = true;
            if (chrome.correctBtn) {
                chrome.correctBtn.disabled = true;
            }
            if (chrome.incorrectBtn) {
                chrome.incorrectBtn.disabled = true;
            }
            studyCards.forEach(function (card) {
                card.hidden = true;
                card.classList.remove('is-active', 'is-flipped');
            });
            chrome.results.hidden = false;
        }

        function mark(isCorrect) {
            if (!flipped || marks[current] != null) {
                return;
            }
            marks[current] = isCorrect;
            updateLiveScore();
            setActionsEnabled(false);
            if (current >= order.length - 1) {
                showResults();
                return;
            }
            showCard(current + 1);
        }

        function restart() {
            if (mode !== 'study') {
                return;
            }
            shuffleInPlace(order);
            marks = [];
            updateIndexLabels();
            chrome.results.hidden = true;
            showCard(0);
        }

        function setEditError(message) {
            if (!message) {
                chrome.errorEl.hidden = true;
                chrome.errorEl.textContent = '';
                return;
            }
            chrome.errorEl.hidden = false;
            chrome.errorEl.textContent = message;
        }

        function updateEditHints() {
            var n = editModel.length;
            chrome.addBtn.disabled = n >= CARD_COUNT_MAX;
            var hint = '';
            if (n <= CARD_COUNT_MIN) {
                hint = 'Minimum ' + CARD_COUNT_MIN + ' cards.';
            } else if (n >= CARD_COUNT_MAX) {
                hint = 'Maximum ' + CARD_COUNT_MAX + ' cards.';
            }
            chrome.hintEl.textContent = hint;
            chrome.hintEl.hidden = !hint;
            chrome.progressEl.textContent = 'Editing · ' + n + ' cards';
        }

        function syncModelFromEditors() {
            var rows = chrome.editBoard.querySelectorAll('.syll-fc-edit-card');
            Array.prototype.forEach.call(rows, function (row, index) {
                if (!editModel[index]) {
                    return;
                }
                var front = row.querySelector('.syll-fc-edit-front');
                var back = row.querySelector('.syll-fc-edit-back');
                editModel[index].front = front ? front.value : '';
                editModel[index].back = back ? back.value : '';
            });
        }

        var editSortable = null;
        var openEditMenu = null;
        var pendingDeleteIndex = -1;

        function destroyEditSortable() {
            if (editSortable) {
                editSortable.destroy();
                editSortable = null;
            }
        }

        function closeEditCardMenu() {
            if (openEditMenu) {
                openEditMenu.remove();
                openEditMenu = null;
            }
            Array.prototype.forEach.call(
                chrome.editBoard.querySelectorAll('.syll-fc-edit-menu-btn.open'),
                function (btn) {
                    btn.classList.remove('open');
                }
            );
        }

        function closeFlashcardModal() {
            var modal = document.getElementById('syllentras-chat-modal');
            if (modal) {
                modal.hidden = true;
            }
            pendingDeleteIndex = -1;
        }

        function showFlashcardModal(title, bodyText, actions) {
            var modal = document.getElementById('syllentras-chat-modal');
            if (!modal) {
                window.alert(bodyText);
                return;
            }
            closeEditCardMenu();
            modal.querySelector('#syllentras-modal-title').textContent = title;
            var body = modal.querySelector('#syllentras-modal-body');
            var actionArea = modal.querySelector('#syllentras-modal-actions');
            body.textContent = bodyText;
            actionArea.innerHTML = '';
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
            if (firstButton) {
                firstButton.focus();
            }
        }

        function refreshEditCardTitles() {
            Array.prototype.forEach.call(
                chrome.editBoard.querySelectorAll('.syll-fc-edit-card'),
                function (row, index) {
                    row.setAttribute('data-edit-index', String(index));
                    var title = row.querySelector('.syll-fc-edit-card-title');
                    if (title) {
                        title.textContent = 'Card ' + (index + 1);
                    }
                    var menuBtn = row.querySelector('.syll-fc-edit-menu-btn');
                    if (menuBtn) {
                        menuBtn.setAttribute(
                            'aria-label',
                            'Card ' + (index + 1) + ' menu'
                        );
                    }
                }
            );
            updateEditHints();
        }

        function initEditSortable() {
            destroyEditSortable();
            if (typeof Sortable === 'undefined' || !chrome.editBoard) {
                return;
            }
            editSortable = Sortable.create(chrome.editBoard, {
                animation: 150,
                draggable: '.syll-fc-edit-card',
                filter: 'textarea, button, .syll-fc-edit-menu, .syll-fc-edit-menu *',
                preventOnFilter: false,
                ghostClass: 'syll-fc-sortable-ghost',
                chosenClass: 'syll-fc-sortable-chosen',
                dragClass: 'syll-fc-sortable-drag',
                onStart: function () {
                    closeEditCardMenu();
                    syncModelFromEditors();
                },
                onEnd: function (evt) {
                    var oldIndex = evt.oldIndex;
                    var newIndex = evt.newIndex;
                    if (
                        oldIndex == null ||
                        newIndex == null ||
                        oldIndex === newIndex ||
                        oldIndex < 0 ||
                        newIndex < 0
                    ) {
                        refreshEditCardTitles();
                        return;
                    }
                    syncModelFromEditors();
                    var item = editModel.splice(oldIndex, 1)[0];
                    editModel.splice(newIndex, 0, item);
                    refreshEditCardTitles();
                },
            });
        }

        function showEditCardMenu(anchor, index) {
            closeEditCardMenu();
            anchor.classList.add('open');
            var menu = document.createElement('div');
            menu.className = 'syll-fc-edit-menu';
            menu.setAttribute('role', 'menu');

            var deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'syll-fc-edit-menu-action danger';
            deleteBtn.setAttribute('role', 'menuitem');
            deleteBtn.textContent = 'Delete';
            deleteBtn.disabled = editModel.length <= CARD_COUNT_MIN;
            deleteBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                closeEditCardMenu();
                if (!deleteBtn.disabled) {
                    requestDeleteCard(index);
                }
            });
            menu.appendChild(deleteBtn);
            document.body.appendChild(menu);

            var rect = anchor.getBoundingClientRect();
            menu.style.left = Math.max(8, rect.right - 140) + 'px';
            menu.style.top =
                Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4) +
                'px';
            openEditMenu = menu;
        }

        function requestDeleteCard(index) {
            syncModelFromEditors();
            if (editModel.length <= CARD_COUNT_MIN) {
                showFlashcardModal(
                    'Cannot delete card',
                    'Flashcards need at least ' + CARD_COUNT_MIN + ' cards.',
                    [
                        {
                            label: 'OK',
                            className: 'syllentras-modal-secondary',
                            onClick: closeFlashcardModal,
                        },
                    ]
                );
                return;
            }
            pendingDeleteIndex = index;
            showFlashcardModal(
                'Delete card?',
                'Delete Card ' +
                    (index + 1) +
                    '? This cannot be undone until you Cancel edit.',
                [
                    {
                        label: 'Cancel',
                        className: 'syllentras-modal-secondary',
                        onClick: closeFlashcardModal,
                    },
                    {
                        label: 'Delete',
                        className: 'syllentras-modal-danger',
                        onClick: confirmDeleteCard,
                    },
                ]
            );
        }

        function confirmDeleteCard() {
            var index = pendingDeleteIndex;
            closeFlashcardModal();
            if (index < 0 || index >= editModel.length) {
                return;
            }
            if (editModel.length <= CARD_COUNT_MIN) {
                return;
            }
            syncModelFromEditors();
            editModel.splice(index, 1);
            renderEditBoard();
        }

        function renderEditBoard() {
            closeEditCardMenu();
            destroyEditSortable();
            chrome.editBoard.innerHTML = '';
            editModel.forEach(function (card, index) {
                var row = document.createElement('div');
                row.className = 'syll-fc-edit-card';
                row.setAttribute('data-edit-index', String(index));

                var heading = document.createElement('div');
                heading.className = 'syll-fc-edit-card-head';

                var headingLabel = document.createElement('span');
                headingLabel.className = 'syll-fc-edit-card-title';
                headingLabel.textContent = 'Card ' + (index + 1);
                heading.appendChild(headingLabel);

                var menuBtn = document.createElement('button');
                menuBtn.type = 'button';
                menuBtn.className = 'syll-fc-edit-menu-btn';
                menuBtn.setAttribute('aria-label', 'Card ' + (index + 1) + ' menu');
                menuBtn.setAttribute('aria-haspopup', 'menu');
                menuBtn.innerHTML = '&#8942;';
                menuBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (menuBtn.classList.contains('open')) {
                        closeEditCardMenu();
                        return;
                    }
                    showEditCardMenu(menuBtn, index);
                });
                heading.appendChild(menuBtn);
                row.appendChild(heading);

                var frontLabel = document.createElement('label');
                frontLabel.className = 'syll-fc-edit-label';
                frontLabel.textContent = 'Front';
                var frontInput = document.createElement('textarea');
                frontInput.className = 'syll-fc-edit-front';
                frontInput.rows = 3;
                frontInput.value = card.front;
                frontLabel.appendChild(frontInput);
                row.appendChild(frontLabel);

                var backLabel = document.createElement('label');
                backLabel.className = 'syll-fc-edit-label';
                backLabel.textContent = 'Back';
                var backInput = document.createElement('textarea');
                backInput.className = 'syll-fc-edit-back';
                backInput.rows = 4;
                backInput.value = card.back;
                backLabel.appendChild(backInput);
                row.appendChild(backLabel);

                chrome.editBoard.appendChild(row);
            });
            updateEditHints();
            initEditSortable();
        }

        function addCard() {
            syncModelFromEditors();
            if (editModel.length >= CARD_COUNT_MAX) {
                return;
            }
            editModel.push({ front: '', back: '' });
            renderEditBoard();
            var last = chrome.editBoard.lastElementChild;
            if (last && last.scrollIntoView) {
                last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }

        function enterEditMode() {
            if (!canEdit || mode === 'edit') {
                return false;
            }
            mode = 'edit';
            setEditError('');
            editModel = extractCardsFromDom();
            editSnapshot = cloneCards(editModel);
            root.classList.remove('is-study');
            root.classList.add('is-edit');
            chrome.stage.hidden = true;
            chrome.actions.hidden = true;
            chrome.results.hidden = true;
            chrome.studyControls.hidden = true;
            chrome.editControls.hidden = false;
            chrome.editBoard.hidden = false;
            if (chrome.intro) {
                chrome.intro.textContent =
                    'Drag cards to reorder. Use the menu to delete. Save when done.';
            }
            renderEditBoard();
            return true;
        }

        function exitEditMode(restoreStudy) {
            mode = 'study';
            setEditError('');
            closeEditCardMenu();
            closeFlashcardModal();
            destroyEditSortable();
            chrome.hintEl.hidden = true;
            root.classList.remove('is-edit');
            root.classList.add('is-study');
            chrome.editBoard.hidden = true;
            chrome.editBoard.innerHTML = '';
            chrome.editControls.hidden = true;
            chrome.studyControls.hidden = false;
            chrome.stage.hidden = false;
            chrome.addBtn.disabled = false;
            if (chrome.intro) {
                chrome.intro.textContent =
                    'Flip the card, then mark whether you got it right.';
            }
            if (restoreStudy) {
                chrome.results.hidden = true;
                updateLiveScore();
                showCard(Math.min(current, order.length - 1));
            }
        }

        function cancelEdit() {
            if (mode !== 'edit') {
                return;
            }
            editModel = cloneCards(editSnapshot);
            exitEditMode(true);
        }

        function saveEdit() {
            if (!canEdit || !config || mode !== 'edit') {
                return Promise.reject(new Error('Flashcard editor is not ready yet.'));
            }
            syncModelFromEditors();
            setEditError('');

            var filled = editModel.filter(function (c) {
                return c.front.trim() && c.back.trim();
            });
            if (filled.length < CARD_COUNT_MIN) {
                var tooFew =
                    'Fill at least ' +
                    CARD_COUNT_MIN +
                    ' cards on both sides before saving.';
                setEditError(tooFew);
                return Promise.reject(new Error(tooFew));
            }
            if (filled.length > CARD_COUNT_MAX) {
                var tooMany = 'You can save at most ' + CARD_COUNT_MAX + ' cards.';
                setEditError(tooMany);
                return Promise.reject(new Error(tooMany));
            }

            chrome.addBtn.disabled = true;

            return fetch(
                String(config.apiUrl).replace(/\/$/, '') + '/flashcards/update',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        courseId: config.courseId,
                        moodleUserId: config.moodleUserId,
                        cmId: cmId,
                        title: document.title || 'Flashcards',
                        cards: filled,
                    }),
                }
            )
                .then(function (res) {
                    if (!res.ok) {
                        return res
                            .json()
                            .catch(function () {
                                return {};
                            })
                            .then(function (body) {
                                var msg =
                                    (body && (body.message || body.error)) ||
                                    'HTTP ' + res.status;
                                throw new Error(msg);
                            });
                    }
                    return res.json();
                })
                .then(function () {
                    window.location.reload();
                })
                .catch(function (err) {
                    chrome.addBtn.disabled = false;
                    updateEditHints();
                    var message =
                        err && err.message
                            ? String(err.message)
                            : 'Could not save flashcards. Try again.';
                    setEditError(message);
                    throw new Error(message);
                });
        }

        studyCards.forEach(function (card) {
            resetCardFlip(card);
            var face = card.querySelector('.syll-fc-face');
            if (!face) {
                return;
            }
            face.addEventListener('mousedown', function (e) {
                e.preventDefault();
            });
            face.addEventListener('click', function (e) {
                e.preventDefault();
                if (mode !== 'study' || !card.classList.contains('is-active')) {
                    return;
                }
                flipActive();
            });
            face.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (mode !== 'study' || !card.classList.contains('is-active')) {
                        return;
                    }
                    flipActive();
                }
            });
        });

        if (chrome.correctBtn) {
            chrome.correctBtn.addEventListener('click', function () {
                mark(true);
            });
        }
        if (chrome.incorrectBtn) {
            chrome.incorrectBtn.addEventListener('click', function () {
                mark(false);
            });
        }
        chrome.restartBtn.addEventListener('click', restart);
        chrome.editBtn.addEventListener('click', enterEditMode);
        chrome.addBtn.addEventListener('click', addCard);

        window.__SYLL_FC_ENTER_EDIT__ = function () {
            return enterEditMode();
        };
        window.__SYLL_FC_CANCEL_EDIT__ = function () {
            cancelEdit();
        };
        window.__SYLL_FC_SAVE_EDIT__ = function () {
            return saveEdit();
        };

        document.addEventListener('click', function (e) {
            if (!openEditMenu) {
                return;
            }
            if (
                openEditMenu.contains(e.target) ||
                (e.target && e.target.closest && e.target.closest('.syll-fc-edit-menu-btn'))
            ) {
                return;
            }
            closeEditCardMenu();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                closeEditCardMenu();
            }
        });

        updateIndexLabels();
        showCard(0);
    }

    ready(function () {
        var roots = document.querySelectorAll('.syll-fc');
        Array.prototype.forEach.call(roots, initDeck);
    });
})();
