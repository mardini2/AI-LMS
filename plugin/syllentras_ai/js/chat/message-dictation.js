// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.
//
// Mic next to the composer. Uses the browser speech-recognition API to dump
// what you say into the message box (speech-to-text).

var dictationRecognition = null;
var dictationListening = false;
var dictationBaseText = '';
var dictationToastTimer = null;
var dictationToastEl = null;
var micBtn = document.getElementById('syllentras-chat-mic');

function speechRecognitionSupported() {
    return typeof window !== 'undefined'
        && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function appendDictationChunk(base, chunk) {
    var left = (base || '').replace(/\s+$/, '');
    var right = String(chunk || '').replace(/^\s+/, '');
    if (!right) return left;
    if (!left) return right;
    return left + ' ' + right;
}

function ensureDictationToast() {
    if (dictationToastEl) return dictationToastEl;
    var host = document.getElementById('syllentras-chat-main') || panel || root;
    if (!host) return null;
    dictationToastEl = document.createElement('div');
    dictationToastEl.id = 'syllentras-dictation-toast';
    dictationToastEl.className = 'syllentras-dictation-toast';
    dictationToastEl.setAttribute('role', 'status');
    dictationToastEl.setAttribute('aria-live', 'polite');
    dictationToastEl.hidden = true;
    host.appendChild(dictationToastEl);
    return dictationToastEl;
}

function showDictationToast(message) {
    var el = ensureDictationToast();
    if (!el) return;
    el.textContent = String(message || '');
    el.hidden = false;
    // Force reflow so the fade-in class actually animates when we re-show.
    void el.offsetWidth;
    el.classList.add('is-visible');
    if (dictationToastTimer) {
        clearTimeout(dictationToastTimer);
    }
    dictationToastTimer = setTimeout(function () {
        el.classList.remove('is-visible');
        dictationToastTimer = setTimeout(function () {
            el.hidden = true;
            dictationToastTimer = null;
        }, 220);
    }, 3000);
}

function dictationErrorMessage(code) {
    if (code === 'not-allowed' || code === 'service-not-allowed') {
        return 'Microphone access blocked. Allow it in your browser or system settings.';
    }
    if (code === 'audio-capture') {
        return 'No microphone detected.';
    }
    return '';
}

function mediaErrorKind(err) {
    var name = err && err.name ? String(err.name) : '';
    if (
        name === 'NotFoundError'
        || name === 'DevicesNotFoundError'
        || name === 'NotReadableError'
        || name === 'OverconstrainedError'
    ) {
        return 'no-mic';
    }
    if (
        name === 'NotAllowedError'
        || name === 'PermissionDeniedError'
        || name === 'SecurityError'
    ) {
        return 'blocked';
    }
    return 'unknown';
}

function probeMicrophone(done) {
    if (
        !navigator.mediaDevices
        || typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
        done(null);
        return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        try {
            stream.getTracks().forEach(function (track) {
                track.stop();
            });
        } catch (e) { /* ignore */ }
        done(null);
    }).catch(function (err) {
        done(mediaErrorKind(err));
    });
}

function syncMicButtonUi() {
    if (!micBtn) return;
    micBtn.classList.toggle('is-listening', dictationListening);
    micBtn.setAttribute('aria-pressed', dictationListening ? 'true' : 'false');
    micBtn.title = dictationListening ? 'Stop listening' : 'Dictate message';
    micBtn.setAttribute(
        'aria-label',
        dictationListening ? 'Stop listening' : 'Dictate message'
    );
}

function stopDictation() {
    if (!dictationRecognition) {
        dictationListening = false;
        syncMicButtonUi();
        return;
    }
    try {
        dictationRecognition.onend = null;
        dictationRecognition.stop();
    } catch (e) { /* already stopped */ }
    dictationListening = false;
    syncMicButtonUi();
}

function beginSpeechRecognition() {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    dictationRecognition = new Recognition();
    dictationRecognition.lang = 'en-US';
    dictationRecognition.continuous = true;
    dictationRecognition.interimResults = true;
    dictationBaseText = input.value || '';

    dictationRecognition.onresult = function (event) {
        var interim = '';
        var finals = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
            var piece = event.results[i][0].transcript || '';
            if (event.results[i].isFinal) {
                finals += piece;
            } else {
                interim += piece;
            }
        }
        if (finals) {
            dictationBaseText = appendDictationChunk(dictationBaseText, finals);
            input.value = dictationBaseText;
        } else {
            input.value = appendDictationChunk(dictationBaseText, interim);
        }
        // Keep the caret at the end so you can see what just came in.
        try {
            input.focus();
            var len = input.value.length;
            input.setSelectionRange(len, len);
        } catch (e) { /* some browsers are picky about selection on textarea */ }
    };

    dictationRecognition.onerror = function (event) {
        // no-speech / aborted are normal — only nag on real mic problems.
        var code = event && event.error ? String(event.error) : '';
        var msg = dictationErrorMessage(code);
        if (msg) {
            showDictationToast(msg);
            micBtn.title = msg;
        }
        dictationListening = false;
        syncMicButtonUi();
    };

    dictationRecognition.onend = function () {
        // continuous mode can end on its own — flip the button back off.
        dictationListening = false;
        syncMicButtonUi();
    };

    try {
        dictationRecognition.start();
        dictationListening = true;
        syncMicButtonUi();
        input.focus();
    } catch (e) {
        dictationListening = false;
        syncMicButtonUi();
        showDictationToast('Could not start the microphone.');
    }
}

function startDictation() {
    if (!speechRecognitionSupported() || !input || !micBtn) return;
    if (dictationListening) return;

    // Don't talk over yourself — pause read-aloud if it's going.
    if (typeof stopMessageSpeech === 'function') {
        stopMessageSpeech();
    }

    // Quick mic check so we can say "blocked" vs "not found" clearly.
    probeMicrophone(function (kind) {
        if (kind === 'blocked') {
            showDictationToast(
                'Microphone access blocked. Allow it in your browser or system settings.'
            );
            return;
        }
        if (kind === 'no-mic') {
            showDictationToast('No microphone detected.');
            return;
        }
        beginSpeechRecognition();
    });
}

function toggleDictation() {
    if (dictationListening) {
        stopDictation();
    } else {
        startDictation();
    }
}

function initDictation() {
    if (!micBtn) return;

    if (!speechRecognitionSupported()) {
        micBtn.hidden = true;
        return;
    }

    micBtn.hidden = false;
    syncMicButtonUi();
    micBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleDictation();
    });
}

initDictation();
