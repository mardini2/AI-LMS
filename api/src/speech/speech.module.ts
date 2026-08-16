import { Module } from '@nestjs/common';
import { AzureTtsClient } from './azure-tts.client';
import { SpeechController } from './speech.controller';
import { SpeechService } from './speech.service';

@Module({
  controllers: [SpeechController],
  providers: [SpeechService, AzureTtsClient],
  exports: [SpeechService],
})
export class SpeechModule {}
