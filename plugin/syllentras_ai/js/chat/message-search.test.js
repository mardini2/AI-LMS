// Tiny node tests for the find-in-chat helpers.
// Run: node --test plugin/syllentras_ai/js/chat/message-search.test.js
//
// These re-implement the pure bits so we don't have to boot the whole chat IIFE.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function findMatchRanges(content, query) {
    const ranges = [];
    if (!content || !query) return ranges;
    const hay = content.toLowerCase();
    const needle = query.toLowerCase();
    let from = 0;
    while (from <= hay.length) {
        const hit = hay.indexOf(needle, from);
        if (hit === -1) break;
        ranges.push({ start: hit, end: hit + needle.length });
        from = hit + Math.max(needle.length, 1);
    }
    return ranges;
}

function queryIndex(index, rawQuery) {
    const query = (rawQuery || '').trim();
    if (!query) return [];
    return index.filter((entry) => findMatchRanges(entry.content, query).length > 0);
}

describe('message search index helpers', () => {
    const index = [
        { id: '1', role: 'user', content: 'What is a Rootkit?' },
        { id: '2', role: 'assistant', content: 'A rootkit hides in the kernel.' },
        { id: '3', role: 'user', content: 'Thanks' },
    ];

    it('matches case-insensitively and partially', () => {
        const hits = queryIndex(index, 'root');
        assert.equal(hits.length, 2);
        assert.equal(hits[0].id, '1');
        assert.equal(hits[1].id, '2');
    });

    it('finds every occurrence inside one message', () => {
        const ranges = findMatchRanges('Rootkit and rootkit again', 'rootkit');
        assert.equal(ranges.length, 2);
        assert.equal(ranges[0].start, 0);
        assert.equal(ranges[1].start, 12);
    });

    it('returns nothing for an empty query', () => {
        assert.deepEqual(queryIndex(index, '   '), []);
    });
});
