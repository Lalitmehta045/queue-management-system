const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixTokens() {
  const date19 = new Date('2026-08-19T00:00:00.000Z');
  const date20 = new Date('2026-08-20T00:00:00.000Z');

  await prisma.$transaction(async (tx) => {
    // 1. Delete CANCELLED tokens for 19th and their queue entries
    const badTokens = await tx.token.findMany({
      where: { businessDate: date19, status: 'CANCELLED' }
    });
    const badTokenIds = badTokens.map(t => t.id);
    const badQueueEntryIds = badTokens.map(t => t.queueEntryId);

    if (badTokenIds.length > 0) {
      await tx.token.deleteMany({ where: { id: { in: badTokenIds } } });
      await tx.queueEntry.deleteMany({ where: { id: { in: badQueueEntryIds } } });
    }

    // 2. Delete TokenSequences for 19th
    await tx.tokenSequence.deleteMany({
      where: { businessDate: date19 }
    });

    // 3. Update TokenSequences for 20th to 19th
    await tx.tokenSequence.updateMany({
      where: { businessDate: date20 },
      data: { businessDate: date19 }
    });

    // 4. Update Tokens for 20th to 19th
    await tx.token.updateMany({
      where: { businessDate: date20 },
      data: { businessDate: date19 }
    });
  });

  console.log("Tokens and sequences successfully migrated from 20th to 19th.");
}

fixTokens().catch(console.error).finally(() => prisma.$disconnect());
