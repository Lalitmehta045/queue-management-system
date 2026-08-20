import { PrismaClient } from '@prisma/client';
import { QueueAllocationService } from './apps/api/src/queue-calling/queue-allocation.service';
const prisma = new PrismaClient();
const allocationService = new QueueAllocationService();

async function main() {
  const branch = await prisma.branch.findFirst({ where: { name: 'main' } });
  if (!branch) return;

  // Clear existing tokens
  await prisma.token.deleteMany({ where: { queueEntry: { service: { department: { branchId: branch.id } } } } });
  await prisma.queueEntry.deleteMany({ where: { service: { department: { branchId: branch.id } } } });

  console.log('Creating 20 NORMAL tokens...');
  const service = await prisma.service.findFirst({ where: { department: { branchId: branch.id } } });
  for (let i = 0; i < 20; i++) {
    const queue = await prisma.queueEntry.create({
      data: { serviceId: service.id, status: 'WAITING' }
    });
    await prisma.token.create({
      data: {
        queueEntry: { connect: { id: queue.id } },
        businessDate: new Date(),
        sequenceNumber: i + 1,
        displayNumber: `N${i+1}`,
        type: 'NORMAL',
        status: 'WAITING',
      }
    });
  }

  console.log('Creating 10 SPECIAL tokens...');
  for (let i = 0; i < 10; i++) {
    const queue = await prisma.queueEntry.create({
      data: { serviceId: service.id, status: 'WAITING' }
    });
    await prisma.token.create({
      data: {
        queueEntry: { connect: { id: queue.id } },
        businessDate: new Date(),
        sequenceNumber: i + 1,
        displayNumber: `S${i+1}`,
        type: 'SPECIAL',
        status: 'WAITING',
      }
    });
  }

  console.log('Triggering rebalance for NORMAL queue...');
  await prisma.$transaction(async (tx) => {
    await allocationService.rebalanceWaitingTokens(tx as any, branch.id, 'NORMAL');
  });

  console.log('Triggering rebalance for SPECIAL queue...');
  await prisma.$transaction(async (tx) => {
    await allocationService.rebalanceWaitingTokens(tx as any, branch.id, 'SPECIAL');
  });

  const updatedCounters = await prisma.counter.findMany({ where: { branchId: branch.id, status: 'ACTIVE' }, orderBy: { code: 'asc' } });
  const tokens = await prisma.token.groupBy({
    by: ['counterId', 'type'],
    _count: { id: true },
    where: { status: 'WAITING', counterId: { not: null } }
  });

  console.log('--- DB DISTRIBUTION AFTER REBALANCE ---');
  for (const c of updatedCounters) {
    const normalCount = tokens.find(t => t.counterId === c.id && t.type === 'NORMAL')?._count.id || 0;
    const specialCount = tokens.find(t => t.counterId === c.id && t.type === 'SPECIAL')?._count.id || 0;
    console.log(`${c.code} (${c.tokenType}): ${normalCount} NORMAL, ${specialCount} SPECIAL`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
