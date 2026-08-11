import { clearDatabase } from './test-utils';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MembershipStatus, Role } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { Server } from 'http';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Counters and operators (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let tokenA: string;
  let tokenB: string;
  let orgA: string;
  let orgB: string;
  let branchA1: string;
  let branchA2: string;
  let branchB: string;
  let counterA1: string;
  let counterA2: string;
  let counterB: string;
  let operatorA: string;

  function tenantRequest(token: string, organizationId: string) {
    const withTenant = (test: request.Test) => test.set('Authorization', `Bearer ${token}`).set('x-organization-id', organizationId);
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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<PrismaService>(PrismaService);

    tokenA = await register('phase2c-a@example.com');
    tokenB = await register('phase2c-b@example.com');
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: 'phase2c-a@example.com' }, include: { memberships: true } });
    const userB = await prisma.user.findUniqueOrThrow({ where: { email: 'phase2c-b@example.com' }, include: { memberships: true } });
    orgA = userA.memberships[0]!.organizationId;
    orgB = userB.memberships[0]!.organizationId;
    const branchA1Response = await tenantRequest(tokenA, orgA).post('/organizations/current/branches').send({ name: 'Phase 2C A1', code: 'P2CA1' }).expect(201);
    branchA1 = (branchA1Response.body as { id: string }).id;
    const branchA2Response = await tenantRequest(tokenA, orgA).post('/organizations/current/branches').send({ name: 'Phase 2C A2', code: 'P2CA2' }).expect(201);
    branchA2 = (branchA2Response.body as { id: string }).id;
    const branchBResponse = await tenantRequest(tokenB, orgB).post('/organizations/current/branches').send({ name: 'Phase 2C B1', code: 'P2CB1' }).expect(201);
    branchB = (branchBResponse.body as { id: string }).id;
    const counterA1Response = await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/counters`).send({ name: 'Registration', code: 'REG-01' }).expect(201);
    counterA1 = (counterA1Response.body as { id: string }).id;
    const counterA2Response = await tenantRequest(tokenA, orgA).post(`/branches/${branchA2}/counters`).send({ name: 'Records', code: 'REC-01' }).expect(201);
    counterA2 = (counterA2Response.body as { id: string }).id;
    const counterBResponse = await tenantRequest(tokenB, orgB).post(`/branches/${branchB}/counters`).send({ name: 'Billing', code: 'BIL-01' }).expect(201);
    counterB = (counterBResponse.body as { id: string }).id;
    const operatorToken = await register('phase2c-operator@example.com');
    const operator = await prisma.user.findUniqueOrThrow({ where: { email: 'phase2c-operator@example.com' }, include: { memberships: true } });
    operatorA = operator.id;
    await prisma.membership.create({ data: { userId: operator.id, organizationId: orgA, branchId: branchA1, role: Role.COUNTER_OPERATOR, status: MembershipStatus.ACTIVE } });
    void operatorToken;
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  it('supports counter lifecycle, pagination, and branch-unique codes', async () => {
    const list = await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/counters`).query({ page: 1, limit: 20 }).expect(200);
    const listBody = list.body as { data: unknown[]; meta: { limit: number } };
    expect(listBody.data).toHaveLength(1);
    expect(listBody.meta.limit).toBe(20);
    await tenantRequest(tokenA, orgA).patch(`/branches/${branchA1}/counters/${counterA1}`).send({ name: 'Updated Registration' }).expect(200);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/counters/${counterA1}/deactivate`).expect(201);
    expect((await prisma.counter.findUniqueOrThrow({ where: { id: counterA1 } })).status).toBe('INACTIVE');
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/counters/${counterA1}/activate`).expect(201);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/counters`).send({ name: 'Duplicate', code: 'REG-01' }).expect(409);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/counters`).query({ page: -1 }).expect(400);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/counters`).query({ limit: 101 }).expect(400);
  });

  it('blocks cross-tenant and cross-branch counter IDOR', async () => {
    await tenantRequest(tokenA, orgA).get(`/branches/${branchB}/counters`).expect(404);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/counters/${counterB}`).expect(404);
    await tenantRequest(tokenA, orgA).patch(`/branches/${branchA2}/counters/${counterA1}`).send({ name: 'forged' }).expect(404);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA2}/counters/${counterA1}/deactivate`).expect(404);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/counters`).send({ name: 'Forged', code: 'F-01', organizationId: orgB, branchId: branchB }).expect(400);

    const userA = await prisma.user.findUniqueOrThrow({ where: { email: 'phase2c-a@example.com' } });
    await prisma.membership.update({ where: { userId_organizationId: { userId: userA.id, organizationId: orgA } }, data: { role: Role.BRANCH_ADMIN, branchId: branchA1 } });
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA2}/counters`).expect(403);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/counters`).expect(200);
    await prisma.membership.update({ where: { userId_organizationId: { userId: userA.id, organizationId: orgA } }, data: { role: Role.ORG_ADMIN, branchId: null } });
  });

  it('assigns only eligible same-branch operators and never exposes secrets', async () => {
    const assignment = await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/counters/${counterA1}/operators`).send({ userId: operatorA }).expect(201);
    expect((assignment.body as { userId: string }).userId).toBe(operatorA);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/counters/${counterA1}/operators`).send({ userId: operatorA }).expect(409);
    const operators = await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/counters/${counterA1}/operators`).expect(200);
    const operatorBody = operators.body as Array<{ user: { passwordHash?: string; tokenHash?: string } }>;
    expect(operatorBody[0]?.user.passwordHash).toBeUndefined();
    expect(operatorBody[0]?.user.tokenHash).toBeUndefined();
    await tenantRequest(tokenA, orgA).delete(`/branches/${branchA1}/counters/${counterA1}/operators/${operatorA}`).expect(200);
    await tenantRequest(tokenA, orgA).delete(`/branches/${branchA1}/counters/${counterA1}/operators/${operatorA}`).expect(404);
  });

  it('blocks foreign, inactive, unauthorized, and cross-branch assignments', async () => {
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/counters/${counterA1}/operators`).send({ userId: '00000000-0000-0000-0000-000000000000' }).expect(403);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA2}/counters/${counterA2}/operators`).send({ userId: operatorA }).expect(403);
    await prisma.membership.update({ where: { userId_organizationId: { userId: operatorA, organizationId: orgA } }, data: { status: MembershipStatus.SUSPENDED } });
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/counters/${counterA1}/operators`).send({ userId: operatorA }).expect(403);
  });
});