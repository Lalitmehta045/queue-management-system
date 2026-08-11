import { clearDatabase } from './test-utils';
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, Controller, Get, UseGuards } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import cookieParser from 'cookie-parser';

import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { TenantGuard } from '../src/auth/guards/tenant.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { Roles } from '../src/auth/decorators/roles.decorator';
import { Role, User, Membership } from '@prisma/client';

@Controller('protected')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
class ProtectedController {
  @Get('org-admin')
  @Roles(Role.ORG_ADMIN)
  orgAdminRoute() { return { ok: true }; }

  @Get('doctor')
  @Roles(Role.DOCTOR)
  doctorRoute() { return { ok: true }; }
}

describe('Tenant Authorization (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProtectedController],
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

  let userA: (User & { memberships: Membership[] }) | null, userB: (User & { memberships: Membership[] }) | null;
  let orgA: string, orgB: string;
  let tokenA: string;

  it('Setup test data', async () => {
    // We register User A which creates Org A with ORG_ADMIN
    const resA = await request(app.getHttpServer()).post('/auth/register').send({ email: 'usera@example.com', password: 'password', displayName: 'User A' }).expect(201);
    tokenA = (resA.body as { accessToken: string }).accessToken;

    await request(app.getHttpServer()).post('/auth/register').send({ email: 'userb@example.com', password: 'password', displayName: 'User B' }).expect(201);

    userA = await prisma.user.findUnique({ where: { email: 'usera@example.com' }, include: { memberships: true } });
    orgA = userA!.memberships[0]!.organizationId;

    userB = await prisma.user.findUnique({ where: { email: 'userb@example.com' }, include: { memberships: true } });
    orgB = userB!.memberships[0]!.organizationId;
  });

  it('User A accessing Org A should succeed', async () => {
    await request(app.getHttpServer())
      .get('/protected/org-admin')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('x-organization-id', orgA)
      .expect(200);
  });

  it('User A accessing Org B should fail (403)', async () => {
    await request(app.getHttpServer())
      .get('/protected/org-admin')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('x-organization-id', orgB)
      .expect(403);
  });

  it('User A accessing with insufficient role (requires DOCTOR, has ORG_ADMIN)', async () => {
    // Note: If ORG_ADMIN doesn't implicitly have DOCTOR permissions, this should fail.
    // Based on our simplistic RolesGuard, they must strictly have DOCTOR unless they are SUPER_ADMIN.
    await request(app.getHttpServer())
      .get('/protected/doctor')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('x-organization-id', orgA)
      .expect(403);
  });

  it('Suspended membership cannot access tenant', async () => {
    // Suspend user A's membership
    await prisma.membership.update({
      where: { userId_organizationId: { userId: userA!.id, organizationId: orgA } },
      data: { status: 'SUSPENDED' },
    });

    await request(app.getHttpServer())
      .get('/protected/org-admin')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('x-organization-id', orgA)
      .expect(403);
  });
});
