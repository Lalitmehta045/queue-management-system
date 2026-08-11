import { clearDatabase } from './test-utils';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'http';
import cookieParser from 'cookie-parser';
import { MembershipStatus, Role } from '@prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

type AuthResponse = { accessToken: string };
type Resource = { id: string; branchId?: string; departmentId?: string; name: string; status: string; passwordHash?: string };
type ListResponse = { data: Resource[]; meta: { total: number; limit: number } };

describe('Departments and services (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let tokenA: string;
  let tokenB: string;
  let orgA: string;
  let orgB: string;
  let branchA1: string;
  let branchA2: string;
  let branchB: string;
  let departmentA: string;
  let departmentA2: string;
  let departmentB: string;
  let serviceA: string;
  let serviceB: string;

  function tenantRequest(token: string, organizationId: string) {
    const withTenant = (test: request.Test) => test.set('Authorization', `Bearer ${token}`).set('x-organization-id', organizationId);
    return {
      get: (path: string) => withTenant(request(server).get(path)),
      post: (path: string) => withTenant(request(server).post(path)),
      patch: (path: string) => withTenant(request(server).patch(path)),
    };
  }

  async function register(email: string): Promise<string> {
    const response = await request(server).post('/auth/register').send({ email, password: 'password123', displayName: email }).expect(201);
    return (response.body as AuthResponse).accessToken;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<PrismaService>(PrismaService);
    tokenA = await register('phase2b-a@example.com');
    tokenB = await register('phase2b-b@example.com');
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: 'phase2b-a@example.com' }, include: { memberships: true } });
    const userB = await prisma.user.findUniqueOrThrow({ where: { email: 'phase2b-b@example.com' }, include: { memberships: true } });
    orgA = userA.memberships[0]!.organizationId;
    orgB = userB.memberships[0]!.organizationId;
    const branchAResponse = await tenantRequest(tokenA, orgA).post('/organizations/current/branches').send({ name: 'Phase 2B A1', code: 'P2BA1' }).expect(201);
    branchA1 = (branchAResponse.body as Resource).id;
    const branchA2Response = await tenantRequest(tokenA, orgA).post('/organizations/current/branches').send({ name: 'Phase 2B A2', code: 'P2BA2' }).expect(201);
    branchA2 = (branchA2Response.body as Resource).id;
    const branchBResponse = await tenantRequest(tokenB, orgB).post('/organizations/current/branches').send({ name: 'Phase 2B B1', code: 'P2BB1' }).expect(201);
    branchB = (branchBResponse.body as Resource).id;
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  it('creates and lists departments with pagination', async () => {
    const response = await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/departments`).send({ name: 'Registration' }).expect(201);
    departmentA = (response.body as Resource).id;
    const second = await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/departments`).send({ name: 'Records' }).expect(201);
    departmentA2 = (second.body as Resource).id;
    const list = await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/departments`).query({ page: 1, limit: 1 }).expect(200);
    expect((list.body as ListResponse).data).toHaveLength(1);
    expect((list.body as ListResponse).meta.limit).toBe(1);
  });

  it('gets, updates, deactivates, and activates a department', async () => {
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/departments/${departmentA}`).expect(200);
    await tenantRequest(tokenA, orgA).patch(`/branches/${branchA1}/departments/${departmentA}`).send({ name: 'Registration Updated' }).expect(200);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/departments/${departmentA}/deactivate`).expect(201);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: departmentA } })).status).toBe('INACTIVE');
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/departments/${departmentA}/activate`).expect(201);
  });

  it('creates, lists, gets, updates, deactivates, and activates a service', async () => {
    const response = await tenantRequest(tokenA, orgA).post(`/departments/${departmentA}/services`).send({ name: 'General Consultation' }).expect(201);
    serviceA = (response.body as Resource).id;
    const list = await tenantRequest(tokenA, orgA).get(`/departments/${departmentA}/services`).expect(200);
    expect((list.body as ListResponse).data).toHaveLength(1);
    await tenantRequest(tokenA, orgA).get(`/departments/${departmentA}/services/${serviceA}`).expect(200);
    await tenantRequest(tokenA, orgA).patch(`/departments/${departmentA}/services/${serviceA}`).send({ name: 'Updated Consultation' }).expect(200);
    await tenantRequest(tokenA, orgA).post(`/departments/${departmentA}/services/${serviceA}/deactivate`).expect(201);
    expect((await prisma.service.findUniqueOrThrow({ where: { id: serviceA } })).status).toBe('INACTIVE');
    await tenantRequest(tokenA, orgA).post(`/departments/${departmentA}/services/${serviceA}/activate`).expect(201);
  });

  it('enforces uniqueness, validation, and pagination maximums', async () => {
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/departments`).send({ name: 'Registration Updated' }).expect(409);
    await tenantRequest(tokenA, orgA).post(`/departments/${departmentA}/services`).send({ name: 'Updated Consultation' }).expect(409);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/departments`).query({ limit: 1000000 }).expect(400);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/departments`).send({ name: 'x' }).expect(400);
  });

  it('rejects malicious parent IDs and cross-branch department access', async () => {
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/departments`).send({ name: 'Forged', branchId: branchA2 }).expect(400);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA2}/departments/${departmentA}`).expect(404);
    await tenantRequest(tokenA, orgA).patch(`/branches/${branchA2}/departments/${departmentA}`).send({ name: 'Stolen' }).expect(404);
    await tenantRequest(tokenA, orgA).get(`/branches/${branchA2}/departments/${departmentA2}`).expect(404);
  });

  it('blocks cross-tenant department and service operations', async () => {
    const departmentResponse = await tenantRequest(tokenB, orgB).post(`/branches/${branchB}/departments`).send({ name: 'B Registration' }).expect(201);
    departmentB = (departmentResponse.body as Resource).id;
    const serviceResponse = await tenantRequest(tokenB, orgB).post(`/departments/${departmentB}/services`).send({ name: 'B Service' }).expect(201);
    serviceB = (serviceResponse.body as Resource).id;
    await tenantRequest(tokenA, orgA).get(`/branches/${branchB}/departments/${departmentB}`).expect(404);
    await tenantRequest(tokenA, orgA).patch(`/branches/${branchB}/departments/${departmentB}`).send({ name: 'Stolen' }).expect(404);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchB}/departments/${departmentB}/deactivate`).expect(404);
    await tenantRequest(tokenA, orgA).get(`/departments/${departmentB}/services/${serviceB}`).expect(404);
    await tenantRequest(tokenA, orgA).patch(`/departments/${departmentB}/services/${serviceB}`).send({ name: 'Stolen' }).expect(404);
    await tenantRequest(tokenA, orgA).post(`/departments/${departmentB}/services/${serviceB}/deactivate`).expect(404);
  });

  it('rejects a forged service parent and never exposes sensitive fields', async () => {
    await tenantRequest(tokenA, orgA).post(`/departments/${departmentA}/services`).send({ name: 'Forged Service', departmentId: departmentB }).expect(400);
    const department = await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/departments/${departmentA}`).expect(200);
    const service = await tenantRequest(tokenA, orgA).get(`/departments/${departmentA}/services/${serviceA}`).expect(200);
    expect((department.body as Resource).passwordHash).toBeUndefined();
    expect((service.body as Resource).passwordHash).toBeUndefined();
    expect((service.body as Resource).id).toBe(serviceA);
  });

  it('blocks suspended membership from department and service mutations', async () => {
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: 'phase2b-a@example.com' } });
    await prisma.membership.update({ where: { userId_organizationId: { userId: userA.id, organizationId: orgA } }, data: { status: MembershipStatus.SUSPENDED } });
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/departments`).send({ name: 'Suspended Department' }).expect(403);
    await tenantRequest(tokenA, orgA).patch(`/branches/${branchA1}/departments/${departmentA}`).send({ name: 'Blocked' }).expect(403);
    await tenantRequest(tokenA, orgA).post(`/branches/${branchA1}/departments/${departmentA}/deactivate`).expect(403);
    await tenantRequest(tokenA, orgA).post(`/departments/${departmentA}/services`).send({ name: 'Suspended Service' }).expect(403);
    await tenantRequest(tokenA, orgA).patch(`/departments/${departmentA}/services/${serviceA}`).send({ name: 'Blocked' }).expect(403);
    await tenantRequest(tokenA, orgA).post(`/departments/${departmentA}/services/${serviceA}/deactivate`).expect(403);
    await prisma.membership.update({ where: { userId_organizationId: { userId: userA.id, organizationId: orgA } }, data: { status: MembershipStatus.ACTIVE, role: Role.ORG_ADMIN } });
  });

  it('rejects unrelated service parent routes', async () => {
    await tenantRequest(tokenA, orgA).get(`/departments/${departmentA2}/services/${serviceA}`).expect(404);
    await tenantRequest(tokenA, orgA).patch(`/departments/${departmentA2}/services/${serviceA}`).send({ name: 'Wrong Parent' }).expect(404);
  });

  it('lists only departments in the requested branch', async () => {
    const response = await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/departments`).expect(200);
    expect((response.body as ListResponse).data.every((department) => department.branchId === branchA1)).toBe(true);
  });

  it('blocks a cross-tenant department listing', async () => {
    const response = await tenantRequest(tokenA, orgA).get(`/branches/${branchB}/departments`).expect(404);
    expect(response.body).toBeDefined();
  });

  it('blocks a cross-tenant service listing', async () => {
    await tenantRequest(tokenA, orgA).get(`/departments/${departmentB}/services`).expect(404);
  });

  it('returns department parent identifiers', async () => {
    const response = await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/departments/${departmentA}`).expect(200);
    expect((response.body as Resource).branchId).toBe(branchA1);
  });

  it('returns service parent identifiers', async () => {
    const response = await tenantRequest(tokenA, orgA).get(`/departments/${departmentA}/services/${serviceA}`).expect(200);
    expect((response.body as Resource).departmentId).toBe(departmentA);
  });

  it('supports service pagination', async () => {
    const response = await tenantRequest(tokenA, orgA).get(`/departments/${departmentA}/services`).query({ page: 1, limit: 1 }).expect(200);
    expect((response.body as ListResponse).meta.limit).toBe(1);
  });

  it('rejects excessive service page limits', async () => {
    await tenantRequest(tokenA, orgA).get(`/departments/${departmentA}/services`).query({ limit: 1000000 }).expect(400);
  });

  it('rejects an invalid branch identifier', async () => {
    await tenantRequest(tokenA, orgA).get('/branches/not-a-uuid/departments').expect(404);
  });

  it('rejects an invalid department identifier', async () => {
    await tenantRequest(tokenA, orgA).get('/branches/not-a-uuid/departments/not-a-uuid').expect(404);
  });

  it('rejects an invalid service identifier', async () => {
    await tenantRequest(tokenA, orgA).get(`/departments/${departmentA}/services/not-a-uuid`).expect(404);
  });

  it('rejects department creation under an unknown branch', async () => {
    await tenantRequest(tokenA, orgA).post('/branches/00000000-0000-0000-0000-000000000000/departments').send({ name: 'Unknown Branch' }).expect(404);
  });

  it('rejects service creation under an unknown department', async () => {
    await tenantRequest(tokenA, orgA).post('/departments/00000000-0000-0000-0000-000000000000/services').send({ name: 'Unknown Department' }).expect(404);
  });

  it('rejects service creation under another department', async () => {
    await tenantRequest(tokenA, orgA).post(`/departments/${departmentA2}/services`).send({ name: 'Second Department Service', departmentId: departmentA }).expect(400);
  });

  it('rejects department updates with an authorization parent field', async () => {
    await tenantRequest(tokenA, orgA).patch(`/branches/${branchA1}/departments/${departmentA}`).send({ name: 'Rejected Parent', branchId: branchA2 }).expect(400);
  });

  it('rejects service updates with an authorization parent field', async () => {
    await tenantRequest(tokenA, orgA).patch(`/departments/${departmentA}/services/${serviceA}`).send({ name: 'Rejected Parent', departmentId: departmentA2 }).expect(400);
  });

  it('does not expose department internal fields in a list', async () => {
    const response = await tenantRequest(tokenA, orgA).get(`/branches/${branchA1}/departments`).expect(200);
    expect((response.body as ListResponse).data[0]?.passwordHash).toBeUndefined();
  });

  it('does not expose service internal fields in a list', async () => {
    const response = await tenantRequest(tokenA, orgA).get(`/departments/${departmentA}/services`).expect(200);
    expect((response.body as ListResponse).data[0]?.passwordHash).toBeUndefined();
  });
});