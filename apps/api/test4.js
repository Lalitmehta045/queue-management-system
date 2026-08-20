const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { ConfigService } = require('@nestjs/config');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const configService = app.get(ConfigService);
  console.log('DATABASE_URL in NestJS ConfigService:', configService.get('DATABASE_URL'));
  await app.close();
}
bootstrap();
