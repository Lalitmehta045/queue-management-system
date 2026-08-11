import { clearDatabase } from './test-utils';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppointmentStatus, TokenStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { Server } from 'http';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface SummaryResponse {
  totalPatients: number;
  totalQueueEntries: number;
  waitingQueueCount: number;
  cancelledQueueCount: number;
  tokensIssued: number;
  tokensCalled: number;
  tokensServing: number;
  tokensCompleted: number;
  tokensSkipped: number;
  tokensCancelled: number;
  currentlyServing: number;
  avgWaitingTimeSeconds: number | null;
  avgServiceTimeSeconds: number | null;
  avgHandlingTimeSeconds: number | null;
  completionRate: number;
  cancellationRate: number;
  skipRate: number;
}

describe('Analytics Data Correctness (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  let adminToken: string;
  let orgId: string;
  let branchId: string;
  let departmentId: string;
  let serviceAId: string;
  let serviceBId: string;
  let counterId: string;

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

    adminToken = await register('analytics-data-admin@example.com');
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'analytics-data-admin@example.com' }, include: { memberships: true } });
    orgId = admin.memberships[0]!.organizationId;

    branchId = ((await tenantRequest(adminToken, orgId).post('/organizations/current/branches').send({ name: 'Analytics Data Branch', code: 'ADB1' }).expect(201)).body as { id: string }).id;

    departmentId = ((await tenantRequest(adminToken, orgId).post(`/branches/${branchId}/departments`).send({ name: 'Analytics Dept' }).expect(201)).body as { id: string }).id;
    serviceAId = ((await tenantRequest(adminToken, orgId).post(`/departments/${departmentId}/services`).send({ name: 'Service A' }).expect(201)).body as { id: string }).id;
    serviceBId = ((await tenantRequest(adminToken, orgId).post(`/departments/${departmentId}/services`).send({ name: 'Service B' }).expect(201)).body as { id: string }).id;
    counterId = ((await tenantRequest(adminToken, orgId).post(`/branches/${branchId}/counters`).send({ name: 'Analytics Counter', code: 'AC1' }).expect(201)).body as { id: string }).id;

    await seedTestData();
  }, 30000);

  async function seedTestData() {
    const businessDate1 = new Date('2026-01-15T00:00:00.000Z');
    const businessDate2 = new Date('2026-01-16T00:00:00.000Z');

    const seq1 = await prisma.tokenSequence.create({
      data: { branchId, serviceId: serviceAId, businessDate: businessDate1, nextNumber: 100 },
    });
    const seq2 = await prisma.tokenSequence.create({
      data: { branchId, serviceId: serviceAId, businessDate: businessDate2, nextNumber: 100 },
    });
    const seq3 = await prisma.tokenSequence.create({
      data: { branchId, serviceId: serviceBId, businessDate: businessDate1, nextNumber: 100 },
    });

    const patient1 = await prisma.patient.create({
      data: { branchId, patientNumber: 'ANP001', firstName: 'Data', lastName: 'Patient1' },
    });
    const patient2 = await prisma.patient.create({
      data: { branchId, patientNumber: 'ANP002', firstName: 'Data', lastName: 'Patient2' },
    });
    const patient3 = await prisma.patient.create({
      data: { branchId, patientNumber: 'ANP003', firstName: 'Data', lastName: 'Patient3' },
    });
    const patient4 = await prisma.patient.create({
      data: { branchId, patientNumber: 'ANP004', firstName: 'Data', lastName: 'Patient4' },
    });
    const patient5 = await prisma.patient.create({
      data: { branchId, patientNumber: 'ANP005', firstName: 'Data', lastName: 'Patient5' },
    });
    const patient6 = await prisma.patient.create({
      data: { branchId, patientNumber: 'ANP006', firstName: 'Data', lastName: 'Patient6' },
    });
    const patient7 = await prisma.patient.create({
      data: { branchId, patientNumber: 'ANP007', firstName: 'Data', lastName: 'Patient7' },
    });

    // Day 1: Service A — 5 tokens
    // Token 1: COMPLETED (waiting: 60s, service: 120s)
    const qe1 = await prisma.queueEntry.create({
      data: { patientId: patient1.id, serviceId: serviceAId, status: 'WAITING' },
    });
    await prisma.token.create({
      data: {
        queueEntryId: qe1.id, sequenceId: seq1.id, counterId,
        sequenceNumber: 1, displayNumber: 'A-001', businessDate: businessDate1,
        status: TokenStatus.COMPLETED,
        issuedAt: new Date('2026-01-15T09:00:00Z'),
        calledAt: new Date('2026-01-15T09:01:00Z'),
        servingAt: new Date('2026-01-15T09:02:00Z'),
        completedAt: new Date('2026-01-15T09:04:00Z'),
      },
    });

    // Token 2: COMPLETED (waiting: 120s, service: 180s)
    const qe2 = await prisma.queueEntry.create({
      data: { patientId: patient2.id, serviceId: serviceAId, status: 'WAITING' },
    });
    await prisma.token.create({
      data: {
        queueEntryId: qe2.id, sequenceId: seq1.id, counterId,
        sequenceNumber: 2, displayNumber: 'A-002', businessDate: businessDate1,
        status: TokenStatus.COMPLETED,
        issuedAt: new Date('2026-01-15T09:05:00Z'),
        calledAt: new Date('2026-01-15T09:07:00Z'),
        servingAt: new Date('2026-01-15T09:08:00Z'),
        completedAt: new Date('2026-01-15T09:11:00Z'),
      },
    });

    // Token 3: SKIPPED (waiting: 30s, no service time)
    const qe3 = await prisma.queueEntry.create({
      data: { patientId: patient3.id, serviceId: serviceAId, status: 'WAITING' },
    });
    await prisma.token.create({
      data: {
        queueEntryId: qe3.id, sequenceId: seq1.id, counterId,
        sequenceNumber: 3, displayNumber: 'A-003', businessDate: businessDate1,
        status: TokenStatus.SKIPPED,
        issuedAt: new Date('2026-01-15T09:10:00Z'),
        calledAt: new Date('2026-01-15T09:10:30Z'),
        skippedAt: new Date('2026-01-15T09:15:00Z'),
      },
    });

    // Token 4: CANCELLED (waiting: 0s, no service time)
    const qe4 = await prisma.queueEntry.create({
      data: { patientId: patient4.id, serviceId: serviceAId, status: 'CANCELLED' },
    });
    await prisma.token.create({
      data: {
        queueEntryId: qe4.id, sequenceId: seq1.id,
        sequenceNumber: 4, displayNumber: 'A-004', businessDate: businessDate1,
        status: TokenStatus.CANCELLED,
        issuedAt: new Date('2026-01-15T09:12:00Z'),
      },
    });

    // Token 5: WAITING (no timestamps)
    const qe5 = await prisma.queueEntry.create({
      data: { patientId: patient5.id, serviceId: serviceAId, status: 'WAITING' },
    });
    await prisma.token.create({
      data: {
        queueEntryId: qe5.id, sequenceId: seq1.id,
        sequenceNumber: 5, displayNumber: 'A-005', businessDate: businessDate1,
        status: TokenStatus.WAITING,
        issuedAt: new Date('2026-01-15T09:15:00Z'),
      },
    });

    // Day 1: Service B — 2 tokens
    // Token 6: COMPLETED (waiting: 90s, service: 60s)
    const qe6 = await prisma.queueEntry.create({
      data: { patientId: patient6.id, serviceId: serviceBId, status: 'WAITING' },
    });
    await prisma.token.create({
      data: {
        queueEntryId: qe6.id, sequenceId: seq3.id, counterId,
        sequenceNumber: 1, displayNumber: 'B-001', businessDate: businessDate1,
        status: TokenStatus.COMPLETED,
        issuedAt: new Date('2026-01-15T10:00:00Z'),
        calledAt: new Date('2026-01-15T10:01:30Z'),
        servingAt: new Date('2026-01-15T10:02:00Z'),
        completedAt: new Date('2026-01-15T10:03:00Z'),
      },
    });

    // Token 7: CALLED (waiting: 45s so far)
    const qe7 = await prisma.queueEntry.create({
      data: { patientId: patient7.id, serviceId: serviceBId, status: 'WAITING' },
    });
    await prisma.token.create({
      data: {
        queueEntryId: qe7.id, sequenceId: seq3.id, counterId,
        sequenceNumber: 2, displayNumber: 'B-002', businessDate: businessDate1,
        status: TokenStatus.CALLED,
        issuedAt: new Date('2026-01-15T10:05:00Z'),
        calledAt: new Date('2026-01-15T10:05:45Z'),
      },
    });

    // Day 2: Service A — 1 COMPLETED token
    const patient8 = await prisma.patient.create({
      data: { branchId, patientNumber: 'ANP008', firstName: 'Data', lastName: 'Patient8' },
    });
    const qe8 = await prisma.queueEntry.create({
      data: { patientId: patient8.id, serviceId: serviceAId, status: 'WAITING' },
    });
    await prisma.token.create({
      data: {
        queueEntryId: qe8.id, sequenceId: seq2.id, counterId,
        sequenceNumber: 1, displayNumber: 'A-001', businessDate: businessDate2,
        status: TokenStatus.COMPLETED,
        issuedAt: new Date('2026-01-16T09:00:00Z'),
        calledAt: new Date('2026-01-16T09:03:00Z'),
        servingAt: new Date('2026-01-16T09:04:00Z'),
        completedAt: new Date('2026-01-16T09:06:00Z'),
      },
    });

    // Appointment data
    await prisma.appointment.create({
      data: {
        patientId: patient1.id, serviceId: serviceAId, branchId,
        appointmentDate: businessDate1,
        startAt: new Date('2026-01-15T08:00:00Z'),
        endAt: new Date('2026-01-15T08:15:00Z'),
        status: AppointmentStatus.COMPLETED,
      },
    });
    await prisma.appointment.create({
      data: {
        patientId: patient2.id, serviceId: serviceAId, branchId,
        appointmentDate: businessDate1,
        startAt: new Date('2026-01-15T08:30:00Z'),
        endAt: new Date('2026-01-15T08:45:00Z'),
        status: AppointmentStatus.CANCELLED,
      },
    });
    await prisma.appointment.create({
      data: {
        patientId: patient3.id, serviceId: serviceBId, branchId,
        appointmentDate: businessDate1,
        startAt: new Date('2026-01-15T11:00:00Z'),
        endAt: new Date('2026-01-15T11:15:00Z'),
        status: AppointmentStatus.SCHEDULED,
      },
    });
  }

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  describe('Summary metrics', () => {
    it('returns correct counts for all tokens (no date filter)', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/summary`)
        .expect(200);
      const data = res.body as SummaryResponse;

      expect(data.totalPatients).toBe(8);
      expect(data.totalQueueEntries).toBe(8);
      expect(data.waitingQueueCount).toBe(7);
      expect(data.cancelledQueueCount).toBe(1);
      expect(data.tokensIssued).toBe(8);
      expect(data.tokensCompleted).toBe(4);
      expect(data.tokensSkipped).toBe(1);
      expect(data.tokensCancelled).toBe(1);
      expect(data.tokensCalled).toBe(1);
      expect(data.tokensServing).toBe(0);
      expect(data.currentlyServing).toBe(1);
    });

    it('returns correct average waiting time', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/summary`)
        .expect(200);
      const data = res.body as SummaryResponse;

      // Tokens with calledAt: token1(60s), token2(120s), token3(30s), token6(90s), token7(45s), token8(180s)
      // Average = (60 + 120 + 30 + 90 + 45 + 180) / 6 = 525 / 6 = 87.5
      expect(data.avgWaitingTimeSeconds).not.toBeNull();
      expect(data.avgWaitingTimeSeconds).toBeCloseTo(87.5, 0);
    });

    it('returns correct average service time', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/summary`)
        .expect(200);
      const data = res.body as SummaryResponse;

      // Tokens with servingAt + completedAt: token1(120s), token2(180s), token6(60s), token8(120s)
      // Average = (120 + 180 + 60 + 120) / 4 = 480 / 4 = 120
      expect(data.avgServiceTimeSeconds).not.toBeNull();
      expect(data.avgServiceTimeSeconds).toBeCloseTo(120, 0);
    });

    it('returns correct rates', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/summary`)
        .expect(200);
      const data = res.body as SummaryResponse;

      // 4 completed / 8 total = 50%
      expect(data.completionRate).toBeCloseTo(50, 1);
      // 1 cancelled / 8 total = 12.5%
      expect(data.cancellationRate).toBeCloseTo(12.5, 1);
      // 1 skipped / 8 total = 12.5%
      expect(data.skipRate).toBeCloseTo(12.5, 1);
    });
  });

  describe('Business date filtering', () => {
    it('filters by single business date (day 1)', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/summary?businessDate=2026-01-15`)
        .expect(200);
      const data = res.body as SummaryResponse;

      // Day 1 has 7 tokens
      expect(data.tokensIssued).toBe(7);
      expect(data.tokensCompleted).toBe(3);
      expect(data.tokensSkipped).toBe(1);
      expect(data.tokensCancelled).toBe(1);
      expect(data.tokensCalled).toBe(1);
    });

    it('filters by single business date (day 2)', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/summary?businessDate=2026-01-16`)
        .expect(200);
      const data = res.body as SummaryResponse;

      expect(data.tokensIssued).toBe(1);
      expect(data.tokensCompleted).toBe(1);
    });
  });

  describe('Date range filtering', () => {
    it('filters by date range', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/summary?startDate=2026-01-15&endDate=2026-01-16`)
        .expect(200);
      const data = res.body as SummaryResponse;

      expect(data.tokensIssued).toBe(8);
    });
  });

  describe('Service filter', () => {
    it('filters by serviceId', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/summary?serviceId=${serviceAId}`)
        .expect(200);
      const data = res.body as SummaryResponse;

      // Service A has 6 tokens (5 day1 + 1 day2)
      expect(data.tokensIssued).toBe(6);
      expect(data.tokensCompleted).toBe(3);
    });
  });

  describe('Service performance', () => {
    it('returns correct per-service breakdown', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/services`)
        .expect(200);
      const data = res.body as Array<{
        serviceId: string;
        serviceName: string;
        tokensIssued: number;
        completed: number;
        cancelled: number;
        skipped: number;
        completionRate: number;
      }>;

      expect(data).toHaveLength(2);

      const serviceA = data.find((s) => s.serviceId === serviceAId);
      expect(serviceA).toBeDefined();
      expect(serviceA!.tokensIssued).toBe(6);
      expect(serviceA!.completed).toBe(3);
      expect(serviceA!.cancelled).toBe(1);
      expect(serviceA!.skipped).toBe(1);
      expect(serviceA!.completionRate).toBeCloseTo(50, 1);

      const serviceB = data.find((s) => s.serviceId === serviceBId);
      expect(serviceB).toBeDefined();
      expect(serviceB!.tokensIssued).toBe(2);
      expect(serviceB!.completed).toBe(1);
    });
  });

  describe('Counter performance', () => {
    it('returns correct per-counter breakdown', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/counters`)
        .expect(200);
      const data = res.body as Array<{
        counterId: string;
        tokensHandled: number;
        completed: number;
        skipped: number;
      }>;

      const counter = data.find((c) => c.counterId === counterId);
      expect(counter).toBeDefined();
      // Tokens with counterId: token1, token2, token3, token6, token7, token8 = 6
      // (token4 was cancelled, no counter; token5 is waiting, no counter)
      expect(counter!.tokensHandled).toBe(6);
      expect(counter!.completed).toBe(4);
      expect(counter!.skipped).toBe(1);
    });
  });

  describe('Daily trend', () => {
    it('returns correct daily aggregation in chronological order', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/trends`)
        .expect(200);
      const data = res.body as Array<{
        date: string;
        tokensIssued: number;
        completed: number;
        cancelled: number;
        skipped: number;
      }>;

      expect(data).toHaveLength(2);
      expect(data[0]!.date).toBe('2026-01-15');
      expect(data[0]!.tokensIssued).toBe(7);
      expect(data[0]!.completed).toBe(3);
      expect(data[0]!.cancelled).toBe(1);
      expect(data[0]!.skipped).toBe(1);

      expect(data[1]!.date).toBe('2026-01-16');
      expect(data[1]!.tokensIssued).toBe(1);
      expect(data[1]!.completed).toBe(1);
    });
  });

  describe('Appointment analytics', () => {
    it('returns correct appointment status distribution', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/appointments`)
        .expect(200);
      const data = res.body as {
        appointmentsCreated: number;
        appointmentsCompleted: number;
        appointmentsCancelled: number;
        appointmentsScheduled: number;
      };

      expect(data.appointmentsCreated).toBe(3);
      expect(data.appointmentsCompleted).toBe(1);
      expect(data.appointmentsCancelled).toBe(1);
      expect(data.appointmentsScheduled).toBe(1);
    });
  });

  describe('CSV export', () => {
    it('exports services CSV with correct headers', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/export?type=services`)
        .expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const lines = res.text.split('\n');
      expect(lines[0]).toContain('Service');
      expect(lines[0]).toContain('Department');
      expect(lines[0]).toContain('Completion Rate');
      expect(lines.length).toBeGreaterThanOrEqual(3);
    });

    it('exports counters CSV with correct headers', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/export?type=counters`)
        .expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const lines = res.text.split('\n');
      expect(lines[0]).toContain('Counter');
      expect(lines[0]).toContain('Tokens Handled');
    });

    it('exports trends CSV with correct headers', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/export?type=trends`)
        .expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const lines = res.text.split('\n');
      expect(lines[0]).toContain('Date');
      expect(lines[0]).toContain('Tokens Issued');
    });
  });

  describe('No double-counting', () => {
    it('queue entries and tokens are counted separately without duplication', async () => {
      const res = await tenantRequest(adminToken, orgId)
        .get(`/branches/${branchId}/analytics/summary`)
        .expect(200);
      const data = res.body as SummaryResponse;

      // Each queue entry has exactly one token (1:1 relationship)
      // totalQueueEntries and tokensIssued should be equal
      expect(data.totalQueueEntries).toBe(data.tokensIssued);
      // Status breakdown should add up to total
      const statusSum = data.tokensCompleted + data.tokensSkipped + data.tokensCancelled + data.tokensCalled + data.tokensServing;
      // The remaining tokens are WAITING
      const waiting = data.tokensIssued - statusSum;
      expect(waiting).toBe(1); // We have 1 WAITING token
    });
  });
});
