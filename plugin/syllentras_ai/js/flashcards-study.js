/**
 * Progressive enhancement for Syllentras AI flashcards Pages.
 * Turns the static flip grid into a single-card study mode with
 * self-check scoring. No chat config dependency.
 */
(function () {
    'use strict';

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

        var restartBtn =
            toolbar.querySelector('.syll-fc-btn-restart') ||
            results.querySelector('.syll-fc-btn-restart');
        if (!restartBtn) {
            restartBtn = document.createElement('button');
            restartBtn.type = 'button';
            restartBtn.className = 'syll-fc-btn syll-fc-btn-restart';
            restartBtn.textContent = 'Shuffle & try again';
        }
        if (restartBtn.parentNode !== toolbar) {
            toolbar.appendChild(restartBtn);
        }
        Array.prototype.forEach.call(root.querySelectorAll('.syll-fc-btn-restart'), function (btn) {
            if (btn !== restartBtn && btn.parentNode) {
                btn.parentNode.removeChild(btn);
            }
        });

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

        // Moodle already shows the Page activity title — hide the duplicate in body HTML.
        Array.prototype.forEach.call(root.querySelectorAll(':scope > h1'), function (heading) {
            heading.hidden = true;
        });

        return {
            stage: stage,
            toolbar: toolbar,
            progressEl: progressEl,
            actions: actions,
            correctBtn: actions.querySelector('.syll-fc-btn-correct'),
            incorrectBtn: actions.querySelector('.syll-fc-btn-incorrect'),
            results: results,
            scoreEl: scoreEl,
            restartBtn: restartBtn,
        };
    }

    function initDeck(root) {
        var grid = root.querySelector('.syll-fc-grid');
        if (!grid) {
            return;
        }

        var cards = Array.prototype.slice.call(grid.querySelectorAll('.syll-fc-card'));
        if (cards.length < 1) {
            return;
        }

        var chrome = ensureStudyChrome(root, grid);
        root.classList.add('is-study');
        root.setAttribute('data-syll-fc-study', '1');

        chrome.toolbar.hidden = false;
        chrome.actions.hidden = false;
        chrome.results.hidden = true;

        var order = cards.map(function (_, i) {
            return i;
        });
        var current = 0;
        var marks = [];
        var flipped = false;

        function cardAt(orderIndex) {
            return cards[order[orderIndex]];
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
                var card = cards[cardIndex];
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
            chrome.actions.hidden = false;
            if (chrome.correctBtn) {
                chrome.correctBtn.disabled = !enabled;
            }
            if (chrome.incorrectBtn) {
                chrome.incorrectBtn.disabled = !enabled;
            }
        }

        function showCard(index) {
            current = index;
            flipped = false;
            cards.forEach(function (card) {
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
            chrome.progressEl.textContent = current + 1 + ' / ' + order.length;
            chrome.toolbar.hidden = false;
            chrome.results.hidden = true;
            setActionsEnabled(false);
        }

        function flipActive() {
            if (!chrome.results.hidden) {
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
            chrome.toolbar.hidden = false;
            chrome.progressEl.textContent = 'Done';
            chrome.actions.hidden = true;
            if (chrome.correctBtn) {
                chrome.correctBtn.disabled = true;
            }
            if (chrome.incorrectBtn) {
                chrome.incorrectBtn.disabled = true;
            }
            cards.forEach(function (card) {
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
            setActionsEnabled(false);
            if (current >= order.length - 1) {
                showResults();
                return;
            }
            showCard(current + 1);
        }

        function restart() {
            shuffleInPlace(order);
            marks = [];
            updateIndexLabels();
            chrome.results.hidden = true;
            showCard(0);
        }

        cards.forEach(function (card) {
            resetCardFlip(card);
            var face = card.querySelector('.syll-fc-face');
            if (!face) {
                return;
            }
            // Avoid browser/Moodle focus rings on the non-rotating shell when clicking.
            face.addEventListener('mousedown', function (e) {
                e.preventDefault();
            });
            face.addEventListener('click', function (e) {
                e.preventDefault();
                if (!card.classList.contains('is-active')) {
                    return;
                }
                flipActive();
            });
            face.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (!card.classList.contains('is-active')) {
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

        updateIndexLabels();
        showCard(0);
    }

    ready(function () {
        var roots = document.querySelectorAll('.syll-fc');
        Array.prototype.forEach.call(roots, initDeck);
    });
})();
