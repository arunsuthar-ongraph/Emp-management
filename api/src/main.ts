import 'dotenv/config';
import 'reflect-metadata';
import { join } from 'path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { hasWebBuild, UPLOAD_ROOT, WEB_DIST } from './common/paths';

async function bootstrap() {
  const log = new Logger('Bootstrap');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set to a random string of at least 32 characters');
    log.warn('JWT_SECRET is missing or short; fine for local development only');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  app.enableShutdownHooks(); // close DB connections cleanly when Railway stops the container
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Profile pictures. Files get random names; nosniff stops browsers treating them as anything but images.
  app.useStaticAssets(UPLOAD_ROOT, {
    prefix: '/api/uploads/',
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  });

  // Production: serve the built frontend from the same service, with SPA fallback for client routes
  if (hasWebBuild()) {
    app.useStaticAssets(WEB_DIST, { index: false, maxAge: '1y', immutable: true });
    const indexHtml = join(WEB_DIST, 'index.html');
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache'); // always pick up a new deploy
      res.sendFile(indexHtml);
    });
    log.log(`Serving frontend from ${WEB_DIST}`);
  }

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  log.log(`HRMS running on port ${port} (API at /api)`);
}
bootstrap();
