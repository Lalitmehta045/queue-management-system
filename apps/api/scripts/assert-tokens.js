const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const display = await prisma.display.findFirst({ where: { active: true } });
  if (!display) return console.log('no display');
  
  const branchCounters = await prisma.counter.findMany({
      where: { branchId: display.branchId, status: 'ACTIVE' },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
  });
  
  const waitingTokens = await prisma.token.findMany({
      where: { status: 'WAITING', counterId: { not: null }, queueEntry: { status: 'WAITING', service: { department: { branchId: display.branchId } } } },
      orderBy: [{ queueEntry: { priorityWeight: 'desc' } }, { businessDate: 'asc' }, { sequenceNumber: 'asc' }, { id: 'asc' }],
      select: { id: true, displayNumber: true, counterId: true }
  });
  
  const counters = branchCounters.map(c => {
     return {
        code: c.code,
        waitingTokens: waitingTokens.filter(t => t.counterId === c.id)
     };
  });
  
  let allIds = [];
  counters.forEach(c => {
     console.log(`Counter ${c.code}:`);
     c.waitingTokens.forEach(t => {
       console.log(`  WAIT: ${t.displayNumber} (id: ${t.id})`);
       allIds.push(t.id);
     });
  });
  
  console.log(`Total waiting in arrays: ${allIds.length}`);
  const uniqueIds = new Set(allIds);
  console.log(`Unique token IDs: ${uniqueIds.size}`);
  
  console.log(`Assertion passed? ${allIds.length === uniqueIds.size}`);
}

check().catch(console.error).finally(() => prisma.$disconnect());
