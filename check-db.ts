import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const displays = await prisma.display.findMany({ select: { id: true, name: true, branchId: true } });
  console.log('Displays:', displays);

  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  console.log('Branches:', branches);

  const counters = await prisma.counter.findMany({ 
    select: { id: true, code: true, name: true, status: true, tokenType: true, branchId: true } 
  });
  console.log('Counters:');
  for (const c of counters) {
    console.log(`- ${c.code} (${c.name}): status=${c.status}, tokenType=${c.tokenType}, branchId=${c.branchId}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
