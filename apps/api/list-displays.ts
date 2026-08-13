import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const displays = await prisma.display.findMany({
    include: {
      branch: {
        include: {
          counters: true,
          departments: { include: { services: { include: { queueEntries: { include: { token: true } } } } } }
        }
      }
    }
  });
  
  for (const display of displays) {
    console.log(`Display: ${display.name} | PublicID: ${display.publicId} | Branch: ${display.branch.name} (${display.branchId})`);
    
    const waitingCount = await prisma.token.count({
      where: { status: 'WAITING', queueEntry: { service: { department: { branchId: display.branchId } } } }
    });
    
    const waitingWithCounterCount = await prisma.token.count({
      where: { status: 'WAITING', counterId: { not: null }, queueEntry: { service: { department: { branchId: display.branchId } } } }
    });
    
    console.log(`  Waiting Total: ${waitingCount}`);
    console.log(`  Waiting With Counter: ${waitingWithCounterCount}`);
  }
  
  process.exit(0);
}

run();
