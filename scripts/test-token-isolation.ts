import { NestFactory } from '@nestjs/core';
import { AppModule } from '../apps/api/src/app.module';
import { TokensService } from '../apps/api/src/tokens/tokens.service';
import { QueueAllocationService } from '../apps/api/src/queue-calling/queue-allocation.service';
import { DisplaysService } from '../apps/api/src/displays/displays.service';
import { PrismaService } from '../apps/api/src/prisma/prisma.service';

async function main() {
  console.log('Bootstrapping application...');
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const tokensService = app.get(TokensService);
  const queueAllocation = app.get(QueueAllocationService);
  const displaysService = app.get(DisplaysService);

  const org = await prisma.organization.findFirst();
  const branch = await prisma.branch.findFirst({ where: { organizationId: org!.id } });
  let dept = await prisma.department.findFirst({ where: { branchId: branch!.id } });
  if (!dept) {
    dept = await prisma.department.create({ data: { branchId: branch!.id, name: 'Test Dept' } });
  }
  let service = await prisma.service.findFirst({ where: { departmentId: dept!.id } });
  if (!service) {
    service = await prisma.service.create({ data: { departmentId: dept!.id, name: 'Test Service' } });
  }

  const tenant = { organizationId: org!.id, role: 'ORG_ADMIN', userId: 'test', branchId: null } as any;

  // Deactivate all counters
  await prisma.counter.updateMany({ where: { branchId: branch!.id }, data: { status: 'INACTIVE' } });

  // Create or update counters
  const setupCounter = async (code: string, type: 'NORMAL' | 'SPECIAL') => {
    let c = await prisma.counter.findFirst({ where: { branchId: branch!.id, code } });
    if (!c) {
      c = await prisma.counter.create({ data: { branchId: branch!.id, name: `Counter ${code}`, code, status: 'ACTIVE', tokenType: type } });
    } else {
      await prisma.counter.update({ where: { id: c.id }, data: { status: 'ACTIVE', tokenType: type } });
    }
    return c;
  };

  const c1 = await setupCounter('C1', 'NORMAL');
  const c2 = await setupCounter('C2', 'NORMAL');
  const c3 = await setupCounter('C3', 'NORMAL');
  const c4 = await setupCounter('C4', 'NORMAL');
  const c5 = await setupCounter('C5', 'SPECIAL');

  await tokensService.resetTokenSequence(tenant, branch!.id);

  console.log('\n--- Test 1: Generate 1 NORMAL token ---');
  const qe1 = await prisma.queueEntry.create({ data: { serviceId: service!.id, priority: 'NORMAL', priorityWeight: 0 } });
  const t1 = await tokensService.generate(tenant, branch!.id, qe1.id, { type: 'NORMAL' } as any);
  console.log(`Token 1: ${t1.displayNumber}, Type: ${t1.type}, Counter: ${t1.counter?.code}`);

  console.log('\n--- Test 2: Generate 1 SPECIAL token ---');
  const qe2 = await prisma.queueEntry.create({ data: { serviceId: service!.id, priority: 'SENIOR_CITIZEN', priorityWeight: 60 } });
  const t2 = await tokensService.generate(tenant, branch!.id, qe2.id, { type: 'SPECIAL', specialCategory: 'SENIOR_CITIZEN' } as any);
  console.log(`Token 2: ${t2.displayNumber}, Type: ${t2.type}, Counter: ${t2.counter?.code}`);

  console.log('\n--- Test 3: Generate 20 NORMAL and 10 SPECIAL tokens in bulk ---');
  await tokensService.generateBulk(tenant, branch!.id, { serviceId: service!.id, priority: 'NORMAL', quantity: 20, type: 'NORMAL' });
  await tokensService.generateBulk(tenant, branch!.id, { serviceId: service!.id, priority: 'SENIOR_CITIZEN', quantity: 10, type: 'SPECIAL', specialCategory: 'DISABLED' });

  // Verify Distribution
  console.log('\n--- Verify Distribution ---');
  const counts = await prisma.token.groupBy({
    by: ['counterId', 'type'],
    where: { status: 'WAITING', counterId: { not: null } },
    _count: { id: true }
  });
  const counterMap = await prisma.counter.findMany({ select: { id: true, code: true, tokenType: true } });
  const cMap = new Map(counterMap.map(c => [c.id, c]));

  counts.forEach(row => {
    const c = cMap.get(row.counterId!);
    console.log(`${c?.code} (${c?.tokenType}) -> tokens: ${row._count.id} (${row.type})`);
  });

  console.log('\n--- Test 4: Rebalancing after deactivating C5 ---');
  await prisma.counter.update({ where: { id: c5.id }, data: { status: 'INACTIVE' } });
  await queueAllocation.rebalanceWaitingTokens(prisma as any, branch!.id);
  const unassignedSpecial = await prisma.token.count({ where: { status: 'WAITING', type: 'SPECIAL', counterId: null } });
  const wronglyAssignedSpecial = await prisma.token.count({ where: { status: 'WAITING', type: 'SPECIAL', counterId: { not: null } } });
  console.log(`Unassigned SPECIAL tokens: ${unassignedSpecial}, Wrongly assigned to NORMAL: ${wronglyAssignedSpecial}`);

  // Print public snapshot for C3 and C5 to verify display isolation
  await prisma.counter.update({ where: { id: c5.id }, data: { status: 'ACTIVE' } });
  await queueAllocation.rebalanceWaitingTokens(prisma as any, branch!.id); // reassign back to c5
  
  const display = await prisma.display.findFirst({ where: { branchId: branch!.id } });
  if (display) {
    const snapshot = await displaysService.getPublicSnapshot(display.publicId, 'test');
    console.log('\n--- Display Snapshot ---');
    snapshot.counters.forEach(c => {
      console.log(`${c.code} (${c.tokenType}): now=${c.now?.tokenLabel || 'none'}, next=${c.next?.tokenLabel || 'none'}, waiting=${c.waitingTokens.length}`);
    });
  }

  await app.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
