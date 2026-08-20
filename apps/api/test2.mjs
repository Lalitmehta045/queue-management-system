import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const [data, total] = await prisma.$transaction([
      prisma.counter.findMany({ select: { tokenType: true } }),
      prisma.counter.count()
    ]);
    console.log('Transaction result:', data, total);
  } catch (e) {
    console.error('Transaction error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
