import { clearDatabase } from './test-utils';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { Server } from 'http';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Performance & Concurrency (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let tokenAdmin: string;
  let orgId: string;
  let branchId: string;
  let serviceId: string;
  let counterId: string;
  const patientIds: string[] = [];

  function tenantRequest(accessToken: string) {
    const withTenant = (test: request.Test) => test.set('Authorization', `Bearer ${accessToken}`).set('x-organization-id', orgId);
    return {
      get: (path: string) => withTenant(request(server).get(path)),
      post: (path: string) => withTenant(request(server).post(path)),
    };
  }

  async function register(email: string) {
    const response = await request(server).post('/auth/register').send({ email, password: 'password123', displayName: email }).expect(201);
    return (response.body as { accessToken: string }).accessToken;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<PrismaService>(PrismaService);

    tokenAdmin = await register(`perf-admin-${randomUUID()}@example.com`);
    const userAdmin = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'desc' }, include: { memberships: true } });
    orgId = userAdmin.memberships[0]!.organizationId;

    branchId = ((await tenantRequest(tokenAdmin).post('/organizations/current/branches').send({ name: `Perf Branch ${randomUUID()}`, code: 'PERF1' }).expect(201)).body as { id: string }).id;
    
    // Create service
    const departmentId = ((await tenantRequest(tokenAdmin).post(`/branches/${branchId}/departments`).send({ name: 'Perf Dept' }).expect(201)).body as { id: string }).id;
    serviceId = ((await tenantRequest(tokenAdmin).post(`/departments/${departmentId}/services`).send({ name: 'Perf Service' }).expect(201)).body as { id: string }).id;

    // Create counter
    counterId = ((await tenantRequest(tokenAdmin).post(`/branches/${branchId}/counters`).send({ name: 'Perf Counter', code: 'C-PERF' }).expect(201)).body as { id: string }).id;

    // Create patients
    for (let i = 0; i < 20; i++) {
      const patient = await tenantRequest(tokenAdmin).post(`/branches/${branchId}/patients`).send({ firstName: `Patient${i}`, lastName: 'Perf', email: `${randomUUID()}@example.com` }).expect(201);
      patientIds.push((patient.body as { id: string }).id);
    }
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  it('A. Queue entry concurrency - prevents duplicate active entries', async () => {
    const patientId = patientIds[0]!;
    // Send 10 concurrent requests to create a queue entry for the same patient and service
    const responses = await Promise.all(Array.from({ length: 10 }).map(() =>
      tenantRequest(tokenAdmin).post(`/branches/${branchId}/queue-entries`).send({ patientId, serviceId })
    ));
    
    // Exactly one should succeed (201), the rest should fail (409)
    const successCount = responses.filter(r => r.status === 201).length;
    const conflictCount = responses.filter(r => r.status === 409).length;
    
    expect(successCount).toBe(1);
    expect(conflictCount).toBe(9);
  });

  it('B. Token concurrency - generates unique sequence numbers safely', async () => {
    // Create 10 queue entries first
    const entryIds: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const res = await tenantRequest(tokenAdmin).post(`/branches/${branchId}/queue-entries`).send({ patientId: patientIds[i]!, serviceId }).expect(201);
      entryIds.push((res.body as { id: string }).id);
    }

    // Concurrently generate tokens for all 10 entries
    const responses = await Promise.all(entryIds.map(queueEntryId =>
      tenantRequest(tokenAdmin).post(`/branches/${branchId}/queue-entries/${queueEntryId}/token`).send({})
    ));

    expect(responses.every(r => r.status === 201)).toBe(true);

    const sequenceNumbers = responses.map(r => (r.body as { sequenceNumber: number }).sequenceNumber).sort((a, b) => a - b);
    const uniqueNumbers = new Set(sequenceNumbers);
    expect(uniqueNumbers.size).toBe(10); // All unique
  });

  it('C. Queue calling concurrency - concurrent CALL NEXT on same counter', async () => {
    // Send 5 concurrent call-next requests to the same counter
    const responses = await Promise.all(Array.from({ length: 5 }).map(() =>
      tenantRequest(tokenAdmin).post(`/branches/${branchId}/counters/${counterId}/call-next`).send({})
    ));

    // One should return 201 (or 200), others should either return the SAME token idempotently or fail
    // The implementation might return 201 for the first, and 400/409 for the rest, or just 201 for the first.
    const successCount = responses.filter(r => r.status === 201).length;
    expect(successCount).toBeGreaterThan(0);
    expect(successCount).toBeLessThanOrEqual(5);

    // Verify exactly 1 token is in CALLED state at this counter
    const calledTokens = await prisma.token.count({
      where: { counterId, status: 'CALLED' }
    });
    expect(calledTokens).toBe(1);
  });
});
