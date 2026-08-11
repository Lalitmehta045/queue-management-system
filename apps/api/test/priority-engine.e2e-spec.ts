import { clearDatabase } from './test-utils';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MembershipStatus, Role, TokenStatus, PriorityLevel } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { Server } from 'http';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type TokenResponse = { id: string; displayNumber: string; sequenceNumber: number; status: TokenStatus };

describe('Priority Engine (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken: string;
  let operatorToken: string;
  let orgId: string;
  let branchId: string;
  let departmentId: string;
  let serviceId: string;
  let counterId: string;
  let operatorId: string;

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

  async function createPatient(name: string) {
    const response = await tenantRequest(adminToken, orgId).post(`/branches/${branchId}/patients`).send({ firstName: name, lastName: 'Test', email: `${randomUUID()}@example.com` }).expect(201);
    return (response.body as { id: string }).id;
  }

  async function createQueueToken(patientName: string, priority: PriorityLevel = PriorityLevel.NORMAL, dateOffsetMs = 0) {
    const patientId = await createPatient(patientName);
    const queue = await tenantRequest(adminToken, orgId).post(`/branches/${branchId}/queue-entries`).send({ patientId, serviceId, priority }).expect(201);
    const queueEntryId = (queue.body as { id: string }).id;
    const token = await tenantRequest(adminToken, orgId).post(`/branches/${branchId}/queue-entries/${queueEntryId}/token`).send({}).expect(201);
    
    if (dateOffsetMs !== 0) {
      const tokenId = (token.body as { id: string }).id;
      await prisma.queueEntry.update({ where: { id: queueEntryId }, data: { createdAt: new Date(Date.now() + dateOffsetMs) } });
      await prisma.token.update({ where: { id: tokenId }, data: { createdAt: new Date(Date.now() + dateOffsetMs), issuedAt: new Date(Date.now() + dateOffsetMs) } });
    }
    
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

    adminToken = await register('priority-admin@example.com');
    operatorToken = await register('priority-op@example.com');
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'priority-admin@example.com' }, include: { memberships: true } });
    const operator = await prisma.user.findUniqueOrThrow({ where: { email: 'priority-op@example.com' } });
    operatorId = operator.id;
    orgId = admin.memberships[0]!.organizationId;

    branchId = ((await tenantRequest(adminToken, orgId).post('/organizations/current/branches').send({ name: 'Priority Branch', code: 'PRB1' }).expect(201)).body as { id: string }).id;
    
    const deptRes = await tenantRequest(adminToken, orgId).post(`/branches/${branchId}/departments`).send({ name: 'Priority Dept' }).expect(201);
    departmentId = (deptRes.body as { id: string }).id;
    
    const svcRes = await tenantRequest(adminToken, orgId).post(`/departments/${departmentId}/services`).send({ name: 'Priority Service' }).expect(201);
    serviceId = (svcRes.body as { id: string }).id;

    counterId = ((await tenantRequest(adminToken, orgId).post(`/branches/${branchId}/counters`).send({ name: 'Priority Counter', code: 'PRC1' }).expect(201)).body as { id: string }).id;
    
    await prisma.membership.create({ data: { userId: operatorId, organizationId: orgId, branchId: branchId, role: Role.COUNTER_OPERATOR, status: MembershipStatus.ACTIVE } });
    await tenantRequest(adminToken, orgId).post(`/branches/${branchId}/counters/${counterId}/operators`).send({ userId: operatorId }).expect(201);
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  afterEach(async () => {
    // skip any currently serving tokens so we can call next again
    try {
      await tenantRequest(operatorToken, orgId).post(`/branches/${branchId}/counters/${counterId}/current/skip`);
    } catch {
      // ignore
    }
  });

  it('configures priority levels successfully', async () => {
    // Test priority configurations CRUD
    await tenantRequest(adminToken, orgId).post('/priority-configurations').send({ level: PriorityLevel.EMERGENCY, weight: 100, active: true }).expect(201);
    await tenantRequest(adminToken, orgId).post('/priority-configurations').send({ departmentId, level: PriorityLevel.VIP, weight: 80, active: true }).expect(201);
    await tenantRequest(adminToken, orgId).post('/priority-configurations').send({ departmentId, level: PriorityLevel.SENIOR_CITIZEN, weight: 50, active: true }).expect(201);
    await tenantRequest(adminToken, orgId).post('/priority-configurations').send({ departmentId, level: PriorityLevel.APPOINTMENT, weight: 30, active: true }).expect(201);
    await tenantRequest(adminToken, orgId).post('/priority-configurations').send({ departmentId, level: PriorityLevel.NORMAL, weight: 10, active: true }).expect(201);

    const res = await tenantRequest(adminToken, orgId).get('/priority-configurations').expect(200);
    expect((res.body as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(1);
    
    const deptRes = await tenantRequest(adminToken, orgId).get(`/priority-configurations?departmentId=${departmentId}`).expect(200);
    expect((deptRes.body as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(4);
  });

  it('prioritizes EMERGENCY over NORMAL', async () => {
    const normal = await createQueueToken('Normal 1', PriorityLevel.NORMAL);
    const emergency = await createQueueToken('Emergency 1', PriorityLevel.EMERGENCY);

    const called = await tenantRequest(operatorToken, orgId).post(`/branches/${branchId}/counters/${counterId}/call-next`).expect(201);
    expect((called.body as TokenResponse).id).toBe(emergency.token.id);

    await tenantRequest(operatorToken, orgId).post(`/branches/${branchId}/counters/${counterId}/current/skip`).expect(201);

    const called2 = await tenantRequest(operatorToken, orgId).post(`/branches/${branchId}/counters/${counterId}/call-next`).expect(201);
    expect((called2.body as TokenResponse).id).toBe(normal.token.id);
  });

  it('handles starvation (wait > 60m) by placing older NORMAL before newer VIP', async () => {
    // Normal wait > 60 mins
    const starvedNormal = await createQueueToken('Starved Normal', PriorityLevel.NORMAL, -61 * 60 * 1000); 
    // VIP wait 5 mins
    const newVip = await createQueueToken('New VIP', PriorityLevel.VIP, -5 * 60 * 1000);

    const called = await tenantRequest(operatorToken, orgId).post(`/branches/${branchId}/counters/${counterId}/call-next`).expect(201);
    
    // The starved normal should win
    expect((called.body as TokenResponse).id).toBe(starvedNormal.token.id);
    await tenantRequest(operatorToken, orgId).post(`/branches/${branchId}/counters/${counterId}/current/skip`).expect(201);

    const called2 = await tenantRequest(operatorToken, orgId).post(`/branches/${branchId}/counters/${counterId}/call-next`).expect(201);
    expect((called2.body as TokenResponse).id).toBe(newVip.token.id);
  });
  
  it('protects priority configuration against unauthorized roles', async () => {
    // Receptionist/Counter Operator should not be able to update priority config
    await tenantRequest(operatorToken, orgId).post('/priority-configurations').send({ level: PriorityLevel.VIP, weight: 100, active: true }).expect(403);
  });
});
