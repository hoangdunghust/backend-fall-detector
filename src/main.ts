import 'dotenv/config';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig, ConfigError, loadConfig } from './config/app-config';
import { isSwaggerEnabled, setupSwagger, SWAGGER_PATH } from './docs/swagger';

async function bootstrap(): Promise<void> {
  let cfg: AppConfig;
  try {
    cfg = loadConfig(process.env);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  const app = await NestFactory.create(AppModule);
  const swaggerOn = isSwaggerEnabled(process.env);
  const strictHelmet = helmet();
  if (swaggerOn) {
    // Swagger UI cần script/style nội tuyến nên chính sách CSP mặc định của helmet làm nó trắng trang.
    // Chỉ nới CSP cho đường dẫn tài liệu; mọi API khác vẫn dùng helmet đầy đủ.
    const docsHelmet = helmet({ contentSecurityPolicy: false });
    app.use((req: Request, res: Response, next: NextFunction) =>
      req.path === `/${SWAGGER_PATH}` || req.path.startsWith(`/${SWAGGER_PATH}/`)
        ? docsHelmet(req, res, next)
        : strictHelmet(req, res, next),
    );
  } else {
    app.use(strictHelmet);
  }
  if (cfg.corsOrigins.length > 0) app.enableCors({ origin: cfg.corsOrigins });
  if (cfg.trustProxy) {
    // Đứng sau reverse proxy: lấy đúng IP client cho giới hạn tần suất đăng nhập
    (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', 1);
  }
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  if (swaggerOn) setupSwagger(app, cfg.deviceId);
  app.enableShutdownHooks();

  await app.listen(cfg.port, '0.0.0.0');
  Logger.log(`BE chạy ở cổng ${cfg.port} — thiết bị ${cfg.deviceId} — push: ${cfg.notify.provider}`, 'Bootstrap');
  if (swaggerOn) Logger.log(`Swagger: http://localhost:${cfg.port}/${SWAGGER_PATH}`, 'Bootstrap');
}

bootstrap();
