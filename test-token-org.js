const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.token.findFirst({ 
  where: { displayNumber: 'T-040' },
  include: {
    queueEntry: {
      include: {
        service: {
          include: {
            department: {
              include: {
                branch: {
                  include: {
                    organization: true
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}).then(token => console.log(JSON.stringify(token.queueEntry.service.department.branch.organization, null, 2))).finally(() => prisma.$disconnect());
