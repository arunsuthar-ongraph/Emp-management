import 'dotenv/config';
import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { hasWebBuild, UPLOAD_ROOT, WEB_DIST } from './common/paths';
import { publicConfig, ROOT_DOMAIN } from './common/config';

async function bootstrap() {
  const log = new Logger('Bootstrap');
  const secret = process.env.JWT_SECRET?.trim() || '';
  if (secret.length < 32) {
    // Says whether it's missing or too short, never the value itself
    const problem = secret ? `JWT_SECRET is only ${secret.length} characters` : 'JWT_SECRET is not set';
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`${problem}. Set it on this service to a random string of at least 32 characters (e.g. the output of: openssl rand -hex 32).`);
    }
    log.warn(`${problem}; fine for local development only`);
  }

  // Fallback: Railway's Postgres also exposes PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  if (!process.env.DATABASE_URL?.trim() && PGHOST && PGUSER && PGPASSWORD && PGDATABASE) {
    process.env.DATABASE_URL = `postgresql://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}:${PGPORT || 5432}/${PGDATABASE}`;
    log.log('DATABASE_URL built from PGHOST/PGUSER/PGPASSWORD/PGDATABASE');
  }

  const db = process.env.DATABASE_URL?.trim() || '';
  if (process.env.NODE_ENV === 'production') {
    if (!db) {
      // Names only (never values), so the logs show what this service actually receives
      const seen = Object.keys(process.env)
        .filter((k) => /^(DATABASE|PG|POSTGRES)/.test(k))
        .map((k) => `${k}${process.env[k] ? '' : ' (empty)'}`);
      log.error(
        `Database variables visible to this service: ${seen.join(', ') || 'none'}. ` +
          `Running as service "${process.env.RAILWAY_SERVICE_NAME ?? '?'}" in environment "${process.env.RAILWAY_ENVIRONMENT_NAME ?? '?'}".`,
      );
      throw new Error(
        'DATABASE_URL is empty. On Railway, set it on this service as a reference to your database, e.g. ${{Postgres.DATABASE_URL}}, ' +
          'where "Postgres" is the exact name of your database service (an unknown name resolves to an empty value).',
      );
    }
    if (/@(localhost|127\.0\.0\.1)[:/]/.test(db)) {
      throw new Error('DATABASE_URL points at localhost. On Railway, use a reference to your database service, e.g. ${{Postgres.DATABASE_URL}}.');
    }
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
    // index.html gets the runtime settings (e.g. the company domain), so changing them needs no rebuild
    const config = JSON.stringify(publicConfig()).replace(/</g, '\\u003c');
    const indexHtml = readFileSync(join(WEB_DIST, 'index.html'), 'utf8').replace('</head>', `<script>window.__APP_CONFIG__=${config}</script></head>`);
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache'); // always pick up a new deploy
      res.type('html').send(indexHtml);
    });
    log.log(`Serving frontend from ${WEB_DIST}; company domain: ${ROOT_DOMAIN || '(not set)'}`);
    if (process.env.NODE_ENV === 'production' && (!ROOT_DOMAIN || ROOT_DOMAIN === 'localhost' || ROOT_DOMAIN.endsWith('.localhost'))) {
      log.warn(
        `Company domain is ${ROOT_DOMAIN ? `"${ROOT_DOMAIN}"` : 'not set'}, so companies sign in by path (https://<this address>/<company>). ` +
          'For company subdomains, add a custom domain with a wildcard and set ROOT_DOMAIN (e.g. peopledesk.in).',
      );
    }
  }

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  log.log(`HRMS running on port ${port} (API at /api)`);
}
bootstrap();
