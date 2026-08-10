import { Injectable, Logger } from '@nestjs/common';
import { AZURE_TTS_OUTPUT_FORMAT } from './speech.constants';

export interface AzureTtsRequest {
  text: string;
  voiceName: string;
  /** BCP-47 for the SSML speak root (e.g. fr-FR). */
  xmlLang: string;
  speechKey: string;
  region: string;
}

/**
 * Thin wrapper around Azure's REST TTS endpoint.
 * Kept separate so tests can fake the network without dragging in the SDK.
 */
@Injectable()
export class AzureTtsClient {
  private readonly logger = new Logger(AzureTtsClient.name);

  async synthesize(params: AzureTtsRequest): Promise<Buffer> {
    const { text, voiceName, xmlLang, speechKey, region } = params;
    const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const ssml = buildSsml(text, voiceName, xmlLang);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': speechKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': AZURE_TTS_OUTPUT_FORMAT,
        'User-Agent': 'syllentras-ai-api',
      },
      body: ssml,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(
        `Azure TTS failed status=${response.status} body=${body.slice(0, 200)}`,
      );
      const err = new Error(
        `Azure TTS request failed with status ${response.status}`,
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

function buildSsml(text: string, voiceName: string, xmlLang: string): string {
  // Escape so random chat text can't break the SSML / inject tags.
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const lang = String(xmlLang || 'en-CA').replace(/[^\w-]/g, '');

  return (
    `<speak version="1.0" xml:lang="${lang}">` +
    `<voice name="${voiceName}">${safe}</voice>` +
    `</speak>`
  );
}
