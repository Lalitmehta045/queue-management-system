import { clearDatabase } from './test-utils';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MembershipStatus, Role } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { Server } from 'http';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Analytics Security (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  let orgAdminToken: string;
  let orgA: string;
  let branchA1: string;
  let branchA2: string;

  let orgBToken: string;
  let orgB: string;
  let branchB1: string;

  let branchAdminToken: string;
  let branchAdminUserId: string;

  let receptionistToken: string;

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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<PrismaService>(PrismaService);

    orgAdminToken = await register('analytics-admin@example.com');
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'analytics-admin@example.com' }, include: { memberships: true } });
    orgA = admin.memberships[0]!.organizationId;

    branchA1 = ((await tenantRequest(orgAdminToken, orgA).post('/organizations/current/branches').send({ name: 'Analytics A1', code: 'ANA1' }).expect(201)).body as { id: string }).id;
    branchA2 = ((await tenantRequest(orgAdminToken, orgA).post('/organizations/current/branches').send({ name: 'Analytics A2', code: 'ANA2' }).expect(201)).body as { id: string }).id;

    orgBToken = await register('analytics-orgb@example.com');
    const orgBUser = await prisma.user.findUniqueOrThrow({ where: { email: 'analytics-orgb@example.com' }, include: { memberships: true } });
    orgB = orgBUser.memberships[0]!.organizationId;
    branchB1 = ((await tenantRequest(orgBToken, orgB).post('/organizations/current/branches').send({ name: 'Analytics B1', code: 'ANB1' }).expect(201)).body as { id: string }).id;

    const branchAdminEmail = 'analytics-branchadmin@example.com';
    branchAdminToken = await register(branchAdminEmail);
    const branchAdmin = await prisma.user.findUniqueOrThrow({ where: { email: branchAdminEmail } });
    branchAdminUserId = branchAdmin.id;
    await prisma.membership.create({
      data: { userId: branchAdmin.id, organizationId: orgA, branchId: branchA1, role: Role.BRANCH_ADMIN, status: MembershipStatus.ACTIVE },
    });

    const receptionistEmail = 'analytics-receptionist@example.com';
    receptionistToken = await register(receptionistEmail);
    const receptionist = await prisma.user.findUniqueOrThrow({ where: { email: receptionistEmail } });
    await prisma.membership.create({
      data: { userId: receptionist.id, organizationId: orgA, branchId: branchA1, role: Role.RECEPTIONIST, status: MembershipStatus.ACTIVE },
    });
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  describe('Organization isolation', () => {
    it('ORG_ADMIN of Org A can access their own branch analytics', async () => {
      await tenantRequest(orgAdminToken, orgA).get(`/branches/${branchA1}/analytics/summary`).expect(200);
    });

    it('ORG_ADMIN of Org A cannot access Org B branch analytics', async () => {
      await tenantRequest(orgAdminToken, orgA).get(`/branches/${branchB1}/analytics/summary`).expect(404);
    });

    it('ORG_ADMIN of Org B cannot access Org A branch analytics', async () => {
      await tenantRequest(orgBToken, orgB).get(`/branches/${branchA1}/analytics/summary`).expect(404);
    });
  });

  describe('Branch isolation', () => {
    it('BRANCH_ADMIN can access their assigned branch', async () => {
      await tenantRequest(branchAdminToken, orgA).get(`/branches/${branchA1}/analytics/summary`).expect(200);
    });

    it('BRANCH_ADMIN cannot access another branch in the same org', async () => {
      await tenantRequest(branchAdminToken, orgA).get(`/branches/${branchA2}/analytics/summary`).expect(403);
    });

    it('BRANCH_ADMIN cannot access a branch from another org', async () => {
      await tenantRequest(branchAdminToken, orgA).get(`/branches/${branchB1}/analytics/summary`).expect(403);
    });
  });

  describe('Forged tenant headers', () => {
    it('forged organizationId is rejected', async () => {
      await request(server)
        .get(`/branches/${branchA1}/analytics/summary`)
        .set('Authorization', `Bearer ${orgAdminToken}`)
        .set('x-organization-id', orgB)
        .expect(403);
    });

    it('forged branchId with valid org returns 404', async () => {
      await tenantRequest(orgAdminToken, orgA).get(`/branches/${branchB1}/analytics/summary`).expect(404);
    });
  });

  describe('Suspended membership', () => {
    it('suspended membership cannot access analytics', async () => {
      await prisma.membership.update({
        where: { userId_organizationId: { userId: branchAdminUserId, organizationId: orgA } },
        data: { status: MembershipStatus.SUSPENDED },
      });
      await tenantRequest(branchAdminToken, orgA).get(`/branches/${branchA1}/analytics/summary`).expect(403);

      await prisma.membership.update({
        where: { userId_organizationId: { userId: branchAdminUserId, organizationId: orgA } },
        data: { status: MembershipStatus.ACTIVE },
      });
    });
  });

  describe('Unauthorized roles', () => {
    it('RECEPTIONIST cannot access analytics', async () => {
      await tenantRequest(receptionistToken, orgA).get(`/branches/${branchA1}/analytics/summary`).expect(403);
    });

    it('RECEPTIONIST cannot access service performance', async () => {
      await tenantRequest(receptionistToken, orgA).get(`/branches/${branchA1}/analytics/services`).expect(403);
    });

    it('RECEPTIONIST cannot access counter performance', async () => {
      await tenantRequest(receptionistToken, orgA).get(`/branches/${branchA1}/analytics/counters`).expect(403);
    });

    it('RECEPTIONIST cannot access trends', async () => {
      await tenantRequest(receptionistToken, orgA).get(`/branches/${branchA1}/analytics/trends`).expect(403);
    });

    it('RECEPTIONIST cannot access appointments analytics', async () => {
      await tenantRequest(receptionistToken, orgA).get(`/branches/${branchA1}/analytics/appointments`).expect(403);
    });

    it('RECEPTIONIST cannot export CSV', async () => {
      await tenantRequest(receptionistToken, orgA).get(`/branches/${branchA1}/analytics/export`).expect(403);
    });
  });

  describe('Invalid query parameters', () => {
    it('invalid businessDate format is rejected', async () => {
      await tenantRequest(orgAdminToken, orgA)
        .get(`/branches/${branchA1}/analytics/summary?businessDate=not-a-date`)
        .expect(400);
    });

    it('invalid startDate format is rejected', async () => {
      await tenantRequest(orgAdminToken, orgA)
        .get(`/branches/${branchA1}/analytics/summary?startDate=2024/01/01`)
        .expect(400);
    });

    it('invalid UUID for serviceId is rejected', async () => {
      await tenantRequest(orgAdminToken, orgA)
        .get(`/branches/${branchA1}/analytics/summary?serviceId=not-a-uuid`)
        .expect(400);
    });

    it('invalid UUID for departmentId is rejected', async () => {
      await tenantRequest(orgAdminToken, orgA)
        .get(`/branches/${branchA1}/analytics/summary?departmentId=not-a-uuid`)
        .expect(400);
    });

    it('invalid UUID for counterId is rejected', async () => {
      await tenantRequest(orgAdminToken, orgA)
        .get(`/branches/${branchA1}/analytics/summary?counterId=not-a-uuid`)
        .expect(400);
    });

    it('non-UUID branchId is rejected', async () => {
      await tenantRequest(orgAdminToken, orgA)
        .get('/branches/not-a-uuid/analytics/summary')
        .expect(404);
    });
  });

  describe('Sensitive field exclusion', () => {
    it('summary response does not contain patient PII fields', async () => {
      const res = await tenantRequest(orgAdminToken, orgA)
        .get(`/branches/${branchA1}/analytics/summary`)
        .expect(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('phone');
      expect(body).not.toContain('email');
      expect(body).not.toContain('password');
      expect(body).not.toContain('passwordHash');
    });

    it('service performance response does not contain patient PII', async () => {
      const res = await tenantRequest(orgAdminToken, orgA)
        .get(`/branches/${branchA1}/analytics/services`)
        .expect(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('phone');
      expect(body).not.toContain('email');
    });

    it('counter performance response does not contain patient PII', async () => {
      const res = await tenantRequest(orgAdminToken, orgA)
        .get(`/branches/${branchA1}/analytics/counters`)
        .expect(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('phone');
      expect(body).not.toContain('email');
    });

    it('CSV export does not contain patient PII', async () => {
      const res = await tenantRequest(orgAdminToken, orgA)
        .get(`/branches/${branchA1}/analytics/export?type=services`)
        .expect(200);
      const text = res.text;
      expect(text.toLowerCase()).not.toContain('phone');
      expect(text.toLowerCase()).not.toContain('email');
    });
  });

  describe('All analytics endpoints require auth', () => {
    it('summary requires authentication', async () => {
      await request(server).get(`/branches/${branchA1}/analytics/summary`).expect(401);
    });

    it('services requires authentication', async () => {
      await request(server).get(`/branches/${branchA1}/analytics/services`).expect(401);
    });

    it('counters requires authentication', async () => {
      await request(server).get(`/branches/${branchA1}/analytics/counters`).expect(401);
    });

    it('trends requires authentication', async () => {
      await request(server).get(`/branches/${branchA1}/analytics/trends`).expect(401);
    });

    it('appointments requires authentication', async () => {
      await request(server).get(`/branches/${branchA1}/analytics/appointments`).expect(401);
    });

    it('export requires authentication', async () => {
      await request(server).get(`/branches/${branchA1}/analytics/export`).expect(401);
    });
  });
});
