import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const latestToken = await prisma.token.findFirst({
    orderBy: { createdAt: 'desc' }
  });
  console.log('Latest Token:', latestToken);
  process.exit(0);
}

run();
