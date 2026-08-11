import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import "reflect-metadata";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import type { ValidatedEnvironment } from "./config/env.validation";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { Logger } from "nestjs-pino";

function parseCorsOrigins(corsOrigin: string): string[] {
  return corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function configureApplication(app: INestApplication): void {
  const configService =
    app.get<ConfigService<ValidatedEnvironment, true>>(ConfigService);
  const corsOrigins = parseCorsOrigins(configService.get("CORS_ORIGIN"));

  app.enableCors({
    origin: corsOrigins,
    credentials: true
  });

  app.use(cookieParser());
  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );

  app.useGlobalFilters(new HttpExceptionFilter());
}

export async function createApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true
  });
  app.useLogger(app.get(Logger));
  configureApplication(app);
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  const app = await createApplication();
  const configService =
    app.get<ConfigService<ValidatedEnvironment, true>>(ConfigService);

  await app.listen(configService.get("PORT"));
}

if (require.main === module) {
  void bootstrap();
}
