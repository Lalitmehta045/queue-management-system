import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const branches = await prisma.branch.findMany({
    select: { id: true, name: true }
  });
  console.log(branches);
  process.exit(0);
}

run();
