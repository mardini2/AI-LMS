// Tiny node tests for chat attachment validation helpers.
// Run: node --test plugin/syllentras_ai/js/chat/attachments.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const CHAT_ATTACHMENT_MAX_FILES = 10;
const CHAT_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
const CHAT_ATTACHMENT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const CHAT_ATTACHMENT_USER_QUOTA_MB = 1024;
const CHAT_ATTACHMENT_ALLOWED_EXTENSIONS = [
    'pdf', 'docx', 'pptx', 'txt', 'md', 'png', 'jpg', 'jpeg',
    'py', 'java', 'js', 'ts', 'cpp', 'c', 'cs', 'php',
    'xlsx', 'csv', 'zip', 'json', 'xml', 'sql', 'odt', 'ods', 'odp',
    'mp3', 'wav', 'm4a', 'mp4', 'mov', 'avi', 'epub', 'tex'
];

function attachmentExtension(filename) {
    const base = String(filename || '').split(/[/\\]/).pop() || '';
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) return '';
    return base.slice(dot + 1).toLowerCase();
}

function isAllowedAttachmentFilename(filename) {
    const ext = attachmentExtension(filename);
    return !!ext && CHAT_ATTACHMENT_ALLOWED_EXTENSIONS.indexOf(ext) !== -1;
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
    const text = String(raw || '').trim();
    const limits = attachmentLimitMessages();
    if (!text) return 'Upload failed. Please try again.';
    const lower = text.toLowerCase();
    if (lower.includes('not supported')
        || lower.includes('unsupported')
        || lower.includes('not a supported')
        || lower.includes('supported file type')) {
        return limits.unsupportedType;
    }
    if (lower.includes('storage is full') || lower.includes('quota')) {
        return limits.quotaFull;
    }
    if (lower.includes('total upload') || lower.includes('combined')) {
        return limits.tooLargeTotal;
    }
    if (lower.includes('too large') || lower.includes('per file')) {
        return limits.tooLargeFile;
    }
    if (lower.includes('up to 10') || lower.includes('at most 10')) {
        return limits.tooManyFiles;
    }
    if (text.includes('/') || text.includes('\\') || text.startsWith('Error:')) {
        return 'Upload failed. Please try again.';
    }
    return text;
}

function parseStoredAttachmentNames(content) {
    const text = String(content || '');
    const match = text.match(/^\[syllentras-files:\s*([^\]]+)\]\s*(?:\n+)?([\s\S]*)$/i);
    if (!match) {
        return { filenames: [], displayText: text };
    }
    const filenames = match[1].split(',').map((part) => part.trim()).filter(Boolean);
    return {
        filenames,
        displayText: (match[2] || '').trim()
    };
}

function validateSelection(existingCount, existingBytes, incomingFiles) {
    const errors = [];
    const accepted = [];
    const limits = attachmentLimitMessages();
    const remaining = CHAT_ATTACHMENT_MAX_FILES - existingCount;
    if (remaining <= 0) {
        errors.push(limits.tooManyFiles);
        return { accepted, errors };
    }

    let files = incomingFiles.slice();
    if (files.length > remaining) {
        errors.push(limits.tooManyFiles);
        files = files.slice(0, remaining);
    }

    let batchBytes = 0;
    files.forEach((file) => {
        if (!isAllowedAttachmentFilename(file.name)) {
            errors.push(limits.unsupportedType);
            return;
        }
        if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
            errors.push(limits.tooLargeFile);
            return;
        }
        if (existingBytes + batchBytes + file.size > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
            errors.push(limits.tooLargeTotal);
            return;
        }
        accepted.push(file.name);
        batchBytes += file.size;
    });

    return { accepted, errors };
}

function applyDragDepth(depth, hasFiles) {
    if (!hasFiles) return { depth, highlight: depth > 0 };
    return { depth: depth + 1, highlight: true };
}

function applyDragLeave(depth) {
    const next = Math.max(0, depth - 1);
    return { depth: next, highlight: next > 0 };
}

