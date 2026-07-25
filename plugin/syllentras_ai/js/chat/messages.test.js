'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { focusSearchMessage } = require('./messages.js');

test('focusSearchMessage scrolls to and highlights the exact message', () => {
    const classes = new Set();
    const target = {
        dataset: { messageId: 'message-42' },
        offsetTop: 420,
        offsetHeight: 60,
        offsetWidth: 100,
        classList: {
            add: function (name) { classes.add(name); },
            remove: function (name) { classes.delete(name); }
        }
    };

    global.msgs = {
        clientHeight: 300,
        scrollOptions: null,
        querySelectorAll: function () { return [target]; },
        scrollTo: function (options) { this.scrollOptions = options; }
    };
    global.window = {
        setTimeout: function () {}
    };

    assert.equal(focusSearchMessage('message-42'), true);
    assert.deepEqual(global.msgs.scrollOptions, {
        top: 300,
        behavior: 'smooth',
    });
    assert.equal(classes.has('syllentras-search-match'), true);
});

test('focusSearchMessage reports when the requested message is not rendered', () => {
    global.msgs = {
        querySelectorAll: function () { return []; }
    };
    global.window = {
        setTimeout: function () {}
    };

    assert.equal(focusSearchMessage('missing'), false);
});
