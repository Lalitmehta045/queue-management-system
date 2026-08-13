import { clearDatabase } from './test-utils';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MembershipStatus, NotificationEventType, NotificationStatus, Role, TokenStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { Server } from 'http';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationProviderToken } from '../src/notifications/notification-providers';
import type { NotificationProvider, ProviderResult } from '../src/notifications/notification-providers';

type TokenResponse = { id: string; displayNumber: string; status: TokenStatus; counter?: { id: string; name: string; code: string } | null };
type NotificationRow = { status: NotificationStatus; attempts: number; provider: string; errorCode: string | null; providerMessageId: string | null; channel: string; eventType: string };

class ControllableProvider implements NotificationProvider {
  readonly name = 'controllable';
  mode: 'success' | 'transient' | 'permanent' | 'throw' = 'success';
  transientFailuresRemaining = 0;

  status(): Promise<'configured' | 'disabled' | 'unavailable' | 'mock' | 'noop'> {
    if (this.mode === 'throw') return Promise.resolve('unavailable');
    return Promise.resolve('mock');
  }

  sendSMS(recipient: string, message: string): Promise<ProviderResult> {
    return this.send(recipient, message);
  }

  sendWhatsApp(recipient: string, message: string): Promise<ProviderResult> {
    return this.send(recipient, message);
  }

