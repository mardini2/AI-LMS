import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { AiContentMoodleService } from '../context/ai-content-moodle.service';
import { sanitizeStudyGuideHtml } from './study-guide.helpers';
import type {
  DeleteAiContentDto,
  RenameAiContentDto,
  UpdateAiContentPageDto,
} from './dto/ai-content.dto';

@Injectable()
export class AiContentService {
  constructor(private readonly aiContentMoodle: AiContentMoodleService) {}

  async list(courseId: number, moodleUserId: number) {
    try {
      const items = await this.aiContentMoodle.listPrivateContent({
        courseId,
        moodleUserId,
      });
      return { items };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpException(message, HttpStatus.BAD_GATEWAY);
    }
  }

  async rename(dto: RenameAiContentDto) {
    try {
      return await this.aiContentMoodle.renamePrivateActivity({
        courseId: dto.courseId,
        moodleUserId: dto.moodleUserId,
        cmId: dto.cmId,
        name: dto.name,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpException(message, HttpStatus.BAD_GATEWAY);
    }
  }

  async delete(dto: DeleteAiContentDto) {
    try {
      return await this.aiContentMoodle.deletePrivateActivity({
        courseId: dto.courseId,
        moodleUserId: dto.moodleUserId,
        cmId: dto.cmId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpException(message, HttpStatus.BAD_GATEWAY);
    }
  }

  async updatePage(dto: UpdateAiContentPageDto) {
    const contentHtml = sanitizeStudyGuideHtml(dto.contentHtml);
    if (!contentHtml.trim()) {
      throw new BadRequestException('contentHtml is empty after sanitization');
    }

    // Ensure marker wrapper for future edits.
    let html = contentHtml;
    if (!/\bdata-syll-sg\b/i.test(html) && !/\bsyll-sg\b/i.test(html)) {
      html = `<div class="syll-sg" data-syll-sg="1">${html}</div>`;
    }

    try {
      return await this.aiContentMoodle.updatePrivatePage({
        courseId: dto.courseId,
        moodleUserId: dto.moodleUserId,
        cmId: dto.cmId,
        contentHtml: html,
        name: dto.name,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpException(message, HttpStatus.BAD_GATEWAY);
    }
  }
}
