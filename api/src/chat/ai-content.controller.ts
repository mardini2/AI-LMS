import {
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { AiContentService } from './ai-content.service';
import {
  AiContentCourseUserQueryDto,
  AiContentExportQueryDto,
  DeleteAiContentDto,
  DeleteManyAiContentDto,
  RenameAiContentDto,
  UpdateAiContentPageDto,
} from './dto/ai-content.dto';

@Controller('ai-content')
export class AiContentController {
  constructor(private readonly aiContent: AiContentService) {}

  /**
   * GET /ai-content?courseId=&moodleUserId=
   */
  @Get()
  list(@Query() query: AiContentCourseUserQueryDto) {
    return this.aiContent.list(query.courseId, query.moodleUserId);
  }

  /**
   * GET /ai-content/export?courseId=&moodleUserId=&cmId=
   */
  @Get('export')
  exportContent(@Query() query: AiContentExportQueryDto) {
    return this.aiContent.export(query);
  }

  /**
   * POST /ai-content/rename
   */
  @Post('rename')
  rename(@Body() dto: RenameAiContentDto) {
    return this.aiContent.rename(dto);
  }

  /**
   * POST /ai-content/delete
   */
  @Post('delete')
  delete(@Body() dto: DeleteAiContentDto) {
    return this.aiContent.delete(dto);
  }

  /**
   * POST /ai-content/delete-many
   */
  @Post('delete-many')
  deleteMany(@Body() dto: DeleteManyAiContentDto) {
    return this.aiContent.deleteMany(dto);
  }

  /**
   * POST /ai-content/update-page
   * Persist edited study-guide (or other Page) HTML.
   */
  @Post('update-page')
  updatePage(@Body() dto: UpdateAiContentPageDto) {
    return this.aiContent.updatePage(dto);
  }
}
