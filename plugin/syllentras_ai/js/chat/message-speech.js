// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.
//
// Read-aloud for chat bubbles. Picks the nicest system voice we can find for
// Grace (female) / Ben (male), and respects the speed slider from display settings.

var SPEECH_VOICE_KEY = 'syllentras_speech_voice';
var SPEECH_RATE_KEY = 'syllentras_speech_rate_step';

var SPEECH_VOICES = [
    { id: 'grace', label: 'Grace', gender: 'female' },
    { id: 'ben', label: 'Ben', gender: 'male' }
];

// Same idea as the font size steps — a few named speeds instead of a weird float.
var SPEECH_RATE_STEPS = [
    { step: 1, rate: 0.75, label: 'Slow' },
    { step: 2, rate: 0.9, label: 'Steady' },
    { step: 3, rate: 1.0, label: 'Default' },
    { step: 4, rate: 1.15, label: 'Brisk' },
    { step: 5, rate: 1.3, label: 'Fast' }
];

var speakingMessageEl = null;
var selectedSpeechVoice = 'grace';
var selectedSpeechRateStep = 3;
var cachedSpeechVoices = [];
// True while we cancel + re-speak after a speed/voice tweak.
var speechRestartPending = false;

function speechSupported() {
    return typeof window !== 'undefined'
        && 'speechSynthesis' in window
        && typeof SpeechSynthesisUtterance !== 'undefined';
}

function normalizeSpeechVoice(raw) {
    for (var i = 0; i < SPEECH_VOICES.length; i++) {
        if (SPEECH_VOICES[i].id === raw) return raw;
    }
    return 'grace';
}

function normalizeSpeechRateStep(raw) {
    var n = parseInt(raw, 10);
    if (n >= 1 && n <= SPEECH_RATE_STEPS.length) return n;
    return 3;
}

function speechRateInfo(step) {
    return SPEECH_RATE_STEPS[normalizeSpeechRateStep(step) - 1];
}

function refreshSpeechVoiceCache() {
    if (!speechSupported()) {
        cachedSpeechVoices = [];
        return cachedSpeechVoices;
    }
    cachedSpeechVoices = window.speechSynthesis.getVoices() || [];
    return cachedSpeechVoices;
}

function scoreSpeechVoice(voice, wantFemale) {
    if (!voice) return -1000;
    var name = String(voice.name || '');
    var lang = String(voice.lang || '').toLowerCase();
    var score = 0;

    // Stick to English when we can — course chat is in English.
    if (lang.indexOf('en') === 0) score += 40;
    else if (lang.indexOf('en') !== -1) score += 20;
    else score -= 30;

    // Neural / natural voices sound way less "GPS lady" than the old defaults.
    if (/neural|natural|premium|enhanced|online|wave|studio/i.test(name)) score += 35;
    if (voice.localService === false) score += 8;

    if (wantFemale) {
        if (/female|woman|zira|samantha|karen|moira|susan|victoria|linda|jenny|aria|sara|salli|joanna|kendra|kimberly|ivy|emma|amy|google us english$/i.test(name)) {
            score += 50;
        }
        if (/male|man|david|mark|daniel|alex|guy|ryan|tony|matthew|justin|brian|ravi/i.test(name) && !/female/i.test(name)) {
            score -= 40;
        }
    } else {
        if (/male|man|david|mark|daniel|alex|guy|ryan|tony|matthew|justin|brian|ravi|google uk english male/i.test(name)) {
            score += 50;
        }
        if (/female|woman|zira|samantha|karen|moira|jenny|aria|sara/i.test(name) && !/male/i.test(name)) {
            score -= 40;
        }
    }

    // Mild preference for US/UK/AU/CA English.
    if (/en-us|en_us/.test(lang)) score += 6;
    if (/en-gb|en_gb|en-au|en_au|en-ca|en_ca/.test(lang)) score += 4;

    return score;
}

function pickSpeechVoice(preference) {
    var voices = cachedSpeechVoices.length ? cachedSpeechVoices : refreshSpeechVoiceCache();
    if (!voices.length) return null;

    var wantFemale = normalizeSpeechVoice(preference) !== 'ben';
    var best = null;
    var bestScore = -Infinity;
    for (var i = 0; i < voices.length; i++) {
        var score = scoreSpeechVoice(voices[i], wantFemale);
        if (score > bestScore) {
            bestScore = score;
            best = voices[i];
        }
    }
    return best;
}

function loadSpeechSettings() {
    var voiceRaw = null;
    var rateRaw = null;
    try {
        voiceRaw = localStorage.getItem(SPEECH_VOICE_KEY);
        rateRaw = localStorage.getItem(SPEECH_RATE_KEY);
    } catch (e) {
        voiceRaw = null;
        rateRaw = null;
    }
    selectedSpeechVoice = normalizeSpeechVoice(voiceRaw);
    selectedSpeechRateStep = normalizeSpeechRateStep(rateRaw);
}

function saveSpeechSettings() {
    try {
        localStorage.setItem(SPEECH_VOICE_KEY, selectedSpeechVoice);
        localStorage.setItem(SPEECH_RATE_KEY, String(selectedSpeechRateStep));
    } catch (e) { /* private mode / quota — ignore */ }
}

