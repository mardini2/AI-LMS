import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AzureTtsClient } from './azure-tts.client';
import {
  AZURE_TTS_CONTENT_TYPE,
  AZURE_TTS_MAX_CHARS,
  AZURE_TTS_VOICE_FEMALE,
  AZURE_TTS_VOICE_MALE,
} from './speech.constants';

export interface SpeechConfigDto {
  /** Flip from AZURE_TTS_ENABLED — off means we never call Azure. */
  azureTtsEnabled: boolean;
  /** True only when the flag is on AND key + region are both set. */
  azureTtsAvailable: boolean;
  maxChars: number;
  contentType: string;
}

@Injectable()
export class SpeechService {
  constructor(
    private readonly config: ConfigService,
    private readonly azure: AzureTtsClient,
  ) {}

  getConfig(): SpeechConfigDto {
    const azureTtsEnabled = this.isFlagEnabled();
    return {
      azureTtsEnabled,
      azureTtsAvailable: azureTtsEnabled && this.hasCredentials(),
      maxChars: AZURE_TTS_MAX_CHARS,
      contentType: AZURE_TTS_CONTENT_TYPE,
    };
  }

  /**
   * Turn text into an mp3 buffer via Azure.
   * Browser-native TTS stays in the Moodle plugin; this is the cloud path.
   */
  async synthesize(text: string, voice: 'grace' | 'ben' = 'grace'): Promise<Buffer> {
    const cleaned = String(text ?? '').trim();
    if (!cleaned) {
      throw new BadRequestException('Text to speak cannot be empty.');
    }
    if (cleaned.length > AZURE_TTS_MAX_CHARS) {
      throw new BadRequestException(
        `Text is too long to speak (max ${AZURE_TTS_MAX_CHARS} characters).`,
      );
    }

    if (!this.isFlagEnabled()) {
      throw new ServiceUnavailableException(
        'Azure TTS is turned off. Set AZURE_TTS_ENABLED=true to use cloud speech.',
      );
    }

    const speechKey = this.getSpeechKey();
    const region = this.getRegion();
    if (!speechKey || !region) {
      throw new ServiceUnavailableException(
        'Azure TTS is enabled but AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing.',
      );
    }

    const voiceName =
      voice === 'ben' ? AZURE_TTS_VOICE_MALE : AZURE_TTS_VOICE_FEMALE;

    try {
      return await this.azure.synthesize({
        text: cleaned,
        voiceName,
        speechKey,
        region,
      });
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }
      throw new BadGatewayException(
        'Azure TTS failed to synthesize speech. Try again in a moment.',
      );
    }
  }

  private isFlagEnabled(): boolean {
    const raw = this.config.get<string | boolean>('AZURE_TTS_ENABLED');
    if (typeof raw === 'boolean') return raw;
    return String(raw ?? 'false').toLowerCase() === 'true';
  }

  private hasCredentials(): boolean {
    return Boolean(this.getSpeechKey() && this.getRegion());
  }

  private getSpeechKey(): string {
    return String(this.config.get<string>('AZURE_SPEECH_KEY') ?? '').trim();
  }

  private getRegion(): string {
    return String(this.config.get<string>('AZURE_SPEECH_REGION') ?? '').trim();
  }
}
