import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const tokens = await prisma.token.findMany({
    where: { status: 'WAITING', counterId: null },
    include: { queueEntry: { include: { service: { include: { department: true } } } } }
  });
  
  for (const token of tokens) {
    console.log(`Token: ${token.displayNumber} | Branch: ${token.queueEntry.service.department.branchId}`);
  }
  
  process.exit(0);
}

run();
