// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.
//
// Read-aloud for chat bubbles.
// Chrome / Edge / Safari: use their built-in voices first (they usually sound
// good), and only hit Azure if that path fails.
// Firefox / Brave / everything else: try Azure first, then fall back to the
// browser voice if Azure is off, out of credit, or just errors out.
// Goal is no dead speaker button — always try whatever still works.

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

// From GET /speech/config. null until the first probe finishes.
var azureSpeechConfig = null;
var azureSpeechConfigPromise = null;
// Bumped whenever we stop / start so late Azure responses get ignored.
var speechPlayGeneration = 0;
var azureAudioEl = null;
var azureObjectUrl = null;

function browserSpeechSupported() {
    return typeof window !== 'undefined'
        && 'speechSynthesis' in window
        && typeof SpeechSynthesisUtterance !== 'undefined';
}

function azureTtsIsAvailable() {
    return !!(azureSpeechConfig && azureSpeechConfig.azureTtsAvailable);
}

/** After a hard Azure failure (quota, bad key, etc.) stop asking this session. */
function markAzureSpeechUnavailableTemporarily() {
    if (!azureSpeechConfig) {
        azureSpeechConfig = {
            azureTtsEnabled: false,
            azureTtsAvailable: false,
            maxChars: 5000
        };
        return;
    }
    azureSpeechConfig.azureTtsAvailable = false;
}

/**
 * Browsers that usually ship decent neural / system voices.
 * Brave is Chromium-based but its voices are often weak, so it is NOT here.
 */
