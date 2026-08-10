/** Cap how much text we send to Azure in one go. Longer chat bubbles get cut off. */
export const AZURE_TTS_MAX_CHARS = 5000;

/** Default neural voices — Clara/Liam are solid Canadian English options. */
export const AZURE_TTS_VOICE_FEMALE = 'en-CA-ClaraNeural';
export const AZURE_TTS_VOICE_MALE = 'en-CA-LiamNeural';

/** Default locale when the client omits lang or sends something we don't know. */
export const AZURE_TTS_DEFAULT_LANG = 'en-US';

/**
 * Locales the Moodle mic picker / client detector may send.
 * Keep in sync with plugin DICTATION_LANGUAGES / SPEECH_LANG allowlist.
 */
export const AZURE_TTS_SUPPORTED_LANGS = [
  'en-US',
  'en-GB',
  'ar-SA',
  'zh-CN',
  'zh-TW',
  'cs-CZ',
  'da-DK',
  'nl-NL',
  'fi-FI',
  'fr-FR',
  'de-DE',
  'el-GR',
  'he-IL',
  'hi-IN',
  'hu-HU',
  'id-ID',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'nb-NO',
  'pl-PL',
  'pt-BR',
  'pt-PT',
  'ro-RO',
  'ru-RU',
  'es-ES',
  'es-MX',
  'sv-SE',
  'th-TH',
  'tr-TR',
  'uk-UA',
  'vi-VN',
] as const;

export type AzureTtsLang = (typeof AZURE_TTS_SUPPORTED_LANGS)[number];

export type AzureTtsVoicePair = {
  /** Grace (female) neural voice name. */
  grace: string;
  /** Ben (male) neural voice name. */
  ben: string;
  /** BCP-47 for SSML xml:lang. */
  xmlLang: string;
};

/** Grace/Ben → Azure neural voice per locale. Unknown langs fall back to English. */
export const AZURE_TTS_VOICE_BY_LANG: Record<AzureTtsLang, AzureTtsVoicePair> = {
  'en-US': {
    grace: AZURE_TTS_VOICE_FEMALE,
    ben: AZURE_TTS_VOICE_MALE,
    xmlLang: 'en-CA',
  },
  'en-GB': {
    grace: 'en-GB-SoniaNeural',
    ben: 'en-GB-RyanNeural',
    xmlLang: 'en-GB',
  },
  'ar-SA': {
    grace: 'ar-SA-ZariyahNeural',
    ben: 'ar-SA-HamedNeural',
    xmlLang: 'ar-SA',
  },
  'zh-CN': {
    grace: 'zh-CN-XiaoxiaoNeural',
    ben: 'zh-CN-YunxiNeural',
    xmlLang: 'zh-CN',
  },
  'zh-TW': {
    grace: 'zh-TW-HsiaoChenNeural',
    ben: 'zh-TW-YunJheNeural',
    xmlLang: 'zh-TW',
  },
  'cs-CZ': {
    grace: 'cs-CZ-VlastaNeural',
    ben: 'cs-CZ-AntoninNeural',
    xmlLang: 'cs-CZ',
  },
  'da-DK': {
    grace: 'da-DK-ChristelNeural',
    ben: 'da-DK-JeppeNeural',
    xmlLang: 'da-DK',
  },
  'nl-NL': {
    grace: 'nl-NL-FennaNeural',
    ben: 'nl-NL-MaartenNeural',
    xmlLang: 'nl-NL',
  },
  'fi-FI': {
    grace: 'fi-FI-SelmaNeural',
    ben: 'fi-FI-HarriNeural',
    xmlLang: 'fi-FI',
  },
  'fr-FR': {
    grace: 'fr-FR-DeniseNeural',
    ben: 'fr-FR-HenriNeural',
    xmlLang: 'fr-FR',
  },
  'de-DE': {
    grace: 'de-DE-KatjaNeural',
    ben: 'de-DE-ConradNeural',
    xmlLang: 'de-DE',
  },
  'el-GR': {
    grace: 'el-GR-AthinaNeural',
    ben: 'el-GR-NestorasNeural',
    xmlLang: 'el-GR',
  },
  'he-IL': {
    grace: 'he-IL-HilaNeural',
    ben: 'he-IL-AvriNeural',
    xmlLang: 'he-IL',
  },
  'hi-IN': {
    grace: 'hi-IN-SwaraNeural',
    ben: 'hi-IN-MadhurNeural',
    xmlLang: 'hi-IN',
  },
  'hu-HU': {
    grace: 'hu-HU-NoemiNeural',
    ben: 'hu-HU-TamasNeural',
    xmlLang: 'hu-HU',
  },
  'id-ID': {
    grace: 'id-ID-GadisNeural',
    ben: 'id-ID-ArdiNeural',
    xmlLang: 'id-ID',
  },
  'it-IT': {
    grace: 'it-IT-ElsaNeural',
    ben: 'it-IT-DiegoNeural',
    xmlLang: 'it-IT',
  },
  'ja-JP': {
    grace: 'ja-JP-NanamiNeural',
    ben: 'ja-JP-KeitaNeural',
    xmlLang: 'ja-JP',
  },
  'ko-KR': {
    grace: 'ko-KR-SunHiNeural',
    ben: 'ko-KR-InJoonNeural',
    xmlLang: 'ko-KR',
  },
  'nb-NO': {
    grace: 'nb-NO-PernilleNeural',
    ben: 'nb-NO-FinnNeural',
    xmlLang: 'nb-NO',
  },
  'pl-PL': {
    grace: 'pl-PL-AgnieszkaNeural',
    ben: 'pl-PL-MarekNeural',
    xmlLang: 'pl-PL',
  },
  'pt-BR': {
    grace: 'pt-BR-FranciscaNeural',
    ben: 'pt-BR-AntonioNeural',
    xmlLang: 'pt-BR',
  },
  'pt-PT': {
    grace: 'pt-PT-RaquelNeural',
    ben: 'pt-PT-DuarteNeural',
    xmlLang: 'pt-PT',
  },
  'ro-RO': {
    grace: 'ro-RO-AlinaNeural',
    ben: 'ro-RO-EmilNeural',
    xmlLang: 'ro-RO',
  },
  'ru-RU': {
    grace: 'ru-RU-SvetlanaNeural',
    ben: 'ru-RU-DmitryNeural',
    xmlLang: 'ru-RU',
  },
  'es-ES': {
    grace: 'es-ES-ElviraNeural',
    ben: 'es-ES-AlvaroNeural',
    xmlLang: 'es-ES',
  },
  'es-MX': {
    grace: 'es-MX-DaliaNeural',
    ben: 'es-MX-JorgeNeural',
    xmlLang: 'es-MX',
  },
  'sv-SE': {
    grace: 'sv-SE-SofieNeural',
    ben: 'sv-SE-MattiasNeural',
    xmlLang: 'sv-SE',
  },
  'th-TH': {
    grace: 'th-TH-PremwadeeNeural',
    ben: 'th-TH-NiwatNeural',
    xmlLang: 'th-TH',
  },
  'tr-TR': {
    grace: 'tr-TR-EmelNeural',
    ben: 'tr-TR-AhmetNeural',
    xmlLang: 'tr-TR',
  },
  'uk-UA': {
    grace: 'uk-UA-PolinaNeural',
    ben: 'uk-UA-OstapNeural',
    xmlLang: 'uk-UA',
  },
  'vi-VN': {
    grace: 'vi-VN-HoaiMyNeural',
    ben: 'vi-VN-NamMinhNeural',
    xmlLang: 'vi-VN',
  },
};

