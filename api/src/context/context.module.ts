import { Module } from '@nestjs/common';
import { ContextService } from './context.service';
import { MoodleClient } from './moodle-client.service';
import { PlacementController } from './placement.controller';
import { PracticeQuizMoodleService } from './practice-quiz-moodle.service';
import { StudyGuideMoodleService } from './study-guide-moodle.service';

@Module({
  controllers: [PlacementController],
  providers: [
    MoodleClient,
    ContextService,
    PracticeQuizMoodleService,
    StudyGuideMoodleService,
  ],
  exports: [ContextService, PracticeQuizMoodleService, StudyGuideMoodleService],
})
export class ContextModule {}
