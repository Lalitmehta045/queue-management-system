
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { Server } from 'http';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

describe('Security (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    if (typeof app !== "undefined" && app) { await app.close(); }
  });

  it('Request ID: Generates a cryptographically strong request ID when missing', async () => {
    const res = await request(server).get('/health/live');
    expect(res.headers['x-request-id']).toBeDefined();
    expect((res.headers['x-request-id'] as string).length).toBeGreaterThanOrEqual(36);
  });

  it('Request ID: Validates client-supplied request ID and rejects malicious ones', async () => {
    const validId = randomUUID();
    const res1 = await request(server).get('/health/live').set('x-request-id', validId);
    expect(res1.headers['x-request-id']).toBe(validId);

    const maliciousId = 'invalid_id_with_symbols!@#$%^&*()';
    const res2 = await request(server).get('/health/live').set('x-request-id', maliciousId);
    // Should fallback to generating a new safe UUID
    expect(res2.headers['x-request-id']).not.toBe(maliciousId);
    expect(res2.headers['x-request-id']).toBeDefined();
  });

  it('Error responses do not leak stack traces or Prisma internals', async () => {
    // Attempt an operation that would definitely throw an error if unstructured
    // e.g. posting invalid UUID to a branch route
    const res = await request(server).get('/branches/invalid-uuid/tokens/invalid-uuid');
    
    // We expect it to be handled nicely, no stack traces
    const body = res.body as { message?: string; error?: string };
    expect(body).not.toHaveProperty('stack');
    expect(body.message).toBeDefined();
    // Error message should be generic or validation related, not SQL
    expect(body.message).not.toMatch(/SELECT|INSERT|UPDATE|DELETE|prisma|sql/i);
  });

  it.skip('Rate Limiting: Returns 429 Too Many Requests when limits are exceeded', async () => {
    // We configured AuthController register endpoint with limit: 5 per minute
    // We will spam it with invalid requests (which will get 400 Bad Request, but rate limiting applies before validation)
    const promises = [];
    for (let i = 0; i < 101; i++) {
      promises.push(request(server).post('/auth/register').send({}));
    }
    const responses = await Promise.all(promises);
    
    // The first 100 should be 400 Bad Request (because payload is empty), the 101th should be 429 Too Many Requests
    const tooManyRequests = responses.filter(r => r.status === 429);
    expect(tooManyRequests.length).toBeGreaterThanOrEqual(1);
  });
});
