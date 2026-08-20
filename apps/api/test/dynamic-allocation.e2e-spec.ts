import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { INestApplication } from '@nestjs/common';
import { TokensService } from '../src/tokens/tokens.service';
import { CountersService } from '../src/operations/counters.service';
import { QueueCallingService } from '../src/queue-calling/queue-calling.service';
import { TokenStatus, CounterStatus } from '@prisma/client';

describe('Dynamic Token Allocation Architecture (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokensService: TokensService;
  let countersService: CountersService;
  let queueCallingService: QueueCallingService;

  let branchId: string;
  let orgId: string;
  let serviceId: string;
  let counters: string[] = [];
  let tenant: any;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    tokensService = app.get(TokensService);
    countersService = app.get(CountersService);
    queueCallingService = app.get(QueueCallingService);
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: 'DynOrg-' + Date.now(), timezone: 'UTC', slug: 'dyn-org-' + Date.now() } });
    orgId = org.id;
    const branch = await prisma.branch.create({ data: { organizationId: orgId, name: 'DynBranch', code: 'DYN-' + Date.now() } });
    branchId = branch.id;
    const dept = await prisma.department.create({ data: { branchId, name: 'Dept' } });
    const svc = await prisma.service.create({ data: { departmentId: dept.id, name: 'Svc', acceptingQueueEntries: true } });
    serviceId = svc.id;

    const user = await prisma.user.create({ data: { email: 'dyn-' + Date.now() + '@test.com', displayName: 'Dyn User', passwordHash: '' } });
    tenant = { userId: user.id, organizationId: orgId, branchId, role: 'ORG_ADMIN' };

    counters = [];
    for(let i=1; i<=10; i++) {
      const c = await countersService.create(tenant, branchId, { name: 'C'+i, code: 'C'+(i < 10 ? '0'+i : i) });
      await countersService.setStatus(tenant, branchId, c.id, CounterStatus.INACTIVE);
      counters.push(c.id);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  async function getDistribution() {
    const activeCounters = await prisma.counter.findMany({ where: { branchId, status: 'ACTIVE' }, orderBy: { code: 'asc' } });
    const tokens = await prisma.token.groupBy({
      by: ['counterId'],
      _count: { id: true },
      where: { status: 'WAITING', queueEntry: { service: { department: { branchId } } } }
    });
    
    const dist = activeCounters.map(c => {
      const t = tokens.find(t => t.counterId === c.id);
      return t ? t._count.id : 0;
    });
    
    const unassigned = await prisma.token.count({ where: { status: 'WAITING', counterId: null, queueEntry: { service: { department: { branchId } } } } });
    return { dist, activeCount: activeCounters.length, unassigned };
  }

  async function verifyDistribution(expectedTotal: number) {
    const { dist, activeCount, unassigned } = await getDistribution();
    const sum = dist.reduce((a, b) => a + b, 0);
    
    if (activeCount === 0) {
      expect(unassigned).toBe(expectedTotal);
      return;
    }
    
    expect(unassigned).toBe(0); // T. no token assigned to inactive counter / no lost waiting tokens
    expect(sum).toBe(expectedTotal); // S. no lost waiting tokens
    
    if (activeCount > 0) {
      const max = Math.max(...dist);
      const min = Math.min(...dist);
      expect(max - min).toBeLessThanOrEqual(1); // U. distribution difference never exceeds 1
    }
  }

  it('A. 1 active counter', async () => {
    await countersService.setStatus(tenant, branchId, counters[0], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 10, priority: 'NORMAL' });
    await verifyDistribution(10);
  });

  it('B. 2 active counters', async () => {
    await countersService.setStatus(tenant, branchId, counters[0], CounterStatus.ACTIVE);
    await countersService.setStatus(tenant, branchId, counters[1], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 10, priority: 'NORMAL' });
    await verifyDistribution(10);
  });

  it('C. 3 active counters', async () => {
    for(let i=0; i<3; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 10, priority: 'NORMAL' });
    await verifyDistribution(10);
  });

  it('D. 4 active counters', async () => {
    for(let i=0; i<4; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 20, priority: 'NORMAL' });
    await verifyDistribution(20);
  });

  it('E. 5 active counters', async () => {
    for(let i=0; i<5; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 103, priority: 'NORMAL' });
    await verifyDistribution(103);
  });

  it('F. 6+ active counters', async () => {
    for(let i=0; i<8; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 50, priority: 'NORMAL' });
    await verifyDistribution(50);
  });

  it('G. token count exactly divisible', async () => {
    for(let i=0; i<4; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 40, priority: 'NORMAL' });
    await verifyDistribution(40);
    const { dist } = await getDistribution();
    expect(dist).toEqual([10, 10, 10, 10]);
  });

  it('H. token count not divisible', async () => {
    for(let i=0; i<4; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 39, priority: 'NORMAL' });
    await verifyDistribution(39);
    const { dist } = await getDistribution();
    expect(dist).toEqual([10, 10, 10, 9]);
  });

  it('I. counter deactivation', async () => {
    for(let i=0; i<5; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 100, priority: 'NORMAL' });
    await countersService.setStatus(tenant, branchId, counters[4], CounterStatus.INACTIVE);
    await verifyDistribution(100);
    const { dist } = await getDistribution();
    expect(dist).toEqual([25, 25, 25, 25]);
  });

  it('J. deactivation of counter with waiting tokens', async () => {
    for(let i=0; i<4; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 103, priority: 'NORMAL' });
    // C1 to C4 are active. Now deactivate C1.
    await countersService.setStatus(tenant, branchId, counters[0], CounterStatus.INACTIVE);
    await verifyDistribution(103);
  });

  it('K. deactivation of counter with currently serving token', async () => {
    for(let i=0; i<4; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 40, priority: 'NORMAL' });
    await queueCallingService.callNext(tenant, tenant.userId, branchId, counters[0]);
    // 39 waiting tokens. C1 is serving 1.
    await countersService.setStatus(tenant, branchId, counters[0], CounterStatus.INACTIVE);
    await verifyDistribution(39); // The WAITING tokens are rebalanced across C2, C3, C4
    
    // Check that C1 is still serving the token
    const current = await queueCallingService.current(tenant, tenant.userId, branchId, counters[0]);
    expect(current).toBeDefined();
    expect(current?.status).toBe('CALLED');
  });

  it('L. multiple counters deactivated', async () => {
    for(let i=0; i<5; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 100, priority: 'NORMAL' });
    await countersService.setStatus(tenant, branchId, counters[3], CounterStatus.INACTIVE);
    await countersService.setStatus(tenant, branchId, counters[4], CounterStatus.INACTIVE);
    await verifyDistribution(100);
    const { dist } = await getDistribution();
    expect(dist).toEqual([34, 33, 33]);
  });

  it('M. counter reactivation', async () => {
    for(let i=0; i<4; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 100, priority: 'NORMAL' });
    await countersService.setStatus(tenant, branchId, counters[4], CounterStatus.ACTIVE);
    await verifyDistribution(100);
    const { dist } = await getDistribution();
    expect(dist).toEqual([20, 20, 20, 20, 20]);
  });

  it('N. SPECIAL active counter', async () => {
    for(let i=0; i<4; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    
    // Make counters[4] a special counter
    await prisma.counter.update({ where: { id: counters[4] }, data: { tokenType: 'SPECIAL' } });
    await countersService.setStatus(tenant, branchId, counters[4], CounterStatus.ACTIVE);
    
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 100, priority: 'NORMAL' });
    await verifyDistribution(100);
    const { dist } = await getDistribution();
    expect(dist).toEqual([20, 20, 20, 20, 20]); // SPECIAL counter is not excluded from NORMAL tokens
  });

  it('O. concurrent token creation', async () => {
    for(let i=0; i<5; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    
    const promises = [];
    for(let i=0; i<10; i++) {
      promises.push(tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 5, priority: 'NORMAL' }));
    }
    await Promise.all(promises);
    
    await verifyDistribution(50);
  });

  it('P. concurrent callNext', async () => {
    for(let i=0; i<5; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 50, priority: 'NORMAL' });
    
    const promises = [];
    for(let i=0; i<5; i++) {
      promises.push(queueCallingService.callNext(tenant, tenant.userId, branchId, counters[i]));
    }
    await Promise.all(promises);
    
    await verifyDistribution(45);
  });

  it('Q. concurrent deactivation/rebalance', async () => {
    for(let i=0; i<5; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    
    const p1 = tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 50, priority: 'NORMAL' });
    const p2 = countersService.setStatus(tenant, branchId, counters[4], CounterStatus.INACTIVE);
    await Promise.all([p1, p2]);
    
    await verifyDistribution(50);
  });

  it('R. no duplicate token assignments', async () => {
    for(let i=0; i<5; i++) await countersService.setStatus(tenant, branchId, counters[i], CounterStatus.ACTIVE);
    await tokensService.generateBulk(tenant, branchId, { serviceId, quantity: 50, priority: 'NORMAL' });
    
    const waitingTokens = await prisma.token.findMany({ where: { status: 'WAITING', queueEntry: { service: { department: { branchId } } } } });
    const uniqueIds = new Set(waitingTokens.map(t => t.id));
    expect(uniqueIds.size).toBe(50); // Each token exists once
  });
});
