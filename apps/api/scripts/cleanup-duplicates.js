const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanup() {
  const waitingTokens = await prisma.token.findMany({
    where: { status: 'WAITING' },
    orderBy: { createdAt: 'asc' }
  });
  
  const seenLabels = new Set();
  const toDelete = [];
  
  for (const t of waitingTokens) {
    if (seenLabels.has(t.displayNumber)) {
      toDelete.push(t.id);
    } else {
      seenLabels.add(t.displayNumber);
    }
  }
  
  if (toDelete.length > 0) {
    await prisma.token.deleteMany({
      where: { id: { in: toDelete } }
    });
    console.log(`Deleted ${toDelete.length} duplicate test tokens.`);
  } else {
    console.log('No duplicates found.');
  }
}

cleanup().catch(console.error).finally(() => prisma.$disconnect());
