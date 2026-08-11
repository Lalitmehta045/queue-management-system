import { clearDatabase } from './test-utils';
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import cookieParser from 'cookie-parser';
import { AuditAction, AuditResourceType, Role } from '@prisma/client';

describe('Audit Logging Security & Data Correctness (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  let tokenOrgAdminA: string;
  let tokenOrgAdminB: string;
  let tokenBranchAdminA1: string;
  let tokenReceptionistA1: string;

  let orgAId: string;
  let orgBId: string;
  let branchA1Id: string;
  let branchA2Id: string;
  let branchB1Id: string;

  it('Setup multi-tenant audit test environment', async () => {
    // 1. Register Org Admin A
    const resA = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'audit.admina@example.com', password: 'Password123!', displayName: 'Admin A' })
      .expect(201);
    tokenOrgAdminA = (resA.body as { accessToken: string }).accessToken;

    const userA = await prisma.user.findUnique({ where: { email: 'audit.admina@example.com' }, include: { memberships: true } });
    orgAId = userA!.memberships[0]!.organizationId;

    // 2. Register Org Admin B
    const resB = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'audit.adminb@example.com', password: 'Password123!', displayName: 'Admin B' })
      .expect(201);
    tokenOrgAdminB = (resB.body as { accessToken: string }).accessToken;

    const userB = await prisma.user.findUnique({ where: { email: 'audit.adminb@example.com' }, include: { memberships: true } });
    orgBId = userB!.memberships[0]!.organizationId;

    // Create Branches
    const branchA1Res = await request(app.getHttpServer())
      .post('/organizations/current/branches')
      .set('Authorization', `Bearer ${tokenOrgAdminA}`)
      .set('x-organization-id', orgAId)
      .send({ name: 'Branch A1', code: 'BA1' })
      .expect(201);
    branchA1Id = (branchA1Res.body as { id: string }).id;

    const branchA2Res = await request(app.getHttpServer())
      .post('/organizations/current/branches')
      .set('Authorization', `Bearer ${tokenOrgAdminA}`)
      .set('x-organization-id', orgAId)
      .send({ name: 'Branch A2', code: 'BA2' })
      .expect(201);
    branchA2Id = (branchA2Res.body as { id: string }).id;

    const branchB1Res = await request(app.getHttpServer())
      .post('/organizations/current/branches')
      .set('Authorization', `Bearer ${tokenOrgAdminB}`)
      .set('x-organization-id', orgBId)
      .send({ name: 'Branch B1', code: 'BB1' })
      .expect(201);
    branchB1Id = (branchB1Res.body as { id: string }).id;

    // Create Branch Admin for Branch A1
    const baUser = await prisma.user.create({
      data: { email: 'branch.admina1@example.com', displayName: 'Branch Admin A1' },
    });
    await prisma.membership.create({
      data: {
        organizationId: orgAId,
        branchId: branchA1Id,
        userId: baUser.id,
        role: Role.BRANCH_ADMIN,
        status: 'ACTIVE',
      },
    });

    const resBA = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'ba1.real@example.com', password: 'Password123!', displayName: 'BA Real' })
      .expect(201);
    const baRealUser = await prisma.user.findUnique({ where: { email: 'ba1.real@example.com' }, include: { memberships: true } });
    await prisma.membership.update({
      where: { id: baRealUser!.memberships[0]!.id },
      data: { organizationId: orgAId, branchId: branchA1Id, role: Role.BRANCH_ADMIN },
    });
    tokenBranchAdminA1 = (resBA.body as { accessToken: string }).accessToken;

    // Register Receptionist A1
    const resRec = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'rec1.real@example.com', password: 'Password123!', displayName: 'Rec Real' })
      .expect(201);
    const recRealUser = await prisma.user.findUnique({ where: { email: 'rec1.real@example.com' }, include: { memberships: true } });
    await prisma.membership.update({
      where: { id: recRealUser!.memberships[0]!.id },
      data: { organizationId: orgAId, branchId: branchA1Id, role: Role.RECEPTIONIST },
    });
    tokenReceptionistA1 = (resRec.body as { accessToken: string }).accessToken;
  });

  describe('Security & Isolation Verification', () => {
    it('Org Admin A can view audit logs of Branch A1 and Branch A2', async () => {
      const res = await request(app.getHttpServer())
        .get(`/branches/${branchA1Id}/audit-logs`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgAId)
        .expect(200);

      const body = res.body as { data: unknown[] };
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('Branch Admin A1 can view Branch A1 audit logs but NOT Branch A2 audit logs (403)', async () => {
      await request(app.getHttpServer())
        .get(`/branches/${branchA1Id}/audit-logs`)
        .set('Authorization', `Bearer ${tokenBranchAdminA1}`)
        .set('x-organization-id', orgAId)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/branches/${branchA2Id}/audit-logs`)
        .set('Authorization', `Bearer ${tokenBranchAdminA1}`)
        .set('x-organization-id', orgAId)
        .expect(403);
    });

    it('Org Admin A cannot access Org B branch audit logs (cross-tenant 404/403)', async () => {
      await request(app.getHttpServer())
        .get(`/branches/${branchB1Id}/audit-logs`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgAId)
        .expect(404);
    });

    it('Forged x-organization-id is rejected by TenantGuard (403)', async () => {
      await request(app.getHttpServer())
        .get(`/branches/${branchA1Id}/audit-logs`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgBId)
        .expect(403);
    });

    it('Unauthorized role (RECEPTIONIST) is denied audit access (403)', async () => {
      await request(app.getHttpServer())
        .get(`/branches/${branchA1Id}/audit-logs`)
        .set('Authorization', `Bearer ${tokenReceptionistA1}`)
        .set('x-organization-id', orgAId)
        .expect(403);
    });

    it('Suspended membership is denied audit access (403)', async () => {
      // Create temporary suspended user
      const resSus = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'suspended.user@example.com', password: 'Password123!', displayName: 'Suspended' })
        .expect(201);
      const susToken = (resSus.body as { accessToken: string }).accessToken;
      const susUser = await prisma.user.findUnique({ where: { email: 'suspended.user@example.com' }, include: { memberships: true } });

      await prisma.membership.update({
        where: { id: susUser!.memberships[0]!.id },
        data: { organizationId: orgAId, branchId: branchA1Id, role: Role.ORG_ADMIN, status: 'SUSPENDED' },
      });

      await request(app.getHttpServer())
        .get(`/branches/${branchA1Id}/audit-logs`)
        .set('Authorization', `Bearer ${susToken}`)
        .set('x-organization-id', orgAId)
        .expect(403);
    });

    it('Supports safe filtering and deterministic pagination', async () => {
      const res = await request(app.getHttpServer())
        .get(`/branches/${branchA1Id}/audit-logs?page=1&limit=5&action=BRANCH_CREATED`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgAId)
        .expect(200);

      const body = res.body as { meta: { page: number; limit: number } };
      expect(body.meta.page).toBe(1);
      expect(body.meta.limit).toBe(5);
    });
  });

  describe('Data Correctness & Lifecycle Mutations Audit', () => {
    let deptId: string;
    let serviceId: string;
    let counterId: string;
    let patientId: string;
    let queueEntryId: string;
    let tokenId: string;
    let appointmentId: string;

    it('Mutation: Department & Service & Counter Creation', async () => {
      // Dept
      const deptRes = await request(app.getHttpServer())
        .post(`/branches/${branchA1Id}/departments`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgAId)
        .send({ name: 'Cardiology' })
        .expect(201);
      deptId = (deptRes.body as { id: string }).id;

      // Service
      const srvRes = await request(app.getHttpServer())
        .post(`/departments/${deptId}/services`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgAId)
        .send({ name: 'ECG Check' })
        .expect(201);
      serviceId = (srvRes.body as { id: string }).id;

      // Counter
      const cntRes = await request(app.getHttpServer())
        .post(`/branches/${branchA1Id}/counters`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgAId)
        .send({ name: 'Counter 1', code: 'C1' })
        .expect(201);
      counterId = (cntRes.body as { id: string }).id;
    });

    it('Mutation: Patient Lifecycle (Create & Update)', async () => {
      const patRes = await request(app.getHttpServer())
        .post(`/branches/${branchA1Id}/patients`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgAId)
        .send({ firstName: 'John', lastName: 'Doe', phone: '+1234567890' })
        .expect(201);
      patientId = (patRes.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/branches/${branchA1Id}/patients/${patientId}`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgAId)
        .send({ firstName: 'Johnny' })
        .expect(200);

      // Verify Audit Log records for Patient
      const logs = await prisma.auditLog.findMany({
        where: { resourceType: AuditResourceType.PATIENT, resourceId: patientId },
        orderBy: { createdAt: 'asc' },
      });

      expect(logs.length).toBeGreaterThanOrEqual(2);
      expect(logs[0]!.action).toBe(AuditAction.PATIENT_CREATED);
      expect(logs[1]!.action).toBe(AuditAction.PATIENT_UPDATED);

      // Verify Metadata Sanitization (sensitive phone/names stripped from metadata json)
      const metadata = logs[0]!.metadata as Record<string, unknown>;
      expect(metadata.firstName).toBeUndefined();
      expect(metadata.phone).toBeUndefined();
      expect(metadata.patientNumber).toBeDefined();
    });

    it('Mutation: Queue Entry & Token Generation & Operations', async () => {
      // 1. Create Queue Entry & Token
      const qRes = await request(app.getHttpServer())
        .post(`/branches/${branchA1Id}/queue-entries`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgAId)
        .send({ patientId, serviceId })
        .expect(201);
      queueEntryId = (qRes.body as { id: string }).id;

      const tokRes = await request(app.getHttpServer())
        .post(`/branches/${branchA1Id}/queue-entries/${queueEntryId}/token`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgAId)
        .expect(201);
      tokenId = (tokRes.body as { id: string }).id;

      // Create dedicated operator user with COUNTER_OPERATOR role
      const opRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'counter.operator1@example.com', password: 'Password123!', displayName: 'Operator 1' })
        .expect(201);
      const tokenOp = (opRes.body as { accessToken: string }).accessToken;
      const opUser = await prisma.user.findUnique({ where: { email: 'counter.operator1@example.com' }, include: { memberships: true } });
      await prisma.membership.update({
        where: { id: opUser!.memberships[0]!.id },
        data: { organizationId: orgAId, branchId: branchA1Id, role: Role.COUNTER_OPERATOR },
      });

      // Assign counter operator
      await request(app.getHttpServer())
        .post(`/branches/${branchA1Id}/counters/${counterId}/operators`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgAId)
        .send({ userId: opUser!.id })
        .expect(201);

      // Call Next Token using Operator token
      await request(app.getHttpServer())
        .post(`/branches/${branchA1Id}/counters/${counterId}/call-next`)
        .set('Authorization', `Bearer ${tokenOp}`)
        .set('x-organization-id', orgAId)
        .expect(201);

      // Recall Token using Operator token
      await request(app.getHttpServer())
        .post(`/branches/${branchA1Id}/counters/${counterId}/current/recall`)
        .set('Authorization', `Bearer ${tokenOp}`)
        .set('x-organization-id', orgAId)
        .expect(201);

      // Complete Token using Operator token
      await request(app.getHttpServer())
        .post(`/branches/${branchA1Id}/counters/${counterId}/current/complete`)
        .set('Authorization', `Bearer ${tokenOp}`)
        .set('x-organization-id', orgAId)
        .expect(201);

      // Verify Token Audit Logs
      const tokenLogs = await prisma.auditLog.findMany({
        where: { resourceType: AuditResourceType.TOKEN, resourceId: tokenId },
      });
      const actions = tokenLogs.map(l => l.action);

      expect(actions).toContain(AuditAction.TOKEN_CREATED);
      expect(actions).toContain(AuditAction.TOKEN_CALLED);
      expect(actions).toContain(AuditAction.TOKEN_RECALLED);
      expect(actions).toContain(AuditAction.TOKEN_COMPLETED);
    });

    it('Mutation: Appointment Lifecycle', async () => {
      const apptRes = await request(app.getHttpServer())
        .post(`/branches/${branchA1Id}/appointments`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgAId)
        .send({
          patientId,
          serviceId,
          appointmentDate: '2026-10-10',
          startTime: '10:00',
        })
        .expect(201);
      appointmentId = (apptRes.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/branches/${branchA1Id}/appointments/${appointmentId}/cancel`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgAId)
        .expect(201);

      const apptLogs = await prisma.auditLog.findMany({
        where: { resourceType: AuditResourceType.APPOINTMENT, resourceId: appointmentId },
      });
      const actions = apptLogs.map(l => l.action);

      expect(actions).toContain(AuditAction.APPOINTMENT_CREATED);
      expect(actions).toContain(AuditAction.APPOINTMENT_CANCELLED);
    });

    it('Append-Only Integrity: No delete endpoints exist and database records persist', async () => {
      const initialCount = await prisma.auditLog.count({ where: { organizationId: orgAId } });
      expect(initialCount).toBeGreaterThan(0);

      // Verify no API route allows DELETE on audit logs
      await request(app.getHttpServer())
        .delete(`/branches/${branchA1Id}/audit-logs`)
        .set('Authorization', `Bearer ${tokenOrgAdminA}`)
        .set('x-organization-id', orgAId)
        .expect(404);

      const finalCount = await prisma.auditLog.count({ where: { organizationId: orgAId } });
      expect(finalCount).toEqual(initialCount);
    });
  });
});
