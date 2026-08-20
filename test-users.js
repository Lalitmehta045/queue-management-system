const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      displayName: true
    }
  });
  console.log("Users in database:");
  console.log(users);
}
test().catch(console.error).finally(() => prisma.$disconnect());
