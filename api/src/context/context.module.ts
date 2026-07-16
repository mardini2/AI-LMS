import { Module } from '@nestjs/common';
import { ContextService } from './context.service';
import { PlacementController } from './placement.controller';

@Module({
  controllers: [PlacementController],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
