import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

async function bootstrap() {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();
  
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email: 'test_debug@example.com', password: 'password123', displayName: 'Test Debug' });
    
  console.log('STATUS:', res.status);
  console.log('BODY:', res.body);
  
  await app.close();
}

bootstrap().catch(console.error);
