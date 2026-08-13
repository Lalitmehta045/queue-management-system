import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const branches = await prisma.branch.findMany({
    include: {
      counters: true
    }
  });

  branches.forEach(b => {
    console.log(`Branch: ${b.name}`);
    b.counters.forEach(c => {
      console.log(`  Counter: ${c.name} (${c.code}) - Status: ${c.status}`);
    });
  });

  process.exit(0);
}

run();
