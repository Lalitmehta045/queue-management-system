import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { INestApplication } from '@nestjs/common';
import { TokensService } from '../src/tokens/tokens.service';
import { CountersService } from '../src/operations/counters.service';
import { QueueCallingService } from '../src/queue-calling/queue-calling.service';

import { TokenStatus, CounterStatus } from '@prisma/client';

describe('Token Allocation Acceptance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokensService: TokensService;
  let countersService: CountersService;
  let queueCallingService: QueueCallingService;

  let branchId: string;
  let orgId: string;
  let serviceId: string;
  let c1: string, c2: string, c3: string, c4: string;
  let tenant: any;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    tokensService = app.get(TokensService);
    countersService = app.get(CountersService);
    queueCallingService = app.get(QueueCallingService);

    // Setup basic records
    const org = await prisma.organization.create({ data: { name: 'Acceptance Org', timezone: 'UTC', slug: 'acc-org' } });
    orgId = org.id;
    const branch = await prisma.branch.create({ data: { organizationId: orgId, name: 'Acceptance Branch', code: 'ACC-01' } });
    branchId = branch.id;
    const dept = await prisma.department.create({ data: { branchId, name: 'Dept' } });
    const svc = await prisma.service.create({ data: { departmentId: dept.id, name: 'Svc', acceptingQueueEntries: true } });
    serviceId = svc.id;

    const user = await prisma.user.create({ data: { email: 'acc@test.com', displayName: 'Acc User', passwordHash: '' } });
    tenant = { userId: user.id, organizationId: orgId, branchId, role: 'ORG_ADMIN' };

    c1 = (await countersService.create(tenant, branchId, { name: 'C1', code: 'C1' })).id;
    c2 = (await countersService.create(tenant, branchId, { name: 'C2', code: 'C2' })).id;
    c3 = (await countersService.create(tenant, branchId, { name: 'C3', code: 'C3' })).id;
    c4 = (await countersService.create(tenant, branchId, { name: 'C4', code: 'C4' })).id;

    await prisma.counter.updateMany({ where: { id: { in: [c1, c2, c3, c4] } }, data: { status: 'INACTIVE' } });
  });

  afterAll(async () => {
    await app.close();
  });

  async function getCounts() {
    const waitingTokens = await prisma.token.findMany({ where: { status: 'WAITING', counterId: { not: null } }, select: { counterId: true } });
    const counts: Record<string, number> = { [c1]: 0, [c2]: 0, [c3]: 0, [c4]: 0 };
    for (const t of waitingTokens) if (t.counterId) counts[t.counterId as string] = (counts[t.counterId as string] || 0) + 1;
    return Object.values(counts);
  }

  it('runs acceptance scenario', async () => {
    // 40 tokens + C1 active -> C1=40
    await countersService.setStatus(tenant, branchId, c1, CounterStatus.ACTIVE);
    for(let i=0; i<40; i++) {
      const qe = await prisma.queueEntry.create({ data: { serviceId, status: 'WAITING', priority: 'NORMAL', activeEntryKey: 'k'+i } });
      await tokensService.generate(tenant, branchId, qe.id);
    }
    let counts = await getCounts();
    expect(counts).toEqual([40, 0, 0, 0]);

    // Activate C2 -> 20/20
    await countersService.setStatus(tenant, branchId, c2, CounterStatus.ACTIVE);
    counts = await getCounts();
    expect(counts).toEqual([20, 20, 0, 0]);

    // Activate C3 -> 14/13/13
    await countersService.setStatus(tenant, branchId, c3, CounterStatus.ACTIVE);
    counts = await getCounts();
    expect(counts).toEqual([14, 13, 13, 0]);

    // Activate C4 -> 10/10/10/10
    await countersService.setStatus(tenant, branchId, c4, CounterStatus.ACTIVE);
    counts = await getCounts();
    expect(counts).toEqual([10, 10, 10, 10]);

    // C2 calls token -> C1=10, C2=10, C3=10, C4=9
    await queueCallingService.callNext(tenant, tenant.userId, branchId, c2);
    counts = await getCounts();
    expect(counts).toEqual([10, 10, 10, 9]);

    // C3 skips token -> C1=10, C2=10, C3=9, C4=9
    const c3Call = await queueCallingService.callNext(tenant, tenant.userId, branchId, c3);
    await queueCallingService.skip(tenant, tenant.userId, branchId, c3);
    counts = await getCounts();
    expect(counts).toEqual([10, 10, 9, 9]);

    // Create 5 tokens -> C1=11, C2=11, C3=11, C4=10
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 5, priority: 'NORMAL' });
    counts = await getCounts();
    expect(counts).toEqual([11, 11, 11, 10]);

    // Deactivate C4 -> C1=15, C2=14, C3=14
    await countersService.setStatus(tenant, branchId, c4, CounterStatus.INACTIVE);
    counts = await getCounts();
    expect(counts).toEqual([15, 14, 14, 0]);

    // Create 10 bulk tokens -> C1=18, C2=18, C3=17
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 10, priority: 'NORMAL' });
    counts = await getCounts();
    expect(counts).toEqual([18, 18, 17, 0]);
  });
});
