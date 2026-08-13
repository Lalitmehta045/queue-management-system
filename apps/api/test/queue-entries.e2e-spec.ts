import { clearDatabase } from './test-utils';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MembershipStatus, PatientStatus, QueueEntryStatus, Role, ServiceStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { Server } from 'http';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type QueueEntryResponse = { id: string; patientId: string; serviceId: string; status: QueueEntryStatus; patient: { patientNumber: string; firstName: string; lastName: string }; service: { id: string; name: string; department: { id: string; name: string } }; };

describe('Queue entries (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
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
  let branchAdminId: string;
  let queueEntryA1: string;
  let queueEntryB1: string;

  function tenantRequest(token: string, organizationId: string) {
    const withTenant = (test: request.Test) => test.set('Authorization', `Bearer ${token}`).set('x-organization-id', organizationId);
    return {
      get: (path: string) => withTenant(request(server).get(path)),
      post: (path: string) => withTenant(request(server).post(path)),
    };
  }

  async function register(email: string) {
    const response = await request(server).post('/auth/register').send({ email, password: 'password123', displayName: email }).expect(201);
    return (response.body as { accessToken: string }).accessToken;
  }

  async function createPatient(token: string, organizationId: string, branchId: string, firstName: string) {
    const response = await tenantRequest(token, organizationId).post(`/branches/${branchId}/patients`).send({ firstName, lastName: 'Queue', phone: `555${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}` }).expect(201);
    return (response.body as { id: string }).id;
  }

  async function createService(token: string, organizationId: string, branchId: string, name: string) {
    const departmentResponse = await tenantRequest(token, organizationId).post(`/branches/${branchId}/departments`).send({ name: `${name} Department` }).expect(201);
    const departmentId = (departmentResponse.body as { id: string }).id;
    const serviceResponse = await tenantRequest(token, organizationId).post(`/departments/${departmentId}/services`).send({ name }).expect(201);
    return (serviceResponse.body as { id: string }).id;
  }

  async function createEntry(token: string, organizationId: string, branchId: string, patientId: string, serviceId: string) {
    const response = await tenantRequest(token, organizationId).post(`/branches/${branchId}/queue-entries`).send({ patientId, serviceId }).expect(201);
    return (response.body as QueueEntryResponse).id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<PrismaService>(PrismaService);

    tokenA = await register('phase3b-a@example.com');
    tokenB = await register('phase3b-b@example.com');
    tokenBranchAdmin = await register('phase3b-branch-admin@example.com');
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: 'phase3b-a@example.com' }, include: { memberships: true } });
    const userB = await prisma.user.findUniqueOrThrow({ where: { email: 'phase3b-b@example.com' }, include: { memberships: true } });
    const branchAdmin = await prisma.user.findUniqueOrThrow({ where: { email: 'phase3b-branch-admin@example.com' } });
    orgA = userA.memberships[0]!.organizationId;
    orgB = userB.memberships[0]!.organizationId;

    branchA1 = ((await tenantRequest(tokenA, orgA).post('/organizations/current/branches').send({ name: 'Phase 3B A1', code: 'P3BA1' }).expect(201)).body as { id: string }).id;
    branchA2 = ((await tenantRequest(tokenA, orgA).post('/organizations/current/branches').send({ name: 'Phase 3B A2', code: 'P3BA2' }).expect(201)).body as { id: string }).id;
    branchB1 = ((await tenantRequest(tokenB, orgB).post('/organizations/current/branches').send({ name: 'Phase 3B B1', code: 'P3BB1' }).expect(201)).body as { id: string }).id;
    await prisma.membership.create({ data: { userId: branchAdmin.id, organizationId: orgA, branchId: branchA1, role: Role.BRANCH_ADMIN, status: MembershipStatus.ACTIVE } });
    branchAdminId = branchAdmin.id;
    const userB_id = (await prisma.user.findUniqueOrThrow({ where: { email: 'phase3b-b@example.com' } })).id;
    await prisma.membership.create({ data: { userId: userB_id, organizationId: orgA, branchId: branchA1, role: Role.COUNTER_OPERATOR, status: MembershipStatus.ACTIVE } });


    patientA1 = await createPatient(tokenA, orgA, branchA1, 'Patient A1');
    patientA2 = await createPatient(tokenA, orgA, branchA2, 'Patient A2');
    patientB1 = await createPatient(tokenB, orgB, branchB1, 'Patient B1');
    serviceA1 = await createService(tokenA, orgA, branchA1, 'Service A1');
    serviceA2 = await createService(tokenA, orgA, branchA2, 'Service A2');
    serviceB1 = await createService(tokenB, orgB, branchB1, 'Service B1');
    queueEntryA1 = await createEntry(tokenA, orgA, branchA1, patientA1, serviceA1);
    queueEntryB1 = await createEntry(tokenB, orgB, branchB1, patientB1, serviceB1);
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  it('creates, lists, gets, filters, paginates, and cancels entries', async () => {
    const list = await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/queue-entries`).query({ page: 1, limit: 20, status: 'WAITING', serviceId: serviceA1, patientId: patientA1, sortBy: 'createdAt', sortOrder: 'asc' }).expect(200);
    const body = list.body as { data: QueueEntryResponse[]; meta: { page: number; limit: number; total: number } };
    expect(body.data[0]!.id).toBe(queueEntryA1);
    expect(body.data[0]!.patient).toEqual(expect.objectContaining({ firstName: 'Patient A1' }));
    expect((body.data[0] as QueueEntryResponse & { patient: { phone?: string }; service: { department: { passwordHash?: string } } }).patient.phone).toBeUndefined();
    expect((body.data[0] as QueueEntryResponse & { service: { department: { passwordHash?: string } } }).service.department.passwordHash).toBeUndefined();
    expect(body.meta).toMatchObject({ page: 1, limit: 20, total: 1 });
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/queue-entries/${queueEntryA1}`).expect(200);
    await tenantRequest(tokenB, orgA).get(`/branches/${branchA1}/queue-entries/${queueEntryA1}`).expect(200);

    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/queue-entries`).query({ search: 'Patient A1' }).expect(200);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/queue-entries`).query({ page: -1 }).expect(400);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/queue-entries`).query({ limit: 101 }).expect(400);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/queue-entries`).query({ sortBy: 'patientId' }).expect(400);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/queue-entries`).query({ search: 'x'.repeat(101) }).expect(400);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries/${queueEntryA1}/cancel`).expect(201);
    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: queueEntryA1 } })).status).toBe(QueueEntryStatus.CANCELLED);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries/${queueEntryA1}/cancel`).expect(409);
  });

  it('accepts same-branch entries and rejects cross-branch, cross-tenant, and forged ownership', async () => {
    const recreated = await createEntry(tokenA, orgA, branchA1, patientA1, serviceA1);
    expect(recreated).toBeDefined();
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries`).send({ patientId: patientA1, serviceId: serviceA2 }).expect(404);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries`).send({ patientId: patientA2, serviceId: serviceA1 }).expect(404);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries`).send({ patientId: patientA1, serviceId: serviceB1 }).expect(404);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries`).send({ patientId: patientA1, serviceId: serviceA1, branchId: branchA2, organizationId: orgB, departmentId: 'forged' }).expect(400);
  });

  it('blocks inactive patients and services and prevents duplicate waiting entries', async () => {
    await prisma.patient.update({ where: { id: patientA1 }, data: { status: PatientStatus.INACTIVE } });
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries`).send({ patientId: patientA1, serviceId: serviceA1 }).expect(404);
    await prisma.patient.update({ where: { id: patientA1 }, data: { status: PatientStatus.ACTIVE } });
    await prisma.service.update({ where: { id: serviceA1 }, data: { status: ServiceStatus.INACTIVE } });
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries`).send({ patientId: patientA1, serviceId: serviceA1 }).expect(404);
    await prisma.service.update({ where: { id: serviceA1 }, data: { status: ServiceStatus.ACTIVE } });
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries`).send({ patientId: patientA1, serviceId: serviceA1 }).expect(409);
  });

  it('enforces tenant, branch-admin, suspended-membership, role, and IDOR security', async () => {
    await tenantRequest(tokenA, orgA).get(`/branches/${branchB1}/queue-entries`).expect(404);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/queue-entries/${queueEntryB1}`).expect(404);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries/${queueEntryB1}/cancel`).expect(404);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA2}/queue-entries/${queueEntryA1}`).expect(404);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA2}/queue-entries/${queueEntryA1}/cancel`).expect(404);
    await tenantRequest(tokenBranchAdmin, orgA).get(`/branches/${branchA2}/queue-entries`).expect(403);
    await prisma.membership.update({ where: { userId_organizationId: { userId: branchAdminId, organizationId: orgA } }, data: { status: MembershipStatus.SUSPENDED } });
    await tenantRequest(tokenBranchAdmin, orgA).get(`/branches/${branchA1}/queue-entries`).expect(403);
    await tenantRequest(tokenBranchAdmin, orgA).post(`/branches/${branchA1}/queue-entries`).send({ patientId: patientA1, serviceId: serviceA1 }).expect(403);
    await prisma.membership.update({ where: { userId_organizationId: { userId: branchAdminId, organizationId: orgA } }, data: { status: MembershipStatus.ACTIVE } });
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: 'phase3b-a@example.com' } });
    await prisma.membership.update({ where: { userId_organizationId: { userId: userA.id, organizationId: orgA } }, data: { role: Role.DOCTOR } });
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/queue-entries`).expect(403);
    await prisma.membership.update({ where: { userId_organizationId: { userId: userA.id, organizationId: orgA } }, data: { role: Role.ORG_ADMIN } });
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/queue-entries/not-a-uuid`).expect(404);
  });

  it('allows exactly one waiting entry under concurrent creation', async () => {
    const concurrentPatient = await createPatient(tokenA, orgA, branchA1, 'Concurrent');
    const results = await Promise.all([
      tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries`).send({ patientId: concurrentPatient, serviceId: serviceA1 }),
      tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/queue-entries`).send({ patientId: concurrentPatient, serviceId: serviceA1 }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await prisma.queueEntry.count({ where: { patientId: concurrentPatient, serviceId: serviceA1, status: QueueEntryStatus.WAITING } })).toBe(1);
  });

  it('supports anonymous / walk-in tokens (customer is optional)', async () => {
    // 1. Generate token without customer
    const createRes = await tenantRequest(tokenA, orgA)
      .post(`/branches/${branchA1}/queue-entries`)
      .send({ serviceId: serviceA1 });
    expect(createRes.status).toBe(201);
    
    const queueEntry = createRes.body as QueueEntryResponse;
    expect(queueEntry.patientId).toBeNull();
    
    // 2. Create token for the entry
    const tokenRes = await tenantRequest(tokenA, orgA)
      .post(`/branches/${branchA1}/queue-entries/${queueEntry.id}/token`)
      .send({});
    expect(tokenRes.status).toBe(201);
    const token = tokenRes.body as { status: string };
    expect(token.status).toBe('WAITING');
    
    // Counter allocation should assign it to the least loaded counter if one is active.
    // In e2e test, we may not have an active counter, so it stays unassigned or assigned based on setup.
    // If it gets a counterId, it proves allocation didn't break for anonymous tokens.
  });
});
