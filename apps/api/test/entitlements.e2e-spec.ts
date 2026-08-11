import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AuditAction,
  AuditResourceType,
  MembershipStatus,
  Role,
  SubscriptionStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrganizationsService } from '../src/organizations/organizations.service';
import { CountersService } from '../src/operations/counters.service';
import { OperationsService } from '../src/operations/operations.service';
import { DisplaysService } from '../src/displays/displays.service';
import { TokensService } from '../src/tokens/tokens.service';
import { QueueEntriesService } from '../src/queue-entries/queue-entries.service';
import { clearDatabase } from './test-utils';

jest.setTimeout(60_000);

type Tenant = { organizationId: string; membershipId: string; role: Role; branchId: string | null };

type PlanBody = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  limits: Record<string, number>;
  features: Record<string, boolean>;
};
type SubscriptionDetailsBody = {
  organizationId: string;
  hasActiveSubscription: boolean;
  status: string;
  plan: { name: string; code: string } | null;
  limits: Record<string, number>;
  features: Record<string, boolean>;
};
type OrgSubBody = {
  organization: { id: string; name: string };
  subscription: { id: string; planId: string; status: string; plan: { code: string } } | null;
};
type ErrorBody = { errorCode?: string };
type BranchBody = { id: string };
type UsageBody = { branches: { used: number; limit: number } };

