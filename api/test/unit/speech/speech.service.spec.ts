import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AzureTtsClient } from '../../../src/speech/azure-tts.client';
import { SynthesizeSpeechDto } from '../../../src/speech/dto/synthesize-speech.dto';
import {
  AZURE_TTS_CONTENT_TYPE,
  AZURE_TTS_MAX_CHARS,
  AZURE_TTS_VOICE_BY_LANG,
  AZURE_TTS_VOICE_FEMALE,
  AZURE_TTS_VOICE_MALE,
} from '../../../src/speech/speech.constants';
import { SpeechController } from '../../../src/speech/speech.controller';
import { SpeechService } from '../../../src/speech/speech.service';

type EnvMap = {
  AZURE_TTS_ENABLED?: string | boolean;
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
};

function buildService(env: EnvMap, azure?: Partial<AzureTtsClient>) {
  const config = {
    get: (key: string) => env[key as keyof EnvMap],
  };
  const client = {
    synthesize: jest.fn().mockResolvedValue(Buffer.from('fake-mp3')),
    ...azure,
  };
  const service = new SpeechService(config as never, client as never);
  return { service, client, controller: new SpeechController(service) };
}

describe('SpeechService / Azure TTS', () => {
  it('Azure enabled: synthesizes when key + region are set', async () => {
    const { service, client } = buildService({
      AZURE_TTS_ENABLED: true,
      AZURE_SPEECH_KEY: 'test-key',
      AZURE_SPEECH_REGION: 'canadacentral',
    });

    const audio = await service.synthesize('Hello class', 'grace');
    expect(audio.toString()).toBe('fake-mp3');
    expect(client.synthesize).toHaveBeenCalledWith({
      text: 'Hello class',
      voiceName: AZURE_TTS_VOICE_FEMALE,
      xmlLang: 'en-CA',
      speechKey: 'test-key',
      region: 'canadacentral',
    });
  });

  it('Azure enabled: picks the male neural voice for ben', async () => {
    const { service, client } = buildService({
      AZURE_TTS_ENABLED: 'true',
      AZURE_SPEECH_KEY: 'test-key',
      AZURE_SPEECH_REGION: 'canadacentral',
    });

    await service.synthesize('Hi', 'ben');
    expect(client.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceName: AZURE_TTS_VOICE_MALE,
        xmlLang: 'en-CA',
      }),
    );
  });

  it('Azure enabled: French lang selects Denise/Henri and fr-FR SSML', async () => {
    const { service, client } = buildService({
      AZURE_TTS_ENABLED: true,
      AZURE_SPEECH_KEY: 'test-key',
      AZURE_SPEECH_REGION: 'canadacentral',
    });

    await service.synthesize('Bonjour la classe', 'grace', 'fr-FR');
    expect(client.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceName: AZURE_TTS_VOICE_BY_LANG['fr-FR'].grace,
        xmlLang: 'fr-FR',
      }),
    );

    await service.synthesize('Bonjour', 'ben', 'fr-FR');
    expect(client.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceName: AZURE_TTS_VOICE_BY_LANG['fr-FR'].ben,
        xmlLang: 'fr-FR',
      }),
    );
  });

  it('Azure enabled: omitted or unknown lang falls back to English voices', async () => {
    const { service, client } = buildService({
      AZURE_TTS_ENABLED: true,
      AZURE_SPEECH_KEY: 'test-key',
      AZURE_SPEECH_REGION: 'canadacentral',
    });

    await service.synthesize('Hello', 'grace');
    expect(client.synthesize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        voiceName: AZURE_TTS_VOICE_FEMALE,
        xmlLang: 'en-CA',
      }),
    );

    await service.synthesize('Hello', 'grace', 'xx-YY');
    expect(client.synthesize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        voiceName: AZURE_TTS_VOICE_FEMALE,
        xmlLang: 'en-CA',
      }),
    );
  });

  it('Azure disabled: config says unavailable and synthesize is blocked', async () => {
    const { service, client } = buildService({
      AZURE_TTS_ENABLED: false,
      AZURE_SPEECH_KEY: 'test-key',
      AZURE_SPEECH_REGION: 'canadacentral',
    });

    expect(service.getConfig()).toEqual({
      azureTtsEnabled: false,
      azureTtsAvailable: false,
      maxChars: AZURE_TTS_MAX_CHARS,
      contentType: AZURE_TTS_CONTENT_TYPE,
    });

    await expect(service.synthesize('Hello')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(client.synthesize).not.toHaveBeenCalled();
  });

  it('Missing credentials while Azure is disabled: config stays off, no Azure call', async () => {
    const { service, client } = buildService({
      AZURE_TTS_ENABLED: false,
      AZURE_SPEECH_KEY: '',
      AZURE_SPEECH_REGION: '',
    });

    expect(service.getConfig()).toMatchObject({
      azureTtsEnabled: false,
      azureTtsAvailable: false,
    });
    await expect(service.synthesize('Hello')).rejects.toThrow(/turned off/i);
    expect(client.synthesize).not.toHaveBeenCalled();
  });

  it('Missing credentials while Azure is enabled: unavailable and synthesize rejects', async () => {
    const { service, client } = buildService({
      AZURE_TTS_ENABLED: true,
      AZURE_SPEECH_KEY: '',
      AZURE_SPEECH_REGION: 'canadacentral',
    });

    expect(service.getConfig()).toEqual({
      azureTtsEnabled: true,
      azureTtsAvailable: false,
      maxChars: AZURE_TTS_MAX_CHARS,
      contentType: AZURE_TTS_CONTENT_TYPE,
    });

    await expect(service.synthesize('Hello')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(service.synthesize('Hello')).rejects.toThrow(/missing/i);
    expect(client.synthesize).not.toHaveBeenCalled();
  });

  it('Azure synthesis failure: maps to BadGatewayException', async () => {
    const { service } = buildService(
      {
        AZURE_TTS_ENABLED: true,
        AZURE_SPEECH_KEY: 'test-key',
        AZURE_SPEECH_REGION: 'canadacentral',
      },
      {
        synthesize: jest.fn().mockRejectedValue(new Error('upstream blew up')),
      },
    );

    await expect(service.synthesize('Hello')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await expect(service.synthesize('Hello')).rejects.toThrow(
      /failed to synthesize/i,
    );
  });

  it('Config endpoint output: no secrets, just availability flags', () => {
    const { controller } = buildService({
      AZURE_TTS_ENABLED: true,
      AZURE_SPEECH_KEY: 'super-secret-key',
      AZURE_SPEECH_REGION: 'canadacentral',
    });

    const cfg = controller.getConfig();
    expect(cfg).toEqual({
      azureTtsEnabled: true,
      azureTtsAvailable: true,
      maxChars: AZURE_TTS_MAX_CHARS,
      contentType: AZURE_TTS_CONTENT_TYPE,
    });
    expect(JSON.stringify(cfg)).not.toMatch(/super-secret-key|speech[_-]?key/i);
  });

  it('Empty text: rejected by the service', async () => {
    const { service, client } = buildService({
      AZURE_TTS_ENABLED: true,
      AZURE_SPEECH_KEY: 'test-key',
      AZURE_SPEECH_REGION: 'canadacentral',
    });

    await expect(service.synthesize('   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(client.synthesize).not.toHaveBeenCalled();
  });

  it('Over-limit text: rejected by the service', async () => {
    const { service, client } = buildService({
      AZURE_TTS_ENABLED: true,
      AZURE_SPEECH_KEY: 'test-key',
      AZURE_SPEECH_REGION: 'canadacentral',
    });

    const huge = 'a'.repeat(AZURE_TTS_MAX_CHARS + 1);
    await expect(service.synthesize(huge)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.synthesize(huge)).rejects.toThrow(/too long/i);
    expect(client.synthesize).not.toHaveBeenCalled();
  });

  it('Empty and over-limit text: DTO validation also catches them', async () => {
    const empty = plainToInstance(SynthesizeSpeechDto, { text: '' });
    const emptyErrors = await validate(empty);
    expect(emptyErrors.length).toBeGreaterThan(0);

    const huge = plainToInstance(SynthesizeSpeechDto, {
      text: 'x'.repeat(AZURE_TTS_MAX_CHARS + 1),
    });
    const hugeErrors = await validate(huge);
    expect(hugeErrors.length).toBeGreaterThan(0);
  });

  it('DTO accepts optional curated lang and rejects unknown lang', async () => {
    const ok = plainToInstance(SynthesizeSpeechDto, {
      text: 'Bonjour',
      voice: 'grace',
      lang: 'fr-FR',
    });
    expect(await validate(ok)).toHaveLength(0);

    const bad = plainToInstance(SynthesizeSpeechDto, {
      text: 'Hello',
      lang: 'xx-YY',
    });
    expect((await validate(bad)).length).toBeGreaterThan(0);
  });
});
