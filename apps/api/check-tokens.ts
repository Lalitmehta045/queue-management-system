import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const tokens = await prisma.token.findMany({
    where: { status: 'WAITING' },
    take: 10
  });

  tokens.forEach(t => {
    console.log(`Token ID: ${t.id} | displayNumber: ${t.displayNumber} | tokenLabel: ${(t as any).tokenLabel} | counterId: ${t.counterId}`);
  });

  process.exit(0);
}

run();
