const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    const branchId = '1a8cdcf5-d623-4a9c-80e2-574f3dfaadc4';
    const businessDate = new Date('2026-08-20T00:00:00.000Z');
    
    const page = 1;
    const limit = 20;

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
    
    const orderBy = { issuedAt: 'asc' };
    
    const tokenSelect = {
      id: true,
      queueEntryId: true,
      sequenceNumber: true,
      displayNumber: true,
      businessDate: true,
      status: true,
      issuedAt: true,
      createdAt: true,
      updatedAt: true,
      queueEntry: { select: { id: true, priority: true, priorityWeight: true, patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true } }, service: { select: { id: true, name: true, department: { select: { id: true, name: true } } } } } },
      counter: { select: { id: true, name: true, code: true } },
    };

    const data = await prisma.token.findMany({ 
      where, 
      orderBy: [orderBy, { id: 'asc' }], 
      skip: (page - 1) * limit, 
      take: limit, 
      select: tokenSelect 
    });
    console.log("Success findMany. Count:", data.length);
  } catch (err) {
    console.log("Error in findMany:");
    console.error(err);
  }
}
test().catch(console.error).finally(() => prisma.$disconnect());
