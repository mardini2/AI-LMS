import { Global, Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';

@Global()
@Module({
  providers: [EmbeddingService],
  exports: [EmbeddingService],
})
export class RagModule {}
