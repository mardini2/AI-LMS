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
