import { Body, Controller, Get, Header, Post, StreamableFile } from '@nestjs/common';
import { SynthesizeSpeechDto } from './dto/synthesize-speech.dto';
import { AZURE_TTS_CONTENT_TYPE } from './speech.constants';
import { SpeechService } from './speech.service';

@Controller('speech')
export class SpeechController {
  constructor(private readonly speechService: SpeechService) {}

  /**
   * GET /speech/config
   * Tells the client whether cloud TTS is usable. Never returns the key.
   */
  @Get('config')
  getConfig() {
    return this.speechService.getConfig();
  }

  /**
   * POST /speech/synthesize
   * Body: { text, voice?, lang? } -> mp3 bytes.
   * If Azure is off or misconfigured, the plugin should keep using browser TTS.
   */
  @Post('synthesize')
  @Header('Content-Type', AZURE_TTS_CONTENT_TYPE)
  async synthesize(@Body() dto: SynthesizeSpeechDto): Promise<StreamableFile> {
    const audio = await this.speechService.synthesize(
      dto.text,
      dto.voice ?? 'grace',
      dto.lang,
    );
    return new StreamableFile(audio, {
      type: AZURE_TTS_CONTENT_TYPE,
      disposition: 'inline; filename="speech.mp3"',
    });
  }
}
