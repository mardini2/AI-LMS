import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { AiContentMoodleService } from '../context/ai-content-moodle.service';
import { withKindTitlePrefix } from './ai-content-title';
import { sanitizeStudyGuideHtml } from './study-guide.helpers';
import type {
  AiContentExportQueryDto,
  DeleteAiContentDto,
  DeleteManyAiContentDto,
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
    const name = withKindTitlePrefix(dto.name, dto.kind);
    try {
      return await this.aiContentMoodle.renamePrivateActivity({
        courseId: dto.courseId,
        moodleUserId: dto.moodleUserId,
        cmId: dto.cmId,
        name,
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

  async deleteMany(dto: DeleteManyAiContentDto) {
    try {
      return await this.aiContentMoodle.deletePrivateActivities({
        courseId: dto.courseId,
        moodleUserId: dto.moodleUserId,
        cmIds: dto.cmIds,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpException(message, HttpStatus.BAD_GATEWAY);
    }
  }

  async export(dto: AiContentExportQueryDto) {
    try {
      return await this.aiContentMoodle.exportPrivateContent({
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
        name: dto.name
          ? withKindTitlePrefix(dto.name, 'study_guide')
          : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpException(message, HttpStatus.BAD_GATEWAY);
    }
  }
}
