const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const tokens = await prisma.token.findMany({
    where: { status: 'WAITING' },
    select: {
      id: true,
      displayNumber: true,
      counterId: true,
      status: true,
      counter: {
        select: {
          name: true,
          code: true
        }
      }
    }
  });

  console.log(`Found ${tokens.length} WAITING tokens`);
  const dupes = {};
  for (const t of tokens) {
    if (!dupes[t.displayNumber]) dupes[t.displayNumber] = [];
    dupes[t.displayNumber].push(t);
  }

  for (const [label, arr] of Object.entries(dupes)) {
    if (arr.length > 1) {
      console.log(`DUPLICATE LABEL: ${label}`);
      for (const t of arr) {
         console.log(`  id: ${t.id} counterId: ${t.counterId} counter: ${t.counter?.code}`);
      }
    }
  }

  // Also check if any single token has an array of counters (not possible by schema, but verify mapping)
}

check().catch(console.error).finally(() => prisma.$disconnect());
