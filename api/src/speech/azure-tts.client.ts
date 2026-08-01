import { Injectable, Logger } from '@nestjs/common';
import { AZURE_TTS_OUTPUT_FORMAT } from './speech.constants';

export interface AzureTtsRequest {
  text: string;
  voiceName: string;
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
    const { text, voiceName, speechKey, region } = params;
    const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const ssml = buildSsml(text, voiceName);

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

function buildSsml(text: string, voiceName: string): string {
  // Escape so random chat text can't break the SSML / inject tags.
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  return (
    `<speak version="1.0" xml:lang="en-CA">` +
    `<voice name="${voiceName}">${safe}</voice>` +
    `</speak>`
  );
}
