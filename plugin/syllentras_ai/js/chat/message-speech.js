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

// Curated BCP-47 ids — keep in sync with DICTATION_LANGUAGES / API allowlist.
var SPEECH_LANG_DEFAULT = 'en-US';
var SPEECH_LANG_MIN_LETTERS = 16;

// Compact stopword lists for Latin-script scoring (dominant language wins).
var SPEECH_LATIN_WORD_LISTS = {
    'en-US': ['the', 'and', 'you', 'that', 'for', 'with', 'this', 'have', 'are', 'not', 'your', 'from', 'what', 'about', 'would', 'could', 'should', 'which', 'there', 'their', 'will', 'can', 'how', 'into', 'more'],
    'en-GB': ['the', 'and', 'you', 'that', 'for', 'with', 'this', 'have', 'are', 'not', 'your', 'from', 'what', 'about', 'would', 'could', 'should', 'which', 'there', 'their', 'will', 'can', 'how', 'into', 'more'],
    'fr-FR': ['le', 'la', 'les', 'des', 'une', 'est', 'que', 'pour', 'dans', 'pas', 'qui', 'avec', 'sur', 'vous', 'nous', 'sont', 'cette', 'être', 'mais', 'comme', 'aussi', 'fait', 'plus', 'tout', 'votre'],
    'es-ES': ['que', 'los', 'las', 'del', 'una', 'para', 'con', 'por', 'como', 'más', 'esta', 'este', 'está', 'pero', 'sus', 'hay', 'sobre', 'cuando', 'también', 'puede', 'entre', 'tiene', 'ser', 'son', 'usted'],
    'es-MX': ['que', 'los', 'las', 'del', 'una', 'para', 'con', 'por', 'como', 'más', 'esta', 'este', 'está', 'pero', 'sus', 'hay', 'sobre', 'cuando', 'también', 'puede', 'usted', 'ustedes', 'pues', 'muy', 'aquí'],
    'de-DE': ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'sich', 'mit', 'auf', 'für', 'den', 'von', 'dem', 'auch', 'sind', 'oder', 'wie', 'noch', 'nach', 'wird', 'werden', 'haben', 'kann'],
    'it-IT': ['che', 'del', 'la', 'il', 'di', 'per', 'una', 'con', 'non', 'sono', 'come', 'più', 'della', 'questo', 'questa', 'anche', 'essere', 'hanno', 'delle', 'nel', 'alla', 'dei', 'può', 'tutti', 'quando'],
    'pt-BR': ['que', 'não', 'uma', 'para', 'com', 'os', 'as', 'por', 'mais', 'como', 'mas', 'foi', 'ele', 'ela', 'são', 'dos', 'das', 'também', 'seu', 'sua', 'quando', 'muito', 'está', 'pelo', 'pela'],
    'pt-PT': ['que', 'não', 'uma', 'para', 'com', 'os', 'as', 'por', 'mais', 'como', 'mas', 'foi', 'ele', 'ela', 'são', 'dos', 'das', 'também', 'seu', 'sua', 'quando', 'muito', 'está', 'pelo', 'pela'],
    'nl-NL': ['de', 'het', 'een', 'van', 'en', 'in', 'is', 'op', 'te', 'dat', 'die', 'voor', 'niet', 'met', 'zijn', 'er', 'aan', 'om', 'ook', 'als', 'maar', 'nog', 'worden', 'kan', 'wordt'],
    'pl-PL': ['nie', 'się', 'to', 'jest', 'na', 'do', 'że', 'jak', 'ale', 'czy', 'od', 'po', 'za', 'już', 'tylko', 'może', 'tego', 'przez', 'także', 'oraz', 'będzie', 'który', 'które', 'więc', 'bardzo'],
    'cs-CZ': ['je', 'na', 'se', 'to', 'že', 'pro', 'jsou', 'ale', 'jako', 'od', 'po', 'za', 'tak', 'už', 'také', 'když', 'nebo', 'jen', 'který', 'které', 'bylo', 'bude', 'jsem', 'máte', 'může'],
    'ro-RO': ['și', 'de', 'la', 'în', 'cu', 'nu', 'pe', 'care', 'este', 'pentru', 'o', 'din', 'mai', 'sau', 'că', 'sunt', 'ce', 'ca', 'lui', 'unei', 'acest', 'aceasta', 'poate', 'când', 'foarte'],
    'hu-HU': ['nem', 'hogy', 'egy', 'van', 'az', 'és', 'el', 'meg', 'mint', 'vagy', 'de', 'csak', 'már', 'ki', 'ez', 'aki', 'amit', 'volt', 'lesz', 'kell', 'még', 'igen', 'nincs', 'amikor', 'miért'],
    'sv-SE': ['och', 'att', 'det', 'som', 'för', 'med', 'är', 'på', 'av', 'den', 'ett', 'har', 'inte', 'om', 'till', 'kan', 'från', 'när', 'också', 'var', 'ska', 'eller', 'men', 'detta', 'vara'],
    'da-DK': ['og', 'at', 'det', 'er', 'en', 'til', 'på', 'af', 'den', 'med', 'for', 'ikke', 'som', 'der', 'har', 'de', 'om', 'kan', 'fra', 'eller', 'men', 'også', 'når', 'være', 'dette'],
    'nb-NO': ['og', 'at', 'det', 'er', 'en', 'til', 'på', 'av', 'den', 'med', 'for', 'ikke', 'som', 'der', 'har', 'de', 'om', 'kan', 'fra', 'eller', 'men', 'også', 'når', 'være', 'dette'],
    'fi-FI': ['ja', 'on', 'ei', 'että', 'se', 'oli', 'kun', 'tai', 'jos', 'niin', 'mutta', 'ovat', 'myös', 'kuin', 'tämä', 'olen', 'voidaan', 'olla', 'jotka', 'hänen', 'meidän', 'teidän', 'kaikki', 'hyvin', 'koska'],
    'tr-TR': ['ve', 'bir', 'bu', 'için', 'ile', 'de', 'da', 'ne', 'ama', 'gibi', 'daha', 'çok', 'olarak', 'var', 'kadar', 'sonra', 'olan', 'veya', 'her', 'nasıl', 'neden', 'şimdi', 'şu', 'ben', 'sen'],
    'id-ID': ['yang', 'dan', 'dari', 'untuk', 'dengan', 'ini', 'itu', 'tidak', 'ada', 'adalah', 'pada', 'akan', 'juga', 'atau', 'sebagai', 'dalam', 'bisa', 'sudah', 'mereka', 'kami', 'kita', 'anda', 'lebih', 'karena', 'saat'],
    'vi-VN': ['của', 'và', 'các', 'có', 'là', 'được', 'trong', 'cho', 'không', 'một', 'những', 'để', 'với', 'này', 'đã', 'khi', 'về', 'như', 'từ', 'người', 'bạn', 'cũng', 'nhưng', 'rất', 'đang']
};

