import { clearDatabase } from './test-utils';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MembershipStatus, PatientStatus, QueueEntryStatus, Role, ServiceStatus, TokenStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { Server } from 'http';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokensService } from '../src/tokens/tokens.service';

type TokenResponse = { id: string; queueEntryId: string; sequenceNumber: number; displayNumber: string; businessDate: string; status: TokenStatus; queueEntry: { patient: { patientNumber: string; firstName: string; lastName: string }; service: { name: string; department: { name: string } } } };

describe('Tokens (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let tokensService: TokensService;
  let tokenA: string;
  let tokenB: string;
  let tokenBranchAdmin: string;
  let orgA: string;
  let orgB: string;
  let branchA1: string;
  let branchA2: string;
  let branchB1: string;
  let patientA1: string;
  let patientA2: string;
  let patientB1: string;
  let serviceA1: string;
  let serviceA2: string;
  let serviceB1: string;
  let queueA1: string;
  let queueA2: string;
  let queueB1: string;
  let branchAdminId: string;
  let businessDate: string;

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

  async function createPatient(accessToken: string, organizationId: string, branchId: string, name: string) {
    const response = await tenantRequest(accessToken, organizationId).post(`/branches/${branchId}/patients`).send({ firstName: name, lastName: 'Token', email: `${randomUUID()}@example.com` }).expect(201);
    return (response.body as { id: string }).id;
  }

  async function createService(accessToken: string, organizationId: string, branchId: string, name: string) {
    const department = await tenantRequest(accessToken, organizationId).post(`/branches/${branchId}/departments`).send({ name: `${name} Department` }).expect(201);
    const departmentId = (department.body as { id: string }).id;
    const service = await tenantRequest(accessToken, organizationId).post(`/departments/${departmentId}/services`).send({ name }).expect(201);
    return (service.body as { id: string }).id;
  }

  async function createQueueEntry(accessToken: string, organizationId: string, branchId: string, patientId: string, serviceId: string) {
    const response = await tenantRequest(accessToken, organizationId).post(`/branches/${branchId}/queue-entries`).send({ patientId, serviceId }).expect(201);
    return (response.body as { id: string }).id;
  }

  async function createDirectQueueEntry(branchId: string, patientId: string, serviceId: string) {
    const entry = await prisma.queueEntry.create({ data: { patientId, serviceId, activeEntryKey: `${patientId}:${serviceId}:${randomUUID()}` }, select: { id: true } });
    return entry.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<PrismaService>(PrismaService);
    tokensService = app.get<TokensService>(TokensService);

    tokenA = await register('phase4-a@example.com');
    tokenB = await register('phase4-b@example.com');
    tokenBranchAdmin = await register('phase4-branch-admin@example.com');
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: 'phase4-a@example.com' }, include: { memberships: true } });
    const userB = await prisma.user.findUniqueOrThrow({ where: { email: 'phase4-b@example.com' }, include: { memberships: true } });
    const branchAdmin = await prisma.user.findUniqueOrThrow({ where: { email: 'phase4-branch-admin@example.com' } });
    orgA = userA.memberships[0]!.organizationId;
    orgB = userB.memberships[0]!.organizationId;

    branchA1 = ((await tenantRequest(tokenA, orgA).post('/organizations/current/branches').send({ name: 'Phase 4 A1', code: 'P4A1' }).expect(201)).body as { id: string }).id;
    branchA2 = ((await tenantRequest(tokenA, orgA).post('/organizations/current/branches').send({ name: 'Phase 4 A2', code: 'P4A2' }).expect(201)).body as { id: string }).id;
    branchB1 = ((await tenantRequest(tokenB, orgB).post('/organizations/current/branches').send({ name: 'Phase 4 B1', code: 'P4B1' }).expect(201)).body as { id: string }).id;
    await prisma.membership.create({ data: { userId: branchAdmin.id, organizationId: orgA, branchId: branchA1, role: Role.BRANCH_ADMIN, status: MembershipStatus.ACTIVE } });
    branchAdminId = branchAdmin.id;

    patientA1 = await createPatient(tokenA, orgA, branchA1, 'Patient A1');
    patientA2 = await createPatient(tokenA, orgA, branchA1, 'Patient A2');
    patientB1 = await createPatient(tokenB, orgB, branchB1, 'Patient B1');
    serviceA1 = await createService(tokenA, orgA, branchA1, 'Service A1');
    serviceA2 = await createService(tokenA, orgA, branchA2, 'Service A2');
    serviceB1 = await createService(tokenB, orgB, branchB1, 'Service B1');
    queueA1 = await createQueueEntry(tokenA, orgA, branchA1, patientA1, serviceA1);
    queueA2 = await createQueueEntry(tokenA, orgA, branchA1, patientA2, serviceA1);
    queueB1 = await createQueueEntry(tokenB, orgB, branchB1, patientB1, serviceB1);
    await tenantRequest(tokenB, orgB).post(`/branches/${branchB1}/queue-entries/${queueB1}/token`).send({}).expect(201);
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  it('generates, retrieves, lists, filters, paginates, and idempotently replays a token', async () => {
    const first = await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries/${queueA1}/token`).send({}).expect(201);
    const firstBody = first.body as TokenResponse;
    businessDate = firstBody.businessDate.slice(0, 10);
    expect(firstBody.sequenceNumber).toBe(1);
    expect(firstBody.displayNumber).toBe('T-001');
    expect(firstBody.status).toBe(TokenStatus.WAITING);
    expect(firstBody.queueEntry.patient).toEqual(expect.objectContaining({ firstName: 'Patient A1' }));
    expect((firstBody.queueEntry.patient as { phone?: string; email?: string }).phone).toBeUndefined();
    const replay = await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries/${queueA1}/token`).send({}).expect(201);
    expect((replay.body as TokenResponse).id).toBe(firstBody.id);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/queue-entries/${queueA1}/token`).expect(200);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/tokens/${firstBody.id}`).expect(200);
    const list = await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/tokens`).query({ page: 1, limit: 20, serviceId: serviceA1, patientId: patientA1, businessDate, status: 'WAITING', search: 'T-001', sortBy: 'sequenceNumber', sortOrder: 'asc' }).expect(200);
    expect((list.body as { data: TokenResponse[]; meta: { total: number; limit: number } }).data).toHaveLength(1);
    expect((list.body as { data: TokenResponse[]; meta: { total: number; limit: number } }).meta).toMatchObject({ total: 1, limit: 20 });
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/tokens`).query({ page: -1 }).expect(400);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/tokens`).query({ limit: 101 }).expect(400);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/tokens`).query({ sortBy: 'queueEntryId' }).expect(400);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/tokens`).query({ businessDate: 'not-a-date' }).expect(400);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/tokens`).query({ search: 'x'.repeat(101) }).expect(400);
  });

  it('cancels without reuse and supports a separate daily scope', async () => {
    const first = await prisma.token.findUniqueOrThrow({ where: { queueEntryId: queueA1 } });
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/tokens/${first.id}/cancel`).expect(201);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/tokens/${first.id}/cancel`).expect(409);
    const second = await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries/${queueA2}/token`).send({}).expect(201);
    expect((second.body as TokenResponse).sequenceNumber).toBe(2);
    const tomorrow = new Date(`${businessDate}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    const nextPatient = await createPatient(tokenA, orgA, branchA1, 'Tomorrow');
    const nextQueueEntry = await createQueueEntry(tokenA, orgA, branchA1, nextPatient, serviceA1);
    const directTenant = { organizationId: orgA, membershipId: 'test-membership', role: Role.ORG_ADMIN, branchId: null };
    const tomorrowToken = await tokensService.generateForBusinessDate(directTenant, branchA1, nextQueueEntry, tomorrowKey);
    expect(tomorrowToken.sequenceNumber).toBe(1);
    expect(tomorrowToken.businessDate.toISOString().slice(0, 10)).toBe(tomorrowKey);
    const dayOneTokens = await prisma.token.findMany({ where: { sequenceId: first.sequenceId }, orderBy: { sequenceNumber: 'asc' }, select: { displayNumber: true, sequenceNumber: true, businessDate: true } });
    expect(dayOneTokens.map((token) => token.sequenceNumber)).toEqual([1, 2]);
    expect(dayOneTokens.map((token) => token.displayNumber)).toEqual(['T-001', 'T-002']);
    expect(dayOneTokens.every((token) => token.businessDate.toISOString().slice(0, 10) === businessDate)).toBe(true);
    expect(await prisma.tokenSequence.count({ where: { branchId: branchA1, serviceId: serviceA1, businessDate: { in: [new Date(`${businessDate}T00:00:00.000Z`), new Date(`${tomorrowKey}T00:00:00.000Z`)] } } })).toBe(2);
  });

  it('blocks inactive resources, forged ownership, and cross-scope access', async () => {
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries/${queueB1}/token`).send({}).expect(404);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA2}/queue-entries/${queueA1}/token`).send({}).expect(404);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/tokens/${(await prisma.token.findUniqueOrThrow({ where: { queueEntryId: queueA1 } })).id}`).expect(200);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA2}/queue-entries/${queueA1}/token`).expect(404);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries/${queueA2}/token`).send({ serviceId: serviceA2, organizationId: orgB, branchId: branchA2 }).expect(400);

    const inactivePatient = await createPatient(tokenA, orgA, branchA1, 'Inactive Patient');
    const inactiveQueue = await createQueueEntry(tokenA, orgA, branchA1, inactivePatient, serviceA1);
    await prisma.patient.update({ where: { id: inactivePatient }, data: { status: PatientStatus.INACTIVE } });
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries/${inactiveQueue}/token`).send({}).expect(404);
    await prisma.patient.update({ where: { id: inactivePatient }, data: { status: PatientStatus.ACTIVE } });

    const inactiveService = await createService(tokenA, orgA, branchA1, 'Inactive Service');
    const inactiveServiceQueue = await createQueueEntry(tokenA, orgA, branchA1, inactivePatient, inactiveService);
    await prisma.service.update({ where: { id: inactiveService }, data: { status: ServiceStatus.INACTIVE } });
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries/${inactiveServiceQueue}/token`).send({}).expect(404);
    await prisma.service.update({ where: { id: inactiveService }, data: { status: ServiceStatus.ACTIVE } });
  });

  it('enforces RBAC, suspended memberships, and tenant/branch IDOR protection', async () => {
    const tokenBRecord = await prisma.token.findUniqueOrThrow({ where: { queueEntryId: queueB1 } });
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/tokens/${tokenBRecord.id}`).expect(404);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/tokens/${tokenBRecord.id}/cancel`).expect(404);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchB1}/tokens`).expect(404);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchB1}/queue-entries/${queueB1}/token`).send({}).expect(404);
    await tenantRequest(tokenBranchAdmin, orgA).get(`/branches/${branchA2}/tokens`).expect(403);
    await tenantRequest(tokenBranchAdmin, orgA).post(`/branches/${branchA2}/queue-entries/${queueA2}/token`).send({}).expect(403);
    await prisma.membership.update({ where: { userId_organizationId: { userId: branchAdminId, organizationId: orgA } }, data: { status: MembershipStatus.SUSPENDED } });
    await tenantRequest(tokenBranchAdmin, orgA).get(`/branches/${branchA1}/tokens`).expect(403);
    await tenantRequest(tokenBranchAdmin, orgA).post(`/branches/${branchA1}/queue-entries/${queueA2}/token`).send({}).expect(403);
    await prisma.membership.update({ where: { userId_organizationId: { userId: branchAdminId, organizationId: orgA } }, data: { status: MembershipStatus.ACTIVE } });
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: 'phase4-a@example.com' } });
    await prisma.membership.update({ where: { userId_organizationId: { userId: userA.id, organizationId: orgA } }, data: { role: Role.DOCTOR } });
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/tokens`).expect(403);
    await prisma.membership.update({ where: { userId_organizationId: { userId: userA.id, organizationId: orgA } }, data: { role: Role.ORG_ADMIN } });
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/tokens/not-a-uuid`).expect(404);
  });

  it('generates unique sequences for 60 concurrent entries in one scope', async () => {
    const setup = await Promise.all(Array.from({ length: 60 }, async (_, index) => {
      const patient = await prisma.patient.create({ data: { branchId: branchA1, patientNumber: `BULK-${index}-${randomUUID()}`, firstName: `Bulk${index}`, lastName: 'Token' }, select: { id: true } });
      return createDirectQueueEntry(branchA1, patient.id, serviceA1);
    }));
    const responses = await Promise.all(setup.map((queueEntryId) => tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries/${queueEntryId}/token`).send({})));
    expect(responses.map((response) => response.status)).toEqual(Array.from({ length: 60 }, () => 201));
    const generated = await prisma.token.findMany({ where: { queueEntryId: { in: setup } }, orderBy: { sequenceNumber: 'asc' } });
    expect(generated).toHaveLength(60);
    expect(new Set(generated.map((token) => token.sequenceNumber)).size).toBe(60);
    expect(new Set(generated.map((token) => token.displayNumber)).size).toBe(60);
    expect(await prisma.tokenSequence.count({ where: { branchId: branchA1, serviceId: serviceA1, businessDate: new Date(`${businessDate}T00:00:00.000Z`), tokenType: 'NORMAL' } })).toBe(1);
  });

  it('returns one Token for 50 concurrent requests for the same QueueEntry without consuming extra sequence numbers', async () => {
    const patient = await createPatient(tokenA, orgA, branchA1, 'Same Entry');
    const queueEntryId = await createQueueEntry(tokenA, orgA, branchA1, patient, serviceA1);
    const sequenceBefore = await prisma.tokenSequence.findUnique({ where: { branchId_serviceId_businessDate_tokenType: { branchId: branchA1, serviceId: serviceA1, businessDate: new Date(`${businessDate}T00:00:00.000Z`), tokenType: 'NORMAL' } }, select: { nextNumber: true } });
    const responses = await Promise.all(Array.from({ length: 50 }, () => tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries/${queueEntryId}/token`).send({})));
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const returnedIds = new Set(responses.map((response) => (response.body as TokenResponse).id));
    expect(returnedIds.size).toBe(1);
    const storedTokens = await prisma.token.findMany({ where: { queueEntryId }, select: { id: true, sequenceNumber: true } });
    expect(storedTokens).toHaveLength(1);
    expect(storedTokens[0]!.id).toBe([...returnedIds][0]);
    const sequenceAfter = await prisma.tokenSequence.findUniqueOrThrow({ where: { branchId_serviceId_businessDate_tokenType: { branchId: branchA1, serviceId: serviceA1, businessDate: new Date(`${businessDate}T00:00:00.000Z`), tokenType: 'NORMAL' } }, select: { nextNumber: true } });
    expect(sequenceAfter.nextNumber).toBe((sequenceBefore?.nextNumber ?? 1) + 1);
  });

  it('rolls back sequence allocation when Token creation fails, then retries deterministically', async () => {
    const patient = await createPatient(tokenA, orgA, branchA1, 'Rollback');
    const queueEntryId = await createQueueEntry(tokenA, orgA, branchA1, patient, serviceA1);
    const businessDateValue = new Date(`${businessDate}T00:00:00.000Z`);
    const sequence = await prisma.tokenSequence.findUniqueOrThrow({ where: { branchId_serviceId_businessDate_tokenType: { branchId: branchA1, serviceId: serviceA1, businessDate: businessDateValue, tokenType: 'NORMAL' } }, select: { id: true, nextNumber: true } });
    const invalidQueueEntryId = randomUUID();
    await expect(prisma.$transaction(async (tx) => {
      const sequenceNumber = sequence.nextNumber;
      const claimed = await tx.tokenSequence.updateMany({ where: { id: sequence.id, nextNumber: sequenceNumber }, data: { nextNumber: { increment: 1 } } });
      expect(claimed.count).toBe(1);
      await tx.token.create({ data: { queueEntryId: invalidQueueEntryId, sequenceId: sequence.id, sequenceNumber, displayNumber: `T-${sequenceNumber.toString().padStart(3, '0')}`, businessDate: businessDateValue } });
    })).rejects.toMatchObject({ code: 'P2003' });
    const afterFailure = await prisma.tokenSequence.findUniqueOrThrow({ where: { id: sequence.id }, select: { nextNumber: true } });
    expect(afterFailure.nextNumber).toBe(sequence.nextNumber);
    expect(await prisma.token.count({ where: { queueEntryId } })).toBe(0);
    const retry = await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries/${queueEntryId}/token`).send({}).expect(201);
    expect((retry.body as TokenResponse).sequenceNumber).toBe(sequence.nextNumber);
    expect(await prisma.token.count({ where: { queueEntryId } })).toBe(1);
  });

  it('keeps QueueEntry and Token one-to-one at the database boundary', async () => {
    const token = await prisma.token.findUniqueOrThrow({ where: { queueEntryId: queueA2 } });
    await expect(prisma.token.create({ data: { queueEntryId: queueA2, sequenceId: token.sequenceId, sequenceNumber: 9999, displayNumber: 'T-9999', businessDate: token.businessDate } })).rejects.toMatchObject({ code: 'P2002' });
    const cancelledEntry = await prisma.queueEntry.create({ data: { patientId: patientA2, serviceId: serviceA1, activeEntryKey: `${patientA2}:${serviceA1}:cancelled:${randomUUID()}` }, select: { id: true } });
    await prisma.queueEntry.update({ where: { id: cancelledEntry.id }, data: { status: QueueEntryStatus.CANCELLED } });
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries/${cancelledEntry.id}/token`).send({}).expect(404);
  });
});
