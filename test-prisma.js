const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const org = await prisma.organization.findFirst();
    const branch = await prisma.branch.findFirst({ where: { organizationId: org.id } });
    const service = await prisma.service.findFirst({ where: { department: { branchId: branch.id } } });
    
    // Simulate what tokens.service.ts does for quantity = 10
    const quantity = 10;
    
    await prisma.$transaction(async (tx) => {
      // Create token sequence
      const tokenType = 'NORMAL';
      const businessDate = new Date();
      businessDate.setUTCHours(0,0,0,0);
      
      let sequence = await tx.tokenSequence.findFirst({
         where: { branchId: branch.id, serviceId: service.id, businessDate, tokenType }
      });
      if (!sequence) {
         sequence = await tx.tokenSequence.create({
            data: { branchId: branch.id, serviceId: service.id, businessDate, tokenType, nextNumber: 1 }
         });
      }
      
      const sequenceNumber = sequence.nextNumber;
      await tx.tokenSequence.updateMany({
         where: { id: sequence.id, nextNumber: sequenceNumber },
         data: { nextNumber: { increment: quantity } }
      });
      
      for (let i = 0; i < quantity; i++) {
        const qe = await tx.queueEntry.create({
          data: {
            serviceId: service.id,
            activeEntryKey: null,
            priority: 'NORMAL',
            priorityWeight: 0,
          },
        });
        
        await tx.token.create({
          data: {
            queueEntryId: qe.id,
            sequenceId: sequence.id,
            sequenceNumber: sequenceNumber + i,
            displayNumber: 'T-' + (sequenceNumber + i).toString().padStart(3, '0'),
            businessDate: businessDate,
            type: tokenType,
          }
        });
      }
    });
    
    console.log("Success");
  } catch (err) {
    console.error("FAILED:", err);
  } finally {
    await prisma.$disconnect();
  }
}
main();