function setSpeechVoicePreference(voiceId) {
    var next = normalizeSpeechVoice(voiceId);
    if (next === selectedSpeechVoice) return;
    selectedSpeechVoice = next;
    saveSpeechSettings();
    // Live preview — if something is already talking, kick it off again.
    restartMessageSpeechIfPlaying();
}

function setSpeechRateStep(step) {
    var next = normalizeSpeechRateStep(step);
    if (next === selectedSpeechRateStep) return;
    selectedSpeechRateStep = next;
    saveSpeechSettings();
    restartMessageSpeechIfPlaying();
}

function resetSpeechSettings() {
    selectedSpeechVoice = 'grace';
    selectedSpeechRateStep = 3;
    saveSpeechSettings();
    restartMessageSpeechIfPlaying();
}

function stopMessageSpeech() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    if (!speakingMessageEl) return;
    speakingMessageEl.classList.remove('is-speaking');
    var btn = speakingMessageEl.querySelector('.syllentras-msg-speak');
    if (btn) {
        btn.setAttribute('aria-pressed', 'false');
        btn.title = 'Read aloud';
        btn.setAttribute('aria-label', 'Read aloud');
    }
    speakingMessageEl = null;
}

function getMessageSpeakText(el) {
    if (!el) return '';
    var clone = el.cloneNode(true);
    Array.from(clone.querySelectorAll(
        '.syllentras-msg-speak, .syllentras-msg-mode, .syllentras-pending-action, .syllentras-content-open-btn, .syllentras-review-toolbar'
    )).forEach(function (node) {
        node.remove();
    });
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function setSpeakButtonPlaying(el, playing) {
    if (!el) return;
    var btn = el.querySelector('.syllentras-msg-speak');
    el.classList.toggle('is-speaking', !!playing);
    if (!btn) return;
    btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    btn.title = playing ? 'Stop reading' : 'Read aloud';
    btn.setAttribute('aria-label', playing ? 'Stop reading' : 'Read aloud');
}

function startMessageSpeech(el) {
    if (!speechSupported() || !el) return;

    var text = getMessageSpeakText(el);
    if (!text || text === '...') return;

    // Drop whatever was mid-sentence before starting fresh.
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    refreshSpeechVoiceCache();

    var utterance = new SpeechSynthesisUtterance(text);
    var voice = pickSpeechVoice(selectedSpeechVoice);
    if (voice) {
        utterance.voice = voice;
        // Some engines ignore voice.lang unless we set it too.
        if (voice.lang) utterance.lang = voice.lang;
    }
    utterance.rate = speechRateInfo(selectedSpeechRateStep).rate;
    // Tiny pitch nudge so Grace/Ben don't sound identical and flat.
    utterance.pitch = selectedSpeechVoice === 'ben' ? 0.92 : 1.08;
    utterance.volume = 1;

    utterance.onend = function () {
        if (speechRestartPending) return;
        if (speakingMessageEl === el) {
            setSpeakButtonPlaying(el, false);
            speakingMessageEl = null;
        }
    };
    utterance.onerror = function () {
        // cancel() fires an error — ignore that when we're about to restart.
        if (speechRestartPending) return;
        if (speakingMessageEl === el) {
            setSpeakButtonPlaying(el, false);
            speakingMessageEl = null;
        }
    };

    speakingMessageEl = el;
    setSpeakButtonPlaying(el, true);
    window.speechSynthesis.speak(utterance);
}

// Browsers don't let you change rate mid-utterance, so we restart the same bubble.
function restartMessageSpeechIfPlaying() {
    var el = speakingMessageEl;
    if (!el || !speechSupported()) return;

    speechRestartPending = true;
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    // Give the engine a tick to finish cancelling, then speak with the new settings.
    window.setTimeout(function () {
        speechRestartPending = false;
        if (!el.isConnected) {
            speakingMessageEl = null;
            return;
        }
        startMessageSpeech(el);
    }, 40);
}

function toggleMessageSpeech(el) {
    if (!speechSupported() || !el) return;

    // Same bubble again = stop.
    if (speakingMessageEl === el) {
        speechRestartPending = false;
        stopMessageSpeech();
        return;
    }

    startMessageSpeech(el);
}

function attachMessageSpeakButton(el) {
    if (!el || !speechSupported()) return null;
    if (el.classList.contains('system') || el.classList.contains('error')) return null;

    var existing = el.querySelector('.syllentras-msg-speak');
    if (existing) return existing;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'syllentras-msg-speak';
    btn.title = 'Read aloud';
    btn.setAttribute('aria-label', 'Read aloud');
    btn.setAttribute('aria-pressed', 'false');
    // Clean outline speaker — no box around it, just the icon.
    btn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true" focusable="false">' +
        '<path d="M11 5L6 9H3v6h3l5 4V5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<path d="M15.2 8.8a4.2 4.2 0 0 1 0 6.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
        '<path d="M17.8 6.2a7.2 7.2 0 0 1 0 11.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
        '</svg>';

    btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleMessageSpeech(el);
    });

    el.appendChild(btn);
    return btn;
}

loadSpeechSettings();

if (speechSupported()) {
    refreshSpeechVoiceCache();
    // Chrome loads voices late — refresh when they show up.
    if (typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
        window.speechSynthesis.onvoiceschanged = refreshSpeechVoiceCache;
    }
    window.speechSynthesis.addEventListener('voiceschanged', refreshSpeechVoiceCache);
}
