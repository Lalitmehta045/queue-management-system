import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const token = await prisma.token.findUnique({
    where: { id: '5bae560b-b282-405c-bb6e-c9eaf9ad5252' },
    include: { queueEntry: { include: { service: { include: { department: true } } } } }
  });
  console.log(JSON.stringify(token, null, 2));
  process.exit(0);
}

run();
