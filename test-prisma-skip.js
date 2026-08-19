const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    const data = await prisma.token.findMany({
      skip: NaN,
      take: 20
    });
    console.log("Success");
  } catch (err) {
    console.log("Error:", err.message);
  }
}
test().catch(console.error).finally(() => prisma.$disconnect());
