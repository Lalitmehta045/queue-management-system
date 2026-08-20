import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tokens = await prisma.token.findMany({
    orderBy: { issuedAt: 'desc' },
    take: 10,
    select: {
      id: true,
      displayNumber: true,
      sequenceNumber: true,
      type: true,
      specialCategory: true,
      counterId: true,
      issuedAt: true,
    }
  });
  console.log('Last 10 tokens:');
  console.table(tokens);

  const sequences = await prisma.tokenSequence.findMany({
    select: {
      id: true,
      tokenType: true,
      nextNumber: true,
    }
  });
  console.log('Token sequences:');
  console.table(sequences);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
