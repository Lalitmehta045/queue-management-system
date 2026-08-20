const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== DB Verification ===");
  const tokens = await prisma.token.findMany({
    where: { status: 'WAITING', counterId: { not: null } },
    select: {
      counterId: true,
      displayNumber: true,
      sequenceNumber: true,
      status: true,
      type: true,
      createdAt: true,
      counter: { select: { code: true } },
      queueEntry: { select: { priorityWeight: true } },
      issuedAt: true
    },
    orderBy: [
      { counterId: 'asc' },
      { queueEntry: { priorityWeight: 'desc' } },
      { createdAt: 'asc' },
      { sequenceNumber: 'asc' }
    ]
  });
  
  for (const t of tokens) {
    console.log(
      `Counter: ${t.counter?.code} | ` +
      `Token: ${t.displayNumber} | ` +
      `Seq: ${t.sequenceNumber} | ` +
      `Priority: ${t.queueEntry?.priorityWeight} | ` +
      `Created: ${t.createdAt.toISOString()}`
    );
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
