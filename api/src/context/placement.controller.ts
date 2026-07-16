import {
  Body,
  Controller,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContextService } from './context.service';
import { EnsurePlacementDto } from './dto/ensure-placement.dto';

/**
 * Dev/smoke-test endpoints for Moodle AI Content placement (Path A).
 * Disabled in production — Path B will drive placement from confirmed chat actions.
 */
@Controller('moodle/placement')
export class PlacementController {
  constructor(
    private readonly contextService: ContextService,
    private readonly config: ConfigService,
  ) {}

  /**
   * POST /moodle/placement/ensure
   * Ensures the shared AI Content section and private student group exist.
   */
  @Post('ensure')
  async ensure(@Body() dto: EnsurePlacementDto) {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException(
        'Placement ensure is disabled in production',
      );
    }

    try {
      return await this.contextService.ensureStudentPlacement(
        dto.courseId,
        dto.moodleUserId,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpException(message, HttpStatus.BAD_GATEWAY);
    }
  }
}
