import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const allWaiting = await prisma.token.count({
    where: { status: 'WAITING' }
  });
  
  const nullCounter = await prisma.token.count({
    where: { status: 'WAITING', counterId: null }
  });
  
  console.log(`Total WAITING tokens: ${allWaiting}`);
  console.log(`WAITING tokens with counterId=null: ${nullCounter}`);
  
  process.exit(0);
}

run();
