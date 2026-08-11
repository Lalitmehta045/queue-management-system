import { clearDatabase } from './test-utils';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MembershipStatus, Role } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { Server } from 'http';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Reception Workflow (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  
  let adminToken: string;
  let receptionistToken: string;
  let otherOrgToken: string;

  let orgId: string;
  let branchId: string;
  let deptId: string;
  let serviceId: string;

  let otherOrgId: string;
  let otherBranchId: string;

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

    // Setup Main Org
    adminToken = await register('reception-admin@test.com');
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'reception-admin@test.com' }, include: { memberships: true } });
    orgId = admin.memberships[0]!.organizationId;

    // Create branch, dept, service
    branchId = ((await tenantRequest(adminToken, orgId).post('/organizations/current/branches').send({ name: 'Reception Branch', code: 'REC1' }).expect(201)).body as { id: string }).id;
    deptId = ((await tenantRequest(adminToken, orgId).post(`/branches/${branchId}/departments`).send({ name: 'General' }).expect(201)).body as { id: string }).id;
    serviceId = ((await tenantRequest(adminToken, orgId).post(`/departments/${deptId}/services`).send({ name: 'Consultation' }).expect(201)).body as { id: string }).id;

    // Create Receptionist
    receptionistToken = await register('receptionist@test.com');
    const receptionist = await prisma.user.findUniqueOrThrow({ where: { email: 'receptionist@test.com' } });
    await prisma.membership.create({ data: { userId: receptionist.id, organizationId: orgId, branchId: branchId, role: Role.RECEPTIONIST, status: MembershipStatus.ACTIVE } });

    // Setup Other Org
    otherOrgToken = await register('reception-other@test.com');
    const otherAdmin = await prisma.user.findUniqueOrThrow({ where: { email: 'reception-other@test.com' }, include: { memberships: true } });
    otherOrgId = otherAdmin.memberships[0]!.organizationId;
    otherBranchId = ((await tenantRequest(otherOrgToken, otherOrgId).post('/organizations/current/branches').send({ name: 'Other Branch', code: 'OTH1' }).expect(201)).body as { id: string }).id;
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  it('allows receptionist to fetch departments and services', async () => {
    const depts = await tenantRequest(receptionistToken, orgId).get(`/branches/${branchId}/departments?page=1&limit=100`).expect(200);
    expect((depts.body as { data: unknown[] }).data).toHaveLength(1);
    
    const svcs = await tenantRequest(receptionistToken, orgId).get(`/departments/${deptId}/services?page=1&limit=100`).expect(200);
    expect((svcs.body as { data: unknown[] }).data).toHaveLength(1);
  });

  it('allows receptionist to fetch priorities', async () => {
    // Admin configures it first
    await tenantRequest(adminToken, orgId).post('/priority-configurations').send({ departmentId: deptId, level: 'EMERGENCY', weight: 100, active: true }).expect(201);
    
    // Receptionist fetches it
    const priors = await tenantRequest(receptionistToken, orgId).get(`/priority-configurations?departmentId=${deptId}`).expect(200);
    expect((priors.body as { data: unknown[] }).data.length).toBeGreaterThan(0);
  });

  it('allows receptionist to create walk-in patient, queue entry, and token', async () => {
    // 1. Create Patient
    const patientRes = await tenantRequest(receptionistToken, orgId).post(`/branches/${branchId}/patients`).send({
      firstName: 'Walk-in',
      lastName: 'Patient',
      phone: '1234567890'
    }).expect(201);
    const patientId = (patientRes.body as { id: string }).id;

    // 2. Create Queue Entry
    const qeRes = await tenantRequest(receptionistToken, orgId).post(`/branches/${branchId}/queue-entries`).send({
      patientId,
      serviceId,
      priority: 'NORMAL'
    }).expect(201);
    const queueEntryId = (qeRes.body as { id: string }).id;

    // 3. Generate Token
    const tokenRes = await tenantRequest(receptionistToken, orgId).post(`/branches/${branchId}/queue-entries/${queueEntryId}/token`).send({}).expect(201);
    expect((tokenRes.body as { displayNumber: string }).displayNumber).toBeDefined();

    // 4. Duplicate Queue Entry prevention
    await tenantRequest(receptionistToken, orgId).post(`/branches/${branchId}/queue-entries`).send({
      patientId,
      serviceId,
      priority: 'NORMAL'
    }).expect(409);

    // 5. Idempotent Token Generation
    const tokenRes2 = await tenantRequest(receptionistToken, orgId).post(`/branches/${branchId}/queue-entries/${queueEntryId}/token`).send({}).expect(201);
    expect((tokenRes2.body as { id: string }).id).toBe((tokenRes.body as { id: string }).id); // Same token returned
  });

  it('blocks cross-tenant operations for receptionist', async () => {
    // Try to create patient in other org
    await tenantRequest(receptionistToken, otherOrgId).post(`/branches/${otherBranchId}/patients`).send({
      firstName: 'Hacker',
      lastName: 'Patient'
    }).expect(403);
    
    // Try to forge organizationId while targeting own branch
    await tenantRequest(receptionistToken, otherOrgId).post(`/branches/${branchId}/patients`).send({
      firstName: 'Hacker',
      lastName: 'Patient'
    }).expect(403); // Forbidden because membership doesn't match otherOrgId
  });
});
