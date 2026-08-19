const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    const branch = await prisma.branch.findFirst({
      include: { organization: { select: { timezone: true } } },
    });
    console.log("Success:", branch);
  } catch (err) {
    console.log("Error:", err.message);
  }
}
test().catch(console.error).finally(() => prisma.$disconnect());
