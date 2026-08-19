const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const t19 = await prisma.token.findMany({ where: { businessDate: new Date('2026-08-19T00:00:00.000Z') }, select: { displayNumber: true, sequenceNumber: true, status: true, id: true } });
  const t20 = await prisma.token.findMany({ where: { businessDate: new Date('2026-08-20T00:00:00.000Z') }, select: { displayNumber: true, sequenceNumber: true, status: true, id: true } });
  console.log('19th:', t19);
  console.log('20th:', t20.slice(0, 5), '...', t20.slice(-2));
}
run().finally(() => prisma.$disconnect());
