import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Server } from 'http';
import { OrganizationsService } from '../src/organizations/organizations.service';

describe('Concurrency & Failures (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('handles 10 simultaneous self-service check-in requests cleanly', async () => {
    // 1. Setup Organization, Branch, Department, Service, Patient, Appointment
    const org = await prisma.organization.create({
      data: { name: 'E2E Org ' + Date.now(), slug: 'e2e-org-' + Date.now() },
    });
    const branch = await prisma.branch.create({
      data: { organizationId: org.id, name: 'E2E Branch', status: 'ACTIVE' },
    });
    const dept = await prisma.department.create({
      data: { branchId: branch.id, name: 'E2E Dept', status: 'ACTIVE' },
    });
    const service = await prisma.service.create({
      data: { departmentId: dept.id, name: 'E2E Service', status: 'ACTIVE' },
    });
    const patient = await prisma.patient.create({
      data: { branchId: branch.id, firstName: 'John', lastName: 'Doe', status: 'ACTIVE', patientNumber: 'PT-' + Date.now() },
    });

    // Need working hours to confirm/check-in without issues, or bypass it? Appointments check-in doesn't strictly check working hours for check-in if it's already scheduled, wait, we bypass it.
    
    const appt = await prisma.appointment.create({
      data: {
        branchId: branch.id,
        patientId: patient.id,
        serviceId: service.id,
        status: 'SCHEDULED', // QR check-in confirms and checks in
        appointmentDate: new Date(),
        startAt: new Date(),
        endAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const qrPayload = `QMS:1:APPT:${appt.id}`;

    // Fire 10 simultaneous requests
    const promises = Array.from({ length: 10 }).map(() =>
      request(app.getHttpServer() as Server)
        .post('/public/self-service/qr/check-in')
        .send({ qrPayload: qrPayload })
        .set('User-Agent', 'E2E-Tester')
    );

    const responses: request.Response[] = await Promise.all(promises);

    // Assert that exactly one succeeds (201) or returns duplicate gracefully
    // Wait, the new logic returns exactly the same result or conflict?
    // The logic we wrote returns `{ appointmentId, queueEntryId, ... }` for the first one,
    // and for subsequent ones it returns the existing queueEntry if already checked in, OR conflict if in progress.
    // We expect NO internal server errors (500).
    const statusCodes = responses.map((r) => r.status);
    expect(statusCodes.every((s) => s === 200 || s === 409)).toBe(true);

    const successful = responses.filter((r) => r.status === 200);
    expect(successful.length).toBeGreaterThan(0);

    // Verify DB state
    const entries = await prisma.queueEntry.findMany({
      where: { patientId: patient.id, serviceId: service.id },
    });
    expect(entries.length).toBe(1);
    const entryId = entries[0]?.id;
    if (!entryId) {
      throw new Error('Expected exactly one queue entry');
    }

    const tokens = await prisma.token.findMany({
      where: { queueEntryId: entryId },
    });
    expect(tokens.length).toBe(1);
  });

  it('respects plan limits for concurrent resource creation atomically', async () => {
    // Setup a custom plan with limit of 2 branches
    const plan = await prisma.subscriptionPlan.create({
      data: {
        name: 'Tiny Plan',
        code: 'TINY_' + Date.now(),
        description: 'Test plan',
        limits: {
          maxBranches: 2,
          maxUsers: 10,
          maxCounters: 5,
          maxServices: 5,
          maxDisplays: 5,
          maxMonthlyTokens: 1000,
        },
      },
    });

    const org = await prisma.organization.create({
      data: { name: 'E2E Limited Org ' + Date.now(), slug: 'e2e-limited-' + Date.now() },
    });

    await prisma.organizationSubscription.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        status: 'ACTIVE',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const orgService = app.get(OrganizationsService);

    // Fire 5 simultaneous createBranch requests
    const promises = Array.from({ length: 5 }).map((_, i) =>
      orgService.createBranch(org.id, { name: `Branch ${i}` }).catch((e: unknown) => e)
    );

    const results = await Promise.all(promises);

    const successes = results.filter((r) => r && typeof r === 'object' && 'id' in r);
    const failures = results.filter((r) => {
      if (r instanceof Error || (r && typeof r === 'object' && 'response' in r)) {
        const response = (r as { response?: { errorCode?: string } }).response;
        return response?.errorCode === 'PLAN_LIMIT_REACHED';
      }
      return false;
    });

    // Due to the transaction and FOR UPDATE lock, exactly 2 should succeed and 3 should fail
    expect(successes.length).toBe(2);
    expect(failures.length).toBe(3);

    // Verify DB
    const branches = await prisma.branch.count({ where: { organizationId: org.id } });
    expect(branches).toBe(2);
  });
});
