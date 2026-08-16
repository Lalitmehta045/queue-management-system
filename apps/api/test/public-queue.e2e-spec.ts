import { clearDatabase } from './test-utils';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TokenStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type SseEvent = { event: string; data: Record<string, unknown> };
type StreamReadResult = { done: boolean; value?: Uint8Array };

type PublicQueueSnapshot = {
  tokenLabel: string;
  status: string;
  serviceName: string;
  departmentName: string;
  businessDate: string;
  currentServingToken: string | null;
  peopleAhead: number | null;
  estimatedWaitMinutes: number | null;
  lastUpdated: string;
};

describe('Public Queue Status (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken: string;
  let orgA: string;
  let branchA: string;
  let counterA: string;
  let serviceA: string;
  let tokenA: { id: string; displayNumber: string };

  function tenantRequest(accessToken: string, organizationId: string) {
    const withTenant = (test: request.Test) => test.set('Authorization', `Bearer ${accessToken}`).set('x-organization-id', organizationId);
    return {
      get: (path: string) => withTenant(request(server).get(path)),
      post: (path: string) => withTenant(request(server).post(path)),
    };
  }

  async function register(email: string) {
    const response = await request(server).post('/auth/register').send({ email, password: 'password123', displayName: email }).expect(201);
    return (response.body as { accessToken: string }).accessToken;
  }

  async function createService(branchId: string, name: string) {
    const department = await tenantRequest(adminToken, orgA).post(`/branches/${branchId}/departments`).send({ name: `${name} Department` }).expect(201);
    const service = await tenantRequest(adminToken, orgA).post(`/departments/${(department.body as { id: string }).id}/services`).send({ name }).expect(201);
    return (service.body as { id: string }).id;
  }

  async function createToken(serviceId: string = serviceA, branchId: string = branchA) {
    const patient = await tenantRequest(adminToken, orgA).post(`/branches/${branchId}/patients`).send({ firstName: 'Public', lastName: 'Viewer', email: `${randomUUID()}@example.com` }).expect(201);
    const patientId = (patient.body as { id: string }).id;
    const queue = await tenantRequest(adminToken, orgA).post(`/branches/${branchId}/queue-entries`).send({ patientId, serviceId }).expect(201);
    const queueEntryId = (queue.body as { id: string }).id;
    const token = await tenantRequest(adminToken, orgA).post(`/branches/${branchId}/queue-entries/${queueEntryId}/token`).send({}).expect(201);
    return token.body as { id: string; displayNumber: string; queueEntryId: string };
  }

  function publicUrl(path: string) {
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}${path}`;
  }

  async function connectQueueEvents(publicTokenId: string) {
    const controller = new AbortController();
    const response = await fetch(publicUrl(`/public/queue/${publicTokenId}/events`), { headers: { accept: 'text/event-stream' }, signal: controller.signal });
    expect(response.status).toBe(200);
    if (!response.body) throw new Error('SSE response body was not available');
    const reader = response.body.getReader();
    let buffer = '';

    async function nextEvent(expectedEvent?: string): Promise<SseEvent> {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const chunk = await Promise.race([
          reader.read() as Promise<StreamReadResult>,
          new Promise<StreamReadResult>((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for SSE data')), Math.max(1, deadline - Date.now()))),
        ]);
        if (chunk.done || !chunk.value) throw new Error('SSE stream ended before expected event');
        buffer += Buffer.from(chunk.value).toString('utf8');
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          
          const lines = rawEvent.split(/\r?\n/);
          const event = lines.find((line) => line.startsWith('event:'))?.slice('event:'.length).trim() ?? 'message';
          const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice('data:'.length).trim()).join('\n');
          const parsed: SseEvent = { event, data: JSON.parse(data) as Record<string, unknown> };
          
          if (parsed.event !== 'KEEPALIVE' && (!expectedEvent || parsed.event === expectedEvent)) return parsed;
          boundary = buffer.indexOf('\n\n');
        }
      }
      throw new Error(`Timed out waiting for ${expectedEvent ?? 'SSE event'}`);
    }

    return {
      nextEvent,
      close: () => {
        controller.abort();
        void reader.cancel().catch(() => undefined);
      },
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0);
    server = app.getHttpServer() as Server;
    prisma = app.get<PrismaService>(PrismaService);
    adminToken = await register('phase17-queue-admin@example.com');
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'phase17-queue-admin@example.com' }, include: { memberships: true } });
    orgA = admin.memberships[0]!.organizationId;
    branchA = ((await tenantRequest(adminToken, orgA).post('/organizations/current/branches').send({ name: 'Phase 17 A', code: 'P17A' }).expect(201)).body as { id: string }).id;
    // Create branch B but only used for isolation tests (not directly in vars)
    await tenantRequest(adminToken, orgA).post('/organizations/current/branches').send({ name: 'Phase 17 B', code: 'P17B' }).expect(201);
    counterA = ((await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/counters`).send({ name: 'Queue Counter', code: 'Q-1' }).expect(201)).body as { id: string }).id;
    serviceA = await createService(branchA, 'Queue Service');
    tokenA = await createToken(serviceA, branchA);
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  it('serves public token status without exposing PII', async () => {
    const snapshot = await request(server).get(`/public/queue/${tokenA.id}`).expect(200);
    const body = snapshot.body as PublicQueueSnapshot & Record<string, unknown>;
    expect(body.tokenLabel).toBe(tokenA.displayNumber);
    expect(body.status).toBe(TokenStatus.WAITING);
    expect(body.serviceName).toBe('Queue Service');
    expect(body.peopleAhead).toBe(0); // since it's the only one right now
    expect(body['patientId']).toBeUndefined();
    expect(body['patient']).toBeUndefined();
    expect(body['email']).toBeUndefined();
    expect(body['phone']).toBeUndefined();
    expect(body['organizationId']).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('@example.com');
    expect(JSON.stringify(body)).not.toContain('Public');
    expect(JSON.stringify(body)).not.toContain('Viewer');

    // Test nonexistent token
    await request(server).get(`/public/queue/${randomUUID()}`).expect(404);
    // Test invalid UUID
    await request(server).get(`/public/queue/not-a-uuid`).expect(404);
  });

  it('calculates people ahead correctly with priority isolation', async () => {
    // We already have tokenA
    const tokenB = await createToken(serviceA, branchA);
    const tokenC = await createToken(serviceA, branchA);
    
    // Check tokenC's peopleAhead
    let resC = await request(server).get(`/public/queue/${tokenC.id}`).expect(200);
    expect((resC.body as PublicQueueSnapshot).peopleAhead).toBe(2);

    // Call tokenA, tokenC should now have 1 person ahead
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/counters/${counterA}/tokens/${tokenA.id}/call`).send({}).expect(201);
    
    resC = await request(server).get(`/public/queue/${tokenC.id}`).expect(200);
    expect((resC.body as PublicQueueSnapshot).peopleAhead).toBe(1);

    // Complete tokenA
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/counters/${counterA}/current/complete`).expect(201);

    // Let's create a priority token to skip tokenB and tokenC
    const patientPriority = await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/patients`).send({ firstName: 'Pri', lastName: 'Patient' }).expect(201);
    const queuePriority = await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/queue-entries`).send({ patientId: (patientPriority.body as {id:string}).id, serviceId: serviceA, priority: 'VIP' }).expect(201);
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/queue-entries/${(queuePriority.body as {id:string}).id}/token`).send({}).expect(201);
    
    // Priority token is added. Since no VIP weight is configured, it defaults to weight 0 (same as NORMAL).
    // tokenC's peopleAhead increases by 1 (the new token added)
    resC = await request(server).get(`/public/queue/${tokenC.id}`).expect(200);
    expect((resC.body as PublicQueueSnapshot).peopleAhead).toBe(2);

    const resB = await request(server).get(`/public/queue/${tokenB.id}`).expect(200);
    expect((resB.body as PublicQueueSnapshot).peopleAhead).toBe(1);
  });

  it('streams status updates through SSE for state transitions', async () => {
    const tokenB = await createToken(serviceA, branchA);
    const events = await connectQueueEvents(tokenB.id);
    
    // Wait for initial snapshot
    await events.nextEvent('QUEUE_UPDATED');

    // Call token
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/counters/${counterA}/tokens/${tokenB.id}/call`).send({}).expect(201);
    let event = await events.nextEvent('TOKEN_CALLED');
    expect((event.data as PublicQueueSnapshot).status).toBe(TokenStatus.CALLED);
    expect((event.data as PublicQueueSnapshot).currentServingToken).toBe(tokenB.displayNumber);
    expect((event.data as PublicQueueSnapshot).peopleAhead).toBeNull();

    // Complete token
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/counters/${counterA}/current/complete`).expect(201);
    event = await events.nextEvent('TOKEN_COMPLETED');
    expect((event.data as PublicQueueSnapshot).status).toBe(TokenStatus.COMPLETED);

    events.close();
  });
});