function normalizeSpeechLang(raw) {
    var id = String(raw || '').trim();
    if (!id) return SPEECH_LANG_DEFAULT;
    if (typeof DICTATION_LANGUAGES !== 'undefined' && Array.isArray(DICTATION_LANGUAGES)) {
        for (var i = 0; i < DICTATION_LANGUAGES.length; i++) {
            if (DICTATION_LANGUAGES[i].id === id) return id;
        }
    }
    var lower = id.toLowerCase().replace(/_/g, '-');
    var known = [
        'en-US', 'en-GB', 'ar-SA', 'zh-CN', 'zh-TW', 'cs-CZ', 'da-DK', 'nl-NL',
        'fi-FI', 'fr-FR', 'de-DE', 'el-GR', 'he-IL', 'hi-IN', 'hu-HU', 'id-ID',
        'it-IT', 'ja-JP', 'ko-KR', 'nb-NO', 'pl-PL', 'pt-BR', 'pt-PT', 'ro-RO',
        'ru-RU', 'es-ES', 'es-MX', 'sv-SE', 'th-TH', 'tr-TR', 'uk-UA', 'vi-VN'
    ];
    for (var j = 0; j < known.length; j++) {
        if (known[j].toLowerCase() === lower) return known[j];
    }
    var prefix = lower.split('-')[0];
    var prefixMap = {
        en: 'en-US', ar: 'ar-SA', zh: 'zh-CN', cs: 'cs-CZ', da: 'da-DK', nl: 'nl-NL',
        fi: 'fi-FI', fr: 'fr-FR', de: 'de-DE', el: 'el-GR', he: 'he-IL', hi: 'hi-IN',
        hu: 'hu-HU', id: 'id-ID', it: 'it-IT', ja: 'ja-JP', ko: 'ko-KR', nb: 'nb-NO',
        no: 'nb-NO', pl: 'pl-PL', pt: 'pt-BR', ro: 'ro-RO', ru: 'ru-RU', es: 'es-ES',
        sv: 'sv-SE', th: 'th-TH', tr: 'tr-TR', uk: 'uk-UA', vi: 'vi-VN'
    };
    if (prefixMap[prefix]) return prefixMap[prefix];
    return SPEECH_LANG_DEFAULT;
}

