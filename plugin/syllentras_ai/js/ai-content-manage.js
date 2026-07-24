/**
 * On-page AI Content manager: Rename / Delete / Edit (study guide + flashcards).
 * Expects window.__SYLL_AI_CONTENT__ from before_footer when viewing owned AI Content.
 * Flashcard Save/Cancel call window.__SYLL_FC_*_EDIT__ hooks from flashcards-study.js.
 */
(function () {
    'use strict';

    var meta = window.__SYLL_AI_CONTENT__;
    if (!meta || !meta.cmId) {
        return;
    }

    function getConfig() {
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

    var config = getConfig();
    if (
        !config ||
        !config.apiUrl ||
        !(config.courseId > 1) ||
        !(config.moodleUserId > 0)
    ) {
        return;
    }

    var apiBase = String(config.apiUrl).replace(/\/$/, '');
    var editing = false;
    var editSnapshot = '';

    function apiPost(path, body) {
        return fetch(apiBase + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then(function (res) {
            if (!res.ok) {
                return res
                    .json()
                    .catch(function () {
                        return {};
                    })
                    .then(function (data) {
                        throw new Error(
                            (data && (data.message || data.error)) ||
                                'HTTP ' + res.status
                        );
                    });
            }
            return res.json();
        });
    }

    function closeModal() {
        var modal = document.getElementById('syllentras-chat-modal');
        if (modal) {
            modal.hidden = true;
        }
    }

    function showModal(title, bodyNode, actions) {
        var modal = document.getElementById('syllentras-chat-modal');
        if (!modal) {
            window.alert(typeof bodyNode === 'string' ? bodyNode : title);
            return;
        }
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
        if (firstButton) {
            firstButton.focus();
        }
    }

    function findGuideRoot() {
        var marked = document.querySelector('.syll-sg[data-syll-sg], .syll-sg');
        if (marked) {
            return marked;
        }
        var candidates = document.querySelectorAll(
            '#region-main .box, #region-main [role="main"] .box, .page-content-wrapper .box'
        );
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            if (
                /Private study guide created by Syllentras AI/i.test(
                    el.textContent || ''
                )
            ) {
                return el;
            }
        }
        return null;
    }

    function setStatus(message, isError) {
        if (!statusEl) {
            return;
        }
        statusEl.hidden = !message;
        statusEl.textContent = message || '';
        statusEl.classList.toggle('is-error', !!isError);
    }

    var bar = document.createElement('div');
    bar.className = 'syll-ai-manage-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Manage AI Content');

    var titleHint = document.createElement('span');
    titleHint.className = 'syll-ai-manage-label';
    titleHint.textContent = kindLabel(meta.kind);

    var renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'syll-fc-btn syll-ai-manage-rename';
    renameBtn.textContent = 'Rename';

    var pdfBtn = document.createElement('button');
    pdfBtn.type = 'button';
    pdfBtn.className = 'syll-fc-btn syll-ai-manage-pdf';
    pdfBtn.textContent = 'Download PDF';

    var editBtn = null;
    var saveBtn = null;
    var cancelBtn = null;

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'syll-fc-btn syll-ai-manage-delete';
    deleteBtn.textContent = 'Delete';

    bar.appendChild(titleHint);
    bar.appendChild(renameBtn);

    if (meta.kind === 'study_guide' || meta.kind === 'flashcards') {
        editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'syll-fc-btn syll-ai-manage-edit';
        editBtn.textContent = 'Edit';
        bar.appendChild(editBtn);

        saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'syll-fc-btn syll-fc-btn-save';
        saveBtn.textContent = 'Save';
        saveBtn.hidden = true;
        cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'syll-fc-btn syll-fc-btn-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.hidden = true;
        bar.appendChild(saveBtn);
        bar.appendChild(cancelBtn);
    }

    bar.appendChild(deleteBtn);

    var statusEl = document.createElement('span');
    statusEl.className = 'syll-ai-manage-status';
    statusEl.hidden = true;
    bar.appendChild(statusEl);
    bar.appendChild(pdfBtn);

    function mountBar() {
        var anchor =
            document.querySelector('#region-main') ||
            document.querySelector('[role="main"]') ||
            document.body;
        if (anchor.firstChild) {
            anchor.insertBefore(bar, anchor.firstChild);
        } else {
            anchor.appendChild(bar);
        }
    }

    function kindLabel(kind) {
        if (kind === 'flashcards') {
            return 'Flashcards';
        }
        if (kind === 'practice_quiz') {
            return 'Practice quiz';
        }
        return 'Study guide';
    }

    function stripKindTitlePrefix(name) {
        return String(name || '')
            .replace(/^(Study Guide|Flashcards|Quiz|Practice Quiz)\s*:\s*/i, '')
            .trim();
    }

    function courseViewUrl() {
        if (meta.courseViewUrl) {
            return meta.courseViewUrl;
        }
        return '/course/view.php?id=' + config.courseId;
    }

    renameBtn.addEventListener('click', function () {
        var wrap = document.createElement('div');
        var label = document.createElement('label');
        label.textContent = 'Title';
        label.setAttribute('for', 'syll-ai-rename-input');
        var hint = document.createElement('p');
        hint.style.margin = '0 0 6px';
        hint.style.fontSize = '12px';
        hint.style.color = '#667788';
        hint.textContent =
            kindLabel(meta.kind) +
            ' prefix is kept automatically.';
        var input = document.createElement('input');
        input.id = 'syll-ai-rename-input';
        input.type = 'text';
        input.maxLength = 200;
        input.value = stripKindTitlePrefix(meta.name || '');
        wrap.appendChild(label);
        wrap.appendChild(hint);
        wrap.appendChild(input);
        showModal('Rename', wrap, [
            {
                label: 'Cancel',
                className: 'syllentras-modal-secondary',
                onClick: closeModal,
            },
            {
                label: 'Save',
                className: 'syllentras-modal-primary',
                onClick: function () {
                    var name = (input.value || '').trim();
                    if (!name) {
                        return;
                    }
                    closeModal();
                    setStatus('Renaming…');
                    apiPost('/ai-content/rename', {
                        courseId: config.courseId,
                        moodleUserId: config.moodleUserId,
                        cmId: meta.cmId,
                        name: name,
                        kind: meta.kind,
                    })
                        .then(function () {
                            window.location.reload();
                        })
                        .catch(function (err) {
                            setStatus(
                                err && err.message
                                    ? String(err.message)
                                    : 'Could not rename.',
                                true
                            );
                        });
                },
            },
        ]);
        setTimeout(function () {
            input.focus();
            input.select();
        }, 0);
    });

    pdfBtn.addEventListener('click', function () {
        if (
            !window.SyllentrasAiContentPdf ||
            typeof window.SyllentrasAiContentPdf.download !== 'function'
        ) {
            setStatus('PDF export is unavailable on this page.', true);
            return;
        }
        setStatus('Preparing PDF…');
        window.SyllentrasAiContentPdf.download(
            {
                cmId: meta.cmId,
                kind: meta.kind,
                name: meta.name,
            },
            config
        )
            .then(function () {
                setStatus('');
            })
            .catch(function (err) {
                setStatus(
                    err && err.message
                        ? String(err.message)
                        : 'Could not export this item.',
                    true
                );
            });
    });

    deleteBtn.addEventListener('click', function () {
        showModal(
            'Delete this content?',
            'Delete "' +
                (meta.name || 'this item') +
                '"? This cannot be undone.',
            [
                {
                    label: 'Cancel',
                    className: 'syllentras-modal-secondary',
                    onClick: closeModal,
                },
                {
                    label: 'Delete',
                    className: 'syllentras-modal-danger',
                    onClick: function () {
                        closeModal();
                        setStatus('Deleting…');
                        apiPost('/ai-content/delete', {
                            courseId: config.courseId,
                            moodleUserId: config.moodleUserId,
                            cmId: meta.cmId,
                        })
                            .then(function () {
                                window.location.href = courseViewUrl();
                            })
                            .catch(function (err) {
                                setStatus(
                                    err && err.message
                                        ? String(err.message)
                                        : 'Could not delete.',
                                    true
                                );
                            });
                    },
                },
            ]
        );
    });

    function enterBarEditMode() {
        editing = true;
        if (editBtn) {
            editBtn.hidden = true;
        }
        if (saveBtn) {
            saveBtn.hidden = false;
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
        }
        if (cancelBtn) {
            cancelBtn.hidden = false;
            cancelBtn.disabled = false;
        }
        renameBtn.disabled = true;
        deleteBtn.disabled = true;
        setStatus('Editing — Save when done.');
    }

    function exitEdit(restore) {
        editing = false;
        if (editBtn) {
            editBtn.hidden = false;
        }
        if (saveBtn) {
            saveBtn.hidden = true;
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
        }
        if (cancelBtn) {
            cancelBtn.hidden = true;
            cancelBtn.disabled = false;
        }
        renameBtn.disabled = false;
        deleteBtn.disabled = false;
        if (meta.kind === 'study_guide') {
            var guide = findGuideRoot();
            if (guide) {
                guide.contentEditable = 'false';
                guide.classList.remove('is-editing');
                if (restore) {
                    guide.innerHTML = editSnapshot;
                }
            }
        }
        setStatus('');
    }

    if (editBtn) {
        editBtn.addEventListener('click', function () {
            if (editing) {
                return;
            }
            if (meta.kind === 'flashcards') {
                if (typeof window.__SYLL_FC_ENTER_EDIT__ !== 'function') {
                    setStatus('Flashcard editor is not ready yet.', true);
                    return;
                }
                var entered = window.__SYLL_FC_ENTER_EDIT__();
                if (entered === false) {
                    setStatus('Flashcard editor is not ready yet.', true);
                    return;
                }
                enterBarEditMode();
                return;
            }
            var guide = findGuideRoot();
            if (!guide) {
                setStatus('Could not find study guide content to edit.', true);
                return;
            }
            editSnapshot = guide.innerHTML;
            guide.contentEditable = 'true';
            guide.classList.add('is-editing');
            guide.focus();
            enterBarEditMode();
        });
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            if (!editing) {
                return;
            }
            if (meta.kind === 'flashcards') {
                if (typeof window.__SYLL_FC_CANCEL_EDIT__ === 'function') {
                    window.__SYLL_FC_CANCEL_EDIT__();
                }
                exitEdit(false);
                return;
            }
            exitEdit(true);
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            if (!editing) {
                return;
            }
            if (meta.kind === 'flashcards') {
                if (typeof window.__SYLL_FC_SAVE_EDIT__ !== 'function') {
                    setStatus('Flashcard editor is not ready yet.', true);
                    return;
                }
                saveBtn.disabled = true;
                cancelBtn.disabled = true;
                saveBtn.textContent = 'Saving…';
                setStatus('Saving…');
                Promise.resolve(window.__SYLL_FC_SAVE_EDIT__())
                    .then(function () {
                        // Flashcard save reloads on success.
                    })
                    .catch(function (err) {
                        saveBtn.disabled = false;
                        cancelBtn.disabled = false;
                        saveBtn.textContent = 'Save';
                        setStatus(
                            err && err.message
                                ? String(err.message)
                                : 'Could not save.',
                            true
                        );
                    });
                return;
            }
            var guide = findGuideRoot();
            if (!guide) {
                return;
            }
            var html = guide.innerHTML;
            saveBtn.disabled = true;
            cancelBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
            setStatus('Saving…');
            apiPost('/ai-content/update-page', {
                courseId: config.courseId,
                moodleUserId: config.moodleUserId,
                cmId: meta.cmId,
                contentHtml: html,
            })
                .then(function () {
                    window.location.reload();
                })
                .catch(function (err) {
                    saveBtn.disabled = false;
                    cancelBtn.disabled = false;
                    saveBtn.textContent = 'Save';
                    setStatus(
                        err && err.message
                            ? String(err.message)
                            : 'Could not save.',
                        true
                    );
                });
        });
    }

    function ready(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    ready(mountBar);
})();
