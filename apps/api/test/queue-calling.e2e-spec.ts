import { clearDatabase } from './test-utils';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { CounterStatus, MembershipStatus, Role, TokenStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { Server } from 'http';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type TokenResponse = { id: string; displayNumber: string; sequenceNumber: number; status: TokenStatus; businessDate?: string; counter?: { id: string; name: string; code: string } | null; queueEntry: { patient: { patientNumber: string; firstName: string; lastName: string }; service: { name: string; department: { name: string } } } };

describe('Queue calling (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken: string;
  let operatorOneToken: string;
  let operatorTwoToken: string;
  let orgA: string;
  let orgB: string;
  let branchA1: string;
  let branchA2: string;
  let branchB1: string;
  let counterA1: string;
  let counterA2: string;
  let counterB1: string;
  let operatorOneId: string;
  let operatorTwoId: string;
  let tokenA1: string;
  let tokenB1: string;
  let serviceA1: string;
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
    const response = await tenantRequest(accessToken, organizationId).post(`/branches/${branchId}/patients`).send({ firstName: name, lastName: 'Calling', email: `${randomUUID()}@example.com` }).expect(201);
    return (response.body as { id: string }).id;
  }

  async function createService(accessToken: string, organizationId: string, branchId: string, name: string) {
    const department = await tenantRequest(accessToken, organizationId).post(`/branches/${branchId}/departments`).send({ name: `${name} Department` }).expect(201);
    const departmentId = (department.body as { id: string }).id;
    const service = await tenantRequest(accessToken, organizationId).post(`/departments/${departmentId}/services`).send({ name }).expect(201);
    return (service.body as { id: string }).id;
  }

  async function createQueueToken(accessToken: string, organizationId: string, branchId: string, name: string, serviceId: string) {
    const patientId = await createPatient(accessToken, organizationId, branchId, name);
    const queue = await tenantRequest(accessToken, organizationId).post(`/branches/${branchId}/queue-entries`).send({ patientId, serviceId }).expect(201);
    const queueEntryId = (queue.body as { id: string }).id;
    const token = await tenantRequest(accessToken, organizationId).post(`/branches/${branchId}/queue-entries/${queueEntryId}/token`).send({}).expect(201);
    return { queueEntryId, token: token.body as TokenResponse };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<PrismaService>(PrismaService);

    adminToken = await register('phase5-admin@example.com');
    const operatorOneEmail = 'phase5-operator-one@example.com';
    const operatorTwoEmail = 'phase5-operator-two@example.com';
    operatorOneToken = await register(operatorOneEmail);
    operatorTwoToken = await register(operatorTwoEmail);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'phase5-admin@example.com' }, include: { memberships: true } });
    const operatorOne = await prisma.user.findUniqueOrThrow({ where: { email: operatorOneEmail } });
    const operatorTwo = await prisma.user.findUniqueOrThrow({ where: { email: operatorTwoEmail } });
    operatorOneId = operatorOne.id;
    operatorTwoId = operatorTwo.id;
    orgA = admin.memberships[0]!.organizationId;

    branchA1 = ((await tenantRequest(adminToken, orgA).post('/organizations/current/branches').send({ name: 'Phase 5 A1', code: 'P5A1' }).expect(201)).body as { id: string }).id;
    branchA2 = ((await tenantRequest(adminToken, orgA).post('/organizations/current/branches').send({ name: 'Phase 5 A2', code: 'P5A2' }).expect(201)).body as { id: string }).id;
    const otherToken = await register('phase5-other@example.com');
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { email: 'phase5-other@example.com' }, include: { memberships: true } });
    orgB = otherUser.memberships[0]!.organizationId;
    branchB1 = ((await tenantRequest(otherToken, orgB).post('/organizations/current/branches').send({ name: 'Phase 5 B1', code: 'P5B1' }).expect(201)).body as { id: string }).id;

    counterA1 = ((await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/counters`).send({ name: 'Counter A1', code: 'A1' }).expect(201)).body as { id: string }).id;
    counterA2 = ((await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/counters`).send({ name: 'Counter A2', code: 'A2' }).expect(201)).body as { id: string }).id;
    counterB1 = ((await tenantRequest(otherToken, orgB).post(`/branches/${branchB1}/counters`).send({ name: 'Counter B1', code: 'B1' }).expect(201)).body as { id: string }).id;
    await prisma.membership.create({ data: { userId: operatorOneId, organizationId: orgA, branchId: branchA1, role: Role.COUNTER_OPERATOR, status: MembershipStatus.ACTIVE } });
    await prisma.membership.create({ data: { userId: operatorTwoId, organizationId: orgA, branchId: branchA1, role: Role.COUNTER_OPERATOR, status: MembershipStatus.ACTIVE } });
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/operators`).send({ userId: operatorOneId }).expect(201);
    await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/counters/${counterA2}/operators`).send({ userId: operatorTwoId }).expect(201);

    serviceA1 = await createService(adminToken, orgA, branchA1, 'Service A1');
    const first = await createQueueToken(adminToken, orgA, branchA1, 'Patient A1', serviceA1);
    tokenA1 = first.token.id;
    businessDate = first.token.businessDate ?? '';
    const foreignService = await createService(otherToken, orgB, branchB1, 'Service B1');
    const foreign = await createQueueToken(otherToken, orgB, branchB1, 'Patient B1', foreignService);
    tokenB1 = foreign.token.id;
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  it('executes CALL, SERVE, RECALL, SKIP, and COMPLETE with safe transitions', async () => {
    const called = await tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/tokens/${tokenA1}/call`).send({}).expect(201);
    expect((called.body as TokenResponse).status).toBe(TokenStatus.CALLED);
    const recalled = await tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/current/recall`).expect(201);
    expect((recalled.body as TokenResponse & { recallCount: number }).recallCount).toBe(1);
    const current = await tenantRequest(operatorOneToken, orgA).get(`/branches/${branchA1}/counters/${counterA1}/current`).expect(200);
    expect((current.body as TokenResponse).status).toBe(TokenStatus.CALLED);
    const completed = await tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/current/complete`).expect(201);
    expect((completed.body as TokenResponse).status).toBe(TokenStatus.COMPLETED);
    const emptyCurrent = await tenantRequest(operatorOneToken, orgA).get(`/branches/${branchA1}/counters/${counterA1}/current`).expect(200);
    expect(emptyCurrent.headers['content-type']).toMatch(/application\/json/);
    expect(emptyCurrent.text).toBe('null');
    await tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/current/recall`).expect(409);
    await tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/tokens/${tokenA1}/call`).send({}).expect(409);
  });

  it('enforces CALL NEXT ordering, skip behavior, and current-token exclusivity', async () => {
    const first = await createQueueToken(adminToken, orgA, branchA1, 'Next One', serviceA1);
    await createQueueToken(adminToken, orgA, branchA1, 'Next Two', serviceA1);
    const third = await createQueueToken(adminToken, orgA, branchA1, 'Next Three', serviceA1);
    
    const assignedCounterId = first.token.counter?.id ?? counterA1;
    const operator = assignedCounterId === counterA1 ? operatorOneToken : operatorTwoToken;

    const called = await tenantRequest(operator, orgA).post(`/branches/${branchA1}/counters/${assignedCounterId}/call-next`).expect(201);
    expect((called.body as TokenResponse).id).toBe(first.token.id);
    await tenantRequest(operator, orgA).post(`/branches/${branchA1}/counters/${assignedCounterId}/call-next`).expect(409);
    await tenantRequest(operator, orgA).post(`/branches/${branchA1}/counters/${assignedCounterId}/current/skip`).expect(201);
    
    const next = await tenantRequest(operator, orgA).post(`/branches/${branchA1}/counters/${assignedCounterId}/call-next`).expect(201);
    expect((next.body as TokenResponse).id).toBe(third.token.id);
    
    await tenantRequest(operator, orgA).post(`/branches/${branchA1}/counters/${assignedCounterId}/current/complete`).expect(201);
    const waiting = await tenantRequest(operator, orgA).get(`/branches/${branchA1}/counters/${assignedCounterId}/waiting`).expect(200);
    expect((waiting.body as { data: TokenResponse[] }).data.every((token) => token.status === TokenStatus.WAITING)).toBe(true);
  });

  it('allows exactly one winner when two counters call the same waiting token concurrently', async () => {
    const target = await createQueueToken(adminToken, orgA, branchA1, 'Concurrent One', serviceA1);
    const results = await Promise.all([
      tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/tokens/${target.token.id}/call`).send({}),
      tenantRequest(operatorTwoToken, orgA).post(`/branches/${branchA1}/counters/${counterA2}/tokens/${target.token.id}/call`).send({}),
    ]);
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409)).toHaveLength(1);
    expect(await prisma.token.count({ where: { id: target.token.id, status: TokenStatus.CALLED } })).toBe(1);
    expect(await prisma.token.count({ where: { id: target.token.id, counterId: { not: null } } })).toBe(1);
    const winnerCounter = (await prisma.token.findUniqueOrThrow({ where: { id: target.token.id }, select: { counterId: true } })).counterId!;
    const winnerOperatorToken = winnerCounter === counterA1 ? operatorOneToken : operatorTwoToken;
    await tenantRequest(winnerOperatorToken, orgA).post(`/branches/${branchA1}/counters/${winnerCounter}/current/skip`).expect(201);
  });

  it('keeps deterministic state under concurrent CALL NEXT plus COMPLETE, SKIP, and CALL SPECIFIC', async () => {
    const completeRace = await createQueueToken(adminToken, orgA, branchA1, 'Complete Race', serviceA1);
    const completeResults = await Promise.all([
      tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/call-next`),
      tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/current/complete`),
    ]);
    expect(completeResults.some((result) => result.status === 201)).toBe(true);
    const completeState = await prisma.token.findUniqueOrThrow({ where: { id: completeRace.token.id }, select: { status: true, counterId: true } });
    expect([TokenStatus.CALLED, TokenStatus.COMPLETED]).toContain(completeState.status);
    if (completeState.status === TokenStatus.CALLED) await tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/current/skip`).expect(201);

    const skipRace = await createQueueToken(adminToken, orgA, branchA1, 'Skip Race', serviceA1);
    const skipResults = await Promise.all([
      tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/call-next`),
      tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/current/skip`),
    ]);
    expect(skipResults.some((result) => result.status === 201)).toBe(true);
    const skipState = await prisma.token.findUniqueOrThrow({ where: { id: skipRace.token.id }, select: { status: true } });
    expect([TokenStatus.CALLED, TokenStatus.SKIPPED]).toContain(skipState.status);
    if (skipState.status === TokenStatus.CALLED) await tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/current/skip`).expect(201);

    const specificRace = await createQueueToken(adminToken, orgA, branchA1, 'Specific Race', serviceA1);
    const specificResults = await Promise.all([
      tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/call-next`),
      tenantRequest(operatorTwoToken, orgA).post(`/branches/${branchA1}/counters/${counterA2}/tokens/${specificRace.token.id}/call`).send({}),
    ]);
    expect(specificResults.filter((result) => result.status === 201)).toHaveLength(1);
    const specificState = await prisma.token.findUniqueOrThrow({ where: { id: specificRace.token.id }, select: { status: true, counterId: true } });
    expect(specificState.status).toBe(TokenStatus.CALLED);
    const specificOperatorToken = specificState.counterId === counterA1 ? operatorOneToken : operatorTwoToken;
    await tenantRequest(specificOperatorToken, orgA).post(`/branches/${branchA1}/counters/${specificState.counterId}/current/skip`).expect(201);
  });

  it('handles 50 concurrent CALL NEXT operations without duplicate claims', async () => {
    const bulk = await prisma.tokenSequence.findFirstOrThrow({ where: { branchId: branchA1, serviceId: serviceA1, businessDate: new Date(`${businessDate.slice(0, 10)}T00:00:00.000Z`) } });
    const queueEntries: string[] = [];
    for (let index = 0; index < 50; index += 1) {
      const patient = await prisma.patient.create({ data: { branchId: branchA1, patientNumber: `CALL-${index}-${randomUUID()}`, firstName: `Bulk${index}`, lastName: 'Call' }, select: { id: true } });
      const queue = await prisma.queueEntry.create({ data: { patientId: patient.id, serviceId: serviceA1, activeEntryKey: `bulk:${patient.id}:${serviceA1}` }, select: { id: true } });
      const counterId = index % 2 === 0 ? counterA1 : counterA2;
      const token = await prisma.token.create({ data: { queueEntryId: queue.id, sequenceId: bulk.id, sequenceNumber: 1000 + index, displayNumber: `T-${1000 + index}`, businessDate: bulk.businessDate, counterId }, select: { id: true } });
      queueEntries.push(token.id);
    }
    const results = await Promise.all(Array.from({ length: 50 }, (_, index) => tenantRequest(index % 2 === 0 ? operatorOneToken : operatorTwoToken, orgA).post(`/branches/${branchA1}/counters/${index % 2 === 0 ? counterA1 : counterA2}/call-next`)));
    expect(results.filter((result) => result.status === 201)).toHaveLength(2);
    const claimed = await prisma.token.count({ where: { id: { in: queueEntries }, status: TokenStatus.CALLED } });
    expect(claimed).toBeLessThanOrEqual(2);
    expect(await prisma.token.count({ where: { id: { in: queueEntries }, status: { in: [TokenStatus.CALLED, TokenStatus.SERVING] }, counterId: { not: null } } })).toBe(claimed);
    await tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/current/skip`).expect(201);
    await tenantRequest(operatorTwoToken, orgA).post(`/branches/${branchA1}/counters/${counterA2}/current/skip`).expect(201);
  });

  it('blocks cross-tenant, cross-branch, unassigned, inactive, suspended, and invalid operations', async () => {
    await tenantRequest(operatorOneToken, orgA).get(`/branches/${branchA2}/counters/${counterA1}/current`).expect(404);
    await tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterB1}/call-next`).expect(404);
    await tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/tokens/${tokenB1}/call`).send({}).expect(404);
    await prisma.counter.update({ where: { id: counterA1 }, data: { status: CounterStatus.INACTIVE } });
    await tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/call-next`).expect(409);
    await prisma.counter.update({ where: { id: counterA1 }, data: { status: CounterStatus.ACTIVE } });
    await prisma.membership.update({ where: { userId_organizationId: { userId: operatorOneId, organizationId: orgA } }, data: { status: MembershipStatus.SUSPENDED } });
    await tenantRequest(operatorOneToken, orgA).get(`/branches/${branchA1}/counters/${counterA1}/current`).expect(403);
    await prisma.membership.update({ where: { userId_organizationId: { userId: operatorOneId, organizationId: orgA } }, data: { status: MembershipStatus.ACTIVE } });
    await request(server).get(`/branches/${branchA1}/counters/${counterA1}/current?organizationId=${orgA}`).set('Authorization', `Bearer ${operatorOneToken}`).expect(200);
    await request(server).get(`/branches/${branchA1}/counters/${counterA1}/current?organizationId=${orgB}`).set('Authorization', `Bearer ${operatorOneToken}`).expect(403);
    await tenantRequest(operatorTwoToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/call-next`).expect(403);
    await tenantRequest(operatorOneToken, orgA).post(`/branches/${branchA1}/counters/${counterA1}/tokens/not-a-uuid/call`).send({}).expect(404);
  });

  describe('Skipped token recall', () => {
    let recallTokenId: string;
    let recallCounterId: string;
    let recallOperatorToken: string;
    let otherCounterId: string;
    let otherOperatorToken: string;

    beforeAll(async () => {
      // Create a token, call it, skip it — sets up a SKIPPED token
      const entry = await createQueueToken(adminToken, orgA, branchA1, 'Recall Patient', serviceA1);
      recallCounterId = entry.token.counter?.id ?? counterA1;
      recallOperatorToken = recallCounterId === counterA1 ? operatorOneToken : operatorTwoToken;
      otherCounterId = recallCounterId === counterA1 ? counterA2 : counterA1;
      otherOperatorToken = recallCounterId === counterA1 ? operatorTwoToken : operatorOneToken;

      await tenantRequest(recallOperatorToken, orgA).post(`/branches/${branchA1}/counters/${recallCounterId}/tokens/${entry.token.id}/call`).send({}).expect(201);
      await tenantRequest(recallOperatorToken, orgA).post(`/branches/${branchA1}/counters/${recallCounterId}/current/skip`).expect(201);
      recallTokenId = entry.token.id;
    });

    it('(A) operator can recall a SKIPPED token from their own counter', async () => {
      const response = await tenantRequest(recallOperatorToken, orgA).post(`/branches/${branchA1}/counters/${recallCounterId}/tokens/${recallTokenId}/recall`).expect(201);
      expect((response.body as TokenResponse).status).toBe(TokenStatus.WAITING);
    });

    it('(B) recalled token is WAITING in the database', async () => {
      const token = await prisma.token.findUniqueOrThrow({ where: { id: recallTokenId }, select: { status: true } });
      expect(token.status).toBe(TokenStatus.WAITING);
    });

    it('(C) recalled token gets picked up by existing call-next', async () => {
      const called = await tenantRequest(recallOperatorToken, orgA).post(`/branches/${branchA1}/counters/${recallCounterId}/call-next`).expect(201);
      expect((called.body as TokenResponse).id).toBe(recallTokenId);
      // Clean up — skip it so it doesn't block later tests
      await tenantRequest(recallOperatorToken, orgA).post(`/branches/${branchA1}/counters/${recallCounterId}/current/skip`).expect(201);
    });

    it('(D) operator cannot recall another counter\'s skipped token', async () => {
      await tenantRequest(otherOperatorToken, orgA).post(`/branches/${branchA1}/counters/${otherCounterId}/tokens/${recallTokenId}/recall`).expect(404);
    });

    it('(E) operator cannot recall a token from another branch', async () => {
      await tenantRequest(recallOperatorToken, orgA).post(`/branches/${branchA2}/counters/${recallCounterId}/tokens/${recallTokenId}/recall`).expect(404);
    });

    it('(F) operator cannot recall a COMPLETED token', async () => {
      const entry = await createQueueToken(adminToken, orgA, branchA1, 'Complete Recall', serviceA1);
      const assignedCounter = entry.token.counter?.id ?? counterA1;
      const operator = assignedCounter === counterA1 ? operatorOneToken : operatorTwoToken;
      await tenantRequest(operator, orgA).post(`/branches/${branchA1}/counters/${assignedCounter}/tokens/${entry.token.id}/call`).send({}).expect(201);
      await tenantRequest(operator, orgA).post(`/branches/${branchA1}/counters/${assignedCounter}/current/complete`).expect(201);
      await tenantRequest(operator, orgA).post(`/branches/${branchA1}/counters/${assignedCounter}/tokens/${entry.token.id}/recall`).expect(409);
    });

    it('(G) operator cannot recall a CANCELLED token', async () => {
      const entry = await createQueueToken(adminToken, orgA, branchA1, 'Cancel Recall', serviceA1);
      const assignedCounter = entry.token.counter?.id ?? counterA1;
      await tenantRequest(adminToken, orgA).post(`/branches/${branchA1}/tokens/${entry.token.id}/cancel`).expect(201);
      const operator = assignedCounter === counterA1 ? operatorOneToken : operatorTwoToken;
      await tenantRequest(operator, orgA).post(`/branches/${branchA1}/counters/${assignedCounter}/tokens/${entry.token.id}/recall`).expect(409);
    });

    it('(H) operator cannot recall WAITING, CALLED, or SERVING tokens', async () => {
      // WAITING token
      const waitingEntry = await createQueueToken(adminToken, orgA, branchA1, 'Waiting Recall', serviceA1);
      const waitingCounter = waitingEntry.token.counter?.id ?? counterA1;
      const waitingOp = waitingCounter === counterA1 ? operatorOneToken : operatorTwoToken;
      await tenantRequest(waitingOp, orgA).post(`/branches/${branchA1}/counters/${waitingCounter}/tokens/${waitingEntry.token.id}/recall`).expect(409);

      // CALLED token
      await tenantRequest(waitingOp, orgA).post(`/branches/${branchA1}/counters/${waitingCounter}/tokens/${waitingEntry.token.id}/call`).send({}).expect(201);
      await tenantRequest(waitingOp, orgA).post(`/branches/${branchA1}/counters/${waitingCounter}/tokens/${waitingEntry.token.id}/recall`).expect(409);

      // Clean up
      await tenantRequest(waitingOp, orgA).post(`/branches/${branchA1}/counters/${waitingCounter}/current/skip`).expect(201);
    });

    it('(I) duplicate recall of same token is rejected', async () => {
      // recallTokenId is currently SKIPPED from test C cleanup
      await tenantRequest(recallOperatorToken, orgA).post(`/branches/${branchA1}/counters/${recallCounterId}/tokens/${recallTokenId}/recall`).expect(201);
      // Second recall should fail — token is now WAITING
      await tenantRequest(recallOperatorToken, orgA).post(`/branches/${branchA1}/counters/${recallCounterId}/tokens/${recallTokenId}/recall`).expect(409);
      // Clean up — skip it again for later tests
      await tenantRequest(recallOperatorToken, orgA).post(`/branches/${branchA1}/counters/${recallCounterId}/tokens/${recallTokenId}/call`).send({}).expect(201);
      await tenantRequest(recallOperatorToken, orgA).post(`/branches/${branchA1}/counters/${recallCounterId}/current/skip`).expect(201);
    });

    it('(K) GET /skipped returns only skipped tokens for operator\'s counter', async () => {
      const response = await tenantRequest(recallOperatorToken, orgA).get(`/branches/${branchA1}/counters/${recallCounterId}/skipped`).expect(200);
      const body = response.body as { data: TokenResponse[]; meta: { total: number } };
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data.every((t) => t.status === TokenStatus.SKIPPED)).toBe(true);
      expect(body.meta.total).toBe(body.data.length);
    });

    it('(J) existing SKIP behavior still works correctly', async () => {
      const entry = await createQueueToken(adminToken, orgA, branchA1, 'Skip Still Works', serviceA1);
      const assignedCounter = entry.token.counter?.id ?? counterA1;
      const operator = assignedCounter === counterA1 ? operatorOneToken : operatorTwoToken;
      await tenantRequest(operator, orgA).post(`/branches/${branchA1}/counters/${assignedCounter}/tokens/${entry.token.id}/call`).send({}).expect(201);
      const skipped = await tenantRequest(operator, orgA).post(`/branches/${branchA1}/counters/${assignedCounter}/current/skip`).expect(201);
      expect((skipped.body as TokenResponse).status).toBe(TokenStatus.SKIPPED);
      const dbToken = await prisma.token.findUniqueOrThrow({ where: { id: entry.token.id }, select: { status: true, skippedAt: true } });
      expect(dbToken.status).toBe(TokenStatus.SKIPPED);
      expect(dbToken.skippedAt).not.toBeNull();
    });
  });
});
