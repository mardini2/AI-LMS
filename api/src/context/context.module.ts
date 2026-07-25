import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContextService } from './context.service';
import { MoodleClient } from './moodle-client.service';
import { PlacementController } from './placement.controller';
import { PracticeQuizMoodleService } from './practice-quiz-moodle.service';
import { StudyGuideMoodleService } from './study-guide-moodle.service';
import { AiContentMoodleService } from './ai-content-moodle.service';
import { CourseRetrievalService } from './course-retrieval.service';
import { CourseChunk } from './entities/course-chunk.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CourseChunk])],
  controllers: [PlacementController],
  providers: [
    MoodleClient,
    ContextService,
    PracticeQuizMoodleService,
    StudyGuideMoodleService,
    AiContentMoodleService,
    CourseRetrievalService,
  ],
  exports: [
    ContextService,
    PracticeQuizMoodleService,
    StudyGuideMoodleService,
    AiContentMoodleService,
  ],
})
export class ContextModule {}
