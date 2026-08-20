import { clearDatabase } from './test-utils';
/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';

describe('SelfService (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  
  let orgId: string;
  let branchId: string;
  let patientId: string;
  let serviceId: string;
  let appointmentId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
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

  beforeEach(async () => {
    // Clean up using the centralized utility to prevent constraint violations
    await clearDatabase(prisma);

    // Setup test data
    const org = await prisma.organization.create({
      data: { name: 'Test Org', slug: `org-${randomUUID()}` }
    });
    orgId = org.id;

    const branch = await prisma.branch.create({
      data: { organizationId: orgId, name: 'Test Branch', code: `TB-${randomUUID()}` }
    });
    branchId = branch.id;

    const dept = await prisma.department.create({
      data: { branchId, name: 'General' }
    });

    const svc = await prisma.service.create({
      data: { departmentId: dept.id, name: 'Consultation' }
    });
    serviceId = svc.id;

    const patient = await prisma.patient.create({
      data: { branchId, patientNumber: 'P-100', firstName: 'John', lastName: 'Doe' }
    });
    patientId = patient.id;

    const appt = await prisma.appointment.create({
      data: {
        patientId,
        serviceId,
        branchId,
        appointmentDate: new Date('2026-08-20T00:00:00Z'),
        startAt: new Date('2026-08-20T10:00:00Z'),
        endAt: new Date('2026-08-20T10:30:00Z'),
        status: 'SCHEDULED'
      }
    });
    appointmentId = appt.id;
  });

  it('/public/self-service/qr/validate (POST) - Valid APPT QR', async () => {
    const payload = `QMS:1:APPT:${appointmentId}`;
    
    const response = await request(app.getHttpServer())
      .post('/public/self-service/qr/validate')
      .send({ qrPayload: payload })
      .expect(200);

    expect(response.body.type).toBe('APPOINTMENT');
    expect(response.body.data.appointmentId).toBe(appointmentId);
    expect(response.body.data.patientInitials).toBe('JD');
    expect(response.body.data.serviceName).toBe('Consultation');
    expect(response.body.data.status).toBe('SCHEDULED');
  });

  it('/public/self-service/qr/validate (POST) - Invalid QR', async () => {
    await request(app.getHttpServer())
      .post('/public/self-service/qr/validate')
      .send({ qrPayload: `QMS:1:APPT:${randomUUID()}` }) // non-existent
      .expect(404);
  });
  
  it('/public/self-service/qr/validate (POST) - Forged Format', async () => {
    await request(app.getHttpServer())
      .post('/public/self-service/qr/validate')
      .send({ qrPayload: `INVALID_PAYLOAD` })
      .expect(400);
  });

  it('/public/self-service/qr/check-in (POST) - Success exactly once under concurrency', async () => {
    const payload = `QMS:1:APPT:${appointmentId}`;
    
    // Simulate 3 concurrent check-ins
    const p1 = request(app.getHttpServer()).post('/public/self-service/qr/check-in').send({ qrPayload: payload });
    const p2 = request(app.getHttpServer()).post('/public/self-service/qr/check-in').send({ qrPayload: payload });
    const p3 = request(app.getHttpServer()).post('/public/self-service/qr/check-in').send({ qrPayload: payload });

    const results = await Promise.all([p1, p2, p3]);

    const successes = results.filter(r => r.status === 200);
    const conflicts = results.filter(r => r.status === 409); // Only one might get token, others might conflict or get same token
    
    // Check exactly one token was created for this appointment
    const tokens = await prisma.token.findMany({
      where: { queueEntry: { patientId, serviceId } }
    });
    expect(tokens.length).toBe(1);

    // After success, status must be CHECKED_IN
    const updated = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(updated?.status).toBe('CHECKED_IN');
  });

  it('/public/self-service/qr/check-in (POST) - Replay should just return status or fail', async () => {
    const payload = `QMS:1:APPT:${appointmentId}`;
    
    await request(app.getHttpServer()).post('/public/self-service/qr/check-in').send({ qrPayload: payload }).expect(200);

    // Second check-in after completion might conflict depending on AppointmentsService.checkIn implementation
    const res2 = await request(app.getHttpServer()).post('/public/self-service/qr/check-in').send({ qrPayload: payload });
    
    // Our checkIn function returns 200 with the existing queue entry/token if already checked in, so this is 200!
    expect(res2.status).toBe(200);
    expect(res2.body.tokenId).toBeDefined();
  });
});
