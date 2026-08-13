import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const branchId = '05468487-1c3e-4eb3-aee9-07131ca1a344';
  
  const counters = await prisma.counter.findMany({
    where: { branchId, status: 'ACTIVE' },
    select: { id: true, code: true },
    orderBy: { code: 'asc' },
  });
  
  console.log('Active counters length:', counters.length);
  if (!counters.length) return null;
  
  const waitingCounts = await prisma.token.groupBy({
    by: ['counterId'],
    where: {
      counterId: { in: counters.map((c) => c.id) },
      status: 'WAITING',
    },
    _count: { id: true },
  });
  
  console.log('waitingCounts:', waitingCounts);
  process.exit(0);
}

run();
