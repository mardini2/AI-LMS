// goal: start the HTTP API with security headers, CORS, validation, and global error handling.

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance();
  // hide default Express header so clients don't see the server stack
  expressApp.disable('x-powered-by');

  app.use(helmet());

  // comma-separated list from env; defaults to local Vite dev server
  const allowedOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // when behind a reverse proxy, trust X-Forwarded-* for correct client IP / HTTPS
  if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
    expressApp.set('trust proxy', 1);
  }

  // strip unknown properties and coerce types on DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // return consistent JSON error shape for HTTP errors
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
bootstrap();