function speechFallbackLang() {
    if (typeof getDictationLang === 'function') {
        try {
            return normalizeSpeechLang(getDictationLang());
        } catch (e) { /* ignore */ }
    }
    return SPEECH_LANG_DEFAULT;
}

function countLetters(text) {
    // Count letters across Latin + common non-Latin scripts (Arabic block, CJK, etc.).
    // Regex ranges miss a lot of Arabic (diacritics / extended letters), so walk code points.
    var s = String(text || '');
    var n = 0;
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if ((c >= 0x0041 && c <= 0x005A) || (c >= 0x0061 && c <= 0x007A)) n++; // A-Z a-z
        else if (c >= 0x00C0 && c <= 0x024F) n++; // Latin extended
        else if (c >= 0x1E00 && c <= 0x1EFF) n++;
        else if (c >= 0x0370 && c <= 0x03FF) n++; // Greek
        else if (c >= 0x0400 && c <= 0x04FF) n++; // Cyrillic
        else if (c >= 0x0590 && c <= 0x05FF) n++; // Hebrew
        else if (c >= 0x0600 && c <= 0x06FF) n++; // Arabic
        else if (c >= 0x0750 && c <= 0x077F) n++; // Arabic Supplement
        else if (c >= 0x08A0 && c <= 0x08FF) n++; // Arabic Extended-A
        else if (c >= 0x0900 && c <= 0x097F) n++; // Devanagari
        else if (c >= 0x0E00 && c <= 0x0E7F) n++; // Thai
        else if (c >= 0x3040 && c <= 0x30FF) n++; // Hiragana / Katakana
        else if (c >= 0x3400 && c <= 0x4DBF) n++; // CJK extension A
        else if (c >= 0x4E00 && c <= 0x9FFF) n++; // CJK
        else if (c >= 0xAC00 && c <= 0xD7AF) n++; // Hangul
        else if (c >= 0xFB50 && c <= 0xFDFF) n++; // Arabic presentation forms-A
        else if (c >= 0xFE70 && c <= 0xFEFF) n++; // Arabic presentation forms-B
    }
    return n;
}

function detectScriptLocale(text) {
    var s = String(text || '');
    var counts = {
        arabic: 0, hebrew: 0, cyrillic: 0, greek: 0, thai: 0,
        hangul: 0, kana: 0, cjk: 0, latin: 0
    };
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c >= 0x0600 && c <= 0x06FF) counts.arabic++;
        else if (c >= 0x0590 && c <= 0x05FF) counts.hebrew++;
        else if ((c >= 0x0400 && c <= 0x04FF) || c === 0x0401 || c === 0x0451) counts.cyrillic++;
        else if (c >= 0x0370 && c <= 0x03FF) counts.greek++;
        else if (c >= 0x0E00 && c <= 0x0E7F) counts.thai++;
        else if (c >= 0xAC00 && c <= 0xD7AF) counts.hangul++;
        else if ((c >= 0x3040 && c <= 0x309F) || (c >= 0x30A0 && c <= 0x30FF)) counts.kana++;
        else if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF)) counts.cjk++;
        else if ((c >= 0x0041 && c <= 0x007A) || (c >= 0x00C0 && c <= 0x024F) || (c >= 0x1E00 && c <= 0x1EFF)) counts.latin++;
    }
    var totalScript = counts.arabic + counts.hebrew + counts.cyrillic + counts.greek
        + counts.thai + counts.hangul + counts.kana + counts.cjk;
    if (totalScript < 3 && counts.latin < 8) return null;

    if (counts.arabic >= 3 && counts.arabic >= totalScript * 0.4) return 'ar-SA';
    if (counts.hebrew >= 3 && counts.hebrew >= totalScript * 0.4) return 'he-IL';
    if (counts.thai >= 3 && counts.thai >= totalScript * 0.4) return 'th-TH';
    if (counts.hangul >= 3 && counts.hangul >= totalScript * 0.4) return 'ko-KR';
    if (counts.greek >= 3 && counts.greek >= totalScript * 0.4) return 'el-GR';
    if (counts.kana >= 2) return 'ja-JP';
    if (counts.cjk >= 3) {
        // Traditional markers (common TW/HK forms) vs default Simplified.
        if (/[國學語體後門開對東車來時書長門]/g.test(s)) return 'zh-TW';
        return 'zh-CN';
    }
    if (counts.cyrillic >= 3 && counts.cyrillic >= totalScript * 0.4) {
        if (/[іїєґІЇЄҐ]/.test(s)) return 'uk-UA';
        return 'ru-RU';
    }
    // Devanagari → Hindi
    if (/[\u0900-\u097F]/.test(s)) return 'hi-IN';
    return null;
}

