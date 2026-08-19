const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.$executeRawUnsafe('UPDATE "Branch" SET "currentBusinessDate" = NULL').then(() => {
  console.log('Cleared');
  return prisma.$disconnect();
});
