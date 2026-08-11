import { clearDatabase } from './test-utils';
/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrintersService } from '../src/printers/printers.service';
import { JwtService } from '@nestjs/jwt';

describe('Printers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let printersService: PrintersService;
  
  let orgId: string;
  let branchId: string;
  let branch2Id: string;
  let token: string;
  let tokenId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    jwtService = moduleFixture.get<JwtService>(JwtService);
    printersService = moduleFixture.get<PrintersService>(PrintersService);

    // Clean up
    await prisma.printJob.deleteMany();
    await prisma.printer.deleteMany();

    // Create organization & branches
    const org = await prisma.organization.create({
      data: { name: 'Print Test Org', slug: `print-test-org-${Date.now()}` },
    });
    orgId = org.id;

    const branch = await prisma.branch.create({
      data: { organizationId: orgId, name: 'Main Branch' },
    });
    branchId = branch.id;

    const branch2 = await prisma.branch.create({
      data: { organizationId: orgId, name: 'Other Branch' },
    });
    branch2Id = branch2.id;

    // Create user and membership
    const user = await prisma.user.create({
      data: {
        email: 'printer-admin@test.com',
        displayName: 'Print Admin',
        passwordHash: 'hash',
      },
    });

    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: orgId,
        role: 'ORG_ADMIN',
        status: 'ACTIVE',
      },
    });

    const session = await prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() + 1000000),
      },
    });

    const jwtSecret = process.env.JWT_ACCESS_SECRET || 'dev-access-secret-do-not-use-in-production';
    token = jwtService.sign({ sub: user.id, sessionId: session.id, role: 'ORG_ADMIN' }, { secret: jwtSecret });

    // Create a department, service, patient, and queue entry to generate a token
    const dept = await prisma.department.create({ data: { branchId, name: 'Dept' } });
    const service = await prisma.service.create({ data: { departmentId: dept.id, name: 'Serv' } });
    const patient = await prisma.patient.create({ data: { branchId, patientNumber: 'P001', firstName: 'A', lastName: 'B', phone: '123' } });
    
    const queueEntry = await prisma.queueEntry.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        priority: 'NORMAL'
      }
    });

    const seq = await prisma.tokenSequence.create({
      data: {
        branchId,
        serviceId: service.id,
        businessDate: new Date()
      }
    });

    const t = await prisma.token.create({
      data: {
        queueEntryId: queueEntry.id,
        sequenceId: seq.id,
        sequenceNumber: 1,
        displayNumber: 'A001',
        status: 'WAITING',
        businessDate: new Date()
      }
    });
    tokenId = t.id;
  });

    afterAll(async () => {
    try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }
  });

  let printerId: string;
  let pairingCode: string;
  let deviceSecret: string;

  it('Admin can create a printer', async () => {
    const res = await request(app.getHttpServer())
      .post(`/branches/${branchId}/printers`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .send({ name: 'Test Printer 1' })
      .expect(201);
    
    expect(res.body.id).toBeDefined();
    expect(res.body.pairingCode).toBeDefined();
    printerId = res.body.id;
    pairingCode = res.body.pairingCode;
  });

  it('Pairing code single-use & creates valid device secret', async () => {
    const res = await request(app.getHttpServer())
      .post('/printers/pair')
      .send({ pairingCode })
      .expect(200);
    
    expect(res.body.deviceSecret).toBeDefined();
    deviceSecret = res.body.deviceSecret;

    // Second use should fail
    await request(app.getHttpServer())
      .post('/printers/pair')
      .send({ pairingCode })
      .expect(401);
  });

  it('Wrong secret rejection', async () => {
    await request(app.getHttpServer())
      .get(`/printers/${printerId}/jobs`)
      .set('x-printer-secret', 'wrong-secret')
      .expect(401);
  });

  it('PrintJob idempotency and tenant isolation', async () => {
    // 1. Cross-branch isolation check (should fail)
    await request(app.getHttpServer())
      .post(`/branches/${branch2Id}/printers/${printerId}/print-token/${tokenId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .send({ idempotencyKey: 'idemp_1' })
      .expect(404); // Not Found since printer doesn't belong to branch2Id

    // 2. Create PrintJob
    const res = await request(app.getHttpServer())
      .post(`/branches/${branchId}/printers/${printerId}/print-token/${tokenId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .send({ idempotencyKey: 'idemp_1' })
      .expect(201);

    const jobId = res.body.jobId;

    // 3. Duplicate PrintJob with same idempotencyKey returns SAME job
    const res2 = await request(app.getHttpServer())
      .post(`/branches/${branchId}/printers/${printerId}/print-token/${tokenId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .send({ idempotencyKey: 'idemp_1' })
      .expect(201);
    
    expect(res2.body.jobId).toEqual(jobId);
  });

  it('Concurrent claiming and state machine transitions', async () => {
    // Create a fresh job
    const res = await request(app.getHttpServer())
      .post(`/branches/${branchId}/printers/${printerId}/print-token/${tokenId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .send({ idempotencyKey: 'idemp_2' })
      .expect(201);
    
    const jobId = res.body.jobId;

    // Bridge 1 claims
    await request(app.getHttpServer())
      .patch(`/printers/${printerId}/jobs/${jobId}`)
      .set('x-printer-secret', deviceSecret)
      .send({ status: 'CLAIMED' })
      .expect(200);

    // Bridge 2 tries to claim concurrently (already claimed, should fail)
    await request(app.getHttpServer())
      .patch(`/printers/${printerId}/jobs/${jobId}`)
      .set('x-printer-secret', deviceSecret)
      .send({ status: 'CLAIMED' })
      .expect(403);

    // Bridge 1 marks printed
    await request(app.getHttpServer())
      .patch(`/printers/${printerId}/jobs/${jobId}`)
      .set('x-printer-secret', deviceSecret)
      .send({ status: 'PRINTED' })
      .expect(200);

    // Bridge 1 tries to mark failed after printed (invalid transition)
    await request(app.getHttpServer())
      .patch(`/printers/${printerId}/jobs/${jobId}`)
      .set('x-printer-secret', deviceSecret)
      .send({ status: 'FAILED' })
      .expect(403);
  });
});
