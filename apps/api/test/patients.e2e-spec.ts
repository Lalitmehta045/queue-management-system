import { clearDatabase } from './test-utils';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MembershipStatus, PatientStatus, Role } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { Server } from 'http';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type PatientResponse = { id: string; branchId: string; patientNumber: string; firstName: string; lastName: string; phone: string | null; email: string | null; status: PatientStatus; passwordHash?: string; tokenHash?: string };

describe('Patients (e2e)', () => {
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
  let branchAdminId: string;

  function tenantRequest(token: string, organizationId: string) {
    const withTenant = (test: request.Test) => test.set('Authorization', `Bearer ${token}`).set('x-organization-id', organizationId);
    return {
      get: (path: string) => withTenant(request(server).get(path)),
      post: (path: string) => withTenant(request(server).post(path)),
      patch: (path: string) => withTenant(request(server).patch(path)),
    };
  }

  async function register(email: string) {
    const response = await request(server).post('/auth/register').send({ email, password: 'password123', displayName: email }).expect(201);
    return (response.body as { accessToken: string }).accessToken;
  }

  async function createPatient(token: string, branchId: string, data: Record<string, string>) {
    const response = await tenantRequest(token, orgA).post(`/branches/${branchId}/patients`).send(data).expect(201);
    return (response.body as PatientResponse).id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<PrismaService>(PrismaService);

    tokenA = await register('phase3a-a@example.com');
    tokenB = await register('phase3a-b@example.com');
    tokenBranchAdmin = await register('phase3a-branch-admin@example.com');
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: 'phase3a-a@example.com' }, include: { memberships: true } });
    const userB = await prisma.user.findUniqueOrThrow({ where: { email: 'phase3a-b@example.com' }, include: { memberships: true } });
    const branchAdmin = await prisma.user.findUniqueOrThrow({ where: { email: 'phase3a-branch-admin@example.com' }, include: { memberships: true } });
    orgA = userA.memberships[0]!.organizationId;
    orgB = userB.memberships[0]!.organizationId;
    const branchAdminOrg = branchAdmin.memberships[0]!.organizationId;
    const branchA1Response = await tenantRequest(tokenA, orgA).post('/organizations/current/branches').send({ name: 'Phase 3A A1', code: 'P3AA1' }).expect(201);
    branchA1 = (branchA1Response.body as { id: string }).id;
    const branchA2Response = await tenantRequest(tokenA, orgA).post('/organizations/current/branches').send({ name: 'Phase 3A A2', code: 'P3AA2' }).expect(201);
    branchA2 = (branchA2Response.body as { id: string }).id;
    const branchBResponse = await tenantRequest(tokenB, orgB).post('/organizations/current/branches').send({ name: 'Phase 3A B1', code: 'P3AB1' }).expect(201);
    branchB1 = (branchBResponse.body as { id: string }).id;
    await prisma.membership.create({ data: { userId: branchAdmin.id, organizationId: orgA, branchId: branchA1, role: Role.BRANCH_ADMIN, status: MembershipStatus.ACTIVE } });
    branchAdminId = branchAdmin.id;
    void branchAdminOrg;

    patientA1 = await createPatient(tokenA, branchA1, { firstName: 'Rahul', lastName: 'Sharma', phone: '+91 98765-43210', email: 'RAHUL@example.com' });
    patientA2 = await createPatient(tokenA, branchA2, { firstName: 'Maya', lastName: 'Patel', phone: '555 222 1111' });
    const patientBResponse = await tenantRequest(tokenB, orgB).post(`/branches/${branchB1}/patients`).send({ firstName: 'Other', lastName: 'Tenant', phone: '5553334444' }).expect(201);
    patientB1 = (patientBResponse.body as PatientResponse).id;
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  it('creates, lists, gets, searches, updates, and paginates branch patients', async () => {
    const created = await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/patients`).query({ search: 'rahul', page: 1, limit: 20 }).expect(200);
    const body = created.body as { data: PatientResponse[]; meta: { page: number; limit: number; total: number } };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.phone).toBe('919876543210');
    expect(body.data[0]!.email).toBe('rahul@example.com');
    expect(body.meta).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(body.data[0]!.passwordHash).toBeUndefined();
    expect(body.data[0]!.tokenHash).toBeUndefined();

    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/patients/${patientA1}`).expect(200);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/patients`).query({ search: '919876543210' }).expect(200);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/patients`).query({ search: 'not-found' }).expect(200);
    await tenantRequest(tokenA, orgA).patch(`/branches/${branchA1}/patients/${patientA1}`).send({ firstName: 'Rahul Updated', patientNumber: 'forged' }).expect(400);
    await tenantRequest(tokenA, orgA).patch(`/branches/${branchA1}/patients/${patientA1}`).send({ firstName: 'Rahul Updated' }).expect(200);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/patients`).query({ page: 1, limit: 1 }).expect(200);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/patients`).query({ page: -1 }).expect(400);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/patients`).query({ limit: 101 }).expect(400);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/patients`).query({ search: 'x'.repeat(101) }).expect(400);
  });

  it('enforces lifecycle operations and database identifier uniqueness', async () => {
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/patients/${patientA1}/deactivate`).expect(201);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patientA1 } })).status).toBe(PatientStatus.INACTIVE);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/patients/${patientA1}/activate`).expect(201);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patientA1 } })).status).toBe(PatientStatus.ACTIVE);
    const patient = await prisma.patient.findUniqueOrThrow({ where: { id: patientA1 } });
    await expect(prisma.patient.create({ data: { branchId: branchA1, patientNumber: patient.patientNumber, firstName: 'Duplicate', lastName: 'Number' } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('blocks cross-tenant, cross-branch, forged ownership, suspended, and unauthorized access', async () => {
    await tenantRequest(tokenA, orgA).get(`/branches/${branchB1}/patients`).expect(404);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/patients/${patientB1}`).expect(404);
    await tenantRequest(tokenA, orgA).patch(`/branches/${branchA1}/patients/${patientB1}`).send({ firstName: 'Stolen' }).expect(404);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/patients/${patientB1}/deactivate`).expect(404);
    await tenantRequest(tokenA, orgA).patch(`/branches/${branchA2}/patients/${patientA1}`).send({ firstName: 'Stolen' }).expect(404);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA2}/patients/${patientA1}/deactivate`).expect(404);
    await tenantRequest(tokenBranchAdmin, orgA).get(`/branches/${branchA2}/patients`).query({ search: 'Maya' }).expect(403);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/patients`).send({ firstName: 'Forged', lastName: 'Owner', branchId: branchB1 }).expect(400);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/patients`).send({ firstName: 'Forged', lastName: 'Owner', organizationId: orgB }).expect(400);

    await prisma.membership.update({ where: { userId_organizationId: { userId: branchAdminId, organizationId: orgA } }, data: { status: MembershipStatus.SUSPENDED } });
    await tenantRequest(tokenBranchAdmin, orgA).post(`/branches/${branchA1}/patients`).send({ firstName: 'Suspended', lastName: 'User' }).expect(403);
    await tenantRequest(tokenBranchAdmin, orgA).patch(`/branches/${branchA1}/patients/${patientA1}`).send({ firstName: 'Suspended' }).expect(403);
    await tenantRequest(tokenBranchAdmin, orgA).post(`/branches/${branchA1}/patients/${patientA1}/deactivate`).expect(403);
    await prisma.membership.update({ where: { userId_organizationId: { userId: branchAdminId, organizationId: orgA } }, data: { status: MembershipStatus.ACTIVE } });
    await tenantRequest(tokenBranchAdmin, orgA).get(`/branches/${branchA2}/patients`).expect(403);
    await tenantRequest(tokenBranchAdmin, orgA).get(`/branches/${branchA1}/patients/${patientA1}`).expect(200);

    const userA = await prisma.user.findUniqueOrThrow({ where: { email: 'phase3a-a@example.com' } });
    await prisma.membership.update({ where: { userId_organizationId: { userId: userA.id, organizationId: orgA } }, data: { role: Role.DOCTOR } });
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/patients`).expect(403);
    await prisma.membership.update({ where: { userId_organizationId: { userId: userA.id, organizationId: orgA } }, data: { role: Role.ORG_ADMIN } });
  });

  it('handles invalid patient identifiers without leaking data', async () => {
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/patients/not-a-uuid`).expect(404);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/patients/${patientA2}`).expect(404);
  });
});