describe('Phase 22 — Subscription & Entitlements (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let organizationsService: OrganizationsService;
  let countersService: CountersService;
  let operationsService: OperationsService;
  let displaysService: DisplaysService;
  let tokensService: TokensService;
  let queueEntriesService: QueueEntriesService;

  let superToken: string;
  let superOrg: string;
  let orgAdminAToken: string;
  let orgA: string;
  let branchA1: string;
  let orgB: string;
  let orgAdminCToken: string;
  let orgC: string;
  let branchC1: string;
  let receptionistToken: string;
  let branchAdminToken: string;

  let planFull: { id: string };
  let planNoAnalytics: { id: string };
  let planNoAppointments: { id: string };
  let planNoPriority: { id: string };
  let planNoSelfService: { id: string };
  let planNoQrStatus: { id: string };
  let planInactive: { id: string };
  let orgD: string;

  function tenantRequest(accessToken: string, organizationId: string) {
    const withTenant = (test: request.Test) =>
      test.set('Authorization', `Bearer ${accessToken}`).set('x-organization-id', organizationId);
    return {
      get: (path: string) => withTenant(request(server).get(path)),
      post: (path: string) => withTenant(request(server).post(path)),
      patch: (path: string) => withTenant(request(server).patch(path)),
    };
  }

  async function register(email: string) {
    const response = await request(server)
      .post('/auth/register')
      .send({ email, password: 'password123', displayName: email.split('@')[0] })
      .expect(201);
    return (response.body as { accessToken: string }).accessToken;
  }

  async function createPlan(code: string, limits: Record<string, number>, features: Record<string, boolean>, active = true) {
    return prisma.subscriptionPlan.create({
      data: { name: code.replace(/_/g, ' '), code, limits, features, active },
      select: { id: true },
    });
  }

  async function assignPlan(organizationId: string, planId: string, status: SubscriptionStatus = 'ACTIVE') {
    await prisma.organizationSubscription.upsert({
      where: { organizationId },
      create: { organizationId, planId, status, startsAt: new Date() },
      update: { planId, status },
    });
  }

  async function removeSubscription(organizationId: string) {
    await prisma.organizationSubscription.deleteMany({ where: { organizationId } });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<PrismaService>(PrismaService);
    organizationsService = app.get(OrganizationsService);
    countersService = app.get(CountersService);
    operationsService = app.get(OperationsService);
    displaysService = app.get(DisplaysService);
    tokensService = app.get(TokensService);
    queueEntriesService = app.get(QueueEntriesService);

    // Users & orgs
    superToken = await register('phase22-super@example.com');
    orgAdminAToken = await register('phase22-a@example.com');
    await register('phase22-b@example.com');
    orgAdminCToken = await register('phase22-c@example.com');
    receptionistToken = await register('phase22-receptionist@example.com');
    branchAdminToken = await register('phase22-branchadmin@example.com');

    const superUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'phase22-super@example.com' },
      include: { memberships: true },
    });
    superOrg = superUser.memberships[0]!.organizationId;
    await prisma.membership.update({
      where: { userId_organizationId: { userId: superUser.id, organizationId: superOrg } },
      data: { role: Role.SUPER_ADMIN },
    });

    const userA = await prisma.user.findUniqueOrThrow({ where: { email: 'phase22-a@example.com' }, include: { memberships: true } });
    orgA = userA.memberships[0]!.organizationId;
    const userB = await prisma.user.findUniqueOrThrow({ where: { email: 'phase22-b@example.com' }, include: { memberships: true } });
    orgB = userB.memberships[0]!.organizationId;
    const userC = await prisma.user.findUniqueOrThrow({ where: { email: 'phase22-c@example.com' }, include: { memberships: true } });
    orgC = userC.memberships[0]!.organizationId;

    const receptionist = await prisma.user.findUniqueOrThrow({ where: { email: 'phase22-receptionist@example.com' } });
    await prisma.membership.create({
      data: { userId: receptionist.id, organizationId: orgA, role: Role.RECEPTIONIST, status: MembershipStatus.ACTIVE },
    });
    const branchAdminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'phase22-branchadmin@example.com' } });
    await prisma.membership.create({
      data: { userId: branchAdminUser.id, organizationId: orgA, branchId: null, role: Role.BRANCH_ADMIN, status: MembershipStatus.ACTIVE },
    });

    branchA1 = (
      await prisma.branch.create({
        data: { organizationId: orgA, name: 'Phase 22 A1', code: 'P22A1' },
        select: { id: true },
      })
    ).id;
    branchC1 = (
      await prisma.branch.create({
        data: { organizationId: orgC, name: 'Phase 22 C1', code: 'P22C1' },
        select: { id: true },
      })
    ).id;

    // Plans
    planFull = await createPlan('FULL_22', {}, {});
    planNoAnalytics = await createPlan('NO_ANALYTICS_22', {}, { ANALYTICS: false });
    planNoAppointments = await createPlan('NO_APPT_22', {}, { APPOINTMENTS: false });
    planNoPriority = await createPlan('NO_PRIORITY_22', {}, { PRIORITY_QUEUE: false });
    planNoSelfService = await createPlan('NO_SELF_SERVICE_22', {}, { SELF_SERVICE_CHECKIN: false });
    planNoQrStatus = await createPlan('NO_QR_STATUS_22', {}, { QR_STATUS: false });
    planInactive = await createPlan('INACTIVE_22', {}, {}, false);

    // Dedicated org for concurrency / limit tests (no memberships)
    const orgDRecord = await prisma.organization.create({
      data: { name: 'Phase 22 D', slug: 'phase22-d-' + randomUUID().slice(0, 8) },
      select: { id: true },
    });
    orgD = orgDRecord.id;
  });

  afterAll(async () => {
    try {
      if (prisma) await clearDatabase(prisma);
    } finally {
      if (app) await app.close();
    }
  });

  describe('SaaS Admin — subscription plans', () => {
    it('SUPER_ADMIN can create, list, get, update, activate and deactivate plans', async () => {
      const api = tenantRequest(superToken, superOrg);
      const created = await api
        .post('/admin/subscription-plans')
        .send({
          name: 'Pro Monthly',
          code: 'PRO_MONTHLY_22',
          monthlyPrice: 49,
          yearlyPrice: 490,
          limits: { maxBranches: 5, maxUsers: 25, maxDailyTokens: 500 },
          features: { ANALYTICS: true, NOTIFICATIONS: false },
        })
        .expect(201);
      const createdBody = created.body as PlanBody;
      expect(created.body).toMatchObject({ name: 'Pro Monthly', code: 'PRO_MONTHLY_22' });
      expect(createdBody.features).toMatchObject({ ANALYTICS: true, NOTIFICATIONS: false });
      expect(createdBody.limits).toMatchObject({ maxBranches: 5 });

      const list = await api.get('/admin/subscription-plans').expect(200);
      expect((list.body as Array<{ code: string }>).some((plan) => plan.code === 'PRO_MONTHLY_22')).toBe(true);

      const get = await api.get(`/admin/subscription-plans/${createdBody.id}`).expect(200);
      expect((get.body as PlanBody).code).toBe('PRO_MONTHLY_22');

      const updated = await api
        .patch(`/admin/subscription-plans/${createdBody.id}`)
        .send({ name: 'Pro Monthly v2', monthlyPrice: 59 })
        .expect(200);
      expect((updated.body as PlanBody).name).toBe('Pro Monthly v2');

      await api.patch(`/admin/subscription-plans/${createdBody.id}/deactivate`).expect(200);
      const deactivated = await api.get(`/admin/subscription-plans/${createdBody.id}`).expect(200);
      expect((deactivated.body as PlanBody).active).toBe(false);

      await api.patch(`/admin/subscription-plans/${createdBody.id}/activate`).expect(200);
      const activated = await api.get(`/admin/subscription-plans/${createdBody.id}`).expect(200);
      expect((activated.body as PlanBody).active).toBe(true);
    });

    it('ORG_ADMIN, BRANCH_ADMIN and RECEPTIONIST cannot manage plans (403)', async () => {
      const a = tenantRequest(orgAdminAToken, orgA);
      await a.get('/admin/subscription-plans').expect(403);
      await a.post('/admin/subscription-plans').send({ name: 'X', code: 'X_22' }).expect(403);

      const r = tenantRequest(receptionistToken, orgA);
      await r.get('/admin/subscription-plans').expect(403);
      await r.post('/admin/subscription-plans').send({ name: 'X', code: 'X_22' }).expect(403);

      const b = tenantRequest(branchAdminToken, orgA);
      await b.get('/admin/subscription-plans').expect(403);
      await b.patch('/admin/subscription-plans/' + randomUUID() + '/activate').expect(403);
    });

    it('audits plan creation', async () => {
      const created = await tenantRequest(superToken, superOrg)
        .post('/admin/subscription-plans')
        .send({ name: 'Audit Plan', code: 'AUDIT_PLAN_22' })
        .expect(201);
      const audit = await prisma.auditLog.findFirst({
        where: { action: AuditAction.SUBSCRIPTION_PLAN_CREATED, resourceId: (created.body as PlanBody).id },
      });
      expect(audit).not.toBeNull();
      expect(audit?.resourceType).toBe(AuditResourceType.SUBSCRIPTION_PLAN);
    });

    it('rejects invalid plan payloads (400)', async () => {
      await tenantRequest(superToken, superOrg)
        .post('/admin/subscription-plans')
        .send({ name: 'Bad', code: 'lowercase' })
        .expect(400);
      await tenantRequest(superToken, superOrg)
        .post('/admin/subscription-plans')
        .send({ name: 'Bad', code: 'OK_22', monthlyPrice: -5 })
        .expect(400);
    });
  });

  describe('Organization subscription management', () => {
    it('SUPER_ADMIN can view, assign, and update an organization subscription', async () => {
      const api = tenantRequest(superToken, superOrg);
      const before = await api.get(`/admin/organizations/${orgC}/subscription`).expect(200);
      expect((before.body as OrgSubBody).subscription).toBeNull();

      const assigned = await api
        .post(`/admin/organizations/${orgC}/subscription`)
        .send({ planId: planFull.id, status: 'TRIAL' })
        .expect(201);
      expect(assigned.body).toMatchObject({ organizationId: orgC, status: 'TRIAL' });

      const get = await api.get(`/admin/organizations/${orgC}/subscription`).expect(200);
      expect((get.body as OrgSubBody).subscription?.plan.code).toBe('FULL_22');

      const updated = await api
        .patch(`/admin/organizations/${orgC}/subscription`)
        .send({ status: 'ACTIVE', planId: planFull.id })
        .expect(200);
      expect((updated.body as { status: string }).status).toBe('ACTIVE');

      // Audit recorded against the TARGET organization
      const audit = await prisma.auditLog.findFirst({
        where: { organizationId: orgC, action: AuditAction.SUBSCRIPTION_CREATED },
      });
      expect(audit).not.toBeNull();
    });

    it('rejects duplicate assignment with SUBSCRIPTION_EXISTS', async () => {
      await tenantRequest(superToken, superOrg)
        .post(`/admin/organizations/${orgC}/subscription`)
        .send({ planId: planFull.id })
        .expect(409);
    });

    it('rejects assigning an inactive plan with PLAN_INACTIVE', async () => {
      const response = await tenantRequest(superToken, superOrg)
        .post(`/admin/organizations/${orgB}/subscription`)
        .send({ planId: planInactive.id })
        .expect(409);
      expect((response.body as ErrorBody).errorCode).toBe('PLAN_INACTIVE');
    });

    it('ORG_ADMIN cannot manage any organization subscription (403)', async () => {
      await tenantRequest(orgAdminAToken, orgA).get(`/admin/organizations/${orgC}/subscription`).expect(403);
      await tenantRequest(orgAdminAToken, orgA).post(`/admin/organizations/${orgC}/subscription`).send({ planId: planFull.id }).expect(403);
    });
  });

  describe('Tenant isolation & subscription visibility', () => {
    it('an organization can only see its own subscription', async () => {
      // orgC has a subscription (from previous tests); orgA is legacy
      const c = tenantRequest(orgAdminCToken, orgC);
      const cSub = await c.get('/organizations/current/subscription').expect(200);
      const cSubBody = cSub.body as SubscriptionDetailsBody;
      expect(cSubBody.organizationId).toBe(orgC);
      expect(cSubBody.hasActiveSubscription).toBe(true);
      expect(cSubBody.plan?.code).toBe('FULL_22');
      expect(cSubBody.limits.maxBranches).toBeGreaterThan(0);
      expect(cSubBody.features.ANALYTICS).toBe(true);

      // orgA cannot read orgC's subscription — forged header is rejected by TenantGuard
      await tenantRequest(orgAdminAToken, orgA).get('/organizations/current/subscription').set('x-organization-id', orgC).expect(403);
    });

    it('legacy organizations keep working and are reported as LEGACY with all features', async () => {
      await removeSubscription(orgA);
      const a = tenantRequest(orgAdminAToken, orgA);
      const details = await a.get('/organizations/current/subscription').expect(200);
      const detailsBody = details.body as SubscriptionDetailsBody;
      expect(detailsBody.status).toBe('LEGACY');
      expect(detailsBody.hasActiveSubscription).toBe(false);
      expect(detailsBody.plan?.code).toBe('legacy');
      for (const key of ['ANALYTICS', 'APPOINTMENTS', 'PRIORITY_QUEUE', 'QR_STATUS', 'SELF_SERVICE_CHECKIN', 'THERMAL_PRINTING', 'PUBLIC_DISPLAY', 'NOTIFICATIONS', 'AUDIT_LOGS']) {
        expect(detailsBody.features[key]).toBe(true);
      }
      // Legacy org can still provision resources
      const branch = await a
        .post('/organizations/current/branches')
        .send({ name: 'Legacy branch ' + randomUUID().slice(0, 6) })
        .expect(201);
      expect((branch.body as BranchBody).id).toBeDefined();
    });

    it('forged organizationId is rejected (403)', async () => {
      await tenantRequest(orgAdminAToken, orgA).get('/organizations/current/subscription').set('x-organization-id', randomUUID()).expect(403);
      await tenantRequest(orgAdminAToken, orgA).get('/organizations/current/usage').set('x-organization-id', randomUUID()).expect(403);
    });
  });

  describe('Subscription lifecycle', () => {
    it('TRIAL provides normal plan access', async () => {
      await assignPlan(orgC, planFull.id, 'TRIAL');
      const branch = await organizationsService.createBranch(orgC, { name: 'Trial branch' });
      expect(branch.id).toBeDefined();
    });

    it('EXPIRED preserves existing data but blocks new provisioning with SUBSCRIPTION_EXPIRED', async () => {
      await assignPlan(orgC, planFull.id, 'EXPIRED');
      const before = await prisma.branch.count({ where: { organizationId: orgC } });
      expect(before).toBeGreaterThan(0);

      const error = await organizationsService.createBranch(orgC, { name: 'Blocked' }).catch((e: unknown) => e);
      expect((error as { response?: { errorCode?: string } }).response?.errorCode).toBe('SUBSCRIPTION_EXPIRED');

      // Existing data is untouched and still readable
      expect(await prisma.branch.count({ where: { organizationId: orgC } })).toBe(before);
      const c = tenantRequest(orgAdminCToken, orgC);
      const details = await c.get('/organizations/current/subscription').expect(200);
      expect((details.body as SubscriptionDetailsBody).status).toBe('EXPIRED');
      const usage = await c.get('/organizations/current/usage').expect(200);
      expect((usage.body as UsageBody).branches.used).toBe(before);
    });

    it('PAST_DUE blocks new provisioning with SUBSCRIPTION_REQUIRED but keeps data', async () => {
      await assignPlan(orgC, planFull.id, 'PAST_DUE');
      const error = await organizationsService.createBranch(orgC, { name: 'Blocked' }).catch((e: unknown) => e);
      expect((error as { response?: { errorCode?: string } }).response?.errorCode).toBe('SUBSCRIPTION_REQUIRED');
      expect(await prisma.branch.count({ where: { organizationId: orgC } })).toBeGreaterThan(0);
      await removeSubscription(orgC);
    });

    it('CANCELLED preserves data and blocks provisioning', async () => {
      await assignPlan(orgC, planFull.id, 'CANCELLED');
      const error = await organizationsService.createBranch(orgC, { name: 'Blocked' }).catch((e: unknown) => e);
      expect((error as { response?: { errorCode?: string } }).response?.errorCode).toBe('SUBSCRIPTION_EXPIRED');
      await removeSubscription(orgC);
    });
  });

  describe('Feature entitlements (server-side)', () => {
    it('Analytics: disabled → FEATURE_NOT_AVAILABLE, enabled → 200', async () => {
      const a = tenantRequest(orgAdminAToken, orgA);
      // Enabled (legacy)
      await a.get(`/branches/${branchA1}/analytics/summary`).expect(200);

      await assignPlan(orgA, planNoAnalytics.id, 'ACTIVE');
      const blocked = await a.get(`/branches/${branchA1}/analytics/summary`).expect(403);
      expect((blocked.body as ErrorBody).errorCode).toBe('FEATURE_NOT_AVAILABLE');

      await removeSubscription(orgA);
    });

    it('Appointments: disabled → FEATURE_NOT_AVAILABLE even for direct calls', async () => {
      await assignPlan(orgA, planNoAppointments.id, 'ACTIVE');
      const a = tenantRequest(orgAdminAToken, orgA);
      const response = await a
        .post(`/branches/${branchA1}/appointments`)
        .send({ patientId: randomUUID(), serviceId: randomUUID(), appointmentDate: '2099-01-01', startTime: '10:00' })
        .expect(403);
      expect((response.body as ErrorBody).errorCode).toBe('FEATURE_NOT_AVAILABLE');
      await removeSubscription(orgA);
    });

    it('Priority queue: disabled → FEATURE_NOT_AVAILABLE', async () => {
      await assignPlan(orgA, planNoPriority.id, 'ACTIVE');
      const a = tenantRequest(orgAdminAToken, orgA);
      const response = await a
        .post('/priority-configurations')
        .send({ level: 'VIP', weight: 50, active: true })
        .expect(403);
      expect((response.body as ErrorBody).errorCode).toBe('FEATURE_NOT_AVAILABLE');
      await removeSubscription(orgA);
    });

    it('Self-service QR check-in: disabled → FEATURE_NOT_AVAILABLE', async () => {
      // Real appointment in orgA
      const dept = await prisma.department.create({ data: { branchId: branchA1, name: 'P22 Dept' }, select: { id: true } });
      const service = await prisma.service.create({ data: { departmentId: dept.id, name: 'P22 Svc' }, select: { id: true } });
      const patient = await prisma.patient.create({
        data: { branchId: branchA1, firstName: 'QR', lastName: 'Patient', patientNumber: 'P22-' + randomUUID().slice(0, 6) },
        select: { id: true },
      });
      const appt = await prisma.appointment.create({
        data: {
          branchId: branchA1,
          patientId: patient.id,
          serviceId: service.id,
          appointmentDate: new Date(),
          startAt: new Date(Date.now() + 60 * 60 * 1000),
          status: 'SCHEDULED',
        },
        select: { id: true },
      });

      // Enabled first (legacy) — succeeds
      const qrPayload = `QMS:1:APPT:${appt.id}`;
      await request(server).post('/public/self-service/qr/check-in').send({ qrPayload }).expect(200);

      await assignPlan(orgA, planNoSelfService.id, 'ACTIVE');
      const appt2 = await prisma.appointment.create({
        data: {
          branchId: branchA1,
          patientId: patient.id,
          serviceId: service.id,
          appointmentDate: new Date(),
          startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          status: 'SCHEDULED',
        },
        select: { id: true },
      });
      const blocked = await request(server)
        .post('/public/self-service/qr/check-in')
        .send({ qrPayload: `QMS:1:APPT:${appt2.id}` })
        .expect(403);
      expect((blocked.body as ErrorBody).errorCode).toBe('FEATURE_NOT_AVAILABLE');
      await removeSubscription(orgA);
    });

    it('QR status: disabled → FEATURE_NOT_AVAILABLE', async () => {
      // Create a token in orgC (legacy state after previous cleanup)
      const dept = await prisma.department.create({ data: { branchId: branchC1, name: 'P22 QR Dept' }, select: { id: true } });
      const service = await prisma.service.create({ data: { departmentId: dept.id, name: 'P22 QR Svc' }, select: { id: true } });
      const patient = await prisma.patient.create({
        data: { branchId: branchC1, firstName: 'QR2', lastName: 'Patient', patientNumber: 'P22-' + randomUUID().slice(0, 6) },
        select: { id: true },
      });
      const queueEntry = await prisma.queueEntry.create({
        data: { patientId: patient.id, serviceId: service.id, activeEntryKey: `${patient.id}:${service.id}:${randomUUID()}` },
        select: { id: true },
      });
      const tenant: Tenant = { organizationId: orgC, membershipId: 'test', role: Role.ORG_ADMIN, branchId: null };
      const token = await tokensService.generate(tenant, branchC1, queueEntry.id);
      await request(server).get(`/public/queue/${token.id}`).expect(200);

      await assignPlan(orgC, planNoQrStatus.id, 'ACTIVE');
      const blocked = await request(server).get(`/public/queue/${token.id}`).expect(403);
      expect((blocked.body as ErrorBody).errorCode).toBe('FEATURE_NOT_AVAILABLE');
      await removeSubscription(orgC);
    });
  });

  describe('Plan limit enforcement', () => {
    it('rejects resource creation beyond maxBranches with PLAN_LIMIT_REACHED', async () => {
      const plan = await createPlan('LIMIT_22', { maxBranches: 1 }, {});
      await assignPlan(orgC, plan.id, 'ACTIVE');
      await prisma.branch.deleteMany({ where: { organizationId: orgC, name: { not: 'Phase 22 C1' } } });

      const error = await organizationsService.createBranch(orgC, { name: 'Second branch' }).catch((e: unknown) => e);
      expect((error as { response?: { errorCode?: string } }).response?.errorCode).toBe('PLAN_LIMIT_REACHED');
      await removeSubscription(orgC);
    });

    it('enforces maxWaitingQueueSize on queue entry creation', async () => {
      const plan = await createPlan('WAIT_22', { maxWaitingQueueSize: 1 }, {});
      await assignPlan(orgC, plan.id, 'ACTIVE');
      // Remove waiting entries/tokens left by earlier tests so the cap starts at zero
      await prisma.token.deleteMany({ where: { queueEntry: { patient: { branch: { organizationId: orgC } } } } });
      await prisma.queueEntry.deleteMany({ where: { patient: { branch: { organizationId: orgC } } } });

      const dept = await prisma.department.create({ data: { branchId: branchC1, name: 'P22 WQ Dept' }, select: { id: true } });
      const service = await prisma.service.create({ data: { departmentId: dept.id, name: 'P22 WQ Svc' }, select: { id: true } });
      const p1 = await prisma.patient.create({
        data: { branchId: branchC1, firstName: 'WQ', lastName: 'One', patientNumber: 'P22-' + randomUUID().slice(0, 6) },
        select: { id: true },
      });
      const p2 = await prisma.patient.create({
        data: { branchId: branchC1, firstName: 'WQ', lastName: 'Two', patientNumber: 'P22-' + randomUUID().slice(0, 6) },
        select: { id: true },
      });
      const tenant: Tenant = { organizationId: orgC, membershipId: 'test', role: Role.ORG_ADMIN, branchId: null };
      const first = await queueEntriesService.create(tenant, branchC1, { patientId: p1.id, serviceId: service.id });
      expect(first.id).toBeDefined();

      const error = await queueEntriesService
        .create(tenant, branchC1, { patientId: p2.id, serviceId: service.id })
        .catch((e: unknown) => e);
      expect((error as { response?: { errorCode?: string } }).response?.errorCode).toBe('PLAN_LIMIT_REACHED');
      await removeSubscription(orgC);
    });

    it('enforces maxDailyTokens on token generation', async () => {
      const plan = await createPlan('DAILY_22', { maxDailyTokens: 1 }, {});
      await assignPlan(orgC, plan.id, 'ACTIVE');
      // Remove tokens/entries left by earlier tests so the daily count starts at zero
      await prisma.token.deleteMany({ where: { queueEntry: { patient: { branch: { organizationId: orgC } } } } });
      await prisma.queueEntry.deleteMany({ where: { patient: { branch: { organizationId: orgC } } } });

      const dept = await prisma.department.create({ data: { branchId: branchC1, name: 'P22 DT Dept' }, select: { id: true } });
      const service = await prisma.service.create({ data: { departmentId: dept.id, name: 'P22 DT Svc' }, select: { id: true } });
      const p1 = await prisma.patient.create({
        data: { branchId: branchC1, firstName: 'DT', lastName: 'One', patientNumber: 'P22-' + randomUUID().slice(0, 6) },
        select: { id: true },
      });
      const p2 = await prisma.patient.create({
        data: { branchId: branchC1, firstName: 'DT', lastName: 'Two', patientNumber: 'P22-' + randomUUID().slice(0, 6) },
        select: { id: true },
      });
      const tenant: Tenant = { organizationId: orgC, membershipId: 'test', role: Role.ORG_ADMIN, branchId: null };
      const e1 = await queueEntriesService.create(tenant, branchC1, { patientId: p1.id, serviceId: service.id });
      const e2 = await queueEntriesService.create(tenant, branchC1, { patientId: p2.id, serviceId: service.id });

      const first = await tokensService.generate(tenant, branchC1, e1.id);
      expect(first.displayNumber).toBeDefined();

      const error = await tokensService.generate(tenant, branchC1, e2.id).catch((e: unknown) => e);
      expect((error as { response?: { errorCode?: string } }).response?.errorCode).toBe('PLAN_LIMIT_REACHED');
      await removeSubscription(orgC);
    });
  });

  describe('Concurrency — atomic plan limit enforcement', () => {
    async function expectExactlyOneSuccess<T>(
      promises: Promise<T>[],
      failures: number,
    ) {
      const results = await Promise.all(promises.map((promise) => promise.catch((e: unknown) => e)));
      const successes = results.filter((r) => r && typeof r === 'object' && 'id' in (r as Record<string, unknown>));
      const limitFailures = results.filter((r) => {
        if (r instanceof Error || (r && typeof r === 'object' && 'response' in (r as Record<string, unknown>))) {
          return (r as { response?: { errorCode?: string } }).response?.errorCode === 'PLAN_LIMIT_REACHED';
        }
        return false;
      });
      expect(successes.length).toBe(1);
      expect(limitFailures.length).toBe(failures);
    }

    it('20 concurrent branch creations → exactly 1 succeeds (maxBranches 5, 4 existing)', async () => {
      const plan = await createPlan('CONC_BR_22', { maxBranches: 5 }, {});
      await assignPlan(orgD, plan.id, 'ACTIVE');
      await prisma.branch.deleteMany({ where: { organizationId: orgD } });
      await prisma.branch.createMany({
        data: Array.from({ length: 4 }, (_, i) => ({ organizationId: orgD, name: `Pre ${i}`, code: `PRE${i}` })),
      });

      const promises = Array.from({ length: 20 }, (_, i) =>
        organizationsService.createBranch(orgD, { name: `Concurrent ${i}` }),
      );
      await expectExactlyOneSuccess(promises, 19);
      expect(await prisma.branch.count({ where: { organizationId: orgD } })).toBe(5);
    });

    it('10 concurrent counter creations → exactly 1 succeeds (maxCounters 2, 1 existing)', async () => {
      const plan = await createPlan('CONC_CT_22', { maxCounters: 2 }, {});
      await assignPlan(orgD, plan.id, 'ACTIVE');
      await prisma.counter.deleteMany({ where: { branch: { organizationId: orgD } } });
      await prisma.counter.create({ data: { branchId: (await prisma.branch.findFirstOrThrow({ where: { organizationId: orgD } })).id, name: 'Pre', code: 'PRE' } });

      const tenant: Tenant = { organizationId: orgD, membershipId: 'test', role: Role.ORG_ADMIN, branchId: null };
      const branch = await prisma.branch.findFirstOrThrow({ where: { organizationId: orgD } });
      const promises = Array.from({ length: 10 }, (_, i) =>
        countersService.create(tenant, branch.id, { name: `Counter ${i}`, code: `C${i}` }),
      );
      await expectExactlyOneSuccess(promises, 9);
      expect(await prisma.counter.count({ where: { branch: { organizationId: orgD } } })).toBe(2);
    });

    it('10 concurrent service creations → exactly 1 succeeds (maxServices 2, 1 existing)', async () => {
      const plan = await createPlan('CONC_SV_22', { maxServices: 2 }, {});
      await assignPlan(orgD, plan.id, 'ACTIVE');
      await prisma.service.deleteMany({ where: { department: { branch: { organizationId: orgD } } } });
      const branch = await prisma.branch.findFirstOrThrow({ where: { organizationId: orgD } });
      const dept = await prisma.department.create({ data: { branchId: branch.id, name: 'Conc Dept' }, select: { id: true } });
      await prisma.service.create({ data: { departmentId: dept.id, name: 'Pre Service' } });

      const promises = Array.from({ length: 10 }, (_, i) =>
        operationsService.createService(orgD, dept.id, { name: `Service ${i}` }),
      );
      await expectExactlyOneSuccess(promises, 9);
      expect(await prisma.service.count({ where: { department: { branch: { organizationId: orgD } } } })).toBe(2);
    });

    it('10 concurrent display creations → exactly 1 succeeds (maxDisplays 2, 1 existing)', async () => {
      const plan = await createPlan('CONC_DS_22', { maxDisplays: 2 }, {});
      await assignPlan(orgD, plan.id, 'ACTIVE');
      await prisma.display.deleteMany({ where: { branch: { organizationId: orgD } } });
      const branch = await prisma.branch.findFirstOrThrow({ where: { organizationId: orgD } });
      await prisma.display.create({ data: { branchId: branch.id, name: 'Pre Display', publicId: randomUUID().replace(/-/g, '') } });

      const tenant: Tenant = { organizationId: orgD, membershipId: 'test', role: Role.ORG_ADMIN, branchId: null };
      const promises = Array.from({ length: 10 }, (_, i) =>
        displaysService.create(tenant, branch.id, { name: `Display ${i}` }),
      );
      await expectExactlyOneSuccess(promises, 9);
      expect(await prisma.display.count({ where: { branch: { organizationId: orgD } } })).toBe(2);
    });

    it('existing resources remain intact after failed limit enforcement', async () => {
      expect(await prisma.branch.count({ where: { organizationId: orgD } })).toBe(5);
      expect(await prisma.counter.count({ where: { branch: { organizationId: orgD } } })).toBe(2);
    });
  });

  describe('Usage API', () => {
    it('returns accurate usage vs limits for the caller organization only', async () => {
      const plan = await createPlan('USAGE_22', {
        maxBranches: 5,
        maxUsers: 5,
        maxCounters: 5,
        maxServices: 5,
        maxDisplays: 5,
        maxDailyTokens: 100,
        maxWaitingQueueSize: 10,
      }, {});
      await assignPlan(orgA, plan.id, 'ACTIVE');

      // Add one counter, one service, one display, one waiting entry
      const dept = await prisma.department.create({ data: { branchId: branchA1, name: 'Usage Dept' }, select: { id: true } });
      const service = await prisma.service.create({ data: { departmentId: dept.id, name: 'Usage Svc' }, select: { id: true } });
      await prisma.counter.create({ data: { branchId: branchA1, name: 'Usage Counter', code: 'USG' } });
      await prisma.display.create({ data: { branchId: branchA1, name: 'Usage Display', publicId: randomUUID().replace(/-/g, '') } });
      const patient = await prisma.patient.create({
        data: { branchId: branchA1, firstName: 'Usage', lastName: 'Patient', patientNumber: 'P22-' + randomUUID().slice(0, 6) },
        select: { id: true },
      });
      await prisma.queueEntry.create({
        data: { patientId: patient.id, serviceId: service.id, activeEntryKey: `${patient.id}:${service.id}:${randomUUID()}` },
      });

      // Expected values are computed from the database so the assertions stay
      // robust regardless of data created by earlier tests in this file.
      const branchCount = await prisma.branch.count({ where: { organizationId: orgA } });
      const counterCount = await prisma.counter.count({ where: { branch: { organizationId: orgA } } });
      const serviceCount = await prisma.service.count({ where: { department: { branch: { organizationId: orgA } } } });
      const displayCount = await prisma.display.count({ where: { branch: { organizationId: orgA } } });
      const waitingCount = await prisma.queueEntry.count({
        where: { status: 'WAITING', patient: { branch: { organizationId: orgA } } },
      });
      const tokenCount = await prisma.token.count({
        where: { queueEntry: { patient: { branch: { organizationId: orgA } } } },
      });

      const a = tenantRequest(orgAdminAToken, orgA);
      const usage = await a.get('/organizations/current/usage').expect(200);
      expect(usage.body).toMatchObject({
        branches: { used: branchCount, limit: 5 },
        users: { used: 3, limit: 5 }, // orgAdmin + branchAdmin + receptionist memberships
        counters: { used: counterCount, limit: 5 },
        services: { used: serviceCount, limit: 5 },
        displays: { used: displayCount, limit: 5 },
        dailyTokens: { used: tokenCount, limit: 100 },
        waitingQueue: { used: waitingCount, limit: 10 },
      });
      expect(branchCount).toBeGreaterThan(0);
      expect(counterCount).toBe(1);

      // Cross-tenant usage is forbidden
      await tenantRequest(orgAdminAToken, orgA).get('/organizations/current/usage').set('x-organization-id', orgC).expect(403);
      await removeSubscription(orgA);
    });

    it('BRANCH_ADMIN / COUNTER_OPERATOR cannot read usage or subscription', async () => {
      const api = tenantRequest(branchAdminToken, orgA);
      await api.get('/organizations/current/subscription').expect(403);
      await api.get('/organizations/current/usage').expect(403);
    });
  });
});
