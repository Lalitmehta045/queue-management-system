import { clearDatabase } from './test-utils';
/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import cookieParser from 'cookie-parser';


describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    
    prisma = app.get<PrismaService>(PrismaService);
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  let accessToken: string;
  let refreshToken: string;
  const testUser = { email: 'test@example.com', password: 'password123', displayName: 'Test User' };

  it('/auth/register (POST)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(testUser);
    
    if (res.status !== 201) console.log('REGISTER FAILED:', res.body);
    expect(res.status).toBe(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.header['set-cookie']).toBeDefined();
    
    // Store tokens for further tests
    accessToken = (res.body as { accessToken: string }).accessToken;
    
    const cookies = res.header['set-cookie'] as unknown as string[];
    const refreshCookie = cookies.find(c => c.startsWith('refreshToken='));
    expect(refreshCookie).toBeDefined();
    refreshToken = (refreshCookie || '').split(';')[0]?.split('=')[1] as string;
  });

  it('/auth/register (POST) - duplicate email', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(testUser)
      .expect(409);
  });

  it('/auth/login (POST) - invalid password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: 'wrongpassword' })
      .expect(401);
  });

  it('/auth/login (POST) - success', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    expect((res.body as { accessToken: string }).accessToken).toBeDefined();
    accessToken = (res.body as { accessToken: string }).accessToken; // update
  });

  it('/auth/me (GET) - without token', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .expect(401);
  });

  it('/auth/me (GET) - with invalid token', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('/auth/me (GET) - with valid token', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
      
    expect((res.body as { email: string }).email).toBe(testUser.email);
    expect((res.body as { passwordHash?: string }).passwordHash).toBeUndefined(); // ensure password hash not leaked
  });

  it('/auth/refresh (POST) - success', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refreshToken=${refreshToken}`])
      .expect(200);

    expect((res.body as { accessToken: string }).accessToken).toBeDefined();
    
    const cookies = res.header['set-cookie'] as unknown as string[];
    const refreshCookie = cookies.find(c => c.startsWith('refreshToken='));
    expect(refreshCookie).toBeDefined();
    
    // update for the next test
    const oldRefreshToken = refreshToken;
    refreshToken = (refreshCookie || '').split(';')[0]?.split('=')[1] as string;

    // Attempt refresh reuse
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refreshToken=${oldRefreshToken}`])
      .expect(401);
  });

  it('/auth/logout (POST) - revokes session', async () => {
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
      
    // Attempt to use the refresh token again after logout should fail
    // But since logout revokes the session that generated accessToken, let's see:
    // Wait, accessToken might still be valid since it's JWT, but refresh token is definitely revoked
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refreshToken=${refreshToken}`])
      .expect(401);
  });
});
