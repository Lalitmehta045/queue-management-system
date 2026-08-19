const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const t19 = await prisma.token.findMany({ where: { businessDate: new Date('2026-08-19T00:00:00.000Z') } });
  const t20 = await prisma.token.findMany({ where: { businessDate: new Date('2026-08-20T00:00:00.000Z') } });
  console.log('19th:', t19.length);
  console.log('20th:', t20.length);
}
run().finally(() => prisma.$disconnect());
