import { clearDatabase } from './test-utils';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MembershipStatus, TokenStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type Snapshot = { display: { name: string }; current: { tokenLabel: string; counter: string; status: TokenStatus; recalled: boolean; recallCount: number } | null; recent: Array<{ tokenLabel: string; counter: string; status: TokenStatus }>; waitingSummary: { total: number }; passwordHash?: string; phone?: string; email?: string; operator?: unknown; organizationId?: string };
type SseEvent = { event: string; data: Snapshot };
type StreamReadResult = { done: boolean; value?: Uint8Array };

describe('Public displays (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken: string;
  let otherToken: string;
  let orgA: string;
  let orgB: string;
  let branchA: string;
  let branchB: string;
  let counterA: string;
  let serviceA: string;
  let displayA: { id: string; publicId: string };
  let displayB: { id: string; publicId: string };
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

  async function createToken() {
    const patient = await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/patients`).send({ firstName: 'Public', lastName: 'Viewer', email: `${randomUUID()}@example.com` }).expect(201);
    const patientId = (patient.body as { id: string }).id;
    const queue = await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/queue-entries`).send({ patientId, serviceId: serviceA }).expect(201);
    const queueEntryId = (queue.body as { id: string }).id;
    const token = await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/queue-entries/${queueEntryId}/token`).send({}).expect(201);
    return token.body as { id: string; displayNumber: string; queueEntryId: string };
  }

  function publicUrl(path: string) {
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}${path}`;
  }

  async function connectDisplayEvents(publicId: string) {
    const controller = new AbortController();
    const response = await fetch(publicUrl(`/public/displays/${publicId}/events`), { headers: { accept: 'text/event-stream' }, signal: controller.signal });
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
          const parsed = parseSseEvent(rawEvent);
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

  function parseSseEvent(rawEvent: string): SseEvent {
    const lines = rawEvent.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith('event:'))?.slice('event:'.length).trim() ?? 'message';
    const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice('data:'.length).trim()).join('\n');
    return { event, data: JSON.parse(data) as Snapshot };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0);
    server = app.getHttpServer() as Server;
    prisma = app.get<PrismaService>(PrismaService);
    adminToken = await register('phase6-display-admin@example.com');
    otherToken = await register('phase6-display-other@example.com');
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'phase6-display-admin@example.com' }, include: { memberships: true } });
    const other = await prisma.user.findUniqueOrThrow({ where: { email: 'phase6-display-other@example.com' }, include: { memberships: true } });
    orgA = admin.memberships[0]!.organizationId;
    orgB = other.memberships[0]!.organizationId;
    branchA = ((await tenantRequest(adminToken, orgA).post('/organizations/current/branches').send({ name: 'Phase 6 A', code: 'P6A' }).expect(201)).body as { id: string }).id;
    branchB = ((await tenantRequest(otherToken, orgB).post('/organizations/current/branches').send({ name: 'Phase 6 B', code: 'P6B' }).expect(201)).body as { id: string }).id;
    counterA = ((await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/counters`).send({ name: 'Display Counter', code: 'D-1' }).expect(201)).body as { id: string }).id;
    serviceA = await createService(branchA, 'Public Service');
    displayA = (await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/displays`).send({ name: 'Reception Display' }).expect(201)).body as { id: string; publicId: string };
    displayB = (await tenantRequest(otherToken, orgB).post(`/branches/${branchB}/displays`).send({ name: 'Other Display' }).expect(201)).body as { id: string; publicId: string };
    tokenA = await createToken();
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  it('serves safe branch-scoped snapshots without authentication', async () => {
    const snapshot = await request(server).get(`/public/displays/${displayA.publicId}`).expect(200);
    const body = snapshot.body as Snapshot;
    expect(body.display.name).toBe('Reception Display');
    expect(body.current).toBeNull();
    expect(body.waitingSummary.total).toBe(1);
    expect(body.passwordHash).toBeUndefined();
    expect(body.phone).toBeUndefined();
    expect(body.email).toBeUndefined();
    expect(body.operator).toBeUndefined();
    expect(body.organizationId).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('@example.com');
    expect(JSON.stringify(body)).not.toContain('Public');
    expect(JSON.stringify(body)).not.toContain('Viewer');
    await request(server).get('/public/displays/not-a-display').expect(404);
    await request(server).post(`/public/displays/${displayA.publicId}`).expect(404);
    const otherSnapshot = await request(server).get(`/public/displays/${displayB.publicId}`).expect(200);
    expect((otherSnapshot.body as Snapshot).waitingSummary.total).toBe(0);
  });

  it('streams call, recall, skip, and complete updates through SSE', async () => {
    const events = await connectDisplayEvents(displayA.publicId);
    await events.nextEvent('QUEUE_UPDATED');

    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/counters/${counterA}/tokens/${tokenA.id}/call`).send({}).expect(201);
    const calledSnapshot = await events.nextEvent('TOKEN_CALLED');
    expect(calledSnapshot.data.current).toEqual(expect.objectContaining({ tokenLabel: tokenA.displayNumber, counter: 'Display Counter', status: TokenStatus.CALLED }));
    expect(JSON.stringify(calledSnapshot.data)).not.toContain('@example.com');

    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/counters/${counterA}/current/serve`).expect(201);
    const servedSnapshot = await events.nextEvent('TOKEN_SERVED');
    expect(servedSnapshot.data.current).toEqual(expect.objectContaining({ tokenLabel: tokenA.displayNumber, status: TokenStatus.SERVING }));

    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/counters/${counterA}/current/recall`).expect(201);
    const recalledSnapshot = await events.nextEvent('TOKEN_RECALLED');
    expect(recalledSnapshot.data.current?.recalled).toBe(true);
    expect(recalledSnapshot.data.current?.recallCount).toBeGreaterThan(0);

    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/counters/${counterA}/current/skip`).expect(201);
    const skippedSnapshot = await events.nextEvent('TOKEN_SKIPPED');
    expect(skippedSnapshot.data.current).toBeNull();

    const next = await createToken();
    await events.nextEvent('QUEUE_UPDATED');
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/counters/${counterA}/tokens/${next.id}/call`).send({}).expect(201);
    await events.nextEvent('TOKEN_CALLED');
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/counters/${counterA}/current/complete`).expect(201);
    const completedSnapshot = await events.nextEvent('TOKEN_COMPLETED');
    expect(completedSnapshot.data.current).toBeNull();
    expect(completedSnapshot.data.recent.some((item) => item.tokenLabel === next.displayNumber)).toBe(true);
    events.close();
  });

  it('enforces inactive display access and supports ten simultaneous public clients', async () => {
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/displays/${displayA.id}/deactivate`).expect(201);
    await request(server).get(`/public/displays/${displayA.publicId}`).expect(404);
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/displays/${displayA.id}/activate`).expect(201);
    const responses = await Promise.all(Array.from({ length: 10 }, () => request(server).get(`/public/displays/${displayA.publicId}`)));
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(new Set(responses.map((response) => (response.body as Snapshot).display.name)).size).toBe(1);
  });

  it('supports ten simultaneous display event clients without duplicate call events', async () => {
    const clients = await Promise.all(Array.from({ length: 10 }, () => connectDisplayEvents(displayA.publicId)));
    await Promise.all(clients.map((client) => client.nextEvent('QUEUE_UPDATED')));
    const token = await createToken();
    await Promise.all(clients.map((client) => client.nextEvent('QUEUE_UPDATED')));
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/counters/${counterA}/tokens/${token.id}/call`).send({}).expect(201);
    const callEvents = await Promise.all(clients.map((client) => client.nextEvent('TOKEN_CALLED')));
    expect(callEvents.every((event) => event.data.current?.tokenLabel === token.displayNumber)).toBe(true);
    clients.forEach((client) => client.close());
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/counters/${counterA}/current/skip`).expect(201);
  });

  it('blocks cross-branch display administration and preserves tenant scope', async () => {
    await tenantRequest(adminToken, orgA).get(`/branches/${branchB}/displays`).expect(404);
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA}/displays/${displayB.id}/deactivate`).expect(404);
    await prisma.membership.update({ where: { userId_organizationId: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: 'phase6-display-admin@example.com' } })).id, organizationId: orgA } }, data: { status: MembershipStatus.SUSPENDED } });
    await tenantRequest(adminToken, orgA).get(`/branches/${branchA}/displays`).expect(403);
  });
});
