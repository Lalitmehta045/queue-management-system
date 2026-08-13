import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const display = await prisma.display.findFirst();
  if (!display) return;
  console.log('Public ID:', display.publicId);
  process.exit(0);
}

run();
