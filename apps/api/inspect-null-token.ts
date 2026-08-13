import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const token = await prisma.token.findFirst({
    where: { counterId: null }
  });
  console.log(token);
  process.exit(0);
}

run();
