import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const c = await prisma.counter.findMany();
  console.log('Counters:', c);
}

main();