/** Resolve Grace/Ben neural voices + SSML lang for a client locale. */
export function resolveAzureTtsVoice(
  lang: string | undefined,
  voice: 'grace' | 'ben' = 'grace',
): { voiceName: string; xmlLang: string } {
  const normalized = normalizeAzureTtsLang(lang);
  const pair =
    AZURE_TTS_VOICE_BY_LANG[normalized] ??
    AZURE_TTS_VOICE_BY_LANG[AZURE_TTS_DEFAULT_LANG];
  return {
    voiceName: voice === 'ben' ? pair.ben : pair.grace,
    xmlLang: pair.xmlLang,
  };
}

export function normalizeAzureTtsLang(raw: string | undefined): AzureTtsLang {
  const id = String(raw ?? '')
    .trim()
    .replace(/_/g, '-');
  if (!id) return AZURE_TTS_DEFAULT_LANG;

  for (const supported of AZURE_TTS_SUPPORTED_LANGS) {
    if (supported.toLowerCase() === id.toLowerCase()) return supported;
  }

  const prefix = id.toLowerCase().split('-')[0];
  const prefixMap: Record<string, AzureTtsLang> = {
    en: 'en-US',
    ar: 'ar-SA',
    zh: 'zh-CN',
    cs: 'cs-CZ',
    da: 'da-DK',
    nl: 'nl-NL',
    fi: 'fi-FI',
    fr: 'fr-FR',
    de: 'de-DE',
    el: 'el-GR',
    he: 'he-IL',
    hi: 'hi-IN',
    hu: 'hu-HU',
    id: 'id-ID',
    it: 'it-IT',
    ja: 'ja-JP',
    ko: 'ko-KR',
    nb: 'nb-NO',
    no: 'nb-NO',
    pl: 'pl-PL',
    pt: 'pt-BR',
    ro: 'ro-RO',
    ru: 'ru-RU',
    es: 'es-ES',
    sv: 'sv-SE',
    th: 'th-TH',
    tr: 'tr-TR',
    uk: 'uk-UA',
    vi: 'vi-VN',
  };
  return prefixMap[prefix] ?? AZURE_TTS_DEFAULT_LANG;
}

/** mp3 is small and plays fine in every browser we care about. */
export const AZURE_TTS_OUTPUT_FORMAT = 'audio-16khz-128kbitrate-mono-mp3';
export const AZURE_TTS_CONTENT_TYPE = 'audio/mpeg';
