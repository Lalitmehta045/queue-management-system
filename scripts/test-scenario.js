const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function main() {
  const branch = await prisma.branch.findFirst();
  if (!branch) throw new Error('No branch found');

  const dept = await prisma.department.findFirst({ where: { branchId: branch.id } });
  const service = await prisma.service.findFirst({ where: { departmentId: dept.id } });

  console.log(`Using branch: ${branch.name}, service: ${service.name}`);

  // Reactivate all counters
  await prisma.counter.updateMany({
    where: { branchId: branch.id },
    data: { status: 'ACTIVE' }
  });

  const axios = require('axios');
  
  // Set up sequence and tokens via API (assuming API is running on localhost:3000)
  // But wait, the API might not be running. Let's just create them via prisma for the sake of the test,
  // or we can just start the api and use axios.
  // Using Prisma directly might skip QueueAllocationService.
  console.log('Use test-allocation.ts to test through services');
}
main().catch(console.error).finally(() => prisma.$disconnect());
