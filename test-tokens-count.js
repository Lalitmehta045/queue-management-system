const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    const branchId = '1a8cdcf5-d623-4a9c-80e2-574f3dfaadc4';
    const businessDate = new Date('2026-08-20T00:00:00.000Z');

    const where = { 
      businessDate, 
      queueEntry: {
        OR: [
          { patientId: null },
          { patient: { branchId, branch: { organizationId: 'c0e44a57-fc62-4f4c-8f29-827b15c31b7d' } } },
        ],
        service: { department: { branchId, branch: { organizationId: 'c0e44a57-fc62-4f4c-8f29-827b15c31b7d' } } },
      }
    };
    
    const count = await prisma.token.count({ where });
    console.log("Success count:", count);
  } catch (err) {
    console.log("Error in count:");
    console.error(err);
  }
}
test().catch(console.error).finally(() => prisma.$disconnect());