function prefersNativeBrowserTts() {
    if (typeof navigator === 'undefined') return false;
    var ua = navigator.userAgent || '';

    // Brave — prefer Azure even though the UA looks like Chrome.
    if (typeof navigator.brave !== 'undefined') return false;
    if (/Brave/i.test(ua)) return false;
    if (navigator.userAgentData && Array.isArray(navigator.userAgentData.brands)) {
        for (var i = 0; i < navigator.userAgentData.brands.length; i++) {
            var brand = String(navigator.userAgentData.brands[i].brand || '');
            if (/brave/i.test(brand)) return false;
        }
    }

    // Edge (Edg/) before Chrome — Edge UA also contains Chrome/.
    if (/Edg\//.test(ua)) return true;

    // Chrome / Chromium, but not Opera.
    if (/Chrome\//.test(ua) && !/OPR\//.test(ua) && !/Edg\//.test(ua)) return true;

    // Safari on macOS / iOS (their UA has Safari but not Chrome).
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return true;

    return false;
}

function speechSupported() {
    // Cloud path only needs Audio + fetch; browser path needs speechSynthesis.
    if (azureTtsIsAvailable()) return true;
    if (browserSpeechSupported()) return true;
    return typeof Audio !== 'undefined' && typeof fetch === 'function';
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
    if (!browserSpeechSupported()) {
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

/** Ask Nest whether Azure TTS is on. Safe to call more than once. */
function loadAzureSpeechConfig() {
    if (azureSpeechConfigPromise) return azureSpeechConfigPromise;
    if (typeof fetchJson !== 'function' || !API_URL) {
        azureSpeechConfig = { azureTtsEnabled: false, azureTtsAvailable: false };
        azureSpeechConfigPromise = Promise.resolve(azureSpeechConfig);
        return azureSpeechConfigPromise;
    }
    azureSpeechConfigPromise = fetchJson('/speech/config')
        .then(function (data) {
            azureSpeechConfig = {
                azureTtsEnabled: !!(data && data.azureTtsEnabled),
                azureTtsAvailable: !!(data && data.azureTtsAvailable),
                maxChars: (data && data.maxChars) || 5000,
                contentType: (data && data.contentType) || 'audio/mpeg'
            };
            return azureSpeechConfig;
        })
        .catch(function () {
            // API down / old deploy — just use the browser voice.
            azureSpeechConfig = { azureTtsEnabled: false, azureTtsAvailable: false, maxChars: 5000 };
            return azureSpeechConfig;
        });
    return azureSpeechConfigPromise;
}

function stopAzureAudio() {
    if (azureAudioEl) {
        azureAudioEl.onended = null;
        azureAudioEl.onerror = null;
        try {
            azureAudioEl.pause();
        } catch (e) { /* ignore */ }
        try {
            azureAudioEl.removeAttribute('src');
            azureAudioEl.load();
        } catch (e2) { /* ignore */ }
        azureAudioEl = null;
    }
    if (azureObjectUrl) {
        try {
            URL.revokeObjectURL(azureObjectUrl);
        } catch (e3) { /* ignore */ }
        azureObjectUrl = null;
    }
}

function stopMessageSpeech() {
    speechPlayGeneration += 1;
    speechRestartPending = false;
    stopAzureAudio();
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

function clearSpeakingUi(el) {
    if (speechRestartPending) return;
    if (speakingMessageEl === el) {
        setSpeakButtonPlaying(el, false);
        speakingMessageEl = null;
    }
}

function startBrowserMessageSpeech(el, text, generation, onFail) {
    if (!browserSpeechSupported()) {
        if (typeof onFail === 'function') {
            onFail();
        } else {
            clearSpeakingUi(el);
        }
        return;
    }
    if (generation !== speechPlayGeneration || speakingMessageEl !== el) return;

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
        if (generation !== speechPlayGeneration) return;
        clearSpeakingUi(el);
    };
    utterance.onerror = function (ev) {
        // cancel() / restart fires canceled|interrupted — don't treat as failure.
        if (generation !== speechPlayGeneration) return;
        var err = ev && ev.error;
        if (err === 'canceled' || err === 'interrupted') return;
        if (typeof onFail === 'function') {
            onFail();
            return;
        }
        clearSpeakingUi(el);
    };

    try {
        window.speechSynthesis.speak(utterance);
    } catch (e) {
        if (typeof onFail === 'function') {
            onFail();
        } else {
            clearSpeakingUi(el);
        }
    }
}

/**
 * @param {boolean} [allowBrowserFallback=true] — set false when browser already
 *   failed and Azure is the last resort (avoids a pointless second browser try).
 */
function startAzureMessageSpeech(el, text, generation, allowBrowserFallback) {
    var canFallback = allowBrowserFallback !== false;

    function fallbackOrStop() {
        markAzureSpeechUnavailableTemporarily();
        if (generation !== speechPlayGeneration || speakingMessageEl !== el) return;
        if (canFallback && browserSpeechSupported()) {
            startBrowserMessageSpeech(el, text, generation);
        } else {
            clearSpeakingUi(el);
        }
    }

    var maxChars = (azureSpeechConfig && azureSpeechConfig.maxChars) || 5000;
    var clipped = text.length > maxChars ? text.slice(0, maxChars) : text;

    return fetch(API_URL + '/speech/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text: clipped,
            voice: selectedSpeechVoice
        })
    }).then(function (res) {
        if (!res.ok) {
            return res.text().then(function (body) {
                var msg = 'Azure TTS request failed (' + res.status + ')';
                try {
                    var data = body ? JSON.parse(body) : null;
                    if (data && typeof data.message === 'string') msg = data.message;
                } catch (e) { /* keep default */ }
                throw new Error(msg);
            });
        }
        return res.blob();
    }).then(function (blob) {
        if (generation !== speechPlayGeneration || speakingMessageEl !== el) return;

        stopAzureAudio();
        azureObjectUrl = URL.createObjectURL(blob);
        azureAudioEl = new Audio(azureObjectUrl);
        // Speed slider still works — we just stretch/compress the mp3.
        azureAudioEl.playbackRate = speechRateInfo(selectedSpeechRateStep).rate;

        azureAudioEl.onended = function () {
            if (generation !== speechPlayGeneration) return;
            stopAzureAudio();
            clearSpeakingUi(el);
        };
        azureAudioEl.onerror = function () {
            if (generation !== speechPlayGeneration) return;
            stopAzureAudio();
            fallbackOrStop();
        };

        return azureAudioEl.play().catch(function () {
            if (generation !== speechPlayGeneration) return;
            stopAzureAudio();
            fallbackOrStop();
        });
    }).catch(function () {
        fallbackOrStop();
    });
}

function startMessageSpeech(el) {
    if (!el || !speechSupported()) return;

    var text = getMessageSpeakText(el);
    if (!text || text === '...') return;

    // Drop whatever was mid-sentence before starting fresh.
    speechPlayGeneration += 1;
    var generation = speechPlayGeneration;
    stopAzureAudio();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }

    speakingMessageEl = el;
    setSpeakButtonPlaying(el, true);

    function begin() {
        if (generation !== speechPlayGeneration || speakingMessageEl !== el) return;

        var azureOk = azureTtsIsAvailable();
        var nativeFirst = prefersNativeBrowserTts() && browserSpeechSupported();

        // Chrome / Edge / Safari — their own voice first.
        if (nativeFirst) {
            startBrowserMessageSpeech(el, text, generation, function () {
                if (generation !== speechPlayGeneration || speakingMessageEl !== el) return;
                if (azureOk) {
                    // Native choked; Azure is the backup. Don't bounce back to browser.
                    startAzureMessageSpeech(el, text, generation, false);
                } else {
                    clearSpeakingUi(el);
                }
            });
            return;
        }

        // Firefox / Brave / others — Azure when it's up, browser otherwise.
        if (azureOk) {
            startAzureMessageSpeech(el, text, generation, true);
            return;
        }

        if (browserSpeechSupported()) {
            startBrowserMessageSpeech(el, text, generation);
            return;
        }

        clearSpeakingUi(el);
    }

    // First click may race the config probe — wait one tick if needed.
    if (azureSpeechConfig === null) {
        loadAzureSpeechConfig().then(begin);
    } else {
        begin();
    }
}

// Browsers don't let you change rate mid-utterance, so we restart the same bubble.
function restartMessageSpeechIfPlaying() {
    var el = speakingMessageEl;
    if (!el || !speechSupported()) return;

    speechRestartPending = true;
    stopAzureAudio();
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
loadAzureSpeechConfig();

if (browserSpeechSupported()) {
    refreshSpeechVoiceCache();
    // Chrome loads voices late — refresh when they show up.
    if (typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
        window.speechSynthesis.onvoiceschanged = refreshSpeechVoiceCache;
    }
    window.speechSynthesis.addEventListener('voiceschanged', refreshSpeechVoiceCache);
}