describe('chat attachment UI validation', () => {
    it('allows 0–10 files and blocks the 11th selection', () => {
        const ten = Array.from({ length: 10 }, (_, i) => ({
            name: `f${i}.txt`,
            size: 10
        }));
        const atCap = validateSelection(10, 0, [{ name: 'extra.txt', size: 10 }]);
        assert.equal(atCap.accepted.length, 0);
        assert.equal(atCap.errors[0], 'You can attach up to 10 files per message.');

        const under = validateSelection(8, 0, ten);
        assert.equal(under.accepted.length, 2);
        assert.equal(under.errors[0], 'You can attach up to 10 files per message.');
    });

    it('enforces 15 MB per-file and 100 MB total upload limits', () => {
        const result = validateSelection(0, 0, [
            { name: 'virus.exe', size: 100 },
            { name: 'huge.pdf', size: CHAT_ATTACHMENT_MAX_BYTES + 1 },
            { name: 'ok.py', size: 128 },
        ]);
        assert.deepEqual(result.accepted, ['ok.py']);
        assert.equal(result.errors[0], 'This file type is not supported.');
        assert.equal(result.errors[1], 'This file is too large. Maximum size is 15 MB per file.');

        const almostFull = validateSelection(0, 95 * 1024 * 1024, [
            { name: 'a.pdf', size: 10 * 1024 * 1024 },
        ]);
        assert.equal(almostFull.accepted.length, 0);
        assert.equal(
            almostFull.errors[0],
            'Upload limit exceeded. Maximum total upload size is 100 MB.'
        );
    });

    it('maps server/quota errors to friendly temporary toast copy', () => {
        assert.equal(
            friendlyAttachmentError('Storage quota exceeded (1 GB).'),
            'Your attachment storage is full. Maximum storage is 1 GB.'
        );
        assert.equal(
            friendlyAttachmentError('C:\\uploads\\secret\\file.pdf exploded'),
            'Upload failed. Please try again.'
        );
        assert.equal(CHAT_ATTACHMENT_USER_QUOTA_MB, 1024);
    });

    it('parses stored attachment markers for chat history display', () => {
        const parsed = parseStoredAttachmentNames(
            '[syllentras-files: a.pdf, b.docx]\n\nPlease summarize'
        );
        assert.deepEqual(parsed.filenames, ['a.pdf', 'b.docx']);
        assert.equal(parsed.displayText, 'Please summarize');
        assert.deepEqual(
            parseStoredAttachmentNames('plain message').filenames,
            []
        );
    });

    it('recognizes phase 1–3 extensions', () => {
        assert.equal(isAllowedAttachmentFilename('Lecture.pptx'), true);
        assert.equal(isAllowedAttachmentFilename('data.xlsx'), true);
        assert.equal(isAllowedAttachmentFilename('clip.mp4'), true);
        assert.equal(isAllowedAttachmentFilename('notes'), false);
    });

    it('treats ready attachments as sendable IDs (not base64 payloads)', () => {
        const pending = [
            { id: 'uuid-1', filename: 'a.txt', status: 'ready' },
            { id: null, filename: 'b.txt', status: 'uploading' },
            { id: 'uuid-2', filename: 'c.txt', status: 'failed' },
        ];
        const sendable = pending
            .filter((item) => item.id && (item.status === 'ready' || item.status === 'uploaded' || item.status === 'processing'))
            .map((item) => ({ id: item.id, filename: item.filename, status: item.status }));
        assert.deepEqual(sendable, [
            { id: 'uuid-1', filename: 'a.txt', status: 'ready' },
        ]);
    });

    it('tracks drag-over highlight with enter/leave depth', () => {
        let state = applyDragDepth(0, true);
        assert.equal(state.highlight, true);
        state = applyDragDepth(state.depth, true);
        assert.equal(state.depth, 2);
        state = applyDragLeave(state.depth);
        assert.equal(state.highlight, true);
        state = applyDragLeave(state.depth);
        assert.equal(state.highlight, false);
    });

    it('shows a friendly toast message for unsupported file types', () => {
        const result = validateSelection(0, 0, [{ name: 'photo.bmp', size: 100 }]);
        assert.equal(result.accepted.length, 0);
        assert.equal(result.errors[0], 'This file type is not supported.');
        assert.equal(
            friendlyAttachmentError('".exe" is not a supported file type.'),
            'This file type is not supported.'
        );
    });
});
