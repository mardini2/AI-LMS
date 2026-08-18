import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Multipart uploads use multer; keep a modest JSON limit for normal chat.
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '2mb', extended: true });

  const config = app.get(ConfigService);

  app.enableCors({
    origin: corsOrigins(config),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  console.log(`Syllentras AI API running on port ${port} [${config.get('NODE_ENV')}]`);
}

/**
 * CORS_ORIGIN is a comma-separated list so Behat (http://webserver) can sit
 * next to the local Moodle origin. STUB_LLM also allows the Behat hostname
 * automatically so CI only has to flip one flag.
 */
function corsOrigins(config: ConfigService): string | string[] {
  const raw = config.get<string>('CORS_ORIGIN') ?? '';
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const stubOn = config.get('STUB_LLM');
  if (
    (stubOn === true || stubOn === 'true' || stubOn === '1') &&
    !origins.includes('http://webserver')
  ) {
    origins.push('http://webserver');
  }
  if (origins.length <= 1) {
    return origins[0] ?? raw;
  }
  return origins;
}

bootstrap();
