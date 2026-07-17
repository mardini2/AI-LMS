import { Module } from '@nestjs/common';
import { ContextService } from './context.service';
import { MoodleClient } from './moodle-client.service';
import { PlacementController } from './placement.controller';
import { PracticeQuizMoodleService } from './practice-quiz-moodle.service';

@Module({
  controllers: [PlacementController],
  providers: [MoodleClient, ContextService, PracticeQuizMoodleService],
  exports: [ContextService, PracticeQuizMoodleService],
})
export class ContextModule {}
