const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    const businessDate = new Date();
    const tokensToCancel = await prisma.token.findMany({
      where: {
        sequence: { branchId: '1a8cdcf5-d623-4a9c-80e2-574f3dfaadc4' },
        businessDate,
        status: 'WAITING',
      },
      select: { id: true, queueEntryId: true, displayNumber: true }
    });
    console.log("Success:", tokensToCancel);
  } catch (err) {
    console.log("Error:");
    console.error(err);
  }
}
test().catch(console.error).finally(() => prisma.$disconnect());
