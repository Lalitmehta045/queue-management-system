import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { clearDatabase } from './test-utils';

describe('Team members (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let adminToken: string;
  let otherToken: string;
  let orgId: string;
  let otherOrgId: string;
  let branchId: string;
  let otherBranchId: string;
  let counterId: string;

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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<PrismaService>(PrismaService);

    adminToken = await register('team-admin@example.com');
    otherToken = await register('team-other@example.com');

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'team-admin@example.com' }, include: { memberships: true } });
    const other = await prisma.user.findUniqueOrThrow({ where: { email: 'team-other@example.com' }, include: { memberships: true } });
    orgId = admin.memberships[0]!.organizationId;
    otherOrgId = other.memberships[0]!.organizationId;

    branchId = ((await tenantRequest(adminToken, orgId).post('/organizations/current/branches').send({ name: 'Main Branch', code: 'MAIN' }).expect(201)).body as { id: string }).id;
    otherBranchId = ((await tenantRequest(otherToken, otherOrgId).post('/organizations/current/branches').send({ name: 'Other Branch', code: 'OTHER' }).expect(201)).body as { id: string }).id;
    counterId = ((await tenantRequest(adminToken, orgId).post(`/branches/${branchId}/counters`).send({ name: 'Counter 1', code: 'C1' }).expect(201)).body as { id: string }).id;
  });

  afterAll(async () => {
    try {
      if (prisma) await clearDatabase(prisma);
    } finally {
      if (app) await app.close();
    }
  });

  it('creates a real active counter operator account with optional counter assignment', async () => {
    const response = await tenantRequest(adminToken, orgId)
      .post('/organizations/current/team-members')
      .send({
        displayName: 'Counter Operator One',
        email: 'operator@example.com',
        role: 'COUNTER_OPERATOR',
        branchId,
        counterId,
      })
      .expect(201);

    const body = response.body as { temporaryPassword: string; member: { userId: string; email: string; status: string; counterAssignment: { counterId: string } | null; passwordHash?: string } };
    expect(body.temporaryPassword).toHaveLength(24);
    expect(body.member.email).toBe('operator@example.com');
    expect(body.member.status).toBe('ACTIVE');
    expect(body.member.counterAssignment?.counterId).toBe(counterId);
    expect(body.member.passwordHash).toBeUndefined();

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'operator@example.com' }, include: { memberships: true } });
    expect(user.passwordHash).toBeDefined();
    expect(user.memberships[0]?.organizationId).toBe(orgId);
    expect(user.memberships[0]?.branchId).toBe(branchId);

    const login = await request(server).post('/auth/login').send({ email: 'operator@example.com', password: body.temporaryPassword }).expect(200);
    const operatorToken = (login.body as { accessToken: string }).accessToken;
    await tenantRequest(operatorToken, orgId).get('/organizations/current/team-members').expect(403);
    const assigned = await tenantRequest(operatorToken, orgId).get(`/branches/${branchId}/counters/assigned`).expect(200);
    expect((assigned.body as Array<{ id: string }>).map((counter) => counter.id)).toContain(counterId);
  });

  it('lists team members without exposing authentication secrets', async () => {
    const response = await tenantRequest(adminToken, orgId).get('/organizations/current/team-members').expect(200);
    const body = response.body as Array<{ email: string; passwordHash?: string; tokenHash?: string }>;
    expect(body.some((member) => member.email === 'operator@example.com')).toBe(true);
    expect(body[0]?.passwordHash).toBeUndefined();
    expect(body[0]?.tokenHash).toBeUndefined();
  });

  it('rejects invalid role, cross-tenant branch, and cross-branch counter combinations', async () => {
    await tenantRequest(adminToken, orgId)
      .post('/organizations/current/team-members')
      .send({ displayName: 'Bad Role', email: 'bad-role@example.com', role: 'ORG_ADMIN', branchId })
      .expect(400);

    await tenantRequest(adminToken, orgId)
      .post('/organizations/current/team-members')
      .send({ displayName: 'Bad Branch', email: 'bad-branch@example.com', role: 'COUNTER_OPERATOR', branchId: otherBranchId })
      .expect(404);

    const otherCounterId = ((await tenantRequest(otherToken, otherOrgId).post(`/branches/${otherBranchId}/counters`).send({ name: 'Other Counter', code: 'OC1' }).expect(201)).body as { id: string }).id;
    await tenantRequest(adminToken, orgId)
      .post('/organizations/current/team-members')
      .send({ displayName: 'Bad Counter', email: 'bad-counter@example.com', role: 'COUNTER_OPERATOR', branchId, counterId: otherCounterId })
      .expect(404);
  });

  it('deactivation removes eligibility for counter assignment', async () => {
    const created = await tenantRequest(adminToken, orgId)
      .post('/organizations/current/team-members')
      .send({ displayName: 'Inactive Operator', email: 'inactive-operator@example.com', role: 'COUNTER_OPERATOR', branchId })
      .expect(201);
    const memberId = (created.body as { member: { id: string; userId: string } }).member.id;
    const userId = (created.body as { member: { id: string; userId: string } }).member.userId;

    await tenantRequest(adminToken, orgId).post(`/organizations/current/team-members/${memberId}/deactivate`).expect(201);
    await tenantRequest(adminToken, orgId).post(`/branches/${branchId}/counters/${counterId}/operators`).send({ userId }).expect(403);
  });
});
