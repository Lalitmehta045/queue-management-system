import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const displays = await prisma.display.findMany({ select: { id: true, publicId: true, name: true, branchId: true } });
  console.log('Displays:', displays);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
