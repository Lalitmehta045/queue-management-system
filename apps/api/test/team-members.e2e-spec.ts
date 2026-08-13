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

  describe('password update', () => {
    let staffMembershipId: string;
    let staffEmail: string;

    beforeAll(async () => {
      staffEmail = 'pw-update-staff@example.com';
      const response = await tenantRequest(adminToken, orgId)
        .post('/organizations/current/team-members')
        .send({
          displayName: 'Password Update Staff',
          email: staffEmail,
          role: 'RECEPTIONIST',
          branchId,
        })
        .expect(201);
      staffMembershipId = (response.body as { member: { id: string } }).member.id;
    });

    it('admin can update a team member password', async () => {
      await tenantRequest(adminToken, orgId)
        .patch(`/organizations/current/team-members/${staffMembershipId}/password`)
        .send({ newPassword: 'newSecure123' })
        .expect(200);
    });

    it('new password is hashed before persistence', async () => {
      await tenantRequest(adminToken, orgId)
        .patch(`/organizations/current/team-members/${staffMembershipId}/password`)
        .send({ newPassword: 'hashedCheck1' })
        .expect(200);

      const membership = await prisma.membership.findUniqueOrThrow({
        where: { id: staffMembershipId },
        select: { userId: true },
      });
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: membership.userId },
        select: { passwordHash: true },
      });
      expect(user.passwordHash).toBeDefined();
      expect(user.passwordHash).not.toBe('hashedCheck1');
    });

    it('existing plaintext password cannot be retrieved via API', async () => {
      const listResponse = await tenantRequest(adminToken, orgId)
        .get('/organizations/current/team-members')
        .expect(200);
      const members = listResponse.body as Array<{ email: string; passwordHash?: string }>;
      const staff = members.find((m) => m.email === staffEmail);
      expect(staff).toBeDefined();
      expect(staff?.passwordHash).toBeUndefined();
    });

    it('unauthorized user cannot update another user password', async () => {
      // otherToken is an ORG_ADMIN of a different org
      await tenantRequest(otherToken, otherOrgId)
        .patch(`/organizations/current/team-members/${staffMembershipId}/password`)
        .send({ newPassword: 'hackerPass1' })
        .expect(404);
    });

    it('cross-organization password update is rejected', async () => {
      // Try using otherToken against the admin's orgId
      await request(server)
        .patch(`/organizations/current/team-members/${staffMembershipId}/password`)
        .set('Authorization', `Bearer ${otherToken}`)
        .set('x-organization-id', orgId)
        .send({ newPassword: 'crossOrg123' })
        .expect(403);
    });

    it('user role/branch/counter assignment remain unchanged after password update', async () => {
      const beforeResponse = await tenantRequest(adminToken, orgId)
        .get('/organizations/current/team-members')
        .expect(200);
      const before = (beforeResponse.body as Array<{ id: string; role: string; branchId: string; status: string; counterAssignment: unknown }>)
        .find((m) => m.id === staffMembershipId);

      await tenantRequest(adminToken, orgId)
        .patch(`/organizations/current/team-members/${staffMembershipId}/password`)
        .send({ newPassword: 'unchanged1' })
        .expect(200);

      const afterResponse = await tenantRequest(adminToken, orgId)
        .get('/organizations/current/team-members')
        .expect(200);
      const after = (afterResponse.body as Array<{ id: string; role: string; branchId: string; status: string; counterAssignment: unknown }>)
        .find((m) => m.id === staffMembershipId);

      expect(after?.role).toBe(before?.role);
      expect(after?.branchId).toBe(before?.branchId);
      expect(after?.status).toBe(before?.status);
      expect(after?.counterAssignment).toEqual(before?.counterAssignment);
    });

    it('new password works for login', async () => {
      const newPw = 'loginWorks1';
      await tenantRequest(adminToken, orgId)
        .patch(`/organizations/current/team-members/${staffMembershipId}/password`)
        .send({ newPassword: newPw })
        .expect(200);

      await request(server)
        .post('/auth/login')
        .send({ email: staffEmail, password: newPw })
        .expect(200);
    });

    it('old password no longer works after update', async () => {
      const oldPw = 'oldPassword1';
      const newPw = 'newPassword1';

      await tenantRequest(adminToken, orgId)
        .patch(`/organizations/current/team-members/${staffMembershipId}/password`)
        .send({ newPassword: oldPw })
        .expect(200);

      await tenantRequest(adminToken, orgId)
        .patch(`/organizations/current/team-members/${staffMembershipId}/password`)
        .send({ newPassword: newPw })
        .expect(200);

      await request(server)
        .post('/auth/login')
        .send({ email: staffEmail, password: oldPw })
        .expect(401);
    });

    it('password/hash is never included in API responses', async () => {
      const updateResponse = await tenantRequest(adminToken, orgId)
        .patch(`/organizations/current/team-members/${staffMembershipId}/password`)
        .send({ newPassword: 'noLeakPw12' })
        .expect(200);

      const updateBody = updateResponse.body as Record<string, unknown>;
      expect(updateBody.password).toBeUndefined();
      expect(updateBody.passwordHash).toBeUndefined();
      expect(updateBody.newPassword).toBeUndefined();

      const listResponse = await tenantRequest(adminToken, orgId)
        .get('/organizations/current/team-members')
        .expect(200);
      for (const member of listResponse.body as Array<Record<string, unknown>>) {
        expect(member.password).toBeUndefined();
        expect(member.passwordHash).toBeUndefined();
      }
    });

    it('rejects password shorter than 8 characters', async () => {
      await tenantRequest(adminToken, orgId)
        .patch(`/organizations/current/team-members/${staffMembershipId}/password`)
        .send({ newPassword: 'short' })
        .expect(400);
    });
  });
});
