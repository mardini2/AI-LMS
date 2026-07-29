// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.
//
// Mic next to the composer. Uses the browser speech-recognition API to dump
// what you say into the message box (speech-to-text).

var dictationRecognition = null;
var dictationListening = false;
var dictationBaseText = '';
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

function startDictation() {
    if (!speechRecognitionSupported() || !input || !micBtn) return;

    // Don't talk over yourself — pause read-aloud if it's going.
    if (typeof stopMessageSpeech === 'function') {
        stopMessageSpeech();
    }

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
        // no-speech / aborted are normal; permission errors just stop the mic.
        var code = event && event.error ? String(event.error) : '';
        if (code === 'not-allowed' || code === 'service-not-allowed') {
            micBtn.title = 'Microphone permission blocked';
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
    }
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
