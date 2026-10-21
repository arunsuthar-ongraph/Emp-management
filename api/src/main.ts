import 'dotenv/config';
import 'reflect-metadata';
import { join } from 'path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

export const UPLOAD_ROOT = join(__dirname, '..', 'uploads');

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Profile pictures. Files get random names; nosniff stops browsers treating them as anything but images.
  app.useStaticAssets(UPLOAD_ROOT, {
    prefix: '/api/uploads/',
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  });
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`HRMS API running on http://localhost:${port}/api`);
}
bootstrap();
