const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.token.findMany({ select: { id: true, displayNumber: true, businessDate: true, issuedAt: true }, orderBy: { issuedAt: 'desc' }, take: 5 }).then(console.log).finally(() => prisma.$disconnect());
