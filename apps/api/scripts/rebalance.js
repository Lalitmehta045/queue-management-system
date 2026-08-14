const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const display = await prisma.display.findFirst({ where: { active: true } });
  if (!display) return console.log('no display');
  
  const branchId = display.branchId;
  const counters = await prisma.counter.findMany({
      where: { branchId, status: 'ACTIVE' },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
  });
  
  const waitingTokens = await prisma.token.findMany({
      where: {
        status: 'WAITING',
        queueEntry: { service: { department: { branchId } } }
      },
      select: { id: true },
      orderBy: [
        { queueEntry: { priorityWeight: 'desc' } },
        { businessDate: 'asc' },
        { sequenceNumber: 'asc' },
        { id: 'asc' }
      ]
  });
  
  const updates = new Map();
  for (const c of counters) updates.set(c.id, []);

  waitingTokens.forEach((token, index) => {
      const targetCounter = counters[index % counters.length];
      updates.get(targetCounter.id).push(token.id);
  });

  for (const [counterId, tokenIds] of updates.entries()) {
      if (tokenIds.length > 0) {
        await prisma.token.updateMany({
          where: { id: { in: tokenIds } },
          data: { counterId },
        });
      }
  }
  console.log('Rebalanced tokens.');
}

run().catch(console.error).finally(() => prisma.$disconnect());
