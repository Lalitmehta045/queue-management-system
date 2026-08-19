const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  const users = await prisma.user.findMany({ take: 1 });
  console.log(users);
}
test().catch(console.error).finally(() => prisma.$disconnect());