  private send(recipient: string, message: string): Promise<ProviderResult> {
    void recipient;
    void message;
    if (this.mode === 'throw') return Promise.reject(new Error('provider is down'));
    if (this.mode === 'permanent') {
      return Promise.resolve({ ok: false, transient: false, errorCode: 'PERM_BLOCKED' });
    }
    if (this.mode === 'transient') {
      if (this.transientFailuresRemaining > 0) {
        this.transientFailuresRemaining -= 1;
        return Promise.resolve({ ok: false, transient: true, errorCode: 'TIMEOUT' });
      }
      return Promise.resolve({ ok: true, providerMessageId: 'ctrl:ok', delivered: false });
    }
    return Promise.resolve({ ok: true, providerMessageId: 'ctrl:ok', delivered: false });
  }
}

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let provider: ControllableProvider;
  let adminToken: string;
  let otherToken: string;
  let branchAdminToken: string;
  let operatorToken: string;
  let doctorToken: string;
  let receptionistToken: string;
  let orgA: string;
  let orgB: string;
  let branchA1: string;
  let branchA2: string;
  let branchB1: string;
  let counterA1: string;
  let counterA2: string;
  let serviceA1: string;
  let serviceB1: string;

  function tenantRequest(accessToken: string, organizationId: string) {
    const withTenant = (test: request.Test) => test.set('Authorization', `Bearer ${accessToken}`).set('x-organization-id', organizationId);
    return {
      get: (path: string) => withTenant(request(server).get(path)),
      post: (path: string) => withTenant(request(server).post(path)),
      patch: (path: string) => withTenant(request(server).patch(path)),
      delete: (path: string) => withTenant(request(server).delete(path)),
    };
  }

  async function register(email: string) {
    const response = await request(server).post('/auth/register').send({ email, password: 'password123', displayName: email }).expect(201);
    return (response.body as { accessToken: string }).accessToken;
  }

  async function createPatient(accessToken: string, organizationId: string, branchId: string, name: string, phone?: string) {
    const payload: Record<string, string> = { firstName: name, lastName: 'Notify', email: `${randomUUID()}@example.com` };
    if (phone) payload.phone = phone;
    const response = await tenantRequest(accessToken, organizationId).post(`/branches/${branchId}/patients`).send(payload).expect(201);
    return (response.body as { id: string }).id;
  }

  async function createService(accessToken: string, organizationId: string, branchId: string, name: string) {
    const department = await tenantRequest(accessToken, organizationId).post(`/branches/${branchId}/departments`).send({ name: `${name} Department` }).expect(201);
    const departmentId = (department.body as { id: string }).id;
    const service = await tenantRequest(accessToken, organizationId).post(`/departments/${departmentId}/services`).send({ name }).expect(201);
    return (service.body as { id: string }).id;
  }

  async function createQueueToken(accessToken: string, organizationId: string, branchId: string, name: string, serviceId: string, phone?: string) {
    const patientId = await createPatient(accessToken, organizationId, branchId, name, phone);
    const queue = await tenantRequest(accessToken, organizationId).post(`/branches/${branchId}/queue-entries`).send({ patientId, serviceId }).expect(201);
    const queueEntryId = (queue.body as { id: string }).id;
    const token = await tenantRequest(accessToken, organizationId).post(`/branches/${branchId}/queue-entries/${queueEntryId}/token`).send({}).expect(201);
    return { queueEntryId, token: token.body as TokenResponse };
  }

  async function createWalkInToken(accessToken: string, organizationId: string, branchId: string, serviceId: string) {
    const queue = await tenantRequest(accessToken, organizationId).post(`/branches/${branchId}/queue-entries`).send({ serviceId }).expect(201);
    const queueEntryId = (queue.body as { id: string }).id;
    const token = await tenantRequest(accessToken, organizationId).post(`/branches/${branchId}/queue-entries/${queueEntryId}/token`).send({}).expect(201);
    return { queueEntryId, token: token.body as TokenResponse };
  }

  async function waitForNotification(tokenId: string, eventType: NotificationEventType, predicate: (record: NotificationRow) => boolean, timeoutMs = 6_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const record = await prisma.notification.findFirst({ where: { tokenId, eventType }, orderBy: { createdAt: 'desc' } });
      if (record && predicate(record)) return record;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${eventType} notification record`);
  }

  async function waitForNotificationCount(tokenId: string, count: number, timeoutMs = 6_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const records = await prisma.notification.findMany({ where: { tokenId } });
      if (records.length >= count) return records;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Timed out waiting for notification records');
  }

  async function completeCurrent(accessToken: string, organizationId: string, branchId: string, counterId: string) {
    const response = await tenantRequest(accessToken, organizationId).get(`/branches/${branchId}/counters/${counterId}/current`);
    if (response.status === 200 && response.body && typeof response.body === 'object' && 'id' in response.body) {
      await tenantRequest(accessToken, organizationId).post(`/branches/${branchId}/counters/${counterId}/current/complete`).send({}).expect(201);
    }
  }

  beforeAll(async () => {
    provider = new ControllableProvider();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationProviderToken)
      .useValue(provider)
      .compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<PrismaService>(PrismaService);

    adminToken = await register('phase7-admin@example.com');
    otherToken = await register('phase7-other@example.com');
    branchAdminToken = await register('phase7-branch-admin@example.com');
    operatorToken = await register('phase7-operator@example.com');
    doctorToken = await register('phase7-doctor@example.com');
    receptionistToken = await register('phase7-receptionist@example.com');

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'phase7-admin@example.com' }, include: { memberships: true } });
    const other = await prisma.user.findUniqueOrThrow({ where: { email: 'phase7-other@example.com' }, include: { memberships: true } });
    const branchAdmin = await prisma.user.findUniqueOrThrow({ where: { email: 'phase7-branch-admin@example.com' } });
    const operator = await prisma.user.findUniqueOrThrow({ where: { email: 'phase7-operator@example.com' } });
    const doctor = await prisma.user.findUniqueOrThrow({ where: { email: 'phase7-doctor@example.com' } });
    const receptionist = await prisma.user.findUniqueOrThrow({ where: { email: 'phase7-receptionist@example.com' } });
    orgA = admin.memberships[0]!.organizationId;
    orgB = other.memberships[0]!.organizationId;

    branchA1 = ((await tenantRequest(adminToken, orgA).post('/organizations/current/branches').send({ name: 'Phase 7 A1', code: 'P7A1' }).expect(201)).body as { id: string }).id;
    branchA2 = ((await tenantRequest(adminToken, orgA).post('/organizations/current/branches').send({ name: 'Phase 7 A2', code: 'P7A2' }).expect(201)).body as { id: string }).id;
    branchB1 = ((await tenantRequest(otherToken, orgB).post('/organizations/current/branches').send({ name: 'Phase 7 B1', code: 'P7B1' }).expect(201)).body as { id: string }).id;
    counterA1 = ((await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/counters`).send({ name: 'Notify Counter 1', code: 'N1' }).expect(201)).body as { id: string }).id;
    counterA2 = ((await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/counters`).send({ name: 'Notify Counter 2', code: 'N2' }).expect(201)).body as { id: string }).id;
    serviceA1 = await createService(adminToken, orgA, branchA1, 'Notify Service');
    serviceB1 = await createService(otherToken, orgB, branchB1, 'Foreign Service');

    await prisma.membership.create({ data: { userId: branchAdmin.id, organizationId: orgA, branchId: branchA1, role: Role.BRANCH_ADMIN, status: MembershipStatus.ACTIVE } });
    await prisma.membership.create({ data: { userId: operator.id, organizationId: orgA, branchId: branchA1, role: Role.COUNTER_OPERATOR, status: MembershipStatus.ACTIVE } });
    await prisma.membership.create({ data: { userId: doctor.id, organizationId: orgA, branchId: branchA1, role: Role.DOCTOR, status: MembershipStatus.ACTIVE } });
    await prisma.membership.create({ data: { userId: receptionist.id, organizationId: orgA, branchId: branchA1, role: Role.RECEPTIONIST, status: MembershipStatus.ACTIVE } });
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/operators`).send({ userId: operator.id }).expect(201);
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  it('serves defaults and enforces validation, RBAC, and branch scope on notification settings', async () => {
    const defaults = await tenantRequest(adminToken, orgA).get(`/branches/${branchA1}/notification-settings`).expect(200);
    expect(defaults.body).toMatchObject({
      announcementEnabled: true,
      soundEnabled: true,
      language: 'en-US',
      speechRate: 1,
      smsEnabled: false,
      whatsappEnabled: false,
      announcementTemplate: 'Token {token}, please proceed to {counter}.',
    });

    const updated = await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ smsEnabled: true, speechRate: 1.4, announcementTemplate: 'Please come to {counter}, token {token}.' }).expect(200);
    expect(updated.body).toMatchObject({ smsEnabled: true, speechRate: 1.4 });

    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ announcementTemplate: 'Hello {name}' }).expect(400);
    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ announcementTemplate: 'Token <script>{token}</script>' }).expect(400);
    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ speechRate: 3 }).expect(400);
    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ speechRate: -1 }).expect(400);
    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ language: 'xx-XX' }).expect(400);
    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ surpriseField: true }).expect(400);
    await request(server).get(`/branches/${branchA1}/notification-settings`).expect(401);
    await tenantRequest(receptionistToken, orgA).get(`/branches/${branchA1}/notification-settings`).expect(403);
    await tenantRequest(doctorToken, orgA).get(`/branches/${branchA1}/notification-settings`).expect(403);
    await tenantRequest(branchAdminToken, orgA).get(`/branches/${branchA2}/notification-settings`).expect(403);
    await tenantRequest(branchAdminToken, orgA).get(`/branches/${branchB1}/notification-settings`).expect(403);
    await tenantRequest(adminToken, orgA).get(`/branches/${branchB1}/notification-settings`).expect(404);
  });

  it('records SENT (never DELIVERED) notifications for created tokens and keeps history tenant-scoped', async () => {
    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ smsEnabled: true, whatsappEnabled: true }).expect(200);
    const created = await createQueueToken(adminToken, orgA, branchA1, 'Notified Patient', serviceA1, '9876543210');
    await waitForNotificationCount(created.token.id, 2);
    // Wait for the background dispatcher to actually send them
    await new Promise((resolve) => setTimeout(resolve, 500));
    const sentRecords = await prisma.notification.findMany({ where: { tokenId: created.token.id } });
    expect(sentRecords).toHaveLength(2);
    expect(sentRecords.map((record) => record.channel).sort()).toEqual(['SMS', 'WHATSAPP']);
    expect(sentRecords.every((record) => record.eventType === 'TOKEN_CREATED')).toBe(true);
    expect(sentRecords.every((record) => record.status === NotificationStatus.SENT)).toBe(true);
    expect(sentRecords.every((record) => record.status !== NotificationStatus.DELIVERED)).toBe(true);
    expect(sentRecords.every((record) => record.attempts >= 1)).toBe(true);

    const history = await tenantRequest(adminToken, orgA).get(`/branches/${branchA1}/notifications?page=1&limit=20`).expect(200);
    expect((history.body as { data: Array<Record<string, unknown>> }).data.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(history.body)).not.toContain('9876543210');
    expect(JSON.stringify(history.body)).not.toContain('@example.com');
    expect(JSON.stringify(history.body)).not.toContain('Notified Patient');
    await tenantRequest(adminToken, orgA).get(`/branches/${branchA1}/notifications?status=DELIVERED`).expect(200);
    await tenantRequest(adminToken, orgA).get(`/branches/${branchA1}/notifications?channel=EMAIL`).expect(400);
    await tenantRequest(receptionistToken, orgA).get(`/branches/${branchA1}/notifications`).expect(403);
    await tenantRequest(adminToken, orgA).get(`/branches/${branchB1}/notifications`).expect(404);
  });

  it('does not record notifications when the branch channel is disabled or the patient has no phone', async () => {
    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ smsEnabled: false, whatsappEnabled: false }).expect(200);
    const noPhone = await createQueueToken(adminToken, orgA, branchA1, 'No Phone', serviceA1);
    expect(await prisma.notification.count({ where: { tokenId: noPhone.token.id } })).toBe(0);
    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ smsEnabled: true }).expect(200);
    const noPhoneTwo = await createQueueToken(adminToken, orgA, branchA1, 'No Phone Two', serviceA1);
    expect(await prisma.notification.count({ where: { tokenId: noPhoneTwo.token.id } })).toBe(0);
    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ smsEnabled: false }).expect(200);
  });

  it('keeps queue operations successful while notifications fail with bounded retries', async () => {
    await completeCurrent(adminToken, orgA, branchA1, counterA1);

    // Tokens are created while SMS is disabled so the TOKEN_CREATED dispatch
    // cannot consume the controllable provider's shared failure counters.
    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ smsEnabled: false }).expect(200);
    const transientToken = await createQueueToken(adminToken, orgA, branchA1, 'Transient Patient', serviceA1, '9123456780');
    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ smsEnabled: true }).expect(200);
    provider.mode = 'transient';
    provider.transientFailuresRemaining = 2;
    const assignedCounterId = transientToken.token.counter?.id ?? counterA1;
    await completeCurrent(adminToken, orgA, branchA1, assignedCounterId);
    const called = await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/counters/${assignedCounterId}/tokens/${transientToken.token.id}/call`).send({}).expect(201);
    expect((called.body as TokenResponse).id).toBe(transientToken.token.id);
    const transientRecord = await waitForNotification(transientToken.token.id, 'TOKEN_CALLED', (record) => record.status === NotificationStatus.SENT || record.status === NotificationStatus.FAILED);
    expect(transientRecord.status).toBe(NotificationStatus.SENT);
    expect(transientRecord.attempts).toBe(3);
    await completeCurrent(adminToken, orgA, branchA1, counterA1);

    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ smsEnabled: false }).expect(200);
    const permanentToken = await createQueueToken(adminToken, orgA, branchA1, 'Permanent Patient', serviceA1, '9123456781');
    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ smsEnabled: true }).expect(200);
    provider.mode = 'permanent';
    const assignedCounterIdPermanent = permanentToken.token.counter?.id ?? counterA1;
    await completeCurrent(adminToken, orgA, branchA1, assignedCounterIdPermanent);
    const calledPermanent = await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/counters/${assignedCounterIdPermanent}/tokens/${permanentToken.token.id}/call`).send({}).expect(201);
    expect((calledPermanent.body as TokenResponse).status).toBe(TokenStatus.CALLED);
    const permanentRecord = await waitForNotification(permanentToken.token.id, 'TOKEN_CALLED', (record) => record.status === NotificationStatus.FAILED);
    expect(permanentRecord.status).toBe(NotificationStatus.FAILED);
    expect(permanentRecord.errorCode).toBe('PERM_BLOCKED');
    expect(permanentRecord.attempts).toBe(1);
    await completeCurrent(adminToken, orgA, branchA1, counterA1);

    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ smsEnabled: false }).expect(200);
    const throwingToken = await createQueueToken(adminToken, orgA, branchA1, 'Throwing Patient', serviceA1, '9123456782');
    await tenantRequest(adminToken, orgA).patch(`/branches/${branchA1}/notification-settings`).send({ smsEnabled: true }).expect(200);
    provider.mode = 'throw';
    const assignedCounterIdThrowing = throwingToken.token.counter?.id ?? counterA1;
    await completeCurrent(adminToken, orgA, branchA1, assignedCounterIdThrowing);
    const calledThrowing = await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/counters/${assignedCounterIdThrowing}/tokens/${throwingToken.token.id}/call`).send({}).expect(201);
    expect((calledThrowing.body as TokenResponse).status).toBe(TokenStatus.CALLED);
    const throwingRecord = await waitForNotification(throwingToken.token.id, 'TOKEN_CALLED', (record) => record.status === NotificationStatus.FAILED);
    expect(throwingRecord.status).toBe(NotificationStatus.FAILED);
    expect(throwingRecord.errorCode).toBe('PROVIDER_EXCEPTION');
    expect(throwingRecord.attempts).toBe(3);
    await completeCurrent(adminToken, orgA, branchA1, counterA1);
    provider.mode = 'success';
  });

  it('prints safe tickets with correct scope and RBAC and rejects cross-tenant access', async () => {
    const printable = await createQueueToken(adminToken, orgA, branchA1, 'Print Me', serviceA1);
    const ticket = await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/tokens/${printable.token.id}/print`).send({}).expect(201);
    const body = ticket.body as Record<string, unknown>;
    expect(body).toMatchObject({
      branch: { name: 'Phase 7 A1', code: 'P7A1' },
      token: { displayNumber: printable.token.displayNumber, status: TokenStatus.WAITING },
      service: { name: 'Notify Service' },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      counter: { name: expect.any(String), code: expect.any(String) },
    });
    expect(typeof (body.organization as { name?: unknown }).name).toBe('string');
    expect(typeof (body.department as { name?: unknown }).name).toBe('string');
    expect(JSON.stringify(body)).not.toContain('Print Me');
    expect((body as { patient?: unknown }).patient).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('"phone"');

    const walkIn = await createWalkInToken(adminToken, orgA, branchA1, serviceA1);
    const walkInTicket = await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/tokens/${walkIn.token.id}/print`).send({}).expect(201);
    expect(walkInTicket.body).toMatchObject({
      branch: { name: 'Phase 7 A1', code: 'P7A1' },
      token: { displayNumber: walkIn.token.displayNumber },
    });

    await tenantRequest(receptionistToken, orgA).post(`/branches/${branchA1}/tokens/${printable.token.id}/print`).send({}).expect(201);
    await tenantRequest(branchAdminToken, orgA).post(`/branches/${branchA1}/tokens/${printable.token.id}/print`).send({}).expect(201);
    await tenantRequest(doctorToken, orgA).post(`/branches/${branchA1}/tokens/${printable.token.id}/print`).send({}).expect(403);
    await request(server).post(`/branches/${branchA1}/tokens/${printable.token.id}/print`).expect(401);
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/tokens/not-a-uuid/print`).send({}).expect(404);
    await tenantRequest(branchAdminToken, orgA).post(`/branches/${branchA2}/tokens/${printable.token.id}/print`).send({}).expect(403);

    const foreign = await createQueueToken(otherToken, orgB, branchB1, 'Foreign Print', serviceB1);
    await tenantRequest(adminToken, orgA).post(`/branches/${branchB1}/tokens/${foreign.token.id}/print`).send({}).expect(404);
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/tokens/${foreign.token.id}/print`).send({}).expect(404);
  });

  it('allows operators to print only the active token of their assigned counter', async () => {
    await completeCurrent(adminToken, orgA, branchA1, counterA1);
    const waitingToken = await createQueueToken(adminToken, orgA, branchA1, 'Operator Waiting', serviceA1);
    await tenantRequest(operatorToken, orgA).post(`/branches/${branchA1}/tokens/${waitingToken.token.id}/print`).send({}).expect(403);
    const active = await createQueueToken(adminToken, orgA, branchA1, 'Operator Active', serviceA1, '9999999999');
    const activeCounterId = active.token.counter?.id ?? counterA1;
    
    // Assign operator to whichever counter got the token
    if (activeCounterId !== counterA1) {
      const operatorUser = await prisma.user.findUniqueOrThrow({ where: { email: 'phase7-operator@example.com' } });
      await tenantRequest(adminToken, orgA).delete(`/branches/${branchA1}/counters/${counterA1}/operators/${operatorUser.id}`).send({}).expect(200);
      await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/counters/${activeCounterId}/operators`).send({ userId: operatorUser.id }).expect(201);
    }
    
    await completeCurrent(adminToken, orgA, branchA1, activeCounterId);
    await tenantRequest(operatorToken, orgA).post(`/branches/${branchA1}/counters/${activeCounterId}/tokens/${active.token.id}/call`).send({}).expect(201);
    const ticket = await tenantRequest(operatorToken, orgA).post(`/branches/${branchA1}/tokens/${active.token.id}/print`).send({}).expect(201);
    expect(['Notify Counter 1', 'Notify Counter 2']).toContain((ticket.body as { counter: { name: string } }).counter.name);
    await tenantRequest(operatorToken, orgA).post(`/branches/${branchA1}/tokens/${waitingToken.token.id}/print`).send({}).expect(403);
    const otherCounterId = activeCounterId === counterA1 ? counterA2 : counterA1;
    await tenantRequest(operatorToken, orgA).post(`/branches/${branchA1}/counters/${otherCounterId}/call-next`).send({}).expect(403);
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/counters/${activeCounterId}/current/complete`).send({}).expect(201);
  });
});
