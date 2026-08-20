import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TokensService } from './tokens/tokens.service';

async function bootstrap() {
  console.log('Bootstrapping testing script...');
  try {
    const app = await NestFactory.createApplicationContext(AppModule);
    const tokensService = app.get(TokensService);
    console.log('App initialized.');
    
    // We would need to mock a tenant and call generateBulk here
    console.log('Done.');
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
bootstrap();
