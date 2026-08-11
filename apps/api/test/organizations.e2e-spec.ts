import { clearDatabase } from './test-utils';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'http';
import cookieParser from 'cookie-parser';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { MembershipStatus, Role } from '@prisma/client';

type AuthResponse = { accessToken: string };
type OrganizationResponse = { id: string; name: string; slug: string; passwordHash?: string };
type BranchResponse = { id: string; organizationId: string; status: string; passwordHash?: string };
type BranchListResponse = { data: BranchResponse[]; meta: { limit: number } };

describe('Organizations and branches (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenA: string;
  let tokenB: string;
  let orgA: string;
  let orgB: string;
  let branchA1: string;
  let branchB1: string;
  let server: Server;

  async function register(email: string, displayName: string): Promise<string> {
    const response = await request(server)
      .post('/auth/register')
      .send({ email, password: 'password123', displayName })
      .expect(201);
    return (response.body as AuthResponse).accessToken;
  }

  function tenantRequest(token: string, organizationId: string) {
    const withTenant = (test: request.Test) => test
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', organizationId);
    return {
      get: (path: string) => withTenant(request(server).get(path)),
      post: (path: string) => withTenant(request(server).post(path)),
      patch: (path: string) => withTenant(request(server).patch(path)),
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<PrismaService>(PrismaService);

    tokenA = await register('phase2a-a@example.com', 'Phase 2A A');
    tokenB = await register('phase2a-b@example.com', 'Phase 2A B');
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: 'phase2a-a@example.com' } });
    const userB = await prisma.user.findUniqueOrThrow({ where: { email: 'phase2a-b@example.com' } });
    const membershipA = await prisma.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: userA.id, organizationId: (await prisma.membership.findFirstOrThrow({ where: { userId: userA.id } })).organizationId } },
    });
    const membershipB = await prisma.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: userB.id, organizationId: (await prisma.membership.findFirstOrThrow({ where: { userId: userB.id } })).organizationId } },
    });
    orgA = membershipA.organizationId;
    orgB = membershipB.organizationId;
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  it('ORG_ADMIN can read and update their organization without security fields', async () => {
    const response = await tenantRequest(tokenA, orgA).get('/organizations/current').expect(200);
    const organization = response.body as OrganizationResponse;
    expect(organization.id).toBe(orgA);
    expect(organization.passwordHash).toBeUndefined();

    await tenantRequest(tokenA, orgA)
      .patch('/organizations/current')
      .send({ name: 'Updated Phase 2A Organization' })
      .expect(200);
  });

  it('rejects organization updates for a non-admin role', async () => {
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: 'phase2a-a@example.com' } });
    await prisma.membership.update({
      where: { userId_organizationId: { userId: userA.id, organizationId: orgA } },
      data: { role: Role.RECEPTIONIST },
    });

    await tenantRequest(tokenA, orgA)
      .patch('/organizations/current')
      .send({ name: 'Should Not Update' })
      .expect(403);

    await prisma.membership.update({
      where: { userId_organizationId: { userId: userA.id, organizationId: orgA } },
      data: { role: Role.ORG_ADMIN },
    });
  });

  it('ORG_ADMIN can create, list, read, update, deactivate, and reactivate a branch', async () => {
    const createResponse = await tenantRequest(tokenA, orgA)
      .post('/organizations/current/branches')
      .send({ name: 'A1', code: 'A1' })
      .expect(201);
    branchA1 = (createResponse.body as BranchResponse).id;

    await tenantRequest(tokenA, orgA).post('/organizations/current/branches')
      .send({ name: 'A2', code: 'A2' })
      .expect(201);

    const listResponse = await tenantRequest(tokenA, orgA)
      .get('/organizations/current/branches')
      .query({ page: 1, limit: 20 })
      .expect(200);
    expect((listResponse.body as BranchListResponse).data).toHaveLength(2);

    const readResponse = await tenantRequest(tokenA, orgA)
      .get(`/organizations/current/branches/${branchA1}`)
      .expect(200);
    expect((readResponse.body as BranchResponse).organizationId).toBe(orgA);
    expect((readResponse.body as BranchResponse).passwordHash).toBeUndefined();

    await tenantRequest(tokenA, orgA)
      .patch(`/organizations/current/branches/${branchA1}`)
      .send({ name: 'A1 Updated' })
      .expect(200);
    await tenantRequest(tokenA, orgA)
      .post(`/organizations/current/branches/${branchA1}/deactivate`)
      .expect(201);
    await tenantRequest(tokenA, orgA)
      .post(`/organizations/current/branches/${branchA1}/activate`)
      .expect(201);
  });

  it('prevents cross-tenant reads, updates, and deactivation', async () => {
    const createResponse = await tenantRequest(tokenB, orgB)
      .post('/organizations/current/branches')
      .send({ name: 'B1', code: 'B1' })
      .expect(201);
    branchB1 = (createResponse.body as BranchResponse).id;

    await tenantRequest(tokenA, orgA).get(`/organizations/current/branches/${branchB1}`).expect(404);
    await tenantRequest(tokenA, orgA).patch(`/organizations/current/branches/${branchB1}`).send({ name: 'Stolen' }).expect(404);
    await tenantRequest(tokenA, orgA).post(`/organizations/current/branches/${branchB1}/deactivate`).expect(404);

    const listResponse = await tenantRequest(tokenA, orgA).get('/organizations/current/branches').expect(200);
    expect((listResponse.body as BranchListResponse).data.some((branch) => branch.id === branchB1)).toBe(false);
  });

  it('rejects a client-supplied organizationId and duplicate branch identifiers', async () => {
    await tenantRequest(tokenA, orgA)
      .post('/organizations/current/branches')
      .send({ name: 'Malicious', code: 'MAL', organizationId: orgB })
      .expect(400);

    await tenantRequest(tokenA, orgA)
      .post('/organizations/current/branches')
      .send({ name: 'Duplicate', code: 'A1' })
      .expect(409);
  });

  it('rejects suspended membership, invalid branch IDs, and excessive page limits', async () => {
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: 'phase2a-a@example.com' } });
    await prisma.membership.update({
      where: { userId_organizationId: { userId: userA.id, organizationId: orgA } },
      data: { status: MembershipStatus.SUSPENDED },
    });

    await tenantRequest(tokenA, orgA).get('/organizations/current/branches').expect(403);

    await prisma.membership.update({
      where: { userId_organizationId: { userId: userA.id, organizationId: orgA } },
      data: { status: MembershipStatus.ACTIVE },
    });
    await tenantRequest(tokenA, orgA).get('/organizations/current/branches/not-a-branch').expect(404);
    await tenantRequest(tokenA, orgA).get('/organizations/current/branches').query({ limit: 1000000 }).expect(400);
  });
});
