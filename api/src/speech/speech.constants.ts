/** Cap how much text we send to Azure in one go. Longer chat bubbles get cut off. */
export const AZURE_TTS_MAX_CHARS = 5000;

/** Default neural voices — Clara/Liam are solid Canadian English options. */
export const AZURE_TTS_VOICE_FEMALE = 'en-CA-ClaraNeural';
export const AZURE_TTS_VOICE_MALE = 'en-CA-LiamNeural';

/** mp3 is small and plays fine in every browser we care about. */
export const AZURE_TTS_OUTPUT_FORMAT = 'audio-16khz-128kbitrate-mono-mp3';
export const AZURE_TTS_CONTENT_TYPE = 'audio/mpeg';