function scoreLatinLocale(words, localeId) {
    var list = SPEECH_LATIN_WORD_LISTS[localeId];
    if (!list || !words.length) return 0;
    var set = {};
    for (var i = 0; i < list.length; i++) set[list[i]] = true;
    var hits = 0;
    for (var j = 0; j < words.length; j++) {
        if (set[words[j]]) hits++;
    }
    return hits;
}

function detectLatinLocale(text) {
    var lower = String(text || '').toLowerCase();
    var words = lower.match(/[a-zà-öø-ÿā-žăâîșț]+/gi) || [];
    if (words.length < 3) return null;
    var normalized = [];
    for (var i = 0; i < words.length; i++) {
        normalized.push(words[i].toLowerCase());
    }

    var bestId = null;
    var bestScore = 0;
    var second = 0;
    var locales = Object.keys(SPEECH_LATIN_WORD_LISTS);
    for (var j = 0; j < locales.length; j++) {
        var id = locales[j];
        var score = scoreLatinLocale(normalized, id);
        // Mild regional cues.
        if (id === 'pt-BR' && /\b(você|vocês|né|aí)\b/.test(lower)) score += 2;
        if (id === 'pt-PT' && /\b(vocês|está|estáis)\b/.test(lower)) score += 1;
        if (id === 'es-MX' && /\b(ustedes|pues|órale|aquí)\b/.test(lower)) score += 2;
        if (id === 'es-ES' && /\b(vosotros|vosotras|estáis)\b/.test(lower)) score += 2;
        if (id === 'en-GB' && /\b(colour|favourite|organise|whilst|whilst)\b/.test(lower)) score += 2;

        if (score > bestScore) {
            second = bestScore;
            bestScore = score;
            bestId = id;
        } else if (score > second) {
            second = score;
        }
    }

    if (!bestId || bestScore < 2) return null;
    // Ambiguous English vs others: need a clear lead, or enough hits.
    if (bestScore < second + 1 && bestScore < 4) return null;
    return bestId;
}

/**
 * Guess BCP-47 locale for TTS from message text.
 * Short / low-confidence text falls back to mic language, then en-US.
 */
function detectSpeechLang(text) {
    var cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return speechFallbackLang();

    var letters = countLetters(cleaned);
    if (letters < SPEECH_LANG_MIN_LETTERS) return speechFallbackLang();

    var scriptHit = detectScriptLocale(cleaned);
    if (scriptHit) return normalizeSpeechLang(scriptHit);

    var latinHit = detectLatinLocale(cleaned);
    if (latinHit) return normalizeSpeechLang(latinHit);

    return speechFallbackLang();
}

function speechLangPrefix(locale) {
    return String(locale || SPEECH_LANG_DEFAULT).toLowerCase().replace(/_/g, '-').split('-')[0];
}

function scoreSpeechVoice(voice, wantFemale, targetLocale) {
    if (!voice) return -1000;
    var name = String(voice.name || '');
    var lang = String(voice.lang || '').toLowerCase().replace(/_/g, '-');
    var target = normalizeSpeechLang(targetLocale || SPEECH_LANG_DEFAULT).toLowerCase();
    var targetPrefix = speechLangPrefix(target);
    var score = 0;

    var exact = lang === target || lang.replace('_', '-') === target;
    var prefixMatch = speechLangPrefix(lang) === targetPrefix;
    if (exact) score += 80;
    else if (prefixMatch) score += 55;
    else if (targetPrefix === 'en') {
        // English target: still prefer English voices.
        if (lang.indexOf('en') === 0) score += 40;
        else if (lang.indexOf('en') !== -1) score += 20;
        else score -= 30;
    } else {
        // Non-English target: demote mismatched voices hard.
        if (lang.indexOf('en') === 0) score -= 10;
        else score -= 40;
    }

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

    // Mild preference among English variants when English is the target.
    if (targetPrefix === 'en') {
        if (target === 'en-gb' && /en-gb|en_gb/.test(lang)) score += 8;
        else if (target === 'en-us' && /en-us|en_us/.test(lang)) score += 8;
        else if (/en-us|en_us/.test(lang)) score += 6;
        else if (/en-gb|en_gb|en-au|en_au|en-ca|en_ca/.test(lang)) score += 4;
    }

    return score;
}

function pickSpeechVoice(preference, targetLocale) {
    var voices = cachedSpeechVoices.length ? cachedSpeechVoices : refreshSpeechVoiceCache();
    if (!voices.length) return null;

    var wantFemale = normalizeSpeechVoice(preference) !== 'ben';
    var locale = normalizeSpeechLang(targetLocale || SPEECH_LANG_DEFAULT);
    var best = null;
    var bestScore = -Infinity;
    for (var i = 0; i < voices.length; i++) {
        var score = scoreSpeechVoice(voices[i], wantFemale, locale);
        if (score > bestScore) {
            bestScore = score;
            best = voices[i];
        }
    }
    return best;
}

/**
 * True when the browser has at least one voice whose lang matches the locale
 * (exact or same language prefix, e.g. ar-EG for ar-SA).
 * Without this, Chrome "succeeds" reading Arabic with an English voice and
 * never falls through to Azure.
 */
function hasBrowserVoiceForLang(targetLocale) {
    if (!browserSpeechSupported()) return false;
    var voices = cachedSpeechVoices.length ? cachedSpeechVoices : refreshSpeechVoiceCache();
    if (!voices.length) return false;

    var locale = normalizeSpeechLang(targetLocale || SPEECH_LANG_DEFAULT).toLowerCase();
    var prefix = speechLangPrefix(locale);
    for (var i = 0; i < voices.length; i++) {
        var lang = String(voices[i].lang || '').toLowerCase().replace(/_/g, '-');
        if (!lang) continue;
        if (lang === locale || speechLangPrefix(lang) === prefix) return true;
    }
    return false;
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
        '.syllentras-msg-speak, .syllentras-msg-mode, .syllentras-pending-action, .syllentras-suggested-links, .syllentras-content-open-btn, .syllentras-review-toolbar'
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

function startBrowserMessageSpeech(el, text, generation, lang, onFail) {
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

    var locale = normalizeSpeechLang(lang || SPEECH_LANG_DEFAULT);
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale;
    var voice = pickSpeechVoice(selectedSpeechVoice, locale);
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
function startAzureMessageSpeech(el, text, generation, lang, allowBrowserFallback) {
    var canFallback = allowBrowserFallback !== false;
    var locale = normalizeSpeechLang(lang || SPEECH_LANG_DEFAULT);

    function fallbackOrStop() {
        markAzureSpeechUnavailableTemporarily();
        if (generation !== speechPlayGeneration || speakingMessageEl !== el) return;
        if (canFallback && browserSpeechSupported()) {
            startBrowserMessageSpeech(el, text, generation, locale);
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
            voice: selectedSpeechVoice,
            lang: locale
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

    var speakLang = detectSpeechLang(text);

    // Drop whatever was mid-sentence before starting fresh.
    speechPlayGeneration += 1;
    var generation = speechPlayGeneration;
    stopAzureAudio();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }

    // Only one bubble can look "active" — clear the previous button if we switched.
    if (speakingMessageEl && speakingMessageEl !== el) {
        setSpeakButtonPlaying(speakingMessageEl, false);
    }

    speakingMessageEl = el;
    setSpeakButtonPlaying(el, true);

    function begin() {
        if (generation !== speechPlayGeneration || speakingMessageEl !== el) return;

        var azureOk = azureTtsIsAvailable();
        var hasMatchingVoice = hasBrowserVoiceForLang(speakLang);
        // Only prefer native when a voice actually speaks this language.
        // Otherwise Chrome "succeeds" with English on Arabic and Azure never runs.
        var nativeFirst = prefersNativeBrowserTts()
            && browserSpeechSupported()
            && hasMatchingVoice;

        // Chrome / Edge / Safari — matching local voice first.
        if (nativeFirst) {
            startBrowserMessageSpeech(el, text, generation, speakLang, function () {
                if (generation !== speechPlayGeneration || speakingMessageEl !== el) return;
                if (azureOk) {
                    // Native choked; Azure is the backup. Don't bounce back to browser.
                    startAzureMessageSpeech(el, text, generation, speakLang, false);
                } else {
                    clearSpeakingUi(el);
                }
            });
            return;
        }

        // No matching browser voice (e.g. Arabic on many Windows installs),
        // or Firefox / Brave — Azure when it's up, browser otherwise.
        if (azureOk) {
            startAzureMessageSpeech(el, text, generation, speakLang, true);
            return;
        }

        if (browserSpeechSupported()) {
            startBrowserMessageSpeech(el, text, generation, speakLang);
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
